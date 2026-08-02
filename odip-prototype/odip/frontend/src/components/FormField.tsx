import { isValidElement, cloneElement, type ReactNode } from 'react'

export type FormFieldProps = {
  label: string
  required?: boolean
  error?: string
  hint?: string
  layout?: 'default' | 'checkbox'
  className?: string
  children: ReactNode
}

export const inputClass = 'w-full px-4 py-2.5 rounded-lg bg-[var(--color-input)] border border-[var(--color-border)] text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] transition-shadow'
export const labelClass = 'block text-sm font-medium mb-1.5 text-[var(--color-muted-foreground)]'

const NATIVE_INPUTS = ['input', 'select', 'textarea']

export function FormField({ label, required, error, hint, layout = 'default', className, children }: FormFieldProps) {
  const enhanced = isValidElement(children)
    && typeof children.type === 'string'
    && NATIVE_INPUTS.includes(children.type)
    ? cloneElement(children as React.ReactElement<{ className?: string }>, {
        className: `${inputClass} ${(children.props as { className?: string }).className ?? ''}`
      })
    : children

  if (layout === 'checkbox') {
    return (
      <label className={`flex items-center gap-3 py-1 ${className ?? ''}`}>
        {enhanced}
        <span className="text-sm text-[var(--color-foreground)]">
          {label}{required && ' *'}
        </span>
      </label>
    )
  }

  return (
    <div className={className}>
      <label className={labelClass}>
        {label}{required && ' *'}
      </label>
      {enhanced}
      {hint && !error && <p className="text-xs text-[var(--color-muted-foreground)] mt-1">{hint}</p>}
      {error && <p className="text-xs text-[var(--color-destructive)] mt-1">{error}</p>}
    </div>
  )
}
