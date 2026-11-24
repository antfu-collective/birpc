import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'
import { createBirpc } from '../src/main'
import * as Alice from './alice'
import * as Bob from './bob'

type BobFunctions = typeof Bob
type AliceFunctions = typeof Alice

it('on function error', async () => {
  const channel = new MessageChannel()

  let error: any

  const _bob = createBirpc<AliceFunctions>(
    Bob,
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

  await vi.waitFor(() => expect(error).toBeDefined())

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

/* eslint-disable no-throw-literal, prefer-promise-reject-errors -- these tests throw falsy values on purpose */
it('rejects when a function throws a falsy value', async () => {
  const channel = new MessageChannel()

  const _bob = createBirpc<AliceFunctions>(
    {
      throwUndefined() { throw undefined },
      throwNull() { throw null },
      throwZero() { throw 0 },
      throwEmpty() { throw '' },
      throwFalse() { throw false },
      rejectEmpty() { return Promise.reject() },
    },
    {
      post: data => channel.port1.postMessage(data),
      on: fn => channel.port1.on('message', fn),
    },
  )

  const alice = createBirpc<any, AliceFunctions>(
    { ...Alice },
    {
      post: data => channel.port2.postMessage(data),
      on: fn => channel.port2.on('message', fn),
    },
  )

  await expect(alice.throwUndefined()).rejects.toBe(undefined)
  await expect(alice.throwNull()).rejects.toBe(null)
  await expect(alice.throwZero()).rejects.toBe(0)
  await expect(alice.throwEmpty()).rejects.toBe('')
  await expect(alice.throwFalse()).rejects.toBe(false)
  await expect(alice.rejectEmpty()).rejects.toBe(undefined)
})

it('calls onFunctionError when a function throws a falsy value', async () => {
  const channel = new MessageChannel()
  const onFunctionError = vi.fn()

  const _bob = createBirpc<AliceFunctions>(
    {
      throwUndefined() { throw undefined },
    },
    {
      post: data => channel.port1.postMessage(data),
      on: fn => channel.port1.on('message', fn),
      onFunctionError,
    },
  )

  const alice = createBirpc<any, AliceFunctions>(
    { ...Alice },
    {
      post: data => channel.port2.postMessage(data),
      on: fn => channel.port2.on('message', fn),
    },
  )

  await expect(alice.throwUndefined()).rejects.toBe(undefined)
  expect(onFunctionError).toHaveBeenCalledWith(undefined, 'throwUndefined', [])
})
/* eslint-enable no-throw-literal, prefer-promise-reject-errors */
