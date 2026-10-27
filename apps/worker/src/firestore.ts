import type { FetchFn } from './net'

/**
 * Firestore's REST API, as the person themselves: every call carries their
 * Firebase ID token, so the security rules that guard their data from
 * everyone else guard it from the Worker too. Only the handful of calls the
 * Worker makes are here.
 */

type Value =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { arrayValue: { values?: Value[] } }
  | { mapValue: { fields?: Record<string, Value> } }
  | { timestampValue: string }

export type Fields = Record<string, Value>

/** Undefined is left out, as the apps' SDK would refuse it. */
export function encode(value: unknown): Value {
  if (value === null) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.filter((v) => v !== undefined).map(encode) } }
  if (typeof value === 'object') return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } }
  throw new Error(`Firestore cannot store a ${typeof value}`)
}

export function encodeFields(object: Record<string, unknown>): Fields {
  const fields: Fields = {}
  for (const [key, value] of Object.entries(object)) if (value !== undefined) fields[key] = encode(value)
  return fields
}

export function decode(value: Value): unknown {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return value.booleanValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return value.doubleValue
  if ('stringValue' in value) return value.stringValue
  if ('timestampValue' in value) return Date.parse(value.timestampValue)
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {})
  return null
}

export function decodeFields(fields: Fields): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) out[key] = decode(value)
  return out
}

/** One change in a batch: a whole document, some of its fields, or its removal. */
export type Write =
  | {
      kind: 'set'
      path: string
      data: object
      /** Only these fields are written; any of them missing from `data` is removed. Absent, the document is replaced. */
      mask?: string[]
      /** Only if it exists already (true), or only if it does not (false). */
      exists?: boolean
    }
  | { kind: 'delete'; path: string }

export class FirestoreError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'FirestoreError'
  }
}

export class Firestore {
  private readonly root: string

  constructor(
    readonly project: string,
    private readonly idToken: string,
    private readonly fetchFn: FetchFn,
  ) {
    this.root = `projects/${project}/databases/(default)/documents`
  }

  private name(path: string): string {
    return `${this.root}/${path}`
  }

  private async call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetchFn(`https://firestore.googleapis.com/v1/${url}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.idToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
      throw new FirestoreError(response.status, `Firestore refused the request (${response.status}): ${body.error?.message ?? ''}`)
    }
    return (await response.json()) as T
  }

  /** A document's fields, or null when there is none. */
  async get(path: string): Promise<Record<string, unknown> | null> {
    try {
      const doc = await this.call<{ fields?: Fields }>(this.name(path))
      return decodeFields(doc.fields ?? {})
    } catch (error) {
      if (error instanceof FirestoreError && error.status === 404) return null
      throw error
    }
  }

  /** Several documents in one request, by path; missing ones are absent from the map. */
  async getAll(paths: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>()
    if (paths.length === 0) return out
    const results = await this.call<{ found?: { name: string; fields?: Fields } }[]>(`${this.root}:batchGet`, {
      method: 'POST',
      body: JSON.stringify({ documents: paths.map((p) => this.name(p)) }),
    })
    for (const result of results) {
      if (result.found) out.set(result.found.name.slice(this.root.length + 1), decodeFields(result.found.fields ?? {}))
    }
    return out
  }

  /** Documents in one collection under `parent` with a number field in [from, to). */
  async range(parent: string, collection: string, field: string, from: number, to: number, limit = 200): Promise<Record<string, unknown>[]> {
    const results = await this.call<{ document?: { fields?: Fields } }[]>(`${this.name(parent)}:runQuery`, {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: {
            compositeFilter: {
              op: 'AND',
              filters: [
                { fieldFilter: { field: { fieldPath: field }, op: 'GREATER_THAN_OR_EQUAL', value: encode(from) } },
                { fieldFilter: { field: { fieldPath: field }, op: 'LESS_THAN', value: encode(to) } },
              ],
            },
          },
          limit,
        },
      }),
    })
    return results.filter((r) => r.document).map((r) => decodeFields(r.document!.fields ?? {}))
  }

  /**
   * Applies writes independently: one refused (a precondition, a rule) does
   * not stop the others. Says which went through, in order.
   */
  async write(writes: readonly Write[]): Promise<boolean[]> {
    const out: boolean[] = []
    // batchWrite takes at most 500 at a time.
    for (let i = 0; i < writes.length; i += 400) {
      const chunk = writes.slice(i, i + 400)
      const result = await this.call<{ status?: { code?: number; message?: string }[] }>(`${this.root}:batchWrite`, {
        method: 'POST',
        body: JSON.stringify({ writes: chunk.map((w) => this.wire(w)) }),
      })
      chunk.forEach((_, k) => out.push(!result.status?.[k]?.code))
    }
    return out
  }

  private wire(write: Write): unknown {
    if (write.kind === 'delete') return { delete: this.name(write.path) }
    return {
      update: { name: this.name(write.path), fields: encodeFields(write.data as Record<string, unknown>) },
      ...(write.mask ? { updateMask: { fieldPaths: write.mask } } : {}),
      ...(write.exists !== undefined ? { currentDocument: { exists: write.exists } } : {}),
    }
  }
}
