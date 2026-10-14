import type { ExtractedFields, ExtractResponse } from '../shared/dto.js'
import { extractSchema } from '../shared/schemas.js'
import { jstDateString, jstToMs } from '../shared/time.js'
import { requireActor } from './_lib/auth.js'
import { aiDailyLimit } from './_lib/config.js'
import { AiUnavailableError, extractConditions, isAiConfigured } from './_lib/openai.js'
import { handle, HttpError, json, readBody } from './_lib/http.js'
import { getPrisma } from './_lib/prisma.js'

const SCOPE_MESSAGE = 'このサービスは地域の生産者と飲食店の仕入れ案づくりが対象です。'

const unavailable = (): ExtractResponse => ({
  ok: false,
  reason: 'AI_UNAVAILABLE',
  message: 'AIによる読み取りを利用できません。項目を選んで続けられます。',
})

// 自然文を AI で条件に整理する。結果は必ず利用者が確認・修正してから使う。
export const POST = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const body = await readBody(request, extractSchema)
  const text = body.text.trim()
  // 空入力では AI を呼ばない（仕様 5章）。
  if (!text) throw new HttpError(400, 'EMPTY', '品目・数量・希望日を入力してください。')
  if (!isAiConfigured()) return json(unavailable())

  const prisma = getPrisma()
  const nowMs = Date.now()
  const today = jstDateString(nowMs)

  // 1人あたり1日の利用回数を制限する（無料枠の使い切りと悪用を防ぐ）
  const usage = await prisma.aiUsage.upsert({
    where: { userId_day: { userId: actor.user.id, day: today } },
    update: { count: { increment: 1 } },
    create: { userId: actor.user.id, day: today, count: 1 },
  })
  if (usage.count > aiDailyLimit()) {
    return json({
      ok: false,
      reason: 'AI_UNAVAILABLE',
      message: '本日のAI読み取りの利用上限に達しました。項目を選んで続けられます。',
    } satisfies ExtractResponse)
  }

  const items = await prisma.item.findMany({ orderBy: { sortOrder: 'asc' } })

  let ai
  try {
    ai = await extractConditions(text, today, items.map((i) => i.name))
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) throw error
    console.warn('[extract] AI unavailable:', error.message)
    return json(unavailable())
  }

  if (ai.outOfScope === 'UNREADABLE') {
    return json({ ok: false, reason: 'UNREADABLE', message: '条件を読み取れません。項目を選んで入力してください。' } satisfies ExtractResponse)
  }
  if (ai.outOfScope !== 'NONE') {
    const detail = {
      PERSONAL: '個人でのご購入には対応していません。',
      MULTI_ITEM: '1回の依頼は1品目です。品目ごとに分けて入力してください。',
      NATIONWIDE: '全国配送・遠方への発送には対応していません。',
    }[ai.outOfScope]
    return json({ ok: false, reason: 'OUT_OF_SCOPE', message: `${SCOPE_MESSAGE}${detail}` } satisfies ExtractResponse)
  }

  // AI の出力をそのまま信用せず、DB の品目・日付の形式と照らして検証する。
  const notes: string[] = []
  const name = ai.itemName?.trim() ?? ''
  const item = name ? items.find((i) => i.name === name || i.aliases.includes(name)) : undefined
  if (name && !item) notes.push(`「${name}」は登録されている品目にありません。一覧から選んでください。`)

  let date: string | null = null
  if (ai.date) {
    const ms = jstToMs(ai.date)
    if (Number.isNaN(ms) || ai.date < today) notes.push('希望日を読み取れませんでした。日付を選んでください。')
    else date = ai.date
  }
  const time = ai.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(ai.time) ? ai.time : null
  const timeMode = date ? (ai.timeMode === 'EXACT' && time ? 'EXACT' : (ai.timeMode ?? null)) : null
  if (ai.timeMode === 'EXACT' && date && !time) notes.push('受け取りたい時刻を読み取れませんでした。時刻を選んでください。')

  if (ai.unitPriceCapYen !== null) {
    notes.push('単価の上限（例：kgあたり○円以下）には対応していません。合計の予算上限を入力するか、空欄のまま進めてください。')
  }
  const budget = ai.budgetTotalYen !== null && Number.isInteger(ai.budgetTotalYen) ? ai.budgetTotalYen : null

  const fields: ExtractedFields = {
    itemId: item?.id ?? null,
    quantity: ai.quantity,
    unit: ai.unit,
    timeMode,
    date,
    time: timeMode === 'EXACT' ? time : null,
    regionText: ai.regionText?.trim() || null,
    budgetMaxYen: budget,
    allowIrregular: ai.allowIrregular,
  }
  if (!fields.itemId && fields.quantity === null && !fields.date && !name) {
    return json({ ok: false, reason: 'UNREADABLE', message: '条件を読み取れません。項目を選んで入力してください。' } satisfies ExtractResponse)
  }
  return json({ ok: true, fields, notes } satisfies ExtractResponse)
})
