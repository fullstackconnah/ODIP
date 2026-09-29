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
 * Native `<input type="checkbox">` wrapped in `FormField` with `layout="checkbox"`.
 *
 * The control sits to the *left* of its label, matching the call-site DOM the rest of the
 * codebase already uses (see MedicationFormPage, IncidentDetailsStep, Intake's
 * SupportNeedsStep, etc.) — migrating to this primitive must not visually shift the layout.
 * `FormField`'s checkbox layout wraps the `<input>` + label text in a single `<label>` so the
 * entire row is one click/tap target (≥44px tall, WCAG 2.5.5) and the input's accessible
 * name resolves from the associated label.
 *
 * Forwards everything `FormField` supports plus the standard `<input>` attributes
 * (`name`/`onChange`/`onBlur`/`ref` from react-hook-form's `register`, plus `disabled`,
 * `readOnly`, etc.). ClassName stays on the inner `<input>` because `FormField`'s checkbox
 * branch deliberately skips the `inputClass` `w-full` blow-out that the default layout
 * applies to native inputs.
 *
 * Errors are not the typical a11y story for a checkbox (a checkbox is rarely "required" in
 * the same error-message sense as a text input), but the field still accepts `error`/`hint`
 * to keep the prop surface identical to `TextField`/`TextAreaField`/`SelectField`. If a
 * caller needs to surface a validation message for a single checkbox, prefer pairing the
 * checkbox with `error` rather than reaching for an ad-hoc alert element.
 */
export type CheckboxFieldProps = CommonFieldProps & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className' | 'type'> & {
  /** Optional callback when the underlying checkbox fires `change`. */
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void
}

export function CheckboxField({
  label,
  required,
  error,
  hint,
  className,
  descriptionId,
  ...inputProps
}: CheckboxFieldProps) {
  return (
    <FormField
      label={label}
      required={required}
      error={error}
      hint={hint}
      className={className}
      descriptionId={descriptionId}
      layout="checkbox"
    >
      <input type="checkbox" {...inputProps} />
    </FormField>
  )
}
