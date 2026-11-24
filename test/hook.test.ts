import type { EventOptions } from '../src'
import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { createBirpc } from '../src/main'
import * as Alice from './alice'
import * as Bob from './bob'

type BobFunctions = typeof Bob
type AliceFunctions = typeof Alice

const mockFn = {
  trigger() {
  },
}

function createChannel(options: {
  onRequest?: EventOptions<BobFunctions, AliceFunctions>['onRequest']
} = {}) {
  const channel = new MessageChannel()
  const {
    onRequest = () => {},
  } = options
  return {
    channel,
    alice: createBirpc<BobFunctions, AliceFunctions>(
      Alice,
      {
        onRequest,
        post: data => channel.port2.postMessage(data),
        on: (fn) => {
          channel.port2.on('message', fn)
        },
      },
    ),
    bob: createBirpc<AliceFunctions, BobFunctions>(
      Bob,
      {
        post: (data) => {
          return channel.port1.postMessage(data)
        },
        on: fn => channel.port1.on('message', (...args) => {
          mockFn.trigger()
          fn(...args)
        }),
      },
    ),
  }
}

it('cache', async () => {
  const spy = vi.spyOn(mockFn, 'trigger')
  const cacheMap = new Map<string, string>()
  const { alice } = createChannel({
    onRequest: async (req, next, send) => {
      const key = `${req.m}-${req.a?.join('-')}`
      if (!cacheMap.has(key)) {
        cacheMap.set(key, await next())
      }
      else {
        send(cacheMap.get(key))
      }
    },
  })
  expect(cacheMap).toMatchInlineSnapshot(`Map {}`)
  expect(await alice.hi('Alice')).toBe('Hi Alice, I am Bob')
  expect(spy).toBeCalledTimes(1)
  expect(await alice.hi('Alice')).toBe('Hi Alice, I am Bob')
  expect(spy).toBeCalledTimes(1)
  expect(await alice.hi('Alex')).toBe('Hi Alex, I am Bob')
  expect(spy).toBeCalledTimes(2)
  expect(await alice.hi('Alex')).toBe('Hi Alex, I am Bob')
  expect(spy).toBeCalledTimes(2)
  expect(await alice.getCount()).toBe(0)
  expect(spy).toBeCalledTimes(3)
  expect(cacheMap).toMatchInlineSnapshot(`
    Map {
      "hi-Alice" => "Hi Alice, I am Bob",
      "hi-Alex" => "Hi Alex, I am Bob",
      "getCount-" => 0,
    }
  `)
})

it('resolves when onRequest does not await next()', async () => {
  const { alice } = createChannel({
    onRequest: (_req, next) => {
      void next()
    },
  })
  expect(await alice.hi('Alice')).toBe('Hi Alice, I am Bob')
})

it('rejects on timeout when onRequest does not await next()', async () => {
  const channel = new MessageChannel()
  // No peer listens on port1, so the call gets no response
  const alice = createBirpc<BobFunctions, AliceFunctions>(
    Alice,
    {
      timeout: 100,
      onRequest: (_req, next) => {
        void next().catch(() => {})
      },
      post: data => channel.port2.postMessage(data),
      on: (fn) => {
        channel.port2.on('message', fn)
      },
    },
  )
  await expect(alice.hi('Alice')).rejects.toThrow('[birpc] timeout on calling "hi"')
  channel.port1.close()
})
