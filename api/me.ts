import { profileSchema, usernameChangeSchema } from '../shared/schemas.js'
import { checkPassword, placeholderEmail } from './_lib/accounts.js'
import { getActor, requireActor } from './_lib/auth.js'
import { handle, HttpError, json, readBody } from './_lib/http.js'
import { requireAllowed } from './_lib/throttle.js'
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

// ユーザー名の変更。変えられるのはログイン中の本人のユーザー名だけ（対象は常にセッションの利用者）。
// 出品・履歴・審査の状態などは利用者の ID にひも付いているため、変更しても引き継がれる。
export const PUT = handle(async (request) => {
  const actor = await requireActor(request)
  const body = await readBody(request, usernameChangeSchema)
  // 使われている名前を次々に調べられないよう、回数を制限する
  await requireAllowed('rename-user', actor.user.id, 10, 60 * 60)
  if (!(await checkPassword(actor.user.id, body.password))) {
    throw new HttpError(400, 'BAD_PASSWORD', '現在のパスワードが違います。', { password: '現在のパスワードが違います。' })
  }
  if (body.username === actor.user.username) {
    throw new HttpError(400, 'VALIDATION', '現在と同じユーザー名です。', { username: '現在と同じユーザー名です。' })
  }
  const prisma = getPrisma()
  const taken = () => new HttpError(409, 'USERNAME_TAKEN', 'このユーザー名は既に使われています。別の名前にしてください。', { username: 'このユーザー名は既に使われています。' })
  if (await prisma.user.findUnique({ where: { username: body.username } })) throw taken()
  try {
    await prisma.user.update({
      where: { id: actor.user.id },
      // 内部用のメール欄（実在しない形式の値）も、ユーザー名に合わせて付け替える
      data: { username: body.username, displayUsername: body.username, email: placeholderEmail(body.username) },
    })
  } catch (error) {
    // 確認と更新の間に、他の人が同じ名前を取った場合
    if ((error as { code?: string }).code === 'P2002') throw taken()
    throw error
  }
  const next = await getActor(request)
  return json({ user: next?.user ?? null })
})
