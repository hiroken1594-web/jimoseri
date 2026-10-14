// API の入力検証（サーバー側で必ず通す。画面側の検証は補助）。
import { z } from 'zod'
import { isValidUsername, MAX_TEXT_LENGTH, USERNAME_MAX, USERNAME_MIN } from './limits.js'

export const unitSchema = z.enum(['KG', 'PIECE', 'BUNCH', 'BAG'])
export const gradeSchema = z.enum(['REGULAR', 'IRREGULAR'])
export const irregularReasonSchema = z.enum(['SHAPE', 'SIZE', 'SURPLUS', 'OTHER'])
export const timeModeSchema = z.enum(['DEADLINE', 'EXACT'])

const id = z.string().min(1).max(40)
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

export const signupSchema = z.object({
  username: usernameField,
  password: passwordField,
  role: z.enum(['RESTAURANT', 'PRODUCER'], { error: '利用者の種類（生産者・飲食店）を選択してください' }),
  orgName: shortText('店舗名・農園名', 40),
  area: shortText('地域', 40),
  inviteCode: z.string().trim().max(100).optional(),
  // 人には見えない入力欄（自動登録の検出用）
  website: z.string().max(200).optional(),
})

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

// プロフィールの変更。役割やユーザー名はここでは変更できない。
export const profileSchema = z
  .object({
    ...addressSchema.shape,
    orgName: shortText('店舗名・農園名', 40),
    area: shortText('地域', 40),
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

export const locationCreateSchema = z.object({
  name: shortText('受渡場所の名称', 40),
  municipality: shortText('市区町村', 20),
  address: shortText('住所・目印', 100),
  note: z.string().trim().max(100, '補足は100文字以内で入力してください'),
})

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
    pickupDate: dateString,
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
    // 受取エリア（市区町村）。null は指定なし。
    municipality: z.string().trim().min(1).max(20).nullable(),
    budgetMaxYen: z
      .number({ error: '予算を数字で入力してください' })
      .int('予算は1円単位で入力してください')
      .min(1, '予算は1円以上にしてください')
      .max(10_000_000, '予算が大きすぎます')
      .nullable(),
    allowIrregular: z.boolean(),
    // 複数の場所での受け取りを許可するか（初期値オフ）
    allowMultiLocation: z.boolean(),
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

