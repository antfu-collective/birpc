/**
 * Server side of the birpc SSE + POST transport (Node `http`).
 *
 * A copy-paste recipe, not part of the birpc package - drop this `channel/`
 * folder into your own project and adjust it to taste.
 *
 * One birpc instance lives per SSE connection. `open` handles `GET /sse`
 * (streams server -> client, mints a session id) and returns a `{ post, on }`
 * channel for `createBirpc`; `handlePost` routes an incoming `POST /rpc` into
 * the right session's birpc instance.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WireMessage } from './shared'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_SESSION_HEADER,
  MESSAGE_EVENT,
  SESSION_EVENT,
} from './shared'

function writeSSE(res: ServerResponse, event: string, data: string): void {
  // JSON.stringify never emits raw newlines, but split defensively anyway.
  const lines = data.split('\n').map(l => `data: ${l}`).join('\n')
  res.write(`event: ${event}\n${lines}\n\n`)
}

export interface SSEServerChannel {
  post: (data: string) => Promise<void>
  on: (fn: (data: string) => void) => void
}

export interface SSESession {
  /** The session id, also sent to the client as the first SSE frame. */
  id: string
  /** The `{ post, on }` channel to hand to `createBirpc`. */
  channel: SSEServerChannel
  /** Register a callback fired when the SSE stream closes. */
  onClose: (fn: () => void) => void
}

export interface SSESessionManagerOptions {
  /** Header the client echoes its session id on. @default 'x-birpc-session' */
  sessionHeader?: string
  /** Custom session id generator. @default crypto.randomUUID */
  generateId?: () => string
}

interface InternalSession {
  id: string
  res: ServerResponse
  emit?: (data: string) => void
  /** In-flight client requests awaiting a response in their POST body, by id. */
  pending: Map<string, ServerResponse>
  onClose?: () => void
}

export interface SSESessionManager {
  /** Handle `GET /sse`: open the stream, mint a session, return its channel. */
  open: (req: IncomingMessage, res: ServerResponse) => SSESession
  /** Handle `POST /rpc`: route the body into the matching session's birpc. */
  handlePost: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}

/**
 * Create a manager that owns the per-connection SSE sessions and routes POSTs
 * to the right one.
 */
export function createSseSessionManager(
  options: SSESessionManagerOptions = {},
): SSESessionManager {
  const {
    sessionHeader = DEFAULT_SESSION_HEADER,
    generateId = randomUUID,
  } = options

  const sessions = new Map<string, InternalSession>()

  function open(req: IncomingMessage, res: ServerResponse): SSESession {
    const id = generateId()
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'access-control-allow-origin': '*',
      'x-accel-buffering': 'no',
    })
    const session: InternalSession = { id, res, pending: new Map() }
    sessions.set(id, session)

    // First frame: hand the client its session id.
    writeSSE(res, SESSION_EVENT, id)

    req.on('close', () => {
      sessions.delete(id)
      session.onClose?.()
    })

    const channel: SSEServerChannel = {
      post: async (data: string): Promise<void> => {
        const msg = JSON.parse(data) as WireMessage
        // A response (t:'s') whose id matches a waiting POST goes back on that
        // POST's HTTP body; everything else (server-initiated calls + events,
        // all t:'q') streams down SSE.
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
        writeSSE(res, MESSAGE_EVENT, data)
      },
      on: (fn: (data: string) => void): void => {
        session.emit = fn
      },
    }

    return {
      id,
      channel,
      onClose: (fn: () => void) => { session.onClose = fn },
    }
  }

  async function handlePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const id = req.headers[sessionHeader] as string | undefined
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
      // A client's response to a server-initiated call, or a client event:
      // nothing to return in the HTTP body.
      session.emit?.(body)
      res.writeHead(202, { 'access-control-allow-origin': '*' })
      res.end()
    }
  }

  return { open, handlePost }
}
