import { createHash } from 'node:crypto'
import { toMilli, type ListingCandidate } from '../../shared/allocate.js'
import type { ListingBlocker, ListingDto } from '../../shared/dto.js'
import type { Prisma } from '../../generated/prisma/client.js'

export const listingInclude = {
  item: true,
  pickupLocation: true,
  producer: { include: { user: true } },
} satisfies Prisma.ListingInclude

type ListingRow = Prisma.ListingGetPayload<{ include: typeof listingInclude }>

/**
 * 飲食店の仕入れ案に使ってよい出品の条件（03_spec_addendum.md 7章）。
 * 承認済みの生産者・確認済みの受渡場所・運営者に停止されていない出品だけ。
 */
export function planEligibleWhere(itemId: string): Prisma.ListingWhereInput {
  return {
    itemId,
    adminSuspended: false,
    // デモデータ（お試し用）は、実際の飲食店の仕入れ案に混ぜない
    isDemo: false,
    producer: { approvalStatus: 'APPROVED', isDemo: false, user: { suspended: false } },
    pickupLocation: { status: 'APPROVED', isDemo: false },
  }
}

/** 出品が仕入れ案の対象になっていない理由（生産者本人への表示用） */
export function listingBlockers(row: ListingRow): ListingBlocker[] {
  const blockers: ListingBlocker[] = []
  if (row.producer.approvalStatus === 'PENDING') blockers.push('PRODUCER_PENDING')
  if (row.producer.approvalStatus === 'SUSPENDED' || row.producer.user.suspended) blockers.push('PRODUCER_SUSPENDED')
  if (row.pickupLocation.status === 'PENDING') blockers.push('LOCATION_PENDING')
  if (row.pickupLocation.status === 'SUSPENDED') blockers.push('LOCATION_SUSPENDED')
  if (row.adminSuspended) blockers.push('ADMIN_SUSPENDED')
  return blockers
}

export function toCandidate(row: ListingRow): ListingCandidate {
  return {
    id: row.id,
    producerId: row.producerId,
    producerName: row.producer.farmName,
    itemId: row.itemId,
    variety: row.variety,
    unit: row.unit,
    grade: row.grade,
    irregularReason: row.irregularReason,
    quantityMilli: toMilli(Number(row.quantity)),
    minMilli: toMilli(Number(row.minQuantity)),
    stepMilli: toMilli(Number(row.stepQuantity)),
    unitPriceYen: row.unitPriceTaxIncl,
    pickupPointId: row.pickupLocationId,
    pickupPointName: row.pickupLocation.name,
    area: row.pickupLocation.municipality,
    pickupStartMs: row.pickupStart.getTime(),
    pickupEndMs: row.pickupEnd.getTime(),
    isPublished: row.isPublished,
    updatedAtMs: row.updatedAt.getTime(),
  }
}

export function toListingDto(row: ListingRow): ListingDto {
  const c = toCandidate(row)
  return {
    id: c.id,
    itemId: c.itemId,
    itemName: row.item.name,
    variety: c.variety,
    grade: c.grade,
    irregularReason: c.irregularReason,
    quantityMilli: c.quantityMilli,
    unit: c.unit,
    unitPriceYen: c.unitPriceYen,
    minMilli: c.minMilli,
    stepMilli: c.stepMilli,
    pickupLocationId: c.pickupPointId,
    pickupLocationName: c.pickupPointName,
    pickupStartMs: c.pickupStartMs,
    pickupEndMs: c.pickupEndMs,
    isPublished: c.isPublished,
    updatedAtMs: c.updatedAtMs,
    blockers: listingBlockers(row),
    isDemo: row.isDemo,
  }
}

/**
 * ある品目について「いま仕入れ案に使える出品の状態」を1つの値にまとめる。
 * 数量・価格などの変更、公開停止、新規出品、期限切れ、審査状態の変化のいずれでも値が変わるので、
 * 古い仕入れ案を検知できる。
 */
export function computeFingerprint(candidates: ListingCandidate[], nowMs: number): string {
  const parts = candidates
    .filter((l) => l.isPublished && l.quantityMilli > 0 && l.pickupEndMs > nowMs)
    .map((l) => `${l.id}:${l.updatedAtMs}:${l.quantityMilli}`)
    .sort()
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)
}
