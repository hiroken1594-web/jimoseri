import { listingCreateSchema, listingPatchSchema, type ListingCreateInput } from '../../shared/schemas.js'
import { nextOccurrence, timeToMin } from '../../shared/schedule.js'
import { DAY_MS, jstToMs } from '../../shared/time.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { listingInclude, toListingDto } from '../_lib/listings.js'
import { getPrisma } from '../_lib/prisma.js'

/** 入力を検証して、DB に保存する形へ直す（新規登録・編集で共通） */
async function toListingData(body: ListingCreateInput, producerId: string) {
  const prisma = getPrisma()
  const period = body.pickupMode === 'PERIOD'
  const endDate = period ? body.pickupEndDate! : body.pickupDate
  // 期間の出品：pickupStart は最初の日の開始時刻、pickupEnd は最後の日の終了時刻
  const pickupStart = jstToMs(body.pickupDate, body.startTime)
  const pickupEnd = jstToMs(endDate, body.endTime)
  if (Number.isNaN(pickupStart) || Number.isNaN(pickupEnd)) {
    throw new HttpError(400, 'VALIDATION', '受渡日を確認してください。', { pickupDate: '受渡日を確認してください。' })
  }
  if (period && pickupEnd - pickupStart > 366 * DAY_MS) {
    throw new HttpError(400, 'VALIDATION', '受渡の期間は1年以内にしてください。', { pickupEndDate: '受渡の期間は1年以内にしてください。' })
  }
  const schedule = period ? { weekdays: body.weekdays!, startMin: timeToMin(body.startTime), endMin: timeToMin(body.endTime) } : null
  // これから受け取れる回が1つもない出品は登録しない（期間の出品は、選んだ曜日が期間内にあるかも確かめる）
  if (!nextOccurrence({ pickupStartMs: pickupStart, pickupEndMs: pickupEnd, schedule }, Date.now())) {
    const message = period ? '期間内に、これから受け渡しできる日がありません。期間・曜日・時刻を確認してください。' : '受渡の終了時刻が過ぎています。これからの日時を選んでください。'
    throw new HttpError(400, 'VALIDATION', message, period ? { pickupEndDate: message } : { pickupDate: 'これからの日時を選んでください。' })
  }
  const [item, location] = await Promise.all([
    prisma.item.findUnique({ where: { id: body.itemId } }),
    // 使えるのは、確認済みの場所か、自分が登録した場所（確認待ち）だけ
    prisma.pickupLocation.findFirst({
      where: {
        id: body.pickupLocationId,
        OR: [{ status: 'APPROVED', isDemo: false }, { createdById: producerId, status: { in: ['APPROVED', 'PENDING'] } }],
      },
    }),
  ])
  if (!item) throw new HttpError(400, 'VALIDATION', '品目を選択してください。', { itemId: '品目を選択してください。' })
  if (!location) {
    throw new HttpError(400, 'VALIDATION', '受渡場所を選び直してください。', { pickupLocationId: '受渡場所を選び直してください。' })
  }
  return {
    itemId: item.id,
    variety: body.variety || null,
    grade: body.grade,
    irregularReason: body.grade === 'IRREGULAR' ? body.irregularReason : null,
    quantity: body.quantity,
    unit: body.unit,
    unitPriceTaxIncl: body.unitPriceYen,
    minQuantity: body.minQuantity,
    stepQuantity: body.stepQuantity,
    pickupLocationId: location.id,
    pickupStart: new Date(pickupStart),
    pickupEnd: new Date(pickupEnd),
    pickupWeekdays: schedule?.weekdays ?? null,
    pickupStartMin: schedule?.startMin ?? null,
    pickupEndMin: schedule?.endMin ?? null,
  }
}

/** 自分の出品だけを取り出す。他の生産者の出品は「存在しない」ものとして扱う。 */
async function findOwnListing(request: Request, producerId: string) {
  const id = new URL(request.url).searchParams.get('id')
  if (!id) throw new HttpError(400, 'BAD_REQUEST', '出品が指定されていません。')
  const existing = await getPrisma().listing.findFirst({ where: { id, producerId } })
  if (!existing) throw new HttpError(404, 'NOT_FOUND', '出品が見つかりません。一覧を読み込み直してください。')
  return existing
}

// 自分の出品一覧
export const GET = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const rows = await getPrisma().listing.findMany({
    where: { producerId: actor.producerId! },
    include: listingInclude,
    orderBy: [{ pickupEnd: 'desc' }, { createdAt: 'desc' }],
  })
  return json({ listings: rows.map(toListingDto), nowMs: Date.now() })
})

// 新規出品
export const POST = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const body = await readBody(request, listingCreateSchema)
  const data = await toListingData(body, actor.producerId!)
  // デモ用の生産者が登録した出品も、デモデータとして扱う（仕入れ案に混ぜない）
  const row = await getPrisma().listing.create({
    data: { producerId: actor.producerId!, ...data, isDemo: actor.user.producer?.isDemo ?? false },
    include: listingInclude,
  })
  return json({ listing: toListingDto(row) }, 201)
})

// 数量のみ更新・公開／停止（/api/listings?id=...）
export const PATCH = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const existing = await findOwnListing(request, actor.producerId!)
  const body = await readBody(request, listingPatchSchema)
  const row = await getPrisma().listing.update({
    where: { id: existing.id },
    data: { quantity: body.quantity, isPublished: body.isPublished },
    include: listingInclude,
  })
  return json({ listing: toListingDto(row) })
})

// 出品内容の編集（全項目）
export const PUT = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const existing = await findOwnListing(request, actor.producerId!)
  const body = await readBody(request, listingCreateSchema)
  const data = await toListingData(body, actor.producerId!)
  const row = await getPrisma().listing.update({ where: { id: existing.id }, data, include: listingInclude })
  return json({ listing: toListingDto(row) })
})

// 出品の削除
export const DELETE = handle(async (request) => {
  const actor = await requireActor(request, 'PRODUCER')
  const existing = await findOwnListing(request, actor.producerId!)
  await getPrisma().listing.delete({ where: { id: existing.id } })
  return json({ ok: true })
})
