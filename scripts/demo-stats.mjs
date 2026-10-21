// 読み取り専用：デモデータの件数と中身の内訳（品目・都道府県・受渡期間）を数える。使い方: node scripts/demo-stats.mjs .env.local
import pg from 'pg'
process.loadEnvFile(process.argv[2])
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
await db.query('BEGIN READ ONLY')
const one = async (sql) => (await db.query(sql)).rows
const counts = (await one(`select
  (select count(*)::int from "Producer" where "isDemo") as producers,
  (select count(*)::int from "PickupLocation" where "isDemo") as locations,
  (select count(*)::int from "Listing" where "isDemo") as listings,
  (select count(*)::int from "Listing" l where l."isDemo" and l."isPublished" and l.quantity > 0 and l."pickupEnd" > now() and not l."adminSuspended") as usable`))[0]
console.log('件数:', JSON.stringify(counts))
console.log('品目:', (await one(`select i.name, count(*)::int as n from "Listing" l join "Item" i on i.id = l."itemId" where l."isDemo" group by 1 order by 2 desc limit 8`)).map((r) => `${r.name} ${r.n}`).join('・'))
console.log('受渡拠点の都道府県:', (await one(`select coalesce(prefecture, '（未登録）') as p, count(*)::int as n from "PickupLocation" where "isDemo" group by 1 order by 2 desc`)).map((r) => `${r.p} ${r.n}`).join('・'))
console.log('受渡期間（日本時間）:', JSON.stringify((await one(`select to_char(min("pickupStart" + interval '9 hours'), 'YYYY-MM-DD') as start_min, to_char(max("pickupEnd" + interval '9 hours'), 'YYYY-MM-DD') as end_max, to_char(min("pickupEnd" + interval '9 hours'), 'YYYY-MM-DD') as end_min from "Listing" where "isDemo"`))[0]))
await db.query('ROLLBACK')
await db.end()
