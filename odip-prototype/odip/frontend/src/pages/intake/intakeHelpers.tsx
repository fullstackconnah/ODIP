/**
 * PF-10.3 — small UI helpers (components only) shared across the Intake wizard's step
 * components. Copied verbatim (behaviour-preserving) from `the retired single-step wizard`'s
 * equivalent module-local helpers, since that file is not modified by this branch (PF-10.7
 * retires it later) and none of these were exported from it.
 *
 * Non-component helpers (boolToTriState/triStateToBool/focusField/extractErrorMessage) live in
 * the sibling `intakeFormat.ts` instead — `react-refresh/only-export-components` requires a
 * `.tsx` file to export nothing but components.
 */
import { Controller } from 'react-hook-form'
import type { Control, FieldPath } from 'react-hook-form'
import { Callout } from '@/components/Callout'
import { ToggleGroup } from '@/components/ToggleGroup'
import { FormField } from '@/components/FormField'
import type { ParticipantFormData } from '@/lib/participantSchema'

const YES_NO_UNANSWERED_OPTIONS = [
  { key: 'true', label: 'Yes' },
  { key: 'false', label: 'No' },
  { key: '', label: 'Not recorded' },
]

/**
 * A Yes/No/Not-recorded ToggleGroup bound to a tri-state string field via Controller — same
 * three-explicit-options shape as the retired single-step wizard's YesNoToggleField, so a compliance
 * flag can always go back to "not recorded", never silently sticks on its last answer.
 */
export function YesNoToggleField({ control, name, label, hint, ariaLabel, hideLabel }: {
  control: Control<ParticipantFormData>
  name: FieldPath<ParticipantFormData>
  label: string
  hint?: string
  ariaLabel?: string
  hideLabel?: boolean
}) {
  const toggle = (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <ToggleGroup
          options={YES_NO_UNANSWERED_OPTIONS}
          value={(field.value as string) ?? ''}
          onChange={field.onChange}
          ariaLabel={ariaLabel ?? label}
        />
      )}
    />
  )
  if (hideLabel) return toggle
  return (
    <FormField label={label} hint={hint} className="mb-0">
      {toggle}
    </FormField>
  )
}

/**
 * PF-2's advisory, never-dismissable plan-type/contact-role compliance banner — same visual
 * treatment as the retired single-step wizard's PlanTypeComplianceBanner. Renders nothing when
 * `message` is null.
 */
export function PlanTypeComplianceBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return <Callout tone="warning" polite>{message}</Callout>
}
