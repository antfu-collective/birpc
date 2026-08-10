/**
 * Shared bits for the SSE + POST birpc transport.
 *
 * birpc assumes one full-duplex channel, but SSE is server -> client only, so
 * these adapters pair it with HTTP POST for the client -> server direction.
 * See `./client` and `./server` for the two ends.
 */

/** Default HTTP header used to correlate a client's POSTs with its SSE stream. */
export const DEFAULT_SESSION_HEADER = 'x-birpc-session'

/** Default path the client opens the SSE stream on. */
export const DEFAULT_SSE_PATH = '/sse'

/** Default path the client POSTs messages to. */
export const DEFAULT_RPC_PATH = '/rpc'

/** The SSE event name carrying the session id as the first frame. */
export const SESSION_EVENT = 'session'

/** The SSE event name carrying birpc messages. */
export const MESSAGE_EVENT = 'message'

/**
 * The subset of a birpc wire message the transport needs to peek at in order
 * to route it. birpc's own message shape is `{ t, i, ... }` where `t` is the
 * type (`'q'` request / `'s'` response) and `i` is the correlation id.
 */
export interface WireMessage {
  t: 'q' | 's'
  i?: string
}

/** Parse a stream of raw SSE text into `{ event, data }` frames. */
export function createSSEParser(
  onFrame: (event: string, data: string) => void,
): (chunk: string) => void {
  let buf = ''
  return (chunk: string) => {
    buf += chunk
    let idx: number
    // eslint-disable-next-line no-cond-assign
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      let event = MESSAGE_EVENT
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
