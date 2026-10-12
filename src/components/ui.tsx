import type { ReactNode } from 'react'

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

export function Notice({
  kind = 'info',
  title,
  children,
}: {
  kind?: 'info' | 'warn' | 'error' | 'success'
  title?: string
  children?: ReactNode
}) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  )
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="loading" aria-busy="true" aria-live="polite">
      <div className="spinner" />
      <p>{label}</p>
    </div>
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
