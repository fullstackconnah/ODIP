import { describe, expect, it } from 'vitest'
import {
  bookingBody, bookingFormOf, cancelNotice, visitsByDay, visitStage, withVisits, durationLabel, endsLabel, inviteLine, isPastVisit, sendsInvite, validateBooking, staffOptions, visitTimes, visitWhen,
  NO_CONNECTION, enquirySavedNotice, refusalOf, serverBookingErrors, invitee, inviteeEmailLabel, resultLine,
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
    const email = 'priya@example.com'
    expect(inviteLine({ email, intakeInviteSentAt: '2026-10-14T03:00:00Z', intakeInviteError: null })).toEqual({ text: 'Invite sent', failed: false })
    expect(inviteLine({ email, intakeInviteSentAt: '2026-10-14T03:00:00Z', intakeInviteError: 'NotConfigured' })).toEqual({ text: "Invite not sent: email isn't set up yet", failed: true })
    expect(inviteLine({ email, intakeInviteSentAt: null, intakeInviteError: 'Failed' })).toEqual({ text: "Invite not sent: the email couldn't be sent", failed: true })
    expect(inviteLine({ email, intakeInviteSentAt: null, intakeInviteError: null })).toBeNull()
  })

  // D: a converted enquiry's email is read-only, so one that cannot take an invite reads as none (a non-converted one is the server's 400).
  it('says the email on file cannot take an invite for a converted enquiry only', () => {
    const bad = { email: 'a b@c.d', intakeInviteSentAt: null, intakeInviteError: null }
    expect(inviteLine({ ...bad, participantId: 'p-1' })).toEqual({ text: 'No invite: bad email', failed: false })
    expect(inviteLine({ ...bad, participantId: null })).toBeNull()
    expect(inviteLine({ ...bad, email: 'ok@example.com', participantId: 'p-1' })).toBeNull()
  })

  // L7: booked with no email is not a failure (the Tone Rule): a muted line, not a warning.
  it('says no invite went out because there is no email, not that one failed', () => {
    expect(inviteLine({ email: null, intakeInviteSentAt: null, intakeInviteError: null })).toEqual({ text: 'No invite: no email', failed: false })
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
    expect(bookingBody({ ...form, email: ' ', date: '2026-10-16', time: '10:00', location: 'Home' }, 'Australia/Sydney', true)).not.toHaveProperty('contactEmail')
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
    // L7: no email is never an error; one typed is checked for its format (below).
    expect(validateBooking(blank, { askEmail: true, timeChanged: true, zone: 'Australia/Sydney', now: NOW })).toEqual({
      date: 'Choose a date.', time: 'Choose a start time.', location: 'Say where the visit is.',
      staffUserId: "Choose who's going.", notes: 'Keep notes under 1,000 characters.',
    })
    const past = { ...bookingFormOf(row(), 'dana'), date: '2026-10-13' }
    expect(validateBooking(past, { askEmail: false, timeChanged: true, zone: 'Australia/Sydney', now: NOW }).time).toBe("Choose a time that hasn't passed.")
    expect(validateBooking(past, { askEmail: false, timeChanged: false, zone: 'Australia/Sydney', now: NOW })).toEqual({})
    expect(validateBooking({ ...past, email: 'noah@' }, { askEmail: true, timeChanged: false, zone: 'Australia/Sydney', now: NOW }).email)
      .toBe('Enter a full email address, like name@example.com.')
  })

  // Fix round 1, S2: the server's rule, mirrored. A passed visit can be rebooked at a new time, never re-sent at its old one.
  it('refuses an invite change to a passed visit unless its time changes', () => {
    const form = bookingFormOf(row(), 'dana')
    const opts = { askEmail: false, zone: 'Australia/Sydney', now: NOW, pastVisitChange: true }
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
    startsAt, durationMinutes: 90, location: 'Home', staffUserId: 'dana', staffName: 'Dana Smith', confirmedAt: null, timeZoneId: 'Australia/Sydney', hasAddress: true, contactNeedsName: false, ...overrides,
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

describe('the shared refusal helpers (the slide-over and the enquiry form)', () => {
  const axiosRefusal = (data: unknown) => Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status: 409, data } })

  it('refusalOf: no answer, a field sentence, a message list, or the fallback', () => {
    expect(refusalOf(Object.assign(new Error('Network Error'), { isAxiosError: true }), 'fallback')).toBe(NO_CONNECTION)
    expect(refusalOf(axiosRefusal({ errors: { staffUserId: ['Kim is busy'] } }), 'fallback')).toBe('Kim is busy')
    expect(refusalOf(axiosRefusal({ success: false, errors: ['Inquiry not found'] }), 'fallback')).toBe('Inquiry not found')
    expect(refusalOf(new Error('x'), 'fallback')).toBe('fallback')
  })

  it('serverBookingErrors: the server keys on the booking fields, others dropped', () => {
    expect(serverBookingErrors(axiosRefusal({ errors: { startsAt: ['past'], contactEmail: ['bad'], staffUserId: ['busy'], other: ['x'] } })))
      .toEqual({ time: 'past', email: 'bad', staffUserId: 'busy' })
    expect(serverBookingErrors(axiosRefusal({ errors: ['Inquiry not found'] }))).toEqual({})
  })

  it('bookingFormOf an enquiry with no visit: the empty form at 1 hour 30 min', () => {
    expect(bookingFormOf({}, '')).toEqual({ email: '', date: '', time: '', duration: '90', location: '', staffUserId: '', notes: '' })
  })
})

describe("the enquiry form's save summary (SHAPE.md section 6)", () => {
  // 2030, so visitWhen shows the year whenever the test runs. 23:00Z is 10:00 am on Wed 16 Oct 2030 in Sydney.
  const ana = row({ id: 'inq-9', firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.com', timeZoneId: 'Australia/Sydney' })
  const booked = { ...ana, contactFirstName: 'Sarah', intakeStartsAt: '2030-10-15T23:00:00Z', intakeDurationMinutes: 90, intakeStaffName: 'Dana Smith', intakeInviteSentAt: '2030-10-01T00:00:00Z', intakeInviteError: null }
  const base = { created: true, enquiry: ana, visit: null, resent: false, contacts: null } as const

  it('booked and sent, with a contact', () => {
    expect(enquirySavedNotice({ ...base, enquiry: booked, visit: 'booked', contacts: 1 })).toEqual({
      tone: 'success', title: 'Enquiry captured', subject: 'inq-9',
      message: 'Intake visit booked for Wed 16 Oct 2030, 10:00 am with Dana Smith. Invite sent to ana@example.com. 1 contact saved.',
    })
  })

  it('booked but the invite was not sent: danger, and says to tell them another way', () => {
    expect(enquirySavedNotice({ ...base, enquiry: { ...booked, intakeInviteSentAt: null, intakeInviteError: 'NotConfigured' }, visit: 'booked' })).toEqual({
      tone: 'danger', title: 'Enquiry saved, invite not sent', subject: 'inq-9',
      message: "The intake visit is booked for Wed 16 Oct 2030, 10:00 am, but email isn't set up yet, so Sarah wasn't told. Let them know another way.",
    })
  })

  it('booked or moved with no email: says nobody was emailed, and why (SHAPE N6)', () => {
    const noEmail = { ...booked, contactFirstName: null, email: null, intakeInviteSentAt: null }
    expect(enquirySavedNotice({ ...base, enquiry: noEmail, visit: 'booked' })).toEqual({
      tone: 'success', title: 'Enquiry captured', subject: 'inq-9',
      message: 'Intake visit booked for Wed 16 Oct 2030, 10:00 am with Dana Smith. No invite sent: the main contact has no email.',
    })
    expect(enquirySavedNotice({ ...base, created: false, enquiry: { ...noEmail, contactFirstName: 'Wei' }, visit: 'moved' }).message)
      .toBe('Intake visit moved to Wed 16 Oct 2030, 10:00 am. No invite went out: Wei has no email.')
  })

  it('moved, resent, and the resend that failed', () => {
    expect(enquirySavedNotice({ ...base, created: false, enquiry: booked, visit: 'moved' }).message)
      .toBe('Intake visit moved to Wed 16 Oct 2030, 10:00 am. Updated invite sent to ana@example.com.')
    expect(enquirySavedNotice({ ...base, created: false, enquiry: { ...booked, email: 'new@example.com' }, resent: true }).message).toBe('Invite sent again to new@example.com.')
    const failed = enquirySavedNotice({ ...base, created: false, enquiry: { ...booked, intakeInviteError: 'NotConfigured' }, resent: true })
    expect(failed.tone).toBe('danger')
    expect(failed.message).toBe("The invite wasn't sent again: email isn't set up yet.")
  })

  it('contacts are counted; with nothing else to say, it names the enquiry', () => {
    expect(enquirySavedNotice({ ...base, contacts: 2 }).message).toBe('Ana Lopez is on the Enquiries list. 2 contacts saved.')
    expect(enquirySavedNotice(base)).toEqual({ tone: 'success', title: 'Enquiry captured', message: 'Ana Lopez is on the Enquiries list.', subject: 'inq-9' })
    expect(enquirySavedNotice({ ...base, created: false, contacts: 0 })).toEqual({ tone: 'success', title: 'Enquiry saved', message: "Ana Lopez's changes are saved.", subject: 'inq-9' })
    // Review Focus 5: no last name, no trailing space.
    expect(enquirySavedNotice({ ...base, enquiry: { ...ana, firstName: 'Jo', lastName: '' } }).message).toBe('Jo is on the Enquiries list.')
  })
})

describe('who a sentence names (SHAPE section 9)', () => {
  const base = row({ contactFirstName: null })
  it('the participant when they are their own contact, else the contact, else the main contact', () => {
    expect(invitee({ ...base, contactIsParticipant: true, contactFirstName: 'Sarah' })).toBe('Noah')
    expect(invitee({ ...base, contactFirstName: ' Sarah ' })).toBe('Sarah')
    expect(invitee(base)).toBe('the main contact')
    expect(invitee(base, { start: true })).toBe('The main contact')
  })

  it("labels the slide-over's email by who it is for", () => {
    expect(inviteeEmailLabel({ ...base, contactFirstName: 'Sarah' })).toBe("Sarah's email")
    expect(inviteeEmailLabel({ ...base, contactIsParticipant: true })).toBe("Noah's email")
    expect(inviteeEmailLabel(base)).toBe("Main contact's email")
  })

  it('the result line with no email says so and names who to tell', () => {
    const booked = { ...base, contactFirstName: 'Sarah', intakeInviteSentAt: null, intakeInviteError: null }
    expect(resultLine({ ...booked, email: null }, 'Australia/Sydney')).toEqual({ tone: 'warning', text: 'No invite sent: Sarah has no email. Let them know another way.' })
    expect(resultLine(booked, 'Australia/Sydney')).toEqual({ tone: 'warning', text: 'No invite has gone out yet.' })
    expect(resultLine({ ...booked, intakeInviteError: 'NotConfigured' }, 'Australia/Sydney').text)
      .toBe("Invite not sent: email isn't set up yet. The visit is still booked, so let Sarah know another way.")
  })
})
