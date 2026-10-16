import { Flag } from 'lucide-react'
import { useId, useState } from 'react'
import type { ReportReason, ReportTargetType } from '../../shared/dto.js'
import { api, ApiError, errorMessage } from '../api.js'
import { Dialog, Field, Notice } from './ui.js'

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  FALSE_INFO: '虚偽または不正確な情報',
  INAPPROPRIATE: '不適切な内容',
  NUISANCE: '迷惑行為',
  FRAUD: '詐欺・不正取引の疑い',
  OTHER: 'その他',
}

const TARGET_LABEL: Record<ReportTargetType, string> = { LISTING: 'この出品', PRODUCER: 'この生産者', RESTAURANT: 'この飲食店' }

/**
 * 通報メニュー。理由の選択 → 内容の確認 → 送信 → 受付完了 の順に進む。
 * 通報したことは、通報された側には知らされない。
 */
export function ReportButton({ target }: { target: { type: ReportTargetType; id: string; label: string } }) {
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form')
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [detail, setDetail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setOpen(false)
    setStep('form')
    setReason(null)
    setDetail('')
    setError(null)
  }
  const next = () => {
    if (!reason) return setError('通報の理由を選んでください。')
    if (reason === 'OTHER' && !detail.trim()) return setError('「その他」を選んだ場合は、詳細を入力してください。')
    setError(null)
    setStep('confirm')
  }
  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      await api('/api/reports', { body: { targetType: target.type, targetId: target.id, reason, detail: detail.trim() || undefined } })
      setStep('done')
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'DUPLICATE' ? e.message : errorMessage(e))
      if (e instanceof ApiError && e.code === 'DUPLICATE') setStep('done')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="report-link" onClick={() => setOpen(true)}>
        <Flag aria-hidden="true" />
        {TARGET_LABEL[target.type]}を通報
      </button>
      <Dialog open={open} onClose={close} labelledBy={titleId}>
        <h2 id={titleId} className="dialog-title">
          <Flag aria-hidden="true" />
          {TARGET_LABEL[target.type]}を通報
        </h2>
        <p className="muted">対象：{target.label}</p>

        {step === 'form' && (
          <>
            <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
              <legend className="field-label">
                通報の理由 <span className="tag tag-required">必須</span>
              </legend>
              {(Object.keys(REPORT_REASON_LABEL) as ReportReason[]).map((r) => (
                <label key={r} className="check check-box">
                  <input type="radio" name={`${titleId}-reason`} checked={reason === r} onChange={() => setReason(r)} />
                  <span>{REPORT_REASON_LABEL[r]}</span>
                </label>
              ))}
            </fieldset>
            <Field label="詳細" required={reason === 'OTHER'} hint="気づいた点を具体的に書いてください（500文字以内）。">
              <textarea className="input" rows={4} maxLength={500} value={detail} onChange={(e) => setDetail(e.target.value)} />
            </Field>
            {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={next}>
                内容を確認する
              </button>
              <button type="button" className="btn btn-quiet" onClick={close}>
                やめる
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <dl className="meta">
              <div>
                <dt>理由</dt>
                <dd>{reason && REPORT_REASON_LABEL[reason]}</dd>
              </div>
              <div>
                <dt>詳細</dt>
                <dd>{detail.trim() || '（なし）'}</dd>
              </div>
            </dl>
            <p className="field-hint">送信すると、運営者が内容を確認します。通報したことは相手には知らされません。通報だけで自動的に停止されることはありません。</p>
            {error && <Notice kind="error">{<p>{error}</p>}</Notice>}
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={send} disabled={busy}>
                {busy ? '送信中…' : 'この内容で通報する'}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setStep('form')} disabled={busy}>
                戻って直す
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <Notice kind={error ? 'info' : 'success'} title={error ? '受付済みです' : '通報を受け付けました'}>
              <p>{error ?? '運営者が内容を確認します。ご協力ありがとうございました。'}</p>
            </Notice>
            <button type="button" className="btn btn-block" onClick={close}>
              閉じる
            </button>
          </>
        )}
      </Dialog>
    </>
  )
}
