// 認証 API（/api/auth/...）。登録・ログイン・メール確認・パスワード再設定などを Better Auth が処理する。
import { getAuth } from '../_lib/auth-server.js'

async function handler(request: Request): Promise<Response> {
  try {
    return await getAuth().handler(request)
  } catch (error) {
    console.error('[auth]', error)
    return new Response(JSON.stringify({ message: '認証サーバーの設定が未完了です。管理者に連絡してください。' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })
  }
}

export const GET = handler
export const POST = handler
