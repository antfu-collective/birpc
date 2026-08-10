/**
 * birpc Node client over SSE + POST.
 *
 * Run (with the server already running):  tsx examples/sse/client.ts
 *
 * The `createBirpc` call is line-for-line the same shape as the README's
 * WebSocket client - only the channel construction differs.
 */
import type { ClientFunctions, ServerFunctions } from './types'
import { createBirpc } from '../../src/index'
import { createSSEClientChannel } from '../../src/sse/client'

const BASE = process.env.BASE_URL || 'http://localhost:3737'

const clientFunctions: ClientFunctions = {
  hey(name) {
    // Invoked by a SERVER-initiated call (flow #3), arriving over the SSE stream.
    console.log(`[client] server called hey(${JSON.stringify(name)})`)
    return `Hey ${name}, from the client`
  },
}

const channel = createSSEClientChannel(BASE)

const rpc = createBirpc<ServerFunctions, ClientFunctions>(clientFunctions, {
  post: channel.post,
  on: channel.on,
  serialize: v => JSON.stringify(v),
  deserialize: v => JSON.parse(v),
})

async function main() {
  // Flow #1/#2: client -> server request/response.
  console.log('[client] rpc.hi("Client") ->', JSON.stringify(await rpc.hi('Client')))
  console.log('[client] rpc.add(2, 3)   ->', JSON.stringify(await rpc.add(2, 3)))

  // Give the server's reverse call (flow #3/#4) time to land, then exit.
  await new Promise(r => setTimeout(r, 400))
  console.log('[client] done')
  process.exit(0)
}

main().catch((e) => {
  console.error('[client] error:', e)
  process.exit(1)
})
