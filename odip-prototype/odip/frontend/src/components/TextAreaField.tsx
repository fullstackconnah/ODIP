import type { ChangeEvent, ReactNode } from 'react'
import { FormField } from './FormField'

type CommonFieldProps = {
  label: ReactNode
  required?: boolean
  error?: string
  hint?: string
  className?: string
  descriptionId?: string
}

/**
 * Native `<textarea>` wrapped in `FormField` — the canonical multi-line free-text field.
 *
 * Forwards everything `FormField` supports plus the standard `<textarea>` attributes (rows,
 * placeholder, value/onChange, maxLength, readOnly, disabled, etc.). Use this instead of
 * hand-rolling a `<label>` + `<textarea>` + manual `inputClass` combo on every form — the
 * a11y wiring (label-for-id, aria-invalid, aria-describedby for hint/error) is identical to
 * `FormField`'s and is asserted by FormField's existing tests.
 *
 * Like `TextField` this composes straight through `FormField`; the only thing it adds is
 * rendering a `<textarea>` instead of an `<input>`. Caller passes `rows` as a normal prop.
 */
export type TextAreaFieldProps = CommonFieldProps & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & {
  /** Optional callback when the underlying `<textarea>` fires `change`. */
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void
}

export function TextAreaField({
  label,
  required,
  error,
  hint,
  className,
  descriptionId,
  ...textareaProps
}: TextAreaFieldProps) {
  return (
    <FormField
      label={label}
      required={required}
      error={error}
      hint={hint}
      className={className}
      descriptionId={descriptionId}
    >
      <textarea required={required} {...textareaProps} />
    </FormField>
  )
}
