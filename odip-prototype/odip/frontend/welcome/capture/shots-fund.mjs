/**
 * Stage 5: FUND AND CLAIM shots (per-traveller funding split, claim preview, claim batch). Same shape as shots.mjs.
 */
export const shots = []

const envelope = (data) => JSON.stringify({ success: true, data, message: null, errors: null })

// ---- Claim detail: per-traveller funding split (GET claims/claim-0003) ------------------------------------------
// A Draft trip claim for Byron Bay Winter Weekender (BBW-2607, 10-12 Jul 2026, mock trip t-0004) with one traveller on each
// funding type, using the PlanType values the backend really sends (AgencyManaged / PlanManaged / SelfManaged).
// Travellers, plan types and masked NDIS numbers are the mock's; the claim reference follows the real generator
// (TC-{tripCode}-{yyyyMMdd}); hours and unit prices are obviously-sample round figures. The trip ran Fri-Sun, so each
// traveller has a Weekday line and a Weekend line (the generator splits by day type).
const line = (n, bookingId, participantId, name, ndis, planType, dayType, from, to, hours, unitPrice, code) => ({
  id: `cli-01${n}`, tripClaimId: 'claim-0003', participantBookingId: bookingId, participantId,
  participantName: name, ndisNumber: ndis, planType, supportItemCode: code, dayType,
  supportsDeliveredFrom: from, supportsDeliveredTo: to, hours, unitPrice, totalAmount: hours * unitPrice,
  gstCode: 'GST', claimType: 'Standard', cancellationReason: null, participantApproved: true, status: 'Draft',
  rejectionReason: null, paidAmount: null,
})
const WEEKDAY = '01_002_0117_1_1'
const WEEKEND = '01_003_0117_1_1'
const bbwClaim = {
  id: 'claim-0003', kind: 'Trip', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender',
  status: 'Draft', claimReference: 'TC-BBW-2607-20260713', totalAmount: 5760,
  createdAt: '2026-07-13T09:00:00+10:00', totalApprovedAmount: 0, authorisedByStaffId: null, authorisedByStaffName: null,
  paidDate: null,
  notes: 'BPR CSV covers the agency-managed line items. Plan-managed and self-managed travellers are invoiced individually.',
  lineItems: [
    line(1, 'b-0101', 'p-0001', 'Liam Okafor', '43•••••89', 'PlanManaged', 'Weekday', '2026-07-10', '2026-07-10', 12, 40, WEEKDAY),
    line(2, 'b-0101', 'p-0001', 'Liam Okafor', '43•••••89', 'PlanManaged', 'Weekend', '2026-07-11', '2026-07-12', 24, 56, WEEKEND),
    line(3, 'b-0102', 'p-0002', 'Sienna Whitfield', '43•••••12', 'AgencyManaged', 'Weekday', '2026-07-10', '2026-07-10', 12, 48, WEEKDAY),
    line(4, 'b-0102', 'p-0002', 'Sienna Whitfield', '43•••••12', 'AgencyManaged', 'Weekend', '2026-07-11', '2026-07-12', 24, 64, WEEKEND),
    line(5, 'b-0103', 'p-0003', 'Marcus Tran', '43•••••57', 'SelfManaged', 'Weekday', '2026-07-10', '2026-07-10', 12, 40, WEEKDAY),
    line(6, 'b-0103', 'p-0003', 'Marcus Tran', '43•••••57', 'SelfManaged', 'Weekend', '2026-07-11', '2026-07-12', 24, 56, WEEKEND),
  ],
}

shots.push({
  name: 'fund-claim-funding-split',
  stage: 'fund-and-claim',
  priority: 'P1',
  route: '/claims/claim-0003',
  cropTarget: 'Claim detail: title row with the BPR CSV and Mark as Submitted buttons, the totals bar, the notes card and the Line Items table with a plan-type badge and Invoice link per traveller',
  fixture: true,
  now: '2026-07-13T10:00:00+10:00',
  alt: 'Draft trip claim TC-BBW-2607-20260713 for Byron Bay Winter Weekender with BPR CSV and Mark as Submitted buttons and a total of $5760.00, above a Line Items table of six lines for three travellers on different funding types: Liam Okafor Plan Managed, Sienna Whitfield AgencyManaged and Marcus Tran Self Managed, with an Invoice link on the plan-managed and self-managed lines only.',
  notes: 'Fixture: the mock claim has a single self-managed line, so GET claims/claim-0003 is fed a Draft trip claim for mock trip BBW-2607 with one traveller per funding type. Plan types use the real enum values. App quirk visible: the page only maps the legacy value NdiaManaged to a label, so the agency-managed badge shows the raw enum text AgencyManaged (Plan Managed and Self Managed are spaced). Hours and unit prices are round sample figures; reference follows the real TC-{tripCode}-{yyyyMMdd} format.',
  async setup(page) {
    await page.route(/\/api\/v1\/claims\/claim-0003(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: envelope(bbwClaim) }))
  },
  async run({ page, goto }) {
    await goto('/claims/claim-0003')
    await page.getByRole('heading', { level: 1, name: /Claim TC-BBW-2607-20260713/ }).waitFor()
    await page.getByText('Marcus Tran').first().waitFor()
    const title = page.locator('main h1').first()
    const bpr = page.getByRole('button', { name: 'BPR CSV' })
    const card = page.getByRole('heading', { name: 'Line Items' }).locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]')
    return { locator: [title, bpr, card], pad: 8 }
  },
})

// ---- Generate NDIS Claim -> Claim Preview modal (POST trips/t-0004/claims/preview) ------------------------------------
// Same three travellers and line items as the claim above (so Preview -> Confirm & Generate -> Claim reads as one flow).
// Trip times (08:30 - 16:00) and 12 active hours/day are the mock trip record; state NSW because the trip is Byron Bay.
const previewResponse = {
  departureTime: '08:30', returnTime: '16:00', activeHoursPerDay: 12, staffCount: 3, state: 'NSW',
  confirmedParticipantCount: 3,
  totalAmount: bbwClaim.totalAmount,
  lineItems: bbwClaim.lineItems.map((l) => ({
    participantName: l.participantName, ndisNumber: l.ndisNumber, supportItemCode: l.supportItemCode,
    dayTypeLabel: l.dayType, dayType: l.dayType, supportsDeliveredFrom: l.supportsDeliveredFrom,
    supportsDeliveredTo: l.supportsDeliveredTo, hours: l.hours, unitPrice: l.unitPrice, totalAmount: l.totalAmount,
  })),
}

shots.push({
  name: 'fund-claim-preview',
  stage: 'fund-and-claim',
  priority: 'P2',
  route: '/trips/t-0004?tab=claims',
  cropTarget: 'The Claim Preview modal: total estimate, participants / staff / state / times summary, and the per-traveller line items table, with Back, Cancel and Confirm & Generate',
  fixture: true,
  now: '2026-07-13T10:00:00+10:00',
  viewport: { width: 1280, height: 900 },
  alt: 'Claim Preview dialog with a total estimate of $5760.00, a summary line (3 participants, 3 staff, NSW, departure 08:30, return 16:00, 12 hours a day) and a Line Items table of six rows of Weekday and Weekend supports for Liam Okafor, Sienna Whitfield and Marcus Tran with dates, hours and amounts, above Back, Cancel and Confirm and Generate buttons.',
  notes: 'Fixture: the mock has no claim preview, so POST trips/t-0004/claims/preview is fed the same line items as fund-claim-funding-split. The modal is the real Generate NDIS Claim flow (Generate Claim, then Preview Claim). The preview table has no unit price column in the app (Participant, Day Type, Dates, Hours, Amount). The dark page scrim is switched off for the crop so the rounded corners are not dark wedges.',
  async setup(page) {
    await page.route(/\/api\/v1\/trips\/t-0004\/claims\/preview(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: envelope(previewResponse) }))
  },
  async run({ page, goto, settle }) {
    await goto('/trips/t-0004?tab=claims')
    await page.getByRole('button', { name: /Generate Claim/ }).click()
    await page.getByRole('button', { name: /Preview Claim/ }).click()
    const dialog = page.getByRole('dialog', { name: 'Claim Preview' })
    await dialog.waitFor()
    await page.getByText('Marcus Tran').first().waitFor()
    await page.addStyleTag({ content: '.bg-black\\/50 { background: transparent !important; }' })
    await settle()
    return { locator: dialog, pad: -1 }
  },
})

// ---- Build Claim Batch with "Validate selection" results ---------------------------------------------------------
// GET billing/billable-events (paged) + POST billing/claim-batches/validate. The mock has no billing routes at all.
// Five unclaimed (Draft) events for two agency-managed participants. Validation results use the real codes and
// message templates of the backend BillingValidator (BOOKING_BALANCE, DUPLICATE_REF, PAST_DEADLINE, DEADLINE_NEAR are
// the four that matter here); the UI shows the message in each chip and the code only as a tooltip. PRODA booking
// references, balances and deadlines are made-up sample values; "today" is the pinned 2026-08-04.
const ev = (n, participantId, participantName, stream, item, dayType, from, to, hours, unitPrice, ref) => ({
  id: `be-020${n}`, participantId, participantName, fundingSourceId: 'fs-0001', serviceBookingId: `sb-020${n}`, stream,
  sourceEntityType: null, sourceEntityId: null, supportItemNumber: item, supportsDeliveredFrom: from, supportsDeliveredTo: to,
  dayType, quantity: null, hours, unitPrice, totalAmount: hours * unitPrice, gstCode: 'GST', claimType: 'Standard',
  cancellationReasonCode: null, participantApproved: true, claimReference: ref, status: 'Draft', rejectionReason: null,
  createdAt: '2026-07-13T09:00:00+10:00',
})
const billableEvents = [
  ev(1, 'p-0002', 'Sienna Whitfield', 'Holidays', '01_003_0117_1_1', 'Weekend', '2026-07-11', '2026-07-12', 24, 64, 'BBW-0713-S01'),
  ev(2, 'p-0002', 'Sienna Whitfield', 'Holidays', '01_002_0117_1_1', 'Weekday', '2026-07-10', '2026-07-10', 12, 48, 'BBW-0713-S02'),
  ev(3, 'p-0005', 'Dylan Marchetti', 'CommunityAccess', '01_002_0117_1_1', 'Weekday', '2026-07-28', '2026-07-28', 6, 48, 'CA-20260729-0008'),
  ev(4, 'p-0005', 'Dylan Marchetti', 'CommunityAccess', '01_003_0117_1_1', 'Saturday', '2026-05-09', '2026-05-09', 8, 64, 'CA-20260511-0003'),
  ev(5, 'p-0005', 'Dylan Marchetti', 'CommunityAccess', '01_004_0117_1_1', 'Sunday', '2026-07-26', '2026-07-26', 6, 72, 'CA-20260727-0010'),
]
const validationResults = [
  { eventId: 'be-0202', severity: 'Error', code: 'DUPLICATE_REF', message: "Claim reference 'BBW-0713-S02' has already been claimed or paid." },
  { eventId: 'be-0203', severity: 'Error', code: 'BOOKING_BALANCE', message: "Sum of claimed amounts $288.00 for support item '01_002_0117_1_1' exceeds remaining service booking balance $240.00 on booking 'PB-300552'." },
  { eventId: 'be-0204', severity: 'Error', code: 'PAST_DEADLINE', message: "Claim window for booking 'PB-300431' closed on 2026-07-09; today is 2026-08-04." },
  { eventId: 'be-0205', severity: 'Warning', code: 'DEADLINE_NEAR', message: "Claim window for booking 'PB-300552' closes on 2026-08-12, within 14 days of today (2026-08-04)." },
]

shots.push({
  name: 'fund-claim-batch',
  stage: 'fund-and-claim',
  priority: 'P2',
  route: '/billing/claim-batches/new',
  cropTarget: 'Build Claim Batch after Validate selection: the selection summary with disabled Create claim batch, the error/warning banner and the unclaimed events table with a Findings column of Error and Warning chips',
  fixture: true,
  now: '2026-08-04T10:00:00+10:00',
  viewport: { width: 1360, height: 900 },
  alt: 'Build Claim Batch page after validating five selected events: a red banner says 3 errors and 1 warning were found and nothing was created, Create claim batch is disabled with a note to resolve 3 errors, and the events table, scrolled to its right-hand columns, shows amount, reference and a Clean row and Findings chips for an already-claimed reference, an insufficient service booking balance, a claim window that has closed and one closing soon.',
  notes: 'Fixture: the mock has no billing routes, so GET billing/billable-events and POST billing/claim-batches/validate are both fed. Validation messages use the backend BillingValidator templates; booking references, balances and dates are sample values. The UI shows each finding message in its chip (the code like BOOKING_BALANCE appears only as a hover tooltip), so codes are not visible text in the image. The Findings column never wraps, so the table is scrolled right to the Amount column (as a user would) to show the chips in full; Participant, Support Item, Dates and Hours are scrolled out of view. 1360px viewport.',
  async setup(page) {
    await page.route(/\/api\/v1\/billing\/billable-events(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: envelope({ items: billableEvents, totalCount: billableEvents.length, page: 1, pageSize: 200, totalPages: 1, hasNext: false, hasPrevious: false }),
      }))
    await page.route(/\/api\/v1\/billing\/claim-batches\/validate(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: envelope(validationResults) }))
  },
  async run({ page, goto, settle }) {
    await goto('/billing/claim-batches/new')
    await page.getByText('Dylan Marchetti').first().waitFor()
    await page.getByRole('checkbox', { name: 'Select all rows' }).check()
    await page.getByRole('button', { name: 'Validate selection' }).click()
    await page.getByText('Fix the flagged events').waitFor()
    await settle()
    const summary = page.getByText(/events? selected/).first().locator('xpath=ancestor::div[contains(@class,"rounded")][1]')
    const table = page.locator('main table').first().locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
    // The Findings column does not wrap (the app keeps each message on one line), so the table is wider than the page:
    // scroll it right, as a user would, until the Amount column meets the left edge. The chips then show in full.
    await table.evaluate((frame) => {
      const th = [...frame.querySelectorAll('th')].find((h) => h.textContent.trim().startsWith('Amount'))
      frame.scrollLeft += th.getBoundingClientRect().left - frame.getBoundingClientRect().left - 1
    })
    await page.waitForTimeout(200)
    return { locator: [summary, table], pad: 8 }
  },
})
