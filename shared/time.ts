// 日付はすべて日本時間（JST, UTC+9）で扱う。サーバー（UTC）とスマホで結果がずれないようにする。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function jstParts(ms: number): Date {
  return new Date(ms + JST_OFFSET_MS)
}

/** 'YYYY-MM-DD'（日本時間） */
export function jstDateString(ms: number): string {
  return jstParts(ms).toISOString().slice(0, 10)
}

/** 'HH:mm'（日本時間） */
export function jstTimeString(ms: number): string {
  return jstParts(ms).toISOString().slice(11, 16)
}

/** 日本時間の日付・時刻をエポックミリ秒へ。不正な値は NaN。 */
export function jstToMs(date: string, time = '00:00'): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN
  return Date.parse(`${date}T${time}:00+09:00`)
}

/** その日の終わり（翌日0時、日本時間）。「〜まで」の期限判定に使う。 */
export function endOfJstDayMs(date: string): number {
  return jstToMs(date) + DAY_MS
}

export function addDaysJst(date: string, days: number): string {
  return jstDateString(jstToMs(date) + days * DAY_MS)
}

/** 例: 10月14日(水) */
export function formatJstDate(ms: number): string {
  const d = jstParts(ms)
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEKDAYS[d.getUTCDay()]})`
}

/** 例: 10月14日(水) 10:00〜11:00（日をまたぐ場合は終了側にも日付を付ける） */
export function formatWindow(startMs: number, endMs: number): string {
  const sameDay = jstDateString(startMs) === jstDateString(endMs - 1)
  const end = sameDay ? jstTimeString(endMs) : `${formatJstDate(endMs)} ${jstTimeString(endMs)}`
  return `${formatJstDate(startMs)} ${jstTimeString(startMs)}〜${end}`
}

/** 例: 10/12 20:15 */
export function formatJstDateTime(ms: number): string {
  const d = jstParts(ms)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${jstTimeString(ms)}`
}
