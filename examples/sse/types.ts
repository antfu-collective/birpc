// Shared function contracts for both peers, exactly like a normal birpc setup.

export interface ServerFunctions {
  /** A normal request/response call: client -> server. */
  hi: (name: string) => string
  /** An async call to prove Promises flow across the transport. */
  add: (a: number, b: number) => Promise<number>
}

export interface ClientFunctions {
  /**
   * A SERVER-initiated call: the server calls this on the client and awaits
   * the result. This is what proves the transport is truly bidirectional.
   */
  hey: (name: string) => string
}
