// 希望量に届かないときの「条件を広げた場合の参考」。
// 元の条件で作った仕入れ案とは別に計算し、利用者が選んだときだけ条件を変えて計算し直す（勝手に条件を変えない）。
import { allocate, type AllocationResult, type DemandSpec, type ListingCandidate } from './allocate.js'
import { formatQtyUnit } from './labels.js'
import { addDaysJst, endOfJstDayMs, formatJstDate, jstToMs } from './time.js'

export type RelaxationKind = 'DATE' | 'EXACT_TIME' | 'AREA' | 'IRREGULAR' | 'MULTI'

export interface Relaxation {
  kind: RelaxationKind
  /** 例：「希望日を10月18日まで延ばす」 */
  label: string
  /** 例：「最大10kgまで集められる可能性があります」 */
  detail: string
  /** 条件を広げた場合に集められる量 */
  achievableMilli: number
  /** 希望量に届くか */
  reachesTarget: boolean
  /** 画面で「この条件で計算し直す」を選んだときに変える項目 */
  patch: { date?: string; timeMode?: 'DEADLINE'; time?: null; municipality?: null; allowIrregular?: true; allowMultiLocation?: true }
}

/** 1か所の案と複数か所の参考案のうち、集められる量の多いほう */
function bestQty(r: AllocationResult): number {
  return Math.max(r.best?.plan.totalMilli ?? 0, r.multi?.totalMilli ?? 0)
}

function singleQty(r: AllocationResult): number {
  return r.best?.plan.totalMilli ?? 0
}

export function suggestRelaxations(
  candidates: ListingCandidate[],
  spec: DemandSpec,
  base: AllocationResult,
  nowMs: number,
  ctx: { date: string },
): Relaxation[] {
  if (base.status === 'MATCHED') return []
  const baseQty = singleQty(base)
  const target = spec.quantityMilli
  const out: Relaxation[] = []
  const describe = (qty: number) =>
    qty >= target ? `希望量の${formatQtyUnit(target, spec.unit)}を集められる可能性があります。` : `最大${formatQtyUnit(qty, spec.unit)}まで集められる可能性があります（いまは${formatQtyUnit(baseQty, spec.unit)}）。`
  const push = (r: AllocationResult, kind: RelaxationKind, label: string, patch: Relaxation['patch'], qtyOf: (r: AllocationResult) => number = singleQty) => {
    const qty = qtyOf(r)
    if (qty > baseQty) out.push({ kind, label, detail: describe(qty), achievableMilli: qty, reachesTarget: qty >= target, patch })
  }

  // 受取日：期限を1〜3日延ばす（日時を固定している場合は、その日のうちならよいことにする）
  if (spec.timeMode === 'DEADLINE') {
    for (const days of [1, 2, 3]) {
      const date = addDaysJst(ctx.date, days)
      const r = allocate(candidates, { ...spec, targetMs: endOfJstDayMs(date), allowMultiLocation: false }, nowMs)
      if (singleQty(r) > baseQty) {
        push(r, 'DATE', `希望日を${formatJstDate(jstToMs(date))}まで延ばす`, { date })
        break
      }
    }
  } else {
    const r = allocate(candidates, { ...spec, timeMode: 'DEADLINE', targetMs: endOfJstDayMs(ctx.date), allowMultiLocation: false }, nowMs)
    push(r, 'EXACT_TIME', `時刻を指定せず、${formatJstDate(jstToMs(ctx.date))}のうちに受け取る`, { timeMode: 'DEADLINE', time: null })
  }

  // 受取エリア：指定をやめて、他のエリアの受渡場所も対象にする
  if (spec.area) {
    push(allocate(candidates, { ...spec, area: null, allowMultiLocation: false }, nowMs), 'AREA', '受取エリアを指定しない（他のエリアの受渡場所も探す）', { municipality: null })
  }

  // 規格外品も含める
  if (!spec.allowIrregular) {
    push(allocate(candidates, { ...spec, allowIrregular: true, allowMultiLocation: false }, nowMs), 'IRREGULAR', '規格外品（形の不揃いなど）も含める', { allowIrregular: true })
  }

  // 複数の場所で受け取る（受取の調整が必要な参考案。日時を固定している場合は作らない）
  if (!spec.allowMultiLocation && spec.timeMode === 'DEADLINE') {
    const r = allocate(candidates, { ...spec, allowMultiLocation: true }, nowMs)
    if (r.multi) push(r, 'MULTI', '複数の場所での受け取りを許可する（受取の調整が必要）', { allowMultiLocation: true }, bestQty)
  }

  // 希望量に届くものを先に、集められる量の多い順に
  return out.sort((a, b) => Number(b.reachesTarget) - Number(a.reachesTarget) || b.achievableMilli - a.achievableMilli)
}
