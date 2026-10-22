import { APIError } from 'better-auth/api'
import { createHash, timingSafeEqual } from 'node:crypto'
import { formatZip, normalizeZip } from '../../shared/geo.js'
import { signupSchema } from '../../shared/schemas.js'
import { issueRecoveryCode, registerAccount } from '../_lib/accounts.js'
import { signupMode } from '../_lib/config.js'
import { handle, HttpError, readBody } from '../_lib/http.js'
import { getPrisma } from '../_lib/prisma.js'
import { clientIp, requireAllowed } from '../_lib/throttle.js'

function sameText(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

// 新規登録。成功するとログイン状態になり、リカバリーコードを一度だけ返す。
export const POST = handle(async (request) => {
  const mode = signupMode()
  if (mode === 'closed') throw new HttpError(403, 'SIGNUP_CLOSED', '現在、新規登録の受け付けを準備中です。')

  const body = await readBody(request, signupSchema)
  // 人には見えない入力欄。埋まっていれば自動送信とみなす。
  if (body.website) throw new HttpError(400, 'BAD_REQUEST', '登録できませんでした。')

  // 招待コードの総当たりを防ぐため、照合の前にも接続元ごとの回数を制限する
  if (mode === 'invite') await requireAllowed('signup-invite-ip', clientIp(request), 20, 60 * 60)
  if (mode === 'invite' && !sameText(body.inviteCode ?? '', process.env.SIGNUP_INVITE_CODE ?? '')) {
    throw new HttpError(403, 'BAD_INVITE', '招待コードが正しくありません。', { inviteCode: '招待コードが正しくありません。' })
  }

  // 自動登録・ユーザー名の探索の対策：同じ接続元からの登録回数を制限する
  await requireAllowed('signup-ip', clientIp(request), 5, 60 * 60)
  const zip = normalizeZip(body.postalCode)
  if (!zip) throw new HttpError(400, 'BAD_REQUEST', '郵便番号は7桁の数字で入力してください', { postalCode: '郵便番号は7桁の数字で入力してください' })
  const area = (body.area || body.city || body.prefecture || '').trim().slice(0, 40)
  if (!area) throw new HttpError(400, 'BAD_REQUEST', '市区町村を入力してください', { city: '市区町村を入力してください' })

  // Better Auth は、失敗を「応答」で返す場合と「例外」で返す場合がある。どちらも同じ扱いにする。
  let response: Response | null = null
  let failure: { code?: string; message?: string } | null = null
  try {
    response = await registerAccount({
      username: body.username,
      password: body.password,
      role: body.role,
      orgName: body.orgName,
      area,
    })
    if (!response.ok) failure = ((await response.json().catch(() => null)) as typeof failure) ?? {}
  } catch (error) {
    if (!(error instanceof APIError)) throw error
    failure = (error.body as typeof failure) ?? {}
  }
  if (failure || !response) {
    if (failure?.code === 'USERNAME_IS_ALREADY_TAKEN' || failure?.code?.startsWith('USER_ALREADY_EXISTS')) {
      throw new HttpError(409, 'USERNAME_TAKEN', 'このユーザー名は既に使われています。別の名前にしてください。', {
        username: 'このユーザー名は既に使われています。',
      })
    }
    // サーバー側で付けた日本語のメッセージはそのまま返す
    const message = failure?.message && /[ぁ-んァ-ン一-龥]/.test(failure.message) ? failure.message : '登録できませんでした。入力内容を確認してください。'
    throw new HttpError(400, 'SIGNUP_FAILED', message)
  }

  const user = await getPrisma().user.findUnique({ where: { username: body.username } })
  if (!user) throw new HttpError(500, 'INTERNAL', '登録を完了できませんでした。もう一度お試しください。')
  // 店舗・農園の情報を、登録時の住所とあわせて作る（住所は本人と運営者だけが見る）
  const prisma = getPrisma()
  const address = {
    postalCode: formatZip(zip),
    prefecture: body.prefecture || null,
    city: body.city || null,
    town: body.town || null,
    addressLine: body.addressLine || null,
    building: body.building,
  }
  if (body.role === 'PRODUCER') {
    await prisma.producer.upsert({ where: { userId: user.id }, create: { userId: user.id, farmName: body.orgName, area, ...address }, update: address })
  } else {
    await prisma.restaurant.upsert({ where: { userId: user.id }, create: { userId: user.id, name: body.orgName, area, ...address }, update: address })
  }
  // 電話番号（数字だけにそろえた値。他の利用者には原則として非公開）と、取引相手に見せる範囲
  await prisma.user.update({ where: { id: user.id }, data: { phone: body.phone, phoneVerified: false, phoneShare: body.phoneShare ?? 'NONE' } })
  const recoveryCode = await issueRecoveryCode(user.id)

  // Better Auth が発行したログイン用 Cookie を、そのままブラウザへ渡す
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie)
  return new Response(JSON.stringify({ recoveryCode }), { status: 201, headers })
})
