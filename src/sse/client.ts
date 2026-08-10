/**
 * Client side of the birpc SSE + POST transport.
 *
 * Produces a `{ post, on }` channel you can hand straight to `createBirpc`,
 * exactly like the `post`/`on` pair in the WebSocket example. The SSE stream
 * (server -> client) is read with `fetch` streaming so it works in both the
 * browser and Node without any dependency; the client -> server direction and
 * the response to a client-initiated request both ride HTTP POST.
 */
import type { WireMessage } from './shared'
import { createPromiseWithResolvers } from '../utils'
import {
  createSSEParser,
  DEFAULT_RPC_PATH,
  DEFAULT_SESSION_HEADER,
  DEFAULT_SSE_PATH,
  SESSION_EVENT,
} from './shared'

export interface SSEClientChannelOptions {
  /** Path to open the SSE stream on. @default '/sse' */
  ssePath?: string
  /** Path to POST messages to. @default '/rpc' */
  rpcPath?: string
  /** Header used to send the session id on each POST. @default 'x-birpc-session' */
  sessionHeader?: string
  /** Custom `fetch` implementation. @default globalThis.fetch */
  fetch?: typeof globalThis.fetch
  /** Extra headers to attach to every request. */
  headers?: Record<string, string>
}

export interface SSEChannel {
  post: (data: string) => Promise<void>
  on: (fn: (data: string) => void) => Promise<void>
}

/**
 * Create a birpc channel that talks to a server over SSE + POST.
 *
 * @param baseUrl - Base URL of the server, e.g. `http://localhost:3737`.
 */
export function createSSEClientChannel(
  baseUrl: string,
  options: SSEClientChannelOptions = {},
): SSEChannel {
  const {
    ssePath = DEFAULT_SSE_PATH,
    rpcPath = DEFAULT_RPC_PATH,
    sessionHeader = DEFAULT_SESSION_HEADER,
    fetch = globalThis.fetch,
    headers = {},
  } = options

  let sessionId: string | undefined
  let emit: ((data: string) => void) | undefined
  const { promise: ready, resolve: resolveReady } = createPromiseWithResolvers<void>()

  async function startSSE(): Promise<void> {
    const res = await fetch(`${baseUrl}${ssePath}`, {
      headers: { accept: 'text/event-stream', ...headers },
    })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const feed = createSSEParser((event, data) => {
      if (event === SESSION_EVENT) {
        sessionId = data
        resolveReady()
        return
      }
      // Server-initiated call / event.
      emit?.(data)
    })
    for (;;) {
      const { value, done } = await reader.read()
      if (done)
        break
      feed(decoder.decode(value, { stream: true }))
    }
  }

  return {
    post: async (data: string): Promise<void> => {
      await ready
      const msg = JSON.parse(data) as WireMessage
      const expectsResponse = msg.t === 'q' && msg.i != null
      const res = await fetch(`${baseUrl}${rpcPath}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [sessionHeader]: sessionId!,
          ...headers,
        },
        body: data,
      })
      const text = await res.text()
      // The response to a client-initiated request comes back in the POST body;
      // re-inject it into birpc via the `on` listener so ids correlate.
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
