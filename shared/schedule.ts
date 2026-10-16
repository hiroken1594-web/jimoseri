// 受渡の「期間」：開始日〜終了日のうち、決まった曜日・時間帯に受け取れる出品。
// 1日だけの出品（従来の形）は schedule が null で、pickupStartMs〜pickupEndMs の1回だけ受け取れる。
// 期間の出品では、pickupStartMs は最初の回の開始、pickupEndMs は最後の回の終了を表す（期限切れの判定にそのまま使える）。
import { allocate, DEFAULT_LIMITS, type AllocationResult, type DemandSpec, type ListingCandidate, type SearchLimits } from './allocate.js'
import { addDaysJst, formatJstDate, formatWindow, jstDateString, jstToMs } from './time.js'

export interface PickupSchedule {
  /** 受け取れる曜日。日曜=1, 月曜=2, 火曜=4 … 土曜=64 の合計（毎日は 127） */
  weekdays: number
  /** その日の受渡時間帯（0時からの分） */
  startMin: number
  endMin: number
}

export const ALL_WEEKDAYS = 127
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 期間の出品を、まとめて計算するときに見る日数の上限（希望日がこれより先でも、この日数分だけ探す） */
export const MAX_SCHEDULE_DAYS = 62

export const minToTime = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
export const timeToMin = (time: string): number => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** 日本時間の日付の曜日（0=日曜） */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay()

export function weekdayLabel(weekdays: number): string {
  if ((weekdays & ALL_WEEKDAYS) === ALL_WEEKDAYS) return '毎日'
  if (weekdays === 0b0111110) return '平日（月〜金）'
  if (weekdays === 0b1000001) return '土日'
  return WEEKDAY_LABELS.filter((_, i) => weekdays & (1 << i)).join('・')
}

/** 期間の最初の日・最後の日（日本時間） */
export function periodDates(c: Pick<ListingCandidate, 'pickupStartMs' | 'pickupEndMs'>): { startDate: string; endDate: string } {
  return { startDate: jstDateString(c.pickupStartMs), endDate: jstDateString(c.pickupEndMs - 1) }
}

type Scheduled = Pick<ListingCandidate, 'pickupStartMs' | 'pickupEndMs' | 'schedule'>

/** その日に受け取れる時間帯。受け取れない日は null。 */
export function occurrenceOn(c: Scheduled, date: string): { startMs: number; endMs: number } | null {
  if (!c.schedule) {
    // 1日だけの出品：その日と時間帯が重なっていれば、その時間帯
    const dayStart = jstToMs(date)
    const dayEnd = jstToMs(addDaysJst(date, 1))
    return c.pickupStartMs < dayEnd && dayStart < c.pickupEndMs ? { startMs: c.pickupStartMs, endMs: c.pickupEndMs } : null
  }
  const { startDate, endDate } = periodDates(c)
  if (date < startDate || date > endDate) return null
  if (!(c.schedule.weekdays & (1 << weekdayOf(date)))) return null
  return { startMs: jstToMs(date, minToTime(c.schedule.startMin)), endMs: jstToMs(date, minToTime(c.schedule.endMin)) }
}

/** fromMs 以降で、まだ終わっていない次の受渡の時間帯。期間が終わっていれば null。 */
export function nextOccurrence(c: Scheduled, fromMs: number): { startMs: number; endMs: number } | null {
  if (!c.schedule) return c.pickupEndMs > fromMs ? { startMs: c.pickupStartMs, endMs: c.pickupEndMs } : null
  const { endDate } = periodDates(c)
  let date = jstDateString(Math.max(fromMs, c.pickupStartMs))
  for (let i = 0; i < 400 && date <= endDate; i++, date = addDaysJst(date, 1)) {
    const o = occurrenceOn(c, date)
    if (o && o.endMs > fromMs) return o
  }
  return null
}

/** その日に受け取れて、まだ終わっていないか（地図・一覧の「受け取りたい日」の絞り込み用） */
export function availableOn(c: Scheduled, date: string, nowMs: number): boolean {
  const o = occurrenceOn(c, date)
  return o !== null && o.endMs > nowMs
}

const withWindow = (c: ListingCandidate, w: { startMs: number; endMs: number }): ListingCandidate => ({ ...c, pickupStartMs: w.startMs, pickupEndMs: w.endMs })

const STATUS_RANK: Record<string, number> = { MATCHED: 0, OVER_BUDGET: 1, SHORTAGE: 2 }

/** a の結果のほうが b より良いか（条件達成 → 集められる量 → 生産者数 → 金額 の順。同じなら早い日） */
function better(a: AllocationResult, b: AllocationResult): boolean {
  if (!a.best) return false
  if (!b.best) return true
  const ra = STATUS_RANK[a.best.status]
  const rb = STATUS_RANK[b.best.status]
  if (ra !== rb) return ra < rb
  if (a.best.plan.totalMilli !== b.best.plan.totalMilli) return a.best.plan.totalMilli > b.best.plan.totalMilli
  if (a.best.plan.producerCount !== b.best.plan.producerCount) return a.best.plan.producerCount < b.best.plan.producerCount
  return a.best.plan.totalYen < b.best.plan.totalYen
}

/**
 * 期間の出品を含めて仕入れ案を計算する。
 * - 期間の出品がなければ、従来の allocate と同じ。
 * - 日時の指定（EXACT）：期間の出品を、その日の受渡時間帯に置き換えて1回計算する。
 * - 期限（DEADLINE）：今日から希望日までの1日ずつについて、その日に受け取れる回を候補にして計算し、最も良い日の案を選ぶ。
 *   同じ出品の別の日の回を1つの案で重ねて数えることはない。
 */
export function allocateScheduled(
  candidates: ListingCandidate[],
  demand: DemandSpec,
  nowMs: number,
  limits: SearchLimits = DEFAULT_LIMITS,
): AllocationResult {
  if (!candidates.some((c) => c.schedule)) return allocate(candidates, demand, nowMs, limits)

  const singles = candidates.filter((c) => !c.schedule)
  const scheduled = candidates.filter((c) => c.schedule)
  // 受け取れる回がない出品は、次の回（なければ期間そのもの）のまま渡し、「日時が合わない」として扱わせる
  const fallback = () => [...singles, ...scheduled.map((c) => withWindow(c, nextOccurrence(c, nowMs) ?? { startMs: c.pickupStartMs, endMs: c.pickupEndMs }))]

  if (demand.timeMode === 'EXACT') {
    const date = jstDateString(demand.targetMs)
    const list = [...singles, ...scheduled.map((c) => { const o = occurrenceOn(c, date); return o ? withWindow(c, o) : withWindow(c, nextOccurrence(c, nowMs) ?? { startMs: c.pickupStartMs, endMs: c.pickupEndMs }) })]
    return allocate(list, demand, nowMs, limits)
  }

  const today = jstDateString(nowMs)
  const lastDate = jstDateString(demand.targetMs - 1)
  let best: AllocationResult | null = null
  let date = today
  for (let i = 0; i < MAX_SCHEDULE_DAYS && date <= lastDate; i++, date = addDaysJst(date, 1)) {
    const onDay = scheduled.flatMap((c) => {
      const o = occurrenceOn(c, date)
      return o && o.endMs > nowMs ? [withWindow(c, o)] : []
    })
    if (onDay.length === 0 && best) continue
    const r = allocate([...singles, ...onDay], demand, nowMs, limits)
    if (!best || better(r, best)) best = r
  }
  const all = allocate(fallback(), demand, nowMs, limits)
  if (!best || !best.best) return all
  // 在庫の変化の比較に使う一覧と、除外の理由は、すべての出品を対象にしたものを使う
  return { ...best, snapshot: all.snapshot, exclusions: best.exclusions.length > 0 ? best.exclusions : all.exclusions }
}

/** 例：10月1日(水)〜12月31日(水)の毎日 10:00〜11:00 */
export function formatPeriod(startMs: number, endMs: number, s: PickupSchedule): string {
  const days = weekdayLabel(s.weekdays)
  // 「月・水・金」のような並びには「曜」を付ける（「毎日」「平日（月〜金）」「土日」はそのまま）
  const label = /^[日月火水木金土](・[日月火水木金土])*$/.test(days) ? `${days}曜` : days
  return `${formatJstDate(startMs)}〜${formatJstDate(endMs - 1)}の${label} ${minToTime(s.startMin)}〜${minToTime(s.endMin)}`
}

/** 生産者の出品の受渡日時（1日だけの出品は日時、期間の出品は期間と曜日・時間帯） */
export function formatPickup(l: { pickupStartMs: number; pickupEndMs: number; schedule?: PickupSchedule | null }): string {
  return l.schedule ? formatPeriod(l.pickupStartMs, l.pickupEndMs, l.schedule) : formatWindow(l.pickupStartMs, l.pickupEndMs)
}

/** 飲食店向け：次に受け取れる回と、期間の出品なら期間（例：10月18日(土) 10:00〜11:00（期間：…）） */
export function formatMarketPickup(l: { pickupStartMs: number; pickupEndMs: number; period: { startMs: number; endMs: number; schedule: PickupSchedule } | null }): string {
  const next = formatWindow(l.pickupStartMs, l.pickupEndMs)
  return l.period ? `${next}（受渡期間：${formatPeriod(l.period.startMs, l.period.endMs, l.period.schedule)}）` : next
}
