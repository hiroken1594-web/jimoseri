// 認証の設定（Better Auth）。ユーザー名＋パスワードでログインする。メールは一切送らない。
// パスワードは scrypt でハッシュ化して保存され、セッションは HttpOnly Cookie で管理される。
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { username } from 'better-auth/plugins'
import { USERNAME_MAX, USERNAME_MIN, isValidUsername } from '../../shared/limits.js'
import { baseUrl } from './config.js'
import { getPrisma } from './prisma.js'
import { allow, clientIp } from './throttle.js'

const SIGNUP_ROLES = ['RESTAURANT', 'PRODUCER']
export const MIN_PASSWORD_LENGTH = 10

// 画面から直接は使わせない認証 API。
// 登録は /api/signup（招待コード・回数制限・リカバリーコードの発行を行う）だけを入口にする。
const BLOCKED_PATHS = new Set([
  '/sign-up/email',
  '/sign-in/email',
  '/change-email',
  '/request-password-reset',
  '/reset-password',
  '/send-verification-email',
  '/verify-email',
])

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET is not set (32 characters or more)')

  return betterAuth({
    appName: 'AI地域商社',
    baseURL: baseUrl(),
    basePath: '/api/auth',
    secret,
    trustedOrigins: [baseUrl()],
    database: prismaAdapter(getPrisma(), { provider: 'postgresql' }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      autoSignIn: true,
    },

    plugins: [
      username({
        minUsernameLength: USERNAME_MIN,
        maxUsernameLength: USERNAME_MAX,
        usernameValidator: isValidUsername,
      }),
    ],

    user: {
      additionalFields: {
        // 本人は変更できない（input: false）。登録時にサーバーが signupRole から確定する。
        role: { type: 'string', required: false, input: false },
        suspended: { type: 'boolean', required: false, defaultValue: false, input: false },
        signupRole: { type: 'string', required: false },
        orgName: { type: 'string', required: false },
        area: { type: 'string', required: false },
      },
      deleteUser: { enabled: true },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const input = user as typeof user & { signupRole?: unknown; orgName?: unknown; area?: unknown; username?: unknown }
            const role = typeof input.signupRole === 'string' ? input.signupRole : ''
            const orgName = typeof input.orgName === 'string' ? input.orgName.trim() : ''
            const area = typeof input.area === 'string' ? input.area.trim() : ''
            // 登録時に選べるのは生産者と飲食店だけ。運営者（ADMIN）は選べない。
            if (!SIGNUP_ROLES.includes(role)) {
              throw new APIError('BAD_REQUEST', { message: '利用者の種類（生産者・飲食店）を選択してください。' })
            }
            if (typeof input.username !== 'string' || !isValidUsername(input.username)) {
              throw new APIError('BAD_REQUEST', { message: 'ユーザー名を確認してください。' })
            }
            if (orgName.length < 1 || orgName.length > 40) {
              throw new APIError('BAD_REQUEST', { message: '店舗名・農園名は1〜40文字で入力してください。' })
            }
            if (area.length < 1 || area.length > 40) {
              throw new APIError('BAD_REQUEST', { message: '地域は1〜40文字で入力してください。' })
            }
            return { data: { ...user, name: orgName, orgName, area, signupRole: role, role, suspended: false } }
          },
        },
        update: {
          before: async (user) => {
            // 利用者からの更新で、役割・停止状態・ユーザー名・内部用のメール欄が書き換わらないようにする
            const { role: _r, suspended: _s, username: _u, displayUsername: _d, email: _e, emailVerified: _v, ...rest } = user as Record<string, unknown>
            return { data: rest }
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // ctx.request があるのは、外から HTTP で呼ばれた場合だけ（サーバー内部からの呼び出しでは無い）
        if (ctx.request && BLOCKED_PATHS.has(ctx.path)) {
          throw new APIError('NOT_FOUND', { message: 'この操作は利用できません。' })
        }
        if (ctx.path === '/sign-in/username') {
          // 同じユーザー名へのログイン試行を制限する（パスワードの総当たり対策）
          const name = typeof ctx.body?.username === 'string' ? ctx.body.username.toLowerCase().slice(0, 40) : ''
          const okUser = await allow('login-user', name, 10, 10 * 60)
          const okIp = await allow('login-ip', clientIp(ctx.headers), 30, 10 * 60)
          if (!okUser || !okIp) {
            throw new APIError('TOO_MANY_REQUESTS', { message: 'ログインの試行回数が多すぎます。10分ほど待ってからもう一度お試しください。' })
          }
        }
      }),
    },

    rateLimit: {
      // Vercel 上では常に有効。ローカル開発では、自動テストの妨げにならないよう既定でオフ。
      enabled: Boolean(process.env.VERCEL) || process.env.AUTH_RATE_LIMIT === 'on',
      // サーバーレス環境ではメモリが共有されないため、回数は DB に記録する
      storage: 'database',
      window: 60,
      max: 100,
    },

    advanced: {
      useSecureCookies: Boolean(process.env.VERCEL),
    },
  })
}

type Auth = ReturnType<typeof createAuth>
const globalForAuth = globalThis as unknown as { __auth?: Auth }

export function getAuth(): Auth {
  return (globalForAuth.__auth ??= createAuth())
}
