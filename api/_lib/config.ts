// 環境変数から決まる設定。秘密の値そのものは返さない。

export function serviceName(): string {
  return 'AI地域商社'
}

/** 本番環境（Vercel の Production）かどうか */
export function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

/** Cookie や送信元の確認の基準になる、このサービスの URL */
export function baseUrl(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL.replace(/\/$/, '')
  if (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:5173'
}

export interface OperatorInfo {
  name: string
  email: string
}

/** 運営者情報。正式な値が設定されるまでは null。 */
export function operatorInfo(): OperatorInfo | null {
  const name = process.env.OPERATOR_NAME?.trim()
  const email = process.env.OPERATOR_EMAIL?.trim()
  return name && email ? { name, email } : null
}

/**
 * 利用者に案内する問い合わせ先の電話番号。
 * 正式な番号が決まったら、環境変数 OPERATOR_PHONE に設定して再デプロイする（コードの変更は不要）。
 * 未設定の間は、仮の表示にする。
 */
export function supportPhone(): string {
  return process.env.OPERATOR_PHONE?.trim() || '06-XXXX-XXXX'
}

export type SignupMode = 'open' | 'invite' | 'closed'

/**
 * 新規登録の受け付け方。
 * - open   ：誰でも登録できる。
 * - invite ：招待コードを知っている関係者だけが登録できる。
 * - closed ：登録を受け付けない。
 * Vercel 上では、明示的に設定しない限り closed。ローカル開発では open。
 */
export function signupMode(): SignupMode {
  const raw = process.env.SIGNUP_MODE
  if (raw === 'invite') return process.env.SIGNUP_INVITE_CODE ? 'invite' : 'closed'
  if (raw === 'open') return 'open'
  if (raw === 'closed') return 'closed'
  return process.env.VERCEL ? 'closed' : 'open'
}

/** AI 抽出の1人あたり1日の上限回数 */
export function aiDailyLimit(): number {
  const n = Number(process.env.AI_DAILY_LIMIT)
  return Number.isInteger(n) && n > 0 ? n : 30
}

/** AI 抽出の、サービス全体の1日の上限回数（アカウントを大量に作られても、費用が膨らまないようにする） */
export function aiGlobalDailyLimit(): number {
  const n = Number(process.env.AI_GLOBAL_DAILY_LIMIT)
  return Number.isInteger(n) && n > 0 ? n : 500
}
