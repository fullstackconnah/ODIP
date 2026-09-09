/**
 * PF-10.3 — plain (non-component) data helpers for the Intake wizard, split out of
 * `intakeHelpers.tsx` so that file can stay component-only (`react-refresh/only-export-components`
 * — Fast Refresh requires a .tsx file to export nothing but components). Copied verbatim
 * (behaviour-preserving) from `the retired single-step wizard`'s equivalent module-local helpers, since
 * that file is not modified by this branch (PF-10.7 retires it later) and none of these were
 * exported from it.
 */
import { extractErrorMessage } from '@/lib/utils'

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
 * the retired single-step wizard's extractErrorMessage. Re-exported from the shared
 * `@/lib/utils` implementation so this module's existing callers keep working unchanged. */
export { extractErrorMessage }
