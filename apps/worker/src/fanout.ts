import { sign, verifySignature } from './crypto'
import type { Env } from './env'
import type { FetchFn } from './net'

/**
 * How one cron tick reaches everyone.
 *
 * On the free plan an invocation gets 10 ms of CPU, 50 requests out and six
 * open connections at once, and a person's check holds its connection for
 * as long as the model takes to answer. So the cron does no checking itself:
 * it splits everyone into six groups and asks this same Worker, over its
 * public address, to handle each group; a group of six or fewer is checked
 * one person per request. Every request is an invocation with its own
 * allowance, and a hundred people are three levels deep.
 */
export const FAN_WIDTH = 6
const HEADER = 'X-Cairn-Internal'

/** Proof that a request came from this Worker: a MAC under its own key. */
async function pass(env: Env): Promise<string> {
  return sign(env, 'internal-fan-out')
}

export async function fromSelf(request: Request, env: Env): Promise<boolean> {
  const given = request.headers.get(HEADER)
  return !!given && (await verifySignature(env, 'internal-fan-out', given))
}

/** Splits `items` into at most `parts` groups of near-equal size, in order. */
export function split<T>(items: readonly T[], parts: number): T[][] {
  const size = Math.ceil(items.length / parts)
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** Checks everyone in `uids`, through as many requests to itself as it takes. Waits for all of them. */
export async function fanOut(env: Env, uids: readonly string[], fetchFn: FetchFn): Promise<void> {
  if (uids.length === 0) return
  const base = env.PUBLIC_URL.replace(/\/+$/, '')
  const headers = { 'Content-Type': 'application/json', [HEADER]: await pass(env) }
  const calls =
    uids.length <= FAN_WIDTH
      ? uids.map((uid) => fetchFn(`${base}/internal/run`, { method: 'POST', headers, body: JSON.stringify({ uid }) }))
      : split(uids, FAN_WIDTH).map((group) => fetchFn(`${base}/internal/fan`, { method: 'POST', headers, body: JSON.stringify({ uids: group }) }))
  const settled = await Promise.allSettled(
    calls.map(async (call) => {
      const response = await call
      // Read to the end, so the connection is free for the next.
      await response.text()
      if (!response.ok) throw new Error(`A check answered ${response.status}`)
    }),
  )
  for (const result of settled) if (result.status === 'rejected') console.warn('Fan-out', result.reason)
}
