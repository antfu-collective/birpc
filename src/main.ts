import type { RpcMessage, RpcRequest, RpcResponse } from './messages'
import type { ArgumentsType, ReturnType, Thenable } from './utils'
import { TYPE_REQUEST, TYPE_RESPONSE } from './messages'
import { createPromiseWithResolvers, nanoid } from './utils'

export type PromisifyFn<T> = ReturnType<T> extends Promise<any>
  ? T
  : (...args: ArgumentsType<T>) => Promise<Awaited<ReturnType<T>>>

export type BirpcResolver<This> = (this: This, name: string, resolved: (...args: unknown[]) => unknown) => Thenable<((...args: any[]) => any) | undefined>

export interface ChannelOptions {
  /**
   * Function to post raw message
   */
  post: (data: any, ...extras: any[]) => Thenable<any>
  /**
   * Listener to receive raw message
   */
  on: (fn: (data: any, ...extras: any[]) => void) => Thenable<any>
  /**
   * Clear the listener when `$close` is called
   */
  off?: (fn: (data: any, ...extras: any[]) => void) => Thenable<any>
  /**
   * Custom function to serialize data
   *
   * by default it passes the data as-is
   */
  serialize?: (data: any) => any
  /**
   * Custom function to deserialize data
   *
   * by default it passes the data as-is
   */
  deserialize?: (data: any) => any

  /**
   * Call the methods with the RPC context or the original functions object
   */
  bind?: 'rpc' | 'functions'

  /**
   * Custom meta data to attached to the RPC instance's `$meta` property
   */
  meta?: any
}

export interface EventOptions<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
> {
  /**
   * Names of remote functions that do not need response.
   */
  eventNames?: (keyof RemoteFunctions)[]

  /**
   * Maximum timeout for waiting for response, in milliseconds.
   *
   * @default 60_000
   */
  timeout?: number

  /**
   * Whether to proxy the remote functions.
   *
   * When `proxify` is false, calling the remote function
   * with `rpc.$call('method', ...args)` instead of `rpc.method(...args)`
   * explicitly is required.
   *
   * @default true
   */
  proxify?: Proxify

  /**
   * Custom resolver to resolve function to be called
   *
   * For advanced use cases only
   */
  resolver?: BirpcResolver<BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>>

  /**
   * Hook triggered before an event is sent to the remote
   *
   * @param req - Request parameters
   * @param next - Function to continue the request
   * @param resolve - Function to resolve the response directly
   */
  onRequest?: (this: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>, req: RpcRequest, next: (req?: RpcRequest) => Promise<any>, resolve: (res: any) => void) => void | Promise<void>

  /**
   * Custom error handler for errors occurred in local functions being called
   *
   * @returns `true` to prevent the error from being thrown
   */
  onFunctionError?: (this: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>, error: Error, functionName: string, args: any[]) => boolean | void

  /**
   * Custom error handler for errors occurred during serialization or messsaging
   *
   * @returns `true` to prevent the error from being thrown
   */
  onGeneralError?: (this: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>, error: Error, functionName?: string, args?: any[]) => boolean | void

  /**
   * Custom error handler for timeouts
   *
   * @returns `true` to prevent the error from being thrown
   */
  onTimeoutError?: (this: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>, functionName: string, args: any[]) => boolean | void
}

export type BirpcOptions<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
> = EventOptions<RemoteFunctions, LocalFunctions, Proxify> & ChannelOptions

export type BirpcFn<T> = PromisifyFn<T> & {
  /**
   * Send event without asking for response
   */
  asEvent: (...args: ArgumentsType<T>) => Promise<void>
}

export interface BirpcReturnBuiltin<
  RemoteFunctions,
  LocalFunctions = Record<string, unknown>,
> {
  /**
   * Raw functions object
   */
  $functions: LocalFunctions
  /**
   * Whether the RPC is closed
   */
  readonly $closed: boolean
  /**
   * Custom meta data attached to the RPC instance
   */
  readonly $meta: any
  /**
   * Close the RPC connection
   */
  $close: (error?: Error) => void
  /**
   * Reject pending calls
   */
  $rejectPendingCalls: (handler?: PendingCallHandler) => Promise<void>[]
  /**
   * Call the remote function and wait for the result.
   * An alternative to directly calling the function
   */
  $call: <K extends keyof RemoteFunctions>(method: K, ...args: ArgumentsType<RemoteFunctions[K]>) => Promise<Awaited<ReturnType<RemoteFunctions[K]>>>
  /**
   * Same as `$call`, but returns `undefined` if the function is not defined on the remote side.
   */
  $callOptional: <K extends keyof RemoteFunctions>(method: K, ...args: ArgumentsType<RemoteFunctions[K]>) => Promise<Awaited<ReturnType<RemoteFunctions[K]> | undefined>>
  /**
   * Send event without asking for response
   */
  $callEvent: <K extends keyof RemoteFunctions>(method: K, ...args: ArgumentsType<RemoteFunctions[K]>) => Promise<void>
  /**
   * Call the remote function with the raw options.
   */
  $callRaw: (options: { method: string, args: unknown[], event?: boolean, optional?: boolean }) => Promise<Awaited<ReturnType<any>>[]>
}

export type ProxifiedRemoteFunctions<RemoteFunctions extends object = Record<string, unknown>> = { [K in keyof RemoteFunctions]: BirpcFn<RemoteFunctions[K]> }

export type BirpcReturn<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
> = Proxify extends true
  ? ProxifiedRemoteFunctions<RemoteFunctions> & BirpcReturnBuiltin<RemoteFunctions, LocalFunctions>
  : BirpcReturnBuiltin<RemoteFunctions, LocalFunctions>

export interface CallRawOptions {
  method: string
  args: unknown[]
  event?: boolean
  optional?: boolean
}

export type PendingCallHandler = (options: Pick<PromiseEntry, 'method' | 'reject'>) => void | Promise<void>

interface PromiseEntry {
  resolve: (arg: any) => void
  reject: (error: any) => void
  method: string
  timeoutId?: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT = 60_000 // 1 minute

const defaultSerialize = (i: any) => i
const defaultDeserialize = defaultSerialize

// Store public APIs locally in case they are overridden later
const { clearTimeout, setTimeout } = globalThis

export function createBirpc<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
>(
  $functions: LocalFunctions,
  options: BirpcOptions<RemoteFunctions, LocalFunctions, Proxify>,
): BirpcReturn<RemoteFunctions, LocalFunctions, Proxify> {
  const {
    post,
    on,
    off = () => { },
    eventNames = [],
    serialize = defaultSerialize,
    deserialize = defaultDeserialize,
    resolver,
    bind = 'rpc',
    timeout = DEFAULT_TIMEOUT,
    proxify = true,
  } = options

  let $closed = false

  const _rpcPromiseMap = new Map<string, PromiseEntry>()
  let _promiseInit: Promise<any> | any
  let rpc: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>

  async function _call(
    method: string,
    args: unknown[],
    event?: boolean,
    optional?: boolean,
  ) {
    if ($closed)
      throw new Error(`[birpc] rpc is closed, cannot call "${method}"`)

    const req: RpcRequest = { m: method, a: args, t: TYPE_REQUEST }
    if (optional)
      req.o = true

    const send = async (_req: RpcRequest) => post(serialize(_req))
    if (event) {
      await send(req)
      return
    }

    if (_promiseInit) {
      // Wait if `on` is promise
      try {
        await _promiseInit
      }
      finally {
        // don't keep resolved promise hanging
        _promiseInit = undefined
      }
    }

    // eslint-disable-next-line prefer-const
    let { promise, resolve, reject } = createPromiseWithResolvers<any>()

    const id = nanoid()
    req.i = id
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    async function handler(newReq: RpcRequest = req) {
      if (timeout >= 0) {
        timeoutId = setTimeout(() => {
          try {
            // Custom onTimeoutError handler can throw its own error too
            const handleResult = options.onTimeoutError?.call(rpc, method, args)
            if (handleResult !== true)
              throw new Error(`[birpc] timeout on calling "${method}"`)
          }
          catch (e) {
            reject(e)
          }
          _rpcPromiseMap.delete(id)
        }, timeout)

        // For node.js, `unref` is not available in browser-like environments
        if (typeof timeoutId === 'object')
          timeoutId = timeoutId.unref?.()
      }

      _rpcPromiseMap.set(id, { resolve, reject, timeoutId, method })
      await send(newReq)
      return promise
    }

    try {
      if (options.onRequest)
        await options.onRequest.call(rpc, req, handler, resolve)

      else
        await handler()
    }
    catch (e) {
      if (options.onGeneralError?.call(rpc, e as Error) !== true)
        throw e
      return
    }
    finally {
      clearTimeout(timeoutId)
      _rpcPromiseMap.delete(id)
    }

    return promise
  }

  const builtinMethods = {
    $call: (method: string, ...args: unknown[]) => _call(method, args, false),
    $callOptional: (method: string, ...args: unknown[]) => _call(method, args, false, true),
    $callEvent: (method: string, ...args: unknown[]) => _call(method, args, true),
    $callRaw: (options: CallRawOptions) => _call(options.method, options.args, options.event, options.optional),
    $rejectPendingCalls,
    get $closed() {
      return $closed
    },
    get $meta() {
      return options.meta
    },
    $close,
    $functions,
  } as BirpcReturnBuiltin<RemoteFunctions, LocalFunctions>

  if (proxify) {
    rpc = new Proxy({}, {
      get(_, method: string) {
        if (Object.hasOwn(builtinMethods, method))
          return (builtinMethods as any)[method]

        // catch if "createBirpc" is returned from async function
        if (method === 'then' && !eventNames.includes('then' as any) && !('then' in $functions))
          return undefined

        const sendEvent = (...args: any[]) => _call(method, args, true)
        if (eventNames.includes(method as any)) {
          sendEvent.asEvent = sendEvent
          return sendEvent
        }
        const sendCall = (...args: any[]) => _call(method, args, false)
        sendCall.asEvent = sendEvent
        return sendCall
      },
    }) as BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>
  }
  else {
    rpc = builtinMethods as BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>
  }

  function $close(customError?: Error) {
    $closed = true
    _rpcPromiseMap.forEach(({ reject, method }) => {
      const error = new Error(`[birpc] rpc is closed, cannot call "${method}"`)

      if (customError) {
        customError.cause ??= error
        return reject(customError)
      }

      reject(error)
    })
    _rpcPromiseMap.clear()
    off(onMessage)
  }

  function $rejectPendingCalls(handler?: PendingCallHandler) {
    const entries = Array.from(_rpcPromiseMap.values())

    const handlerResults = entries.map(({ method, reject }) => {
      if (!handler) {
        return reject(new Error(`[birpc]: rejected pending call "${method}".`))
      }

      return handler({ method, reject })
    })

    _rpcPromiseMap.clear()

    return handlerResults
  }

  async function onMessage(data: any, ...extra: any[]) {
    let msg: RpcMessage

    try {
      msg = deserialize(data) as RpcMessage
    }
    catch (e) {
      if (options.onGeneralError?.call(rpc, e as Error) !== true)
        throw e
      return
    }

    if (msg.t === TYPE_REQUEST) {
      const { m: method, a: args, o: optional } = msg
      let result, error: any
      let fn = await (resolver
        ? resolver.call(rpc, method, ($functions as any)[method])
        : ($functions as any)[method])

      if (optional)
        fn ||= () => undefined

      if (!fn) {
        error = new Error(`[birpc] function "${method}" not found`)
      }
      else {
        try {
          result = await fn.apply(bind === 'rpc' ? rpc : $functions, args)
        }
        catch (e) {
          error = e
        }
      }

      if (msg.i) {
        if (error && options.onFunctionError) {
          if (options.onFunctionError.call(rpc, error, method, args) === true)
            return
        }

        // Send data
        if (!error) {
          try {
            await post(serialize(<RpcResponse>{ t: TYPE_RESPONSE, i: msg.i, r: result }), ...extra)
            return
          }
          catch (e) {
            error = e
            if (options.onGeneralError?.call(rpc, e as Error, method, args) !== true)
              throw e
          }
        }
        // Try to send error if serialization failed
        try {
          await post(serialize(<RpcResponse>{ t: TYPE_RESPONSE, i: msg.i, e: error }), ...extra)
        }
        catch (e) {
          if (options.onGeneralError?.call(rpc, e as Error, method, args) !== true)
            throw e
        }
      }
    }
    else {
      const { i: ack, r: result, e: error } = msg
      const promise = _rpcPromiseMap.get(ack)
      if (promise) {
        clearTimeout(promise.timeoutId)

        if (error)
          promise.reject(error)

        else
          promise.resolve(result)
      }
      _rpcPromiseMap.delete(ack)
    }
  }

  _promiseInit = on(onMessage)

  return rpc
}
