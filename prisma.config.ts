import { defineConfig } from 'prisma/config'

// Prisma CLI は .env.local を自動では読まないため、ここで読み込む。
try {
  process.loadEnvFile('.env.local')
} catch {
  // Vercel 上など .env.local が無い環境では、環境変数がそのまま使われる。
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // マイグレーションは接続プールを通さない URL を優先する（Neon）。
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? '',
  },
})
