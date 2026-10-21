// マッチング：飲食店が生産者に依頼を送り、生産者が承認（または辞退）する。
// 承認されたときだけ「マッチング成立」とし、当事者だけが使えるチャットが開く。
// 依頼・承認のどちらも、在庫の確保・注文の確定・決済・配送の手配はしない。
import { randomUUID } from 'node:crypto'
import { matchCreateSchema, matchRespondSchema } from '../../shared/schemas.js'
import { nextOccurrence, occurrenceOn } from '../../shared/schedule.js'
import { jstDateString } from '../../shared/time.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { scheduleOf } from '../_lib/listings.js'
import { loadMatchFor, matchInclude, toMatchDto } from '../_lib/matches.js'
import { getPrisma } from '../_lib/prisma.js'
import { requireAllowed } from '../_lib/throttle.js'

// 自分の依頼の一覧（飲食店：送った依頼／生産者：届いた依頼／運営者：すべて）。?id= で1件
export const GET = handle(async (request) => {
  const actor = await requireActor(request)
  const id = new URL(request.url).searchParams.get('id')
  if (id) {
    const { row, viewer } = await loadMatchFor(actor, id)
    return json({ match: await toMatchDto(row, viewer) })
  }
  const where = actor.restaurantId ? { restaurantId: actor.restaurantId } : actor.producerId ? { producerId: actor.producerId } : actor.user.role === 'ADMIN' ? {} : null
  if (!where) throw new HttpError(403, 'FORBIDDEN', 'この画面は利用できません。')
  const viewer = actor.restaurantId ? 'RESTAURANT' : actor.producerId ? 'PRODUCER' : 'ADMIN'
  const rows = await getPrisma().matchRequest.findMany({ where, include: matchInclude, orderBy: { createdAt: 'desc' }, take: 200 })
  const matches = await Promise.all(rows.map((r) => toMatchDto(r, viewer)))
  return json({ matches, unreadTotal: matches.reduce((n, m) => n + m.unread, 0), pendingTotal: viewer === 'PRODUCER' ? matches.filter((m) => m.status === 'PENDING').length : 0 })
})

// 依頼を送る（飲食店）。生産者ごと（出品ごと）に1件ずつ作る。
export const POST = handle(async (request) => {
  const actor = await requireActor(request, 'RESTAURANT')
  const body = await readBody(request, matchCreateSchema)
  await requireAllowed('match-create', actor.user.id, 30, 24 * 60 * 60)
  const prisma = getPrisma()
  const demo = body.demoMode ?? false
  const nowMs = Date.now()
  if (new Set(body.lines.map((l) => l.listingId)).size !== body.lines.length) {
    throw new HttpError(400, 'VALIDATION', '同じ出品が重複しています。')
  }

  const rows = await prisma.listing.findMany({
    where: {
      id: { in: body.lines.map((l) => l.listingId) },
      isPublished: true,
      adminSuspended: false,
      // デモデータと実際のデータは混ぜない（デモモードの依頼はデモの出品だけ）
      isDemo: demo,
      producer: { approvalStatus: 'APPROVED', isDemo: demo, user: { suspended: false } },
      pickupLocation: { status: 'APPROVED', isDemo: demo },
    },
    include: { item: true, pickupLocation: true },
  })
  const existing = await prisma.matchRequest.findMany({
    where: { restaurantId: actor.restaurantId!, listingId: { in: body.lines.map((l) => l.listingId) }, status: { in: ['PENDING', 'ACCEPTED'] } },
    select: { listingId: true },
  })
  const already = new Set(existing.map((e) => e.listingId))

  const data = body.lines.map((line) => {
    const row = rows.find((r) => r.id === line.listingId)
    if (!row || Number(row.quantity) <= 0) {
      throw new HttpError(409, 'UNAVAILABLE', 'この出品は現在、依頼できません。公開が止められたか、在庫がなくなった可能性があります。')
    }
    if (already.has(row.id)) throw new HttpError(409, 'DUPLICATE', `${row.item.name}（この生産者）には、既に依頼しています。「やりとり」で状況を確認できます。`)
    if (line.quantity > Number(row.quantity)) {
      throw new HttpError(400, 'VALIDATION', `${row.item.name}の数量は、いまの在庫（${Number(row.quantity)}）以下にしてください。`)
    }
    // 受け取りの回：指定があれば、その出品で実際に受け取れる回かを確かめる
    const w = { pickupStartMs: row.pickupStart.getTime(), pickupEndMs: row.pickupEnd.getTime(), schedule: scheduleOf(row) }
    let window = nextOccurrence(w, nowMs)
    if (line.pickupStartMs !== undefined && line.pickupEndMs !== undefined) {
      const o = occurrenceOn(w, jstDateString(line.pickupStartMs))
      if (!o || o.startMs !== line.pickupStartMs || o.endMs !== line.pickupEndMs) {
        throw new HttpError(400, 'VALIDATION', '受け取りの日時が、この出品の受渡日時と合いません。仕入れ案を計算し直してください。')
      }
      window = o
    }
    if (!window || window.endMs <= nowMs) throw new HttpError(409, 'UNAVAILABLE', 'この出品の受渡日時は過ぎています。')
    return {
      restaurantId: actor.restaurantId!,
      producerId: row.producerId,
      listingId: row.id,
      itemName: row.item.name,
      variety: row.variety,
      quantity: line.quantity,
      unit: row.unit,
      unitPriceTaxIncl: row.unitPriceTaxIncl,
      pickupStart: new Date(window.startMs),
      pickupEnd: new Date(window.endMs),
      locationName: row.pickupLocation.name,
      message: body.message ?? '',
      isDemo: row.isDemo,
    }
  })
  const groupId = data.length > 1 ? randomUUID() : null
  const created = await prisma.$transaction(data.map((d) => prisma.matchRequest.create({ data: { ...d, groupId }, include: matchInclude })))
  return json({ matches: await Promise.all(created.map((r) => toMatchDto(r, 'RESTAURANT'))) }, 201)
})

// 返事（/api/matches?id=...）：生産者は承認・辞退（返事待ちのときだけ）、飲食店は取り下げ（返事待ちのときだけ）
export const PATCH = handle(async (request) => {
  const actor = await requireActor(request)
  const { row, viewer } = await loadMatchFor(actor, new URL(request.url).searchParams.get('id'))
  const body = await readBody(request, matchRespondSchema)
  if (row.status !== 'PENDING') throw new HttpError(409, 'ALREADY', 'この依頼には、既に返事が済んでいます。画面を読み込み直してください。')
  const allowed = viewer === 'PRODUCER' ? ['accept', 'decline'] : viewer === 'RESTAURANT' ? ['cancel'] : []
  if (!allowed.includes(body.action)) throw new HttpError(403, 'FORBIDDEN', 'この操作はできません。')
  const status = body.action === 'accept' ? 'ACCEPTED' : body.action === 'decline' ? 'DECLINED' : 'CANCELLED'
  // 同時に2回押されても、返事待ちのものだけを更新する
  const updated = await getPrisma().matchRequest.updateMany({
    where: { id: row.id, status: 'PENDING' },
    data: { status, respondedAt: new Date(), declineReason: body.action === 'decline' ? body.reason || null : null },
  })
  if (updated.count === 0) throw new HttpError(409, 'ALREADY', 'この依頼には、既に返事が済んでいます。画面を読み込み直してください。')
  const { row: next } = await loadMatchFor(actor, row.id)
  return json({ match: await toMatchDto(next, viewer) })
})
