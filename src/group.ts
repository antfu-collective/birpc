import type { BirpcReturn, CallRawOptions, ChannelOptions, EventOptions, ProxifiedRemoteFunctions } from './main'
import type { ArgumentsType, ReturnType } from './utils'
import { createBirpc } from './main'
import { cachedMap } from './utils'

export interface BirpcGroupReturnBuiltin<RemoteFunctions> {
  /**
   * Call the remote function and wait for the result.
   * An alternative to directly calling the function
   */
  $call: <K extends keyof RemoteFunctions>(method: K, ...args: ArgumentsType<RemoteFunctions[K]>) => Promise<Awaited<ReturnType<RemoteFunctions[K]>>[]>
  /**
   * Same as `$call`, but returns `undefined` if the function is not defined on the remote side.
   */
  $callOptional: <K extends keyof RemoteFunctions>(method: K, ...args: ArgumentsType<RemoteFunctions[K]>) => Promise<(Awaited<ReturnType<RemoteFunctions[K]>> | undefined)[]>
  /**
   * Send event without asking for response
   */
  $callEvent: <K extends keyof RemoteFunctions>(method: K, ...args: ArgumentsType<RemoteFunctions[K]>) => Promise<void>
  /**
   * Call the remote function with the raw options.
   */
  $callRaw: (options: { method: string, args: unknown[], event?: boolean, optional?: boolean }) => Promise<Awaited<ReturnType<any>>[]>
}

export interface BirpcGroupFn<T> {
  /**
   * Call the remote function and wait for the result.
   */
  (...args: ArgumentsType<T>): Promise<Awaited<ReturnType<T>>[]>
  /**
   * Send event without asking for response
   */
  asEvent: (...args: ArgumentsType<T>) => Promise<void>
}

export type BirpcGroupReturn<
  RemoteFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
> = Proxify extends true
  ? ProxifiedRemoteFunctions<RemoteFunctions> & BirpcGroupReturnBuiltin<RemoteFunctions>
  : BirpcGroupReturnBuiltin<RemoteFunctions>

export interface BirpcGroup<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
> {
  readonly clients: BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>[]
  readonly functions: LocalFunctions
  readonly broadcast: BirpcGroupReturn<RemoteFunctions, Proxify>
  updateChannels: (fn?: ((channels: ChannelOptions[]) => void)) => BirpcReturn<RemoteFunctions, LocalFunctions, Proxify>[]
}

export function createBirpcGroup<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
>(
  functions: LocalFunctions,
  channels: ChannelOptions[] | (() => ChannelOptions[]),
  options: EventOptions<RemoteFunctions, LocalFunctions, Proxify> = {},
): BirpcGroup<RemoteFunctions, LocalFunctions, Proxify> {
  const { proxify = true } = options
  const getChannels = () => typeof channels === 'function' ? channels() : channels
  const getClients = (channels = getChannels()) => cachedMap(channels, s => createBirpc(functions, { ...options, ...s }))

  function _boardcast(options: CallRawOptions) {
    const clients = getClients()
    return Promise.all(clients.map(c => c.$callRaw(options)))
  }

  const broadcastBuiltin = {
    $call: (method: string, ...args: unknown[]) => _boardcast({ method, args, event: false }),
    $callOptional: (method: string, ...args: unknown[]) => _boardcast({ method, args, event: false, optional: true }),
    $callEvent: (method: string, ...args: unknown[]) => _boardcast({ method, args, event: true }),
    $callRaw: (options: CallRawOptions) => _boardcast(options),
  } as unknown as BirpcGroupReturnBuiltin<RemoteFunctions>

  const broadcastProxy = proxify
    ? new Proxy({}, {
      get(_, method) {
        if (Object.hasOwn(broadcastBuiltin, method))
          return (broadcastBuiltin as any)[method]

        const client = getClients()
        const callbacks = client.map(c => (c as any)[method])
        const sendCall = (...args: any[]) => {
          return Promise.all(callbacks.map(i => i(...args)))
        }
        sendCall.asEvent = async (...args: any[]) => {
          await Promise.all(callbacks.map(i => i.asEvent(...args)))
        }
        return sendCall
      },
    }) as BirpcGroupReturn<RemoteFunctions, Proxify>
    : broadcastBuiltin as BirpcGroupReturn<RemoteFunctions, Proxify>

  function updateChannels(fn?: ((channels: ChannelOptions[]) => void)) {
    const channels = getChannels()
    fn?.(channels)
    return getClients(channels)
  }

  getClients()

  return {
    get clients() {
      return getClients()
    },
    functions,
    updateChannels,
    broadcast: broadcastProxy,
  }
}
