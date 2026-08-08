import { isValidElement, cloneElement, type ReactNode } from 'react'

export type FormFieldProps = {
  label: ReactNode
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
  // Checkbox/radio inputs bring their own w-4 h-4 sizing; inputClass's w-full would blow
  // that up to the width of the field, ballooning the clickable/visual hit area.
  const isCheckboxOrRadio = isValidElement(children)
    && children.type === 'input'
    && ['checkbox', 'radio'].includes((children.props as { type?: string }).type ?? '')

  const enhanced = isValidElement(children)
    && typeof children.type === 'string'
    && NATIVE_INPUTS.includes(children.type)
    && !isCheckboxOrRadio
    ? cloneElement(children as React.ReactElement<{ className?: string }>, {
        className: `${inputClass} ${(children.props as { className?: string }).className ?? ''}`
      })
    : children

  if (layout === 'checkbox') {
    return (
      <div className={className}>
        <label className="flex items-center gap-3 py-1">
          {enhanced}
          <span className="text-sm text-[var(--color-foreground)]">
            {label}{required && ' *'}
          </span>
        </label>
        {hint && <p className="text-xs text-[var(--color-muted-foreground)] mt-1 ml-7">{hint}</p>}
      </div>
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
