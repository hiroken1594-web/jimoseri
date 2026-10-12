// 「誰が操作しているか」をサーバー側で確かめる。すべての業務 API はここを通る。
import type { Role, SessionUser } from '../../shared/dto.js'
import { getAuth } from './auth-server.js'
import { HttpError } from './http.js'
import { getPrisma } from './prisma.js'

export interface Actor {
  user: SessionUser
  producerId: string | null
  restaurantId: string | null
}

const isRole = (value: unknown): value is Role => value === 'RESTAURANT' || value === 'PRODUCER' || value === 'ADMIN'

export async function getActor(request: Request): Promise<Actor | null> {
  const session = await getAuth().api.getSession({ headers: request.headers })
  if (!session) return null
  const prisma = getPrisma()
  // セッションの写しではなく、DB の最新の役割・停止状態を使う
  let user = await prisma.user.findUnique({ where: { id: session.user.id }, include: { producer: true, restaurant: true } })
  if (!user || !user.username || !isRole(user.role)) return null

  // 初回アクセス時に、登録フォームの内容から農園・店舗の情報を作る。
  // 同時に複数のリクエストが来ても二重に作らないよう、重複は無視する。
  const orgName = (user.orgName || user.name).slice(0, 40)
  const area = (user.area || '').slice(0, 40)
  if (user.role === 'PRODUCER' && !user.producer) {
    await prisma.producer.createMany({ data: [{ userId: user.id, farmName: orgName, area }], skipDuplicates: true })
    user = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { producer: true, restaurant: true } })
  } else if (user.role === 'RESTAURANT' && !user.restaurant) {
    await prisma.restaurant.createMany({ data: [{ userId: user.id, name: orgName, area }], skipDuplicates: true })
    user = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { producer: true, restaurant: true } })
  }

  const p = user.producer
  return {
    user: {
      id: user.id,
      role: user.role as Role,
      username: user.username ?? '',
      orgName: p?.farmName ?? user.restaurant?.name ?? orgName,
      area: p?.area ?? user.restaurant?.area ?? area,
      suspended: user.suspended,
      producer: p
        ? {
            approvalStatus: p.approvalStatus,
            publicPhone: p.publicPhone,
            showPhone: p.showPhone,
            publicEmail: p.publicEmail,
            showEmail: p.showEmail,
            contactNote: p.contactNote,
          }
        : null,
    },
    producerId: p?.id ?? null,
    restaurantId: user.restaurant?.id ?? null,
  }
}

/** ログイン済み・停止されていない・指定した役割であることを確認する。 */
export async function requireActor(request: Request, role?: Role): Promise<Actor> {
  const actor = await getActor(request)
  if (!actor) throw new HttpError(401, 'UNAUTHENTICATED', 'ログインしてください（ログインの有効期限が切れた可能性があります）。')
  if (actor.user.suspended) throw new HttpError(403, 'SUSPENDED', 'このアカウントは運営者により利用が停止されています。')
  if (role && actor.user.role !== role) {
    const who = { PRODUCER: '生産者', RESTAURANT: '飲食店', ADMIN: '運営者' }[role]
    throw new HttpError(403, 'FORBIDDEN', `この操作は${who}のアカウントでのみ行えます。`)
  }
  return actor
}
