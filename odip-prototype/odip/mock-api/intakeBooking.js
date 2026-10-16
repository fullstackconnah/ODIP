// Intake booking for the mock API (spec 2026-10-14): the booking fields on the enquiry feed, the booking writes, GET /intake-visits, and a small
// portal/my-shifts sample, so the screens can be captured in every state. Like live ODIP today the mock has no SMTP: every send stores NotConfigured.
const ZONE = 'Australia/Sydney'
const CALLUM = { id: 's-0001', first: 'Callum', name: 'Callum Radford' } // the mock's Coordinator (server.js staff)

// "N days from today at hh:mm in Sydney", as an instant with Z (DST-correct, as the frontend's providerLocalToUtcInstant is).
function sydneyInstant(daysFromToday, hhmm) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date()).split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const offset = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms
  }
  const guess = Date.UTC(y, m - 1, d + daysFromToday, h, mi)
  return new Date(guess - offset(guess - offset(guess))).toISOString().replace('.000Z', 'Z')
}

const booked = (days, hhmm, extra = {}) => ({
  intakeStartsAt: sydneyInstant(days, hhmm), intakeDurationMinutes: 90, intakeLocation: '12 Smith St, Parramatta',
  intakeStaffUserId: CALLUM.id, intakeStaffFirstName: CALLUM.first, intakeStaffName: CALLUM.name, intakeNotes: 'Side gate; the dog is friendly.',
  intakeInviteSentAt: null, intakeInviteError: null, intakeConfirmedAt: null, ...extra,
})

function create({ respond, failEnvelope, enquiryFeed }) {
  const sentAt = sydneyInstant(0, '09:05')
  // Enquiries the base feed does not have, one per booking state the finish review captures.
  const extraEnquiries = [
    { id: 'inq-0101', participantId: null, firstName: 'Ari', lastName: 'Walsh', phone: '0412 555 061', email: 'ari.walsh@example.com.au', source: 'Phone', provenance: 'Self-referral', createdAt: '2026-10-01T01:00:00Z' },
    { id: 'inq-0102', participantId: null, firstName: 'Grace', lastName: 'Liu', phone: null, email: 'grace.liu@example.com.au', source: 'Web', provenance: 'Website form, asked for a call back after 3 pm on weekdays because of school pick-up', createdAt: '2026-10-02T01:00:00Z' },
    { id: 'inq-0103', participantId: null, firstName: 'Omar', lastName: 'Haddad', phone: '0412 555 063', email: 'omar.haddad@example.com.au', source: 'Email', provenance: null, createdAt: '2026-09-30T01:00:00Z' },
    { id: 'inq-0104', participantId: null, firstName: 'Ruby', lastName: 'Chen', phone: '0412 555 064', email: 'ruby.chen@example.com.au', source: 'Phone', provenance: 'GP referral', createdAt: '2026-10-03T01:00:00Z' },
    // The Closed view's sample (spec addendum E4).
    { id: 'inq-0105', participantId: null, firstName: 'Ivy', lastName: 'Park', phone: '0412 555 065', email: 'ivy.park@example.com.au', source: 'Phone', provenance: null, createdAt: '2026-09-29T01:00:00Z' },
  ]
  const bookings = {
    'inq-0002': booked(1, '10:00', { intakeInviteSentAt: sentAt }),
    'inq-0101': booked(2, '14:00', { intakeInviteError: 'NotConfigured' }),
    'inq-0102': booked(3, '09:30', { intakeInviteSentAt: sentAt, intakeConfirmedAt: sentAt }),
    'inq-0103': booked(-3, '11:00', { intakeInviteSentAt: sydneyInstant(-6, '15:00') }),
  }
  const rows = () => [...enquiryFeed, ...extraEnquiries]
  // Close and reopen (spec addendum): why and when, by enquiry id. withBooking spreads it, so every answer and the feed carry it.
  const closed = { 'inq-0105': { closedAt: sydneyInstant(-2, '11:00'), closeOutcome: 'NotGoingAhead', closeNote: 'Family chose a provider closer to home.' } }
  const withBooking = (row) => ({ ...row, timeZoneId: ZONE, ...(bookings[row.id] ?? {}), ...(closed[row.id] ?? {}) })
  const find = (id) => rows().find((r) => r.id === id)
  // The browsed range, as the API reads it: provider-local dates, inclusive at both ends.
  const sydneyDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(iso))
  const inRange = (day, params) => (!params?.get('from') || day >= params.get('from')) && (!params?.get('to') || day <= params.get('to'))
  const notBooked = () => respond(404, failEnvelope(null, ['No intake visit is booked for this enquiry.']))
  // The enquiry form (spec 2026-10-16): pending contacts by enquiry id, as GET /inquiries/{id} carries them. A list replaces them and null leaves them, as the API does.
  const contacts = {}
  let made = 0
  const saveContacts = (id, list) => { if (Array.isArray(list)) contacts[id] = list }
  const fields = (body) => ({ firstName: body.firstName, lastName: body.lastName, phone: body.phone ?? null, email: body.email ?? null, source: body.source, provenance: body.provenance ?? null })
  const notFound = () => respond(404, failEnvelope(null, ['Inquiry not found']))
  const refuse409 = (sentence, code) => respond(409, { ...failEnvelope(null, [sentence]), code })
  const closedRefusal = () => refuse409('This enquiry is closed. Reopen it first.', 'inquiry-closed')
  // The version check close and reopen make (verify C1): a stale expectedUpdatedAt is the API's 409. Rows with no version yet skip it.
  const stale = (row, body) => !!body?.expectedUpdatedAt && !!row.updatedAt && body.expectedUpdatedAt !== row.updatedAt
  const changedByOther = () => respond(409, failEnvelope(null, ['Someone else just changed this visit. Reload and try again.']))
  const enquiryChangedByOther = () => respond(409, failEnvelope(null, ['Someone else just changed this enquiry. Reload and try again.']))
  const stamp = (row) => { row.updatedAt = new Date().toISOString() }

  const get = [
    ['intake-visits', (params) => Object.entries(bookings)
      .filter(([, b]) => !params?.get('staffUserId') || b.intakeStaffUserId === params.get('staffUserId'))
      .filter(([, b]) => inRange(sydneyDay(b.intakeStartsAt), params))
      .map(([id, b]) => {
        const row = find(id)
        return {
          inquiryId: id, firstName: row.firstName, lastName: row.lastName, participantId: row.participantId, participantIsDraft: row.participantIsDraft ?? null,
          participantIntakeCompletedAt: row.participantIntakeCompletedAt ?? null, startsAt: b.intakeStartsAt, durationMinutes: b.intakeDurationMinutes,
          location: b.intakeLocation, staffUserId: b.intakeStaffUserId, staffName: b.intakeStaffName, confirmedAt: b.intakeConfirmedAt, timeZoneId: ZONE,
        }
      })
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))],
    // My shifts for the capture: two shifts on the day of Priya's visit, either side of it.
    ['portal/my-shifts', (params) => {
      const day = sydneyDay(bookings['inq-0002'].intakeStartsAt)
      const shift = (id, start, end) => ({ id, participantId: 'p-0001', participantName: 'Liam Okafor', serviceDate: day, startTime: start, endTime: end,
        endsNextDay: false, durationHours: 2, ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null })
      return { shifts: inRange(day, params) ? [shift('sh-am', '07:00:00', '09:00:00'), shift('sh-pm', '13:00:00', '15:00:00')] : [], tripAssignments: [] }
    }],
  ]

  const put = [
    ['inquiries/:id/intake-booking', (id, body) => {
      const row = find(id)
      if (!row) return respond(404, failEnvelope(null, ['Inquiry not found']))
      if (closed[id]) return closedRefusal()
      if (stale(row, body)) return changedByOther()
      // The capture's refused state: the 400 the server gives for a staff member who cannot do intakes, keyed by field.
      if ((body.location ?? '').trim().toLowerCase() === 'refuse') {
        return respond(400, { title: 'One or more validation errors occurred.', status: 400, errors: { staffUserId: ["Callum can't do intakes. Choose an active coordinator or admin."] } })
      }
      // The capture's staff-busy state, in the API's 409 shape (intake-staff-busy, keyed staffUserId).
      if ((body.location ?? '').trim().toLowerCase() === 'busy') {
        const day = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(body.startsAt)).replace(',', '')
        return respond(409, { title: 'One or more validation errors occurred.', status: 409, code: 'intake-staff-busy', errors: { staffUserId: [`Callum Radford is on a shift 10:00 am – 2:00 pm on ${day}.`] } })
      }
      if (!row.email && body.contactEmail) row.email = body.contactEmail
      stamp(row)
      const before = bookings[id]
      bookings[id] = {
        ...booked(0, '00:00'), ...before, intakeStartsAt: body.startsAt, intakeDurationMinutes: body.durationMinutes, intakeLocation: body.location,
        intakeStaffUserId: body.staffUserId, intakeNotes: body.notes, intakeInviteError: 'NotConfigured', intakeConfirmedAt: before?.intakeConfirmedAt ?? null,
      }
      return withBooking(row)
    }],
    // Its 2 segments never match .../intake-booking.
    ['inquiries/:id', (id, body) => { const row = find(id); if (!row) return notFound(); if (closed[id]) return closedRefusal(); if (stale(row, body)) return changedByOther(); stamp(row); Object.assign(row, fields(body)); saveContacts(id, body.contacts); return withBooking(row) }],
  ]

  const post = [
    ['inquiries/:id/close', (id, body) => {
      const row = find(id)
      if (!row) return notFound()
      if (closed[id]) return refuse409('This enquiry is already closed.', 'inquiry-closed')
      if (row.participantId) return refuse409(`Intake has started for ${row.firstName}, so this enquiry can't be closed.`, 'inquiry-converted')
      if (stale(row, body)) return enquiryChangedByOther()
      if (!body?.outcome) return respond(400, { title: 'One or more validation errors occurred.', status: 400, errors: { outcome: ["Choose why it's closing."] } })
      const booking = bookings[id]
      const cancellationEmail = !booking ? 'NoVisit' : booking.intakeInviteSentAt ? 'NotConfigured' : 'NoInvite'
      delete bookings[id]
      delete contacts[id]
      closed[id] = { closedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), closeOutcome: body.outcome, closeNote: body.note ?? null }
      stamp(row)
      return { inquiry: withBooking(row), cancellationEmail }
    }],
    ['inquiries/:id/reopen', (id, body) => {
      const row = find(id)
      if (!row) return notFound()
      if (!closed[id]) return refuse409('This enquiry is already open.', 'inquiry-open')
      if (stale(row, body)) return enquiryChangedByOther()
      delete closed[id]
      stamp(row)
      return withBooking(row)
    }],
    ['inquiries', (body) => { const row = { id: `inq-new-${++made}`, participantId: null, ...fields(body), createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }; extraEnquiries.push(row); saveContacts(row.id, body.contacts); return withBooking(row) }],
    ['inquiries/:id/intake-booking/confirm', (id, body) => {
      if (!bookings[id]) return notBooked()
      bookings[id].intakeConfirmedAt = body.confirmed ? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') : null
      return withBooking(find(id))
    }],
    ['inquiries/:id/intake-booking/send', (id, body) => {
      if (!bookings[id]) return notBooked()
      const row = find(id)
      if (stale(row, body)) return changedByOther()
      stamp(row)
      return withBooking(row)
    }],
  ]

  const del = [
    ['inquiries/:id/intake-booking', (id, _body, params) => {
      const before = bookings[id]
      if (!before) return notBooked()
      if (stale(find(id), { expectedUpdatedAt: params?.get('expectedUpdatedAt') })) return changedByOther()
      stamp(find(id))
      delete bookings[id]
      return { inquiry: withBooking(find(id)), cancellationEmail: before.intakeInviteSentAt ? 'NotConfigured' : 'NoInvite' }
    }],
  ]

  const detail = [['inquiries/:id', (id) => { const row = find(id); return row ? { ...withBooking(row), contacts: contacts[id] ?? [] } : notFound() }]]

  // view=closed: the closed ones only; otherwise the open ones, as the API lists them.
  const feed = (params) => rows().filter((r) => (params?.get('view') === 'closed') === !!closed[r.id]).map(withBooking)

  return { feed, get, put, post, delete: del, detail }
}

module.exports = { create }
