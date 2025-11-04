import type { Thenable } from '../src'
import { MessageChannel } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { createBirpc } from '../src'
import * as Alice from './alice'
import * as Bob from './bob'

type BobFunctions = typeof Bob
type AliceFunctions = typeof Alice

it('resolver', async () => {
  const channel = new MessageChannel()

  const bob = createBirpc<AliceFunctions, BobFunctions>(
    { ...Bob },
    {
      post: data => channel.port1.postMessage(data),
      on: fn => channel.port1.on('message', fn),
    },
  )

  let customResolverFn: Thenable<((...args: any[]) => any) | undefined> | undefined

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    { ...Alice },
    {
      // mark bob's `bump` as an event without response
      eventNames: ['bump'],
      post: data => channel.port2.postMessage(data),
      on: fn => channel.port2.on('message', fn),
      resolver: (name, fn) => {
        if (name === 'foo')
          return customResolverFn
        return fn
      },
    },
  )

  // RPCs
  expect(await bob.hello('Bob'))
    .toEqual('Hello Bob, my name is Alice')
  expect(await alice.hi('Alice'))
    .toEqual('Hi Alice, I am Bob')

  // @ts-expect-error `foo` is not defined
  await expect(bob.foo('Bob'))
    .rejects
    .toThrow('[birpc] function "foo" not found')

  customResolverFn = Promise.resolve((a: string) => `Custom resolve function to ${a}`)

  // @ts-expect-error `foo` is not defined
  expect(await bob.foo('Bob'))
    .toBe('Custom resolve function to Bob')
})
