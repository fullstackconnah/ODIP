/**
 * PF-10.4 (SPEC-05) — small UI helpers shared across the Profile wizard's step components.
 * `react-refresh/only-export-components` requires a `.tsx` file to export nothing but components,
 * so plain data helpers live in the sibling `profileFormat.ts` instead — same split as the Intake
 * wizard's `intakeHelpers.tsx`/`intakeFormat.ts`.
 */
import { FormField } from '@/components/FormField'

/**
 * A Shared field (captured at Intake) — rendered read-only on Profile per PF-10.1's allocation
 * contract, never re-asked. Rendered as a disabled input carrying `id={field}` (same id convention
 * `register(field)` uses on an editable field) so the drift-guard test can locate it by field name
 * and assert it is not an editable control, without needing a second, parallel lookup convention.
 */
export function ReadOnlyField({ field, label, value, hint }: { field: string; label: string; value: string; hint?: string }) {
  return (
    <FormField label={label} hint={hint ?? 'Captured at Intake — read-only here'}>
      <input id={field} value={value} disabled readOnly aria-readonly="true" className="opacity-70 cursor-not-allowed" />
    </FormField>
  )
}

/** Same shape as ReadOnlyField, for a shared COLLECTION field (e.g. contactRoles) with no single
 * scalar value to display — wraps a caller-supplied summary in an `id`-bearing, aria-readonly
 * container instead of a disabled `<input>`. */
export function ReadOnlyGroupField({ field, label, children }: { field: string; label: string; children: React.ReactNode }) {
  return (
    <FormField label={label} hint="Captured at Intake — read-only here">
      <div id={field} aria-readonly="true" role="group" aria-label={label} className="text-sm text-[var(--color-muted-foreground)] p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-accent)]/40">
        {children}
      </div>
    </FormField>
  )
}
