// 回数制限（新規登録・リカバリーコード・ログイン試行）。
// サーバーレス環境ではメモリを共有できないため、DB に記録する。
import { createHash } from 'node:crypto'
import { HttpError } from './http.js'
import { getPrisma } from './prisma.js'

/** 接続元の IP アドレス。Vercel では x-forwarded-for を Vercel 自身が設定する。 */
export function clientIp(request: Request | Headers | undefined): string {
  const headers = request instanceof Headers ? request : request?.headers
  return headers?.get('x-forwarded-for')?.split(',')[0].trim() || headers?.get('x-real-ip') || 'unknown'
}

/**
 * key ごとの回数を1つ増やし、窓の中で limit を超えていなければ true。
 * IP やユーザー名そのものは保存せず、ハッシュだけを保存する。
 */
export async function allow(scope: string, subject: string, limit: number, windowSeconds: number): Promise<boolean> {
  const key = createHash('sha256').update(`${scope}:${subject}`).digest('hex')
  const rows = await getPrisma().$queryRaw<{ count: number }[]>`
    INSERT INTO "Throttle" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "Throttle"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE "Throttle"."count" + 1 END,
      "windowStart" = CASE WHEN "Throttle"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE "Throttle"."windowStart" END
    RETURNING "count"`
  return Number(rows[0]?.count ?? 0) <= limit
}

export async function requireAllowed(scope: string, subject: string, limit: number, windowSeconds: number): Promise<void> {
  if (!(await allow(scope, subject, limit, windowSeconds))) {
    throw new HttpError(429, 'TOO_MANY', '操作の回数が多すぎます。しばらく待ってからもう一度お試しください。')
  }
}
