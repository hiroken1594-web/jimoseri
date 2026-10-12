import { useCallback, useEffect, useState } from 'react'
import type { AdminOverview, ReviewStatus } from '../../shared/dto.js'
import { formatQtyUnit, formatYen } from '../../shared/labels.js'
import type { AdminActionInput } from '../../shared/schemas.js'
import { formatJstDateTime } from '../../shared/time.js'
import { api, errorMessage } from '../api.js'
import { Loading, Notice } from '../components/ui.js'

const STATUS: Record<ReviewStatus, { label: string; className: string }> = {
  PENDING: { label: '確認待ち', className: 'chip chip-warn' },
  APPROVED: { label: '確認済み', className: 'chip chip-live' },
  SUSPENDED: { label: '停止中', className: 'chip chip-off' },
}
const ORDER: Record<ReviewStatus, number> = { PENDING: 0, APPROVED: 1, SUSPENDED: 2 }

// 運営者用の最小限の管理画面：生産者の審査、受渡場所の確認、出品の停止。
export function Admin() {
  const [data, setData] = useState<AdminOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api<AdminOverview>('/api/admin'))
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (body: AdminActionInput, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    try {
      await api('/api/admin', { body })
      await load()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const actions = (target: 'producer' | 'location', id: string, status: ReviewStatus, name: string) => (
    <div className="card-actions">
      {status !== 'APPROVED' && (
        <button className="btn btn-primary" disabled={busy} onClick={() => act({ target, id, action: 'approve' })}>
          {status === 'SUSPENDED' ? '停止を解除する' : '確認済みにする'}
        </button>
      )}
      {status !== 'SUSPENDED' && (
        <button className="btn btn-quiet" disabled={busy} onClick={() => act({ target, id, action: 'suspend' }, `「${name}」を停止しますか？関係する出品は仕入れ案に表示されなくなります。`)}>
          停止する
        </button>
      )}
    </div>
  )

  if (!data && !error) return <Loading label="読み込んでいます…" />
  const producers = [...(data?.producers ?? [])].sort((a, b) => ORDER[a.approvalStatus] - ORDER[b.approvalStatus])
  const locations = [...(data?.locations ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status])
  const pendingCount = producers.filter((p) => p.approvalStatus === 'PENDING').length + locations.filter((l) => l.status === 'PENDING').length

  return (
    <>
      <h1 className="page-title">審査・管理</h1>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      <Notice kind={pendingCount > 0 ? 'warn' : 'info'}>
        <p>{pendingCount > 0 ? `確認待ちが ${pendingCount} 件あります。` : '確認待ちはありません。'}</p>
      </Notice>

      <section>
        <h2 className="section-title">生産者（{producers.length}）</h2>
        <p className="footnote">確認済みの生産者が、確認済みの受渡場所を使って登録した出品だけが、飲食店の仕入れ案に使われます。</p>
        <div className="cards">
          {producers.length === 0 && <p className="muted">登録された生産者はまだいません。</p>}
          {producers.map((p) => (
            <article className="card" key={p.id}>
              <header className="card-head">
                <h3>{p.farmName}</h3>
                <span className={STATUS[p.approvalStatus].className}>{STATUS[p.approvalStatus].label}</span>
              </header>
              <dl className="meta">
                <div>
                  <dt>地域</dt>
                  <dd>{p.area}</dd>
                </div>
                <div>
                  <dt>メール</dt>
                  <dd>{p.email}</dd>
                </div>
                <div>
                  <dt>登録</dt>
                  <dd>
                    {formatJstDateTime(p.createdAtMs)}／出品 {p.listingCount} 件
                  </dd>
                </div>
              </dl>
              {actions('producer', p.id, p.approvalStatus, p.farmName)}
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">受渡場所（{locations.length}）</h2>
        <div className="cards">
          {locations.length === 0 && <p className="muted">登録された受渡場所はまだありません。</p>}
          {locations.map((l) => (
            <article className="card" key={l.id}>
              <header className="card-head">
                <h3>{l.name}</h3>
                <span className={STATUS[l.status].className}>{STATUS[l.status].label}</span>
              </header>
              <dl className="meta">
                <div>
                  <dt>場所</dt>
                  <dd>
                    {l.municipality} {l.address}
                    {l.note && <small className="block">{l.note}</small>}
                  </dd>
                </div>
                <div>
                  <dt>登録者</dt>
                  <dd>
                    {l.createdByName ?? '（退会済み）'}／{formatJstDateTime(l.createdAtMs)}
                  </dd>
                </div>
              </dl>
              {actions('location', l.id, l.status, l.name)}
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">受渡日時がこれからの出品（{data?.listings.length ?? 0}）</h2>
        <div className="cards">
          {data?.listings.length === 0 && <p className="muted">該当する出品はありません。</p>}
          {data?.listings.map((l) => (
            <article className={l.adminSuspended ? 'card is-off' : 'card'} key={l.id}>
              <header className="card-head">
                <h3>
                  {l.itemName} {formatQtyUnit(l.quantityMilli, l.unit)}
                </h3>
                {l.adminSuspended ? <span className="chip chip-off">運営者が停止中</span> : !l.isPublished && <span className="chip">本人が公開停止中</span>}
              </header>
              <p className="muted">
                {l.farmName}／{formatYen(l.unitPriceYen)}／{formatJstDateTime(l.pickupStartMs)}／{l.pickupLocationName}
              </p>
              <div className="card-actions">
                {l.adminSuspended ? (
                  <button className="btn" disabled={busy} onClick={() => act({ target: 'listing', id: l.id, action: 'approve' })}>
                    停止を解除する
                  </button>
                ) : (
                  <button className="btn btn-quiet" disabled={busy} onClick={() => act({ target: 'listing', id: l.id, action: 'suspend' }, 'この出品を停止しますか？')}>
                    この出品を停止する
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}
