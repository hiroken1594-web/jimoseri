import { APIError } from 'better-auth/api'
import { createHash, timingSafeEqual } from 'node:crypto'
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

  if (mode === 'invite' && !sameText(body.inviteCode ?? '', process.env.SIGNUP_INVITE_CODE ?? '')) {
    throw new HttpError(403, 'BAD_INVITE', '招待コードが正しくありません。', { inviteCode: '招待コードが正しくありません。' })
  }

  // 自動登録・ユーザー名の探索の対策：同じ接続元からの登録回数を制限する
  await requireAllowed('signup-ip', clientIp(request), 5, 60 * 60)

  // Better Auth は、失敗を「応答」で返す場合と「例外」で返す場合がある。どちらも同じ扱いにする。
  let response: Response | null = null
  let failure: { code?: string; message?: string } | null = null
  try {
    response = await registerAccount({
      username: body.username,
      password: body.password,
      role: body.role,
      orgName: body.orgName,
      area: body.area,
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
  const recoveryCode = await issueRecoveryCode(user.id)

  // Better Auth が発行したログイン用 Cookie を、そのままブラウザへ渡す
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie)
  return new Response(JSON.stringify({ recoveryCode }), { status: 201, headers })
})
