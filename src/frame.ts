import type { BirpcOptions, BirpcReturn } from './main'
import { createBirpc } from './main'

type FunctionHandler = (...args: any[]) => any

export class PostMessageManager {
  private handlers = new Map<string, FunctionHandler>()
  private listener: ((e: MessageEvent) => void) | null = null

  addHandler(instanceId: string, handler: FunctionHandler) {
    this.handlers.set(instanceId, handler)
    if (!this.listener) {
      this.listener = (e: MessageEvent) => {
        const data = e.data
        // check `instanceId` exist in event data
        if (
          data
          && typeof data === 'object'
          && typeof data?.instanceId === 'string'
        ) {
          if (data.instanceId.length > 0) {
            console.error('instanceId must be a non-empty string')
          }
          else {
            const handler = this.handlers.get(data.instanceId)
            if (handler) {
              handler(data, e)
            }
          }
        }
      }
      window.addEventListener('message', this.listener)
    }
  }

  removeHandler(instanceId: string) {
    this.handlers.delete(instanceId)
    if (this.handlers.size === 0 && this.listener) {
      window.removeEventListener('message', this.listener)
      this.listener = null
    }
  }
}

export function createIframeBirpc<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
>(
  instanceId: string,
  $functions: LocalFunctions,
  options: Omit<BirpcOptions<RemoteFunctions, LocalFunctions, Proxify>, 'on' | 'off' | 'post'> & {
    targetOrigin: string
  },
): BirpcReturn<RemoteFunctions, LocalFunctions, Proxify> {
  const manager = new PostMessageManager()
  return createBirpc($functions, {
    ...options,
    off: () => manager.removeHandler(instanceId),
    on: handler => manager.addHandler(instanceId, handler),
    post: (data) => {
      if (window.self !== window.top || window.frameElement) {
        // add `instanceId` to message data
        const messageWithInstance = { ...data, instanceId }
        window?.parent?.postMessage?.(messageWithInstance, options.targetOrigin)
      }
    },
  })
}

export function createWindowBirpc<
  RemoteFunctions extends object = Record<string, unknown>,
  LocalFunctions extends object = Record<string, unknown>,
  Proxify extends boolean = true,
>(
  instanceId: string,
  iframe: HTMLIFrameElement,
  manager: PostMessageManager,
  $functions: LocalFunctions,
  options: Omit<BirpcOptions<RemoteFunctions, LocalFunctions, Proxify>, 'on' | 'off' | 'post'> & {
    targetOrigin: string
  },
): BirpcReturn<RemoteFunctions, LocalFunctions, Proxify> {
  return createBirpc($functions, {
    ...options,
    on: handler => manager.addHandler(instanceId, handler),
    off: () => manager.removeHandler(instanceId),
    post: (data) => {
      // add `instanceId` to message data
      const messageWithInstance = { ...data, instanceId }
      iframe.contentWindow?.postMessage(
        messageWithInstance,
        options.targetOrigin,
      )
    },
  })
}
