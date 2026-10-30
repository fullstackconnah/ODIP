// The import endpoints of the mock API, for the "Upcoming shifts" kind only (api/v1/imports/upcoming-shifts/* and imports/{id}/undo). Every other kind is the server's generic echo.
// Kept in its own module like funding.js. It answers the way the real API does: a preview with mixed rows (a partly refused pattern row, a staff member not found, a 60-character
// participant name with a three-line Check, a skipped repeat, a participant that is not found) and `readinessEnforced: true`; a commit that makes three Draft shifts in the first week and
// starts that week, so the roster board shows the Publish banner and no Start card; an undo that leaves 6 shifts (published or changed since), so the result reads "partly undone".
// The form fields (`shape`, `from`, `weeks`) arrive as multipart text; server.js hands the raw body over as `_form`. All names are fictional.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LONG_NAME = 'Bartholomew-Alexander Montgomery-Featherstonehaugh III'

function create({ respond, failEnvelope, rosterShifts, startedWeeks, today, addDays, weekday }) {
  const staffBatch = (n, fileName, rowCount) => ({
    id: `import-staff-${n}`, kind: 'Staff', fileName, createdByName: 'Demo Admin', createdAt: `2026-10-${20 + n}T01:00:00Z`, rowCount,
    createdCount: rowCount, skippedCount: 0, failedCount: 0, undoneAt: null, undoneByName: null, keptCount: null,
  })
  const batches = [
    staffBatch(1, 'staff-new-starters.csv', 6), staffBatch(2, 'staff-reminders.csv', 5), staffBatch(3, 'staff-all-done.csv', 4), staffBatch(4, 'staff-count-fails.csv', 3),
    staffBatch(5, 'staff-big-intake.csv', 150),
  ]
  // Invite counts per Staff batch and who is in each group; the invite routes move people from toInvite to invitedBefore, as the real record call does.
  const people = (prefix, n) => Array.from({ length: n }, (_, i) => ({ staffId: `${prefix}-${i + 1}`, name: `${['Ava', 'Ben', 'Cleo'][i % 3]} ${prefix.toUpperCase()}${i + 1}`, email: `${prefix}${i + 1}@example.com` }))
  const groups = {
    'import-staff-1': { toInvite: people('new', 3), invitedBefore: people('old', 2), signedIn: 1, cannotInvite: 0 },
    'import-staff-2': { toInvite: [], invitedBefore: people('rem', 2), signedIn: 3, cannotInvite: 0 },
    'import-staff-3': { toInvite: [], invitedBefore: [], signedIn: 4, cannotInvite: 0 },
    'import-staff-5': { toInvite: people('big', 150), invitedBefore: [], signedIn: 0, cannotInvite: 0 },
  }
  const countOf = (g) => ({ toInvite: g.toInvite.length, invitedBefore: g.invitedBefore.length, signedIn: g.signedIn, cannotInvite: g.cannotInvite })
  let counter = 0

  const sayDay = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` }
  const nextMonday = (iso) => addDays(iso, 8 - (weekday(iso) || 7))
  const field = (body, name) => { const m = new RegExp(`name="${name}"\\r?\\n\\r?\\n([^\\r\\n]*)`).exec((body && body._form) || ''); return m ? m[1] : null }

  function preview(body) {
    const shape = field(body, 'shape') === 'dated' ? 'dated' : 'pattern'
    const from = field(body, 'from') || nextMonday(today())
    const weeks = Number(field(body, 'weeks')) || 12
    const firstDate = shape === 'pattern' ? from : addDays(today(), 1)
    const lastDate = shape === 'pattern' ? addDays(from, weeks * 7 - 1) : addDays(today(), 60)
    const when = shape === 'pattern' ? 'Mondays' : sayDay(firstDate)
    const made = (n) => (shape === 'pattern' ? `: ${n} shifts` : '')
    const row = (rowNumber, name, status, over) => ({ rowNumber, name, status, reasons: [], warnings: [], notes: [], skipReason: null, detail: null, ...over })
    return {
      fields: [
        { key: 'ndis', label: 'NDIS number', required: false }, { key: 'participant', label: 'Participant name', required: false }, { key: 'dob', label: 'Date of birth', required: false },
        shape === 'pattern' ? { key: 'weekday', label: 'Weekday', required: true } : { key: 'date', label: 'Date', required: true },
        { key: 'start', label: 'Start time', required: true }, { key: 'end', label: 'End time', required: true },
        { key: 'staffEmail', label: 'Staff email', required: false }, { key: 'staffName', label: 'Staff name', required: false }, { key: 'notes', label: 'Notes', required: false },
      ],
      columns: [
        { index: 0, header: 'Client Name', field: 'participant', note: null }, { index: 1, header: 'NDIS #', field: 'ndis', note: null },
        { index: 2, header: shape === 'pattern' ? 'Day' : 'Date', field: shape === 'pattern' ? 'weekday' : 'date', note: null },
        { index: 3, header: 'From', field: 'start', note: null }, { index: 4, header: 'To', field: 'end', note: null },
        { index: 5, header: 'Worker Email', field: 'staffEmail', note: null }, { index: 6, header: 'Internal ref', field: null, note: 'Not matched to a field.' },
      ],
      rows: [
        row(2, 'Liam Okafor', 'Ready', { detail: `${when}, 9:00 am to 3:00 pm, with Jack O'Sullivan${made(12)}`, warnings: ["Jack O'Sullivan is on leave on Mon 17 Nov. Imports with the reason \"Imported from roster.xlsx\"."] }),
        row(3, LONG_NAME, 'Ready', {
          detail: `${when}, 10:00 am to 4:00 pm, with Mei Zhang${made(10)}`,
          warnings: ["2 of 12 shifts can't be imported (Mon 8 Dec, Mon 15 Dec): Mei Zhang's worker screening expired on 1 Dec. Puts the Core budget over by $1,240. No staff member with the email m.zhang@example.com, so the other shifts import unfilled."],
        }),
        row(4, 'Grace Palmer-Hughes', 'Ready', { detail: `${when}, 7:00 pm to 7:00 am, no staff${made(6)}`, notes: ['No staff given: imports unfilled.', 'Ends the next day.'] }),
        row(5, 'Liam Okafor', 'Skipped', { skipReason: 'Repeats row 2.' }),
        row(6, 'Unknown person', 'Invalid', { reasons: ['No participant with NDIS number 430 123 456. Import participants first, or check the number.'] }),
      ],
      readyCount: 3, skippedCount: 1, invalidCount: 1, previouslyImportedAt: null, createCount: 28,
      unfilledCount: 6, firstDate, lastDate, weekCount: shape === 'pattern' ? weeks : 9, readinessEnforced: true,
    }
  }

  function commit(body) {
    const firstWeekStart = nextMonday(today())
    for (const [i, date] of [firstWeekStart, addDays(firstWeekStart, 2), addDays(firstWeekStart, 4)].entries()) {
      rosterShifts.push({
        id: `import-shift-${++counter}`, participantId: 'p-0001', participantName: 'Liam Okafor', staffId: i === 2 ? null : 's-0003', staffName: i === 2 ? null : "Jack O'Sullivan",
        serviceDate: date, startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false, durationHours: 6, ratio: 'OneToOne', nightType: 'None', status: 'Draft',
        shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false,
      })
    }
    startedWeeks.add(firstWeekStart)
    const batch = {
      id: `import-batch-${counter}`, kind: 'UpcomingShifts', fileName: 'roster.xlsx', createdByName: 'Demo Admin', createdAt: new Date().toISOString(), rowCount: 5,
      createdCount: 28, skippedCount: 1, failedCount: 1, undoneAt: null, undoneByName: null, keptCount: null,
    }
    batches.unshift(batch)
    return { batchId: batch.id, createdCount: 28, skippedCount: 1, failedCount: 1, rows: preview(body).rows.filter((r) => r.status === 'Invalid'), replayed: false, firstWeekStart, weekCount: 12, unfilledCount: 6 }
  }

  function undo(id) {
    const batch = batches.find((b) => b.id === id)
    if (!batch) return respond(404, failEnvelope(null, ['That import was not found.']))
    if (batch.undoneAt) return respond(409, failEnvelope(null, ['Nothing to undo: every shift from this import has been published or changed since.']))
    Object.assign(batch, { undoneAt: new Date().toISOString(), undoneByName: 'Demo Admin', keptCount: 6 })
    return batch
  }

  function inviteCount(id) {
    const g = groups[id]
    return g ? countOf(g) : respond(500, failEnvelope(null, ['The invite count could not be worked out.']))
  }

  function invite(id, _body, query) {
    const g = groups[id]
    if (!g) return respond(404, failEnvelope(null, ['Staff import not found.']))
    const again = query && query.get('includeInvitedBefore') === 'true'
    const who = again ? [...g.toInvite, ...g.invitedBefore] : g.toInvite
    return { invites: who.map((p) => ({ ...p, firebaseAccount: 'Existing', error: null })), left: 0, next: null }
  }

  function recordSent(body) {
    const ids = new Set((body && body.userIds) || [])
    for (const g of Object.values(groups)) {
      const moved = g.toInvite.filter((p) => ids.has(p.staffId))
      g.toInvite = g.toInvite.filter((p) => !ids.has(p.staffId))
      g.invitedBefore.push(...moved)
    }
    return ids.size
  }

  return {
    get: [
      ['imports', () => batches],
      ['imports/:id/invites/count', (id) => inviteCount(id)],
      ['imports/upcoming-shifts/template', () => ({ template: 'upcoming-shifts' })],
    ],
    post: [
      ['imports/upcoming-shifts/preview', (body) => preview(body)],
      ['imports/upcoming-shifts/commit', (body) => commit(body)],
      ['imports/:id/invites', (id, body, query) => invite(id, body, query)],
      ['users/invites-sent', (body) => recordSent(body)],
      ['imports/:id/undo', (id) => undo(id)],
    ],
  }
}

module.exports = { create }
