// ローカル開発用の .env.local を作る／不足している項目を足す。既にある値は上書きしない。
// 値は画面に表示しない（秘密情報をログに残さないため）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const path = '.env.local'
const defaults = {
  DATABASE_URL: 'postgresql://jimoseri:jimoseri_local@localhost:54329/jimoseri_app',
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  // ローカルのテスト用アカウント（npm run db:seed）の共通パスワード
  DEV_TEST_PASSWORD: randomBytes(9).toString('base64url'),
  GEMINI_API_KEY: '',
  GEMINI_MODEL: '',
}
// 廃止した設定（デモ用の合言葉など）は取り除く
const removed = ['SESSION_SECRET', 'DEMO_PASSCODE', 'DEMO_RESET_ENABLED', 'SMTP_USER', 'SMTP_PASS', 'SMTP_HOST', 'SMTP_PORT', 'MAIL_FROM']

const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : ['# ローカル開発専用。Git には含めない。']
const kept = lines.filter((line) => !removed.some((key) => line.startsWith(`${key}=`)))
const present = new Set(kept.map((line) => line.split('=')[0]))
const added = []
for (const [key, value] of Object.entries(defaults)) {
  if (!present.has(key)) {
    kept.push(`${key}=${value}`)
    added.push(key)
  }
}
writeFileSync(path, kept.filter((line) => line !== '').join('\n') + '\n')
console.log(added.length > 0 ? `.env.local に追加しました: ${added.join(', ')}` : '.env.local は最新です。')
