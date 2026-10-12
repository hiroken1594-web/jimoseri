import { allocate, toMilli, type DemandSpec } from '../shared/allocate.js'
import type { PlanResponse, PublicContact } from '../shared/dto.js'
import { demandSchema, planCheckSchema } from '../shared/schemas.js'
import { endOfJstDayMs, jstDateString, jstToMs } from '../shared/time.js'
import { requireActor } from './_lib/auth.js'
import { handle, HttpError, json, readBody } from './_lib/http.js'
import { computeFingerprint, listingInclude, planEligibleWhere, toCandidate } from './_lib/listings.js'
import { getPrisma } from './_lib/prisma.js'

const MAX_HISTORY = 50

// 確定した条件から仕入れ案を計算する。毎回 DB を読み直し、計算結果は保存しない（未確保の提案）。
export const POST = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const body = await readBody(request, demandSchema)
  const prisma = getPrisma()
  const nowMs = Date.now()

  let targetMs: number
  if (body.timeMode === 'EXACT') {
    targetMs = jstToMs(body.date, body.time ?? '')
    if (Number.isNaN(targetMs)) throw new HttpError(400, 'VALIDATION', '受け取りたい日時を確認してください。', { date: '日時を確認してください。' })
    if (targetMs < nowMs) throw new HttpError(400, 'VALIDATION', '受け取りたい日時が過ぎています。', { date: 'これからの日時を選んでください。' })
  } else {
    targetMs = endOfJstDayMs(body.date)
    if (Number.isNaN(targetMs)) throw new HttpError(400, 'VALIDATION', '希望日を確認してください。', { date: '希望日を確認してください。' })
    if (body.date < jstDateString(nowMs)) throw new HttpError(400, 'VALIDATION', '希望日が過ぎています。', { date: '今日以降の日付を選んでください。' })
  }

  const item = await prisma.item.findUnique({ where: { id: body.itemId } })
  if (!item) throw new HttpError(400, 'VALIDATION', '品目を選択してください。', { itemId: '品目を選択してください。' })

  const spec: DemandSpec = {
    itemId: item.id,
    unit: body.unit,
    quantityMilli: toMilli(body.quantity),
    timeMode: body.timeMode,
    targetMs,
    pickupPointId: null,
    area: body.municipality,
    budgetMaxYen: body.budgetMaxYen,
    allowIrregular: body.allowIrregular,
    allowMultiLocation: body.allowMultiLocation,
  }

  // 承認済みの生産者・確認済みの場所の出品だけを読む
  const rows = await prisma.listing.findMany({ where: planEligibleWhere(item.id), include: listingInclude })
  const candidates = rows.map(toCandidate)
  const result = allocate(candidates, spec, nowMs)

  // 希望条件を履歴に保存する（再計算のときは保存しない）
  let demandId: string | null = null
  if (body.save !== false) {
    const created = await prisma.demand.create({
      data: {
        restaurantId: actor.restaurantId!,
        rawText: body.rawText || null,
        itemId: item.id,
        quantity: body.quantity,
        unit: body.unit,
        timeMode: body.timeMode,
        date: body.date,
        time: body.timeMode === 'EXACT' ? body.time : null,
        municipality: body.municipality,
        budgetMaxYen: body.budgetMaxYen,
        allowIrregular: body.allowIrregular,
        allowMultiLocation: body.allowMultiLocation,
      },
    })
    demandId = created.id
    // 履歴は新しい順に一定件数だけ残す
    const old = await prisma.demand.findMany({
      where: { restaurantId: actor.restaurantId! },
      orderBy: { createdAt: 'desc' },
      skip: MAX_HISTORY,
      select: { id: true },
    })
    if (old.length > 0) await prisma.demand.deleteMany({ where: { id: { in: old.map((d) => d.id) } } })
  }

  // 案に含まれる出品・場所・生産者の情報だけを返す（案に関係ない生産者の連絡先は返さない）
  const usedLines = [
    ...(result.best?.plan.lines ?? []),
    ...result.alternatives.flatMap((a) => a.plan.lines),
    ...(result.multi?.stops.flatMap((s) => s.lines) ?? []),
  ]
  const usedListingIds = new Set(usedLines.map((l) => l.listingId))
  const listingInfo: PlanResponse['listingInfo'] = {}
  const locations: PlanResponse['locations'] = {}
  const contacts: PlanResponse['contacts'] = {}
  for (const row of rows) {
    if (!usedListingIds.has(row.id)) continue
    listingInfo[row.id] = {
      pickupStartMs: row.pickupStart.getTime(),
      pickupEndMs: row.pickupEnd.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }
    const loc = row.pickupLocation
    locations[loc.id] = { name: loc.name, municipality: loc.municipality, address: loc.address, note: loc.note }
    // 本人が公開を選んだ連絡先だけ
    const p = row.producer
    const contact: PublicContact = {}
    if (p.showPhone && p.publicPhone) contact.phone = p.publicPhone
    if (p.showEmail && p.publicEmail) contact.email = p.publicEmail
    if ((contact.phone || contact.email) && p.contactNote) contact.note = p.contactNote
    if (contact.phone || contact.email) contacts[p.id] = contact
  }

  const response: PlanResponse = {
    computedAtMs: nowMs,
    fingerprint: computeFingerprint(candidates, nowMs),
    demandId,
    demand: {
      itemId: item.id,
      itemName: item.name,
      quantityMilli: spec.quantityMilli,
      unit: body.unit,
      timeMode: body.timeMode,
      date: body.date,
      time: body.timeMode === 'EXACT' ? body.time : null,
      municipality: body.municipality,
      budgetMaxYen: body.budgetMaxYen,
      allowIrregular: body.allowIrregular,
      allowMultiLocation: body.allowMultiLocation,
    },
    result,
    listingInfo,
    locations,
    contacts,
  }
  return json(response)
})

// 表示中の仕入れ案が古くなっていないか確認する（在庫変更・公開停止・期限切れ・審査状態の変化を検知）。
export const PUT = handle(async (request) => {
  await requireActor(request, 'RESTAURANT')
  const body = await readBody(request, planCheckSchema)
  const nowMs = Date.now()
  const rows = await getPrisma().listing.findMany({ where: planEligibleWhere(body.itemId), include: listingInclude })
  const fresh = computeFingerprint(rows.map(toCandidate), nowMs) === body.fingerprint
  return json({ fresh, checkedAtMs: nowMs })
})
