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

const FULL_ADDRESS = { addressStreet: '12 Smith St', addressSuburb: 'Parramatta', addressState: 'NSW', addressPostcode: '2150' }

const booked = (days, hhmm, extra = {}) => ({
  intakeStartsAt: sydneyInstant(days, hhmm), intakeDurationMinutes: 90, intakeLocation: '12 Smith St, Parramatta',
  intakeStaffUserId: CALLUM.id, intakeStaffFirstName: CALLUM.first, intakeStaffName: CALLUM.name, intakeNotes: 'Side gate; the dog is friendly.',
  intakeInviteSentAt: null, intakeInviteError: null, intakeConfirmedAt: null, ...extra,
})

function create({ respond, failEnvelope, enquiryFeed }) {
  const sentAt = sydneyInstant(0, '09:05')
  // Enquiries the base feed does not have, one per booking state the finish review captures.
  const extraEnquiries = [
    // E1: a named main contact, the full address and a plan; booked with a failed invite, and Start intake enabled.
    { id: 'inq-0101', participantId: null, firstName: 'Ari', lastName: 'Walsh', phone: '0412 555 061', email: 'sarah.walsh@example.com.au', source: 'Phone', provenance: 'Self-referral', createdAt: '2026-10-01T01:00:00Z',
      contactFirstName: 'Sarah', contactLastName: 'Walsh', contactRelationship: 'Mother', ...FULL_ADDRESS, dateOfBirth: '2014-03-12', planType: 'PlanManaged', planStartDate: '2026-07-01', planEndDate: '2027-06-30' },
    // N3: their own contact.
    { id: 'inq-0102', participantId: null, firstName: 'Grace', lastName: 'Liu', phone: null, email: 'grace.liu@example.com.au', source: 'Web', provenance: 'Website form, asked for a call back after 3 pm on weekdays because of school pick-up', createdAt: '2026-10-02T01:00:00Z', contactIsParticipant: true },
    { id: 'inq-0103', participantId: null, firstName: 'Omar', lastName: 'Haddad', phone: '0412 555 063', email: 'omar.haddad@example.com.au', source: 'Email', provenance: null, createdAt: '2026-09-30T01:00:00Z' },
    // E3: booked with no email, so no invite went out.
    { id: 'inq-0104', participantId: null, firstName: 'Ruby', lastName: 'Chen', phone: '0412 555 064', email: null, source: 'Phone', provenance: 'GP referral', createdAt: '2026-10-03T01:00:00Z', contactFirstName: 'Wei', contactLastName: 'Chen' },
    // The Closed view's sample (spec addendum E4); E6 with a named main contact and the address.
    { id: 'inq-0105', participantId: null, firstName: 'Ivy', lastName: 'Park', phone: '0412 555 065', email: 'ivy.park@example.com.au', source: 'Phone', provenance: null, createdAt: '2026-09-29T01:00:00Z',
      contactFirstName: 'Leo', contactLastName: 'Park', contactRelationship: 'Father', contactRole: 'Guardian', ...FULL_ADDRESS },
    // W, the worst case (SHAPE section 15).
    { id: 'inq-0106', participantId: null, firstName: 'Aleksandra', lastName: 'Wiśniewska-Kowalczyk', phone: '+61 (02) 9876 5432', email: 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
      source: 'Email', provenance: "Referred by the hospital discharge planner after a long stay; the family want weekly community access, help with transport to therapy, and a coordinator who can call the grandmother first, since she holds guardianship. Best times are mornings before ten, and never on Wednesdays (dialysis). Call her.", createdAt: '2026-10-04T01:00:00Z',
      contactFirstName: 'Bartholomew', contactLastName: 'Montgomery-Fitzgerald III', contactRelationship: 'Maternal grandmother and legal guardian', contactRole: 'Guardian',
      addressStreet: 'Unit 14, Level 3, 1234-1240 Great Western Highway', addressSuburb: 'Port Macquarie', addressState: 'NSW', addressPostcode: '2444',
      ndisNumber: '430123456', planType: 'PlanManaged', planStartDate: '2026-07-01', planEndDate: '2028-09-30' },
    // A participant with no last name, their own contact, with no phone or email.
    { id: 'inq-0107', participantId: null, firstName: 'Jo', lastName: null, phone: null, email: null, source: 'Phone', provenance: null, createdAt: '2026-10-05T01:00:00Z', contactIsParticipant: true },
    // A legacy phone that is not a phone, and no contact name.
    { id: 'inq-0108', participantId: null, firstName: 'Theo', lastName: 'Hart', phone: '0412 555 010 after 3pm', email: null, source: 'Phone', provenance: null, createdAt: '2026-10-06T01:00:00Z' },
  ]
  const bookings = {
    'inq-0002': booked(1, '10:00', { intakeInviteSentAt: sentAt }),
    'inq-0101': booked(2, '14:00', { intakeInviteError: 'NotConfigured' }),
    'inq-0102': booked(3, '09:30', { intakeInviteSentAt: sentAt, intakeConfirmedAt: sentAt }),
    'inq-0103': booked(-3, '11:00', { intakeInviteSentAt: sydneyInstant(-6, '15:00') }),
    'inq-0104': booked(4, '10:00'),
  }
  const rows = () => [...enquiryFeed, ...extraEnquiries]
  // Close and reopen (spec addendum): why and when, by enquiry id. withBooking spreads it, so every answer and the feed carry it.
  const closed = { 'inq-0105': { closedAt: sydneyInstant(-2, '11:00'), closeOutcome: 'NotGoingAhead', closeNote: 'Family chose a provider closer to home.' } }
  // The redesign's computed flags, as ParticipantInquiry has them: Start intake's two gates (the address, a named main contact). lastName "" when none (G6).
  const blank = (v) => !v || !String(v).trim()
  const hasMainContact = (r) => !r.contactIsParticipant && (!!r.contactRole || [r.contactFirstName, r.contactLastName, r.contactRelationship, r.phone, r.email].some((v) => !blank(v)))
  const gates = (r) => ({
    lastName: r.lastName ?? '', contactIsParticipant: !!r.contactIsParticipant,
    hasAddress: [r.addressStreet, r.addressSuburb, r.addressState, r.addressPostcode].every((v) => !blank(v)),
    contactNeedsName: hasMainContact(r) && (blank(r.contactFirstName) || blank(r.contactLastName)),
  })
  const withBooking = (row) => ({ ...row, ...gates(row), timeZoneId: ZONE, ...(bookings[row.id] ?? {}), ...(closed[row.id] ?? {}) })
  // L2: the participant details and the contact's role ride on GET /inquiries/{id} only, never the list.
  const DETAIL_ONLY = ['dateOfBirth', 'ndisNumber', 'addressStreet', 'addressSuburb', 'addressState', 'addressPostcode', 'planType', 'planStartDate', 'planEndDate', 'contactRole']
  const listRow = (row) => { const out = withBooking(row); for (const k of DETAIL_ONLY) delete out[k]; return out }
  const find = (id) => rows().find((r) => r.id === id)
  // The browsed range, as the API reads it: provider-local dates, inclusive at both ends.
  const sydneyDay = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date(iso))
  const inRange = (day, params) => (!params?.get('from') || day >= params.get('from')) && (!params?.get('to') || day <= params.get('to'))
  const notBooked = () => respond(404, failEnvelope(null, ['No intake visit is booked for this enquiry.']))
  // The enquiry form (spec 2026-10-16): pending contacts by enquiry id, as GET /inquiries/{id} carries them. A list replaces them and null leaves them, as the API does.
  const contacts = {}
  let made = 0
  const saveContacts = (id, list) => { if (Array.isArray(list)) contacts[id] = list }
  // What a save stores, as the API's Apply does: with "their own contact" ticked the contact's four fields are null whatever was sent; the NDIS number without spaces.
  const own = (body) => ({ firstName: body.firstName, lastName: body.lastName?.trim() ?? '', source: body.source, provenance: body.provenance ?? null })
  const fields = (body) => {
    const self = !!body.contactIsParticipant
    return {
      ...own(body), phone: body.phone ?? null, email: body.email ?? null, contactIsParticipant: self,
      contactFirstName: self ? null : body.contactFirstName ?? null, contactLastName: self ? null : body.contactLastName ?? null,
      contactRelationship: self ? null : body.contactRelationship ?? null, contactRole: self ? null : body.contactRole ?? null,
      dateOfBirth: body.dateOfBirth ?? null, ndisNumber: body.ndisNumber ? String(body.ndisNumber).replace(/\s/g, '') : null,
      addressStreet: body.addressStreet ?? null, addressSuburb: body.addressSuburb ?? null, addressState: body.addressState ?? null, addressPostcode: body.addressPostcode ?? null,
      planType: body.planType ?? null, planStartDate: body.planStartDate ?? null, planEndDate: body.planEndDate ?? null,
    }
  }
  const problem = (errors) => respond(400, { title: 'One or more validation errors occurred.', status: 400, errors })
  let converted = 0
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
          hasAddress: gates(row).hasAddress, contactNeedsName: gates(row).contactNeedsName,
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
      if (!row.email && !row.participantId && body.contactEmail) row.email = body.contactEmail
      stamp(row)
      const before = bookings[id]
      bookings[id] = {
        ...booked(0, '00:00'), ...before, intakeStartsAt: body.startsAt, intakeDurationMinutes: body.durationMinutes, intakeLocation: body.location,
        // L7: with no email nothing is sent, so nothing is recorded; the mock has no SMTP, so a send stores NotConfigured.
        intakeStaffUserId: body.staffUserId, intakeNotes: body.notes, intakeInviteError: row.email ? 'NotConfigured' : (before?.intakeInviteError ?? null), intakeConfirmedAt: before?.intakeConfirmedAt ?? null,
      }
      return listRow(row)
    }],
    // Its 2 segments never match .../intake-booking.
    ['inquiries/:id', (id, body) => { const row = find(id); if (!row) return notFound(); if (closed[id]) return closedRefusal(); if (stale(row, body)) return changedByOther(); stamp(row); Object.assign(row, row.participantId ? own(body) : fields(body)); saveContacts(id, body.contacts); return listRow(row) }],
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
      return { inquiry: listRow(row), cancellationEmail }
    }],
    ['inquiries/:id/reopen', (id, body) => {
      const row = find(id)
      if (!row) return notFound()
      if (!closed[id]) return refuse409('This enquiry is already open.', 'inquiry-open')
      if (stale(row, body)) return enquiryChangedByOther()
      delete closed[id]
      stamp(row)
      return listRow(row)
    }],
    // Start intake (L5, D1): closed first, then the full address and a named main contact, each a 400 keyed by field.
    ['inquiries/:id/convert', (id) => {
      const row = find(id)
      if (!row) return notFound()
      if (closed[id]) return closedRefusal()
      if (!row.participantId) {
        const errors = {}
        for (const [key, part] of [['addressStreet', 'street'], ['addressSuburb', 'suburb'], ['addressState', 'state'], ['addressPostcode', 'postcode']])
          if (blank(row[key])) errors[key] = [`Add the ${part} to start intake.`]
        if (gates(row).contactNeedsName) {
          if (blank(row.contactFirstName)) errors.contactFirstName = ["Add the main contact's name to start intake."]
          if (blank(row.contactLastName)) errors.contactLastName = ["Add the main contact's name to start intake."]
        }
        if (Object.keys(errors).length > 0) return problem(errors)
        Object.assign(row, { participantId: `p-conv-${++converted}`, participantIsDraft: true, participantIsActive: false, participantIntakeCompletedAt: null })
        stamp(row)
      }
      return listRow(row)
    }],
    ['inquiries', (body) => { const row = { id: `inq-new-${++made}`, participantId: null, ...fields(body), createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') }; extraEnquiries.push(row); saveContacts(row.id, body.contacts); return listRow(row) }],
    ['inquiries/:id/intake-booking/confirm', (id, body) => {
      if (!bookings[id]) return notBooked()
      bookings[id].intakeConfirmedAt = body.confirmed ? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') : null
      return listRow(find(id))
    }],
    ['inquiries/:id/intake-booking/send', (id, body) => {
      if (!bookings[id]) return notBooked()
      const row = find(id)
      if (!row.email) return problem({ contactEmail: ["Add the main contact's email to send the invite."] })
      if (stale(row, body)) return changedByOther()
      stamp(row)
      return listRow(row)
    }],
  ]

  const del = [
    ['inquiries/:id/intake-booking', (id, _body, params) => {
      const before = bookings[id]
      if (!before) return notBooked()
      if (stale(find(id), { expectedUpdatedAt: params?.get('expectedUpdatedAt') })) return changedByOther()
      stamp(find(id))
      delete bookings[id]
      return { inquiry: listRow(find(id)), cancellationEmail: before.intakeInviteSentAt ? 'NotConfigured' : 'NoInvite' }
    }],
  ]

  const detail = [['inquiries/:id', (id) => { const row = find(id); return row ? { ...withBooking(row), contacts: contacts[id] ?? [] } : notFound() }]]

  // view=closed: the closed ones only; otherwise the open ones, as the API lists them.
  const feed = (params) => rows().filter((r) => (params?.get('view') === 'closed') === !!closed[r.id]).map(listRow)

  return { feed, get, put, post, delete: del, detail }
}

module.exports = { create }
