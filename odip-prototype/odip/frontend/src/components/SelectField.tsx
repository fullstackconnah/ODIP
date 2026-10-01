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

export type SelectFieldOption = {
  value: string
  label: string
  disabled?: boolean
}

/**
 * Native `<select>` wrapped in `FormField`. Use instead of hand-rolling the label/input
 * className combo on every form. The a11y wiring (htmlFor/id, aria-invalid, aria-describedby)
 * is the same one `FormField` applies to every native child.
 *
 * Options are passed via `options` rather than `<option>` children so the call sites stay
 * short and consistent across the app. For more exotic needs (optgroups, rich options)
 * fall back to `<FormField><select>…</select></FormField>` directly.
 */
export type SelectFieldProps = CommonFieldProps & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'> & {
  options: SelectFieldOption[]
  /** Optional placeholder shown as a disabled empty option at the top of the list. */
  placeholder?: string
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void
}

export function SelectField({
  label,
  required,
  error,
  hint,
  className,
  descriptionId,
  options,
  placeholder,
  ...selectProps
}: SelectFieldProps) {
  return (
    <FormField
      label={label}
      required={required}
      error={error}
      hint={hint}
      className={className}
      descriptionId={descriptionId}
    >
      <select required={required} {...selectProps}>
        {placeholder !== undefined && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options.map(opt => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
    </FormField>
  )
}
