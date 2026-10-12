// 運営者用のコマンド。登録済みのアカウントに運営者（ADMIN）の役割を付与する。
//   npm run admin:grant -- ユーザー名
// 運営者は登録画面からは選べないため、このコマンドでだけ付与できる。
// 接続先の DB は ENV_FILE（既定は .env.local）で決まる。本番で使う場合は ENV_FILE=.env.production.local を指定する。
// 利用者のリカバリーコードの再発行は、運営者の管理画面から行う。
export {}

try {
  process.loadEnvFile(process.env.ENV_FILE || '.env.local')
} catch {
  // 設定済みの環境変数を使う
}

const username = process.argv[2]?.trim().toLowerCase()
if (!username) {
  console.error('使い方: npm run admin:grant -- ユーザー名')
  process.exit(1)
}

const { getPrisma } = await import('../api/_lib/prisma.js')
const prisma = getPrisma()
const host = new URL(process.env.DATABASE_URL ?? 'postgres://unknown').host
console.log(`接続先の DB: ${host}`)

const user = await prisma.user.findUnique({ where: { username } })
if (!user) {
  console.error('そのユーザー名のアカウントが見つかりません。先に通常の新規登録を済ませてください。')
  process.exit(1)
}

await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } })
console.log(`「${username}」に運営者の役割を付与しました。画面を読み込み直すと、管理画面が表示されます。`)
await prisma.$disconnect()
