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
    data: { name: 'デモ直売所（お試し用）', municipality: '能勢町', prefecture: '大阪府', address: '架空の住所（お試し用）', note: 'デモデータ（お試し用）', status: 'APPROVED', isDemo: true, createdById: producer.id, latitude: 34.9701, longitude: 135.4171, showOnMap: true },
  }),
  hub: await prisma.pickupLocation.create({
    data: { name: 'デモ集荷場（お試し用）', municipality: '豊能町', prefecture: '大阪府', address: '架空の住所（お試し用）', note: 'デモデータ（お試し用）', status: 'APPROVED', isDemo: true, createdById: producer.id, latitude: 34.9201, longitude: 135.4917, showOnMap: true },
  }),
  pending: await prisma.pickupLocation.create({
    data: { name: 'デモ軒先（お試し用・確認待ち）', municipality: '能勢町', prefecture: '大阪府', address: '架空の住所（お試し用）', note: 'デモデータ（お試し用）', status: 'PENDING', isDemo: true, createdById: producer.id },
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

// 受渡の「期間」：作成した日（今日）を基準に、開始日〜終了日の、決まった曜日・時間帯。
// 固定の日付ではないので、作り直せばいつでも「いま受け取れる」状態になる（終了日は2〜4か月先）。
const WEEKDAY_PATTERNS = [127, 127, 127, 0b0111110, 0b0101010, 0b1010100, 0b1111110]
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
function periodFrom(startOffset: number, endOffset: number, weekdays: number, start: string, end: string) {
  return {
    pickupStart: new Date(jstToMs(addDaysJst(today, startOffset), start)),
    pickupEnd: new Date(jstToMs(addDaysJst(today, endOffset), end)),
    pickupWeekdays: weekdays,
    pickupStartMin: toMin(start),
    pickupEndMin: toMin(end),
  }
}

const rows = []
let n = 0
for (const { kind, count } of PLAN) {
  for (let i = 0; i < count; i++, n++) {
    const c = CATALOG[n % CATALOG.length]
    const price = Math.round(between(c.price[0], c.price[1]) / 10) * 10
    const qty = kind === 'soldout' ? 0 : roundTo(between(c.qty[0], c.qty[1]), c.step)
    // 受渡日：期限切れは過去、それ以外は今日から10日先まで。公開中の3分の2は「期間」（今日を基準に、数日前〜2〜4か月先）にする
    const day = kind === 'expired' ? addDaysJst(today, -Math.ceil(between(1, 20))) : addDaysJst(today, Math.ceil(between(0.5, 10)))
    const [start, end] = pick(TIMES)
    const periodic = kind === 'active' && i % 3 !== 0
    const period = periodic ? periodFrom(-Math.floor(between(0, 5)), Math.floor(between(60, 120)), pick(WEEKDAY_PATTERNS), start, end) : null
    const pickupStart = period ? period.pickupStart.getTime() : jstToMs(day, start)
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
      pickupEnd: period ? period.pickupEnd : new Date(jstToMs(day, end)),
      pickupWeekdays: period?.pickupWeekdays ?? null,
      pickupStartMin: period?.pickupStartMin ?? null,
      pickupEndMin: period?.pickupEndMin ?? null,
      isPublished: kind !== 'stopped',
      adminSuspended: kind === 'suspended',
      isDemo: true,
      createdAt: new Date(createdAtMs),
      updatedAt: new Date(updatedAtMs),
    })
  }
}
await prisma.listing.createMany({ data: rows })


// ---------- 生産者 499 件（demo_farm と合わせて 500 件）・共同受渡拠点 64 か所 ----------
// すべて架空のデモデータ。名前に「デモ」「お試し用」を付け、ログインはできない（パスワードを持たない）アカウントにする。
// 受渡拠点の位置は、市区町村のおおよその中心付近に置いた架空の地点で、実在の施設ではない。
type Region = 'OSAKA_CITY' | 'HOKUSETSU' | 'SAKAI' | 'EAST' | 'TOKYO'
const HUBS: { region: Region; pref: string; city: string; lat: number; lng: number }[] = [
  ...(
    [
      ['大阪市北区', 34.7055, 135.4983], ['大阪市都島区', 34.7013, 135.5297], ['大阪市福島区', 34.6935, 135.4727], ['大阪市此花区', 34.6828, 135.4528],
      ['大阪市中央区', 34.6813, 135.51], ['大阪市西区', 34.6769, 135.4862], ['大阪市港区', 34.6638, 135.4615], ['大阪市大正区', 34.6517, 135.4719],
      ['大阪市天王寺区', 34.6588, 135.5193], ['大阪市浪速区', 34.6599, 135.4985], ['大阪市西淀川区', 34.711, 135.4566], ['大阪市淀川区', 34.733, 135.4836],
      ['大阪市東淀川区', 34.7398, 135.5287], ['大阪市東成区', 34.6708, 135.5402], ['大阪市生野区', 34.6534, 135.5459], ['大阪市旭区', 34.7232, 135.5444],
      ['大阪市城東区', 34.6974, 135.5436], ['大阪市鶴見区', 34.7044, 135.5735], ['大阪市阿倍野区', 34.6377, 135.5184], ['大阪市住之江区', 34.6097, 135.4826],
      ['大阪市住吉区', 34.6037, 135.5156], ['大阪市東住吉区', 34.6215, 135.5326], ['大阪市西成区', 34.6346, 135.4934], ['大阪市平野区', 34.6209, 135.5603],
    ] as const
  ).map(([city, lat, lng]) => ({ region: 'OSAKA_CITY' as const, pref: '大阪府', city, lat, lng })),
  ...(
    [
      ['豊中市', 34.7813, 135.4697], ['吹田市', 34.7594, 135.5169], ['茨木市', 34.8164, 135.5683], ['高槻市', 34.8463, 135.6176], ['箕面市', 34.827, 135.4705],
      ['池田市', 34.8217, 135.4286], ['摂津市', 34.7774, 135.5622], ['島本町', 34.8836, 135.6631], ['能勢町', 34.9719, 135.4142], ['豊能町', 34.9187, 135.494],
    ] as const
  ).map(([city, lat, lng]) => ({ region: 'HOKUSETSU' as const, pref: '大阪府', city, lat, lng })),
  ...(
    [
      ['堺市堺区', 34.5733, 135.4831], ['堺市北区', 34.585, 135.513], ['堺市中区', 34.5418, 135.5072], ['堺市東区', 34.541, 135.542], ['堺市西区', 34.5367, 135.4655],
      ['堺市南区', 34.488, 135.491], ['堺市美原区', 34.542, 135.56], ['和泉市', 34.4834, 135.4236], ['高石市', 34.5203, 135.4423], ['大阪狭山市', 34.5036, 135.5557],
      ['松原市', 34.5776, 135.5517], ['羽曳野市', 34.5579, 135.6062], ['富田林市', 34.4997, 135.5972],
    ] as const
  ).map(([city, lat, lng]) => ({ region: 'SAKAI' as const, pref: '大阪府', city, lat, lng })),
  ...(
    [
      ['東大阪市', 34.6795, 135.6008], ['八尾市', 34.6269, 135.6008], ['守口市', 34.7377, 135.5641], ['門真市', 34.7393, 135.5871], ['寝屋川市', 34.7662, 135.6276],
      ['枚方市', 34.8143, 135.651], ['交野市', 34.7877, 135.68],
    ] as const
  ).map(([city, lat, lng]) => ({ region: 'EAST' as const, pref: '大阪府', city, lat, lng })),
  ...(
    [
      ['新宿区', 35.6938, 139.7034], ['渋谷区', 35.664, 139.6982], ['世田谷区', 35.6464, 139.6532], ['練馬区', 35.7356, 139.6517], ['杉並区', 35.6995, 139.6364],
      ['大田区', 35.5613, 139.716], ['江戸川区', 35.7068, 139.8683], ['八王子市', 35.6664, 139.316], ['町田市', 35.5465, 139.4385], ['立川市', 35.6939, 139.4074],
    ] as const
  ).map(([city, lat, lng]) => ({ region: 'TOKYO' as const, pref: '東京都', city, lat, lng })),
]
const REGION_LABEL: Record<Region, string> = { OSAKA_CITY: '大阪市内', HOKUSETSU: '北摂', SAKAI: '堺・南河内', EAST: '東大阪・北河内', TOKYO: '東京' }
const REGION_COUNTS: [Region, number][] = [['OSAKA_CITY', 150], ['HOKUSETSU', 140], ['SAKAI', 100], ['EAST', 60], ['TOKYO', 44]]
const SLOTS: [string, string][] = [['09:00', '10:00'], ['10:00', '11:00'], ['14:00', '15:00']]
// 検証用の組み合わせを置く拠点（ここにはランダムなトマトを置かない）
const SCENARIO_CITY = '大阪市福島区'

const hubRows = HUBS.map((h, i) => ({
  id: `demo-hub-${String(i + 1).padStart(2, '0')}`,
  name: `デモ共同受渡拠点（${h.city}）`,
  municipality: h.city,
  prefecture: h.pref,
  address: '架空の住所（デモ）',
  note: 'デモデータ（お試し用）。実在の施設ではありません。',
  hours: '平日9〜15時（デモ）',
  latitude: Math.round((h.lat + (rand() - 0.5) * 0.004) * 1e6) / 1e6,
  longitude: Math.round((h.lng + (rand() - 0.5) * 0.004) * 1e6) / 1e6,
  showOnMap: true,
  status: 'APPROVED' as const,
  isDemo: true,
  createdById: producer.id,
}))
await prisma.pickupLocation.createMany({ data: hubRows })
const hubsByRegion = new Map<Region, typeof hubRows>()
HUBS.forEach((h, i) => hubsByRegion.set(h.region, [...(hubsByRegion.get(h.region) ?? []), hubRows[i]]))
// 拠点ごとに受渡の時間帯を決める（同じ拠点・同じ日の出品は同じ時間帯になり、組み合わせられる）
const slotOf = (hubIndex: number) => SLOTS[hubIndex % SLOTS.length]

const userRows: { id: string; name: string; email: string; emailVerified: boolean; username: string; displayUsername: string; role: 'PRODUCER'; orgName: string; area: string; signupRole: string }[] = []
const producerRows: { id: string; userId: string; farmName: string; area: string; approvalStatus: 'APPROVED'; isDemo: boolean; prefecture: string; city: string }[] = []
const manyListings: typeof rows = []
let serial = 0
for (const [region, count] of REGION_COUNTS) {
  const hubs = hubsByRegion.get(region)!
  for (let i = 0; i < count; i++) {
    serial++
    const no = String(serial).padStart(3, '0')
    const home = pick(hubs)
    const farmName = `デモ${REGION_LABEL[region]}農園${no}（お試し用）`
    userRows.push({ id: `demo-user-${no}`, name: farmName, email: `demo_p${no}@users.jimoseri.invalid`, emailVerified: true, username: `demo_p${no}`, displayUsername: `demo_p${no}`, role: 'PRODUCER', orgName: farmName, area: home.municipality, signupRole: 'PRODUCER' })
    producerRows.push({ id: `demo-prod-${no}`, userId: `demo-user-${no}`, farmName, area: home.municipality, approvalStatus: 'APPROVED', isDemo: true, prefecture: home.prefecture, city: home.municipality })
    const listingCount = 1 + Math.floor(rand() * 3)
    for (let k = 0; k < listingCount; k++) {
      // 6割は近くの拠点（自分の地域の拠点の先頭寄り）に集め、同じ拠点を複数の農家が使うようにする
      const hub = rand() < 0.6 ? hubs[Math.floor(rand() * Math.min(4, hubs.length))] : pick(hubs)
      const hubIndex = hubRows.indexOf(hub)
      let c = CATALOG[Math.floor(rand() * CATALOG.length)]
      // トマト・きゅうり・玉ねぎ・キャベツ・にんじんを多めにする
      if (rand() < 0.45) {
        const favorite = pick(['トマト', 'きゅうり', '玉ねぎ', 'キャベツ', 'にんじん'])
        c = CATALOG.find((x) => x.item === favorite)!
      }
      if (hub.municipality === SCENARIO_CITY && c.item === 'トマト') c = CATALOG.find((x) => x.item === 'キャベツ')!
      const day = addDaysJst(today, 1 + Math.floor(rand() * 7))
      const [start, end] = slotOf(hubIndex)
      // 85% は期間の出品（今日の0〜6日前から、60〜120日先まで）。残りは1〜7日先の1日だけの出品。
      const period = rand() < 0.85 ? periodFrom(-Math.floor(rand() * 7), 60 + Math.floor(rand() * 61), pick(WEEKDAY_PATTERNS), start, end) : null
      const irregular = rand() < 0.2
      const price = Math.round(between(c.price[0], c.price[1]) / 10) * 10
      const createdAtMs = now - Math.ceil(between(1, 25)) * DAY_MS
      manyListings.push({
        producerId: `demo-prod-${no}`,
        itemId: itemIds.get(c.item)!,
        variety: pick(c.varieties),
        grade: irregular ? ('IRREGULAR' as const) : ('REGULAR' as const),
        irregularReason: irregular ? pick(['SHAPE', 'SHAPE', 'SIZE', 'SURPLUS'] as const) : null,
        quantity: roundTo(between(c.qty[0], c.qty[1]), c.step),
        unit: c.unit,
        unitPriceTaxIncl: irregular ? Math.round((price * between(0.7, 0.9)) / 10) * 10 : price,
        minQuantity: c.min,
        stepQuantity: c.step,
        pickupLocationId: hub.id,
        pickupStart: period ? period.pickupStart : new Date(jstToMs(day, start)),
        pickupEnd: period ? period.pickupEnd : new Date(jstToMs(day, end)),
        pickupWeekdays: period?.pickupWeekdays ?? null,
        pickupStartMin: period?.pickupStartMin ?? null,
        pickupEndMin: period?.pickupEndMin ?? null,
        isPublished: rand() > 0.05,
        adminSuspended: false,
        isDemo: true,
        createdAt: new Date(createdAtMs),
        updatedAt: new Date(Math.min(now - 60_000, createdAtMs + Math.round(between(0, 3) * DAY_MS))),
      })
    }
  }
}

// 検証用の組み合わせ（大阪市福島区）：今日から90日間、毎日10〜11時に、トマトを 5kg・2kg・1kg の3農家が出品 → 10kg の希望に対して 8kg・2kg不足。
// 近くの別拠点（大阪市北区）には同じ期間・時間帯に 3kg、同じ拠点には明々後日から1農家で 10kg を置き、「条件を広げた場合の参考」を確かめられるようにする。
const scenarioHub = hubRows.find((h) => h.municipality === SCENARIO_CITY)!
const kitaHub = hubRows.find((h) => h.municipality === '大阪市北区')!
// [コード, 名前, 数量kg, 単価, 拠点, 期間の開始（今日から何日後）]
const scenario: [string, string, number, number, string, number][] = [
  ['S1', 'デモ検証農園A（お試し用）', 5, 600, scenarioHub.id, 0],
  ['S2', 'デモ検証農園B（お試し用）', 2, 550, scenarioHub.id, 0],
  ['S3', 'デモ検証農園C（お試し用）', 1, 350, scenarioHub.id, 0],
  ['S4', 'デモ検証農園D（お試し用）', 3, 580, kitaHub.id, 0],
  ['S5', 'デモ検証農園E（お試し用）', 10, 560, scenarioHub.id, 3],
]
for (const [code, farmName, qty, price, hubId, startOffset] of scenario) {
  const period = periodFrom(startOffset, 90, 127, '10:00', '11:00')
  userRows.push({ id: `demo-user-${code}`, name: farmName, email: `demo_${code.toLowerCase()}@users.jimoseri.invalid`, emailVerified: true, username: `demo_${code.toLowerCase()}`, displayUsername: `demo_${code.toLowerCase()}`, role: 'PRODUCER', orgName: farmName, area: SCENARIO_CITY, signupRole: 'PRODUCER' })
  producerRows.push({ id: `demo-prod-${code}`, userId: `demo-user-${code}`, farmName, area: SCENARIO_CITY, approvalStatus: 'APPROVED', isDemo: true, prefecture: '大阪府', city: SCENARIO_CITY })
  manyListings.push({
    producerId: `demo-prod-${code}`,
    itemId: itemIds.get('トマト')!,
    variety: '検証用',
    grade: 'REGULAR',
    irregularReason: null,
    quantity: qty,
    unit: 'KG',
    unitPriceTaxIncl: price,
    minQuantity: 1,
    stepQuantity: 1,
    pickupLocationId: hubId,
    ...period,
    isPublished: true,
    adminSuspended: false,
    isDemo: true,
    createdAt: new Date(now - DAY_MS),
    updatedAt: new Date(now - 60_000),
  })
}

await prisma.user.createMany({ data: userRows })
await prisma.producer.createMany({ data: producerRows })
for (let i = 0; i < manyListings.length; i += 500) await prisma.listing.createMany({ data: manyListings.slice(i, i + 500) })

const regionSummary = REGION_COUNTS.map(([r, n]) => `${REGION_LABEL[r]} ${n}`).join('・')
console.log(`デモの生産者を追加しました：${userRows.length} 件（${regionSummary}・検証用 ${scenario.length}）、共同受渡拠点 ${hubRows.length} か所、出品 ${manyListings.length} 件`)

const summary = PLAN.map((p) => `${{ active: '公開中', stopped: '公開停止', soldout: '数量0', expired: '受渡日を過ぎた', suspended: '運営者が停止', pending: '場所が確認待ち' }[p.kind]} ${p.count}`).join('・')
console.log(`デモ用アカウント demo_farm の出品 ${rows.length} 件（${summary}）、受渡場所 3 件`)
console.log(`デモ用アカウント：ユーザー名「${DEMO_USERNAME}」。パスワードは ${PASSWORD_FILE} に保存しました（Git には含まれません）。`)
await prisma.$disconnect()
