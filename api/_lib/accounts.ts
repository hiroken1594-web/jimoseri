// アカウントの登録と、メールを使わないパスワード再設定（リカバリーコード）。
// パスワードの保存・照合・セッションは Better Auth に任せ、ここではリカバリーコードだけを扱う。
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getAuth } from './auth-server.js'
import { getPrisma } from './prisma.js'

// 読み間違えやすい文字（I・L・O・U）を除いた32文字
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 20 // 32^20 = 100ビット

/** 安全な乱数でリカバリーコードを作る（例: 7K2M-9QXD-...） */
export function generateRecoveryCode(): string {
  // 256 は 32 の倍数なので、1バイトの下位5ビットをそのまま使っても偏らない
  const chars = [...randomBytes(CODE_LENGTH)].map((b) => ALPHABET[b & 31])
  return chars.join('').replace(/(.{4})(?=.)/g, '$1-')
}

/** 入力の揺れ（小文字・ハイフン・空白・O/I/L の打ち間違い）をならす */
export function normalizeRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/[^0-9A-Z]/g, '')
}

/** DB に保存するのはこの値だけ。コードそのものは保存しない。 */
function hashRecoveryCode(code: string): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set')
  return createHmac('sha256', secret).update(`recovery:${normalizeRecoveryCode(code)}`).digest('hex')
}

/** 新しいコードを発行する。それまでのコードは無効になる。戻り値は一度だけ利用者に表示する。 */
export async function issueRecoveryCode(userId: string): Promise<string> {
  const code = generateRecoveryCode()
  const codeHash = hashRecoveryCode(code)
  await getPrisma().recoveryCode.upsert({
    where: { userId },
    update: { codeHash, createdAt: new Date() },
    create: { userId, codeHash },
  })
  return code
}

/** ユーザー名とコードが合っていれば、そのユーザーの ID を返す。 */
export async function verifyRecoveryCode(username: string, code: string): Promise<string | null> {
  const user = await getPrisma().user.findUnique({ where: { username }, include: { recoveryCode: true } })
  // ユーザーが存在しない場合も同じ計算を行い、応答時間から存在の有無を推測されないようにする
  const expected = Buffer.from(user?.recoveryCode?.codeHash ?? hashRecoveryCode('0000-0000-0000-0000-0000'), 'hex')
  const actual = Buffer.from(hashRecoveryCode(code), 'hex')
  const matches = timingSafeEqual(expected, actual)
  return matches && user?.recoveryCode && !user.suspended ? user.id : null
}

/** パスワードを設定し直し、すべての端末のログインを無効にする。 */
export async function setPassword(userId: string, newPassword: string): Promise<void> {
  const ctx = await getAuth().$context
  const hash = await ctx.password.hash(newPassword)
  await ctx.internalAdapter.updatePassword(userId, hash)
  // 他の端末を含め、すべてのログインを無効にする
  await getPrisma().session.deleteMany({ where: { userId } })
}

/** 現在のパスワードが正しいか確かめる（リカバリーコードの再発行の前に使う） */
export async function checkPassword(userId: string, password: string): Promise<boolean> {
  const ctx = await getAuth().$context
  const accounts = await ctx.internalAdapter.findAccounts(userId)
  const hash = accounts.find((a) => a.providerId === 'credential')?.password
  if (!hash) return false
  return ctx.password.verify({ hash, password })
}

/** Better Auth は内部でメールアドレスの欄を必要とするため、実在しない形式の値を入れておく。メールは一切送らない。 */
export function placeholderEmail(username: string): string {
  return `${username}@users.jimoseri.invalid`
}

export interface NewAccount {
  username: string
  password: string
  role: 'RESTAURANT' | 'PRODUCER'
  orgName: string
  area: string
}

/** 登録処理（画面からの登録と、ローカルのテストデータ作成で共通）。Better Auth の応答をそのまま返す。 */
export async function registerAccount(account: NewAccount, headers?: Headers): Promise<Response> {
  return getAuth().api.signUpEmail({
    body: {
      email: placeholderEmail(account.username),
      password: account.password,
      name: account.orgName,
      username: account.username,
      signupRole: account.role,
      orgName: account.orgName,
      area: account.area,
    },
    headers,
    asResponse: true,
  })
}
