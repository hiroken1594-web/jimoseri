import { DELIVERY_LABEL, PAYER_LABEL, type DeliveryMethod, type ShippingPayer } from '../../shared/trade.js'
import { parseNumber } from '../lib/forms.js'
import { useSession } from '../session.js'
import { AddressFields, addressErrors, addressFromSaved, addressOneLine, emptyAddress, type AddressValue } from './AddressFields.js'
import { Choice, Field } from './ui.js'

export interface DeliveryValue {
  deliveryMethod: DeliveryMethod
  /** 受け取り：生産者の受渡場所の名前／相談：任意のメモ */
  deliveryPlace: string
  /** 配送のときの配送先（郵便番号から入力。すべて必須） */
  address: AddressValue
  /** 空欄は「未確定」 */
  shippingFee: string
  shippingPayer: ShippingPayer
}

export const deliveryDefaults = (place: string): DeliveryValue => ({ deliveryMethod: 'PICKUP', deliveryPlace: place, address: emptyAddress(), shippingFee: '', shippingPayer: 'UNDECIDED' })

/** API に送る形（送料が空欄なら null ＝ 未確定。配送のときの受渡場所は、配送先の住所を1行にしたもの） */
export function deliveryPayload(v: DeliveryValue) {
  const fee = v.shippingFee.trim() ? parseNumber(v.shippingFee) : null
  return {
    deliveryMethod: v.deliveryMethod,
    deliveryPlace: v.deliveryMethod === 'DELIVERY' ? addressOneLine(v.address) : v.deliveryPlace.trim(),
    shippingFeeYen: fee === null ? null : Math.round(fee),
    shippingPayer: v.shippingPayer,
  }
}

/** 送料の入力が正しいか（空欄は未確定としてよい） */
export const shippingFeeError = (v: DeliveryValue) => (v.shippingFee.trim() && parseNumber(v.shippingFee) === null ? '送料は数字で入力してください（未確定なら空欄）' : undefined)

/** 入力の確認：送料の形式と、配送のときの配送先の住所（すべて必須） */
export function deliveryErrors(v: DeliveryValue): string | null {
  const fee = shippingFeeError(v)
  if (fee) return fee
  if (v.deliveryMethod === 'DELIVERY' && Object.keys(addressErrors(v.address)).length > 0) return '配送先の住所に、入力されていない項目があります（郵便番号・都道府県・市区町村・町域・番地・建物名）。'
  return null
}

/** 受渡方法・受渡場所（配送先の住所）・送料・送料の負担。配送の手配はアプリでは行わない */
export function DeliveryFields({ value, onChange, idPrefix, pickupPlace, showErrors }: { value: DeliveryValue; onChange: (next: DeliveryValue) => void; idPrefix: string; pickupPlace: string; showErrors?: boolean }) {
  const { user } = useSession()
  const set = <K extends keyof DeliveryValue>(key: K, v: DeliveryValue[K]) => onChange({ ...value, [key]: v })
  const errors = showErrors && value.deliveryMethod === 'DELIVERY' ? addressErrors(value.address) : {}
  return (
    <div className="delivery-fields">
      <Field label="受渡方法" required>
        <Choice<DeliveryMethod>
          label="受渡方法"
          value={value.deliveryMethod}
          onChange={(m) => onChange({ ...value, deliveryMethod: m, deliveryPlace: m === 'PICKUP' ? pickupPlace : value.deliveryMethod === 'PICKUP' ? '' : value.deliveryPlace })}
          options={(Object.keys(DELIVERY_LABEL) as DeliveryMethod[]).map((m) => ({ value: m, label: DELIVERY_LABEL[m] }))}
        />
      </Field>
      {value.deliveryMethod === 'PICKUP' && (
        <Field label="受渡場所">
          <p className="input-static">{pickupPlace || '（生産者の受渡場所）'}</p>
        </Field>
      )}
      {value.deliveryMethod === 'DELIVERY' && (
        <fieldset className="fieldset">
          <legend>配送先の住所（取引相手にだけ表示されます）</legend>
          {user?.role === 'RESTAURANT' && user.address.postalCode && (
            <button type="button" className="btn btn-small" onClick={() => set('address', addressFromSaved(user.address))}>
              登録しているお店の住所を使う
            </button>
          )}
          <AddressFields idPrefix={`${idPrefix}-addr`} value={value.address} onChange={(a) => set('address', a)} errors={errors} />
        </fieldset>
      )}
      {value.deliveryMethod === 'DISCUSS' && (
        <Field label="受渡場所（決まっていれば）" hint="未定なら空欄で構いません。決まったら「条件を提案」で、受け取り・配送のどちらかを選んでください。">
          <input id={`${idPrefix}-place`} className="input" type="text" maxLength={100} value={value.deliveryPlace} onChange={(e) => set('deliveryPlace', e.target.value)} />
        </Field>
      )}
      {value.deliveryMethod !== 'PICKUP' && (
        <div className="field-pair">
          <Field label="送料（円）" error={shippingFeeError(value)} hint="未確定なら空欄（「未確定」と表示します）">
            <input id={`${idPrefix}-fee`} className="input" type="text" inputMode="numeric" value={value.shippingFee} placeholder="未確定" onChange={(e) => set('shippingFee', e.target.value)} />
          </Field>
          <Field label="送料の負担">
            <select className="input" value={value.shippingPayer} onChange={(e) => set('shippingPayer', e.target.value as ShippingPayer)}>
              {(Object.keys(PAYER_LABEL) as ShippingPayer[]).map((k) => (
                <option key={k} value={k}>
                  {PAYER_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <p className="field-hint">配送の手配・決済はアプリでは行いません。方法や送料は、当事者どうしで相談して決めてください。</p>
    </div>
  )
}
