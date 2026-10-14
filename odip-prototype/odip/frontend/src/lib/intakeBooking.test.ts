import { describe, expect, it } from 'vitest'
import {
  bookingBody, bookingFormOf, cancelNotice, visitsByDay, visitStage, withVisits, durationLabel, endsLabel, inviteLine, isPastVisit, sendsInvite, validateBooking, staffOptions, visitTimes, visitWhen,
} from './intakeBooking'
import type { ParticipantInquiryDto } from '@/api/types/inquiries'

// Perth is UTC+8 with no daylight saving: 02:00Z is 10:00 am there whatever zone the test runs in (vitest UTC and vitest-sydney both).
const PERTH = 'Australia/Perth'
const NOW = new Date('2026-10-14T00:00:00Z')

const row = (overrides: Partial<ParticipantInquiryDto> = {}): ParticipantInquiryDto => ({
  id: 'inq-1', firstName: 'Noah', lastName: 'Fitzgerald', source: 'Phone', createdAt: '2026-09-28T01:10:00Z', email: 'priya@example.com',
  intakeStartsAt: '2026-10-15T23:00:00Z', intakeDurationMinutes: 90, intakeLocation: '12 Smith St', intakeStaffUserId: 'sam',
  intakeNotes: 'Gate code', timeZoneId: 'Australia/Sydney', ...overrides,
})

describe('intake visit wording', () => {
  it('names the lengths the way the panel offers them', () => {
    expect([30, 60, 90, 120, 150].map(durationLabel)).toEqual(['30 min', '1 hour', '1 hour 30 min', '2 hours', '2 hours 30 min'])
  })

  it('shows the visit in the provider zone, never the browser zone, with the year only when it is not this year', () => {
    expect(visitWhen('2026-10-16T02:00:00Z', PERTH, NOW)).toBe('Fri 16 Oct, 10:00 am')
    expect(visitWhen('2027-01-07T02:00:00Z', PERTH, NOW)).toBe('Thu 7 Jan 2027, 10:00 am')
  })

  it('names September as the emails do ("Sep", not en-AU "Sept")', () => {
    expect(visitWhen('2026-09-15T02:00:00Z', PERTH, NOW)).toBe('Tue 15 Sep, 10:00 am')
  })

  // Sydney's clocks go forward at 2:00 am on Sun 4 Oct 2026. A two-hour visit from 1:00 am ends at 4:00 am on the wall clock.
  it('measures a visit across the provider zone daylight-saving change in real time, and enters times in that zone', () => {
    expect(visitTimes('2026-10-03T15:00:00Z', 120, 'Australia/Sydney')).toBe('1:00 am – 4:00 am')
    const form = { email: '', date: '2026-10-04', time: '10:00', duration: '60', location: 'Home', staffUserId: 'sam', notes: '' }
    expect(bookingBody(form, 'Australia/Sydney', false).startsAt).toBe('2026-10-03T23:00:00Z') // 10:00 am AEDT, +11
  })

  it('writes a time range in full, or compactly when both ends share am or pm', () => {
    expect(visitTimes('2026-10-16T02:00:00Z', 90, PERTH)).toBe('10:00 am – 11:30 am')
    expect(visitTimes('2026-10-16T02:00:00Z', 90, PERTH, true)).toBe('10:00 – 11:30 am')
    expect(visitTimes('2026-10-16T03:00:00Z', 120, PERTH, true)).toBe('11:00 am – 1:00 pm')
    expect(endsLabel('2026-10-16T02:00:00Z', 90, PERTH)).toBe('Ends 11:30 am')
  })

  it('calls a visit past once its end has gone by', () => {
    expect(isPastVisit('2026-10-16T02:00:00Z', 90, new Date('2026-10-16T03:29:00Z'))).toBe(false)
    expect(isPastVisit('2026-10-16T02:00:00Z', 90, new Date('2026-10-16T03:30:00Z'))).toBe(true)
  })

  it('reads the invite line from the stored outcome: an error beats an earlier send', () => {
    expect(inviteLine({ intakeInviteSentAt: '2026-10-14T03:00:00Z', intakeInviteError: null })).toEqual({ text: 'Invite sent', failed: false })
    expect(inviteLine({ intakeInviteSentAt: '2026-10-14T03:00:00Z', intakeInviteError: 'NotConfigured' })).toEqual({ text: "Invite not sent: email isn't set up yet", failed: true })
    expect(inviteLine({ intakeInviteSentAt: null, intakeInviteError: 'Failed' })).toEqual({ text: "Invite not sent: the email couldn't be sent", failed: true })
    expect(inviteLine({ intakeInviteSentAt: null, intakeInviteError: null })).toBeNull()
  })
})

describe('the booking form', () => {
  it('opens a booking in the provider zone and sends it back as the same instant', () => {
    const form = bookingFormOf(row(), 'dana')

    expect(form).toEqual({ email: '', date: '2026-10-16', time: '10:00', duration: '90', location: '12 Smith St', staffUserId: 'sam', notes: 'Gate code' })
    expect(bookingBody(form, 'Australia/Sydney', false)).toEqual({
      startsAt: '2026-10-15T23:00:00Z', durationMinutes: 90, location: '12 Smith St', staffUserId: 'sam', notes: 'Gate code',
    })
  })

  it('starts a new booking at 1 hour 30 min with the signed-in user going, and sends the email only when it asked for one', () => {
    const form = { ...bookingFormOf(row({ intakeStartsAt: null, intakeDurationMinutes: null, intakeLocation: null, intakeStaffUserId: null, intakeNotes: null }), 'dana'), email: ' noah@example.com ' }

    expect(form.duration).toBe('90')
    expect(form.staffUserId).toBe('dana')
    expect(bookingBody({ ...form, date: '2026-10-16', time: '10:00', location: 'Home' }, 'Australia/Sydney', true)).toEqual({
      startsAt: '2026-10-15T23:00:00Z', durationMinutes: 90, location: 'Home', staffUserId: 'dana', notes: null, contactEmail: 'noah@example.com',
    })
  })

  it('emails only when something the invite says has changed', () => {
    const saved = bookingFormOf(row(), 'dana')
    expect(sendsInvite({ ...saved, notes: 'New notes' }, saved, true)).toBe(false)
    expect(sendsInvite({ ...saved, location: 'Library' }, saved, true)).toBe(true)
    expect(sendsInvite({ ...saved, staffUserId: 'dana' }, saved, true)).toBe(true)
    expect(sendsInvite(saved, saved, false)).toBe(true)
  })

  it('says what is missing in the brief words, and checks a past time only when the time changed', () => {
    const blank = { email: '', date: '', time: '', duration: '90', location: ' ', staffUserId: '', notes: 'x'.repeat(1001) }
    expect(validateBooking(blank, { askEmail: true, firstName: 'Noah', timeChanged: true, zone: 'Australia/Sydney', now: NOW })).toEqual({
      email: "Add Noah's email to send the invite.", date: 'Choose a date.', time: 'Choose a start time.', location: 'Say where the visit is.',
      staffUserId: "Choose who's going.", notes: 'Keep notes under 1,000 characters.',
    })
    const past = { ...bookingFormOf(row(), 'dana'), date: '2026-10-13' }
    expect(validateBooking(past, { askEmail: false, firstName: 'Noah', timeChanged: true, zone: 'Australia/Sydney', now: NOW }).time).toBe("Choose a time that hasn't passed.")
    expect(validateBooking(past, { askEmail: false, firstName: 'Noah', timeChanged: false, zone: 'Australia/Sydney', now: NOW })).toEqual({})
    expect(validateBooking({ ...past, email: 'noah@' }, { askEmail: true, firstName: 'Noah', timeChanged: false, zone: 'Australia/Sydney', now: NOW }).email)
      .toBe('Enter a full email address, like name@example.com.')
  })

  // Fix round 1, S2: the server's rule, mirrored. A passed visit can be rebooked at a new time, never re-sent at its old one.
  it('refuses an invite change to a passed visit unless its time changes', () => {
    const form = bookingFormOf(row(), 'dana')
    const opts = { askEmail: false, firstName: 'Noah', zone: 'Australia/Sydney', now: NOW, pastVisitChange: true }
    expect(validateBooking(form, { ...opts, timeChanged: false }).time).toBe('This visit has passed. Change the date and time to book another.')
    expect(validateBooking(form, { ...opts, timeChanged: true }).time).toBeUndefined()
    expect(validateBooking(form, { ...opts, timeChanged: false, pastVisitChange: false })).toEqual({})
  })
})

describe('who can go', () => {
  const staff = [
    { id: 'dana', fullName: 'Dana Smith', role: 'Coordinator' as const },
    { id: 'sam', fullName: 'Sam Lee', role: 'Admin' as const },
    { id: 'jo', fullName: 'Jo Ng', role: 'SupportWorker' as const },
    { id: 'root', fullName: 'Platform Admin', role: 'SuperAdmin' as const },
  ]

  it('offers active coordinators and admins only, marks the signed-in user, and keeps a booked person who no longer qualifies', () => {
    expect(staffOptions(staff, 'dana')).toEqual([{ value: 'dana', label: 'Dana Smith (you)' }, { value: 'sam', label: 'Sam Lee' }])
    expect(staffOptions(staff, 'dana', { id: 'jo', name: 'Jo Ng' })[0]).toEqual({ value: 'jo', label: 'Jo Ng' })
  })
})

describe('what a cancel tells the coordinator', () => {
  it('says who was emailed, or that nobody was and why', () => {
    expect(cancelNotice('Sent', 'Noah Fitzgerald')).toEqual({ tone: 'success', title: 'Intake visit cancelled', message: "We've emailed Noah Fitzgerald a cancellation." })
    expect(cancelNotice('NoInvite', 'Noah Fitzgerald')).toEqual({ tone: 'success', title: 'Intake visit cancelled', message: 'No invite had gone out, so nobody was emailed.' })
    expect(cancelNotice('NotConfigured', 'Noah Fitzgerald')).toEqual({
      tone: 'danger', title: 'Intake visit cancelled, email not sent', message: "Email isn't set up yet, so Noah Fitzgerald wasn't told. Let them know another way.",
    })
    expect(cancelNotice('Failed', 'Noah Fitzgerald').message).toBe("The email couldn't be sent, so Noah Fitzgerald wasn't told. Let them know another way.")
  })
})

describe('visits beside shifts', () => {
  const visit = (startsAt: string, overrides = {}) => ({
    inquiryId: startsAt, firstName: 'Noah', lastName: 'Fitzgerald', participantId: null, participantIsDraft: null, participantIntakeCompletedAt: null,
    startsAt, durationMinutes: 90, location: 'Home', staffUserId: 'dana', staffName: 'Dana Smith', confirmedAt: null, timeZoneId: 'Australia/Sydney', ...overrides,
  })

  it('reads where the intake has got to', () => {
    expect(visitStage(visit('2026-10-15T23:00:00Z'))).toBe('new')
    expect(visitStage(visit('2026-10-15T23:00:00Z', { participantId: 'p', participantIsDraft: true }))).toBe('draftintake')
    expect(visitStage(visit('2026-10-15T23:00:00Z', { participantId: 'p', participantIsDraft: true, participantIntakeCompletedAt: '2026-10-16T03:00:00Z' }))).toBe('complete')
    expect(visitStage(visit('2026-10-15T23:00:00Z', { participantId: 'p', participantIsDraft: false }))).toBe('complete')
  })

  it('groups visits by the provider-local day and puts them among the shifts by start time', () => {
    const tenAm = visit('2026-10-15T23:00:00Z') // 16 Oct, 10:00 am in Sydney, still 15 Oct in UTC
    expect([...visitsByDay([tenAm]).keys()]).toEqual(['2026-10-16'])
    const shifts = [{ id: 's1', startTime: '09:00:00' }, { id: 's2', startTime: '13:00:00' }]
    expect(withVisits(shifts, [tenAm]).map(e => (e.kind === 'shift' ? e.shift.id : 'visit'))).toEqual(['s1', 'visit', 's2'])
  })
})
