/**
 * PF-10.3 — small UI/data helpers shared across the Intake wizard's step components. Copied
 * verbatim (behaviour-preserving) from `ParticipantCreatePage.tsx`'s equivalent module-local
 * helpers, since that file is not modified by this branch (PF-10.7 retires it later) and none of
 * these were exported from it.
 */
import { Controller } from 'react-hook-form'
import type { Control, FieldPath } from 'react-hook-form'
import type { AxiosError } from 'axios'
import { AlertTriangle } from 'lucide-react'
import { ToggleGroup } from '@/components/ToggleGroup'
import { FormField } from '@/components/FormField'
import type { ParticipantFormData } from '@/lib/participantSchema'

/** boolean|null (the wire shape) -> the wizard's tri-state string shape, for reset()'s round-trip. */
export function boolToTriState(value: boolean | null | undefined): 'true' | 'false' | '' {
  return value === true ? 'true' : value === false ? 'false' : ''
}

/** The tri-state string shape -> boolean|null (the wire shape), for buildIntakePayload. */
export function triStateToBool(value: string | undefined): boolean | null {
  return value === 'true' ? true : value === 'false' ? false : null
}

export function focusField(fieldName: string) {
  const el = document.getElementById(fieldName)
  if (el instanceof HTMLElement) el.focus()
}

/** Surfaces the server's ApiResponse error message for the Save-as-draft banner, same shape as
 * ParticipantCreatePage.tsx's extractErrorMessage. */
export function extractErrorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ message?: string; errors?: string[] }>
  return axiosErr?.response?.data?.errors?.[0] || axiosErr?.response?.data?.message || fallback
}

const YES_NO_UNANSWERED_OPTIONS = [
  { key: 'true', label: 'Yes' },
  { key: 'false', label: 'No' },
  { key: '', label: 'Not recorded' },
]

/**
 * A Yes/No/Not-recorded ToggleGroup bound to a tri-state string field via Controller — same
 * three-explicit-options shape as ParticipantCreatePage.tsx's YesNoToggleField, so a compliance
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
 * treatment as ParticipantCreatePage.tsx's PlanTypeComplianceBanner. Renders nothing when
 * `message` is null.
 */
export function PlanTypeComplianceBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <div
      role="status"
      className="flex items-start gap-2 p-3 rounded-lg bg-[var(--color-warning-container)] text-[var(--color-on-warning-container)] text-sm border border-[var(--color-on-warning-container)]/20"
    >
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}
