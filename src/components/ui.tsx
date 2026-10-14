import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'

export function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string
  required?: boolean
  hint?: ReactNode
  error?: string
  children: ReactNode
}) {
  return (
    <div className={error ? 'field field-invalid' : 'field'}>
      <div className="field-label">
        <span>{label}</span>
        {required ? <span className="tag tag-required">必須</span> : <span className="tag tag-optional">任意</span>}
      </div>
      {children}
      {hint && <p className="field-hint">{hint}</p>}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

const NOTICE_ICON: Record<'info' | 'warn' | 'error' | 'success', LucideIcon> = {
  info: Info,
  warn: AlertTriangle,
  error: XCircle,
  success: CheckCircle2,
}

/** お知らせ。種類は色だけでなくアイコンでも示す。 */
export function Notice({
  kind = 'info',
  title,
  children,
}: {
  kind?: 'info' | 'warn' | 'error' | 'success'
  title?: string
  children?: ReactNode
}) {
  const Icon = NOTICE_ICON[kind]
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="notice-icon" aria-hidden="true">
        <Icon />
      </span>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  )
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="loading" aria-busy="true" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{label}</p>
    </div>
  )
}

/** 一覧が空のときの案内。何をすればよいかを必ず添える。 */
export function EmptyState({ illust = '🌱', title, children, action }: { illust?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-illust" aria-hidden="true">
        {illust}
      </span>
      <p className="empty-title">{title}</p>
      {children}
      {action}
    </div>
  )
}

/** ページの見出し（アイコン付き）。画面を開いたときの読み上げの起点にもする。 */
export function PageTitle({ icon: Icon, children }: { icon?: LucideIcon; children: ReactNode }) {
  return (
    <h1 className="page-title">
      {Icon && (
        <span className="page-title-icon" aria-hidden="true">
          <Icon />
        </span>
      )}
      <span>{children}</span>
    </h1>
  )
}

/** 2〜3択を大きなボタンで選ぶ */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | null
  options: { value: T; label: string; sub?: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'choice-item is-selected' : 'choice-item'}
          onClick={() => onChange(o.value)}
        >
          <span>{o.label}</span>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  )
}

/** モーダルの確認ダイアログ（ブラウザ標準の dialog 要素。Esc で閉じ、フォーカスを閉じ込める） */
export function Dialog({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={labelledBy} onClose={onClose} onCancel={onClose}>
      {open && <div className="dialog-body">{children}</div>}
    </dialog>
  )
}

const ITEM_EMOJI: Record<string, string> = {
  トマト: '🍅',
  ミニトマト: '🍅',
  なす: '🍆',
  きゅうり: '🥒',
  ピーマン: '🫑',
  小松菜: '🥬',
  ほうれん草: '🥬',
  水菜: '🥬',
  キャベツ: '🥬',
  白菜: '🥬',
  レタス: '🥬',
  大根: '🥕',
  にんじん: '🥕',
  玉ねぎ: '🧅',
  じゃがいも: '🥔',
  さつまいも: '🍠',
  かぼちゃ: '🎃',
  ねぎ: '🌿',
  米: '🌾',
  栗: '🌰',
}

/** 品目のイラスト（絵文字）。読み上げでは品目名を別に伝えるので、装飾として扱う。 */
export function itemEmoji(name: string): string {
  return ITEM_EMOJI[name] ?? '🧺'
}

export function ItemIcon({ name }: { name: string }) {
  return (
    <span className="item-emoji" aria-hidden="true">
      {itemEmoji(name)}
    </span>
  )
}
