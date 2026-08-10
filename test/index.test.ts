import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { createBirpc } from '../src/main'
import * as Alice from './alice'
import * as Bob from './bob'

type BobFunctions = typeof Bob
type AliceFunctions = typeof Alice

function createChannel() {
  const channel = new MessageChannel()
  return {
    channel,
    alice: createBirpc<BobFunctions, AliceFunctions>(
      Alice,
      {
        // mark bob's `bump` as an event without response
        eventNames: ['bump'],
        post: data => channel.port2.postMessage(data),
        on: fn => channel.port2.on('message', fn),
      },
    ),
    bob: createBirpc<AliceFunctions, BobFunctions>(
      Bob,
      {
        post: data => channel.port1.postMessage(data),
        on: fn => channel.port1.on('message', fn),
      },
    ),
  }
}

it('basic', async () => {
  const { bob, alice } = createChannel()

  // RPCs
  expect(await bob.hello('Bob'))
    .toEqual('Hello Bob, my name is Alice')
  expect(await alice.hi('Alice'))
    .toEqual('Hi Alice, I am Bob')

  // one-way event
  expect(await alice.bump()).toBeUndefined()

  expect(Bob.getCount()).toBe(0)
  await vi.waitFor(() => expect(Bob.getCount()).toBe(1))

  expect(await alice.bumpWithReturn()).toBe(2)
  expect(Bob.getCount()).toBe(2)

  expect(await alice.bumpWithReturn.asEvent()).toBeUndefined()
  await vi.waitFor(() => expect(Bob.getCount()).toBe(3))
})

it('basic without proxify', async () => {
  const channel = new MessageChannel()
  const alice = createBirpc<BobFunctions, AliceFunctions, false>(
    Alice,
    {
      // mark bob's `bump` as an event without response
      eventNames: ['bump'],
      post: data => channel.port2.postMessage(data),
      on: fn => channel.port2.on('message', fn),
      proxify: false,
    },
  )
  const bob = createBirpc<AliceFunctions, BobFunctions, false>(
    Bob,
    {
      post: data => channel.port1.postMessage(data),
      on: fn => channel.port1.on('message', fn),
      proxify: false,
    },
  )

  // RPCs
  // @ts-expect-error `hello` is not a function
  expect(() => bob.hello('Bob'))
    .toThrowErrorMatchingInlineSnapshot(`[TypeError: bob.hello is not a function]`)
  // @ts-expect-error `hi` is not a function
  expect(() => alice.hi('Alice'))
    .toThrowErrorMatchingInlineSnapshot(`[TypeError: alice.hi is not a function]`)

  expect(await bob.$call('hello', 'Bob'))
    .toEqual('Hello Bob, my name is Alice')
})

it('await on birpc should not throw error', async () => {
  const { bob, alice } = createChannel()

  await alice
  await bob
})

it('$call', async () => {
  const { bob, alice } = createChannel()

  // RPCs
  expect(await bob.$call('hello', 'Bob'))
    .toEqual('Hello Bob, my name is Alice')
  expect(await alice.$call('hi', 'Alice'))
    .toEqual('Hi Alice, I am Bob')

  // one-way event
  expect(await alice.$callEvent('bump')).toBeUndefined()

  expect(Bob.getCount()).toBe(3)
  await vi.waitFor(() => expect(Bob.getCount()).toBe(4))
})

it('$callOptional', async () => {
  const { bob } = createChannel()

  // @ts-expect-error `hello2` is not defined
  await expect(async () => await bob.$call('hello2', 'Bob'))
    .rejects
    .toThrow('[birpc] function "hello2" not found')

  // @ts-expect-error `hello2` is not defined
  expect(await bob.$callOptional('hello2', 'Bob'))
    .toEqual(undefined)
})
