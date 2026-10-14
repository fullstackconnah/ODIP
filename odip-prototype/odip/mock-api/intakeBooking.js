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
  ]
  const bookings = {
    'inq-0002': booked(1, '10:00', { intakeInviteSentAt: sentAt }),
    'inq-0101': booked(2, '14:00', { intakeInviteError: 'NotConfigured' }),
    'inq-0102': booked(3, '09:30', { intakeInviteSentAt: sentAt, intakeConfirmedAt: sentAt }),
    'inq-0103': booked(-3, '11:00', { intakeInviteSentAt: sydneyInstant(-6, '15:00') }),
  }
  const rows = () => [...enquiryFeed, ...extraEnquiries]
  const withBooking = (row) => ({ ...row, timeZoneId: ZONE, ...(bookings[row.id] ?? {}) })
  const find = (id) => rows().find((r) => r.id === id)
  const notBooked = () => respond(404, failEnvelope(null, ['No intake visit is booked for this enquiry.']))

  const get = [
    ['intake-visits', (params) => Object.entries(bookings)
      .filter(([, b]) => !params?.get('staffUserId') || b.intakeStaffUserId === params.get('staffUserId'))
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
    ['portal/my-shifts', () => {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(bookings['inq-0002'].intakeStartsAt))
      const shift = (id, start, end) => ({ id, participantId: 'p-0001', participantName: 'Liam Okafor', serviceDate: day, startTime: start, endTime: end,
        endsNextDay: false, durationHours: 2, ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null })
      return { shifts: [shift('sh-am', '07:00:00', '09:00:00'), shift('sh-pm', '13:00:00', '15:00:00')], tripAssignments: [] }
    }],
  ]

  const put = [
    ['inquiries/:id/intake-booking', (id, body) => {
      const row = find(id)
      if (!row) return respond(404, failEnvelope(null, ['Inquiry not found']))
      // The capture's refused state: the 400 the server gives for a staff member who cannot do intakes, keyed by field.
      if ((body.location ?? '').trim().toLowerCase() === 'refuse') {
        return respond(400, { title: 'One or more validation errors occurred.', status: 400, errors: { staffUserId: ["Callum can't do intakes. Choose an active coordinator or admin."] } })
      }
      if (!row.email && body.contactEmail) row.email = body.contactEmail
      const before = bookings[id]
      bookings[id] = {
        ...booked(0, '00:00'), ...before, intakeStartsAt: body.startsAt, intakeDurationMinutes: body.durationMinutes, intakeLocation: body.location,
        intakeStaffUserId: body.staffUserId, intakeNotes: body.notes, intakeInviteError: 'NotConfigured', intakeConfirmedAt: before?.intakeConfirmedAt ?? null,
      }
      return withBooking(row)
    }],
  ]

  const post = [
    ['inquiries/:id/intake-booking/confirm', (id, body) => {
      if (!bookings[id]) return notBooked()
      bookings[id].intakeConfirmedAt = body.confirmed ? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') : null
      return withBooking(find(id))
    }],
    ['inquiries/:id/intake-booking/send', (id) => (bookings[id] ? withBooking(find(id)) : notBooked())],
  ]

  const del = [
    ['inquiries/:id/intake-booking', (id) => {
      const before = bookings[id]
      if (!before) return notBooked()
      delete bookings[id]
      return { inquiry: withBooking(find(id)), cancellationEmail: before.intakeInviteSentAt ? 'NotConfigured' : 'NoInvite' }
    }],
  ]

  return { feed: () => rows().map(withBooking), get, put, post, delete: del }
}

module.exports = { create }
