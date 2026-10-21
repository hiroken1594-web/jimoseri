// 電話番号（日本国内）。保存するときは数字だけにそろえ、表示するときにハイフンを付ける。

/** 全角数字・ハイフン・空白・括弧・「+81」を受け付けて、数字だけ（0から始まる10〜11桁）にそろえる。形式が違えば null。 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  let digits = input
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[＋]/g, '+')
    .replace(/[\s\-ー－‐−()（）]/g, '')
  if (digits.startsWith('+81')) digits = `0${digits.slice(3)}`
  if (!/^0\d{9,10}$/.test(digits)) return null
  // 11桁は携帯電話（070・080・090）・IP電話（050）・0120 以外は使われない
  if (digits.length === 11 && !/^0[5789]0/.test(digits)) return null
  // 10桁で 0X0 から始まるのは、フリーダイヤルなどを除いて固定電話ではない
  if (digits.length === 10 && /^0[5789]0/.test(digits)) return null
  return digits
}

/** 表示用：携帯は 090-1234-5678、東京・大阪は 03-1234-5678、それ以外は 0721-12-3456 のように区切る（目安） */
export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return ''
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  if (/^0[36]/.test(digits)) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
  if (digits.startsWith('0120')) return `${digits.slice(0, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
}

export const PHONE_SHARE_LABEL = {
  NONE: '取引相手に表示しない',
  MATCHED: 'マッチング成立後の取引相手にだけ表示する',
  ANYTIME: '相談中（承認前）の取引相手にも表示する',
} as const

export type PhoneShare = keyof typeof PHONE_SHARE_LABEL
