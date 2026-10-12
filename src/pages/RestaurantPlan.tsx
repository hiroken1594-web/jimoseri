import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import type { AllocationLine, ExclusionReason, PointResult } from '../../shared/allocate.js'
import type { PlanResponse } from '../../shared/dto.js'
import { buildCopyText, buildMultiCopyText, describeStockChanges } from '../../shared/format.js'
import { EXCLUSION_LABEL, formatQtyUnit, formatYen, IRREGULAR_LABEL, UNIT_LABEL } from '../../shared/labels.js'
import { DAY_MS, formatJstDate, formatJstDateTime, formatWindow, jstToMs } from '../../shared/time.js'
import { api, errorMessage } from '../api.js'
import { Loading, Notice } from '../components/ui.js'
import { loadConfirmedDemand, saveDraft } from '../lib/forms.js'

const CHECK_INTERVAL_MS = 20_000
const STALE_UPDATE_MS = 2 * DAY_MS

const SUGGESTION: Record<ExclusionReason, string> = {
  IRREGULAR: '規格外品を「含めてよい」にすると候補が増えます。',
  POINT: '受取エリアを「指定なし」にすると、他のエリアの受渡場所も対象になります。',
  TIME: '希望日・日時を変更すると候補が増える可能性があります。',
  UNIT: '個とkgなど、単位の異なる在庫は根拠なく換算しません。',
  MIN_LOT: '希望量を増やすと対象になる可能性があります。',
}

const STATUS_LABEL: Record<PointResult['status'], string> = {
  MATCHED: '条件達成',
  OVER_BUDGET: '予算超過',
  SHORTAGE: '不足',
}

export function RestaurantPlan() {
  const navigate = useNavigate()
  const location = useLocation()
  const [demand] = useState(() => loadConfirmedDemand())
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [changes, setChanges] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [copy, setCopy] = useState<{ state: 'idle' | 'done' | 'manual' | 'blocked'; text?: string }>({ state: 'idle' })
  const planRef = useRef<PlanResponse | null>(null)
  const started = useRef(false)

  // 毎回サーバーで DB を読み直して計算する。前回の結果があれば在庫の差分を出す。
  const compute = useCallback(
    async (save: boolean) => {
      if (!demand) return
      setLoading(true)
      setError(null)
      setCopy({ state: 'idle' })
      try {
        const next = await api<PlanResponse>('/api/plan', { body: { ...demand, save } })
        const previous = planRef.current
        setChanges(previous ? describeStockChanges(previous.result.snapshot, next.result.snapshot) : null)
        planRef.current = next
        setPlan(next)
        setStale(false)
      } catch (e) {
        setError(errorMessage(e))
      } finally {
        setLoading(false)
      }
    },
    [demand],
  )

  /** 表示中の案が古くなっていないかサーバーに確認する。確認できなかった場合は null。 */
  const checkFresh = useCallback(async (): Promise<boolean | null> => {
    const current = planRef.current
    if (!current) return null
    try {
      const result = await api<{ fresh: boolean }>('/api/plan', {
        method: 'PUT',
        body: { itemId: current.demand.itemId, fingerprint: current.fingerprint },
      })
      if (!result.fresh) {
        setStale(true)
        setCopy({ state: 'idle' })
      }
      return result.fresh
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    if (started.current) return
    started.current = true
    const fresh = (location.state as { fresh?: boolean } | null)?.fresh === true
    // 画面を読み込み直したときに、同じ希望条件を重複して保存しない
    navigate(location.pathname, { replace: true, state: null })
    void compute(fresh)
  }, [compute, location, navigate])

  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void checkFresh()
    const timer = setInterval(onVisible, CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [checkFresh])

  if (!demand) return <Navigate to="/restaurant" replace />

  const copyPlan = async (kind: 'single' | 'multi') => {
    if (!plan) return
    const { best: single, multi: multiPlan } = plan.result
    if (kind === 'single' ? !single : !multiPlan) return
    // コピーの直前にも在庫を確認し、古い案は持ち出させない
    const fresh = await checkFresh()
    if (fresh === false) return
    if (fresh === null) return setCopy({ state: 'blocked' })
    const extras = { locations: plan.locations, contacts: plan.contacts }
    const text =
      kind === 'single'
        ? buildCopyText(plan.demand, single!, plan.computedAtMs, extras)
        : buildMultiCopyText(plan.demand, multiPlan!, plan.computedAtMs, extras)
    try {
      await navigator.clipboard.writeText(text)
      setCopy({ state: 'done' })
    } catch {
      // 端末の制限でコピーできない場合は、文面を表示して手動でコピーしてもらう
      setCopy({ state: 'manual', text })
    }
  }

  const startOver = () => {
    saveDraft(null)
    navigate('/restaurant')
  }

  if (loading && !plan) return <Loading label="在庫を確認して仕入れ案を計算しています…" />

  if (error && !plan) {
    return (
      <>
        <h1 className="page-title">仕入れ案</h1>
        <Notice kind="error" title="仕入れ案を作れませんでした">
          <p>{error}</p>
        </Notice>
        <div className="actions">
          <button className="btn btn-primary btn-large" onClick={() => compute(false)}>
            もう一度計算する
          </button>
          <button className="btn btn-large" onClick={() => navigate('/restaurant/confirm')}>
            条件を変更
          </button>
        </div>
      </>
    )
  }
  if (!plan) return null

  const { result, demand: d } = plan
  const best = result.best
  const multi = result.multi
  const unit = UNIT_LABEL[d.unit]
  const qty = (milli: number) => formatQtyUnit(milli, d.unit)
  const placeLine = (pointId: string) => {
    const loc = plan.locations[pointId]
    return loc ? `${loc.municipality} ${loc.address}${loc.note ? `（${loc.note}）` : ''}` : ''
  }

  const lineCard = (line: AllocationLine) => {
    const info = plan.listingInfo[line.listingId]
    const contact = plan.contacts[line.producerId]
    const old = info && plan.computedAtMs - info.updatedAtMs > STALE_UPDATE_MS
    return (
      <article className="card alloc-card" key={line.listingId}>
        <header className="card-head">
          <h4>{line.producerName}</h4>
          {line.grade === 'IRREGULAR' ? (
            <span className="chip chip-irregular">規格外：{line.irregularReason ? IRREGULAR_LABEL[line.irregularReason] : '理由未登録'}</span>
          ) : (
            <span className="chip">通常品</span>
          )}
        </header>
        <p className="alloc-item">
          {d.itemName}
          {line.variety && `（${line.variety}）`}
        </p>
        <p className="alloc-qty">{qty(line.quantityMilli)}</p>
        <p className="alloc-price">
          {formatYen(line.unitPriceYen)}/{unit} × {qty(line.quantityMilli)} ＝ <strong>{formatYen(line.subtotalYen)}</strong>
          <small>（税込）</small>
        </p>
        <dl className="meta">
          {info && (
            <div>
              <dt>受渡</dt>
              <dd>
                {formatWindow(info.pickupStartMs, info.pickupEndMs)}／{line.pickupPointName}
              </dd>
            </div>
          )}
          {contact && (
            <div>
              <dt>連絡先</dt>
              <dd>
                {contact.phone && (
                  <a className="block" href={`tel:${contact.phone}`}>
                    電話 {contact.phone}
                  </a>
                )}
                {contact.email && (
                  <a className="block" href={`mailto:${contact.email}`}>
                    {contact.email}
                  </a>
                )}
                {contact.note && <small className="block">{contact.note}</small>}
              </dd>
            </div>
          )}
          {info && (
            <div>
              <dt>在庫の最終更新</dt>
              <dd>
                {formatJstDateTime(info.updatedAtMs)}
                {old && <span className="chip chip-warn">更新が古い・要確認</span>}
              </dd>
            </div>
          )}
        </dl>
      </article>
    )
  }
  const wish =
    d.timeMode === 'EXACT'
      ? `${formatJstDate(jstToMs(d.date))} ${d.time} に受け取り`
      : `${formatJstDate(jstToMs(d.date))} までに受け取り`

  let heroClass = 'hero hero-none'
  let heroTitle = 'この品目の出品は、いま登録されていません'
  let heroSub: string | null = '希望日や品目を変えて、もう一度お試しください。'
  if (result.status === 'MISMATCH') {
    heroTitle = '条件に合う出品がありません'
    heroSub = '同じ品目の出品はありますが、下の理由で仕入れ案に含められません。'
  } else if (best?.status === 'MATCHED') {
    heroClass = 'hero hero-ok'
    heroTitle = '希望数量に対応する仕入れ案があります（未確保）'
    heroSub = null
  } else if (best?.status === 'OVER_BUDGET') {
    heroClass = 'hero hero-warn'
    heroTitle = '数量は揃いますが、予算を超えています'
    heroSub = `予算上限 ${formatYen(d.budgetMaxYen ?? 0)}／最も安い案 ${formatYen(best.plan.totalYen)}／${formatYen(best.plan.totalYen - (d.budgetMaxYen ?? 0))}超過`
  } else if (best?.status === 'SHORTAGE') {
    heroClass = 'hero hero-warn'
    heroTitle = `${qty(best.shortageMilli)}不足しています`
    heroSub =
      best.eligibleMilli >= result.demandMilli
        ? `希望${qty(result.demandMilli)}／条件に合う登録数量は${qty(best.eligibleMilli)}ありますが、1つの案に組めるのは${qty(best.plan.totalMilli)}まで／${qty(best.shortageMilli)}不足`
        : `希望${qty(result.demandMilli)}／条件に合う登録数量${qty(best.eligibleMilli)}／${qty(best.shortageMilli)}不足`
  }

  return (
    <div className={stale ? 'plan is-stale' : 'plan'}>
      <h1 className="page-title">仕入れ案</h1>

      {stale && (
        <Notice kind="error" title="在庫が更新されました。この案は古いため使えません">
          <p>生産者が在庫を変更したか、受渡の期限が過ぎました。再計算して最新の案を確認してください。</p>
          <div className="notice-actions">
            <button className="btn btn-small btn-primary" onClick={() => compute(false)} disabled={loading}>
              {loading ? '計算中…' : '再計算する'}
            </button>
          </div>
        </Notice>
      )}
      {error && (
        <Notice kind="error" title="再計算できませんでした">
          <p>{error}</p>
        </Notice>
      )}
      {changes && !stale && (
        <Notice kind={changes.length > 0 ? 'warn' : 'info'} title={changes.length > 0 ? '在庫の変化を反映して再計算しました' : '再計算しました'}>
          {changes.length > 0 ? (
            <ul>
              {changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <p>前回の計算から、この品目の在庫に変化はありません。</p>
          )}
        </Notice>
      )}

      <section className={heroClass} aria-live="polite">
        <p className="hero-wish">
          希望：{d.itemName} {qty(d.quantityMilli)}／{wish}
        </p>
        <h2 className="hero-title">{heroTitle}</h2>
        {heroSub && <p className="hero-sub">{heroSub}</p>}
        {best && (
          <dl className="hero-stats">
            <div>
              <dt>合計数量</dt>
              <dd>
                {qty(best.plan.totalMilli)}
                <small>／希望{qty(result.demandMilli)}</small>
              </dd>
            </div>
            <div>
              <dt>税込商品代</dt>
              <dd>{formatYen(best.plan.totalYen)}</dd>
            </div>
            <div className="hero-stats-wide">
              <dt>受渡候補</dt>
              <dd>
                {formatWindow(best.plan.windowStartMs, best.plan.windowEndMs)}
                <small className="block">{best.pickupPointName}</small>
                <small className="block">{placeLine(best.pickupPointId)}</small>
              </dd>
            </div>
          </dl>
        )}
        <p className="hero-state">
          {best && <span className="badge-unsecured">農家承認前・在庫未確保</span>}
          <span>最終計算 {formatJstDateTime(plan.computedAtMs)}</span>
        </p>
      </section>

      {best?.windowConflict && (
        <Notice kind="warn">
          <p>数量はありますが、同じ日時・場所で受け取れる組み合わせがありません。希望日・日時の変更をご検討ください。</p>
        </Notice>
      )}
      {result.searchTruncated && (
        <Notice kind="warn" title="最適な案とは限りません">
          <p>候補が多いため、組み合わせの探索を途中で打ち切りました。表示中の案より生産者数が少ない案・安い案が存在する可能性があります。</p>
        </Notice>
      )}

      {best?.status !== 'MATCHED' && result.exclusions.length > 0 && (
        <section className="reasons">
          <h3>案に含めなかった在庫と、条件の変更候補</h3>
          <ul>
            {result.exclusions.map((e) => (
              <li key={e.reason}>
                <strong>
                  {EXCLUSION_LABEL[e.reason]}：{e.count}件{e.quantityMilli > 0 && `（計${qty(e.quantityMilli)}）`}
                </strong>
                <span>{SUGGESTION[e.reason]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {best?.status === 'SHORTAGE' && (
        <p className="footnote">不足分を自動で減らしたり、別の品種・品目に置き換えたりはしません。</p>
      )}
      {best && best.status !== 'MATCHED' && !d.allowMultiLocation && d.timeMode === 'DEADLINE' && result.alternatives.length > 0 && (
        <Notice kind="info">
          <p>
            他の受渡場所にも条件に合う在庫があります。「条件を変更」で「複数の場所での受け取りを許可する」をオンにすると、場所をまたいだ参考案も計算します。
          </p>
        </Notice>
      )}

      {best && (
        <section>
          <h3 className="section-title">
            生産者ごとの配分（{best.plan.producerCount}者）
          </h3>
          <div className="cards">
            {best.plan.lines.map(lineCard)}
          </div>
        </section>
      )}

      {multi && (
        <section className="multi">
          <h3 className="section-title">受取調整が必要な参考案（{multi.stops.length}か所で受け取り）</h3>
          <Notice kind="warn" title={multi.status === 'MATCHED' ? `${multi.stops.length}か所を回ると、希望量が揃います` : `${multi.stops.length}か所を回る場合の案です`}>
            <p>
              合計 {qty(multi.totalMilli)}／{formatYen(multi.totalYen)}（税込商品代）
              {multi.status === 'SHORTAGE' && `／${qty(multi.shortageMilli)}不足`}
              {multi.status === 'OVER_BUDGET' && d.budgetMaxYen !== null && `／予算を${formatYen(multi.totalYen - d.budgetMaxYen)}超過`}
            </p>
            <p>
              <strong>場所の間の移動時間は考慮していません。</strong>
              それぞれの場所・時間に受け取りに行けるか、ご自身でご確認ください。これも未確保の提案です。
            </p>
          </Notice>
          {multi.stops.map((stop, i) => (
            <div className="stop" key={stop.pickupPointId}>
              <div className="stop-head">
                <span className="stop-no">受取{i + 1}</span>
                <div>
                  <p className="stop-when">{formatWindow(stop.windowStartMs, stop.windowEndMs)}</p>
                  <p>{stop.pickupPointName}</p>
                  <p className="footnote">{placeLine(stop.pickupPointId)}</p>
                  <p className="footnote">
                    この場所での小計：{qty(stop.totalMilli)}／{formatYen(stop.totalYen)}
                  </p>
                </div>
              </div>
              <div className="cards">{stop.lines.map(lineCard)}</div>
            </div>
          ))}
          <button className="btn btn-block" onClick={() => copyPlan('multi')} disabled={stale || loading}>
            この参考案をコピー
          </button>
        </section>
      )}

      {result.alternatives.length > 0 && (
        <details className="alternatives">
          <summary>他の受渡場所で受け取る場合（{result.alternatives.length}件）</summary>
          {result.alternatives.map((alt) => (
            <div className="alt-row" key={alt.pickupPointId}>
              <p>
                <span className="chip">{STATUS_LABEL[alt.status]}</span> {alt.pickupPointName}
              </p>
              <p>
                {qty(alt.plan.totalMilli)}／{formatYen(alt.plan.totalYen)}／{alt.plan.producerCount}者／
                {formatWindow(alt.plan.windowStartMs, alt.plan.windowEndMs)}
              </p>
            </div>
          ))}
          <p className="footnote">それぞれ、その場所だけで受け取る場合の案です。</p>
        </details>
      )}

      {copy.state === 'done' && (
        <Notice kind="success" title="コピーしました">
          <p>相談用のメモとして貼り付けられます。アプリから生産者への送信・注文は行っていません。</p>
        </Notice>
      )}
      {copy.state === 'blocked' && (
        <Notice kind="error">
          <p>最新の在庫を確認できなかったため、コピーを中止しました。通信状況を確認して、もう一度お試しください。</p>
        </Notice>
      )}
      {copy.state === 'manual' && (
        <Notice kind="warn" title="自動でコピーできませんでした">
          <p>下の文面を長押しして選択し、コピーしてください。</p>
          <textarea className="input copy-fallback" readOnly rows={9} value={copy.text} onFocus={(e) => e.target.select()} />
        </Notice>
      )}

      <p className="disclaimer">
        これは見積・提案であり、注文・在庫予約・各農家の承認ではありません。同じ在庫が他のお店の案に含まれる場合があります。受渡場所と日時は生産者が登録したもので、配送・受渡しをこのサービスが手配することはありません。
      </p>

      <div className="action-bar">
        {best && (
          <button className="btn btn-primary action-main" onClick={() => copyPlan('single')} disabled={stale || loading}>
            仕入れ案をコピー
          </button>
        )}
        <button className={best ? 'btn' : 'btn btn-primary'} onClick={() => compute(false)} disabled={loading}>
          {loading ? '計算中…' : '再計算'}
        </button>
        <button className="btn" onClick={() => navigate('/restaurant/confirm')}>
          条件を変更
        </button>
      </div>
      <button className="link-button" onClick={startOver}>
        別の仕入れ案を最初から作る
      </button>
    </div>
  )
}
