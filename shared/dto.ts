// API とブラウザの間でやり取りするデータの形。
import type { AllocationResult, Grade, IrregularReason, TimeMode, Unit } from './allocate.js'
import type { DemandInput } from './schemas.js'

export type Role = 'RESTAURANT' | 'PRODUCER' | 'ADMIN'
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'SUSPENDED'
export type SignupMode = 'open' | 'invite' | 'closed'

export interface ProducerProfile {
  approvalStatus: ReviewStatus
  publicPhone: string | null
  showPhone: boolean
  publicEmail: string | null
  showEmail: boolean
  contactNote: string | null
  /** デモデータ（お試し用）の生産者 */
  isDemo: boolean
}

export interface SessionUser {
  id: string
  role: Role
  /** ログイン用のユーザー名（本人と運営者にだけ見える。他の利用者には公開しない） */
  username: string
  /** 店舗名・農園名 */
  orgName: string
  area: string
  suspended: boolean
  producer: ProducerProfile | null
}

export interface LocationDto {
  id: string
  name: string
  municipality: string
  address: string
  note: string
  status: ReviewStatus
  /** 自分が登録した場所か */
  mine: boolean
}

export interface MasterData {
  items: { id: string; name: string }[]
  /** 生産者：確認済みの場所＋自分が登録した場所。それ以外の利用者には空。 */
  locations: LocationDto[]
  /** 飲食店が受取エリアとして選べる市区町村（確認済みの場所があるもの） */
  municipalities: string[]
  aiEnabled: boolean
  signupMode: SignupMode
  operator: { name: string; email: string } | null
  /** 問い合わせ先の電話番号（正式に決まるまでは仮の表示） */
  supportPhone: string
  minPasswordLength: number
}

/** 出品が仕入れ案の対象になっていない理由 */
export type ListingBlocker =
  | 'PRODUCER_PENDING'
  | 'PRODUCER_SUSPENDED'
  | 'LOCATION_PENDING'
  | 'LOCATION_SUSPENDED'
  | 'ADMIN_SUSPENDED'

export interface ListingDto {
  id: string
  itemId: string
  itemName: string
  variety: string | null
  grade: Grade
  irregularReason: IrregularReason | null
  quantityMilli: number
  unit: Unit
  unitPriceYen: number
  minMilli: number
  stepMilli: number
  pickupLocationId: string
  pickupLocationName: string
  pickupStartMs: number
  pickupEndMs: number
  isPublished: boolean
  updatedAtMs: number
  blockers: ListingBlocker[]
  /** デモデータ（お試し用）。飲食店の仕入れ案には使われない */
  isDemo: boolean
}

export interface ConfirmedDemand {
  itemId: string
  itemName: string
  quantityMilli: number
  unit: Unit
  timeMode: TimeMode
  date: string
  time: string | null
  municipality: string | null
  budgetMaxYen: number | null
  allowIrregular: boolean
  allowMultiLocation: boolean
}

/** 本人が公開を許可した連絡先だけを含む */
export interface PublicContact {
  phone?: string
  email?: string
  note?: string
}

export interface PlanResponse {
  computedAtMs: number
  /** 計算に使った在庫の状態を表す照合用の値。在庫が変わると値が変わる。 */
  fingerprint: string
  /** 履歴に保存した場合の ID */
  demandId: string | null
  demand: ConfirmedDemand
  result: AllocationResult
  /** 採用した出品ごとの受渡日時・最終更新日時 */
  listingInfo: Record<string, { pickupStartMs: number; pickupEndMs: number; updatedAtMs: number }>
  /** 案に含まれる受渡場所 */
  locations: Record<string, { name: string; municipality: string; address: string; note: string }>
  /** 案に含まれる生産者の公開用連絡先（producerId ごと） */
  contacts: Record<string, PublicContact>
}

export interface DemandHistoryItem {
  id: string
  createdAtMs: number
  itemName: string
  /** そのまま再計算に使える条件 */
  input: DemandInput
}

export interface ExtractedFields {
  itemId: string | null
  quantity: number | null
  unit: Unit | null
  timeMode: TimeMode | null
  date: string | null
  time: string | null
  regionText: string | null
  budgetMaxYen: number | null
  allowIrregular: boolean | null
}

export type ExtractResponse =
  | { ok: true; fields: ExtractedFields; notes: string[] }
  | { ok: false; reason: 'AI_UNAVAILABLE' | 'UNREADABLE' | 'OUT_OF_SCOPE'; message: string }

export interface AdminOverview {
  producers: {
    id: string
    farmName: string
    area: string
    username: string
    approvalStatus: ReviewStatus
    createdAtMs: number
    listingCount: number
    isDemo: boolean
  }[]
  locations: {
    id: string
    name: string
    municipality: string
    address: string
    note: string
    status: ReviewStatus
    createdByName: string | null
    createdAtMs: number
    isDemo: boolean
  }[]
  listings: {
    id: string
    itemName: string
    farmName: string
    quantityMilli: number
    unit: Unit
    unitPriceYen: number
    pickupLocationName: string
    pickupStartMs: number
    isPublished: boolean
    adminSuspended: boolean
    isDemo: boolean
  }[]
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> }
}
