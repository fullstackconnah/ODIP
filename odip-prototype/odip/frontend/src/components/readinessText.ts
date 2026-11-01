/**
 * The note's words, in one place: `text` is what it prints, `title` adds the refusal sentence in Enforce. Null when nothing is missing and nothing is enforced.
 * The roster board's ReadinessTrigger reads its accessible name and panel from this too.
 */
export function readinessText(issues: readonly string[] | null | undefined, blocked = false): { text: string; title: string } | null {
  const reasons = issues && issues.length > 0 ? issues.join(' · ') : null
  if (!blocked && !reasons) return null
  // In Enforce the server refuses new shifts and assignments, so the note says so (the brief, section 6). The note itself still disables nothing: the server refuses.
  const text = blocked ? `Not ready for rostering${reasons ? `: ${reasons}` : ''}` : `Not ready: ${reasons}`
  return { text, title: blocked ? `${text}. New shifts and assignments are refused until this is done.` : text }
}
