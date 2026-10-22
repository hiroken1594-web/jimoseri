import { toMilli, type DemandSpec } from '../../shared/allocate.js'
import { publicAddress } from '../_lib/places.js'
import { withinRadius } from '../../shared/geo.js'
import { allocateScheduled } from '../../shared/schedule.js'
import { suggestRelaxations } from '../../shared/relax.js'
import type { PlanResponse, PublicContact } from '../../shared/dto.js'
import { demandSchema, planCheckSchema } from '../../shared/schemas.js'
import { endOfJstDayMs, jstDateString, jstToMs } from '../../shared/time.js'
import { demoFor, requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { computeFingerprint, listingInclude, planEligibleWhere, toCandidate } from '../_lib/listings.js'
import { getPrisma } from '../_lib/prisma.js'

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
    prefecture: body.prefecture,
    allowedPointIds: null,
    budgetMaxYen: body.budgetMaxYen,
    allowIrregular: body.allowIrregular,
    allowMultiLocation: body.allowMultiLocation,
  }

  // 承認済みの生産者・確認済みの場所の出品だけを読む
  const demoMode = demoFor(actor, body.demoMode)
  const rows = await prisma.listing.findMany({ where: planEligibleWhere(item.id, demoMode), include: listingInclude })
  const candidates = rows.map(toCandidate)
  // 検索地点と半径があれば、その内側の受渡場所だけを使う（位置が未登録の場所は対象外）
  const center = body.center ?? null
  const radiusKm = center ? (body.radiusKm ?? null) : null
  if (center && radiusKm !== null) {
    spec.allowedPointIds = [
      ...new Set(
        rows
          .filter((r) => r.pickupLocation.latitude !== null && r.pickupLocation.longitude !== null)
          .filter((r) => withinRadius(center, { lat: r.pickupLocation.latitude!, lng: r.pickupLocation.longitude! }, radiusKm))
          .map((r) => r.pickupLocationId),
      ),
    ]
  }
  const result = allocateScheduled(candidates, spec, nowMs)
  // 希望量に届かないときだけ、条件を広げた場合の参考を計算する（元の案とは別に示す）
  const relaxations = suggestRelaxations(candidates, spec, result, nowMs, { date: body.date })

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
        prefecture: body.prefecture,
        municipality: body.municipality,
        budgetMaxYen: body.budgetMaxYen,
        allowIrregular: body.allowIrregular,
        allowMultiLocation: body.allowMultiLocation,
        demoMode,
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
  // 受渡日時は、案ごとに選んだ回（期間の出品では、その日の時間帯）を示す
  const chosenWindow = new Map<string, { startMs: number; endMs: number }>()
  for (const p of [result.best, ...result.alternatives]) {
    for (const l of p?.plan.lines ?? []) if (!chosenWindow.has(l.listingId)) chosenWindow.set(l.listingId, { startMs: p!.plan.windowStartMs, endMs: p!.plan.windowEndMs })
  }
  for (const s of result.multi?.stops ?? []) for (const l of s.lines) if (!chosenWindow.has(l.listingId)) chosenWindow.set(l.listingId, { startMs: s.windowStartMs, endMs: s.windowEndMs })
  const listingInfo: PlanResponse['listingInfo'] = {}
  const locations: PlanResponse['locations'] = {}
  const contacts: PlanResponse['contacts'] = {}
  for (const row of rows) {
    if (!usedListingIds.has(row.id)) continue
    const w = chosenWindow.get(row.id)
    listingInfo[row.id] = {
      pickupStartMs: w?.startMs ?? row.pickupStart.getTime(),
      pickupEndMs: w?.endMs ?? row.pickupEnd.getTime(),
      updatedAtMs: row.updatedAt.getTime(),
    }
    const loc = row.pickupLocation
    locations[loc.id] = { name: loc.name, municipality: loc.municipality, address: publicAddress(loc), note: loc.note }
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
      prefecture: body.prefecture,
      municipality: body.municipality,
      center: center && radiusKm !== null ? center : null,
      radiusKm: center ? radiusKm : null,
      budgetMaxYen: body.budgetMaxYen,
      allowIrregular: body.allowIrregular,
      allowMultiLocation: body.allowMultiLocation,
      demoMode,
    },
    result,
    relaxations,
    listingInfo,
    locations,
    contacts,
  }
  return json(response)
})

// 表示中の仕入れ案が古くなっていないか確認する（在庫変更・公開停止・期限切れ・審査状態の変化を検知）。
export const PUT = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const body = await readBody(request, planCheckSchema)
  const nowMs = Date.now()
  const rows = await getPrisma().listing.findMany({ where: planEligibleWhere(body.itemId, demoFor(actor, body.demoMode)), include: listingInclude })
  const fresh = computeFingerprint(rows.map(toCandidate), nowMs) === body.fingerprint
  return json({ fresh, checkedAtMs: nowMs })
})
