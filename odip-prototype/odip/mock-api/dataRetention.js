// The data-retention endpoints of the mock API (api/v1/data-retention/due, data-retention/{id}/purge) and the per-participant export
// (api/v1/data-export/participants/{id}). Kept in its own module like imports.js. It answers the way the real API does, with the server's
// exact sentences: the purge checks the reason, then the typed last name, and an id it does not know is a 404. All names are fictional.
//
// Two rows are due. Zoe Campbell is not estimated and holds 1,204 rows (Shifts 820, Shift notes 310, Claim lines 60, then a small tail), so the
// screen shows the long-record case. Margaret Doyle's start is estimated, which shows the badge and the footnote. The dates are fixed, not
// relative to today: the shots pin the browser clock to 2026-11-06, and a fixed date keeps every figure on screen the same from run to run.
// The empty, error, busy and 409 states come from the shots script's route overrides, not from flags here.

const DUE = [
  {
    participantId: 'ret-zoe-campbell', firstName: 'Zoe', lastName: 'Campbell', startsOn: '2018-11-06', startEstimated: false, dueOn: '2025-11-06',
    rowCounts: {
      Shifts: 820, ShiftNotes: 310, ClaimLineItems: 60, Invoices: 3, InvoiceLines: 3, ParticipantNotes: 2, Participants: 1, ParticipantBookings: 1,
      ShiftBreaks: 1, FundingPlans: 1, ParticipantConsents: 1, ParticipantMedications: 1,
    },
  },
  {
    participantId: 'ret-margaret-doyle', firstName: 'Margaret', lastName: 'Doyle', startsOn: '2019-09-06', startEstimated: true, dueOn: '2026-09-06',
    rowCounts: { Shifts: 22, ShiftNotes: 8, ParticipantNotes: 4, Participants: 1, ParticipantConsents: 1, FundingPlans: 1, Invoices: 1, ParticipantBookings: 1, ShiftBreaks: 1 },
  },
]

// A finished ZIP with no entries: just the 22-byte end-of-central-directory record, which is what the app checks before it saves a download.
const EMPTY_ZIP = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)])

const slug = (row) => `${row.firstName}-${row.lastName}`.toLowerCase()

function create({ respond, failEnvelope, FILE }) {
  let due = DUE.map((row) => ({ ...row, rowCounts: { ...row.rowCounts } }))
  const purged = new Map()

  const reset = () => {
    due = DUE.map((row) => ({ ...row, rowCounts: { ...row.rowCounts } }))
    purged.clear()
  }

  function purge(id, body) {
    if (purged.has(id)) return purged.get(id)
    const row = due.find((r) => r.participantId === id)
    if (!row) return respond(404, failEnvelope(null, ['Participant not found']))
    const reason = String((body && body.reason) || '').trim()
    if (reason === '') return respond(400, failEnvelope(null, ['Give a reason for the purge.']))
    if (reason.length > 500) return respond(400, failEnvelope(null, ['Keep the reason to 500 characters or fewer.']))
    if (String((body && body.lastName) || '').trim().toLowerCase() !== row.lastName.trim().toLowerCase()) return respond(400, failEnvelope(null, ["The last name doesn't match."]))
    due = due.filter((r) => r.participantId !== id)
    const record = {
      id: `purge-${id}`, participantId: id, confirmedByName: 'Demo Admin', confirmedAt: new Date().toISOString(), reason,
      retentionStartsOn: row.startsOn, retentionStartEstimated: row.startEstimated, dueOn: row.dueOn, rowCounts: row.rowCounts, claimBatchFilesCleared: 0,
    }
    purged.set(id, record)
    return record
  }

  function participantExport(id) {
    const row = due.find((r) => r.participantId === id)
    if (!row) return respond(404, failEnvelope(null, ['Participant not found.']))
    const day = new Date().toISOString().slice(0, 10)
    return {
      [FILE]: EMPTY_ZIP, contentType: 'application/zip',
      headers: { 'Content-Disposition': `attachment; filename="bunya-support-participant-${slug(row)}-${day}.zip"`, 'Cache-Control': 'no-store' },
    }
  }

  return {
    reset,
    get: [
      ['data-retention/due', () => due],
      ['data-export/participants/:id', (id) => participantExport(id)],
    ],
    post: [
      ['data-retention/:id/purge', (id, body) => purge(id, body)],
    ],
  }
}

module.exports = { create }
