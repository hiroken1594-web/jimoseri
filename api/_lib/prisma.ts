import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client.js'
import { HttpError } from './http.js'

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient }

/** DB 接続は使い回す（関数の呼び出しごとに接続を増やさない）。 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__prisma) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new HttpError(503, 'CONFIG', 'データベースの接続設定が未完了です。管理者に連絡してください。')
    }
    globalForPrisma.__prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  }
  return globalForPrisma.__prisma
}
