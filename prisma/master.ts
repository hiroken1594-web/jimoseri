// 品目マスタを登録・更新する。本番でも実行してよい（架空の生産者・在庫・受渡場所は含まない）。
// 実行: npm run db:master
export {}

try {
  process.loadEnvFile('.env.local')
} catch {
  // .env.local が無い環境（Vercel のビルドなど）では、設定済みの環境変数を使う。
}

const ITEMS = [
  { name: 'トマト', aliases: ['とまと', 'tomato'] },
  { name: 'ミニトマト', aliases: ['プチトマト', 'みにとまと'] },
  { name: 'なす', aliases: ['ナス', '茄子'] },
  { name: 'きゅうり', aliases: ['キュウリ', '胡瓜'] },
  { name: 'ピーマン', aliases: ['ぴーまん'] },
  { name: '小松菜', aliases: ['こまつな', 'コマツナ'] },
  { name: 'ほうれん草', aliases: ['ほうれんそう', 'ホウレンソウ'] },
  { name: '水菜', aliases: ['みずな', 'ミズナ'] },
  { name: 'キャベツ', aliases: ['きゃべつ'] },
  { name: '白菜', aliases: ['はくさい', 'ハクサイ'] },
  { name: 'レタス', aliases: ['れたす'] },
  { name: '大根', aliases: ['だいこん', 'ダイコン'] },
  { name: 'にんじん', aliases: ['ニンジン', '人参'] },
  { name: '玉ねぎ', aliases: ['たまねぎ', 'タマネギ', '玉葱'] },
  { name: 'じゃがいも', aliases: ['ジャガイモ', '馬鈴薯'] },
  { name: 'さつまいも', aliases: ['サツマイモ', '薩摩芋'] },
  { name: 'かぼちゃ', aliases: ['カボチャ', '南瓜'] },
  { name: 'ねぎ', aliases: ['ネギ', '葱', '長ねぎ'] },
  { name: '米', aliases: ['お米', 'こめ'] },
  { name: '栗', aliases: ['くり', 'クリ'] },
]

const { getPrisma } = await import('../api/_lib/prisma.js')
const prisma = getPrisma()
for (const [sortOrder, item] of ITEMS.entries()) {
  await prisma.item.upsert({ where: { name: item.name }, update: { ...item, sortOrder }, create: { ...item, sortOrder } })
}
console.log(`品目マスタを登録しました（${ITEMS.length} 件）。`)
await prisma.$disconnect()
