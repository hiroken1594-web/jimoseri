// API の入力検証（サーバー側で必ず通す。画面側の検証は補助）。
import { z } from 'zod'
import { normalizePhone } from './phone.js'
import { isValidUsername, MAX_TEXT_LENGTH, USERNAME_MAX, USERNAME_MIN } from './limits.js'

export const unitSchema = z.enum(['KG', 'PIECE', 'BUNCH', 'BAG'])
export const gradeSchema = z.enum(['REGULAR', 'IRREGULAR'])
export const irregularReasonSchema = z.enum(['SHAPE', 'SIZE', 'SURPLUS', 'OTHER'])
export const timeModeSchema = z.enum(['DEADLINE', 'EXACT'])

const id = z.string().min(1).max(40)

/** 日本国内の電話番号（携帯・固定）。数字だけにそろえた値になる */
export const phoneField = z
  .string({ error: '電話番号を入力してください' })
  .trim()
  .min(1, '電話番号を入力してください')
  .max(20, '電話番号が長すぎます')
  .refine((v) => normalizePhone(v) !== null, '電話番号の形式を確認してください（例：090-1234-5678、06-1234-5678）')
  .transform((v) => normalizePhone(v)!)
export const phoneShareSchema = z.enum(['NONE', 'MATCHED', 'ANYTIME'])
const twoDecimals = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6
const quantity = z
  .number({ error: '数量を数字で入力してください' })
  .positive('数量は0より大きい値にしてください')
  .max(100_000, '数量が大きすぎます')
  .refine(twoDecimals, '数量は小数第2位までで入力してください')
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付を選択してください')
const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時刻を選択してください')

const shortText = (label: string, max: number) =>
  z.string().trim().min(1, `${label}を入力してください`).max(max, `${label}は${max}文字以内で入力してください`)
const optionalText = (label: string, max: number) =>
  z.string().trim().max(max, `${label}は${max}文字以内で入力してください`).nullable()

const usernameField = z
  .string()
  .trim()
  .toLowerCase()
  .refine(isValidUsername, `ユーザー名は半角の英小文字・数字・_ で${USERNAME_MIN}〜${USERNAME_MAX}文字、英字で始めてください`)
const passwordField = z.string().min(10, 'パスワードは10文字以上で入力してください').max(128, 'パスワードは128文字以内で入力してください')

// パスワードを忘れたとき：ユーザー名＋リカバリーコードで再設定する
export const recoveryResetSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'ユーザー名を入力してください').max(40),
  recoveryCode: z.string().trim().min(1, 'リカバリーコードを入力してください').max(60),
  newPassword: passwordField,
})

// ユーザー名の変更（本人のみ。現在のパスワードで確認する）
export const usernameChangeSchema = z.object({
  username: usernameField,
  password: z.string().min(1, '現在のパスワードを入力してください').max(128),
})

export const recoveryReissueSchema = z.object({
  password: z.string().min(1, '現在のパスワードを入力してください').max(128),
})

const optionalAddressPart = (label: string, max: number) =>
  z.string().trim().max(max, `${label}は${max}文字以内で入力してください`).nullable().optional()

/** 住所の入力欄（郵便番号から自動入力し、手で直せる）。すべて任意。 */
export const addressSchema = z.object({
  postalCode: z
    .string()
    .trim()
    .regex(/^(\d{3}-?\d{4})?$/, '郵便番号は7桁の数字で入力してください')
    .nullable()
    .optional(),
  prefecture: optionalAddressPart('都道府県', 10),
  city: optionalAddressPart('市区町村', 30),
  town: optionalAddressPart('町域', 60),
  addressLine: optionalAddressPart('番地・建物名', 100),
})
export type AddressInput = z.infer<typeof addressSchema>

// 新規登録。郵便番号は必須（都道府県・市区町村・町域は自動入力の後も直せる。番地・建物名は任意）。
// 住所は本人と運営者だけが見る。生産者の住所（自宅など）は公開しない。受渡場所は別に登録する。
export const signupSchema = z.object({
  username: usernameField,
  password: passwordField,
  role: z.enum(['RESTAURANT', 'PRODUCER'], { error: '利用者の種類（生産者・飲食店）を選択してください' }),
  orgName: shortText('店舗名・屋号', 40),
  // 地域（市区町村）。省略した場合は住所の市区町村を使う
  area: shortText('地域', 40).optional(),
  ...addressSchema.shape,
  postalCode: z
    .string({ error: '郵便番号を入力してください' })
    .trim()
    .regex(/^\d{3}-?\d{4}$/, '郵便番号は7桁の数字で入力してください'),
  // 電話番号（必須・他の利用者には原則として非公開）と、取引相手に見せる範囲（初期値は見せない）
  phone: phoneField,
  phoneShare: phoneShareSchema.optional(),
  inviteCode: z.string().trim().max(100).optional(),
  // 人には見えない入力欄（自動登録の検出用）
  website: z.string().max(200).optional(),
})


// プロフィールの変更。役割やユーザー名はここでは変更できない。
export const profileSchema = z
  .object({
    ...addressSchema.shape,
    orgName: shortText('店舗名・農園名', 40),
    area: shortText('地域', 40),
    // 飲食店のみ。お店の位置（地図で探すときの中心の初期値）。本人が地図で確かめて保存する。null で削除。
    storePosition: z
      .object({ lat: z.number().min(20).max(46), lng: z.number().min(122).max(154) }, { error: '地図で位置を指定してください' })
      .nullable()
      .optional(),
    // 電話番号（変更できる。空にはできない）と、取引相手に見せる範囲
    phone: phoneField.optional(),
    phoneShare: phoneShareSchema.optional(),
    // 飲食店のみ：生産者からの取引提案を受け取るか
    acceptProposals: z.boolean().optional(),
    // 以下は生産者のみ。公開用の連絡先（任意）
    publicPhone: optionalText('電話番号', 20).optional(),
    showPhone: z.boolean().optional(),
    publicEmail: optionalText('メールアドレス', 100).optional(),
    showEmail: z.boolean().optional(),
    contactNote: optionalText('連絡時の注意書き', 100).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.publicPhone && !/^[0-9+\-() ]{6,20}$/.test(v.publicPhone)) {
      ctx.addIssue({ code: 'custom', path: ['publicPhone'], message: '電話番号は数字とハイフンで入力してください' })
    }
    if (v.publicEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.publicEmail)) {
      ctx.addIssue({ code: 'custom', path: ['publicEmail'], message: 'メールアドレスの形式を確認してください' })
    }
    if (v.showPhone && !v.publicPhone) {
      ctx.addIssue({ code: 'custom', path: ['publicPhone'], message: '公開する電話番号を入力してください' })
    }
    if (v.showEmail && !v.publicEmail) {
      ctx.addIssue({ code: 'custom', path: ['publicEmail'], message: '公開するメールアドレスを入力してください' })
    }
  })

const latitude = z.number({ error: '地図で位置を指定してください' }).min(20).max(46)
const longitude = z.number({ error: '地図で位置を指定してください' }).min(122).max(154)

// 受渡拠点。地図に出すのは showOnMap が true で、位置があり、運営者が確認したものだけ。
export const locationCreateSchema = z
  .object({
    name: shortText('受渡場所の名称', 40),
    municipality: shortText('市区町村', 20),
    address: shortText('住所・目印', 100),
    note: z.string().trim().max(100, '補足は100文字以内で入力してください'),
    postalCode: z.string().trim().regex(/^(\d{3}-?\d{4})?$/, '郵便番号は7桁の数字で入力してください').nullable().optional(),
    // 都道府県（必須）。飲食店の受取エリア（都道府県）での検索に使う。
    prefecture: z.string({ error: '都道府県を選択してください' }).trim().min(1, '都道府県を選択してください').max(10),
    town: z.string().trim().max(60).nullable().optional(),
    latitude: latitude.nullable().optional(),
    longitude: longitude.nullable().optional(),
    showOnMap: z.boolean().optional(),
    hours: z.string().trim().max(60, '受取できる日時の目安は60文字以内で入力してください').optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.latitude == null) !== (v.longitude == null)) {
      ctx.addIssue({ code: 'custom', path: ['latitude'], message: '地図で位置を指定してください' })
    }
    if (v.showOnMap && (v.latitude == null || v.longitude == null)) {
      ctx.addIssue({ code: 'custom', path: ['showOnMap'], message: '地図に表示するには、地図で位置を指定してください' })
    }
  })

// 地図・一覧での検索（飲食店）。検索の中心は送るだけで、サーバーには保存しない。
export const marketSearchSchema = z.object({
  // 受取エリア（必須）：都道府県。市区町村は任意。
  prefecture: z.string({ error: '受取エリアを選択してください' }).trim().min(1, '受取エリアを選択してください').max(10),
  // 受け取りたい日（任意）。指定しない場合は、日付だけを理由に除外しない（これから受け取れる回がある出品はすべて対象）。
  date: dateString.nullable().optional(),
  center: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable(),
  radiusKm: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10), z.literal(20), z.literal(50), z.null()]),
  itemId: z.string().max(40).nullable().optional(),
  maxPriceYen: z.number().int().min(1).max(1_000_000).nullable().optional(),
  minQuantity: z.number().positive().max(100_000).nullable().optional(),
  irregular: z.enum(['any', 'exclude', 'only']).optional(),
  municipality: z.string().trim().max(20).nullable().optional(),
  // デモモード（お試し）：true のときはデモデータだけを検索する。通常は実際のデータだけ。
  demo: z.boolean().optional(),
})
export type MarketSearchInput = z.infer<typeof marketSearchSchema>

export const adminActionSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('producer'), id, action: z.enum(['approve', 'suspend']) }),
  // delete は、出品に使われていない受渡場所だけ
  z.object({ target: z.literal('location'), id, action: z.enum(['approve', 'suspend', 'delete']) }),
  z.object({ target: z.literal('listing'), id, action: z.enum(['approve', 'suspend']) }),
  // パスワードもリカバリーコードも失くした利用者に、本人確認のうえで新しいコードを発行する
  z.object({ target: z.literal('recovery'), username: z.string().trim().toLowerCase().min(1, 'ユーザー名を入力してください').max(40) }),
])

export const listingCreateSchema = z
  .object({
    itemId: id,
    variety: z.string().trim().max(30, '品種は30文字以内で入力してください').nullable(),
    grade: gradeSchema,
    irregularReason: irregularReasonSchema.nullable(),
    quantity,
    unit: unitSchema,
    unitPriceYen: z
      .number({ error: '単価を数字で入力してください' })
      .int('単価は1円単位で入力してください')
      .min(1, '単価は1円以上にしてください')
      .max(1_000_000, '単価が大きすぎます'),
    minQuantity: quantity,
    stepQuantity: quantity,
    pickupLocationId: id,
    // 受け渡し：1日だけ（DAY）か、期間（PERIOD：開始日〜終了日の、選んだ曜日の同じ時間帯）
    pickupMode: z.enum(['DAY', 'PERIOD']).optional(),
    // DAY：受渡日／PERIOD：受渡開始日
    pickupDate: dateString,
    // PERIOD のみ：受渡終了日と曜日（日曜=1 … 土曜=64 の合計）
    pickupEndDate: dateString.nullable().optional(),
    weekdays: z.number().int().min(0).max(127).nullable().optional(),
    startTime: timeString,
    endTime: timeString,
  })
  .superRefine((v, ctx) => {
    if (v.grade === 'IRREGULAR' && !v.irregularReason) {
      ctx.addIssue({ code: 'custom', path: ['irregularReason'], message: '規格外の理由を選択してください' })
    }
    if (v.minQuantity > v.quantity) {
      ctx.addIssue({ code: 'custom', path: ['minQuantity'], message: '最低販売量は販売可能量以下にしてください' })
    }
    if (v.endTime <= v.startTime) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: '終了時刻は開始時刻より後にしてください' })
    }
    if (v.pickupMode === 'PERIOD') {
      if (!v.pickupEndDate) ctx.addIssue({ code: 'custom', path: ['pickupEndDate'], message: '受渡終了日を選択してください' })
      else if (v.pickupEndDate < v.pickupDate) ctx.addIssue({ code: 'custom', path: ['pickupEndDate'], message: '受渡終了日は開始日以降にしてください' })
      if (!v.weekdays) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: '受け渡しできる曜日を1つ以上選択してください' })
    }
  })

export const listingPatchSchema = z
  .object({
    quantity: z
      .number({ error: '数量を数字で入力してください' })
      .min(0, '数量は0以上にしてください')
      .max(100_000, '数量が大きすぎます')
      .refine(twoDecimals, '数量は小数第2位までで入力してください')
      .optional(),
    isPublished: z.boolean().optional(),
  })
  .refine((v) => v.quantity !== undefined || v.isPublished !== undefined, '変更内容がありません')

export const demandSchema = z
  .object({
    itemId: z.string().min(1, '品目を選択してください').max(40),
    quantity,
    unit: unitSchema,
    timeMode: timeModeSchema,
    date: dateString,
    time: timeString.nullable(),
    // 受取エリア（必須）：都道府県。市区町村は null なら都道府県全体。
    prefecture: z.string({ error: '受取エリアを選択してください' }).trim().min(1, '受取エリアを選択してください').max(10),
    municipality: z.string().trim().min(1).max(20).nullable(),
    // 検索地点と半径（任意）。両方あるときだけ、半径の内側の受渡場所に絞る。
    center: z.object({ lat: z.number().min(20).max(46), lng: z.number().min(122).max(154) }).nullable().optional(),
    radiusKm: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10), z.literal(20), z.literal(50), z.null()]).optional(),
    budgetMaxYen: z
      .number({ error: '予算を数字で入力してください' })
      .int('予算は1円単位で入力してください')
      .min(1, '予算は1円以上にしてください')
      .max(10_000_000, '予算が大きすぎます')
      .nullable(),
    allowIrregular: z.boolean(),
    // 複数の場所での受け取りを許可するか（初期値オフ）
    allowMultiLocation: z.boolean(),
    // デモモード（お試し）：デモデータだけで仕入れ案を作る
    demoMode: z.boolean().optional(),
    rawText: z.string().max(MAX_TEXT_LENGTH).nullable(),
    // 再計算のときは希望条件を重複して保存しない
    save: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.timeMode === 'EXACT' && !v.time) {
      ctx.addIssue({ code: 'custom', path: ['time'], message: '受け取りたい時刻を選択してください' })
    }
  })

export const planCheckSchema = z.object({
  itemId: id,
  fingerprint: z.string().min(1).max(100),
  demoMode: z.boolean().optional(),
})

export const extractSchema = z.object({
  text: z.string().max(MAX_TEXT_LENGTH, `${MAX_TEXT_LENGTH}文字以内で入力してください`),
})

// AI（OpenAI API）の応答を検証する形。書かれていない項目は null（推測で補わない）。
export const aiExtractionSchema = z.object({
  outOfScope: z.enum(['NONE', 'PERSONAL', 'MULTI_ITEM', 'NATIONWIDE', 'UNREADABLE']),
  itemName: z.string().max(40).nullable(),
  quantity: z.number().positive().max(100_000).nullable(),
  unit: unitSchema.nullable(),
  timeMode: timeModeSchema.nullable(),
  date: z.string().nullable(),
  time: z.string().nullable(),
  regionText: z.string().max(60).nullable(),
  budgetTotalYen: z.number().positive().max(10_000_000).nullable(),
  unitPriceCapYen: z.number().positive().max(1_000_000).nullable(),
  allowIrregular: z.boolean().nullable(),
})

export type SignupInput = z.infer<typeof signupSchema>
export type ProfileInput = z.infer<typeof profileSchema>
export type LocationCreateInput = z.infer<typeof locationCreateSchema>
export type AdminActionInput = z.infer<typeof adminActionSchema>
export type ListingCreateInput = z.infer<typeof listingCreateSchema>
export type ListingPatchInput = z.infer<typeof listingPatchSchema>
export type DemandInput = z.infer<typeof demandSchema>
export type AiExtraction = z.infer<typeof aiExtractionSchema>

// ---- 位置情報・住所 ----

export const geoRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('zip'), zip: z.string().max(20) }),
  // 地名検索は、入力の確定時にだけ呼ぶ（自動補完には使わない）
  z.object({ op: z.literal('search'), q: z.string().trim().min(2, '地名を2文字以上で入力してください').max(60, '地名は60文字以内で入力してください') }),
])


// ---- 気になる（お気に入り）・通報 ----

export const favoriteSchema = z.object({ listingId: z.string().min(1).max(40) })

export const REPORT_REASONS = ['FALSE_INFO', 'INAPPROPRIATE', 'NUISANCE', 'FRAUD', 'OTHER'] as const
export const reportCreateSchema = z
  .object({
    targetType: z.enum(['LISTING', 'PRODUCER', 'RESTAURANT', 'REVIEW']),
    targetId: z.string().min(1).max(40),
    reason: z.enum(REPORT_REASONS, { error: '通報の理由を選んでください' }),
    detail: z.string().trim().max(500, '詳細は500文字以内で入力してください').optional(),
  })
  .superRefine((v, ctx) => {
    if (v.reason === 'OTHER' && !v.detail) {
      ctx.addIssue({ code: 'custom', path: ['detail'], message: '「その他」を選んだ場合は、詳細を入力してください' })
    }
  })

export const reportUpdateSchema = z.object({
  id: z.string().min(1).max(40),
  status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED']).optional(),
  note: z.string().trim().max(500, 'メモは500文字以内で入力してください').optional(),
  // 対象（出品・生産者・利用者）を停止する／停止を解除する
  targetAction: z.enum(['suspend', 'restore']).optional(),
})
export type ReportCreateInput = z.infer<typeof reportCreateSchema>
export type ReportUpdateInput = z.infer<typeof reportUpdateSchema>

// ---- マッチング（飲食店 → 生産者への依頼）・チャット ----

const deliveryMethodSchema = z.enum(['PICKUP', 'DELIVERY', 'DISCUSS'])
const shippingPayerSchema = z.enum(['UNDECIDED', 'RESTAURANT', 'PRODUCER'])
const yen = (label: string) =>
  z.number({ error: `${label}を数字で入力してください` }).int(`${label}は1円単位で入力してください`).min(0, `${label}は0円以上にしてください`).max(10_000_000, `${label}が大きすぎます`)
/** 受渡方法と送料（送料が null のときは「未確定」） */
const deliveryShape = {
  deliveryMethod: deliveryMethodSchema.optional(),
  deliveryPlace: z.string().trim().max(100, '受渡場所は100文字以内で入力してください').optional(),
  shippingFeeYen: yen('送料').nullable().optional(),
  shippingPayer: shippingPayerSchema.optional(),
}

/** 飲食店が生産者に依頼を送る。1回に最大3件（仕入れ案の農家ごと、または出品の詳細から1件） */
export const matchCreateSchema = z.object({
  lines: z
    .array(
      z.object({
        listingId: id,
        quantity: z.number({ error: '数量を数字で入力してください' }).positive('数量は0より大きくしてください').max(100_000, '数量が大きすぎます'),
        // 受け取りたい回（期間の出品では、その日の時間帯）。省略すると次に受け取れる回
        pickupStartMs: z.number().int().optional(),
        pickupEndMs: z.number().int().optional(),
      }),
    )
    .min(1, '依頼する生産者を選んでください')
    .max(3, '一度に依頼できるのは3件までです'),
  message: z.string().trim().max(500, 'ひとことは500文字以内で入力してください').optional(),
  demoMode: z.boolean().optional(),
  ...deliveryShape,
})

/** 生産者から飲食店への取引提案（提案の受け取りを許可している飲食店にだけ） */
export const producerProposalSchema = z.object({
  restaurantId: id,
  listingId: id,
  quantity: z.number({ error: '数量を数字で入力してください' }).positive('数量は0より大きくしてください').max(100_000, '数量が大きすぎます'),
  pickupStartMs: z.number().int().optional(),
  pickupEndMs: z.number().int().optional(),
  message: z.string().trim().max(500, 'ひとことは500文字以内で入力してください').optional(),
  ...deliveryShape,
})

/** 依頼への返事：生産者は承認・辞退、飲食店は取り下げ */
export const matchRespondSchema = z.object({
  // accept・decline：提案を受けた側／cancel：提案した側／agree：いまの条件に合意／complete：取引完了を確認／block：生産者からの提案を受け取らない（飲食店）
  action: z.enum(['accept', 'decline', 'cancel', 'agree', 'complete', 'block']),
  reason: z.string().trim().max(200, '理由は200文字以内で入力してください').optional(),
})

export const chatSendSchema = z.object({
  matchId: id,
  body: z.string().trim().min(1, 'メッセージを入力してください').max(1000, 'メッセージは1000文字以内で入力してください'),
  // 再送しても二重に保存しないための番号（画面側で作る）
  clientId: z.string().min(8).max(64),
})

export type MatchCreateInput = z.infer<typeof matchCreateSchema>

/** 取引条件の変更提案（マッチング成立後、どちらからでも） */
export const termsProposalSchema = z.object({
  matchId: id,
  quantity: z.number({ error: '数量を数字で入力してください' }).positive('数量は0より大きくしてください').max(100_000, '数量が大きすぎます'),
  unitPriceYen: yen('単価').min(1, '単価は1円以上にしてください'),
  deliveryMethod: deliveryMethodSchema,
  deliveryPlace: z.string().trim().max(100, '受渡場所は100文字以内で入力してください'),
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  shippingFeeYen: yen('送料').nullable(),
  shippingPayer: shippingPayerSchema,
  note: z.string().trim().max(500, '備考は500文字以内で入力してください').optional(),
}).superRefine((v, ctx) => {
  if (v.endTime <= v.startTime) ctx.addIssue({ code: 'custom', path: ['endTime'], message: '終了時刻は開始時刻より後にしてください' })
})

export const proposalRespondSchema = z.object({ action: z.enum(['accept', 'reject']) })

const score = (label: string) => z.number({ error: `${label}を選んでください` }).int().min(1, `${label}を選んでください`).max(5)
/** 取引完了後の相互レビュー */
export const reviewSchema = z.object({
  matchId: id,
  rating: score('総合評価'),
  satisfaction: score('取引の満足度'),
  politeness: score('対応の丁寧さ'),
  smoothness: score('受渡のスムーズさ'),
  comment: z.string().trim().max(500, 'コメントは500文字以内で入力してください').optional(),
})

/** 通知を既読にする（ids を指定、または all で全部） */
export const notificationReadSchema = z.object({ ids: z.array(id).max(200).optional(), all: z.boolean().optional() })

export type TermsProposalInput = z.infer<typeof termsProposalSchema>
export type ProducerProposalInput = z.infer<typeof producerProposalSchema>
