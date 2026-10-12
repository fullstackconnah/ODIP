import { formatWithTimeZone } from './utils'

type Revision = { version: number; approval?: { approvedAt: string; approvedByName: string } }

const day = (instant: string) => formatWithTimeZone(instant, undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** One line for each time the agreement was approved for rostering, newest first: "Approved 3 Oct 2026 by Alex. Replaced 9 Oct 2026." (an approval is replaced by the next one). */
export function approvalHistory(revisions: readonly Revision[]): string[] {
  const approved = revisions.filter(revision => revision.approval).sort((a, b) => a.version - b.version)
  return approved.map((revision, index) => {
    const { approvedAt, approvedByName } = revision.approval!
    const next = approved[index + 1]?.approval
    return `Approved ${day(approvedAt)} by ${approvedByName}.${next ? ` Replaced ${day(next.approvedAt)}.` : ''}`
  }).reverse()
}
