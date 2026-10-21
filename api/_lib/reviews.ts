// 相互レビューの公開の判定と、平均評価
import type { RatingSummary, ReviewDto } from '../../shared/dto.js'
import { REVIEW_PUBLISH_DAYS } from '../../shared/trade.js'
import type { Prisma } from '../../generated/prisma/client.js'
import { getPrisma } from './prisma.js'

const DAY_MS = 24 * 60 * 60 * 1000

type ReviewRow = Prisma.ReviewGetPayload<{ include: { match: { include: { restaurant: true; producer: true } } } }>

/** 取引が完了した日時（双方が確認したうちの遅いほう） */
export function completedAtMs(m: { restaurantCompletedAt: Date | null; producerCompletedAt: Date | null }): number | null {
  if (!m.restaurantCompletedAt || !m.producerCompletedAt) return null
  return Math.max(m.restaurantCompletedAt.getTime(), m.producerCompletedAt.getTime())
}

/**
 * レビューを公開してよいか：運営者が非公開にしていない、かつ
 * 「双方が投稿した」または「取引完了から一定の日数が過ぎた」。
 * 相手のレビューを見てから自分の評価を変える、といったことが起きないようにする。
 */
export function isPublished(review: { hidden: boolean }, bothSubmitted: boolean, doneAtMs: number | null, nowMs = Date.now()): boolean {
  if (review.hidden) return false
  if (bothSubmitted) return true
  return doneAtMs !== null && nowMs - doneAtMs >= REVIEW_PUBLISH_DAYS * DAY_MS
}

export function toReviewDto(r: ReviewRow): ReviewDto {
  return {
    id: r.id,
    reviewerRole: r.reviewerRole === 'PRODUCER' ? 'PRODUCER' : 'RESTAURANT',
    reviewerName: r.reviewerRole === 'PRODUCER' ? r.match.producer.farmName : r.match.restaurant.name,
    rating: r.rating,
    satisfaction: r.satisfaction,
    politeness: r.politeness,
    smoothness: r.smoothness,
    comment: r.comment,
    createdAtMs: r.createdAt.getTime(),
  }
}

/** ある生産者・飲食店が受けた、公開中のレビュー（新しい順） */
export async function publishedReviewsFor(targetRole: 'PRODUCER' | 'RESTAURANT', targetId: string): Promise<ReviewDto[]> {
  const prisma = getPrisma()
  const rows = await prisma.review.findMany({
    where: { targetRole, targetId },
    include: { match: { include: { restaurant: true, producer: true, reviews: { select: { id: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return rows.filter((r) => isPublished(r, r.match.reviews.length >= 2, completedAtMs(r.match))).map(toReviewDto)
}

export async function ratingSummary(targetRole: 'PRODUCER' | 'RESTAURANT', targetId: string): Promise<RatingSummary | null> {
  const reviews = await publishedReviewsFor(targetRole, targetId)
  if (reviews.length === 0) return null
  return { average: Math.round((reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) * 10) / 10, count: reviews.length }
}
