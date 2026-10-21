// 読み取り専用：主な表の件数を数える（デプロイの前後で、既存データが消えていないかを確かめる）。使い方: node scripts/count-db.mjs .env.local
import pg from 'pg'
process.loadEnvFile(process.argv[2])
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
await db.query('BEGIN READ ONLY')
const out = {}
for (const t of ['user', 'Producer', 'Restaurant', 'PickupLocation', 'Listing', 'Demand', 'Favorite', 'Report', 'MatchRequest', 'ChatMessage', 'Notification', 'Review']) {
  await db.query('SAVEPOINT s')
  try {
    out[t] = (await db.query(`select count(*)::int as n from "${t}"`)).rows[0].n
  } catch {
    await db.query('ROLLBACK TO SAVEPOINT s')
    out[t] = '（表なし）'
  }
}
const mig = await db.query('select migration_name from _prisma_migrations where finished_at is not null order by migration_name')
console.log(JSON.stringify(out))
console.log('適用済みのマイグレーション:', mig.rows.map((r) => r.migration_name.slice(0, 14)).join(', '))
await db.query('ROLLBACK')
await db.end()
