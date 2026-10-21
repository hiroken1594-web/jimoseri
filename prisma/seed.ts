// ローカル開発専用のテストデータ（すべて架空）。本番の DB には絶対に投入しない。
// 実行: npm run db:seed
export {}

try {
  process.loadEnvFile('.env.local')
} catch {
  // 下の確認で止まる
}

// 接続先がローカルの DB でなければ実行しない（本番 DB に架空データを入れないための安全装置）
const url = process.env.DATABASE_URL ?? ''
if (!/@(localhost|127\.0\.0\.1):/.test(url) || process.env.VERCEL) {
  console.error('このスクリプトはローカル開発用の DB（localhost）でのみ実行できます。中止しました。')
  process.exit(1)
}
const password = process.env.DEV_TEST_PASSWORD
if (!password) {
  console.error('DEV_TEST_PASSWORD が未設定です。npm run env:init を実行してください。')
  process.exit(1)
}

const { getPrisma } = await import('../api/_lib/prisma.js')
const { registerAccount } = await import('../api/_lib/accounts.js')
const { addDaysJst, jstDateString, jstToMs } = await import('../shared/time.js')
const prisma = getPrisma()

const ACCOUNTS = [
  { username: 'unei_test', role: 'RESTAURANT', orgName: '運営（テスト）', area: '大阪市' },
  { username: 'restaurant1', role: 'RESTAURANT', orgName: 'テスト小料理店', area: '大阪市福島区' },
  { username: 'restaurant2', role: 'RESTAURANT', orgName: 'テスト食堂', area: '大阪市北区' },
  { username: 'farm_a', role: 'PRODUCER', orgName: 'テストA農園', area: '能勢町' },
  { username: 'farm_b', role: 'PRODUCER', orgName: 'テストB農園', area: '豊能町' },
  { username: 'farm_c', role: 'PRODUCER', orgName: 'テストC農園', area: '能勢町' },
] as const

// ローカル DB の内容を消して作り直す（品目マスタは残す）
await prisma.listing.deleteMany()
await prisma.demand.deleteMany()
await prisma.favorite.deleteMany()
await prisma.report.deleteMany()
await prisma.pickupLocation.deleteMany()
await prisma.user.deleteMany()
await prisma.throttle.deleteMany()

for (const a of ACCOUNTS) {
  // 実際の登録と同じ処理を通す（パスワードはハッシュ化されて保存される）
  const res = await registerAccount({ ...a, password })
  if (!res.ok) throw new Error(`テスト用アカウントを作成できませんでした: ${a.username} ${await res.text()}`)
}
await prisma.user.update({ where: { username: 'unei_test' }, data: { role: 'ADMIN' } })

const producerIds: Record<string, string> = {}
for (const a of ACCOUNTS.filter((x) => x.role === 'PRODUCER')) {
  const user = await prisma.user.findUniqueOrThrow({ where: { username: a.username } })
  const producer = await prisma.producer.create({
    data: { userId: user.id, farmName: a.orgName, area: a.area, approvalStatus: 'APPROVED' },
  })
  producerIds[a.username] = producer.id
}

// 電話番号（テスト用の架空の番号）と、取引相手への表示の設定
//  restaurant1：マッチング成立後の相手に表示／restaurant2：表示しない・生産者からの提案を受け取る
//  farm_a：相談中の相手にも表示／farm_b：表示しない／farm_c：未登録（追加登録のお願いを試せる）
const PHONES: Record<string, { phone: string; phoneShare: 'NONE' | 'MATCHED' | 'ANYTIME' }> = {
  restaurant1: { phone: '09000000001', phoneShare: 'MATCHED' },
  restaurant2: { phone: '0600000002', phoneShare: 'NONE' },
  farm_a: { phone: '08000000003', phoneShare: 'ANYTIME' },
  farm_b: { phone: '07000000004', phoneShare: 'NONE' },
}
for (const [username, data] of Object.entries(PHONES)) await prisma.user.update({ where: { username }, data })
for (const username of ['restaurant1', 'restaurant2']) {
  const user = await prisma.user.findUniqueOrThrow({ where: { username } })
  await prisma.restaurant.create({ data: { userId: user.id, name: ACCOUNTS.find((x) => x.username === username)!.orgName, area: ACCOUNTS.find((x) => x.username === username)!.area, acceptProposals: username === 'restaurant2' } })
}
await prisma.producer.update({
  where: { id: producerIds.farm_a },
  data: { publicPhone: '090-0000-0000', showPhone: true, publicEmail: 'farm-a-public@example.invalid', showEmail: false, contactNote: '平日9〜17時（テスト）' },
})

const placeP = await prisma.pickupLocation.create({
  data: { name: 'テスト受渡場所P', prefecture: '大阪府', municipality: '能勢町', address: '（架空）能勢町テスト1-1 直売所前', status: 'APPROVED', createdById: producerIds.farm_a, latitude: 34.9719, longitude: 135.4142, showOnMap: true, hours: '平日10〜16時（テスト）' },
})
await prisma.pickupLocation.create({
  data: { name: 'テスト受渡場所Q', prefecture: '大阪府', municipality: '豊能町', address: '（架空）豊能町テスト2-2 集荷場', status: 'APPROVED', createdById: producerIds.farm_b, latitude: 34.9187, longitude: 135.494, showOnMap: true },
})

const item = async (name: string) => (await prisma.item.findUniqueOrThrow({ where: { name } })).id
const day = addDaysJst(jstDateString(Date.now()), 2)
const base = {
  unit: 'KG' as const,
  minQuantity: 1,
  stepQuantity: 1,
  pickupLocationId: placeP.id,
  pickupStart: new Date(jstToMs(day, '10:00')),
  pickupEnd: new Date(jstToMs(day, '11:00')),
}
// 仕様 8章の例：A 5kg・600円／B 3kg・550円／C 規格外 2kg・350円
await prisma.listing.createMany({
  data: [
    { ...base, producerId: producerIds.farm_a, itemId: await item('トマト'), quantity: 5, unitPriceTaxIncl: 600 },
    { ...base, producerId: producerIds.farm_b, itemId: await item('トマト'), quantity: 3, unitPriceTaxIncl: 550 },
    { ...base, producerId: producerIds.farm_c, itemId: await item('トマト'), quantity: 2, unitPriceTaxIncl: 350, grade: 'IRREGULAR', irregularReason: 'SHAPE' },
    { ...base, producerId: producerIds.farm_a, itemId: await item('なす'), quantity: 4, unitPriceTaxIncl: 480 },
  ],
})

console.log(`ローカル用のテストデータを投入しました（アカウント ${ACCOUNTS.length} 件。パスワードは .env.local の DEV_TEST_PASSWORD）。`)
await prisma.$disconnect()
