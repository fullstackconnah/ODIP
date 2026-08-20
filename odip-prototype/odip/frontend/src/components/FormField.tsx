import { isValidElement, cloneElement, useId, type ReactElement, type ReactNode } from 'react'

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

type EnhancedChildProps = {
  className?: string
  id?: string
  'aria-required'?: 'true'
  'aria-invalid'?: 'true'
  'aria-describedby'?: string
}

export function FormField({ label, required, error, hint, layout = 'default', className, children }: FormFieldProps) {
  const generatedId = useId()
  const existingId = isValidElement(children) ? (children.props as { id?: string }).id : undefined
  const fieldId = existingId ?? generatedId

  // Checkbox/radio inputs bring their own w-4 h-4 sizing; inputClass's w-full would blow
  // that up to the width of the field, ballooning the clickable/visual hit area.
  const isCheckboxOrRadio = isValidElement(children)
    && children.type === 'input'
    && ['checkbox', 'radio'].includes((children.props as { type?: string }).type ?? '')

  if (layout === 'checkbox') {
    const hintId = hint ? `${fieldId}-hint` : undefined
    const checkboxChild = hintId && isValidElement(children)
      ? cloneElement(children as ReactElement<EnhancedChildProps>, { 'aria-describedby': hintId })
      : children
    return (
      <div className={className}>
        <label className="flex items-center gap-3 py-1">
          {checkboxChild}
          <span className="text-sm text-[var(--color-foreground)]">
            {label}{required && ' *'}
          </span>
        </label>
        {hint && <p id={hintId} className="text-xs text-[var(--color-muted-foreground)] mt-1 ml-7">{hint}</p>}
      </div>
    )
  }

  const hintId = `${fieldId}-hint`
  const errorId = `${fieldId}-error`
  const showHint = !!hint && !error
  const showError = !!error
  const describedBy = [showHint && hintId, showError && errorId].filter(Boolean).join(' ') || undefined

  const enhanced = isValidElement(children)
    && typeof children.type === 'string'
    && NATIVE_INPUTS.includes(children.type)
    && !isCheckboxOrRadio
    ? cloneElement(children as ReactElement<EnhancedChildProps>, {
        className: `${inputClass} ${(children.props as { className?: string }).className ?? ''}`,
        ...(existingId ? {} : { id: fieldId }),
        ...(required ? { 'aria-required': 'true' } : {}),
        ...(error ? { 'aria-invalid': 'true' } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })
    : children

  return (
    <div className={className}>
      <label className={labelClass} htmlFor={fieldId}>
        {label}{required && ' *'}
      </label>
      {enhanced}
      {showHint && <p id={hintId} className="text-xs text-[var(--color-muted-foreground)] mt-1">{hint}</p>}
      {showError && <p id={errorId} className="text-xs text-[var(--color-destructive)] mt-1">{error}</p>}
    </div>
  )
}
