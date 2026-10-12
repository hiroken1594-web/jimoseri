// 登録済みのアカウントに運営者（ADMIN）の役割を付与する。
// 運営者は登録画面からは選べないため、このコマンドでだけ付与できる。
// 実行: npm run admin:grant -- someone@example.com
export {}

try {
  process.loadEnvFile(process.env.ENV_FILE || '.env.local')
} catch {
  // 設定済みの環境変数を使う
}

const email = process.argv[2]?.trim().toLowerCase()
if (!email) {
  console.error('使い方: npm run admin:grant -- メールアドレス')
  process.exit(1)
}

const { getPrisma } = await import('../api/_lib/prisma.js')
const prisma = getPrisma()
const user = await prisma.user.findUnique({ where: { email } })
if (!user) {
  console.error('そのメールアドレスのアカウントが見つかりません。先に通常の新規登録を済ませてください。')
  process.exit(1)
}
if (!user.emailVerified) {
  console.error('メールアドレスの確認が済んでいないアカウントには付与できません。')
  process.exit(1)
}
await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } })
console.log('運営者の役割を付与しました。対象の方は一度ログアウトしてログインし直してください。')
await prisma.$disconnect()
