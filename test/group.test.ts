import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { createBirpcGroup } from '../src/group'
import { createBirpc } from '../src/main'
import * as Alice from './alice'
import * as Bob from './bob'

type BobFunctions = typeof Bob
type AliceFunctions = typeof Alice

it('group', async () => {
  const channel1 = new MessageChannel()
  const channel2 = new MessageChannel()
  const channel3 = new MessageChannel()

  const client1 = createBirpc<AliceFunctions, BobFunctions>(
    Bob,
    {
      post: data => channel1.port1.postMessage(data),
      on: async (fn) => {
        await new Promise(resolve => setTimeout(resolve, 100))
        channel1.port1.on('message', fn)
      },
      meta: {
        name: 'client1',
      },
    },
  )
  const client2 = createBirpc<AliceFunctions, BobFunctions>(
    Bob,
    {
      post: data => channel2.port1.postMessage(data),
      on: fn => channel2.port1.on('message', fn),
      meta: {
        name: 'client2',
      },
    },
  )
  const client3 = createBirpc<AliceFunctions, BobFunctions>(
    Bob,
    {
      post: data => channel3.port1.postMessage(data),
      on: fn => channel3.port1.on('message', fn),
      meta: {
        name: 'client3',
      },
    },
  )

  const server = createBirpcGroup<BobFunctions, AliceFunctions>(
    Alice,
    [
      {
        post: data => channel1.port2.postMessage(data),
        on: fn => channel1.port2.on('message', fn),
        meta: {
          name: 'channel1',
        },
      },
      {
        post: data => channel2.port2.postMessage(data),
        on: fn => channel2.port2.on('message', fn),
        meta: {
          name: 'channel2',
        },
      },
    ],
    {
      eventNames: ['bump'],
      resolver(name, fn): any {
        if (name === 'hello' && this.$meta?.name === 'channel1')
          return async (name: string) => `${await fn(name)} (from channel1)`
        return fn
      },
    },
  )

  // RPCs
  expect(await client1.hello('Bob'))
    .toEqual('Hello Bob, my name is Alice (from channel1)')
  expect(await client2.hello('Bob'))
    .toEqual('Hello Bob, my name is Alice')
  expect(await server.broadcast.hi('Alice'))
    .toEqual([
      'Hi Alice, I am Bob',
      'Hi Alice, I am Bob',
    ])

  server.updateChannels((channels) => {
    channels.push({
      post: data => channel3.port2.postMessage(data),
      on: fn => channel3.port2.on('message', fn),
    })
  })

  expect(await server.broadcast.hi('Alice'))
    .toEqual([
      'Hi Alice, I am Bob',
      'Hi Alice, I am Bob',
      'Hi Alice, I am Bob',
    ])

  expect(await client3.hello('Bob'))
    .toEqual('Hello Bob, my name is Alice')
})

it('broadcast optional', async () => {
  const channel1 = new MessageChannel()
  const channel2 = new MessageChannel()
  const channel3 = new MessageChannel()

  const client1 = createBirpc<AliceFunctions, BobFunctions>(
    Bob,
    {
      post: data => channel1.port1.postMessage(data),
      on: async (fn) => {
        await new Promise(resolve => setTimeout(resolve, 100))
        channel1.port1.on('message', fn)
      },
    },
  )
  const client2 = createBirpc<AliceFunctions, BobFunctions>(
    {
      ...Bob,
      hi: name => `Hello ${name}, I am another Bob`,
    },
    {
      post: data => channel2.port1.postMessage(data),
      on: fn => channel2.port1.on('message', fn),
    },
  )
  const client3 = createBirpc<AliceFunctions, BobFunctions>(
    {
      ...Bob,
      hi: undefined!,
    },
    {
      post: data => channel3.port1.postMessage(data),
      on: fn => channel3.port1.on('message', fn),
    },
  )

  const server = createBirpcGroup<BobFunctions, AliceFunctions>(
    Alice,
    [
      {
        post: data => channel1.port2.postMessage(data),
        on: fn => channel1.port2.on('message', fn),
      },
      {
        post: data => channel2.port2.postMessage(data),
        on: fn => channel2.port2.on('message', fn),
      },
    ],
    { eventNames: ['bump'] },
  )

  // RPCs
  expect(await client1.hello('Bob'))
    .toEqual('Hello Bob, my name is Alice')
  expect(await client2.hello('Bob'))
    .toEqual('Hello Bob, my name is Alice')
  expect(await server.broadcast.$call('hi', 'Alice'))
    .toEqual([
      'Hi Alice, I am Bob',
      'Hello Alice, I am another Bob',
    ])

  server.updateChannels((channels) => {
    channels.push({
      post: data => channel3.port2.postMessage(data),
      on: fn => channel3.port2.on('message', fn),
    })
  })

  await expect(() => server.broadcast.hi('Alice'))
    .rejects
    .toThrow('[birpc] function "hi" not found')

  await expect(() => server.broadcast.$call('hi', 'Alice'))
    .rejects
    .toThrow('[birpc] function "hi" not found')

  expect(await server.broadcast.$callOptional('hi', 'Alice'))
    .toEqual([
      'Hi Alice, I am Bob',
      'Hello Alice, I am another Bob',
      undefined,
    ])

  expect(await client3.$callOptional('hello', 'Bob'))
    .toEqual('Hello Bob, my name is Alice')

  expect(await server.broadcast.$callEvent('bump'))
    .toEqual([
      undefined,
      undefined,
      undefined,
    ])

  await vi.waitFor(() => expect(Bob.getCount()).toBe(3))
})

it('group without proxify', async () => {
  const channel1 = new MessageChannel()
  const channel2 = new MessageChannel()
  const channel3 = new MessageChannel()

  const client1 = createBirpc<AliceFunctions, BobFunctions, false>(
    Bob,
    {
      post: data => channel1.port1.postMessage(data),
      on: async (fn) => {
        await new Promise(resolve => setTimeout(resolve, 100))
        channel1.port1.on('message', fn)
      },
      meta: {
        name: 'client1',
      },
      proxify: false,
    },
  )
  const client2 = createBirpc<AliceFunctions, BobFunctions, false>(
    Bob,
    {
      post: data => channel2.port1.postMessage(data),
      on: fn => channel2.port1.on('message', fn),
      meta: {
        name: 'client2',
      },
      proxify: false,
    },
  )
  const client3 = createBirpc<AliceFunctions, BobFunctions, false>(
    Bob,
    {
      post: data => channel3.port1.postMessage(data),
      on: fn => channel3.port1.on('message', fn),
      meta: {
        name: 'client3',
      },
      proxify: false,
    },
  )

  const server = createBirpcGroup<BobFunctions, AliceFunctions, false>(
    Alice,
    [
      {
        post: data => channel1.port2.postMessage(data),
        on: fn => channel1.port2.on('message', fn),
        meta: {
          name: 'channel1',
        },
      },
      {
        post: data => channel2.port2.postMessage(data),
        on: fn => channel2.port2.on('message', fn),
        meta: {
          name: 'channel2',
        },
      },
    ],
    {
      eventNames: ['bump'],
      resolver(name, fn): any {
        if (name === 'hello' && this.$meta?.name === 'channel1')
          return async (name: string) => `${await fn(name)} (from channel1)`
        return fn
      },
      proxify: false,
    },
  )

  // RPCs
  expect(await client1.$call('hello', 'Bob'))
    .toEqual('Hello Bob, my name is Alice (from channel1)')
  expect(await client2.$call('hello', 'Bob'))
    .toEqual('Hello Bob, my name is Alice')
  expect(await server.broadcast.$call('hi', 'Alice'))
    .toEqual([
      'Hi Alice, I am Bob',
      'Hi Alice, I am Bob',
    ])

  // @ts-expect-error `hello` is not a function
  expect(() => client1.hello('Bob'))
    .toThrowErrorMatchingInlineSnapshot(`[TypeError: client1.hello is not a function]`)
  // @ts-expect-error `hello` is not a function
  expect(() => client2.hello('Bob'))
    .toThrowErrorMatchingInlineSnapshot(`[TypeError: client2.hello is not a function]`)
  // @ts-expect-error `hi` is not a function
  expect(() => server.broadcast.hi('Alice'))
    .toThrowErrorMatchingInlineSnapshot(`[TypeError: server.broadcast.hi is not a function]`)

  server.updateChannels((channels) => {
    channels.push({
      post: data => channel3.port2.postMessage(data),
      on: fn => channel3.port2.on('message', fn),
    })
  })

  expect(await server.broadcast.$call('hi', 'Alice'))
    .toEqual([
      'Hi Alice, I am Bob',
      'Hi Alice, I am Bob',
      'Hi Alice, I am Bob',
    ])

  expect(await client3.$call('hello', 'Bob'))
    .toEqual('Hello Bob, my name is Alice')
})
