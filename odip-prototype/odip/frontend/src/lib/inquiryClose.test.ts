import { describe, expect, it } from 'vitest'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'
import { CLOSE_OUTCOME_OPTIONS, closeConsequences, closedNotice, reopenedNotice } from './inquiryClose'

// 2030, so the visit is upcoming and visitWhen shows the year. 23:00Z is 10:00 am on Wed 16 Oct 2030 in Sydney.
const ana: ParticipantInquiryDto = { id: 'inq-1', firstName: 'Ana', lastName: 'Lopez', source: 'Phone', createdAt: '2026-10-01T00:00:00Z', timeZoneId: 'Australia/Sydney' }
const visit = { intakeStartsAt: '2030-10-15T23:00:00Z', intakeDurationMinutes: 90, intakeStaffFirstName: 'Kim', contactFirstName: 'Maria' }
const text = (lines: string[]) => lines.join(' ').replaceAll('\u00a0', ' ')
const CONTACTS = 'Closing deletes the other contacts on it and keeps the main contact. If you reopen it, add the other contacts again.'

describe('what closing an enquiry does (SHAPE.md section 11)', () => {
  it('an upcoming visit whose invite went: cancelled, emailed, off the schedule; contacts always deleted', () => {
    expect(text(closeConsequences({ ...ana, ...visit, intakeInviteSentAt: '2030-10-01T00:00:00Z' }, { unsaved: false }))).toBe(
      `Closing cancels the intake visit on Wed 16 Oct 2030, 10:00 am. We'll email Maria a cancellation, and it comes off Kim's schedule. ${CONTACTS}`)
  })

  it('no invite went out: nobody is emailed', () => {
    expect(text(closeConsequences({ ...ana, ...visit }, { unsaved: false }))).toContain("No invite went out, so nobody is emailed. The visit comes off Kim's schedule.")
  })

  it('a past visit, or none, says nothing about a visit; unsaved changes are named', () => {
    expect(closeConsequences({ ...ana, ...visit, intakeStartsAt: '2026-01-05T23:00:00Z' }, { unsaved: false })).toEqual([CONTACTS])
    expect(closeConsequences(ana, { unsaved: true })).toEqual([CONTACTS, "Changes you haven't saved on this page are discarded."])
  })

  it('the select names their decision in full', () => {
    expect(CLOSE_OUTCOME_OPTIONS.map(o => o.label)).toEqual(['Declined by us', 'Not going ahead (their decision)', 'Other'])
  })
})

describe('the notices after a close or a reopen', () => {
  const closed = { ...ana, contactFirstName: 'Maria', closeOutcome: 'NotGoingAhead' as const }
  it('says why it closed and what became of the visit', () => {
    expect(closedNotice({ inquiry: closed, cancellationEmail: 'NoVisit' })).toEqual({ tone: 'success', title: 'Enquiry closed', message: "Ana Lopez's enquiry is closed: Not going ahead." })
    expect(closedNotice({ inquiry: closed, cancellationEmail: 'Sent' }).message).toBe("Ana Lopez's enquiry is closed: Not going ahead. Their intake visit is cancelled and Maria was emailed.")
    expect(closedNotice({ inquiry: closed, cancellationEmail: 'NoInvite' }).message).toBe("Ana Lopez's enquiry is closed: Not going ahead. Their intake visit is cancelled.")
    expect(closedNotice({ inquiry: closed, cancellationEmail: 'NotConfigured' })).toEqual({
      tone: 'danger', title: 'Enquiry closed, email not sent', message: "The intake visit is cancelled, but email isn't set up yet, so Maria wasn't told. Let them know another way.",
    })
  })

  it('reopened', () => {
    expect(reopenedNotice(ana)).toEqual({ tone: 'success', title: 'Enquiry reopened', message: 'Ana Lopez is back on the Open list.' })
    expect(reopenedNotice({ firstName: 'Jo', lastName: '' }).message).toBe('Jo is back on the Open list.')
    expect(closedNotice({ inquiry: { ...ana, firstName: 'Jo', lastName: '' }, cancellationEmail: 'NoVisit' }).message).toBe("Jo's enquiry is closed.")
  })
})
