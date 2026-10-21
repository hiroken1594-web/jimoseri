import { Bell, CheckCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { NotificationDto } from '../../shared/dto.js'
import { formatJstDateTime } from '../../shared/time.js'
import { api, errorMessage } from '../api.js'
import { EmptyState, Loading, Notice, PageTitle } from '../components/ui.js'
import { notifyMatchesChanged } from '../lib/matches.js'

/** お知らせの一覧。押すと該当の取引・チャットを開き、既読にする */
export function Notifications() {
  const [items, setItems] = useState<NotificationDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems((await api<{ notifications: NotificationDto[] }>('/api/notifications')).notifications)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const markRead = async (body: { ids?: string[]; all?: boolean }) => {
    try {
      await api('/api/notifications', { method: 'PATCH', body })
      setItems((all) => all?.map((n) => (body.all || body.ids?.includes(n.id) ? { ...n, read: true } : n)) ?? null)
      notifyMatchesChanged()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  const unread = items?.filter((n) => !n.read).length ?? 0

  return (
    <>
      <PageTitle icon={Bell}>お知らせ</PageTitle>
      {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
      {!items && !error && <Loading label="読み込んでいます…" />}
      {items && items.length === 0 && (
        <EmptyState illust="🔔" title="お知らせはありません">
          <p>取引の提案・承認・新しいメッセージ・取引完了などがあると、ここに届きます。</p>
        </EmptyState>
      )}
      {items && items.length > 0 && (
        <>
          <div className="result-loc-head">
            <p>
              <strong>未読 {unread}件</strong>
            </p>
            <button type="button" className="btn btn-small" onClick={() => void markRead({ all: true })} disabled={unread === 0}>
              <CheckCheck aria-hidden="true" />
              すべて既読にする
            </button>
          </div>
          <ul className="notice-list">
            {items.map((n) => (
              <li key={n.id} className={n.read ? 'notice-item' : 'notice-item is-unread'}>
                <Link to={n.link} onClick={() => !n.read && void markRead({ ids: [n.id] })}>
                  <span className="notice-title">
                    {!n.read && <span className="visually-hidden">未読：</span>}
                    {n.title}
                  </span>
                  {n.body && <span className="muted">{n.body}</span>}
                  <time dateTime={new Date(n.createdAtMs).toISOString()}>{formatJstDateTime(n.createdAtMs)}</time>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}
