import { profileSchema } from '../shared/schemas.js'
import { getActor, requireActor } from './_lib/auth.js'
import { handle, json, readBody } from './_lib/http.js'
import { getPrisma } from './_lib/prisma.js'

// ログイン中の本人の情報。未ログインなら user: null。
export const GET = handle(async (request) => {
  const actor = await getActor(request)
  return json({ user: actor?.user ?? null })
})

// プロフィールの変更。変更できるのは自分の店舗名・農園名・地域と、生産者の公開用連絡先だけ。
// 役割・審査の状態・メールアドレスはここでは変更できない。
export const PATCH = handle(async (request) => {
  const actor = await requireActor(request)
  const body = await readBody(request, profileSchema)
  const prisma = getPrisma()

  await prisma.user.update({ where: { id: actor.user.id }, data: { name: body.orgName, orgName: body.orgName, area: body.area } })
  if (actor.producerId) {
    await prisma.producer.update({
      where: { id: actor.producerId },
      data: {
        farmName: body.orgName,
        area: body.area,
        publicPhone: body.publicPhone === undefined ? undefined : body.publicPhone || null,
        showPhone: body.showPhone,
        publicEmail: body.publicEmail === undefined ? undefined : body.publicEmail || null,
        showEmail: body.showEmail,
        contactNote: body.contactNote === undefined ? undefined : body.contactNote || null,
      },
    })
  } else if (actor.restaurantId) {
    await prisma.restaurant.update({ where: { id: actor.restaurantId }, data: { name: body.orgName, area: body.area } })
  }
  const next = await getActor(request)
  return json({ user: next?.user ?? null })
})
