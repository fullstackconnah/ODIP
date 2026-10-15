/**
 * Stage 5: FUND AND CLAIM shots (per-traveller funding split, claim preview). Same shape as shots.mjs.
 */
export const shots = []

const envelope = (data) => JSON.stringify({ success: true, data, message: null, errors: null })

// ---- Claim detail: per-traveller funding split (GET claims/claim-0003) ------------------------------------------
// A Draft trip claim for Byron Bay Winter Weekender (BBW-2607, 10-12 Jul 2026, mock trip t-0004) with one traveller on each
// funding type. ROUND 2: the agency-managed lines are fed the legacy value 'NdiaManaged' (the value the page's own label map
// turns into 'NDIA Managed'); the real API sends 'AgencyManaged', which the current app renders raw. See the shot's note.
// Travellers, plan types and masked NDIS numbers are the mock's; the claim reference follows the real generator
// (TC-{tripCode}-{yyyyMMdd}); hours and unit prices are obviously-sample round figures. The trip ran Fri-Sun, so each
// traveller has a Weekday line and a Weekend line (the generator splits by day type).
export const line = (n, bookingId, participantId, name, ndis, planType, dayType, from, to, hours, unitPrice, code) => ({
  id: `cli-01${n}`, tripClaimId: 'claim-0003', participantBookingId: bookingId, participantId,
  participantName: name, ndisNumber: ndis, planType, supportItemCode: code, dayType,
  supportsDeliveredFrom: from, supportsDeliveredTo: to, hours, unitPrice, totalAmount: hours * unitPrice,
  gstCode: 'GST', claimType: 'Standard', cancellationReason: null, participantApproved: true, status: 'Draft',
  rejectionReason: null, paidAmount: null,
})
const WEEKDAY = '01_002_0117_1_1'
const WEEKEND = '01_003_0117_1_1'
export const bbwClaim = {
  id: 'claim-0003', kind: 'Trip', tripInstanceId: 't-0004', tripName: 'Byron Bay Winter Weekender',
  status: 'Draft', claimReference: 'TC-BBW-2607-20260713', totalAmount: 5760,
  createdAt: '2026-07-13T09:00:00+10:00', totalApprovedAmount: 0, authorisedByStaffId: null, authorisedByStaffName: null,
  paidDate: null,
  notes: 'BPR CSV covers the agency-managed line items. Plan-managed and self-managed travellers are invoiced individually.',
  lineItems: [
    line(1, 'b-0101', 'p-0001', 'Liam Okafor', '43•••••89', 'PlanManaged', 'Weekday', '2026-07-10', '2026-07-10', 12, 40, WEEKDAY),
    line(2, 'b-0101', 'p-0001', 'Liam Okafor', '43•••••89', 'PlanManaged', 'Weekend', '2026-07-11', '2026-07-12', 24, 56, WEEKEND),
    line(3, 'b-0102', 'p-0002', 'Sienna Whitfield', '43•••••12', 'NdiaManaged', 'Weekday', '2026-07-10', '2026-07-10', 12, 48, WEEKDAY),
    line(4, 'b-0102', 'p-0002', 'Sienna Whitfield', '43•••••12', 'NdiaManaged', 'Weekend', '2026-07-11', '2026-07-12', 24, 64, WEEKEND),
    line(5, 'b-0103', 'p-0003', 'Marcus Tran', '43•••••57', 'SelfManaged', 'Weekday', '2026-07-10', '2026-07-10', 12, 40, WEEKDAY),
    line(6, 'b-0103', 'p-0003', 'Marcus Tran', '43•••••57', 'SelfManaged', 'Weekend', '2026-07-11', '2026-07-12', 24, 56, WEEKEND),
  ],
}

shots.push({
  name: 'fund-claim-funding-split',
  stage: 'fund-and-claim',
  priority: 'P1',
  route: '/claims/claim-0003',
  cropTarget: 'Line Items card of the trip claim: six lines for three travellers with a plan-type badge, support item, day type, dates, hours, unit price, total, status and a No Show / Invoice action cell, plus the total at the foot',
  fixture: true,
  now: '2026-07-13T10:00:00+10:00',
  alt: 'Line Items card of a draft trip claim: six lines for three travellers on different funding types (Liam Okafor Plan Managed, Sienna Whitfield NDIA Managed, Marcus Tran Self Managed), each with support item, Weekday or Weekend day type, dates, hours, unit price, total and Draft status, an Invoice link on the plan-managed and self-managed lines only, and a total of $5,760.00 at the foot.',
  notes: 'fixture uses NdiaManaged; real API value AgencyManaged is rendered raw by the current app, recapture from real data after the app fix. Fixture: the mock claim has a single self-managed line, so GET claims/claim-0003 is fed a Draft trip claim for mock trip BBW-2607 with one traveller per funding type (Liam PlanManaged, Sienna NdiaManaged, Marcus SelfManaged). Hours and unit prices are round sample figures; reference TC-BBW-2607-20260713 follows the real TC-{tripCode}-{yyyyMMdd} format. Crop is the Line Items card only (round 2): the page header with BPR CSV, the totals bar and the notes box are left out.',
  async setup(page) {
    await page.route(/\/api\/v1\/claims\/claim-0003(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: envelope(bbwClaim) }))
  },
  async run({ page, goto }) {
    await goto('/claims/claim-0003')
    await page.getByRole('heading', { level: 1, name: /Claim TC-BBW-2607-20260713/ }).waitFor()
    await page.getByText('Marcus Tran').first().waitFor()
    await page.getByText('NDIA Managed').first().waitFor()
    const card = page.getByRole('heading', { name: 'Line Items' }).locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]')
    return { locator: card, pad: 8 }
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
  notes: 'Fixture: the mock has no claim preview, so POST trips/t-0004/claims/preview is fed the same line items as fund-claim-funding-split. The modal is the real Generate NDIS Claim flow (Generate Claim, then Preview Claim). The preview table has no unit price column in the app (Participant, Day Type, Dates, Hours, Amount). The dark page scrim is painted in the page background colour for the crop, so the rounded corners are clean.',
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
    await page.addStyleTag({ content: '.bg-black\\/50 { background: var(--color-background) !important; }' })
    await settle()
    return { locator: dialog, pad: -1 }
  },
})
