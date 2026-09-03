/**
 * PF-10.3 — plain (non-component) data helpers for the Intake wizard, split out of
 * `intakeHelpers.tsx` so that file can stay component-only (`react-refresh/only-export-components`
 * — Fast Refresh requires a .tsx file to export nothing but components). Copied verbatim
 * (behaviour-preserving) from `ParticipantCreatePage.tsx`'s equivalent module-local helpers, since
 * that file is not modified by this branch (PF-10.7 retires it later) and none of these were
 * exported from it.
 */
import type { AxiosError } from 'axios'

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
