import { DELIVERY_LABEL, PAYER_LABEL, type DeliveryMethod, type ShippingPayer } from '../../shared/trade.js'
import { parseNumber } from '../lib/forms.js'
import { Choice, Field } from './ui.js'

export interface DeliveryValue {
  deliveryMethod: DeliveryMethod
  deliveryPlace: string
  /** 空欄は「未確定」 */
  shippingFee: string
  shippingPayer: ShippingPayer
}

export const deliveryDefaults = (place: string): DeliveryValue => ({ deliveryMethod: 'PICKUP', deliveryPlace: place, shippingFee: '', shippingPayer: 'UNDECIDED' })

/** API に送る形（送料が空欄なら null ＝ 未確定） */
export function deliveryPayload(v: DeliveryValue) {
  const fee = v.shippingFee.trim() ? parseNumber(v.shippingFee) : null
  return {
    deliveryMethod: v.deliveryMethod,
    deliveryPlace: v.deliveryPlace.trim(),
    shippingFeeYen: fee === null ? null : Math.round(fee),
    shippingPayer: v.shippingPayer,
  }
}

/** 送料の入力が正しいか（空欄は未確定としてよい） */
export const shippingFeeError = (v: DeliveryValue) => (v.shippingFee.trim() && parseNumber(v.shippingFee) === null ? '送料は数字で入力してください（未確定なら空欄）' : undefined)

/** 受渡方法・受渡場所・送料・送料の負担。配送の手配はアプリでは行わない */
export function DeliveryFields({ value, onChange, idPrefix, pickupPlace }: { value: DeliveryValue; onChange: (next: DeliveryValue) => void; idPrefix: string; pickupPlace: string }) {
  const set = <K extends keyof DeliveryValue>(key: K, v: DeliveryValue[K]) => onChange({ ...value, [key]: v })
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
      <Field label="受渡場所" hint={value.deliveryMethod === 'DELIVERY' ? '配送先（お店の場所など）。住所は必要な範囲で、チャットで確認してください。' : value.deliveryMethod === 'DISCUSS' ? '未定なら空欄で構いません。' : undefined}>
        <input id={`${idPrefix}-place`} className="input" type="text" maxLength={100} value={value.deliveryPlace} onChange={(e) => set('deliveryPlace', e.target.value)} />
      </Field>
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
