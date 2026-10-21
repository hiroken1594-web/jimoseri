// アプリ内の通知（ベルのマーク）。本人の通知だけを返す。
import type { NotificationDto } from '../../shared/dto.js'
import { notificationReadSchema } from '../../shared/schemas.js'
import { requireActor } from '../_lib/auth.js'
import { handle, json, readBody } from '../_lib/http.js'
import { getPrisma } from '../_lib/prisma.js'

// 通知の一覧（新しい順に100件）と未読の数。?count=1 なら未読の数だけ
export const GET = handle(async (request) => {
  const actor = await requireActor(request)
  const prisma = getPrisma()
  const unread = await prisma.notification.count({ where: { userId: actor.user.id, readAt: null } })
  if (new URL(request.url).searchParams.get('count') === '1') return json({ unread })
  const rows = await prisma.notification.findMany({ where: { userId: actor.user.id }, orderBy: { createdAt: 'desc' }, take: 100 })
  const notifications: NotificationDto[] = rows.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    read: n.readAt !== null,
    createdAtMs: n.createdAt.getTime(),
  }))
  return json({ notifications, unread })
})

// 既読にする（ids を指定、または all: true で全部）
export const PATCH = handle(async (request) => {
  const actor = await requireActor(request)
  const body = await readBody(request, notificationReadSchema)
  const prisma = getPrisma()
  await prisma.notification.updateMany({
    where: { userId: actor.user.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) },
    data: { readAt: new Date() },
  })
  return json({ unread: await prisma.notification.count({ where: { userId: actor.user.id, readAt: null } }) })
})
