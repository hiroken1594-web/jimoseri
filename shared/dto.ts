// API とブラウザの間でやり取りするデータの形。
import type { AllocationResult, Grade, IrregularReason, TimeMode, Unit } from './allocate.js'
import type { Relaxation } from './relax.js'
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
  /** 本人の住所（本人にだけ返す。他の利用者には公開しない） */
  address: AddressDto
}

export interface AddressDto {
  postalCode: string | null
  prefecture: string | null
  city: string | null
  town: string | null
  addressLine: string | null
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
  postalCode: string | null
  prefecture: string | null
  town: string | null
  /** 位置。自分の場所か、地図への公開を許可した場所のときだけ入る */
  latitude: number | null
  longitude: number | null
  showOnMap: boolean
  hours: string
  /** 自分の場所を使っている出品の数（自分の場所のときだけ） */
  listingCount?: number
}

/** 地図・一覧に出す出品（承認済み・公開中・在庫あり・期限内のものだけ） */
export interface MarketListing {
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
  pickupStartMs: number
  pickupEndMs: number
  producerId: string
  producerName: string
  updatedAtMs: number
  isFavorite: boolean
  /** デモデータ（お試し用） */
  isDemo: boolean
}

/** 地図・一覧に出す受渡拠点（地図への公開を許可され、運営者が確認したものだけ） */
export interface MarketLocation {
  id: string
  name: string
  municipality: string
  address: string
  note: string
  hours: string
  latitude: number
  longitude: number
  /** 検索の中心からの直線距離（km）。中心を指定しないときは null */
  distanceKm: number | null
  isDemo: boolean
  listings: MarketListing[]
}

/** 0件のときの理由（条件を1つずつ足したときに何件残るか） */
export interface MarketDiagnostics {
  stages: { label: string; count: number }[]
  /** 通常の検索で0件のとき、デモモードで見られる出品の数 */
  demoAvailable: number
}

export interface MarketSearchResponse {
  locations: MarketLocation[]
  /** 半径の外にあったため除外した拠点の数（「半径を広げる」提案に使う） */
  outsideCount: number
  searchedAtMs: number
  /** デモモードで検索した結果か */
  demo: boolean
  /** 0件のときだけ入る */
  diagnostics: MarketDiagnostics | null
}

/** 出品の詳細（飲食店向け） */
export interface ListingDetail extends MarketListing {
  producerArea: string
  contact: PublicContact | null
  location: { id: string; name: string; municipality: string; address: string; note: string; hours: string; latitude: number | null; longitude: number | null }
}

export interface MasterData {
  items: { id: string; name: string }[]
  /** 生産者：確認済みの場所＋自分が登録した場所。それ以外の利用者には空。 */
  locations: LocationDto[]
  /** 飲食店が受取エリアとして選べる市区町村（確認済みの場所があるもの） */
  municipalities: string[]
  /** デモモード（お試し）で使う受取エリア */
  demoMunicipalities: string[]
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
  /** デモデータだけで計算した案か */
  demoMode: boolean
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
  /** 希望量に届かないとき、条件を広げた場合の参考（元の案とは別） */
  relaxations: Relaxation[]
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
    showOnMap: boolean
    latitude: number | null
    longitude: number | null
    hours: string
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

export interface FavoriteItem {
  listingId: string
  savedAtMs: number
  itemName: string
  producerName: string
  /** 現在も掲載中か（公開停止・期限切れ・在庫0などのときは false） */
  available: boolean
  /** デモデータ（お試し用）の出品か */
  isDemo: boolean
  /** 掲載中のときだけ、最新の情報を入れる */
  listing: MarketListing | null
  locationName: string | null
}

export type ReportTargetType = 'LISTING' | 'PRODUCER' | 'RESTAURANT'
export type ReportReason = 'FALSE_INFO' | 'INAPPROPRIATE' | 'NUISANCE' | 'FRAUD' | 'OTHER'
export type ReportStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'REJECTED'

/** 運営者向けの通報の一覧（一般の利用者には返さない） */
export interface ReportItem {
  id: string
  targetType: ReportTargetType
  targetId: string
  targetLabel: string
  /** 対象のいまの状態（停止中か、削除済みか） */
  targetState: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
  reason: ReportReason
  detail: string
  status: ReportStatus
  reporterName: string
  createdAtMs: number
  updatedAtMs: number
  actions: { actorName: string; action: string; note: string; createdAtMs: number }[]
}
