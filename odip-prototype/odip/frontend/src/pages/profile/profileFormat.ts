/**
 * PF-10.4 (SPEC-05) — plain (non-component) data helpers for the Profile wizard, split out of
 * `profileHelpers.tsx` so that file can stay component-only (same `.tsx`/`.ts` split as the Intake
 * wizard's `intakeHelpers.tsx`/`intakeFormat.ts`). The tri-state boolean<->string round-trip
 * helpers (`boolToTriState`/`triStateToBool`), `focusField`, and `extractErrorMessage` are reused
 * directly from `../intake/intakeFormat` rather than duplicated here — see ProfileWizardPage.tsx.
 */

/** Read-only display for a tri-state ('true' | 'false' | '' | undefined) field — same convention
 * as IntakeWizardPage.tsx's own yesNoUnknown. */
export function yesNoUnknown(value: string | null | undefined): string {
  return value === 'true' ? 'Yes' : value === 'false' ? 'No' : 'Not recorded'
}
