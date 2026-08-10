# birpc over SSE — feasibility study + runnable PoC

**Question:** can birpc run on an **SSE-based backend** with the **same developer
experience** as the WebSocket example in the top-level README, while keeping
birpc's **full bidirectional** nature (server can also call the client)?

**Verdict:** **Yes — at the call site.** The consumer code is line-for-line the
same shape as the WebSocket example. But SSE is only *half* of a duplex channel,
so the price is paid inside the `post`/`on` adapter, which is necessarily
**non-trivial and asymmetric**. This document explains exactly why, and the code
here proves it end-to-end.

## Why there is any tension at all

birpc assumes **one full-duplex channel**. From [`src/main.ts`](../../src/main.ts):

- It sends with `post(serialize(req))` and **ignores `post`'s return value**.
- It resolves a call only when `onMessage` fires via **`on`**, matched by the
  request id `i` (`_rpcPromiseMap`).

So responses *must* arrive through `on`. SSE, however, is **server → client
only** (`EventSource`). There is no client → server path on an SSE stream. Any
SSE transport must therefore be paired with something for the reverse direction
— here, **HTTP POST** — and must reconcile "responses come back on POST" with
"birpc only listens on `on`".

## The design (as built)

| # | Flow | Direction | Transport |
|---|------|-----------|-----------|
| 1 | Client-initiated request (`t:'q'` + `i`) | client → server | `POST /rpc` |
| 2 | Response to #1 (`t:'s'`) | server → client | **the POST's HTTP body**, re-injected into the client's `on` |
| 3 | Server-initiated call (`t:'q'` + `i`) | server → client | **SSE stream** |
| 4 | Response to #3 (`t:'s'`) | client → server | plain `POST /rpc` (empty body), fed into the server's `on` |

Events (`t:'q'` with no `i`) ride their side's outbound path with no response.

Supporting decisions:

- **Session correlation** — SSE and POST are separate connections. On SSE open
  the **server mints a session id** and pushes it as the first SSE frame
  (`event: session`); the client echoes it on every POST via the
  `x-birpc-session` header. This lets a server-initiated call (flow #3) find the
  right SSE stream, and lets each POST feed the right birpc instance.
- **Reconnection** — a dropped/reconnected SSE stream is treated as a **brand
  new session**; in-flight calls are rejected (same posture as the WS example,
  which also does not resume). Durable resume (Last-Event-ID + a server replay
  buffer) is deliberately out of scope for this PoC.
- **Serializer** — `JSON.stringify`/`JSON.parse`, since SSE is a text transport
  (identical to the WS example).

### Where the complexity actually lives

The **call site stays identical** to the README's WebSocket example:

```ts
import { createBirpc } from 'birpc'
import { createSSEClientChannel } from 'birpc/sse/client'

const channel = createSSEClientChannel(BASE)
const rpc = createBirpc<ServerFunctions, ClientFunctions>(clientFunctions, {
  post: channel.post,
  on: channel.on,
  serialize: v => JSON.stringify(v),
  deserialize: v => JSON.parse(v),
})
```

…but the channel helpers (`birpc/sse/client` + `birpc/sse/server`) have to:

1. **Peek at the wire fields `{t, i}`** on each outgoing message to decide
   whether a POST expects a response body (client-initiated request) or is
   fire-and-forget (event / a response to a server call).
2. **Re-inject** a flow-#2 response (read from the POST body) back into birpc's
   `on` listener so the id correlation resolves transparently.
3. **Demux `post` output on the server by id**: a `t:'s'` message whose `i`
   matches an in-flight POST is written to *that POST's HTTP body*; everything
   else (server-initiated calls + events) is streamed down SSE.

This is the honest cost of the choice to return client-request responses in the
POST body. It is essentially the same shape as JSON-RPC-over-HTTP and MCP's
"Streamable HTTP" transport.

The channel helpers ship with birpc as dedicated sub-exports:

- **`birpc/sse/client`** — `createSSEClientChannel(baseUrl, options?)` → `{ post, on }`
  (dependency-free, works in the browser and Node).
- **`birpc/sse/server`** — `createSSESessionManager(options?)` → `{ open, handlePost }`
  (Node `http`, one birpc instance per SSE connection).

## Files

| File | Role |
|------|------|
| [`types.ts`](./types.ts) | Shared `ServerFunctions` / `ClientFunctions` contracts |
| [`server.ts`](./server.ts) | Node `http` server using `birpc/sse/server`, one birpc instance per SSE session |
| [`client.ts`](./client.ts) | Node client using `birpc/sse/client`, `fetch`-based SSE reader (CI-runnable) |
| [`index.html`](./index.html) | Browser client using the native `EventSource` API (fidelity to browser ↔ server) |

> The example files import from `../../src/sse/*` so they run against source; in
> your own app you'd import from `birpc/sse/client` and `birpc/sse/server`.

## Run it

Node client (no browser, no flags needed):

```sh
# terminal 1
npx tsx examples/sse/server.ts
# terminal 2
npx tsx examples/sse/client.ts
```

Browser client: start the server, then open <http://localhost:3737/>.

## Proof (real output)

Captured from an actual run of `server.ts` + `client.ts` against `../../src`:

```
# client
[client] rpc.hi("Client") -> "Hi Client, from the server"
[client] rpc.add(2, 3)   -> 5
[client] server called hey("Server")
[client] done

# server
[server] birpc-over-SSE listening on http://0.0.0.0:3737
[server] open http://localhost:3737/ for the browser demo
[server] session 1f0c... rpc.hey('Server') -> "Hey Server, from the client"
```

This exercises all four flows: client → server request/response (`hi`, `add`,
flows #1/#2) **and** server → client call/response (`hey`, flows #3/#4) — proving
the transport is genuinely bidirectional.

## Limitations & notes (production would need)

- **Reconnection/resume**: none. A network blip = a fresh session and rejected
  in-flight calls. Production would add Last-Event-ID + a server-side buffer.
- **Proxy buffering**: some proxies buffer `text/event-stream`; real deployments
  send periodic keep-alive comments and set `X-Accel-Buffering: no` etc.
- **Backpressure/cleanup**: the PoC keeps sessions in a `Map` keyed by id and
  drops them on stream close; no TTL/GC for half-open connections.
- **HTTP/1.1 connection limits**: browsers cap concurrent connections per origin;
  many simultaneous SSE streams + POSTs can contend (HTTP/2 mitigates this).
- **Head-of-line semantics**: each client request is its own POST, so they are
  independent; ordering across the SSE stream is preserved by TCP.

> This example and analysis were produced with the help of an agent.
