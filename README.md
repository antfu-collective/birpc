# birpc

[![NPM version](https://img.shields.io/npm/v/birpc?color=a1b858&label=)](https://www.npmjs.com/package/birpc)

Message-based two-way remote procedure call. Useful for WebSockets and Workers communication.

## Features

- Intuitive - call remote functions just like locals, with Promise to get the response
- TypeScript - safe function calls for arguments and returns
- Protocol agonostic - WebSocket, MessageChannel, any protocols with messages communication would work!
- Zero deps, ~2KB

## Examples

### Using WebSocket

When using WebSocket, you need to pass your custom serializer and deserializer.

#### Client

```ts
import type { ServerFunctions } from './types'

const ws = new WebSocket('ws://url')

const clientFunctions: ClientFunctions = {
  hey(name: string) {
    return `Hey ${name} from client`
  }
}

const rpc = createBirpc<ServerFunctions>(
  clientFunctions,
  {
    post: data => ws.send(data),
    on: fn => ws.on('message', fn),
    // these are required when using WebSocket
    serialize: v => JSON.stringify(v),
    deserialize: v => JSON.parse(v),
  },
)

await rpc.hi('Client') // Hi Client from server
```

#### Server

```ts
import type { ClientFunctions } from './types'
import { WebSocketServer } from 'ws'

const serverFunctions: ServerFunctions = {
  hi(name: string) {
    return `Hi ${name} from server`
  }
}

const wss = new WebSocketServer()

wss.on('connection', (ws) => {
  const rpc = createBirpc<ClientFunctions>(
    serverFunctions,
    {
      post: data => ws.send(data),
      on: fn => ws.on('message', fn),
      serialize: v => JSON.stringify(v),
      deserialize: v => JSON.parse(v),
    },
  )

  await rpc.hey('Server') // Hey Server from client
})
```

### Circular References

As `JSON.stringify` does not supporting circular references, we recommend using [`structured-clone-es`](https://github.com/antfu/structured-clone-es) as the serializer when you expect to have circular references.

```ts
import { parse, stringify } from 'structured-clone-es'

const rpc = createBirpc<ServerFunctions>(
  functions,
  {
    post: data => ws.send(data),
    on: fn => ws.on('message', fn),
    // use structured-clone-es as serializer
    serialize: v => stringify(v),
    deserialize: v => parse(v),
  },
)
```

### Using MessageChannel

[MessageChannel](https://developer.mozilla.org/en-US/docs/Web/API/MessageChannel) will automatically serialize the message and support circular references out-of-box.

```ts
export const channel = new MessageChannel()
```

#### Bob

``` ts
import type { AliceFunctions } from './types'
import { channel } from './channel'

const Bob: BobFunctions = {
  hey(name: string) {
    return `Hey ${name}, I am Bob`
  }
}

const rpc = createBirpc<AliceFunctions>(
  Bob,
  {
    post: data => channel.port1.postMessage(data),
    on: fn => channel.port1.on('message', fn),
  },
)

await rpc.hi('Bob') // Hi Bob, I am Alice
```

#### Alice

``` ts
import type { BobFunctions } from './types'
import { channel } from './channel'

const Alice: AliceFunctions = {
  hi(name: string) {
    return `Hi ${name}, I am Alice`
  }
}

const rpc = createBirpc<BobFunctions>(
  Alice,
  {
    post: data => channel.port2.postMessage(data),
    on: fn => channel.port2.on('message', fn),
  },
)

await rpc.hey('Alice') // Hey Alice, I am Bob
```

### Using window and iframes

There are wrapper functions for window and iframes. You can use it to create a birpc instance for window and iframe communication.

```ts
import { createIframeBirpc } from 'birpc'

const instanceId = new URLSearchParams(window.location.search).get('instanceId')

const rpc = createIframeBirpc<ClientFunctions>(
  instanceId,
  serverFunctions,
  {
    targetOrigin: 'https://example.com',
  }
)
```

```ts
import { createWindowBirpc } from 'birpc'

// You need keep only one PostMessageManager instance in window.
const manager = new PostMessageManager()

// Each iframe need a unique instanceId.
const instanceId = '123'
const iframe = document.createElement('iframe')
iframe.src = `https://example.com?instanceId=${instanceId}`
document.body.appendChild(iframe)

const rpc = createWindowBirpc<ServerFunctions>(
  instanceId,
  iframe,
  manager,
  clientFunctions,
  {
    targetOrigin: 'https://example.com',
  }
)
```

**IMPORTANT**: You always pass the `targetOrigin` when using window and iframe birpc, to avoid security issues.

### One-to-multiple Communication

Refer to [./test/group.test.ts](./test/group.test.ts) as an example.

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg">
    <img src='https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg'/>
  </a>
</p>

## License

[MIT](./LICENSE) License © 2021 [Anthony Fu](https://github.com/antfu)
