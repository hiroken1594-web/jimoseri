import { toMilli } from '../shared/allocate.js'
import type { AdminOverview } from '../shared/dto.js'
import { adminActionSchema } from '../shared/schemas.js'
import { requireActor } from './_lib/auth.js'
import { handle, HttpError, json, readBody } from './_lib/http.js'
import { getPrisma } from './_lib/prisma.js'

// 運営者用：審査と停止に必要な一覧。運営者（ADMIN）以外は使えない。
export const GET = handle(async (request) => {
  await requireActor(request, 'ADMIN')
  const prisma = getPrisma()
  const [producers, locations, listings] = await Promise.all([
    prisma.producer.findMany({
      include: { user: { select: { email: true } }, _count: { select: { listings: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.pickupLocation.findMany({ include: { createdBy: true }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.listing.findMany({
      where: { pickupEnd: { gt: new Date() } },
      include: { item: true, producer: true, pickupLocation: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ])
  const overview: AdminOverview = {
    producers: producers.map((p) => ({
      id: p.id,
      farmName: p.farmName,
      area: p.area,
      email: p.user.email,
      approvalStatus: p.approvalStatus,
      createdAtMs: p.createdAt.getTime(),
      listingCount: p._count.listings,
    })),
    locations: locations.map((l) => ({
      id: l.id,
      name: l.name,
      municipality: l.municipality,
      address: l.address,
      note: l.note,
      status: l.status,
      createdByName: l.createdBy?.farmName ?? null,
      createdAtMs: l.createdAt.getTime(),
    })),
    listings: listings.map((l) => ({
      id: l.id,
      itemName: l.item.name,
      farmName: l.producer.farmName,
      quantityMilli: toMilli(Number(l.quantity)),
      unit: l.unit,
      unitPriceYen: l.unitPriceTaxIncl,
      pickupLocationName: l.pickupLocation.name,
      pickupStartMs: l.pickupStart.getTime(),
      isPublished: l.isPublished,
      adminSuspended: l.adminSuspended,
    })),
  }
  return json(overview)
})

// 承認（確認）・停止。停止したものは approve で元に戻せる。
export const POST = handle(async (request) => {
  await requireActor(request, 'ADMIN')
  const body = await readBody(request, adminActionSchema)
  const prisma = getPrisma()
  const status = body.action === 'approve' ? 'APPROVED' : 'SUSPENDED'
  let count = 0
  if (body.target === 'producer') {
    count = (await prisma.producer.updateMany({ where: { id: body.id }, data: { approvalStatus: status } })).count
  } else if (body.target === 'location') {
    count = (await prisma.pickupLocation.updateMany({ where: { id: body.id }, data: { status } })).count
  } else {
    // updateMany は updatedAt を変えないため、仕入れ案の無効化は planEligibleWhere の結果の変化で検知される
    count = (await prisma.listing.updateMany({ where: { id: body.id }, data: { adminSuspended: body.action === 'suspend' } })).count
  }
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', '対象が見つかりません。一覧を読み込み直してください。')
  return json({ ok: true })
})
