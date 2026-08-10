/**
 * SSE + POST channel adapters for birpc.
 *
 * birpc assumes ONE full-duplex channel (post to send, on to receive, with
 * responses correlated by request id `i` arriving via `on`). SSE is only half
 * of that (server -> client), so this adapter pairs it with HTTP POST for the
 * client -> server direction and absorbs the resulting asymmetry so that the
 * *consumer* code stays identical to the WebSocket example.
 *
 * Message matrix:
 *   1. client-initiated request  (t:'q' + i)  -> POST ; response returned in POST body
 *   2. response to #1            (t:'s')       -> that POST's HTTP body (fed back into `on`)
 *   3. server-initiated call     (t:'q' + i)  -> SSE stream
 *   4. response to #3            (t:'s')       -> plain POST (empty HTTP body), fed into server `on`
 *   events (t:'q' no i) in either direction ride their side's outbound path, no response.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'

/** The subset of a birpc wire message the adapter needs to peek at. */
interface WireMessage {
  t: 'q' | 's'
  i?: string
}

const SESSION_HEADER = 'x-birpc-session'

// ---------------------------------------------------------------------------
// SSE framing helpers
// ---------------------------------------------------------------------------

function writeSSE(res: ServerResponse, event: string, data: string): void {
  // JSON.stringify never emits raw newlines, but split defensively anyway.
  const lines = data.split('\n').map(l => `data: ${l}`).join('\n')
  res.write(`event: ${event}\n${lines}\n\n`)
}

/** Parse a stream of raw SSE bytes into { event, data } frames. */
function createSSEParser(onFrame: (event: string, data: string) => void) {
  let buf = ''
  return (chunk: string) => {
    buf += chunk
    let idx: number
    // eslint-disable-next-line no-cond-assign
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      let event = 'message'
      const data: string[] = []
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:'))
          event = line.slice(6).trim()
        else if (line.startsWith('data:'))
          data.push(line.slice(5).replace(/^ /, ''))
      }
      onFrame(event, data.join('\n'))
    }
  }
}

// ---------------------------------------------------------------------------
// Client side (Node): fetch-based SSE reader + fetch POST
// ---------------------------------------------------------------------------

export function createSSEClientChannel(baseUrl: string) {
  let sessionId: string | undefined
  let emit: ((data: string) => void) | undefined
  let resolveReady!: () => void
  const ready = new Promise<void>((r) => { resolveReady = r })

  async function startSSE(): Promise<void> {
    const res = await fetch(`${baseUrl}/sse`, {
      headers: { accept: 'text/event-stream' },
    })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const feed = createSSEParser((event, data) => {
      if (event === 'session') {
        sessionId = data
        resolveReady()
        return
      }
      // Everything else is a birpc message (server-initiated call / event).
      emit?.(data)
    })
    // Background read loop.
    void (async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done)
          break
        feed(decoder.decode(value, { stream: true }))
      }
    })()
  }

  return {
    post: async (data: string): Promise<void> => {
      await ready
      const msg = JSON.parse(data) as WireMessage
      const expectsResponse = msg.t === 'q' && msg.i != null
      const res = await fetch(`${baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SESSION_HEADER]: sessionId!,
        },
        body: data,
      })
      const text = await res.text()
      // Flow #2: the response to a client-initiated request comes back in the
      // POST body; re-inject it into birpc via the `on` listener.
      if (expectsResponse && text)
        emit?.(text)
    },
    on: (fn: (data: string) => void): Promise<void> => {
      emit = fn
      void startSSE()
      // birpc awaits this before the first call, so the session handshake
      // completes before anything is sent.
      return ready
    },
  }
}

// ---------------------------------------------------------------------------
// Server side (Node): one session per SSE connection
// ---------------------------------------------------------------------------

interface Session {
  id: string
  res: ServerResponse
  /** birpc's incoming-message listener for this session. */
  emit?: (data: string) => void
  /** In-flight client requests awaiting a response in their POST body, by id. */
  pending: Map<string, ServerResponse>
  onClose?: () => void
}

export function createSSESessionManager() {
  const sessions = new Map<string, Session>()

  /** Handle `GET /sse`: open the stream, mint a session, return its channel. */
  function open(req: IncomingMessage, res: ServerResponse) {
    const id = randomUUID()
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'access-control-allow-origin': '*',
    })
    const session: Session = { id, res, pending: new Map() }
    sessions.set(id, session)

    // First frame: hand the client its session id.
    writeSSE(res, 'session', id)

    req.on('close', () => {
      sessions.delete(id)
      session.onClose?.()
    })

    const channel = {
      post: async (data: string): Promise<void> => {
        const msg = JSON.parse(data) as WireMessage
        // Flow #2: a response (t:'s') whose id matches a waiting POST goes back
        // on that POST's HTTP body; everything else (server-initiated calls +
        // events, all t:'q') streams down SSE.
        if (msg.t === 's' && msg.i != null && session.pending.has(msg.i)) {
          const pendingRes = session.pending.get(msg.i)!
          session.pending.delete(msg.i)
          pendingRes.writeHead(200, {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          })
          pendingRes.end(data)
          return
        }
        writeSSE(res, 'message', data)
      },
      on: (fn: (data: string) => void): void => {
        session.emit = fn
      },
    }

    return { id, channel, onClose: (fn: () => void) => { session.onClose = fn } }
  }

  /** Handle `POST /rpc`: route the body into the right session's birpc. */
  async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const id = req.headers[SESSION_HEADER] as string | undefined
    const session = id ? sessions.get(id) : undefined
    if (!session) {
      res.writeHead(400, { 'access-control-allow-origin': '*' })
      res.end('unknown session')
      return
    }

    let body = ''
    for await (const chunk of req)
      body += chunk

    const msg = JSON.parse(body) as WireMessage
    const expectsResponse = msg.t === 'q' && msg.i != null

    if (expectsResponse) {
      // Park the HTTP response; it is completed when birpc posts the matching
      // response (see channel.post above).
      session.pending.set(msg.i!, res)
      session.emit?.(body)
    }
    else {
      // Flow #4 (client's response to a server-initiated call) or a client
      // event: no HTTP body to return.
      session.emit?.(body)
      res.writeHead(202, { 'access-control-allow-origin': '*' })
      res.end()
    }
  }

  return { open, handlePost }
}
