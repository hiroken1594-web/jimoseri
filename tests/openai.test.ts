import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiUnavailableError, buildSystemPrompt, EXTRACTION_JSON_SCHEMA, extractConditions } from '../api/_lib/openai.js'

// OpenAI API の呼び出し方と、失敗時に手入力へ切り替えられること（実際の通信はしない）
const ITEMS = ['トマト', 'なす']
const TODAY = '2026-10-12'
const good = {
  outOfScope: 'NONE',
  itemName: 'トマト',
  quantity: 10,
  unit: 'KG',
  timeMode: 'DEADLINE',
  date: '2026-10-14',
  time: null,
  regionText: '大阪近郊',
  budgetTotalYen: null,
  unitPriceCapYen: null,
  allowIrregular: true,
}
const reply = (content: unknown, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content), ...extra }, finish_reason: 'stop' }] }), { status: 200 })

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'test-key-not-real')
  vi.stubEnv('OPENAI_MODEL', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('OpenAI による条件抽出', () => {
  it('Structured Outputs（strict）で依頼し、検証済みの結果を返す', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => reply(good))
    vi.stubGlobal('fetch', fetchMock)
    const result = await extractConditions('明後日までに大阪近郊のトマトを10kg、多少形が悪くてもOK', TODAY, ITEMS)
    expect(result).toEqual(good)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key-not-real')
    const body = JSON.parse(init.body as string)
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.response_format.json_schema.schema).toEqual(EXTRACTION_JSON_SCHEMA)
    expect(body.store).toBe(false)
    expect(body.messages[1].content).toBe('<input>明後日までに大阪近郊のトマトを10kg、多少形が悪くてもOK</input>')
  })

  it('strict 用のスキーマは、全項目が必須で追加の項目を許さない', () => {
    expect(EXTRACTION_JSON_SCHEMA.additionalProperties).toBe(false)
    expect([...EXTRACTION_JSON_SCHEMA.required].sort()).toEqual(Object.keys(EXTRACTION_JSON_SCHEMA.properties).sort())
  })

  it('プロンプトには品目一覧と日付の対応表だけを渡し、在庫・価格・生産者の情報は含めない', () => {
    const prompt = buildSystemPrompt(TODAY, ITEMS)
    expect(prompt).toContain('2026-10-12（月） ＝ 今日')
    expect(prompt).toContain('2026-10-14（水） ＝ 明後日')
    expect(prompt).toContain('2026-10-16（金）')
    expect(prompt).toContain('品目一覧：トマト、なす')
    expect(prompt).not.toMatch(/農園|農家|在庫|単価は/)
  })

  it.each([
    ['キーが未設定', () => vi.stubEnv('OPENAI_API_KEY', ''), null],
    ['回数制限・残高不足（429）', null, () => new Response(JSON.stringify({ error: { code: 'insufficient_quota' } }), { status: 429 })],
    ['認証エラー（401）', null, () => new Response('{}', { status: 401 })],
    ['応答が JSON でない', null, () => reply('これはJSONではありません')],
    ['形が違う応答', null, () => reply({ ...good, quantity: 'たくさん' })],
    ['モデルが回答を拒否', null, () => reply(good, { refusal: 'I cannot help with that' })],
    ['通信エラー', null, () => Promise.reject(new TypeError('fetch failed'))],
  ])('%s のときは AiUnavailableError（手入力へ切り替え）', async (_name, setup, respond) => {
    setup?.()
    vi.stubGlobal('fetch', vi.fn(async () => respond!()))
    await expect(extractConditions('トマト10kg', TODAY, ITEMS)).rejects.toBeInstanceOf(AiUnavailableError)
  })

  it('エラーの内容に API キーを含めない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_api_key', message: 'Incorrect API key provided: test-key-not-real' } }), { status: 401 })))
    const error = await extractConditions('トマト10kg', TODAY, ITEMS).catch((e) => e)
    expect(error).toBeInstanceOf(AiUnavailableError)
    expect(String(error.message)).not.toContain('test-key-not-real')
  })
})
