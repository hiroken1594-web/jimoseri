// デモデータ（お試し用）の登録と一括削除。生産者側の画面を試すための架空のデータで、実在の取引情報ではない。
//   npm run demo:seed    … デモ用の生産者アカウント「demo_farm」と、出品50件・受渡場所3件を作り直す
//   npm run demo:remove  … デモデータ（isDemo のもの）をすべて削除する
// 接続先の DB は ENV_FILE（既定は .env.local）で決まる。本番は ENV_FILE=.env.production.local を指定する。
// デモデータは飲食店の仕入れ案・受取エリア・他の生産者の選択肢には出ない（isDemo で除外）。
// 実際の取引・通知・決済は、このサービスにそもそも存在しない。
export {}

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const envFile = process.env.ENV_FILE || '.env.local'
try {
  process.loadEnvFile(envFile)
} catch {
  // 設定済みの環境変数を使う
}
// 本番の秘密の値は手元に取得できない。パスワードのハッシュ化には使わないため、無ければ一時的な値で認証部品を動かす。
if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex')
}

const command = process.argv[2]
if (command !== 'seed' && command !== 'remove') {
  console.error('使い方: npm run demo:seed ／ npm run demo:remove')
  process.exit(1)
}

const DEMO_USERNAME = 'demo_farm'
const PASSWORD_FILE = '.env.demo.local'

const { getPrisma } = await import('../api/_lib/prisma.js')
const { addDaysJst, jstDateString, jstToMs, DAY_MS } = await import('../shared/time.js')
const prisma = getPrisma()
console.log(`接続先の DB: ${new URL(process.env.DATABASE_URL ?? 'postgres://unknown').host}`)

async function removeDemoData(): Promise<void> {
  const listings = await prisma.listing.deleteMany({ where: { isDemo: true } })
  const locations = await prisma.pickupLocation.deleteMany({ where: { isDemo: true, listings: { none: {} } } })
  // デモ用の生産者のアカウントごと消す（ログイン情報・セッションも一緒に消える）
  const users = await prisma.user.deleteMany({ where: { producer: { isDemo: true } } })
  console.log(`デモデータを削除しました：出品 ${listings.count} 件、受渡場所 ${locations.count} 件、アカウント ${users.count} 件`)
}

if (command === 'remove') {
  await removeDemoData()
  await prisma.$disconnect()
  process.exit(0)
}

// ---------- 登録 ----------
const { registerAccount } = await import('../api/_lib/accounts.js')
await removeDemoData()
const existing = await prisma.user.findUnique({ where: { username: DEMO_USERNAME } })
if (existing) {
  console.error(`ユーザー名「${DEMO_USERNAME}」はデモ以外のアカウントが使っています。中止しました。`)
  process.exit(1)
}

// パスワードは Git に含まれないローカルファイルにだけ保存する（画面には出さない）
const password = existsSync(PASSWORD_FILE)
  ? (readFileSync(PASSWORD_FILE, 'utf8').match(/^DEMO_FARM_PASSWORD=(.+)$/m)?.[1]?.trim() ?? '')
  : ''
const demoPassword = password.length >= 10 ? password : randomBytes(9).toString('base64url')
writeFileSync(
  PASSWORD_FILE,
  `# デモ用の生産者アカウント（お試し用）のログイン情報。Git には含めない。\nDEMO_FARM_USERNAME=${DEMO_USERNAME}\nDEMO_FARM_PASSWORD=${demoPassword}\n`,
)

const res = await registerAccount({ username: DEMO_USERNAME, password: demoPassword, role: 'PRODUCER', orgName: 'デモ農園（お試し用）', area: '能勢町' })
if (!res.ok) throw new Error(`デモ用アカウントを作成できませんでした: ${res.status}`)
const user = await prisma.user.findUniqueOrThrow({ where: { username: DEMO_USERNAME } })
const producer = await prisma.producer.create({
  data: {
    userId: user.id,
    farmName: 'デモ農園（お試し用）',
    area: '能勢町',
    approvalStatus: 'APPROVED',
    isDemo: true,
    contactNote: 'デモデータ（お試し用）のため、連絡先はありません',
  },
})

const locations = {
  stand: await prisma.pickupLocation.create({
    data: { name: 'デモ直売所（お試し用）', municipality: '能勢町', address: '架空の住所（お試し用）', note: 'デモデータ（お試し用）', status: 'APPROVED', isDemo: true, createdById: producer.id },
  }),
  hub: await prisma.pickupLocation.create({
    data: { name: 'デモ集荷場（お試し用）', municipality: '豊能町', address: '架空の住所（お試し用）', note: 'デモデータ（お試し用）', status: 'APPROVED', isDemo: true, createdById: producer.id },
  }),
  pending: await prisma.pickupLocation.create({
    data: { name: 'デモ軒先（お試し用・確認待ち）', municipality: '能勢町', address: '架空の住所（お試し用）', note: 'デモデータ（お試し用）', status: 'PENDING', isDemo: true, createdById: producer.id },
  }),
}

// 品目ごとの、現実的な単位・税込単価の幅・数量の幅・品種（10月の関西を想定）
type Unit = 'KG' | 'PIECE' | 'BUNCH' | 'BAG'
const CATALOG: { item: string; unit: Unit; price: [number, number]; qty: [number, number]; min: number; step: number; varieties: (string | null)[] }[] = [
  { item: 'トマト', unit: 'KG', price: [520, 750], qty: [3, 15], min: 1, step: 1, varieties: ['桃太郎', 'りんか409', null] },
  { item: 'ミニトマト', unit: 'BAG', price: [220, 320], qty: [10, 40], min: 5, step: 5, varieties: ['アイコ', '千果', null] },
  { item: 'なす', unit: 'KG', price: [430, 600], qty: [2, 10], min: 1, step: 0.5, varieties: ['千両二号', '水なす', null] },
  { item: 'きゅうり', unit: 'PIECE', price: [40, 65], qty: [20, 80], min: 10, step: 5, varieties: [null] },
  { item: 'ピーマン', unit: 'BAG', price: [140, 200], qty: [10, 30], min: 5, step: 5, varieties: ['京波', null] },
  { item: '小松菜', unit: 'BUNCH', price: [120, 180], qty: [10, 40], min: 5, step: 5, varieties: [null] },
  { item: 'ほうれん草', unit: 'BUNCH', price: [150, 230], qty: [10, 30], min: 5, step: 5, varieties: [null] },
  { item: '水菜', unit: 'BUNCH', price: [130, 190], qty: [10, 30], min: 5, step: 5, varieties: ['京みず菜', null] },
  { item: 'キャベツ', unit: 'PIECE', price: [160, 260], qty: [5, 20], min: 2, step: 1, varieties: [null] },
  { item: '白菜', unit: 'PIECE', price: [250, 400], qty: [4, 12], min: 1, step: 1, varieties: [null] },
  { item: '大根', unit: 'PIECE', price: [120, 200], qty: [8, 25], min: 2, step: 1, varieties: ['青首大根', null] },
  { item: 'にんじん', unit: 'KG', price: [340, 460], qty: [3, 12], min: 1, step: 1, varieties: [null] },
  { item: '玉ねぎ', unit: 'KG', price: [300, 420], qty: [5, 20], min: 2, step: 1, varieties: [null] },
  { item: 'じゃがいも', unit: 'KG', price: [320, 460], qty: [5, 20], min: 2, step: 1, varieties: ['男爵', 'メークイン'] },
  { item: 'さつまいも', unit: 'KG', price: [450, 620], qty: [4, 15], min: 1, step: 1, varieties: ['紅はるか', '鳴門金時'] },
  { item: 'かぼちゃ', unit: 'PIECE', price: [300, 520], qty: [3, 10], min: 1, step: 1, varieties: [null] },
  { item: 'ねぎ', unit: 'BUNCH', price: [150, 260], qty: [5, 20], min: 2, step: 1, varieties: ['九条ねぎ', null] },
  { item: '米', unit: 'KG', price: [480, 620], qty: [10, 60], min: 5, step: 5, varieties: ['ヒノヒカリ', 'キヌヒカリ'] },
  { item: '栗', unit: 'KG', price: [1500, 2300], qty: [2, 8], min: 1, step: 0.5, varieties: ['銀寄'] },
]

// 毎回同じ内容になるよう、決まった種から乱数を作る
let seed = 20261014
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
const between = (a: number, b: number) => a + rand() * (b - a)
const roundTo = (n: number, step: number) => Math.max(step, Math.round(n / step) * step)

const itemIds = new Map((await prisma.item.findMany()).map((i) => [i.name, i.id]))
const now = Date.now()
const today = jstDateString(now)
const TIMES: [string, string][] = [['08:00', '09:00'], ['09:00', '10:00'], ['10:00', '11:00'], ['10:00', '12:00'], ['13:00', '14:00'], ['15:00', '16:00'], ['16:00', '17:30']]

// 状態の内訳（合計50件）
const PLAN: { kind: 'active' | 'stopped' | 'soldout' | 'expired' | 'suspended' | 'pending'; count: number }[] = [
  { kind: 'active', count: 30 },
  { kind: 'stopped', count: 5 },
  { kind: 'soldout', count: 4 },
  { kind: 'expired', count: 7 },
  { kind: 'suspended', count: 2 },
  { kind: 'pending', count: 2 },
]

const rows = []
let n = 0
for (const { kind, count } of PLAN) {
  for (let i = 0; i < count; i++, n++) {
    const c = CATALOG[n % CATALOG.length]
    const price = Math.round(between(c.price[0], c.price[1]) / 10) * 10
    const qty = kind === 'soldout' ? 0 : roundTo(between(c.qty[0], c.qty[1]), c.step)
    // 受渡日：期限切れは過去、それ以外は今日から10日先まで
    const day = kind === 'expired' ? addDaysJst(today, -Math.ceil(between(1, 20))) : addDaysJst(today, Math.ceil(between(0.5, 10)))
    const [start, end] = pick(TIMES)
    const pickupStart = jstToMs(day, start)
    // 登録日：受渡日の1〜20日前（未来にはしない）
    const createdAtMs = Math.min(now - 60_000, pickupStart - Math.ceil(between(1, 20)) * DAY_MS + Math.round(between(0, 10)) * 3600_000)
    // 最終更新：登録日以降。一部は数日前のまま（「更新が古い」の表示を試せる）
    const updatedAtMs = Math.min(now - 60_000, createdAtMs + (rand() < 0.3 ? 0 : Math.round(between(0.2, 6) * DAY_MS)))
    const irregular = rand() < 0.25
    rows.push({
      producerId: producer.id,
      itemId: itemIds.get(c.item)!,
      variety: pick(c.varieties),
      grade: irregular ? ('IRREGULAR' as const) : ('REGULAR' as const),
      irregularReason: irregular ? pick(['SHAPE', 'SHAPE', 'SIZE', 'SURPLUS'] as const) : null,
      quantity: qty,
      unit: c.unit,
      // 規格外は1〜3割ほど安く
      unitPriceTaxIncl: irregular ? Math.round((price * between(0.7, 0.9)) / 10) * 10 : price,
      minQuantity: c.min,
      stepQuantity: c.step,
      pickupLocationId: kind === 'pending' ? locations.pending.id : rand() < 0.65 ? locations.stand.id : locations.hub.id,
      pickupStart: new Date(pickupStart),
      pickupEnd: new Date(jstToMs(day, end)),
      isPublished: kind !== 'stopped',
      adminSuspended: kind === 'suspended',
      isDemo: true,
      createdAt: new Date(createdAtMs),
      updatedAt: new Date(updatedAtMs),
    })
  }
}
await prisma.listing.createMany({ data: rows })

const summary = PLAN.map((p) => `${{ active: '公開中', stopped: '公開停止', soldout: '数量0', expired: '受渡日を過ぎた', suspended: '運営者が停止', pending: '場所が確認待ち' }[p.kind]} ${p.count}`).join('・')
console.log(`デモデータを登録しました：出品 ${rows.length} 件（${summary}）、受渡場所 3 件`)
console.log(`デモ用アカウント：ユーザー名「${DEMO_USERNAME}」。パスワードは ${PASSWORD_FILE} に保存しました（Git には含まれません）。`)
await prisma.$disconnect()
