/**
 * birpc server over SSE (server -> client) + HTTP POST (client -> server).
 *
 * Run with:  tsx examples/sse/server.ts
 *
 * Note how the birpc setup below is IDENTICAL in shape to the WebSocket example
 * in the README - a `post`/`on`/`serialize`/`deserialize` channel. All the
 * SSE/POST plumbing is hidden inside the session manager (./adapter).
 */
import type { ClientFunctions, ServerFunctions } from './types'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createBirpc } from '../../src/index'
import { createSSESessionManager } from './adapter'

const PORT = Number(process.env.PORT) || 3737

const serverFunctions: ServerFunctions = {
  hi(name) {
    return `Hi ${name}, from the server`
  },
  async add(a, b) {
    return a + b
  },
}

const sessions = createSSESessionManager()
const html = readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8')

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, `http://localhost:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/sse') {
    const { channel, id } = sessions.open(req, res)

    // Same shape as the README WebSocket example.
    const rpc = createBirpc<ClientFunctions, ServerFunctions>(serverFunctions, {
      post: channel.post,
      on: channel.on,
      serialize: v => JSON.stringify(v),
      deserialize: v => JSON.parse(v),
    })

    // Prove the reverse direction: the server calls a function ON THE CLIENT
    // and awaits its result. Request rides SSE, response rides a POST.
    setTimeout(async () => {
      try {
        const reply = await rpc.hey('Server')
        console.log(`[server] session ${id.slice(0, 8)} rpc.hey('Server') ->`, JSON.stringify(reply))
      }
      catch (e) {
        console.error('[server] server-initiated call failed:', e)
      }
    }, 100)
    return
  }

  if (req.method === 'POST' && url.pathname === '/rpc') {
    await sessions.handlePost(req, res)
    return
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-birpc-session',
    })
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(html)
    return
  }

  res.writeHead(404)
  res.end('not found')
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] birpc-over-SSE listening on http://0.0.0.0:${PORT}`)
  console.log(`[server] open http://localhost:${PORT}/ for the browser demo`)
})
