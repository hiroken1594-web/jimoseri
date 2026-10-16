import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react'
import { Children, cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react'

const FORM_TAGS = new Set(['input', 'select', 'textarea'])

/** 子要素の中の最初の入力欄に、見出し・説明・エラーとの結び付け（id・aria-describedby・aria-invalid）を付ける */
function connectInput(children: ReactNode, id: string, describedBy: string | undefined, invalid: boolean): { node: ReactNode; connected: boolean } {
  let connected = false
  const visit = (node: ReactNode): ReactNode =>
    Children.map(node, (child) => {
      if (connected || !isValidElement(child)) return child
      const element = child as ReactElement<Record<string, unknown>>
      if (typeof element.type === 'string' && FORM_TAGS.has(element.type)) {
        connected = true
        return cloneElement(element, {
          id: (element.props.id as string | undefined) ?? id,
          'aria-describedby': [element.props['aria-describedby'], describedBy].filter(Boolean).join(' ') || undefined,
          'aria-invalid': invalid || undefined,
        })
      }
      if (typeof element.type === 'string' && element.props.children) {
        return cloneElement(element, {}, visit(element.props.children as ReactNode))
      }
      return child
    })
  const result = visit(children)
  return { node: result, connected }
}

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
  const baseId = useId()
  const hintId = hint ? `${baseId}-hint` : undefined
  const errorId = error ? `${baseId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const { node, connected } = connectInput(children, `${baseId}-input`, describedBy, Boolean(error))
  // 入力欄があれば <label for> で結び付ける。ボタンの選択肢などは、それぞれに名前を付けている。
  const LabelTag = connected ? 'label' : 'div'
  return (
    <div className={error ? 'field field-invalid' : 'field'}>
      <LabelTag className="field-label" {...(connected ? { htmlFor: findId(node) ?? `${baseId}-input` } : {})}>
        <span>{label}</span>
        {required ? <span className="tag tag-required">必須</span> : <span className="tag tag-optional">任意</span>}
      </LabelTag>
      {node}
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert" id={errorId}>
          {error}
        </p>
      )}
    </div>
  )
}

/** 結び付けた入力欄の id を探す（呼び出し側が id を指定している場合はそれを使う） */
function findId(node: ReactNode): string | undefined {
  let found: string | undefined
  Children.forEach(node, (child) => {
    if (found || !isValidElement(child)) return
    const element = child as ReactElement<Record<string, unknown>>
    if (typeof element.type === 'string' && FORM_TAGS.has(element.type)) found = element.props.id as string | undefined
    else if (element.props.children) found = findId(element.props.children as ReactNode)
  })
  return found
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
