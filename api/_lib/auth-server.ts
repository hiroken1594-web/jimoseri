// 認証の設定（Better Auth）。
// パスワードは scrypt でハッシュ化して保存され、セッションは HttpOnly Cookie で管理される。
import { waitUntil } from '@vercel/functions'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { createHash, timingSafeEqual } from 'node:crypto'
import { baseUrl, signupMode } from './config.js'
import { resetPasswordMail, sendMail, verificationMail } from './mailer.js'
import { getPrisma } from './prisma.js'

const SIGNUP_ROLES = ['RESTAURANT', 'PRODUCER']
export const MIN_PASSWORD_LENGTH = 10

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

function background(task: Promise<unknown>): void {
  // 応答を待たせず、かつ応答時間から「登録済みかどうか」を推測されないようにする
  try {
    waitUntil(task)
  } catch {
    void task
  }
}

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
      // メールアドレスの確認が済むまでログインさせない
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      // 再設定したら、他の端末のログインをすべて無効にする
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        background(sendMail(resetPasswordMail(user.email, url)))
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        background(sendMail(verificationMail(user.email, url)))
      },
    },

    user: {
      additionalFields: {
        // 本人は変更できない（input: false）。登録時にサーバーが signupRole から確定する。
        role: { type: 'string', required: false, input: false },
        suspended: { type: 'boolean', required: false, defaultValue: false, input: false },
        signupRole: { type: 'string', required: false },
        orgName: { type: 'string', required: false },
        area: { type: 'string', required: false },
      },
      changeEmail: { enabled: true },
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
            const input = user as typeof user & { signupRole?: unknown; orgName?: unknown; area?: unknown }
            const role = typeof input.signupRole === 'string' ? input.signupRole : ''
            const orgName = typeof input.orgName === 'string' ? input.orgName.trim() : ''
            const area = typeof input.area === 'string' ? input.area.trim() : ''
            // 登録時に選べるのは生産者と飲食店だけ。運営者（ADMIN）は選べない。
            if (!SIGNUP_ROLES.includes(role)) {
              throw new APIError('BAD_REQUEST', { message: '利用者の種類（生産者・飲食店）を選択してください。' })
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
            // 念のため、利用者からの更新で役割・停止状態が書き換わらないようにする
            const { role: _role, suspended: _suspended, ...rest } = user as Record<string, unknown>
            return { data: rest }
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return
        const mode = signupMode()
        if (mode === 'closed') {
          throw new APIError('FORBIDDEN', { message: '現在、新規登録の受け付けを準備中です。' })
        }
        if (mode === 'invite') {
          const code = ctx.headers?.get('x-invite-code') ?? ''
          if (!code || !safeEqual(code, process.env.SIGNUP_INVITE_CODE ?? '')) {
            throw new APIError('FORBIDDEN', { message: '招待コードが正しくありません。' })
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
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 8 },
        '/sign-up/email': { window: 60 * 10, max: 5 },
        '/request-password-reset': { window: 60 * 10, max: 3 },
        '/send-verification-email': { window: 60 * 10, max: 3 },
      },
    },

    advanced: {
      useSecureCookies: Boolean(process.env.VERCEL),
      backgroundTasks: { handler: background },
    },
  })
}

type Auth = ReturnType<typeof createAuth>
const globalForAuth = globalThis as unknown as { __auth?: Auth }

export function getAuth(): Auth {
  return (globalForAuth.__auth ??= createAuth())
}
