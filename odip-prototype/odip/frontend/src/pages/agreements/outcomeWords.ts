import type { AgreementApproveOutcome, AgreementApproveResult } from '@/api/types'
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

export const TOO_MANY_WORDS = 'Too many requests just now. Wait a minute, then try again.'

const names = (list: AgreementApproveResult[]) => {
  const n = list.map(r => r.participantName)
  return n.length <= 3 ? n.join(', ') : `${n.slice(0, 3).join(', ')} and ${n.length - 3} more`
}

/** The notice after a run: what was approved, then what needs the person (up to three names each). */
export function summarise(results: readonly AgreementApproveResult[], notSent = 0): { tone: 'success' | 'danger'; title: string; message: string } {
  const by = (o: AgreementApproveOutcome) => results.filter(r => r.outcome === o)
  const approved = by('Approved').length
  const review = by('NeedsReview')
  const busy = by('Busy')
  const other = results.filter(r => !['Approved', 'AlreadyApproved', 'NeedsReview', 'Busy'].includes(r.outcome))
  const parts = [
    review.length ? `${review.length} need review: ${names(review)}.` : '',
    busy.length ? `${busy.length} ${busy.length === 1 ? 'was' : 'were'} busy: try again.` : '',
    other.length ? `${other.length} could not be approved: ${names(other)}.` : '',
    notSent ? `${notSent} ${notSent === 1 ? "wasn't" : "weren't"} started.` : '',
  ].filter(Boolean)
  return {
    tone: approved > 0 ? 'success' : 'danger',
    title: approved > 0 ? `${approved} approved.` : 'Nothing was approved.',
    message: parts.join(' '),
  }
}
