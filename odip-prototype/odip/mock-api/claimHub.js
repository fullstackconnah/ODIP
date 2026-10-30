// The NDIA claims hub for the mock API (SHAPE.md, PLAN.md §9): the claimable lines, the bulk payment request files built from them, and their results.
// Synthetic names only. Ages are fixed numbers, as the server works them out against the provider's today: 59, 60, 80, 90 and 91 are the band edges.
//
// Captures switch state with POST /mock/claim-batches/state: { reset: true } restores every fixture, { registrationMissing: true } is the setup Callout,
// { empty: true } empties every list.

const FILE_CSV = 'RegistrationNumber,NDISNumber,SupportsDeliveredFrom,SupportsDeliveredTo,SupportNumber,ClaimReference,Quantity,Hours,UnitPrice,GSTCode\n'
const NAMES = ['Ava Nguyen', 'Sam Lee', 'Jo Carter', 'Mia Chen', 'Ravi Patel', 'Lena Novak', 'Tom Baker', 'Priya Shah']
const ITEMS = [['01_011_0107_1_1', 'Assistance With Self-Care Activities - Standard - Weekday Daytime'], ['04_104_0125_6_1', 'Access Community Social and Rec Activ - Standard - Weekday Daytime']]

const isoDaysAgo = (days) => new Date(Date.UTC(2026, 9, 30) - days * 86400000).toISOString().slice(0, 10)
const band = (days) => (days >= 91 ? 'over90' : days >= 80 ? 'red' : days >= 60 ? 'amber' : 'none')

function line(n, claimNo, participant, ageDays, problems = []) {
  const [supportNumber, supportName] = ITEMS[n % 2]
  const hours = 2 + (n % 3) * 0.5
  const unitPrice = 67.56
  return {
    lineId: `hl-${n}`, claimId: `hub-claim-${claimNo}`, claimReference: `TC-${45000 + claimNo}-20261020`, claimKind: n % 2 ? 'trip' : 'shift',
    participantId: `p-hub-${claimNo}`, participantName: participant, supportNumber, supportName, from: isoDaysAgo(ageDays), to: isoDaysAgo(ageDays),
    hours, unitPrice, totalAmount: Math.round(hours * unitPrice * 100) / 100, gstCode: 'P2', claimType: 'Standard', fundingType: 'agency',
    ageDays, ageBand: band(ageDays), nextAttempt: 1, problems,
  }
}

function seedReady() {
  const rows = [
    line(1, 1, 'Ava Nguyen', 91), line(2, 1, 'Ava Nguyen', 90),
    line(3, 2, 'Sam Lee', 80),
    line(4, 3, 'Jo Carter', 60), line(5, 3, 'Jo Carter', 59),
    // A claim mixing a blocked line (two failures) and a clean one: the clean one can't be sent alone (a claim is sent whole).
    line(6, 4, 'Mia Chen', 40, [
      { rule: 'PriceLimit', severity: 'block', message: 'Price is over the limit of $67.56' },
      { rule: 'GstCode', severity: 'block', message: 'GST code must be P1, P2 or P5' },
    ]),
    line(7, 4, 'Mia Chen', 40),
    line(8, 5, 'Ravi Patel', 30, [{ rule: 'NdisNumber', severity: 'block', message: 'NDIS number must be 9 digits starting 43' }]),
  ]
  for (let i = 0; i < 52; i++) rows.push(line(20 + i, 10 + Math.floor(i / 2), NAMES[i % NAMES.length], 2 + (i % 50)))
  return rows
}

const NOW = '2026-10-30T01:00:00Z'
const daysAgoInstant = (d) => new Date(Date.parse(NOW) - d * 86400000).toISOString()

function batchRow(id, fileName, status, built, extra = {}) {
  return {
    id, fileName, status, createdAt: daysAgoInstant(built), createdByName: 'Sam Lee', lineCount: 0, totalAmount: 0,
    pending: 0, successful: 0, rejected: 0, withdrawn: 0, paid: 0, paidAmount: 0, ...extra,
  }
}

function batchLines(batchId, count, outcomeAt) {
  return Array.from({ length: count }, (_, i) => {
    const [supportNumber] = ITEMS[i % 2]
    const outcome = outcomeAt(i)
    return {
      batchLineId: `${batchId}-l${i}`, claimLineItemId: `${batchId}-cli${i}`, claimId: `hub-claim-${batchId}-${i}`, claimReference: `TC-${46000 + i}-20261001`,
      participantName: NAMES[i % NAMES.length], supportNumber, from: isoDaysAgo(20 + i), to: isoDaysAgo(20 + i), amount: 135.12, attempt: 1,
      rowReference: `${batchId}-r${i}`, outcome, ...(outcome === 'Successful' ? { resultAmount: 135.12 } : {}),
    }
  })
}

function create({ respond, failEnvelope, FILE }) {
  let ready, rejected, managed, batches, lines, seq, registrationMissing

  const fail = (status, message, data) => respond(status, failEnvelope(data ?? null, [message]))

  function counts(b) {
    const ls = lines[b.id] || []
    const of = (o) => ls.filter((l) => l.outcome === o).length
    const paidLines = ls.filter((l) => l.paidAmount != null)
    return Object.assign(b, {
      lineCount: ls.length, totalAmount: Math.round(ls.reduce((s, l) => s + l.amount, 0) * 100) / 100,
      pending: of('Pending'), successful: of('Successful'), rejected: of('Rejected'), withdrawn: of('Withdrawn'),
      paid: paidLines.length, paidAmount: Math.round(paidLines.reduce((s, l) => s + l.paidAmount, 0) * 100) / 100,
    })
  }

  function reset() {
    ready = seedReady()
    registrationMissing = false
    seq = 2
    batches = [
      batchRow('b-built', 'BPR261030001.csv', 'Built', 0),
      batchRow('b-uploaded', 'BPR261028001.csv', 'Uploaded', 2, { uploadedAt: daysAgoInstant(2), uploadedByName: 'Sam Lee' }),
      batchRow('b-results', 'BPR261020001.csv', 'ResultsImported', 10, { uploadedAt: daysAgoInstant(10), uploadedByName: 'Jo Carter', resultsImportedAt: daysAgoInstant(8) }),
      batchRow('b-partial', 'BPR261015001.csv', 'ResultsImported', 15, { uploadedAt: daysAgoInstant(15), uploadedByName: 'Jo Carter', resultsImportedAt: daysAgoInstant(13) }),
      batchRow('b-paid', 'BPR261001001.csv', 'ResultsImported', 29, { uploadedAt: daysAgoInstant(29), uploadedByName: 'Jo Carter', resultsImportedAt: daysAgoInstant(27) }),
      batchRow('b-discarded', 'BPR260930001.csv', 'Discarded', 30, { discardedAt: daysAgoInstant(30) }),
    ]
    lines = {
      'b-built': batchLines('b-built', 4, () => 'Pending'),
      'b-uploaded': batchLines('b-uploaded', 120, () => 'Pending'),
      'b-results': batchLines('b-results', 12, (i) => (i >= 6 ? 'Rejected' : 'Successful')),
      'b-partial': batchLines('b-partial', 5, (i) => (i < 2 ? 'Rejected' : 'Pending')),
      'b-paid': batchLines('b-paid', 3, () => 'Successful'),
      'b-discarded': batchLines('b-discarded', 2, () => 'Withdrawn'),
    }
    lines['b-paid'].forEach((l) => { l.paidAmount = l.amount; l.lineStatus = 'Paid' })
    // The server sends the SHAPE §6 hint by code; a code it does not know sends none.
    const hints = { V17: "Their budget doesn't cover this line. Check their plan with them or their plan manager.", C38: "Lower the unit price to the price guide limit for that date." }
    const codes = [['V17', true, 'Not enough funding left in the budget.'], ['V17', true, 'Not enough funding left in the budget.'], ['V17', true, 'Not enough funding left.'],
      ['C38', false, 'Unit price exceeds the price limit.'], ['C38', false, 'Unit price exceeds the price limit.'], ['X99', true, 'Unexpected error.']]
    rejected = lines['b-results'].slice(6).map((bl, i) => {
      const [code, needsDecision, message] = codes[i]
      Object.assign(bl, { rejectCode: code, rejectMessage: message, needsDecision })
      return {
        ...line(100 + i, 300 + i, NAMES[i % NAMES.length], 61 + i * 7), batchLineId: bl.batchLineId, batchId: 'b-results', fileName: 'BPR261020001.csv',
        rejectCode: code, rejectMessage: message, needsDecision, hint: hints[code] ?? '', rejectedAt: daysAgoInstant(8), nextAttempt: 2,
      }
    })
    managed = [
      { claimId: 'm-1', claimReference: 'TC-47001-20261020', participantId: 'p-m1', participantName: 'Lena Novak', fundingType: 'plan', claimStatus: 'Submitted', totalAmount: 420.5, ageDays: 12, ageBand: 'none', invoices: [{ invoiceId: 'inv-m1', number: 'INV-00042', status: 'Issued', total: 420.5, issuedAt: '2026-10-22' }] },
      { claimId: 'm-2', claimReference: 'TC-47002-20261020', participantId: 'p-m2', participantName: 'Tom Baker', fundingType: 'self', claimStatus: 'Draft', totalAmount: 88, ageDays: 4, ageBand: 'none', invoices: [] },
      { claimId: 'm-3', claimReference: 'TC-47003-20261020', participantId: 'p-m3', participantName: 'Priya Shah', fundingType: 'plan', claimStatus: 'Paid', totalAmount: 1203.75, ageDays: 40, ageBand: 'none', invoices: [{ invoiceId: 'inv-m3', number: 'INV-00031', status: 'Issued', total: 1203.75, issuedAt: '2026-10-01' }] },
    ]
    batches.forEach(counts)
  }
  reset()

  const csv = (b) => ({ [FILE]: Buffer.from(FILE_CSV), contentType: 'text/csv', headers: { 'Content-Disposition': `attachment; filename="${b.fileName}"`, 'X-Claim-Batch-Id': b.id } })
  const findBatch = (id) => batches.find((b) => b.id === id)

  function build(body) {
    if (registrationMissing) return fail(400, 'Add your NDIS registration number in Settings first.', { problems: [] })
    const ids = new Set([...(body.lineIds || []), ...(body.confirmedLineIds || [])])
    const picked = ready.filter((l) => ids.has(l.lineId) || (body.claimIds || []).includes(l.claimId))
    const resend = rejected.filter((l) => ids.has(l.lineId))
    if (!picked.length && !resend.length) return fail(400, 'Tick the lines to put in the file.', { problems: [] })
    const blocked = picked.filter((l) => l.problems.some((p) => p.severity === 'block'))
    if (blocked.length) {
      return fail(400, 'Some lines failed the checks.', { problems: blocked.map((l) => ({ lineId: l.lineId, claimReference: l.claimReference, rule: l.problems[0].rule, message: l.problems[0].message })) })
    }
    seq += 1
    const b = batchRow(`b-new-${seq}`, `BPR261030${String(seq).padStart(3, '0')}.csv`, 'Built', 0)
    lines[b.id] = [...picked, ...resend].map((l, i) => ({
      batchLineId: `${b.id}-l${i}`, claimLineItemId: l.lineId, claimId: l.claimId, claimReference: l.claimReference, participantName: l.participantName,
      supportNumber: l.supportNumber, from: l.from, to: l.to, amount: l.totalAmount, attempt: l.nextAttempt, rowReference: `${b.id}-r${i}`, outcome: 'Pending',
    }))
    ready = ready.filter((l) => !picked.includes(l))
    rejected = rejected.filter((l) => !resend.includes(l))
    batches.unshift(counts(b))
    return csv(b)
  }

  function importResults(id, body) {
    const b = findBatch(id)
    if (!b) return fail(404, 'File not found.')
    if (b.status !== 'Uploaded' && b.status !== 'ResultsImported') return fail(409, "This file isn't uploaded yet.")
    const raw = String(body._form || '')
    if (!raw.includes('filename=')) return fail(400, 'Choose the results file to upload.')
    if (raw.includes('bad-headers')) return fail(400, "We couldn't read this results file. We expected columns for claim reference, result, reject code, but found: Name, Amount.")
    const ls = lines[b.id]
    const pending = ls.filter((l) => l.outcome === 'Pending')
    pending.forEach((l, i) => {
      if (i === pending.length - 1) Object.assign(l, { outcome: 'Rejected', rejectCode: 'V17', rejectMessage: 'Not enough funding left.', needsDecision: true })
      else Object.assign(l, { outcome: 'Successful', resultAmount: l.amount })
    })
    b.status = 'ResultsImported'
    b.resultsImportedAt = NOW
    counts(b)
    return {
      successful: Math.max(0, pending.length - 1), rejected: pending.length ? 1 : 0, unchanged: pending.length ? 0 : ls.length, leftAlone: 0,
      conflicts: [], unknownReferences: pending.length ? ['BPR-OTHER-0001', 'BPR-OTHER-0002', 'BPR-OTHER-0003'] : [], unreadRows: [], batch: b,
    }
  }

  return {
    get: [
      ['claim-hub/lines', () => (registrationMissing
        ? { ready, rejected, managed, registrationProblem: 'Add your NDIS registration number in Settings first.' }
        : { ready, rejected, managed })],
      ['claim-batches', () => batches],
      ['claim-batches/:id', (id) => (findBatch(id) ? { ...findBatch(id), lines: lines[id] } : fail(404, 'File not found.'))],
      ['claim-batches/:id/file', (id) => {
        const b = findBatch(id)
        if (!b) return fail(404, 'File not found.')
        return b.status === 'Discarded' ? fail(409, 'This file was discarded. Build a new one.') : csv(b)
      }],
      ['claims/:id/bpr-csv', (id) => {
        const inBatch = batches.find((b) => b.status !== 'Discarded' && (lines[b.id] || []).some((l) => l.claimId === id))
        if (inBatch?.status === 'Uploaded') return fail(409, `This claim was sent in ${inBatch.fileName}. Import that file's results in Claims before lodging it again.`)
        if (inBatch?.status === 'Built' && lines[inBatch.id].every((l) => l.claimId === id)) return csv(inBatch)
        if (inBatch?.status === 'Built') return fail(409, `This claim is in ${inBatch.fileName} with other claims. Download it from Claims, or discard it first.`)
        return build({ claimIds: [id] }) ?? fail(400, 'This claim has no NDIA-managed lines.')
      }],
    ],
    post: [
      ['claim-batches', (body) => build(body)],
      ['claim-batches/:id/uploaded', (id) => {
        const b = findBatch(id)
        if (!b) return fail(404, 'File not found.')
        if (b.status !== 'Built') return fail(409, 'Only a built file can be marked as uploaded.')
        Object.assign(b, { status: 'Uploaded', uploadedAt: NOW, uploadedByName: 'Sam Lee' })
        return b
      }],
      ['claim-batches/:id/discard', (id) => {
        const b = findBatch(id)
        if (!b) return fail(404, 'File not found.')
        if (b.status !== 'Built') return fail(409, "Only a file that hasn't been uploaded can be discarded.")
        lines[id].forEach((l) => { l.outcome = 'Withdrawn' })
        Object.assign(b, { status: 'Discarded', discardedAt: NOW })
        return counts(b)
      }],
      ['claim-batches/:id/results', (id, body) => importResults(id, body)],
      ['claim-batches/:id/paid', (id, body) => {
        const b = findBatch(id)
        if (!b) return fail(404, 'File not found.')
        const amounts = new Map((body.lines || []).map((l) => [l.batchLineId, l.amount]))
        const over = lines[id].filter((l) => l.outcome === 'Successful' && (amounts.get(l.batchLineId) ?? l.amount) > l.amount)
        if (over.length) return fail(400, "Can't be more than the amount claimed.", { problems: over.map((l) => ({ batchLineId: l.batchLineId, message: "Can't be more than the amount claimed." })) })
        lines[id].filter((l) => l.outcome === 'Successful').forEach((l) => { l.paidAmount = amounts.get(l.batchLineId) ?? l.amount; l.lineStatus = 'Paid' })
        return counts(b)
      }],
      ['claim-batch-lines/:id/dismiss', (id) => {
        const r = rejected.find((l) => l.batchLineId === id)
        if (!r?.needsDecision) return fail(409, 'Only a rejected line waiting on a decision can be dismissed.')
        rejected = rejected.filter((l) => l !== r)
        const bl = Object.values(lines).flat().find((l) => l.batchLineId === id)
        if (bl) bl.dismissedAt = NOW
        return bl ?? { batchLineId: id }
      }],
      ['mock/claim-batches/state', (body) => {
        if (body.reset) reset()
        if (typeof body.registrationMissing === 'boolean') registrationMissing = body.registrationMissing
        if (body.empty) { ready = []; rejected = []; managed = []; batches = [] }
        return { registrationMissing, ready: ready.length, batches: batches.length }
      }],
    ],
  }
}

module.exports = { create }
