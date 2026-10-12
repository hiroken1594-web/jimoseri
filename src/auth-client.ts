import { usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// 認証 API（/api/auth/...）を呼ぶための部品。同じサイト内なので URL の指定は不要。
// 新規登録とパスワードの再設定は、自前の /api/signup・/api/recovery を使う。
export const authClient = createAuthClient({ plugins: [usernameClient()] })

interface AuthError {
  code?: string
  message?: string
  status?: number
}

const MESSAGES: Record<string, string> = {
  INVALID_USERNAME_OR_PASSWORD: 'ユーザー名またはパスワードが違います。',
  INVALID_EMAIL_OR_PASSWORD: 'ユーザー名またはパスワードが違います。',
  INVALID_USERNAME: 'ユーザー名またはパスワードが違います。',
  USERNAME_TOO_SHORT: 'ユーザー名またはパスワードが違います。',
  USERNAME_TOO_LONG: 'ユーザー名またはパスワードが違います。',
  INVALID_PASSWORD: '現在のパスワードが違います。',
  PASSWORD_TOO_SHORT: 'パスワードが短すぎます。',
  PASSWORD_TOO_LONG: 'パスワードが長すぎます。',
  SESSION_EXPIRED: 'ログインの有効期限が切れました。ログインし直してください。',
}

/** 認証のエラーを、画面に出せる日本語にする */
export function authErrorMessage(error: AuthError | null | undefined): string {
  if (!error) return '処理に失敗しました。もう一度お試しください。'
  // サーバー側で日本語のメッセージを付けたもの（試行回数の制限など）はそのまま出す
  if (error.message && /[ぁ-んァ-ン一-龥]/.test(error.message)) return error.message
  if (error.status === 429) return '操作の回数が多すぎます。しばらく待ってからもう一度お試しください。'
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code]
  if (!error.status) return '通信できませんでした。電波の状況を確認して、もう一度お試しください。'
  return '処理に失敗しました。入力内容を確認して、もう一度お試しください。'
}
