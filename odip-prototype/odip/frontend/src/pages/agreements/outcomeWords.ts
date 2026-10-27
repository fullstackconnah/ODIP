import type { AgreementApproveOutcome, AgreementApproveResult } from '@/api/types'
import { plural } from '@/lib/format'
import type { Tone } from '@/lib/tone'

/** The badge each outcome gets in the result list. Approved ones are counted, not listed. */
export const OUTCOME_BADGE: Record<AgreementApproveOutcome, { tone: Tone; label: string }> = {
  Approved: { tone: 'success', label: 'Approved' },
  AlreadyApproved: { tone: 'neutral', label: 'Already approved' },
  NeedsReview: { tone: 'warning', label: 'Needs review' },
  Superseded: { tone: 'neutral', label: 'Replaced by a newer draft' },
  Ended: { tone: 'danger', label: 'Agreement ended' },
  Busy: { tone: 'warning', label: 'Roster busy: try again' },
  NotAnApprover: { tone: 'danger', label: "You can't approve this" },
  NotFound: { tone: 'neutral', label: 'No longer there' },
  Failed: { tone: 'danger', label: 'Not approved: try again' },
}

export const ALREADY_APPROVED = 'These were already approved.'
export const NO_REPLY_LAST = (n: number) => `No answer came back for the last ${n}: some may have been approved.`
export const NO_REPLY_WORDS = "We didn't hear back, so some of these may have been approved. Refresh to check before trying again."
export const NOT_AN_APPROVER_WORDS = "Your role can't approve agreements in your organisation. An Admin can change who may approve, in Settings, Plan pricing."
export const TOO_MANY_WORDS = 'Too many requests just now. Wait a minute, then try again.'

const names = (list: AgreementApproveResult[]) => {
  const n = list.map(r => r.participantName)
  return n.length <= 3 ? n.join(', ') : `${n.slice(0, 3).join(', ')} and ${n.length - 3} more`
}

/** The notice after a run: what was approved, then what needs the person (up to three names each). Partial runs use the 'danger' notice tone, which the notices region draws as the house warning. */
export function summarise(results: readonly AgreementApproveResult[], notSent = 0, noReply = false): { tone: 'success' | 'danger' | 'info'; title: string; message: string } {
  const by = (o: AgreementApproveOutcome) => results.filter(r => r.outcome === o)
  const approved = by('Approved').length
  const review = by('NeedsReview')
  const busy = by('Busy')
  const other = results.filter(r => !['Approved', 'AlreadyApproved', 'NeedsReview', 'Busy'].includes(r.outcome))
  const parts = [
    review.length ? `${review.length} need review: ${names(review)}.` : '',
    busy.length ? `${busy.length} ${busy.length === 1 ? 'was' : 'were'} busy: try again.` : '',
    other.length ? `${other.length} could not be approved: ${names(other)}.` : '',
    notSent ? (noReply ? NO_REPLY_LAST(notSent) : `${notSent} ${notSent === 1 ? "wasn't" : "weren't"} started.`) : '',
  ].filter(Boolean)
  if (approved === 0 && results.length > 0 && results.every(r => r.outcome === 'AlreadyApproved') && !notSent) {
    return { tone: 'info', title: ALREADY_APPROVED, message: '' }
  }
  return {
    tone: approved > 0 && !parts.length ? 'success' : 'danger',
    title: approved > 0 ? `${approved} approved.` : 'Nothing was approved.',
    message: parts.join(' '),
  }
}

/** The dialog's heading after a run, and the line under it. `total` is how many were sent, so the ones never sent count as not approved. */
export function resultHeading(results: readonly AgreementApproveResult[], total: number): { title: string; line: string | null; danger: boolean } {
  const approved = results.filter(r => r.outcome === 'Approved').length
  const already = results.filter(r => r.outcome === 'AlreadyApproved').length
  const failed = results.filter(r => r.outcome !== 'Approved' && r.outcome !== 'AlreadyApproved').length
  if (failed === 0 && results.length === total) {
    return approved === 0 ? { title: ALREADY_APPROVED, line: null, danger: false } : { title: `${plural(approved, 'agreement')} approved`, line: null, danger: false }
  }
  if (approved === 0) return { title: 'Nothing was approved.', line: failed ? 'Each row says why.' : null, danger: true }
  const parts = [failed && `${failed} ${failed === 1 ? "wasn't" : "weren't"} approved`, already && `${already} ${already === 1 ? 'was' : 'were'} already approved`].filter(Boolean)
  return {
    title: `${approved} of ${total} approved`,
    line: failed || already ? `${parts.join(', and ')}. ${failed === 1 && !already ? 'The row says' : 'Each row says'} why.` : null,
    danger: false,
  }
}

const GROUP: Partial<Record<AgreementApproveOutcome, number>> = { NeedsReview: 0, Busy: 1, AlreadyApproved: 3 }

/** The rows the dialog lists: needs review, roster busy, other failures, already approved last; by name within each. The approved are counted, not listed. */
export function groupResults(results: readonly AgreementApproveResult[]): AgreementApproveResult[] {
  const rank = (r: AgreementApproveResult) => GROUP[r.outcome] ?? 2
  return results.filter(r => r.outcome !== 'Approved').sort((a, b) => rank(a) - rank(b) || a.participantName.localeCompare(b.participantName))
}
