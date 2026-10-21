// 読み取り専用：デモデータと検索の各段階の件数を数える（書き込みはしない）。使い方: node scripts/inspect-db.mjs .env.local
import pg from 'pg'
process.loadEnvFile(process.argv[2])
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
await db.query('BEGIN READ ONLY')
console.log('host', new URL(process.env.DATABASE_URL).host.split('.')[0].slice(0, 12) + '…')
const q = async (label, sql) => {
  await db.query('SAVEPOINT s')
  try {
    console.log(label, JSON.stringify((await db.query(sql)).rows))
  } catch (e) {
    await db.query('ROLLBACK TO SAVEPOINT s')
    console.log(label, '（取得できません）', e.message)
  }
}
await q('producers', `select "isDemo", "approvalStatus", count(*)::int from "Producer" group by 1,2 order by 1,2`)
await q('locations', `select "isDemo", status, "showOnMap", (latitude is not null) as pos, count(*)::int from "PickupLocation" group by 1,2,3,4 order by 1,2,3,4`)
await q('listings', `select "isDemo", "isPublished", "adminSuspended", (quantity>0) as stock, ("pickupEnd" > now()) as future, count(*)::int from "Listing" group by 1,2,3,4,5 order by 1,2,3,4,5`)
await q('demo pickupEnd range', `select min("pickupEnd"), max("pickupEnd") from "Listing" where "isDemo"`)
await q('restaurants', `select count(*)::int, count("postalCode")::int as with_zip, count(latitude)::int as with_pos from "Restaurant"`)
await q('location prefecture', `select "isDemo", status, (prefecture is not null) as has_pref, count(*)::int from "PickupLocation" group by 1,2,3 order by 1,2,3`)
await q('periods', `select "isDemo", ("pickupWeekdays" is not null) as period, count(*)::int from "Listing" group by 1,2 order by 1,2`)
await q('locations without prefecture', `select "isDemo", status, municipality, ("postalCode" is not null) as has_zip, (latitude is not null) as has_pos from "PickupLocation" where prefecture is null order by 1,2,3`)
await q('real listings', `select i.name as item, l.quantity, l.unit, l."isPublished", l."pickupStart" at time zone 'Asia/Tokyo' as start_jst, l."pickupEnd" at time zone 'Asia/Tokyo' as end_jst, (l."pickupEnd" > now()) as future, p."approvalStatus" as producer, loc.status as loc_status, loc.prefecture, loc.municipality, loc."showOnMap", (loc.latitude is not null) as pos from "Listing" l join "Item" i on i.id = l."itemId" join "Producer" p on p.id = l."producerId" join "PickupLocation" loc on loc.id = l."pickupLocationId" where not l."isDemo" order by l."pickupEnd" desc`)
await db.query('ROLLBACK')
await db.end()
