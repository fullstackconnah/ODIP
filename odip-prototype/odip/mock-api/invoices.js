// Xero PR1 "real invoices" for the mock API: the fixtures the captures need (SHAPE.md §8, F1 to F11, synthetic names only), the invoice routes, and the issue that
// marking a claim as submitted does. Mirrors ClaimsController / InvoiceService: an invoice per plan- or self-managed payer, agency-managed people go in the BPR CSV,
// a credit note's total is stored positive (the UI writes it negative), and only an Issued invoice "stands" (a voided or credited payer is invoiced again).
//
// Captures switch state with POST /mock/invoices/state: { reset: true } restores every fixture, { invoicesIssued: false } is F11's "before the first invoice",
// { previewMode: 'delay' } holds the submit preview 1.5 s (F9a), { previewMode: 'fail-once' } refuses the next preview with a 500 (F9b).

const ISSUED_ON = '2026-10-22'
const DUE_ON = '2026-11-05'
const CLAIM_REF = (n) => `TC-4300${n}-20261020`

// F10: the longest payer name the shape allows, 120 characters.
const LONG_PAYER = 'Wolfeschlegelsteinhausenbergerdorff Plan Management Services Pty Ltd — Accounts '.padEnd(120, 'X')

const pad4 = (n) => String(n).padStart(4, '0')

// A tiny valid PDF: what the download routes answer.
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

// The invoice register (GET invoices): 120 rows in three pages, worst case first (SHAPE.md section 6). Independent of the per-claim book above; ids start "reg-" so the PDF route answers them
// ("reg-nopdf" is the one that refuses, for the download-error capture). Newest first, then number, as ClaimsController.GetInvoiceRegister orders them.
const REGISTER = (() => {
  const orgs = ['Oassist Disability Services', 'Harbour Respite Co']
  const names = ['Sam Lee', 'Ava Nguyen', 'Jo Carter', 'Mia Chen', 'Ravi Patel', 'Lena Novak']
  const rows = []
  for (let i = 0; i < 120; i++) {
    const day = new Date(Date.UTC(2026, 9, 22 - Math.floor(i / 3)))
    const n = 10000 - i
    const self = i % 3 === 0
    const row = {
      id: `reg-${i}`, kind: 'Invoice', displayNumber: `INV-${String(n).padStart(4, '0')}`, status: i % 7 === 3 ? 'Voided' : i % 7 === 5 ? 'Credited' : 'Issued',
      issueDate: day.toISOString().slice(0, 10), dueDate: '2026-11-05', participantName: names[i % names.length], payerKind: self ? 'SelfManaged' : 'PlanManaged',
      claimReference: `TC-${43000 + i}-20261020`, tripClaimId: `claim-reg-${i}`, total: 100 + i * 13.37, organisationName: orgs[i % 2],
    }
    row.billToName = self ? row.participantName : `Plan Manager ${i} Pty Ltd`
    rows.push(row)
  }
  Object.assign(rows[0], { participantName: 'Wolfeschlegelsteinhausenberger-Fotheringham Participant Name', billToName: 'Plan Management Services of the Greater Wolfeschlegelsteinhausenberger Region' })
  Object.assign(rows[1], { id: 'reg-credit', kind: 'CreditNote', displayNumber: 'CN-0007', status: 'Issued', creditsDisplayNumber: 'INV-0012', total: -123456.78 })
  Object.assign(rows[2], { id: 'reg-deleted', status: 'Voided', tripClaimId: undefined })
  Object.assign(rows[3], { id: 'reg-nopdf' })
  return rows
})()

function registerPage(params) {
  const q = (params.get('search') ?? '').trim().toLowerCase()
  const kind = params.get('kind'), status = params.get('status'), from = params.get('from'), to = params.get('to')
  const matches = REGISTER.filter((r) => (!kind || r.kind === kind) && (!status || r.status === status) && (!from || r.issueDate >= from) && (!to || r.issueDate <= to)
    && (params.get('deletedClaimOnly') !== 'true' || !r.tripClaimId)
    && (!q || [r.displayNumber, r.participantName, r.billToName, r.claimReference].some((v) => v.toLowerCase().includes(q))))
  const pageSize = Number(params.get('pageSize')) || 50
  const page = Math.max(1, Number(params.get('page')) || 1)
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize))
  return {
    items: matches.slice((page - 1) * pageSize, page * pageSize), totalCount: matches.length, page, pageSize, totalPages,
    hasNext: page < totalPages, hasPrevious: page > 1,
  }
}

function create({ respond, failEnvelope, claims, lineItemsByClaimId }) {
  const fail = (status, message) => respond(status, failEnvelope(null, [message]))
  const payer = (id, participantName, billToName, payerKind, total) => ({ groupId: id, participantName, billToName, payerKind, total })
  const plan = payer('b-inv-plan', 'Sam Lee', 'Pat Morgan — Harbour Plan Co', 'PlanManaged', 430.58)
  const self = payer('b-inv-self', 'Ava Nguyen', 'Ava Nguyen', 'SelfManaged', 1234.56)

  let settings, book, nextNumber, nextCredit, previewMode

  /** One invoice row as GET claims/:id/invoices sends it (InvoiceSummaryDto). */
  function invoice(claimId, number, group, status, extra = {}) {
    return {
      id: `inv-${claimId}-${number}`, kind: 'Invoice', number, displayNumber: `${extra.prefix ?? settings.invoiceNumberPrefix}${pad4(number)}`, status,
      groupId: group.groupId, participantName: group.participantName, billToName: group.billToName, payerKind: group.payerKind,
      issueDate: ISSUED_ON, dueDate: DUE_ON, total: group.total, paymentRecorded: false, ...extra, prefix: undefined,
    }
  }
  function creditNote(claimId, number, credited) {
    const { dueDate, ...row } = credited
    return { ...row, id: `cn-${claimId}-${number}`, kind: 'CreditNote', number, displayNumber: `${settings.creditNotePrefix}${pad4(number)}`, status: 'Issued',
      creditsDisplayNumber: credited.displayNumber, creditedByDisplayNumber: undefined, paymentRecorded: false }
  }

  /** A claim (Trip kind unless a participant id is given) with one line per payer and agency person, added to server.js's own fixtures so the claim pages load. */
  function addClaim(id, n, status, groups, agency, { shiftOf } = {}) {
    const claim = shiftOf
      ? { id, kind: 'Shift', participantId: shiftOf, periodFrom: '2026-10-01', periodTo: '2026-10-14', tripName: '' }
      : { id, kind: 'Trip', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender' }
    const people = [...groups.map((g) => [g.participantName, g.payerKind, g.total, g.groupId]), ...agency.map((name, i) => [name, 'AgencyManaged', 300, `b-inv-agency-${i}`])]
    Object.assign(claim, { status, claimReference: CLAIM_REF(n), totalAmount: people.reduce((sum, p) => sum + p[2], 0), createdAt: '2026-10-20T09:00:00Z' })
    if (status !== 'Draft') claim.submittedDate = '2026-10-21T23:30:00Z'
    const at = claims.findIndex((c) => c.id === id)
    if (at >= 0) claims[at] = claim
    else claims.push(claim)
    lineItemsByClaimId[id] = people.map(([name, planType, total, groupId], i) => ({
      id: `cli-${id}-${i}`, tripClaimId: id, ...(shiftOf ? { shiftId: `sh-inv-${i}` } : { participantBookingId: groupId }), participantId: `p-inv-${i}`,
      participantName: name, ndisNumber: '43•••••00', planType, supportItemCode: '04_104_0125_6_1', dayType: 'Weekday',
      supportsDeliveredFrom: '2026-10-02', supportsDeliveredTo: '2026-10-02', hours: 1, unitPrice: total, totalAmount: total, gstCode: 'P2',
      claimType: 'Standard', cancellationReason: null, participantApproved: true, status: status === 'Draft' ? 'Draft' : 'Submitted', rejectionReason: null, paidAmount: null,
    }))
    book[id] = { groups, agencyCount: agency.length, invoices: [], legacy: false, missingSettings: false }
    return book[id]
  }

  function reset() {
    settings = { invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, invoicesIssued: true }
    book = {}
    nextNumber = 46
    nextCredit = 8
    previewMode = 'normal'
    const five = ['Mia Chen', 'Leo Patel', 'Zoe Brown', 'Kai Wilson', 'Ivy Taylor'].map((name, i) => payer(`b-inv-five-${i}`, name, name, 'SelfManaged', 200 + i * 10))

    addClaim('claim-inv-f1', 1, 'Draft', [plan, self], ['Noah Agency'])
    const f2 = addClaim('claim-inv-f2', 2, 'Submitted', [plan, self], ['Noah Agency'])
    f2.invoices = [invoice('claim-inv-f2', 42, plan, 'Issued'), invoice('claim-inv-f2', 43, self, 'Issued', { paymentRecorded: true })]
    const f3 = addClaim('claim-inv-f3', 3, 'Submitted', [plan, self], [])
    f3.invoices = [invoice('claim-inv-f3', 42, plan, 'Voided'), invoice('claim-inv-f3', 43, self, 'Issued'), invoice('claim-inv-f3', 45, plan, 'Issued')]
    const f4 = addClaim('claim-inv-f4', 4, 'Paid', [plan, self], [])
    const credited = invoice('claim-inv-f4', 43, self, 'Credited', { creditedByDisplayNumber: 'CN-0007', paymentRecorded: true })
    f4.invoices = [invoice('claim-inv-f4', 42, plan, 'Issued', { paymentRecorded: true }), credited, creditNote('claim-inv-f4', 7, credited)]
    addClaim('claim-inv-f5', 5, 'Submitted', [plan, self], []).legacy = true
    addClaim('claim-inv-f6', 6, 'Submitted', [], ['Noah Agency', 'Ella Agency'])
    addClaim('claim-inv-f7', 7, 'Draft', [payer('p-inv-0', 'Sam Lee', 'Pat Morgan — Harbour Plan Co', 'PlanManaged', 552)], ['Noah Agency'], { shiftOf: 'p-inv-0' })
    addClaim('claim-inv-f8', 8, 'Draft', [self], []).missingSettings = true
    addClaim('claim-inv-five', 9, 'Draft', five, [])
    const worst = payer('b-inv-long', 'Sam Lee', LONG_PAYER, 'PlanManaged', 123456.78)
    addClaim('claim-inv-f10', 10, 'Submitted', [worst], []).invoices = [invoice('claim-inv-f10', 12345678, worst, 'Issued', { prefix: 'OASSISTINV' })]
  }
  reset()

  const live = (entry) => entry.invoices.filter((i) => i.kind === 'Invoice' && i.status === 'Issued')
  const due = (entry) => entry.groups.filter((g) => !live(entry).some((i) => i.groupId === g.groupId))
  const submittable = (claim) => ['Draft', 'Ready', 'Rejected'].includes(claim.status)
  const find = (invoiceId) => {
    for (const [claimId, entry] of Object.entries(book)) {
      const row = entry.invoices.find((i) => i.id === invoiceId)
      if (row) return { claimId, entry, row }
    }
    return null
  }

  /** ClaimInvoicesDto: the state the server decides (D19), each credit note under the invoice it credits. */
  function claimInvoices(claim) {
    const entry = book[claim.id] ?? { groups: [], agencyCount: 0, invoices: [] }
    const ordered = entry.invoices.filter((i) => i.kind === 'Invoice').sort((a, b) => a.number - b.number)
      .flatMap((i) => [i, ...entry.invoices.filter((c) => c.kind === 'CreditNote' && c.creditsDisplayNumber === i.displayNumber)])
    const invoiceState = ordered.length > 0 ? 'issued' : entry.legacy ? 'legacy' : entry.groups.length === 0 ? 'none' : submittable(claim) ? 'preview' : 'none'
    return { invoiceState, invoices: ordered, groups: entry.groups, agencyCount: entry.agencyCount }
  }

  /** Called by PUT claims/:id before the move to Submitted: a refusal (409) or nothing, after issuing every due payer. */
  function issueOnSubmit(claim) {
    const entry = book[claim.id]
    if (!entry || !submittable(claim)) return null
    const groups = due(entry)
    if (groups.length > 0 && entry.missingSettings) return fail(409, "Set up your organisation's invoice details in Settings first.")
    for (const g of groups) entry.invoices.push(invoice(claim.id, nextNumber++, g, 'Issued'))
    if (groups.length > 0) settings.invoicesIssued = true
    return null
  }

  /** Called by DELETE claims/:id: the server's refusal while an invoice stands. */
  function refuseDelete(claimId) {
    const standing = book[claimId] ? live(book[claimId]).map((i) => i.displayNumber) : []
    if (standing.length === 0) return null
    const names = standing.length === 1 ? standing[0] : `${standing.slice(0, -1).join(', ')} and ${standing[standing.length - 1]}`
    return fail(409, `Void ${names} first, then delete the claim.`)
  }

  function preview(body) {
    const ids = Array.isArray(body.claimIds) ? body.claimIds : []
    if (ids.length < 1 || ids.length > 100) return fail(400, 'Choose between 1 and 100 claims.')
    if (previewMode === 'fail-once') {
      previewMode = 'normal'
      return fail(500, 'An unexpected error occurred.')
    }
    let predicted = nextNumber
    const result = { claims: [], invoiceCount: 0 }
    for (const id of ids) {
      const claim = claims.find((c) => c.id === id)
      if (!claim) return fail(404, 'Claim not found')
      const entry = book[id] ?? { groups: [], invoices: [], missingSettings: false }
      const toIssue = submittable(claim) ? due(entry) : []
      result.claims.push({
        claimId: id, alreadyIssued: live(entry).length, missingSettings: toIssue.length > 0 && entry.missingSettings,
        toIssue: toIssue.map((g) => ({ ...g, payerKind: undefined, predictedNumber: entry.missingSettings ? undefined : `${settings.invoiceNumberPrefix}${pad4(predicted++)}` })),
      })
      result.invoiceCount += toIssue.length
    }
    return previewMode === 'delay' ? new Promise((resolve) => setTimeout(() => resolve(result), 1500)) : result
  }

  function correct(invoiceId, body, mode) {
    const found = find(invoiceId)
    if (!found) return fail(404, 'Invoice not found.')
    const { claimId, entry, row } = found
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) return fail(400, mode === 'void' ? "Say why it's being voided." : "Say why it's being credited.")
    if (reason.length > 500) return fail(400, 'The reason is 500 characters at most.')
    if (row.kind === 'CreditNote') return fail(409, `${row.displayNumber} is a credit note, so it stands as issued.`)
    if (row.status === 'Voided') return fail(409, `${row.displayNumber} is already void.`)
    if (row.status === 'Credited') return fail(409, `${row.displayNumber} is already credited.`)
    if (mode === 'void') {
      if (row.paymentRecorded) return fail(409, 'A payment is recorded, so issue a credit note instead.')
      row.status = 'Voided'
      return row
    }
    const note = creditNote(claimId, nextCredit++, row)
    row.status = 'Credited'
    row.creditedByDisplayNumber = note.displayNumber
    entry.invoices.push(note)
    return note
  }

  const settingsDto = (base) => ({
    ...base, ...settings,
    nextInvoiceDisplayNumber: `${settings.invoiceNumberPrefix}${pad4(settings.invoicesIssued ? nextNumber : settings.invoiceStartNumber)}`,
  })

  const file = () => ({ [FILE]: PDF })

  return {
    claimInvoices, issueOnSubmit, refuseDelete, settingsDto, file,
    get: [
      ['claims/:id/invoices', (id) => {
        const claim = claims.find((c) => c.id === id)
        return claim ? claimInvoices(claim) : fail(404, 'Claim not found')
      }],
      ['claims/:id/invoices/:id', () => file()],
      ['invoices', (params) => registerPage(params)],
      ['invoices/:id/pdf', (id) => (id === 'reg-nopdf' ? respond(500, failEnvelope(null, [])) : find(id) || id.startsWith('reg-') ? file() : fail(404, 'Invoice not found.'))],
    ],
    delete: [['claims/:id', (id) => refuseDelete(id) ?? true]],
    post: [
      ['claims/submit-preview', (body) => preview(body)],
      ['invoices/:id/void', (id, body) => correct(id, body, 'void')],
      ['invoices/:id/credit-note', (id, body) => correct(id, body, 'credit')],
      ['mock/invoices/state', (body) => {
        if (body.reset) reset()
        if (typeof body.invoicesIssued === 'boolean') settings.invoicesIssued = body.invoicesIssued
        if (['normal', 'delay', 'fail-once'].includes(body.previewMode)) previewMode = body.previewMode
        return { ...settings, previewMode }
      }],
    ],
    /** PUT provider-settings: keeps the numbering fields; a changed start number is refused once an invoice is issued, an unchanged echo is not. */
    saveNumbering(body) {
      if (body.invoiceStartNumber != null && body.invoiceStartNumber !== settings.invoiceStartNumber && settings.invoicesIssued) {
        return fail(409, "Invoice numbers have started, so the starting number can't change.")
      }
      for (const key of ['invoiceNumberPrefix', 'creditNotePrefix', 'invoiceStartNumber', 'paymentTermsDays']) if (body[key] != null) settings[key] = body[key]
      return null
    },
  }
}

const FILE = Symbol('file')

module.exports = { create, FILE }
