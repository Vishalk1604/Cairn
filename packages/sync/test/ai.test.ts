import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_MODELS, AiError, chat, checkAiKey, modelsFor, readAiSetup, resetAiModels, storedAiSetup, triageMail, type AiFetch, type AiModel } from '../src'

const models: AiModel[] = [
  { id: 'first', label: 'First', timeoutMs: 50 },
  { id: 'second', label: 'Second', extra: { chat_template_kwargs: { enable_thinking: false } }, timeoutMs: 50 },
]

type Answer = { status?: number; body?: unknown; hang?: boolean }

/** A fetch that answers per model, recording which models were asked and with what. */
function fakeAi(answers: Record<string, Answer>) {
  const asked: { model: string; body: Record<string, unknown>; auth: string }[] = []
  const fetchFn: AiFetch = async (_url, init) => {
    const body = JSON.parse(init.body) as Record<string, unknown>
    asked.push({ model: String(body.model), body, auth: init.headers.Authorization ?? '' })
    const answer = answers[String(body.model)] ?? { status: 500 }
    if (answer.hang) return new Promise(() => {})
    const status = answer.status ?? 200
    return { ok: status < 300, status, json: async () => answer.body ?? {} }
  }
  return { fetchFn, asked }
}

const reply = (content: string) => ({ choices: [{ message: { content } }] })

beforeEach(() => resetAiModels())

describe('chat', () => {
  it('asks the first model, sending the key and switching thinking off where set', async () => {
    const { fetchFn, asked } = fakeAi({ first: { body: reply('hi') } })
    const result = await chat('nvapi-test', [{ role: 'user', content: 'x' }], { fetchFn, models })
    expect(result).toMatchObject({ content: 'hi', model: { id: 'first' } })
    expect(asked[0]?.auth).toBe('Bearer nvapi-test')
    expect(asked[0]?.body.stream).toBe(false)
  })

  it('falls through to the next model when one does not answer, and rests the silent one', async () => {
    let clock = 1000
    const { fetchFn, asked } = fakeAi({ first: { hang: true }, second: { body: reply('ok') } })
    expect((await chat('k', [{ role: 'user', content: 'x' }], { fetchFn, models, now: () => clock })).model.id).toBe('second')
    expect(asked.map((a) => a.model)).toEqual(['first', 'second'])
    expect(asked[1]?.body.chat_template_kwargs).toEqual({ enable_thinking: false })

    // While it rests, the silent model is not waited on again.
    await chat('k', [{ role: 'user', content: 'x' }], { fetchFn, models, now: () => clock })
    expect(asked.map((a) => a.model)).toEqual(['first', 'second', 'second'])

    // After its rest it gets another chance.
    clock += 16 * 60 * 1000
    await chat('k', [{ role: 'user', content: 'x' }], { fetchFn, models, now: () => clock })
    expect(asked.map((a) => a.model).slice(3)).toEqual(['first', 'second'])
  })

  it('stops at once on a rejected key, since every model shares it', async () => {
    const { fetchFn, asked } = fakeAi({ first: { status: 401 } })
    await expect(chat('bad', [{ role: 'user', content: 'x' }], { fetchFn, models })).rejects.toSatisfy((e: unknown) => e instanceof AiError && e.badKey)
    expect(asked).toHaveLength(1)
  })

  it('treats an empty answer as a failure and moves on', async () => {
    const { fetchFn } = fakeAi({ first: { body: { choices: [{ message: { content: null } }] } }, second: { body: reply('ok') } })
    expect((await chat('k', [{ role: 'user', content: 'x' }], { fetchFn, models })).model.id).toBe('second')
  })

  it('reports the last failure when nothing answers', async () => {
    const { fetchFn } = fakeAi({ first: { status: 503 }, second: { status: 429 } })
    await expect(chat('k', [{ role: 'user', content: 'x' }], { fetchFn, models })).rejects.toSatisfy((e: unknown) => e instanceof AiError && e.rateLimited)
  })
})

describe('triageMail', () => {
  const message = { id: 'm', account: 'me@x.com', from: 'Unstop <a@unstop.com>', subject: 'Internship at Acme', snippet: 's', text: 'Apply by 2026-12-01.', receivedAt: Date.UTC(2026, 9, 22) }

  it('reads the reply and says which model read it', async () => {
    const { fetchFn } = fakeAi({ first: { body: reply('{"important":true,"folder":"internships","summary":"Acme is hiring interns.","why":"Open application","task":null}') } })
    const triage = await triageMail('k', message, { now: message.receivedAt, folders: ['Internships'] }, { fetchFn, models })
    expect(triage).toEqual({ important: true, folder: 'Internships', summary: 'Acme is hiring interns.', why: 'Open application', model: 'First' })
  })

  it('gives null for an unusable reply rather than guessing', async () => {
    const { fetchFn } = fakeAi({ first: { body: reply('Sorry, I cannot do that.') } })
    expect(await triageMail('k', message, { now: message.receivedAt, folders: [] }, { fetchFn, models })).toBeNull()
  })
})

describe('checkAiKey', () => {
  it('names the model that answered', async () => {
    const { fetchFn } = fakeAi({ first: { status: 500 }, second: { body: reply('OK') } })
    expect(await checkAiKey('k', { fetchFn, models })).toBe('Second')
  })
})

describe('readAiSetup', () => {
  const KEY = 'nvapi-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-zz'

  it('reads the key and model out of NVIDIA’s Python sample', () => {
    const python = [
      'from openai import OpenAI',
      'client = OpenAI(',
      '  base_url = "https://integrate.api.nvidia.com/v1",',
      `  api_key = "${KEY}"`,
      ')',
      'completion = client.chat.completions.create(',
      '  model="deepseek-ai/deepseek-v4.1-flash",',
      '  messages=[{"role":"user","content":""}],',
      '  max_tokens=16384,',
      '  extra_body={"chat_template_kwargs": {"thinking":True}},',
      ')',
    ].join('\n')
    expect(readAiSetup(python)).toEqual({ ok: true, setup: { key: KEY, model: 'deepseek-ai/deepseek-v4.1-flash' } })
  })

  it('reads the Node sample', () => {
    const node = `const openai = new OpenAI({\n  apiKey: '${KEY}',\n  baseURL: 'https://integrate.api.nvidia.com/v1',\n})\nconst completion = await openai.chat.completions.create({\n  model: "nvidia/nemotron-3.5-lightning-30b-a3b",\n  max_tokens: 4096,\n})`
    expect(readAiSetup(node)).toEqual({ ok: true, setup: { key: KEY, model: 'nvidia/nemotron-3.5-lightning-30b-a3b' } })
  })

  it('reads the curl sample, taking the address without the endpoint', () => {
    const shell = `curl https://ai.api.nvidia.com/v1/chat/completions \\n  -H "Authorization: Bearer ${KEY}" \\n  -d '{"model": "qwen/qwen3-next-80b", "max_tokens": 4096}'`
    expect(readAiSetup(shell)).toEqual({ ok: true, setup: { key: KEY, model: 'qwen/qwen3-next-80b', baseUrl: 'https://ai.api.nvidia.com/v1' } })
  })

  it('takes a bare key', () => {
    expect(readAiSetup(`  ${KEY}\n`)).toEqual({ ok: true, setup: { key: KEY } })
  })

  it('says where the key is when the sample only names the setting it would be read from', () => {
    for (const sample of ['api_key = "$NVIDIA_API_KEY"', 'api_key = os.environ["NVIDIA_API_KEY"]', 'apiKey: process.env.NVIDIA_API_KEY']) {
      const result = readAiSetup(sample)
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatch(/Get API Key.*Shell code/)
    }
  })

  it('takes the key and the model when both are pasted together', () => {
    const both = `${KEY}
model="deepseek-ai/deepseek-v4.1-flash"
api_key = os.environ["NVIDIA_API_KEY"]`
    expect(readAiSetup(both)).toEqual({ ok: true, setup: { key: KEY, model: 'deepseek-ai/deepseek-v4.1-flash' } })
  })

  it('never takes an address outside nvidia.com', () => {
    const result = readAiSetup(`base_url = "https://example.com/v1"\napi_key = "${KEY}"`)
    expect(result).toEqual({ ok: true, setup: { key: KEY } })
  })

  it('reads back what was stored, including a bare key from an older install', () => {
    expect(storedAiSetup(JSON.stringify({ key: KEY, model: 'a/b' }))).toEqual({ key: KEY, model: 'a/b' })
    expect(storedAiSetup(KEY)).toEqual({ key: KEY })
    expect(storedAiSetup(null)).toBeNull()
    expect(storedAiSetup('{broken')).toBeNull()
  })
})

describe('modelsFor', () => {
  it('puts the pasted model first and keeps the rest as fallbacks', () => {
    const ids = modelsFor({ key: 'k', model: 'qwen/qwen3-next-80b' }).map((m) => m.id)
    expect(ids).toEqual(['qwen/qwen3-next-80b', ...AI_MODELS.map((m) => m.id)])
    expect(modelsFor({ key: 'k', model: 'qwen/qwen3-next-80b' })[0]!.label).toBe('Qwen3 Next 80b')
  })

  it('uses its own settings for a model it knows, without listing it twice', () => {
    const models = modelsFor({ key: 'k', model: AI_MODELS[1]!.id })
    expect(models.map((m) => m.id)).toEqual([AI_MODELS[1]!.id, AI_MODELS[0]!.id])
    expect(models[0]).toBe(AI_MODELS[1])
  })

  it('sends the key to the pasted address', async () => {
    const fetchFn = vi.fn<AiFetch>(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'OK' } }] }) }))
    await chat({ key: 'k', baseUrl: 'https://ai.api.nvidia.com/v1' }, [{ role: 'user', content: 'x' }], { fetchFn, models: [models[0]!] })
    expect(fetchFn.mock.calls[0]![0]).toBe('https://ai.api.nvidia.com/v1/chat/completions')
  })
})

describe('the responses format', () => {
  const gptOss = AI_MODELS[0]!

  it('is how GPT-OSS is asked, with the instructions as a message and short reasoning', async () => {
    expect(gptOss).toMatchObject({ id: 'openai/gpt-oss-20b', api: 'responses' })
    const fetchFn = vi.fn<AiFetch>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        output: [
          { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'Need to decide importance.' }] },
          { type: 'message', content: [{ type: 'output_text', text: '{"important": true}' }] },
        ],
      }),
    }))
    const result = await chat(
      'k',
      [
        { role: 'system', content: 'Reply with JSON' },
        { role: 'user', content: 'mail' },
      ],
      { fetchFn, models: [gptOss] },
    )
    // The answer only; the model's reasoning is left out.
    expect(result.content).toBe('{"important": true}')
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://integrate.api.nvidia.com/v1/responses')
    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'openai/gpt-oss-20b',
      input: [
        { role: 'system', content: 'Reply with JSON' },
        { role: 'user', content: 'mail' },
      ],
      reasoning: { effort: 'low' },
      stream: false,
    })
    expect(body.messages).toBeUndefined()
  })

  it('counts a reply with reasoning but no answer as empty', async () => {
    const fetchFn: AiFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ output: [{ type: 'reasoning', content: [{ type: 'reasoning_text', text: 'thinking…' }] }] }),
    })
    await expect(chat('k', [{ role: 'user', content: 'x' }], { fetchFn, models: [gptOss] })).rejects.toThrow(/empty answer/)
  })

  it('reads the GPT-OSS sample from NVIDIA, which uses the responses format', () => {
    const KEY = 'nvapi-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-zz'
    const python = [
      'from openai import OpenAI',
      'client = OpenAI(',
      '  base_url = "https://integrate.api.nvidia.com/v1",',
      `  api_key = "${KEY}"`,
      ')',
      'response = client.responses.create(',
      '  model="openai/gpt-oss-20b",',
      '  input="Which number is larger, 9.11 or 9.8?",',
      '  max_output_tokens=4096,',
      '  stream=True',
      ')',
    ].join('\n')
    const read = readAiSetup(python)
    expect(read).toEqual({ ok: true, setup: { key: KEY, model: 'openai/gpt-oss-20b', api: 'responses' } })
    expect(read.ok && modelsFor(read.setup)[0]).toBe(gptOss)
  })

  it('asks a model it does not know in the format its code used', () => {
    const first = modelsFor({ key: 'k', model: 'openai/gpt-oss-120b', api: 'responses' })[0]!
    expect(first).toMatchObject({ id: 'openai/gpt-oss-120b', api: 'responses', extra: { reasoning: { effort: 'low' } } })
  })
})
