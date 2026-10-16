import type { TimeMode, Unit } from '../../shared/allocate.js'
import type { ExtractedFields } from '../../shared/dto.js'
import type { LatLng } from '../../shared/geo.js'
import type { DemandInput } from '../../shared/schemas.js'
import { jstDateString } from '../../shared/time.js'

/** 全角数字や「，」を半角に直して数値にする。数値でなければ null。 */
export function parseNumber(input: string): number | null {
  const normalized = input
    .trim()
    .replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[,，]/g, '')
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null
  return Number(normalized)
}

/** 仕入れ条件フォームの入力値（入力途中の文字列のまま持つ） */
export interface DemandForm {
  itemId: string
  quantity: string
  unit: Unit
  timeMode: TimeMode
  date: string
  time: string
  /** 受取エリア（必須）：都道府県 */
  prefecture: string
  /** 受取エリア（市区町村）。'' は「指定なし（都道府県全体）」 */
  municipality: string
  /** 検索地点（任意）と半径。半径 null は距離で絞り込まない */
  center: LatLng | null
  centerLabel: string
  radiusKm: number | null
  budget: string
  /** null は未選択。AI が読み取れなかった場合も推測せず未選択のままにする。 */
  allowIrregular: boolean | null
  /** 複数の場所での受け取りを許可するか。初期値はオフ。 */
  allowMultiLocation: boolean
}

export const emptyDemandForm = (): DemandForm => ({
  itemId: '',
  quantity: '',
  unit: 'KG',
  timeMode: 'DEADLINE',
  date: '',
  time: '',
  prefecture: '',
  municipality: '',
  center: null,
  centerLabel: '',
  radiusKm: null,
  budget: '',
  allowIrregular: null,
  allowMultiLocation: false,
})

export function formFromExtraction(fields: ExtractedFields): DemandForm {
  return {
    ...emptyDemandForm(),
    itemId: fields.itemId ?? '',
    quantity: fields.quantity === null ? '' : String(fields.quantity),
    unit: fields.unit ?? 'KG',
    timeMode: fields.timeMode ?? 'DEADLINE',
    date: fields.date ?? '',
    time: fields.time ?? '',
    budget: fields.budgetMaxYen === null ? '' : String(fields.budgetMaxYen),
    allowIrregular: fields.allowIrregular,
  }
}

/** 履歴に保存した条件から、フォームの入力値を作る */
export function formFromInput(input: DemandInput): DemandForm {
  return {
    itemId: input.itemId,
    quantity: String(input.quantity),
    unit: input.unit,
    timeMode: input.timeMode,
    date: input.date,
    time: input.time ?? '',
    prefecture: input.prefecture ?? '',
    municipality: input.municipality ?? '',
    center: input.center ?? null,
    centerLabel: input.center ? '前回の検索地点' : '',
    radiusKm: input.radiusKm ?? null,
    budget: input.budgetMaxYen === null ? '' : String(input.budgetMaxYen),
    allowIrregular: input.allowIrregular,
    allowMultiLocation: input.allowMultiLocation,
  }
}

export type FormErrors = Partial<Record<keyof DemandForm, string>>

export function validateDemandForm(
  form: DemandForm,
  rawText: string | null,
): { ok: true; payload: DemandInput } | { ok: false; errors: FormErrors } {
  const errors: FormErrors = {}
  if (!form.itemId) errors.itemId = '品目を選択してください'
  if (!form.prefecture) errors.prefecture = '受取エリアを選択してください'
  const quantity = parseNumber(form.quantity)
  if (quantity === null || quantity <= 0) errors.quantity = '数量を数字で入力してください'
  if (!form.date) errors.date = '希望日を選択してください'
  else if (form.date < jstDateString(Date.now())) errors.date = '今日以降の日付を選んでください'
  if (form.timeMode === 'EXACT' && !form.time) errors.time = '受け取りたい時刻を選択してください'
  let budget: number | null = null
  if (form.budget.trim()) {
    budget = parseNumber(form.budget)
    if (budget === null || budget < 1 || !Number.isInteger(budget)) errors.budget = '予算は1円単位の数字で入力してください'
  }
  if (form.allowIrregular === null) errors.allowIrregular = 'どちらかを選択してください'
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return {
    ok: true,
    payload: {
      itemId: form.itemId,
      quantity: quantity!,
      unit: form.unit,
      timeMode: form.timeMode,
      date: form.date,
      time: form.timeMode === 'EXACT' ? form.time : null,
      prefecture: form.prefecture,
      municipality: form.municipality || null,
      center: form.center && form.radiusKm !== null ? form.center : null,
      radiusKm: form.center ? (form.radiusKm as DemandInput['radiusKm']) : null,
      budgetMaxYen: budget,
      allowIrregular: form.allowIrregular!,
      // 日時を固定指定した場合は、複数の場所の案は作らない
      allowMultiLocation: form.timeMode === 'DEADLINE' && form.allowMultiLocation,
      rawText: rawText || null,
    },
  }
}

// ---- 下書き（同じ端末のブラウザにだけ保存。ログアウト時に消す） ----

export interface Draft {
  text: string
  form: DemandForm | null
  regionText: string | null
  notes: string[]
  source: 'AI' | 'MANUAL'
}

const DRAFT_KEY = 'jimoseri.draft.v2'
const DEMAND_KEY = 'jimoseri.demand.v2'

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 保存できない環境（プライベートブラウズ等）でも、画面はそのまま使える
  }
}

export const loadDraft = () => read<Draft>(DRAFT_KEY)
export const saveDraft = (draft: Draft | null) => write(DRAFT_KEY, draft)
export const loadConfirmedDemand = () => read<DemandInput>(DEMAND_KEY)
export const saveConfirmedDemand = (demand: DemandInput | null) => write(DEMAND_KEY, demand)

export function clearLocalData(): void {
  saveDraft(null)
  saveConfirmedDemand(null)
}
