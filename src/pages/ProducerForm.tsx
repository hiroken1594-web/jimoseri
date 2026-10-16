import { CheckCircle2, Sprout } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import type { Grade, IrregularReason, Unit } from '../../shared/allocate.js'
import type { ListingDto, LocationDto } from '../../shared/dto.js'
import { formatQty, formatYen, IRREGULAR_LABEL, IRREGULAR_REASONS, UNIT_LABEL, UNITS } from '../../shared/labels.js'
import type { ListingCreateInput, LocationCreateInput } from '../../shared/schemas.js'
import { ALL_WEEKDAYS, formatPickup, minToTime, WEEKDAY_LABELS } from '../../shared/schedule.js'
import { addDaysJst, jstDateString, jstTimeString } from '../../shared/time.js'
import { api, ApiError, errorMessage } from '../api.js'
import { PREFECTURES } from '../components/AddressFields.js'
import { Choice, Field, Loading, Notice, PageTitle } from '../components/ui.js'
import { parseNumber } from '../lib/forms.js'
import { useSession } from '../session.js'

interface Form {
  itemId: string
  variety: string
  /** DAY：1日だけ／PERIOD：期間（開始日〜終了日の、選んだ曜日） */
  pickupMode: 'DAY' | 'PERIOD'
  pickupDate: string
  pickupEndDate: string
  weekdays: number
  pickupLocationId: string
  quantity: string
  unit: Unit
  unitPriceYen: string
  startTime: string
  endTime: string
  minQuantity: string
  stepQuantity: string
  grade: Grade
  irregularReason: IrregularReason | ''
}

type Errors = Partial<Record<keyof Form, string>>
const STEP1_FIELDS: (keyof Form)[] = ['itemId', 'variety', 'pickupDate', 'pickupEndDate', 'weekdays', 'pickupLocationId']
const NEW_LOCATION = '__new__'

function formFromListing(l: ListingDto, today: string): Form {
  const date = jstDateString(l.pickupStartMs)
  const s = l.schedule
  return {
    itemId: l.itemId,
    variety: l.variety ?? '',
    pickupMode: s ? 'PERIOD' : 'DAY',
    // 1日だけの出品で、過ぎた日付の出品を編集する場合は、日付を選び直してもらう（期間の出品は、期間中なら開始日はそのまま）
    pickupDate: s ? date : date < today ? '' : date,
    pickupEndDate: s ? jstDateString(l.pickupEndMs - 1) : '',
    weekdays: s?.weekdays ?? ALL_WEEKDAYS,
    pickupLocationId: l.pickupLocationId,
    quantity: formatQty(l.quantityMilli),
    unit: l.unit,
    unitPriceYen: String(l.unitPriceYen),
    startTime: s ? minToTime(s.startMin) : jstTimeString(l.pickupStartMs),
    endTime: s ? minToTime(s.endMin) : jstTimeString(l.pickupEndMs),
    minQuantity: formatQty(l.minMilli),
    stepQuantity: formatQty(l.stepMilli),
    grade: l.grade,
    irregularReason: l.irregularReason ?? '',
  }
}

/** 受渡場所を新しく登録する小さなフォーム */
function NewLocation({ onCreated, onCancel }: { onCreated: (location: LocationDto) => void; onCancel: () => void }) {
  const { user } = useSession()
  const [value, setValue] = useState<LocationCreateInput>({ name: '', prefecture: user?.address.prefecture ?? '', municipality: user?.area ?? '', address: '', note: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const set = (key: keyof LocationCreateInput, v: string) => setValue((x) => ({ ...x, [key]: v }))

  const submit = async () => {
    setBusy(true)
    setProblem(null)
    setErrors({})
    try {
      const result = await api<{ location: LocationDto }>('/api/locations', { body: value })
      onCreated(result.location)
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fields)
      setProblem(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sub-form">
      <h3 className="sub-title">受渡場所を新しく登録</h3>
      <p className="field-hint">
        飲食店が受け取りに来る場所です。登録後、運営者が確認するまでは、この場所を使う出品は仕入れ案に表示されません。他の生産者も使う直売所などは、一覧に既にないか先にご確認ください。
      </p>
      <Field label="名称" required error={errors.name} hint="例：〇〇農園 直売所前、△△集荷場">
        <input className="input" type="text" maxLength={40} value={value.name} onChange={(e) => set('name', e.target.value)} />
      </Field>
      <Field label="都道府県" required error={errors.prefecture} hint="飲食店が受取エリアを選ぶときに使います。">
        <select className="input" value={value.prefecture} onChange={(e) => set('prefecture', e.target.value)}>
          <option value="">選択してください</option>
          {PREFECTURES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>
      <Field label="市区町村" required error={errors.municipality} hint="飲食店が受取エリアを選ぶときに使います。例：能勢町">
        <input className="input" type="text" maxLength={20} value={value.municipality} onChange={(e) => set('municipality', e.target.value)} />
      </Field>
      <Field label="住所・目印" required error={errors.address} hint="飲食店に表示されます。自宅の場合は、公開してよい範囲で入力してください。">
        <input className="input" type="text" maxLength={100} value={value.address} onChange={(e) => set('address', e.target.value)} />
      </Field>
      <Field label="補足" error={errors.note} hint="例：駐車場あり、到着したら電話してください">
        <input className="input" type="text" maxLength={100} value={value.note} onChange={(e) => set('note', e.target.value)} />
      </Field>
      {problem && <Notice kind="error">{<p>{problem}</p>}</Notice>}
      <div className="card-actions">
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? '登録中…' : 'この場所を登録する'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={busy}>
          やめる
        </button>
      </div>
    </div>
  )
}

export function ProducerForm() {
  const { master, refresh } = useSession()
  const navigate = useNavigate()
  const { id } = useParams()
  const location = useLocation()
  const editing = Boolean(id)
  const today = jstDateString(Date.now())
  const passed = (location.state as { listing?: ListingDto } | null)?.listing
  // 「複製して登録」：前回の出品の内容を写し、受渡日だけ選び直してもらう（入力の手間を減らす）
  const copyFrom = (location.state as { copyFrom?: ListingDto } | null)?.copyFrom
  const initial = (): Form => ({
    itemId: '',
    variety: '',
    pickupMode: 'DAY',
    pickupDate: addDaysJst(today, 1),
    pickupEndDate: addDaysJst(today, 30),
    weekdays: ALL_WEEKDAYS,
    pickupLocationId: '',
    quantity: '',
    unit: 'KG',
    unitPriceYen: '',
    startTime: '10:00',
    endTime: '11:00',
    minQuantity: '1',
    stepQuantity: '1',
    grade: 'REGULAR',
    irregularReason: '',
  })
  const [form, setForm] = useState<Form | null>(() =>
    editing ? (passed ? formFromListing(passed, today) : null) : copyFrom ? { ...formFromListing(copyFrom, today), pickupDate: addDaysJst(today, 1) } : initial(),
  )
  const [loadError, setLoadError] = useState<string | null>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [saved, setSaved] = useState<ListingDto | null>(null)
  const [addingLocation, setAddingLocation] = useState(false)

  // 編集画面を直接開いた場合は、自分の出品一覧から探す
  useEffect(() => {
    if (!editing || form) return
    api<{ listings: ListingDto[] }>('/api/listings')
      .then((r) => {
        const found = r.listings.find((l) => l.id === id)
        if (found) setForm(formFromListing(found, today))
        else setLoadError('出品が見つかりません。')
      })
      .catch((e) => setLoadError(errorMessage(e)))
  }, [editing, form, id, today])

  if (loadError) {
    return (
      <>
        <Notice kind="error">{<p>{loadError}</p>}</Notice>
        <Link className="btn" to="/producer">
          一覧に戻る
        </Link>
      </>
    )
  }
  if (!form) return <Loading label="読み込んでいます…" />

  const update = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }
  const unit = UNIT_LABEL[form.unit]
  const place = master.locations.find((p) => p.id === form.pickupLocationId)

  const validateStep1 = (): Errors => {
    const e: Errors = {}
    if (!form.itemId) e.itemId = '品目を選択してください'
    if (form.pickupMode === 'DAY') {
      if (!form.pickupDate) e.pickupDate = '受渡日を選択してください'
      else if (form.pickupDate < today) e.pickupDate = '今日以降の日付を選んでください'
    } else {
      if (!form.pickupDate) e.pickupDate = '受渡開始日を選択してください'
      if (!form.pickupEndDate) e.pickupEndDate = '受渡終了日を選択してください'
      else if (form.pickupEndDate < today) e.pickupEndDate = '終了日は今日以降にしてください'
      else if (form.pickupDate && form.pickupEndDate < form.pickupDate) e.pickupEndDate = '終了日は開始日以降にしてください'
      if (!form.weekdays) e.weekdays = '受け渡しできる曜日を1つ以上選んでください'
    }
    if (!form.pickupLocationId) e.pickupLocationId = '受渡場所を選択してください'
    return e
  }

  const next = () => {
    const e = validateStep1()
    setErrors(e)
    if (Object.keys(e).length === 0) {
      setStep(2)
      window.scrollTo(0, 0)
    }
  }

  const submit = async () => {
    const e: Errors = {}
    const quantity = parseNumber(form.quantity)
    const price = parseNumber(form.unitPriceYen)
    const min = parseNumber(form.minQuantity)
    const stepQty = parseNumber(form.stepQuantity)
    if (quantity === null || quantity <= 0) e.quantity = '販売可能量を数字で入力してください'
    if (price === null || price < 1 || !Number.isInteger(price)) e.unitPriceYen = '税込単価を1円単位の数字で入力してください'
    if (min === null || min <= 0) e.minQuantity = '最低販売量を数字で入力してください'
    else if (quantity !== null && min > quantity) e.minQuantity = '最低販売量は販売可能量以下にしてください'
    if (stepQty === null || stepQty <= 0) e.stepQuantity = '販売刻みを数字で入力してください'
    if (!form.startTime) e.startTime = '開始時刻を選択してください'
    if (!form.endTime || form.endTime <= form.startTime) e.endTime = '終了時刻は開始時刻より後にしてください'
    if (form.grade === 'IRREGULAR' && !form.irregularReason) e.irregularReason = '理由を選択してください'
    setErrors(e)
    if (Object.keys(e).length > 0) return

    const payload: ListingCreateInput = {
      itemId: form.itemId,
      variety: form.variety.trim() || null,
      grade: form.grade,
      irregularReason: form.grade === 'IRREGULAR' ? (form.irregularReason as IrregularReason) : null,
      quantity: quantity!,
      unit: form.unit,
      unitPriceYen: price!,
      minQuantity: min!,
      stepQuantity: stepQty!,
      pickupLocationId: form.pickupLocationId,
      pickupMode: form.pickupMode,
      pickupDate: form.pickupDate,
      pickupEndDate: form.pickupMode === 'PERIOD' ? form.pickupEndDate : null,
      weekdays: form.pickupMode === 'PERIOD' ? form.weekdays : null,
      startTime: form.startTime,
      endTime: form.endTime,
    }
    setBusy(true)
    setProblem(null)
    try {
      const result = editing
        ? await api<{ listing: ListingDto }>(`/api/listings?id=${encodeURIComponent(id!)}`, { method: 'PUT', body: payload })
        : await api<{ listing: ListingDto }>('/api/listings', { body: payload })
      setSaved(result.listing)
      window.scrollTo(0, 0)
    } catch (err) {
      setProblem(errorMessage(err))
      if (err instanceof ApiError && Object.keys(err.fields).length > 0) {
        setErrors(err.fields as Errors)
        if (STEP1_FIELDS.some((f) => f in err.fields)) setStep(1)
      }
    } finally {
      setBusy(false)
    }
  }

  if (saved) {
    const u = UNIT_LABEL[saved.unit]
    const live = saved.blockers.length === 0
    return (
      <>
        <PageTitle icon={CheckCircle2}>{editing ? '変更しました' : '登録しました'}</PageTitle>
        {live ? (
          <Notice kind="success" title="飲食店への提案候補になりました">
            <p>条件が合う飲食店の仕入れ案に、他の生産者の分と組み合わせて表示されます。まだ売れたわけではなく、注文・予約も入っていません。</p>
          </Notice>
        ) : (
          <Notice kind="warn" title="運営者の確認後に、提案候補になります">
            <p>登録内容または受渡場所を運営者が確認しています。確認が済むと、自動的に飲食店の仕入れ案の候補になります。</p>
          </Notice>
        )}
        <article className="card">
          <header className="card-head">
            <h3>
              {saved.itemName}
              {saved.variety && <small>（{saved.variety}）</small>}
            </h3>
            <span className={live ? 'chip chip-live' : 'chip chip-warn'}>{live ? '公開中・提案候補' : '確認待ち'}</span>
          </header>
          <dl className="meta">
            <div>
              <dt>販売可能量</dt>
              <dd>
                {formatQty(saved.quantityMilli)}
                {u}（最低{formatQty(saved.minMilli)}
                {u}・{formatQty(saved.stepMilli)}
                {u}刻み）
              </dd>
            </div>
            <div>
              <dt>税込単価</dt>
              <dd>
                {formatYen(saved.unitPriceYen)}/{u}
              </dd>
            </div>
            <div>
              <dt>区分</dt>
              <dd>{saved.grade === 'IRREGULAR' && saved.irregularReason ? `規格外：${IRREGULAR_LABEL[saved.irregularReason]}` : '通常品'}</dd>
            </div>
            <div>
              <dt>受渡</dt>
              <dd>
                {formatPickup(saved)}／{saved.pickupLocationName}
              </dd>
            </div>
          </dl>
        </article>
        <div className="actions">
          <button className="btn btn-primary btn-large" onClick={() => navigate('/producer')}>
            一覧に戻る
          </button>
          {!editing && (
            <button
              className="btn btn-large"
              onClick={() => {
                setSaved(null)
                setForm(initial())
                setStep(1)
              }}
            >
              続けて別のものを登録
            </button>
          )}
        </div>
      </>
    )
  }

  return (
    <>
      <PageTitle icon={Sprout}>{editing ? '出品内容の編集' : '販売できるものを登録'}</PageTitle>
      {copyFrom && !editing && (
        <Notice kind="info" title="前回の出品を複製しました">
          <p>品目・価格・受渡場所・時間などを写してあります。受渡日と数量を確かめて登録してください。</p>
        </Notice>
      )}
      <ol className="steps" aria-label="入力の進み具合">
        <li className={step === 1 ? 'is-current' : 'is-done'}>① 何を・いつ・どこで</li>
        <li className={step === 2 ? 'is-current' : ''}>② 量・価格・条件</li>
      </ol>

      {problem && (
        <Notice kind="error" title={editing ? '変更できませんでした' : '登録できませんでした'}>
          <p>{problem}</p>
        </Notice>
      )}

      {step === 1 && (
        <div className="form">
          <Field label="品目" required error={errors.itemId}>
            <select className="input" value={form.itemId} onChange={(e) => update('itemId', e.target.value)}>
              <option value="">選択してください</option>
              {master.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="品種・銘柄" error={errors.variety}>
            <input className="input" type="text" maxLength={30} value={form.variety} placeholder="例：桃太郎" onChange={(e) => update('variety', e.target.value)} />
          </Field>
          <Field label="受け渡しの日" required>
            <Choice<'DAY' | 'PERIOD'>
              label="受け渡しの日"
              value={form.pickupMode}
              onChange={(v) => update('pickupMode', v)}
              options={[
                { value: 'DAY', label: '1日だけ', sub: '決まった日に受け渡し' },
                { value: 'PERIOD', label: '期間で指定', sub: '例：10月〜12月の毎週月・水・金' },
              ]}
            />
          </Field>
          {form.pickupMode === 'DAY' ? (
            <Field label="受渡できる日" required error={errors.pickupDate}>
              <input className="input" type="date" min={today} value={form.pickupDate} onChange={(e) => update('pickupDate', e.target.value)} />
            </Field>
          ) : (
            <>
              <div className="field-pair">
                <Field label="受渡開始日" required error={errors.pickupDate}>
                  <input className="input" type="date" value={form.pickupDate} onChange={(e) => update('pickupDate', e.target.value)} />
                </Field>
                <Field label="受渡終了日" required error={errors.pickupEndDate}>
                  <input className="input" type="date" min={form.pickupDate || today} value={form.pickupEndDate} onChange={(e) => update('pickupEndDate', e.target.value)} />
                </Field>
              </div>
              <Field label="受け渡しできる曜日" required error={errors.weekdays} hint="期間内の、選んだ曜日に受け渡しできます。時間帯は次の画面で入力します。">
                <div className="weekday-picker" role="group" aria-label="受け渡しできる曜日">
                  {WEEKDAY_LABELS.map((label, i) => (
                    <button key={label} type="button" aria-pressed={Boolean(form.weekdays & (1 << i))} onClick={() => update('weekdays', form.weekdays ^ (1 << i))}>
                      {label}
                    </button>
                  ))}
                </div>
              </Field>
            </>
          )}
          <Field
            label="受渡場所"
            required
            error={errors.pickupLocationId}
            hint={
              place
                ? `${place.municipality} ${place.address}${place.status === 'PENDING' ? '（運営者の確認待ち）' : ''}`
                : '同じ場所・同じ時間帯の出品どうしが、1つの仕入れ案にまとめられます。'
            }
          >
            <select
              className="input"
              value={addingLocation ? NEW_LOCATION : form.pickupLocationId}
              onChange={(e) => {
                if (e.target.value === NEW_LOCATION) return setAddingLocation(true)
                setAddingLocation(false)
                update('pickupLocationId', e.target.value)
              }}
            >
              <option value="">選択してください</option>
              {master.locations.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.municipality}）{p.status === 'PENDING' ? '・確認待ち' : ''}
                </option>
              ))}
              <option value={NEW_LOCATION}>＋ 新しい受渡場所を登録する</option>
            </select>
          </Field>
          {addingLocation && (
            <NewLocation
              onCancel={() => setAddingLocation(false)}
              onCreated={async (created) => {
                await refresh().catch(() => undefined)
                setAddingLocation(false)
                update('pickupLocationId', created.id)
              }}
            />
          )}
          <div className="actions">
            <button className="btn btn-primary btn-large" onClick={next} disabled={addingLocation}>
              次へ
            </button>
            <Link className="btn btn-large btn-quiet" to="/producer">
              やめて一覧に戻る
            </Link>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="form">
          <Field label="いま販売に回せる量" required error={errors.quantity} hint="収穫した総量ではなく、既に注文が入っている分を除いた量を入力してください。">
            <div className="input-row">
              <input className="input" type="text" inputMode="decimal" value={form.quantity} placeholder="5" onChange={(e) => update('quantity', e.target.value)} />
              <select className="input input-unit" aria-label="単位" value={form.unit} onChange={(e) => update('unit', e.target.value as Unit)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNIT_LABEL[u]}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label={`税込単価（1${unit}あたり）`} required error={errors.unitPriceYen}>
            <div className="input-row">
              <input className="input" type="text" inputMode="numeric" value={form.unitPriceYen} placeholder="600" onChange={(e) => update('unitPriceYen', e.target.value)} />
              <span className="input-suffix">円</span>
            </div>
          </Field>
          <Field label="受渡できる時間帯" required error={errors.startTime ?? errors.endTime}>
            <div className="input-row">
              <input className="input" type="time" aria-label="開始時刻" value={form.startTime} onChange={(e) => update('startTime', e.target.value)} />
              <span className="input-suffix">〜</span>
              <input className="input" type="time" aria-label="終了時刻" value={form.endTime} onChange={(e) => update('endTime', e.target.value)} />
            </div>
          </Field>
          <div className="field-pair">
            <Field label="最低販売量" required error={errors.minQuantity}>
              <div className="input-row">
                <input className="input" type="text" inputMode="decimal" value={form.minQuantity} onChange={(e) => update('minQuantity', e.target.value)} />
                <span className="input-suffix">{unit}</span>
              </div>
            </Field>
            <Field label="販売刻み" required error={errors.stepQuantity}>
              <div className="input-row">
                <input className="input" type="text" inputMode="decimal" value={form.stepQuantity} onChange={(e) => update('stepQuantity', e.target.value)} />
                <span className="input-suffix">{unit}</span>
              </div>
            </Field>
          </div>
          <Field label="区分" required hint="傷みや鮮度が落ちたものは、規格外としては登録しないでください。">
            <Choice<Grade>
              label="区分"
              value={form.grade}
              onChange={(v) => update('grade', v)}
              options={[
                { value: 'REGULAR', label: '通常品' },
                { value: 'IRREGULAR', label: '余剰・規格外', sub: '形の不揃いなど' },
              ]}
            />
          </Field>
          {form.grade === 'IRREGULAR' && (
            <Field label="余剰・規格外の理由" required error={errors.irregularReason}>
              <select className="input" value={form.irregularReason} onChange={(e) => update('irregularReason', e.target.value as IrregularReason | '')}>
                <option value="">選択してください</option>
                {IRREGULAR_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {IRREGULAR_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="actions">
            <button className="btn btn-primary btn-large" onClick={submit} disabled={busy}>
              {busy ? '保存中…' : editing ? 'この内容に変更する' : 'この内容で登録する'}
            </button>
            <button className="btn btn-large btn-quiet" onClick={() => setStep(1)} disabled={busy}>
              戻る
            </button>
          </div>
        </div>
      )}
    </>
  )
}
