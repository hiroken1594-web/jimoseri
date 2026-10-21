// デモデータ（お試し用）の登録と一括削除。生産者側の画面を試すための架空のデータで、実在の取引情報ではない。
//   npm run demo:seed    … デモデータ（大阪府内のトマト・受渡期間は作成日〜2026年12月31日）を作り直す（何度実行しても同じ件数）
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
  const users = await prisma.user.deleteMany({ where: { OR: [{ producer: { isDemo: true } }, { restaurant: { isDemo: true } }] } })
  console.log(`デモデータを削除しました：出品 ${listings.count} 件、受渡場所 ${locations.count} 件、アカウント ${users.count} 件`)
}

if (command === 'remove') {
  await removeDemoData()
  await prisma.$disconnect()
  process.exit(0)
}

// ---------- 登録 ----------
// デモの受渡期間は「作成した日 〜 2026年12月31日」。その日を過ぎていたら、何も変えずに止める（期間の再設定が必要）
const PERIOD_END = '2026-12-31'
const today = jstDateString(Date.now())
const now = Date.now()
if (today > PERIOD_END) {
  console.error(`今日（${today}）は、デモの受渡期間の終わり（${PERIOD_END}）を過ぎています。デモデータは更新していません。scripts/demo-data.ts の PERIOD_END を再設定してください。`)
  await prisma.$disconnect()
  process.exit(2)
}
const { registerAccount } = await import('../api/_lib/accounts.js')
await removeDemoData()
const existing = await prisma.user.findFirst({ where: { username: { in: [DEMO_USERNAME, 'demo_shop'] } } })
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

// デモ用の飲食店（お試し用）：生産者からの取引提案を受け取る設定。デモの生産者は、この飲食店にだけ提案できる
{
  const shopRes = await registerAccount({ username: 'demo_shop', password: demoPassword, role: 'RESTAURANT', orgName: 'デモ食堂（お試し用）', area: '大阪市福島区' })
  if (!shopRes.ok) throw new Error(`デモ用の飲食店を作成できませんでした: ${shopRes.status}`)
  const shopUser = await prisma.user.findUniqueOrThrow({ where: { username: 'demo_shop' } })
  await prisma.restaurant.create({
    data: { userId: shopUser.id, name: 'デモ食堂（お試し用）', area: '大阪市福島区', prefecture: '大阪府', city: '大阪市福島区', isDemo: true, acceptProposals: true },
  })
}
const producer = await prisma.producer.create({
  data: {
    userId: user.id,
    farmName: 'デモ農園（お試し用）',
    area: '豊能郡能勢町',
    approvalStatus: 'APPROVED',
    isDemo: true,
    contactNote: 'デモデータ（お試し用）のため、連絡先はありません',
    prefecture: '大阪府',
    city: '豊能郡能勢町',
  },
})

// ---------- 大阪府内の共同受渡拠点（64か所） ----------
// 住所（郵便番号・市区町村・町域）と位置は、HeartRails Geo API で調べた町域の代表地点（scripts/data/osaka-hubs.json）。
// 拠点そのものは架空の施設。私有地を指さないよう、番地は付けず「町域の代表地点」とする。
interface HubData { city: string; prefecture: string; apiCity: string; town: string; postal: string; lat: number; lng: number; extra: boolean }
const HUB_DATA: HubData[] = JSON.parse(readFileSync(new URL('./data/osaka-hubs.json', import.meta.url), 'utf8'))
type Region = 'OSAKA_CITY' | 'HOKUSETSU' | 'SAKAI' | 'EAST' | 'SENSHU'
// osaka-hubs.json の並び：大阪市24・北摂10・堺／南河内13・東大阪／北河内7・泉州ほか10
const regionOfIndex = (i: number): Region => (i < 24 ? 'OSAKA_CITY' : i < 34 ? 'HOKUSETSU' : i < 47 ? 'SAKAI' : i < 54 ? 'EAST' : 'SENSHU')
const REGION_LABEL: Record<Region, string> = { OSAKA_CITY: '大阪市内', HOKUSETSU: '北摂', SAKAI: '堺・南河内', EAST: '東大阪・北河内', SENSHU: '泉州・南河内' }
const REGION_COUNTS: [Region, number][] = [['OSAKA_CITY', 150], ['HOKUSETSU', 140], ['SAKAI', 100], ['EAST', 60], ['SENSHU', 44]]
const SLOTS: [string, string][] = [['09:00', '10:00'], ['10:00', '11:00'], ['14:00', '15:00'], ['16:00', '17:00']]
const HOURS = ['平日9〜15時（デモ）', '毎日8〜12時（デモ）', '火・木・土 10〜16時（デモ）', '平日14〜17時（デモ）']
// 受け取れる曜日：毎日・平日・月水金・火木土・日曜以外
const WEEKDAY_PATTERNS = [127, 127, 0b0111110, 0b0111110, 0b0101010, 0b1010100, 0b1111110]
const SCENARIO_CITY = '大阪市福島区'

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
/** 受渡の期間：開始日（今日から startOffset 日後）〜 2026年12月31日、決まった曜日・時間帯 */
function period(startOffset: number, weekdays: number, start: string, end: string) {
  const startDate = addDaysJst(today, startOffset) > PERIOD_END ? PERIOD_END : addDaysJst(today, startOffset)
  return {
    pickupStart: new Date(jstToMs(startDate, start)),
    pickupEnd: new Date(jstToMs(PERIOD_END, end)),
    pickupWeekdays: weekdays,
    pickupStartMin: toMin(start),
    pickupEndMin: toMin(end),
  }
}

const hubRows = HUB_DATA.map((h, i) => ({
  id: `demo-hub-${String(i + 1).padStart(2, '0')}`,
  name: `デモ共同受渡拠点（${h.city}${h.town}）`,
  municipality: h.apiCity,
  prefecture: h.prefecture,
  postalCode: h.postal,
  town: h.town,
  address: `${h.town}（町域の代表地点・デモ）`,
  building: '',
  note: 'デモデータ（お試し用）。実在の施設ではありません。位置は町域の代表地点です。',
  hours: HOURS[i % HOURS.length],
  latitude: h.lat,
  longitude: h.lng,
  showOnMap: true,
  status: 'APPROVED' as const,
  isDemo: true,
  createdById: producer.id,
}))
await prisma.pickupLocation.createMany({ data: hubRows })
const hubsByRegion = new Map<Region, typeof hubRows>()
hubRows.forEach((h, i) => hubsByRegion.set(regionOfIndex(i), [...(hubsByRegion.get(regionOfIndex(i)) ?? []), h]))
const hubData = (id: string) => HUB_DATA[hubRows.findIndex((h) => h.id === id)]
// 拠点ごとに受渡の時間帯を決める（同じ拠点・同じ日の出品は同じ時間帯になり、組み合わせられる）
const slotOf = (hubIndex: number) => SLOTS[hubIndex % SLOTS.length]

// demo_farm の受渡場所（能勢町・豊能町）：共同受渡拠点と同じく、町域の代表地点を使う
const nose = HUB_DATA.find((h) => h.city === '能勢町')!
const toyono = HUB_DATA.find((h) => h.city === '豊能町')!
const ownLocation = (name: string, h: HubData, hours: string) =>
  prisma.pickupLocation.create({
    data: {
      name,
      municipality: h.apiCity,
      prefecture: h.prefecture,
      postalCode: h.postal,
      town: h.town,
      address: `${h.town}（町域の代表地点・デモ）`,
      building: '',
      note: 'デモデータ（お試し用）。実在の施設ではありません。',
      hours,
      status: 'APPROVED',
      isDemo: true,
      createdById: producer.id,
      latitude: h.lat,
      longitude: h.lng,
      showOnMap: true,
    },
  })
const ownLocations = [
  await ownLocation('デモ直売所（お試し用）', nose, '毎日8〜12時（デモ）'),
  await ownLocation('デモ集荷場（お試し用）', toyono, '平日9〜15時（デモ）'),
  await ownLocation('デモ軒先（お試し用）', nose, '土日10〜15時（デモ）'),
]

// ---------- トマトの出品 ----------
// 品種ごとの税込単価の幅（円/kg）。その他の項目（数量・最低取引量・規格外・受渡場所・曜日・時間帯・配送・送料・説明）にばらつきを持たせる。
const VARIETIES: { name: string; price: [number, number]; note: string }[] = [
  { name: '桃太郎', price: [560, 780], note: '定番の大玉。甘みと酸味のバランスが良く、サラダにも料理にも' },
  { name: 'りんか409', price: [520, 720], note: '大玉で実がしっかり。日持ちが良く、カットしても崩れにくい' },
  { name: '麗夏', price: [540, 760], note: '果肉がかためで、スライスや焼き料理に向く' },
  { name: 'ファーストトマト', price: [750, 1000], note: '先がとがった形が特徴。ゼリー部分が少なく、昔ながらの濃い味' },
  { name: 'フルティカ（中玉）', price: [700, 950], note: '中玉で糖度が高め。前菜やお弁当の彩りに' },
  { name: 'サンマルツァーノ（調理用）', price: [600, 850], note: '加熱向きの調理用。ソースや煮込みに' },
  { name: 'ハウス桃太郎', price: [600, 820], note: 'ハウス栽培で、粒がそろいやすい' },
  { name: '高糖度トマト', price: [900, 1300], note: '水を控えて育てた高糖度タイプ。デザート感覚で' },
]
const TASTES = ['朝どりです。', '樹上で赤く熟してから収穫しています。', '減農薬で育てました。', '有機肥料を使って育てています。', '地元の直売所でも人気の品種です。']
const SHIPPING_FEES: (number | null)[] = [null, 0, 500, 800, 1000, 1200]
const MIN_QTY = [1, 1, 2, 3, 5]

// 毎回同じ内容になるよう、決まった種から乱数を作る
let seed = 20261023
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]
const between = (a: number, b: number) => a + rand() * (b - a)
const tomatoId = (await prisma.item.findUniqueOrThrow({ where: { name: 'トマト' } })).id

/** トマトの出品を1件作る（在庫は必ず0より大きく、公開中） */
function tomatoListing(producerId: string, hub: { id: string }, hubIndex: number, createdAtMs: number) {
  const v = pick(VARIETIES)
  const irregular = rand() < 0.2
  const price = Math.round(between(v.price[0], v.price[1]) / 10) * 10
  const quantity = Math.max(3, Math.round(between(3, 40)))
  const minQuantity = Math.min(pick(MIN_QTY), quantity)
  const deliveryAvailable = rand() < 0.45
  const shippingFeeYen = deliveryAvailable ? pick(SHIPPING_FEES) : null
  const [start, end] = slotOf(hubIndex)
  const description = [
    `${v.note}。`,
    pick(TASTES),
    irregular ? '形やサイズが不ぞろいなため、お手頃な価格にしています。' : '',
    deliveryAvailable ? (shippingFeeYen === null ? '配送は送料を相談のうえで対応します。' : shippingFeeYen === 0 ? '配送は送料無料で対応します。' : `配送にも対応します（送料の目安 ${shippingFeeYen}円）。`) : '受渡場所での受け取りをお願いします。',
  ].join('')
  return {
    producerId,
    itemId: tomatoId,
    variety: v.name,
    grade: irregular ? ('IRREGULAR' as const) : ('REGULAR' as const),
    irregularReason: irregular ? pick(['SHAPE', 'SHAPE', 'SIZE', 'SURPLUS'] as const) : null,
    quantity,
    unit: 'KG' as const,
    unitPriceTaxIncl: irregular ? Math.round((price * between(0.7, 0.85)) / 10) * 10 : price,
    minQuantity,
    stepQuantity: 1,
    pickupLocationId: hub.id,
    ...period(0, pick(WEEKDAY_PATTERNS), start, end),
    description,
    deliveryAvailable,
    shippingFeeYen,
    isPublished: true,
    adminSuspended: false,
    isDemo: true,
    createdAt: new Date(createdAtMs),
    updatedAt: new Date(Math.min(now - 60_000, createdAtMs + Math.round(between(0, 3) * DAY_MS))),
  }
}

// demo_farm の出品 50 件（すべてトマト・公開中）
const rows = Array.from({ length: 50 }, (_, i) => tomatoListing(producer.id, ownLocations[i % 3], i, now - Math.ceil(between(1, 20)) * DAY_MS))
await prisma.listing.createMany({ data: rows })

// ---------- 生産者 494 件（＋検証用 5 件・demo_farm で 500 件） ----------
const userRows: { id: string; name: string; email: string; emailVerified: boolean; username: string; displayUsername: string; role: 'PRODUCER'; orgName: string; area: string; signupRole: string }[] = []
const producerRows: { id: string; userId: string; farmName: string; area: string; approvalStatus: 'APPROVED'; isDemo: boolean; prefecture: string; city: string; postalCode: string; town: string; addressLine: string; building: string }[] = []
const manyListings: ReturnType<typeof tomatoListing>[] = []
let serial = 0
for (const [region, count] of REGION_COUNTS) {
  const hubs = hubsByRegion.get(region)!
  for (let i = 0; i < count; i++) {
    serial++
    const no = String(serial).padStart(3, '0')
    const home = pick(hubs)
    const h = hubData(home.id)
    const farmName = `デモ${REGION_LABEL[region]}農園${no}（お試し用）`
    userRows.push({ id: `demo-user-${no}`, name: farmName, email: `demo_p${no}@users.jimoseri.invalid`, emailVerified: true, username: `demo_p${no}`, displayUsername: `demo_p${no}`, role: 'PRODUCER', orgName: farmName, area: home.municipality, signupRole: 'PRODUCER' })
    // 所在地（非公開）：町域までは実在、番地は架空
    producerRows.push({ id: `demo-prod-${no}`, userId: `demo-user-${no}`, farmName, area: home.municipality, approvalStatus: 'APPROVED', isDemo: true, prefecture: h.prefecture, city: h.apiCity, postalCode: h.postal, town: h.town, addressLine: '（デモの架空の番地）', building: '' })
    const listingCount = 1 + Math.floor(rand() * 3)
    for (let k = 0; k < listingCount; k++) {
      // 6割は近くの拠点（自分の地域の拠点の先頭寄り）に集め、同じ拠点を複数の農家が使うようにする
      let hub = rand() < 0.6 ? hubs[Math.floor(rand() * Math.min(4, hubs.length))] : pick(hubs)
      // 福島区の拠点は、検証用の組み合わせ（検証農園A〜E）だけが使う（「3農家で8kg」を確かめられるように）
      if (hub.municipality === SCENARIO_CITY) hub = hubs.find((h) => h.municipality !== SCENARIO_CITY)!
      manyListings.push(tomatoListing(`demo-prod-${no}`, hub, hubRows.indexOf(hub), now - Math.ceil(between(1, 25)) * DAY_MS))
    }
  }
}

// 検証用の組み合わせ（大阪市福島区）：今日から12月31日まで、毎日10〜11時に、トマトを 5kg・2kg・1kg の3農家が出品 → 10kg の希望に対して 8kg・2kg不足。
// 近くの別拠点（大阪市北区）には同じ期間・時間帯に 3kg、同じ拠点には明々後日から1農家で 10kg を置き、「条件を広げた場合の参考」を確かめられるようにする。
const scenarioHub = hubRows.find((h) => h.municipality === SCENARIO_CITY)!
const kitaHub = hubRows.find((h) => h.municipality === '大阪市北区')!
// [コード, 名前, 数量kg, 単価, 拠点, 期間の開始（今日から何日後）, 品種]
const scenario: [string, string, number, number, string, number, string][] = [
  ['S1', 'デモ検証農園A（お試し用）', 5, 600, scenarioHub.id, 0, '桃太郎'],
  ['S2', 'デモ検証農園B（お試し用）', 2, 550, scenarioHub.id, 0, 'りんか409'],
  ['S3', 'デモ検証農園C（お試し用）', 1, 350, scenarioHub.id, 0, '麗夏'],
  ['S4', 'デモ検証農園D（お試し用）', 3, 580, kitaHub.id, 0, '桃太郎'],
  ['S5', 'デモ検証農園E（お試し用）', 10, 560, scenarioHub.id, 3, 'ハウス桃太郎'],
]
const scenarioHubData = hubData(scenarioHub.id)
for (const [code, farmName, qty, price, hubId, startOffset, variety] of scenario) {
  userRows.push({ id: `demo-user-${code}`, name: farmName, email: `demo_${code.toLowerCase()}@users.jimoseri.invalid`, emailVerified: true, username: `demo_${code.toLowerCase()}`, displayUsername: `demo_${code.toLowerCase()}`, role: 'PRODUCER', orgName: farmName, area: SCENARIO_CITY, signupRole: 'PRODUCER' })
  producerRows.push({ id: `demo-prod-${code}`, userId: `demo-user-${code}`, farmName, area: SCENARIO_CITY, approvalStatus: 'APPROVED', isDemo: true, prefecture: '大阪府', city: SCENARIO_CITY, postalCode: scenarioHubData.postal, town: scenarioHubData.town, addressLine: '（デモの架空の番地）', building: '' })
  manyListings.push({
    ...tomatoListing(`demo-prod-${code}`, { id: hubId }, 1, now - DAY_MS),
    variety,
    grade: 'REGULAR',
    irregularReason: null,
    quantity: qty,
    unitPriceTaxIncl: price,
    minQuantity: 1,
    ...period(startOffset, 127, '10:00', '11:00'),
    description: `検証用のトマトです（${variety}）。複数の農家の組み合わせを試せます。`,
    deliveryAvailable: false,
    shippingFeeYen: null,
    updatedAt: new Date(now - 60_000),
  })
}

await prisma.user.createMany({ data: userRows })
// 検証用の5農家（デモ検証農園A〜E）は、マッチング依頼の承認・チャットを試せるよう、demo_farm と同じパスワードでログインできるようにする
{
  const { getAuth } = await import('../api/_lib/auth-server.js')
  const hash = await (await getAuth().$context).password.hash(demoPassword)
  await prisma.account.createMany({
    data: scenario.map(([code]) => ({ id: `demo-account-${code}`, accountId: `demo-user-${code}`, providerId: 'credential', userId: `demo-user-${code}`, password: hash })),
  })
}
await prisma.producer.createMany({ data: producerRows })
for (let i = 0; i < manyListings.length; i += 500) await prisma.listing.createMany({ data: manyListings.slice(i, i + 500) })

const regionSummary = REGION_COUNTS.map(([r, n]) => `${REGION_LABEL[r]} ${n}`).join('・')
console.log(`デモの生産者を追加しました：${userRows.length} 件（${regionSummary}・検証用 ${scenario.length}）、共同受渡拠点 ${hubRows.length} か所（すべて大阪府）、出品 ${manyListings.length} 件（すべてトマト）`)
console.log(`デモ用アカウント demo_farm の出品 ${rows.length} 件（すべてトマト・公開中）、受渡場所 ${ownLocations.length} 件`)
console.log(`受渡の期間：${today} 〜 ${PERIOD_END}（曜日・時間帯は出品ごと）`)
console.log(`デモ用アカウント：ユーザー名「${DEMO_USERNAME}」、デモの飲食店「demo_shop」と、検証用の農家 ${scenario.map(([code]) => `demo_${code.toLowerCase()}`).join('・')}。パスワードは ${PASSWORD_FILE} に保存しました（Git には含まれません）。`)
await prisma.$disconnect()
