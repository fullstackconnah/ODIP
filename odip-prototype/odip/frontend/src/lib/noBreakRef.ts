/** Swaps the hyphens inside a claim or invoice reference (TC-20261022-0003, INV-0042) for non-breaking ones, so server text never wraps mid-reference. */
export function noBreakRefs(text: string): string {
  return text.replace(/\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b/g, ref => ref.replace(/-/g, '\u2011'))
}
