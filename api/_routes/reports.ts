// 通報。利用者は送るだけで、内容は運営者だけが見る。通報した人は、通報された側に知らされない。
// 通報があっただけで自動的に停止はせず、運営者が内容を確認して判断する。
import type { ReportItem } from '../../shared/dto.js'
import { reportCreateSchema, reportUpdateSchema } from '../../shared/schemas.js'
import { forbidDemo, requireActor } from '../_lib/auth.js'
import { handle, HttpError, json, readBody } from '../_lib/http.js'
import { getPrisma } from '../_lib/prisma.js'
import { requireAllowed } from '../_lib/throttle.js'

const STATUS_LABEL = { OPEN: '未対応', IN_REVIEW: '確認中', RESOLVED: '対応済み', REJECTED: '却下' } as const

// 通報を送る（ログイン中の生産者・飲食店）
export const POST = handle(async (request) => {
  const actor = await requireActor(request)
  forbidDemo(actor)
  if (actor.user.role === 'ADMIN') throw new HttpError(403, 'FORBIDDEN', '運営者のアカウントからは通報できません。')
  const body = await readBody(request, reportCreateSchema)
  const prisma = getPrisma()

  // 対象が存在し、通報する人が見られるものかを確かめ、名前はサーバー側で決める（送られてきた名前は使わない）
  let targetLabel: string
  if (body.targetType === 'LISTING') {
    const listing = await prisma.listing.findFirst({
      where: { id: body.targetId, isDemo: false, producer: { approvalStatus: 'APPROVED' }, pickupLocation: { status: 'APPROVED' } },
      include: { item: true, producer: true },
    })
    if (!listing) throw new HttpError(404, 'NOT_FOUND', '通報する出品が見つかりません。')
    if (listing.producerId === actor.producerId) throw new HttpError(400, 'SELF', '自分の出品は通報できません。')
    targetLabel = `${listing.item.name}（${listing.producer.farmName}）`
  } else if (body.targetType === 'PRODUCER') {
    const producer = await prisma.producer.findFirst({ where: { id: body.targetId, approvalStatus: 'APPROVED', isDemo: false } })
    if (!producer) throw new HttpError(404, 'NOT_FOUND', '通報する生産者が見つかりません。')
    if (producer.id === actor.producerId) throw new HttpError(400, 'SELF', '自分のアカウントは通報できません。')
    targetLabel = producer.farmName
  } else if (body.targetType === 'REVIEW') {
    // 自分が受けたレビュー（取引相手が書いたもの）だけを通報できる
    const review = await prisma.review.findUnique({ where: { id: body.targetId }, include: { match: { include: { restaurant: true, producer: true } } } })
    const mineAsTarget =
      review && ((review.targetRole === 'PRODUCER' && review.targetId === actor.producerId) || (review.targetRole === 'RESTAURANT' && review.targetId === actor.restaurantId))
    if (!review || !mineAsTarget) throw new HttpError(404, 'NOT_FOUND', '通報するレビューが見つかりません。')
    targetLabel = `${review.reviewerRole === 'PRODUCER' ? review.match.producer.farmName : review.match.restaurant.name}のレビュー（★${review.rating}）「${review.comment.slice(0, 40)}」`
  } else {
    // 飲食店のプロフィールは他の利用者に公開していないため、確認できる画面ができるまで受け付けない
    throw new HttpError(400, 'UNSUPPORTED', '飲食店アカウントの通報は、現在受け付けていません。運営者へ直接お問い合わせください。')
  }

  // 同じ対象への重複通報を防ぐ（対応が終わるまでは1件にまとめる）
  const duplicate = await prisma.report.findFirst({
    where: { reporterId: actor.user.id, targetType: body.targetType, targetId: body.targetId, status: { in: ['OPEN', 'IN_REVIEW'] } },
  })
  if (duplicate) throw new HttpError(409, 'DUPLICATE', 'この対象への通報は既に受け付けています。運営者の確認をお待ちください。')
  await requireAllowed('report-create', actor.user.id, 10, 24 * 60 * 60)

  await prisma.report.create({
    data: {
      reporterId: actor.user.id,
      targetType: body.targetType,
      targetId: body.targetId,
      targetLabel,
      reason: body.reason,
      detail: body.detail ?? '',
      actions: { create: { actorName: '（システム）', action: '通報を受け付けました' } },
    },
  })
  // 受付の結果だけを返す（通報の内容や件数は返さない）
  return json({ ok: true }, 201)
})

async function targetState(type: string, id: string): Promise<ReportItem['targetState']> {
  const prisma = getPrisma()
  if (type === 'LISTING') {
    const l = await prisma.listing.findUnique({ where: { id }, select: { adminSuspended: true } })
    return !l ? 'DELETED' : l.adminSuspended ? 'SUSPENDED' : 'ACTIVE'
  }
  if (type === 'PRODUCER') {
    const p = await prisma.producer.findUnique({ where: { id }, select: { approvalStatus: true } })
    return !p ? 'DELETED' : p.approvalStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE'
  }
  if (type === 'REVIEW') {
    const v = await prisma.review.findUnique({ where: { id }, select: { hidden: true } })
    return !v ? 'DELETED' : v.hidden ? 'SUSPENDED' : 'ACTIVE'
  }
  const r = await prisma.restaurant.findUnique({ where: { id }, include: { user: { select: { suspended: true } } } })
  return !r ? 'DELETED' : r.user.suspended ? 'SUSPENDED' : 'ACTIVE'
}

// 運営者：通報の一覧（?status=OPEN など）
export const GET = handle(async (request) => {
  await requireActor(request, 'ADMIN')
  const status = new URL(request.url).searchParams.get('status')
  const rows = await getPrisma().report.findMany({
    where: status && status in STATUS_LABEL ? { status: status as keyof typeof STATUS_LABEL } : {},
    include: { reporter: { select: { username: true } }, actions: { orderBy: { createdAt: 'asc' } } },
    orderBy: [{ createdAt: 'desc' }],
    take: 200,
  })
  const reports: ReportItem[] = []
  for (const r of rows) {
    reports.push({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      targetLabel: r.targetLabel,
      targetState: await targetState(r.targetType, r.targetId),
      reason: r.reason,
      detail: r.detail,
      status: r.status,
      reporterName: r.reporter?.username ?? '（退会済み）',
      createdAtMs: r.createdAt.getTime(),
      updatedAtMs: r.updatedAt.getTime(),
      actions: r.actions.map((a) => ({ actorName: a.actorName, action: a.action, note: a.note, createdAtMs: a.createdAt.getTime() })),
    })
  }
  return json({ reports })
})

// 運営者：対応状況の変更・メモ・対象の停止／解除。すべて対応履歴に残す。
export const PATCH = handle(async (request) => {
  const actor = await requireActor(request, 'ADMIN')
  const body = await readBody(request, reportUpdateSchema)
  const prisma = getPrisma()
  const report = await prisma.report.findUnique({ where: { id: body.id } })
  if (!report) throw new HttpError(404, 'NOT_FOUND', '通報が見つかりません。一覧を読み込み直してください。')
  const actorName = actor.user.username
  const logs: { action: string; note: string }[] = []

  if (body.targetAction) {
    const suspend = body.targetAction === 'suspend'
    let count = 0
    if (report.targetType === 'LISTING') {
      count = (await prisma.listing.updateMany({ where: { id: report.targetId }, data: { adminSuspended: suspend } })).count
    } else if (report.targetType === 'PRODUCER') {
      count = (await prisma.producer.updateMany({ where: { id: report.targetId }, data: { approvalStatus: suspend ? 'SUSPENDED' : 'APPROVED' } })).count
    } else if (report.targetType === 'REVIEW') {
      // レビューの「停止」は非公開にすること（削除はしない）
      count = (await prisma.review.updateMany({ where: { id: report.targetId }, data: { hidden: suspend } })).count
    } else {
      const r = await prisma.restaurant.findUnique({ where: { id: report.targetId } })
      if (r) count = (await prisma.user.updateMany({ where: { id: r.userId, role: { not: 'ADMIN' } }, data: { suspended: suspend } })).count
    }
    if (count === 0) throw new HttpError(404, 'NOT_FOUND', '対象が見つかりません（削除された可能性があります）。')
    logs.push({ action: suspend ? '対象を停止しました' : '対象の停止を解除しました', note: '' })
  }
  if (body.status && body.status !== report.status) {
    logs.push({ action: `対応状況を「${STATUS_LABEL[report.status]}」から「${STATUS_LABEL[body.status]}」に変更しました`, note: '' })
  }
  if (body.note) logs.push({ action: 'メモを追加しました', note: body.note })
  if (logs.length === 0) throw new HttpError(400, 'VALIDATION', '変更内容がありません。')

  await prisma.report.update({
    where: { id: report.id },
    data: {
      status: body.status ?? report.status,
      actions: { create: logs.map((l) => ({ ...l, actorName })) },
    },
  })
  return json({ ok: true })
})
