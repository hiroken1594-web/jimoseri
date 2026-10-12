import { inferAdditionalFields } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// 認証 API（/api/auth/...）を呼ぶための部品。同じサイト内なので URL の指定は不要。
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      user: {
        signupRole: { type: 'string', required: false },
        orgName: { type: 'string', required: false },
        area: { type: 'string', required: false },
      },
    }),
  ],
})

interface AuthError {
  code?: string
  message?: string
  status?: number
}

const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'メールアドレスまたはパスワードが違います。',
  INVALID_EMAIL: 'メールアドレスの形式を確認してください。',
  INVALID_PASSWORD: '現在のパスワードが違います。',
  PASSWORD_TOO_SHORT: 'パスワードが短すぎます。',
  PASSWORD_TOO_LONG: 'パスワードが長すぎます。',
  EMAIL_NOT_VERIFIED: 'メールアドレスの確認が済んでいません。確認用のメールを送りましたので、メール内のリンクを開いてください。',
  INVALID_TOKEN: 'リンクの有効期限が切れているか、既に使われています。もう一度やり直してください。',
  USER_ALREADY_EXISTS: 'このメールアドレスは既に登録されています。',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'このメールアドレスは既に登録されています。',
  SESSION_EXPIRED: 'ログインの有効期限が切れました。ログインし直してください。',
  COULDNT_UPDATE_YOUR_EMAIL: 'メールアドレスを変更できませんでした。別のアドレスでお試しください。',
}

/** 認証のエラーを、画面に出せる日本語にする */
export function authErrorMessage(error: AuthError | null | undefined): string {
  if (!error) return '処理に失敗しました。もう一度お試しください。'
  if (error.status === 429) return '操作の回数が多すぎます。しばらく待ってからもう一度お試しください。'
  if (error.code && MESSAGES[error.code]) return MESSAGES[error.code]
  // サーバー側で日本語のメッセージを付けたもの（招待コード・登録内容の不備など）はそのまま出す
  if (error.message && /[ぁ-んァ-ン一-龥]/.test(error.message)) return error.message
  if (!error.status) return '通信できませんでした。電波の状況を確認して、もう一度お試しください。'
  return '処理に失敗しました。入力内容を確認して、もう一度お試しください。'
}
