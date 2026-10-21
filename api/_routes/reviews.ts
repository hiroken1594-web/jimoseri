// 相互レビュー：取引完了後に、飲食店と生産者がお互いを評価する（1取引につき1人1回）。
// 相手のレビューは、双方が投稿するか、取引完了から一定の日数が過ぎるまで公開しない。
import { reviewSchema } from '../../shared/schemas.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { loadMatchFor } from '../_lib/matches.js'
import { getPrisma } from '../_lib/prisma.js'
import { publishedReviewsFor, ratingSummary } from '../_lib/reviews.js'
import { requireAllowed } from '../_lib/throttle.js'

// 公開中のレビュー（?producerId= または ?restaurantId=、?mine=1 で自分が受けたもの）
export const GET = handle(async (request) => {
  const actor = await requireActor(request)
  const url = new URL(request.url)
  let target: { role: 'PRODUCER' | 'RESTAURANT'; id: string } | null = null
  if (url.searchParams.get('mine') === '1') {
    if (actor.producerId) target = { role: 'PRODUCER', id: actor.producerId }
    else if (actor.restaurantId) target = { role: 'RESTAURANT', id: actor.restaurantId }
  } else if (url.searchParams.get('producerId')) target = { role: 'PRODUCER', id: url.searchParams.get('producerId')! }
  else if (url.searchParams.get('restaurantId')) target = { role: 'RESTAURANT', id: url.searchParams.get('restaurantId')! }
  if (!target) throw new HttpError(400, 'BAD_REQUEST', 'レビューの対象が指定されていません。')
  return json({ summary: await ratingSummary(target.role, target.id), reviews: await publishedReviewsFor(target.role, target.id) })
})

// レビューを投稿する（取引の当事者だけ・取引完了後・1回だけ）
export const POST = handle(async (request) => {
  const actor = await requireActor(request)
  const body = await readBody(request, reviewSchema)
  const { row, viewer } = await loadMatchFor(actor, body.matchId)
  if (viewer === 'ADMIN') throw new HttpError(403, 'FORBIDDEN', '運営者はレビューを投稿できません。')
  if (row.status !== 'COMPLETED') throw new HttpError(409, 'STATE', 'レビューは、双方が取引完了を確認した後に投稿できます。')
  await requireAllowed('review-create', actor.user.id, 30, 24 * 60 * 60)
  const prisma = getPrisma()
  const exists = await prisma.review.findUnique({ where: { matchId_reviewerRole: { matchId: row.id, reviewerRole: viewer } } })
  if (exists) throw new HttpError(409, 'ALREADY', 'この取引のレビューは、すでに投稿しています。')
  // 評価する相手は、取引の反対側に決まる（自分自身や、他人の取引は評価できない）
  const review = await prisma.review.create({
    data: {
      matchId: row.id,
      reviewerRole: viewer,
      reviewerUserId: actor.user.id,
      targetRole: viewer === 'RESTAURANT' ? 'PRODUCER' : 'RESTAURANT',
      targetId: viewer === 'RESTAURANT' ? row.producerId : row.restaurantId,
      rating: body.rating,
      satisfaction: body.satisfaction,
      politeness: body.politeness,
      smoothness: body.smoothness,
      comment: body.comment ?? '',
    },
  })
  return json({ ok: true, id: review.id }, 201)
})
