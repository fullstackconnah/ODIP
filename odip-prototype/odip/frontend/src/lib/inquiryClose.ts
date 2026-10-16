// Closing and reopening an enquiry (spec addendum E1-E4, SHAPE.md section 11): the outcomes' words, what a close will do, and the notices after.
// Pure and JSX-free.
import type { CloseInquiryResultDto, InquiryCloseOutcome, ParticipantInquiryDto } from '@/api/types/inquiries'
import { DEFAULT_DURATION, FALLBACK_ZONE, isPastVisit, notSentReason, unbroken, visitWhen } from '@/lib/intakeBooking'

/** The outcome as the table and the notices say it. */
export const CLOSE_OUTCOME_LABELS: Record<InquiryCloseOutcome, string> = {
  DeclinedByUs: 'Declined by us',
  NotGoingAhead: 'Not going ahead',
  Other: 'Other',
}

/** The dialog's choices: "their decision" says whose call it was. */
export const CLOSE_OUTCOME_OPTIONS: { value: InquiryCloseOutcome; label: string }[] = [
  { value: 'DeclinedByUs', label: 'Declined by us' },
  { value: 'NotGoingAhead', label: 'Not going ahead (their decision)' },
  { value: 'Other', label: 'Other' },
]

/** The Close dialog's "what happens", only the sentences that apply. */
export function closeConsequences(row: ParticipantInquiryDto, { unsaved }: { unsaved: boolean }): string[] {
  const lines: string[] = []
  if (row.intakeStartsAt && !isPastVisit(row.intakeStartsAt, row.intakeDurationMinutes ?? DEFAULT_DURATION)) {
    const staff = row.intakeStaffFirstName ?? 'the staff member'
    lines.push(`Closing cancels the intake visit on ${unbroken(visitWhen(row.intakeStartsAt, row.timeZoneId || FALLBACK_ZONE))}.`)
    // IntakeCancelDialog's own sentences: the server cancels it the same way.
    lines.push(row.intakeInviteSentAt
      ? `We'll email ${row.firstName} a cancellation, and it comes off ${staff}'s schedule.`
      : `No invite went out, so nobody is emailed. The visit comes off ${staff}'s schedule.`)
  }
  lines.push("Closing deletes any contacts on it. You can reopen it later, but they'd need adding again.")
  if (unsaved) lines.push("Changes you haven't saved on this page are discarded.")
  return lines
}

/** The notice after a close (SHAPE section 11, "Done"). A cancellation that couldn't be emailed is a danger, as cancelNotice's is. */
export function closedNotice({ inquiry, cancellationEmail }: CloseInquiryResultDto): { tone: 'success' | 'danger'; title: string; message: string } {
  const first = inquiry.firstName
  if (cancellationEmail === 'NotConfigured' || cancellationEmail === 'Failed')
    return { tone: 'danger', title: 'Enquiry closed, email not sent', message: `The intake visit is cancelled, but ${notSentReason(cancellationEmail)}, so ${first} wasn't told. Let them know another way.` }
  const why = inquiry.closeOutcome ? `: ${CLOSE_OUTCOME_LABELS[inquiry.closeOutcome]}` : ''
  const visit = cancellationEmail === 'Sent' ? ` Their intake visit is cancelled and ${first} was emailed.` : cancellationEmail === 'NoInvite' ? ' Their intake visit is cancelled.' : ''
  return { tone: 'success', title: 'Enquiry closed', message: `${first} ${inquiry.lastName}'s enquiry is closed${why}.${visit}` }
}

export function reopenedNotice(row: Pick<ParticipantInquiryDto, 'firstName' | 'lastName'>): { tone: 'success'; title: string; message: string } {
  return { tone: 'success', title: 'Enquiry reopened', message: `${row.firstName} ${row.lastName} is back on the Open list.` }
}
