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
 * Native `<input>` wrapped in `FormField` — the canonical single-line text field.
 *
 * Forwards everything `FormField` supports plus the standard `<input>` attributes (type,
 * placeholder, value/onChange, autoComplete, inputMode, maxLength, min/max/step for the
 * numeric variants, etc.). Use this instead of hand-rolling a `<label>` + `<input>` + manual
 * `inputClass` combo on every form — the a11y wiring (label-for-id, aria-invalid, aria-
 * describedby for hint/error) is identical to `FormField`'s and is asserted by FormField's
 * existing tests.
 */
export type TextFieldProps = CommonFieldProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> & {
  /** Defaults to "text". Pass "email", "tel", "number", "date", etc. for specialised inputs. */
  type?: React.InputHTMLAttributes<HTMLInputElement>['type']
  /** Optional callback when the underlying `<input>` fires `change`. */
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
}

export function TextField({
  label,
  required,
  error,
  hint,
  className,
  descriptionId,
  type = 'text',
  ...inputProps
}: TextFieldProps) {
  return (
    <FormField
      label={label}
      required={required}
      error={error}
      hint={hint}
      className={className}
      descriptionId={descriptionId}
    >
      {/* `required` also goes on the control: FormField only draws the star and sets aria-required, so a plain form lost the browser's own check. */}
      <input type={type} required={required} {...inputProps} />
    </FormField>
  )
}
