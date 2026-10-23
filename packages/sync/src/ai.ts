import { readTriage, triagePrompt, type MailMessage, type MailTriage, type TriageContext } from '@cairn/core'

/**
 * Reading mail with a language model, through NVIDIA's hosted API, which
 * speaks both of OpenAI's formats: chat completions and the newer responses.
 * The key is the person's own and is passed in on every call: it lives in
 * the phone's secure storage, never in the app or the repository.
 */

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'

/** Which of OpenAI's request formats a model is asked in. */
export type AiApi = 'chat' | 'responses'

export interface AiModel {
  id: string
  label: string
  /** Chat completions unless said otherwise. */
  api?: AiApi
  /** Fields that keep thinking short: a JSON label does not need an essay first. */
  extra?: Record<string, unknown>
  /**
   * Generous on purpose. NVIDIA's free tier queues requests, and an answer
   * that takes seconds to write can wait a minute or two to start.
   */
  timeoutMs: number
}

const GPT_OSS: AiModel = {
  id: 'openai/gpt-oss-20b',
  label: 'GPT-OSS 20B',
  api: 'responses',
  extra: { reasoning: { effort: 'low' } },
  timeoutMs: 180_000,
}
const NEMOTRON: AiModel = {
  id: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  label: 'Nemotron 3.5 Lightning',
  extra: { chat_template_kwargs: { enable_thinking: false } },
  timeoutMs: 120_000,
}
const DEEPSEEK: AiModel = {
  id: 'deepseek-ai/deepseek-v4.1-flash',
  label: 'DeepSeek V4.1 Flash',
  extra: { chat_template_kwargs: { thinking: false } },
  timeoutMs: 120_000,
}

/**
 * Tried in order. GPT-OSS follows the JSON it is asked for closely;
 * Nemotron Lightning is there for when it is busy.
 */
export const AI_MODELS: readonly AiModel[] = [GPT_OSS, NEMOTRON]

/** Models Cairn knows how to ask, should someone paste the code for one. */
const KNOWN_MODELS: readonly AiModel[] = [GPT_OSS, NEMOTRON, DEEPSEEK]

/**
 * Someone's AI access, as read from what they pasted. NVIDIA's model pages
 * hand out a code sample — Python, Node or a curl command — with the key
 * written into it, rather than a bare key, so the whole sample is accepted
 * and the key, the model and the address are read out of it.
 */
export interface AiSetup {
  key: string
  /** The model the pasted code asked for; tried before the built-in ones. */
  model?: string
  /** Only ever an nvidia.com address: mail is not sent anywhere else by a stray paste. */
  baseUrl?: string
  /** The request format the pasted code used, for a model Cairn does not know. */
  api?: AiApi
}

export type AiSetupResult = { ok: true; setup: AiSetup } | { ok: false; error: string }

const KEY_PATTERN = /nvapi-[A-Za-z0-9_-]{20,}/
/** `model="…"` (Python), `model: "…"` (Node) and `"model": "…"` (curl's JSON). */
const MODEL_PATTERN = /(?:^|[^A-Za-z0-9_])["']?model["']?\s*[:=]\s*["']([A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+)["']/
const BASE_PATTERN = /https:\/\/[A-Za-z0-9.-]+\.nvidia\.com(?::\d+)?\/v\d+/

export function readAiSetup(pasted: string): AiSetupResult {
  const text = pasted.trim()
  if (!text) return { ok: false, error: 'Paste the code from NVIDIA, or just the key.' }
  const key = KEY_PATTERN.exec(text)?.[0]
  if (!key) {
    return {
      ok: false,
      // NVIDIA's Python and Node samples read the key from a setting named
      // NVIDIA_API_KEY rather than holding it, so pasting one of those finds
      // nothing; only the key itself, or the curl sample, carries it.
      error: /NVIDIA_API_KEY|API_KEY_REQUIRED|\$API_KEY|os\.environ|process\.env/i.test(text)
        ? 'The key isn’t in this code — it only names a setting, NVIDIA_API_KEY. On the NVIDIA page, press "Get API Key" and copy the key it shows (it starts with nvapi-), or copy the Shell code instead.'
        : "Couldn't find a key in that. NVIDIA keys start with nvapi-.",
    }
  }
  const model = MODEL_PATTERN.exec(text)?.[1]
  const baseUrl = BASE_PATTERN.exec(text)?.[0]
  const responses = /responses\.create|\/v\d+\/responses\b/.test(text)
  return {
    ok: true,
    setup: {
      key,
      ...(model ? { model } : {}),
      ...(baseUrl && baseUrl !== NVIDIA_BASE_URL ? { baseUrl } : {}),
      ...(responses ? { api: 'responses' as const } : {}),
    },
  }
}

/** For the secure store. An older install kept the bare key, which still reads. */
export function storedAiSetup(raw: string | null): AiSetup | null {
  if (!raw) return null
  if (!raw.startsWith('{')) return raw.trim() ? { key: raw.trim() } : null
  try {
    const parsed = JSON.parse(raw) as Partial<AiSetup>
    if (typeof parsed.key !== 'string' || !parsed.key) return null
    return {
      key: parsed.key,
      ...(typeof parsed.model === 'string' ? { model: parsed.model } : {}),
      ...(typeof parsed.baseUrl === 'string' && BASE_PATTERN.test(parsed.baseUrl) ? { baseUrl: parsed.baseUrl } : {}),
      ...(parsed.api === 'responses' || parsed.api === 'chat' ? { api: parsed.api } : {}),
    }
  } catch {
    return null
  }
}

/** "deepseek-ai/deepseek-v4.1-flash" → "Deepseek V4.1 Flash", for a model Cairn has no name for. */
function labelOf(id: string): string {
  const name = id.slice(id.indexOf('/') + 1)
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * The pasted model first, then the built-in ones as fallbacks: one NVIDIA
 * key works for every model in their catalogue.
 */
export function modelsFor(setup: AiSetup): AiModel[] {
  if (!setup.model) return [...AI_MODELS]
  const known = KNOWN_MODELS.find((m) => m.id === setup.model)
  // A model Cairn does not know is asked in the format its code used, and
  // asked not to think at length: under both names in use for a chat
  // template, which ignores the one it does not have.
  const first: AiModel = known ?? {
    id: setup.model,
    label: labelOf(setup.model),
    api: setup.api ?? 'chat',
    extra: setup.api === 'responses' ? { reasoning: { effort: 'low' } } : { chat_template_kwargs: { thinking: false, enable_thinking: false } },
    timeoutMs: 180_000,
  }
  return [first, ...AI_MODELS.filter((m) => m.id !== setup.model)]
}

/** A bare key is short for a setup with nothing else in it. */
function setupOf(access: AiSetup | string): AiSetup {
  return typeof access === 'string' ? { key: access } : access
}

/** A model that failed sits out this long, so one that is down does not slow every email. */
const REST_MS = 15 * 60 * 1000

export type AiFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: unknown },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class AiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AiError'
  }

  /** The key itself is wrong; no other model will do better. */
  get badKey(): boolean {
    return this.status === 401 || this.status === 403
  }

  get rateLimited(): boolean {
    return this.status === 429
  }
}

export interface AiOptions {
  fetchFn?: AiFetch
  models?: readonly AiModel[]
  baseUrl?: string
  now?: () => number
}

const resting = new Map<string, number>()

/** Timers, typed structurally like fetch: this package takes no runtime's type library. */
const timers = globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown; clearTimeout(id: unknown): void }

/** For tests: every model available again. */
export function resetAiModels(): void {
  resting.clear()
}

function defaultFetch(): AiFetch {
  const found = (globalThis as { fetch?: AiFetch }).fetch
  if (!found) throw new Error('This runtime has no fetch; pass one of your own')
  return found
}

async function once(setup: AiSetup, model: AiModel, messages: { role: string; content: string }[], options: AiOptions): Promise<string> {
  const fetchFn = options.fetchFn ?? defaultFetch()
  const Abort = (globalThis as { AbortController?: new () => { signal: unknown; abort(): void } }).AbortController
  const controller = Abort ? new Abort() : undefined
  let timer: unknown
  const timeout = new Promise<never>((_, reject) => {
    timer = timers.setTimeout(() => {
      controller?.abort()
      reject(new AiError(0, `${model.label} did not answer in time`))
    }, model.timeoutMs)
  })
  try {
    const responses = model.api === 'responses'
    const base = options.baseUrl ?? setup.baseUrl ?? NVIDIA_BASE_URL
    // The responses format takes the same messages as its input. Its own
    // `instructions` field is not honoured by NVIDIA's endpoint, so the
    // system message travels in the input instead. Its token limit includes
    // the model's reasoning, hence more room than the chat format's.
    const payload = responses
      ? { model: model.id, input: messages, temperature: 0.2, top_p: 0.9, max_output_tokens: 1500, stream: false, ...model.extra }
      : { model: model.id, messages, temperature: 0.2, top_p: 0.9, max_tokens: 600, stream: false, ...model.extra }
    const request = fetchFn(`${base}/${responses ? 'responses' : 'chat/completions'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${setup.key}` },
      body: JSON.stringify(payload),
      signal: controller?.signal,
    })
    const response = await Promise.race([request, timeout])
    const body = (await Promise.race([response.json(), timeout])) as AnswerBody
    if (!response.ok) {
      const detail = typeof body?.error === 'string' ? body.error : (body?.error?.message ?? body?.detail)
      if (response.status === 401 || response.status === 403) throw new AiError(response.status, 'NVIDIA did not accept the API key. Check it in Settings.')
      if (response.status === 429) throw new AiError(429, 'NVIDIA asked Cairn to slow down; it will carry on in a few minutes.')
      throw new AiError(response.status, `${model.label} refused the request (${response.status})${detail ? `: ${detail}` : ''}`)
    }
    const content = responses ? outputText(body) : body?.choices?.[0]?.message?.content
    if (!content) throw new AiError(0, `${model.label} sent back an empty answer`)
    return content
  } finally {
    timers.clearTimeout(timer)
  }
}

interface AnswerBody {
  /** Chat completions. */
  choices?: { message?: { content?: string | null } }[]
  /** Responses: the reasoning first, then the message with the answer. */
  output?: { type?: string; content?: { type?: string; text?: string }[] | null }[]
  detail?: string
  error?: { message?: string } | string
}

/** The answer in a responses-format reply, leaving out the model's reasoning. */
function outputText(body: AnswerBody | undefined): string {
  return (body?.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && part.text)
    .map((part) => part.text)
    .join('')
}

/**
 * Asks the first model that is not resting, falling through to the next
 * when one fails or does not answer. A rejected key stops at once, since it
 * is the same key for every model.
 */
export async function chat(
  access: AiSetup | string,
  messages: { role: 'system' | 'user'; content: string }[],
  options: AiOptions = {},
): Promise<{ content: string; model: AiModel }> {
  const setup = setupOf(access)
  const now = options.now ?? Date.now
  const models = options.models ?? modelsFor(setup)
  const awake = models.filter((m) => (resting.get(m.id) ?? 0) <= now())
  // Everything resting is no reason to give up: try them all again.
  const order = awake.length ? awake : models
  let last: unknown = new AiError(0, 'No model to ask')
  for (const model of order) {
    try {
      const content = await once(setup, model, messages, options)
      resting.delete(model.id)
      return { content, model }
    } catch (error) {
      if (error instanceof AiError && error.badKey) throw error
      resting.set(model.id, now() + REST_MS)
      last = error
    }
  }
  throw last
}

/**
 * One email, read. Null when the model's answer could not be used, so the
 * caller falls back to the plain rules; an error when no model could be
 * reached at all.
 */
export async function triageMail(
  access: AiSetup | string,
  message: MailMessage,
  context: TriageContext,
  options: AiOptions = {},
): Promise<MailTriage | null> {
  const { system, user } = triagePrompt(message, context)
  const { content, model } = await chat(
    access,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    options,
  )
  const triage = readTriage(content, context)
  return triage && { ...triage, model: model.label }
}

/** Checks a key with the smallest possible request, saying which model answered. */
export async function checkAiKey(access: AiSetup | string, options: AiOptions = {}): Promise<string> {
  const { model } = await chat(access, [{ role: 'user', content: 'Reply with the word OK.' }], options)
  return model.label
}
