/**
 * Builds the `aria-label` a nav link carries when it shows a `NavCountBadge` — `undefined` when
 * there's nothing pending, so callers can pass it straight through without an extra conditional.
 * Split out of `NavCountBadge.tsx` (rather than co-located, as originally spec'd) because
 * `react-refresh/only-export-components` requires a `.tsx` file to export nothing but
 * components — see the same split already applied to `intakeFormat.ts`/`intakeHelpers.tsx` and
 * `profileHelpers.tsx`.
 */
export function navBadgeLabel(count: number, noun: string, label: string): string | undefined {
  if (count <= 0) return undefined
  return `${count} ${noun}${count === 1 ? '' : 's'} pending, ${label}`
}
