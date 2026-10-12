// 運営者用のコマンド。運営者の役割の付与と、リカバリーコードの再発行を行う。
//   npm run admin:grant -- ユーザー名      … 登録済みのアカウントに運営者（ADMIN）の役割を付与する
//   npm run admin:recovery -- ユーザー名   … パスワードもリカバリーコードも失くした利用者に、新しいコードを発行する
// 接続先の DB は ENV_FILE（既定は .env.local）で決まる。本番で使う場合は ENV_FILE=.env.production.local を指定する。
// リカバリーコードの再発行は、電話や対面などで本人であることを確かめてから行うこと。
export {}

try {
  process.loadEnvFile(process.env.ENV_FILE || '.env.local')
} catch {
  // 設定済みの環境変数を使う
}

const [command, rawName] = process.argv.slice(2)
const username = rawName?.trim().toLowerCase()
if (!['grant', 'recovery'].includes(command) || !username) {
  console.error('使い方: npm run admin:grant -- ユーザー名 ／ npm run admin:recovery -- ユーザー名')
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

if (command === 'grant') {
  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } })
  console.log(`「${username}」に運営者の役割を付与しました。画面を読み込み直すと、管理画面が表示されます。`)
} else {
  const { issueRecoveryCode } = await import('../api/_lib/accounts.js')
  const code = await issueRecoveryCode(user.id)
  console.log(`「${username}」の新しいリカバリーコード（この画面にだけ表示されます。以前のコードは無効になりました）:`)
  console.log(`\n    ${code}\n`)
  console.log('本人に安全な方法で伝え、「パスワードを忘れた方」の画面で使ってもらってください。')
}
await prisma.$disconnect()
