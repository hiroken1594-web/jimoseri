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
const { getAuth } = await import('../api/_lib/auth-server.js')
const { addDaysJst, jstDateString, jstToMs } = await import('../shared/time.js')
const prisma = getPrisma()
const auth = getAuth()

const ACCOUNTS = [
  { email: 'admin@test.local', role: 'RESTAURANT', orgName: '運営（テスト）', area: '大阪市' },
  { email: 'restaurant@test.local', role: 'RESTAURANT', orgName: 'テスト小料理店', area: '大阪市福島区' },
  { email: 'restaurant2@test.local', role: 'RESTAURANT', orgName: 'テスト食堂', area: '大阪市北区' },
  { email: 'farm-a@test.local', role: 'PRODUCER', orgName: 'テストA農園', area: '能勢町' },
  { email: 'farm-b@test.local', role: 'PRODUCER', orgName: 'テストB農園', area: '豊能町' },
  { email: 'farm-c@test.local', role: 'PRODUCER', orgName: 'テストC農園', area: '能勢町' },
]

// テスト用アカウントの出品・履歴・場所を消して作り直す（ローカル DB のみ）
await prisma.listing.deleteMany()
await prisma.demand.deleteMany()
await prisma.pickupLocation.deleteMany()
await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })

for (const a of ACCOUNTS) {
  // 実際の登録と同じ処理を通す（パスワードはハッシュ化されて保存される）
  await auth.api.signUpEmail({
    body: { email: a.email, password, name: a.orgName, signupRole: a.role, orgName: a.orgName, area: a.area },
  })
  await prisma.user.update({ where: { email: a.email }, data: { emailVerified: true } })
}
await prisma.user.update({ where: { email: 'admin@test.local' }, data: { role: 'ADMIN' } })

const producerIds: Record<string, string> = {}
for (const a of ACCOUNTS.filter((x) => x.role === 'PRODUCER')) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: a.email } })
  const producer = await prisma.producer.create({
    data: { userId: user.id, farmName: a.orgName, area: a.area, approvalStatus: 'APPROVED' },
  })
  producerIds[a.email] = producer.id
}
await prisma.producer.update({
  where: { id: producerIds['farm-a@test.local'] },
  data: { publicPhone: '090-0000-0000', showPhone: true, publicEmail: 'farm-a-public@test.local', showEmail: false, contactNote: '平日9〜17時（テスト）' },
})

const placeP = await prisma.pickupLocation.create({
  data: { name: 'テスト受渡場所P', municipality: '能勢町', address: '（架空）能勢町テスト1-1 直売所前', status: 'APPROVED', createdById: producerIds['farm-a@test.local'] },
})
await prisma.pickupLocation.create({
  data: { name: 'テスト受渡場所Q', municipality: '豊能町', address: '（架空）豊能町テスト2-2 集荷場', status: 'APPROVED', createdById: producerIds['farm-b@test.local'] },
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
    { ...base, producerId: producerIds['farm-a@test.local'], itemId: await item('トマト'), quantity: 5, unitPriceTaxIncl: 600 },
    { ...base, producerId: producerIds['farm-b@test.local'], itemId: await item('トマト'), quantity: 3, unitPriceTaxIncl: 550 },
    { ...base, producerId: producerIds['farm-c@test.local'], itemId: await item('トマト'), quantity: 2, unitPriceTaxIncl: 350, grade: 'IRREGULAR', irregularReason: 'SHAPE' },
    { ...base, producerId: producerIds['farm-a@test.local'], itemId: await item('なす'), quantity: 4, unitPriceTaxIncl: 480 },
  ],
})

console.log(`ローカル用のテストデータを投入しました（アカウント ${ACCOUNTS.length} 件。パスワードは .env.local の DEV_TEST_PASSWORD）。`)
await prisma.$disconnect()
