/** Small helpers for answering requests. */

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  })
}

/** An error the apps can act on: `error` is a short code, `message` is for a person. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function problem(error: HttpError): Response {
  return json({ error: error.code, message: error.message }, error.status)
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPES[c]!)
}

/** A plain page for the browser, for when a sign-in cannot go back to the app. */
export function page(heading: string, detail: string, status = 200): Response {
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cairn</title>
<body style="font-family:system-ui,sans-serif;background:#1b1b1b;color:#ececec;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box">
<main style="max-width:28rem;text-align:center"><h1 style="font-weight:600">${escape(heading)}</h1><p style="line-height:1.5">${escape(detail)}</p></main>`
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" },
  })
}

export async function readBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new HttpError(400, 'bad_request', 'That request had no readable body.')
  }
}
