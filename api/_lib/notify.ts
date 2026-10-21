// アプリ内の通知と、チャットに残す取引の記録（システムメッセージ）
import { randomUUID } from 'node:crypto'
import type { NotificationKind, Role } from '../../generated/prisma/client.js'
import { getPrisma } from './prisma.js'

/** 通知を1件作る。新着メッセージは、同じ取引の未読の通知があれば1件にまとめる（通知が増えすぎないように） */
export async function notify(userId: string, kind: NotificationKind, title: string, body: string, link: string, matchId: string | null): Promise<void> {
  const prisma = getPrisma()
  if (kind === 'NEW_MESSAGE' && matchId) {
    const existing = await prisma.notification.findFirst({ where: { userId, kind, matchId, readAt: null } })
    if (existing) {
      await prisma.notification.update({ where: { id: existing.id }, data: { title, body, createdAt: new Date() } })
      return
    }
  }
  await prisma.notification.create({ data: { userId, kind, title, body: body.slice(0, 200), link, matchId } })
}

/** 承認・合意・完了などを、チャットの流れの中に記録する */
export async function systemMessage(matchId: string, role: Role, body: string, proposalId: string | null = null): Promise<void> {
  await getPrisma().chatMessage.create({
    data: { matchId, senderRole: role, senderUserId: null, kind: proposalId ? 'PROPOSAL' : 'SYSTEM', proposalId, body, clientId: `system-${randomUUID()}` },
  })
}
