import { toMilli } from '../../shared/allocate.js'
import { publicAddress } from '../_lib/places.js'
import type { AdminOverview, QueueDetail, QueueItem, ReviewStatus } from '../../shared/dto.js'
import { formatPhone } from '../../shared/phone.js'
import { adminActionSchema } from '../../shared/schemas.js'
import { issueRecoveryCode } from '../_lib/accounts.js'
import { requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { notify } from '../_lib/notify.js'
import { getPrisma } from '../_lib/prisma.js'


// ---- 審査待ち（生産者の登録申請・受渡拠点の登録申請） ----

const addressText = (a: { postalCode: string | null; prefecture: string | null; city?: string | null; town: string | null; addressLine?: string | null; building: string | null }) =>
  [a.postalCode ? `〒${a.postalCode}` : '', a.prefecture ?? '', a.city ?? '', a.town ?? '', a.addressLine ?? '', a.building ?? ''].filter(Boolean).join(' ') || '（未登録）'

/** 未審査の申請（申請日時が古い順）。件数は、実際に確認待ちのものを数える */
async function pendingQueue(): Promise<QueueItem[]> {
  const prisma = getPrisma()
  const [producers, locations] = await Promise.all([
    prisma.producer.findMany({ where: { approvalStatus: 'PENDING' }, include: { user: { select: { username: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.pickupLocation.findMany({ where: { status: 'PENDING' }, include: { createdBy: { include: { user: { select: { username: true } } } } }, orderBy: { createdAt: 'asc' } }),
  ])
  const items: QueueItem[] = [
    ...producers.map((p) => ({
      type: 'PRODUCER' as const,
      id: p.id,
      applicantName: p.farmName,
      username: p.user.username ?? '',
      title: p.farmName,
      summary: `生産者の登録申請・地域：${p.area || '（未登録）'}`,
      submittedAtMs: p.createdAt.getTime(),
      status: p.approvalStatus as ReviewStatus,
      isDemo: p.isDemo,
    })),
    ...locations.map((l) => ({
      type: 'LOCATION' as const,
      id: l.id,
      applicantName: l.createdBy?.farmName ?? '（登録者不明）',
      username: l.createdBy?.user.username ?? '',
      title: l.name,
      summary: `受渡拠点の登録申請・${l.prefecture ?? ''}${l.municipality} ${l.address}${l.showOnMap ? '・地図に公開を希望' : ''}`,
      submittedAtMs: l.createdAt.getTime(),
      status: l.status as ReviewStatus,
      isDemo: l.isDemo,
    })),
  ]
  return items.sort((a, b) => a.submittedAtMs - b.submittedAtMs)
}

async function queueDetail(type: string, id: string): Promise<QueueDetail> {
  const prisma = getPrisma()
  const history = (await prisma.reviewDecision.findMany({ where: { targetType: type, targetId: id }, orderBy: { createdAt: 'desc' } })).map((d) => ({
    decision: d.decision as ReviewStatus,
    reason: d.reason,
    atMs: d.createdAt.getTime(),
  }))
  if (type === 'PRODUCER') {
    const p = await prisma.producer.findUnique({ where: { id }, include: { user: true, _count: { select: { listings: true, locations: true } } } })
    if (!p) throw new HttpError(404, 'NOT_FOUND', '申請が見つかりません。一覧を読み込み直してください。')
    return {
      type: 'PRODUCER',
      id: p.id,
      applicantName: p.farmName,
      username: p.user.username ?? '',
      title: p.farmName,
      summary: `生産者の登録申請・地域：${p.area || '（未登録）'}`,
      submittedAtMs: p.createdAt.getTime(),
      status: p.approvalStatus as ReviewStatus,
      isDemo: p.isDemo,
      fields: [
        { label: '事業者名・表示名', value: p.farmName },
        { label: 'ユーザー名', value: p.user.username ?? '' },
        { label: '地域', value: p.area || '（未登録）' },
        { label: '所在地（非公開）', value: addressText(p) },
        { label: '電話番号（非公開）', value: p.user.phone ? `${formatPhone(p.user.phone)}${p.user.phoneVerified ? '' : '（未確認）'}` : '（未登録）' },
        { label: '登録した出品・受渡拠点', value: `出品 ${p._count.listings}件・受渡拠点 ${p._count.locations}件` },
      ],
      latitude: null,
      longitude: null,
      history,
    }
  }
  if (type === 'LOCATION') {
    const l = await prisma.pickupLocation.findUnique({ where: { id }, include: { createdBy: { include: { user: true } } } })
    if (!l) throw new HttpError(404, 'NOT_FOUND', '申請が見つかりません。一覧を読み込み直してください。')
    return {
      type: 'LOCATION',
      id: l.id,
      applicantName: l.createdBy?.farmName ?? '（登録者不明）',
      username: l.createdBy?.user.username ?? '',
      title: l.name,
      summary: `受渡拠点の登録申請・${l.prefecture ?? ''}${l.municipality} ${l.address}`,
      submittedAtMs: l.createdAt.getTime(),
      status: l.status as ReviewStatus,
      isDemo: l.isDemo,
      fields: [
        { label: '受渡拠点の名称', value: l.name },
        { label: '住所', value: addressText({ ...l, city: l.municipality, addressLine: l.address.replace(l.town ?? '', '') }) },
        { label: '飲食店に表示する住所（取引成立前）', value: `${l.municipality} ${publicAddress(l)}` },
        { label: '受取できる日時の目安', value: l.hours || '（未入力）' },
        { label: '補足', value: l.note || '（なし）' },
        { label: '地図への公開', value: l.showOnMap ? '公開を希望' : '公開しない' },
        { label: '位置', value: l.latitude !== null && l.longitude !== null ? `緯度 ${l.latitude.toFixed(5)}・経度 ${l.longitude.toFixed(5)}` : '（未登録）' },
      ],
      latitude: l.latitude,
      longitude: l.longitude,
      history,
    }
  }
  throw new HttpError(400, 'BAD_REQUEST', '申請の種類が正しくありません。')
}

// 運営者用：審査と停止に必要な一覧。運営者（ADMIN）以外は使えない。
//  ?view=queue：審査待ちの一覧（古い順）／?view=count：審査待ちの件数／?view=item&type=&id=：申請の詳細
export const GET = handle(async (request) => {
  await requireActor(request, 'ADMIN')
  const url = new URL(request.url)
  const view = url.searchParams.get('view')
  if (view === 'queue') {
    const items = await pendingQueue()
    return json({ items, counts: { total: items.length, producer: items.filter((i) => i.type === 'PRODUCER').length, location: items.filter((i) => i.type === 'LOCATION').length } })
  }
  if (view === 'count') {
    const prisma = getPrisma()
    const [producers, locations] = await Promise.all([prisma.producer.count({ where: { approvalStatus: 'PENDING' } }), prisma.pickupLocation.count({ where: { status: 'PENDING' } })])
    return json({ pending: producers + locations })
  }
  if (view === 'item') return json({ item: await queueDetail(url.searchParams.get('type') ?? '', url.searchParams.get('id') ?? '') })
  const prisma = getPrisma()
  const [producers, locations, listings] = await Promise.all([
    prisma.producer.findMany({
      include: { user: { select: { username: true } }, _count: { select: { listings: true } } },
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
      username: p.user.username ?? '',
      approvalStatus: p.approvalStatus,
      createdAtMs: p.createdAt.getTime(),
      listingCount: p._count.listings,
      isDemo: p.isDemo,
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
      isDemo: l.isDemo,
      showOnMap: l.showOnMap,
      latitude: l.latitude,
      longitude: l.longitude,
      hours: l.hours,
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
      isDemo: l.isDemo,
    })),
  }
  return json(overview)
})

// 承認（確認）・停止・却下。停止したものは approve で元に戻せる。
// 生産者・受渡拠点の承認と却下は、審査の記録に残し、申請者にアプリ内で通知する。
export const POST = handle(async (request) => {
  const actor = await requireActor(request, 'ADMIN')
  const body = await readBody(request, adminActionSchema)
  const prisma = getPrisma()

  if (body.target === 'recovery') {
    // 運営者自身や他の運営者のコードは、ここからは発行できない（乗っ取りの連鎖を防ぐ）
    const user = await prisma.user.findUnique({ where: { username: body.username } })
    if (!user || user.role === 'ADMIN') throw new HttpError(404, 'NOT_FOUND', 'そのユーザー名の利用者が見つかりません。')
    const recoveryCode = await issueRecoveryCode(user.id)
    console.warn(`[admin] recovery code reissued for user ${user.id}`)
    return json({ ok: true, recoveryCode })
  }
  if (body.target === 'location' && body.action === 'delete') {
    const used = await prisma.listing.count({ where: { pickupLocationId: body.id } })
    if (used > 0) throw new HttpError(400, 'IN_USE', 'この受渡場所は出品に使われているため削除できません。停止を使ってください。')
    const removed = await prisma.pickupLocation.deleteMany({ where: { id: body.id } })
    if (removed.count === 0) throw new HttpError(404, 'NOT_FOUND', '対象が見つかりません。一覧を読み込み直してください。')
    return json({ ok: true })
  }

  const status = body.action === 'approve' ? 'APPROVED' : body.action === 'reject' ? 'REJECTED' : 'SUSPENDED'
  if (body.action === 'reject' && !body.reason) {
    throw new HttpError(400, 'VALIDATION', '却下の理由を入力してください（申請者に表示されます）。', { reason: '却下の理由を入力してください' })
  }
  const reviewData = body.action === 'approve' || body.action === 'reject' ? { reviewNote: body.action === 'reject' ? body.reason! : null, reviewedAt: new Date() } : {}
  let count = 0
  if (body.target === 'producer') {
    // 却下できるのは、審査待ちの申請だけ
    count = (await prisma.producer.updateMany({ where: { id: body.id, ...(body.action === 'reject' ? { approvalStatus: 'PENDING' } : {}) }, data: { approvalStatus: status, ...reviewData } })).count
  } else if (body.target === 'location') {
    count = (await prisma.pickupLocation.updateMany({ where: { id: body.id, ...(body.action === 'reject' ? { status: 'PENDING' } : {}) }, data: { status, ...reviewData } })).count
  } else {
    // updateMany は updatedAt を変えないため、仕入れ案の無効化は planEligibleWhere の結果の変化で検知される
    count = (await prisma.listing.updateMany({ where: { id: body.id }, data: { adminSuspended: body.action === 'suspend' } })).count
  }
  if (count === 0) throw new HttpError(404, 'NOT_FOUND', '対象が見つからないか、すでに審査が済んでいます。一覧を読み込み直してください。')

  // 審査の記録と、申請者への通知（承認・却下のとき）
  if ((body.target === 'producer' || body.target === 'location') && (body.action === 'approve' || body.action === 'reject')) {
    const approved = body.action === 'approve'
    await prisma.reviewDecision.create({
      data: { targetType: body.target === 'producer' ? 'PRODUCER' : 'LOCATION', targetId: body.id, decision: status, reason: body.reason ?? '', adminUserId: actor.user.id },
    })
    if (body.target === 'producer') {
      const p = await prisma.producer.findUnique({ where: { id: body.id } })
      if (p) {
        await notify(
          p.userId,
          approved ? 'APPLICATION_APPROVED' : 'APPLICATION_REJECTED',
          approved ? '生産者の登録が承認されました' : '生産者の登録の申請が却下されました',
          approved ? '出品が飲食店の仕入れ案・検索の対象になります。' : `理由：${body.reason}（マイページで内容を直して保存すると、再申請になります）`,
          '/account',
          null,
        )
      }
    } else {
      const l = await prisma.pickupLocation.findUnique({ where: { id: body.id }, include: { createdBy: true } })
      if (l?.createdBy) {
        await notify(
          l.createdBy.userId,
          approved ? 'APPLICATION_APPROVED' : 'APPLICATION_REJECTED',
          approved ? `受渡拠点「${l.name}」が承認されました` : `受渡拠点「${l.name}」の申請が却下されました`,
          approved ? 'この拠点を使う出品が、仕入れ案・検索の対象になります。' : `理由：${body.reason}（「受渡拠点」で内容を直して保存すると、再申請になります）`,
          '/producer/locations',
          null,
        )
      }
    }
  }
  return json({ ok: true })
})
