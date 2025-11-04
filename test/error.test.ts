import { MessageChannel } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { createBirpc } from '../src'
import * as Alice from './alice'
import * as Bob from './bob'

type BobFunctions = typeof Bob
type AliceFunctions = typeof Alice

it('on function error', async () => {
  const channel = new MessageChannel()

  let error: any

  const _bob = createBirpc<AliceFunctions, BobFunctions>(
    { ...Bob },
    {
      post: data => channel.port1.postMessage(data),
      on: fn => channel.port1.on('message', fn),
      onFunctionError(err, method, args) {
        error = { err, method, args }
      },
    },
  )

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    { ...Alice },
    {
      // mark bob's `bump` as an event without response
      eventNames: ['bump'],
      post: data => channel.port2.postMessage(data),
      on: fn => channel.port2.on('message', fn),
    },
  )

  try {
    // @ts-expect-error `foo` is not defined
    await alice.foo('Bob')
  }
  catch {
  }

  expect(error).toMatchInlineSnapshot(`
    {
      "args": [
        "Bob",
      ],
      "err": [Error: [birpc] function "foo" not found],
      "method": "foo",
    }
  `)
})

it('on serialize error', async () => {
  const channel = new MessageChannel()

  let error: any

  const _bob = createBirpc<AliceFunctions, BobFunctions>(
    { ...Bob },
    {
      serialize: (d) => {
        if (d.e)
          return d
        throw new Error('Custom serialization error')
      },
      post: data => channel.port1.postMessage(data),
      on: fn => channel.port1.on('message', fn),
      onGeneralError(err, method, args) {
        error = { err, method, args }
        return true
      },
    },
  )

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    { ...Alice },
    {
      // mark bob's `bump` as an event without response
      eventNames: ['bump'],
      post: data => channel.port2.postMessage(data),
      on: fn => channel.port2.on('message', fn),
    },
  )

  try {
    await alice.hi('Bob')
  }
  catch {}

  expect(error).toMatchInlineSnapshot(`
    {
      "args": [
        "Bob",
      ],
      "err": [Error: Custom serialization error],
      "method": "hi",
    }
  `)
})

it('on parse error', async () => {
  const channel = new MessageChannel()

  let error: any

  const _bob = createBirpc<AliceFunctions, BobFunctions>(
    { ...Bob },
    {
      deserialize: () => {
        throw new Error('Custom deserialization error')
      },
      post: data => channel.port1.postMessage(data),
      on: fn => channel.port1.on('message', fn),
      onGeneralError(err, method, args) {
        error = { err, method, args }
        return true
      },
    },
  )

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    { ...Alice },
    {
      // mark bob's `bump` as an event without response
      eventNames: ['bump'],
      post: data => channel.port2.postMessage(data),
      on: fn => channel.port2.on('message', fn),
    },
  )

  try {
    alice.hi('Bob')
  }
  catch {}

  await new Promise(r => setTimeout(r, 10))

  expect(error).toMatchInlineSnapshot(`
    {
      "args": undefined,
      "err": [Error: Custom deserialization error],
      "method": undefined,
    }
  `)
})

it('on async post error', async () => {
  const channel = new MessageChannel()

  let error: any

  const _bob = createBirpc<AliceFunctions, BobFunctions>(
    { ...Bob },
    {
      post: data => channel.port1.postMessage(data),
      on: fn => channel.port1.on('message', fn),
    },
  )

  const alice = createBirpc<BobFunctions, AliceFunctions>(
    { ...Alice },
    {
      // mark bob's `bump` as an event without response
      eventNames: ['bump'],
      async post() {
        await new Promise(r => setTimeout(r, 1))
        throw new Error('Custom async post error')
      },
      on: fn => channel.port2.on('message', fn),
      onGeneralError(err) {
        error = err
      },
    },
  )

  try {
    await alice.hi('Bob')
  }
  catch (e) {
    expect(e).toStrictEqual(error)
    expect(e).toMatchInlineSnapshot(`[Error: Custom async post error]`)
  }

  try {
    await alice.bump()
  }
  catch (e) {
    expect(e).toStrictEqual(error)
    expect(e).toMatchInlineSnapshot(`[Error: Custom async post error]`)
  }
})
