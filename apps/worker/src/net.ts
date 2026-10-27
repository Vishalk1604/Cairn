/**
 * Outgoing requests, counted.
 *
 * Cloudflare's free plan allows 50 requests out of one invocation, so each
 * person's check keeps count and spends the allowance in order of what
 * matters: the Firestore writes that make anything visible and the push
 * that announces it are kept back, and reading more mail, more courses or
 * asking the model again is what gives way. Whatever does not fit is left
 * for the next run, ten minutes later.
 */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** A little under the plan's 50, for the odd retry. */
export const SUBREQUEST_LIMIT = 46

export class OutOfRequests extends Error {
  constructor() {
    super('This run has used its allowance of outgoing requests')
    this.name = 'OutOfRequests'
  }
}

export class Net {
  private used = 0

  constructor(
    private readonly base: FetchFn,
    private readonly limit = SUBREQUEST_LIMIT,
  ) {}

  /** Requests still allowed in this invocation. */
  left(): number {
    return this.limit - this.used
  }

  /** Whether `count` more can be spent while keeping `keep` back. */
  can(count: number, keep = 0): boolean {
    return this.left() - count >= keep
  }

  fetch: FetchFn = (input, init) => {
    if (this.used >= this.limit) return Promise.reject(new OutOfRequests())
    this.used++
    return this.base(input, init)
  }
}
