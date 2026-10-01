/**
 * Narrow "-m" variants (round 2): art-directed crops of the proof region for screens shown at 1023px and below.
 * Each key is the base shot name; shots.mjs builds `<name>-m` from the base shot (same fixtures, same clock) and applies
 * these overrides. The default is the base shot's own crop at a 640px-wide app viewport (the app's small-screen layout:
 * tables become stacked rows, panels are about 608px wide, text is at its natural size); a spec can give its own
 * `viewport`, `setup` and `run(ctx, baseRun)` for a different crop. Images are 1x about 560-640px wide, shot at DSF 2.
 */
import { bbwClaim } from './shots-fund.mjs'
import { driveIncidentToDetails } from './drivers.mjs'

const envelope = (data) => JSON.stringify({ success: true, data, message: null, errors: null })

export const variantSpecs = {
  'plan-dashboard-missing': {
    cropTarget: 'Dashboard "Needs attention" band at a small-screen width: nine tiles in two columns, including Missing Accommodation, Missing Vehicles and Missing Staff',
    alt: 'The dashboard Needs attention band as nine tinted tiles in two columns with large figures: Qualification Issues 2, Critical Participant Alerts 1, Overdue 1 and QSC Overdue 1 in red; Missing Accommodation 1, Missing Vehicles 1, Missing Staff 2, Open Incidents 2 and Pending Leave 5 in amber.',
    notes: 'Narrow variant of plan-dashboard-missing (same fixture and clock), 640px app viewport, panel about 608px wide.',
  },

  'stay-accommodation': {
    cropTarget: 'Trip Accommodation tab at a small-screen width: reservation count, Stay Timeline and each reservation as a stacked card with the Conflict flag, dates, cost and Bedrooms / Beds',
    alt: 'Accommodation tab for Sunshine Coast Beach Escape on a narrow screen: a Stay Timeline showing all 3 nights covered, then two reservation cards for Seabreeze Accessible House, the first Confirmed for 14 to 17 August with 5 of 5 bedrooms and 8 of 8 beds, the second Requested for 16 to 18 August with a red Conflict flag and 2 of 5 bedrooms and 3 of 8 beds.',
    notes: 'Narrow variant of stay-accommodation (same fixture and clock). 640px app viewport: the reservations table becomes stacked cards, so the Bedrooms / Beds value appears inside each card instead of as a column.',
  },

  'crew-roster-board': {
    viewport: { width: 1920, height: 900 },
    cropTarget: 'Left part of the By staff roster board at a wide app width, cropped to the week navigation, the staff column and the Mon and Tue columns: the Unfilled lane, five staff rows with hours, chips that show participant names, the flagged overnight chip and Tom Beattie\'s Leave bar',
    alt: "Left part of the By staff roster board for the week of 10 August: week navigation above the staff column and the Mon 10 and Tue 11 columns; an Unfilled lane with one dashed Tuesday chip; rows for Callum Radford, Priya Nadarajah, Jack O'Sullivan, Mei Zhang and Tom Beattie with hours out of 38; chips with times and participant names (Liam Okaf, Sienna W, Marcus Tr, Dylan Mar, Grace Pal, cut short by the app); a warning triangle on Mei Zhang's Tuesday overnight chip; and a Leave bar and first aid expired note on Tom Beattie's row.",
    notes: "Narrow variant of crew-roster-board (same fixture and clock). Cropped from a 1920px-wide app viewport (week navigation, staff column and the Mon and Tue columns) because chips only show participant names when day columns are about 190px wide; at a narrow app width they show a one-letter stub. 674px wide, a little over the 560-640 target. The toolbar part of the crop only holds the week navigation (the toggles, filters and the 1 exception button sit further right, outside the crop); the flagged chip with the warning triangle is the exception shown.",
    async run(ctx) {
      const { page, goto, settle, unionRect } = ctx
      await goto('/rostering')
      await page.getByRole('radio', { name: 'By staff' }).click()
      await page.getByRole('link', { name: 'Callum Radford' }).first().waitFor()
      await settle()
      const frame = page.locator('main .overflow-auto').filter({ hasText: 'Unfilled' }).first()
      const tue = frame.locator('div[class*="top-0"][class*="z-20"]').nth(1)
      const weekNav = page.getByRole('button', { name: 'This week' })
      const frameBox = await unionRect([frame], 0)
      const tueBox = await unionRect([tue], 0)
      const topBox = await unionRect([weekNav], 0)
      const x = frameBox.x
      const right = tueBox.x + tueBox.width + 2
      const y = topBox.y - 8
      return { rect: { x, y, width: right - x, height: frameBox.y + frameBox.height + 8 - y } }
    },
  },

  'crew-credentials': {
    cropTarget: 'Staff Qualification Expiry page at a small-screen width: warning-window line, tabs and the two expanded staff groups with credential rows stacked as cards (12 days and Expired chips)',
    alt: 'Staff Qualification Expiry on a narrow screen: tabs All Issues (2), Expired (1), Expiring Soon (1) and No Date Set (0), then Jack O\'Sullivan\'s group with First Aid expiring in 12 days and two current credentials, and Tom Beattie\'s group with First Aid marked Expired and two current credentials, each shown as a card with qualification, expiry date, status and an Edit link.',
    notes: 'Narrow variant of crew-credentials (same mock data and clock 2026-08-08), 640px app viewport.',
    async run(ctx, baseRun) {
      const r = await baseRun()
      return { ...r, pad: 8 }
    },
  },

  'fund-claim-funding-split': {
    cropTarget: 'Line Items card at a small-screen width, one line per funding type (Plan Managed, NDIA Managed, Self Managed), each as a stacked card with support item, day type, dates, hours, unit price, total, status and the No Show / Invoice actions, plus the total at the foot',
    alt: 'Line Items card of a draft trip claim on a narrow screen: three stacked line cards for Liam Okafor (Plan Managed), Sienna Whitfield (NDIA Managed) and Marcus Tran (Self Managed), each with support item, Weekend day type, dates, 24 hours, unit price, total and Draft status, an Invoice link on the plan-managed and self-managed cards only, and a total of $4,224.00 at the foot.',
    notes: 'fixture uses NdiaManaged; real API value AgencyManaged is rendered raw by the current app, recapture from real data after the app fix. Narrow variant of fund-claim-funding-split: the same claim reduced to its three Weekend lines (one per funding type) so the stacked cards stay short; the total is the app\'s own sum of those three lines. 580px app viewport (the app\'s card layout sizes the cards to their content, so a slightly narrower panel fills better).',
    async setup(page) {
      const keep = ['cli-012', 'cli-014', 'cli-016']
      const slim = { ...bbwClaim, lineItems: bbwClaim.lineItems.filter((l) => keep.includes(l.id)) }
      slim.totalAmount = slim.lineItems.reduce((n, l) => n + l.totalAmount, 0)
      await page.route(/\/api\/v1\/claims\/claim-0003(\?.*)?$/, (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: envelope(slim) }))
    },
  },

  'fund-claim-batch': {
    cropTarget: 'Build Claim Batch after Validate selection at a small-screen width: selection summary, the error/warning banner and the validated events as stacked cards with their Findings chips',
    alt: "Build Claim Batch on a narrow screen after validating five events: a red banner reading 3 errors and 1 warning found, fix the flagged events, nothing was created, then five event cards each with a ticked checkbox, participant, stream, support item, day type, dates, hours, amount and reference, and a Findings field showing Clean, an already-claimed reference, an insufficient service booking balance, a closed claim window and a claim window closing soon, each message in full.",
    notes: "Narrow variant of fund-claim-batch (same fixture and clock). 640px app viewport: the table becomes stacked cards, which also lets the Findings chips wrap so every message is whole (the wide image has to scroll its table). The selection summary card with the disabled Create claim batch button is not in the crop, which starts at the banner. Each card was ticked with a real click (the card layout has no select-all). The code (BOOKING_BALANCE etc.) is only a hover tooltip in the app, so it is not visible text.",
    async run(ctx) {
      const { page, goto, settle } = ctx
      await goto('/billing/claim-batches/new')
      await page.getByText('Dylan Marchetti').first().waitFor()
      // The card layout has no select-all: tick each event card (a real click per card).
      const boxes = page.getByRole('checkbox', { name: /^Select row/ })
      for (let i = 0, n = await boxes.count(); i < n; i++) await boxes.nth(i).check()
      await page.getByRole('button', { name: 'Validate selection' }).click()
      await page.getByText('Fix the flagged events').waitFor()
      await settle()
      const banner = page.getByText('Fix the flagged events').locator('xpath=ancestor::div[@role="status"][1]')
      const table = page.locator('main table').first().locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
      return { locator: [banner, table], pad: 8 }
    },
  },

  'care-risk-alerts': {
    viewport: { width: 572, height: 900 },
    cropTarget: 'The risk-alert stack from the red Critical alert, the participant tab strip and the top of the Identity card at a small-screen width',
    alt: 'Risk alerts on a participant page on a narrow screen: a red Critical alert that a QSC report is overdue, Warning alerts for an open High incident and an overdue restrictive practice review, a note of one more alert, the first participant tabs (Details, Contacts, Bookings, Support Profile) and the start of an Identity card for Grace Palmer-Hughes.',
    notes: 'Narrow variant of care-risk-alerts (same fixture), 572px app viewport: the panel is 540px wide, which ends the scrolling tab strip between two tabs so no tab label is cut off.',
  },

  'compliant-overdue': {
    cropTarget: 'Incident Reports at a small-screen width: the red QSC banner (its description wraps in full here) and the incidents as stacked cards, the last with the solid OVERDUE badge in its QSC field',
    alt: 'Incident Reports on a narrow screen: a red banner reading "1 incident requires QSC reporting: 24-hour deadline exceeded" with its explanation and a View overdue incidents link, then three incident cards, the last for the escalation incident with Grace Palmer-Hughes, High severity, Submitted status and a solid red OVERDUE badge in its QSC field.',
    notes: 'Narrow variant of compliant-overdue (same mock data and clock). 640px app viewport: the banner description wraps in full and the table becomes stacked cards.',
  },

  'compliant-body-map': {
    cropTarget: 'Injuries card at a small-screen width, from the front and back body map down through the selected region, injury type and injury description (the region buttons above the map are left out)',
    alt: "Lower part of the Injuries card on a narrow screen: a front and back body map with the left forearm highlighted in green, the line Selected region: Left forearm, an Injury type of Abrasion and an Injury Description reading Small graze, cleaned and dressed on site.",
    notes: "Narrow variant of compliant-body-map (same flow and clock), 640px app viewport. Cropped from the body map down to the description field: the region buttons above the map (they wrap over many rows on a narrow screen) are left out, so the card top border is not in the crop.",
    async run(ctx) {
      const { page, goto, settle, unionRect } = ctx
      await driveIncidentToDetails(page, goto, { addInjury: false })
      await page.getByText('Selected region:').waitFor()
      await settle()
      const card = page.getByRole('heading', { name: 'Injuries' }).locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
      const maps = page.getByTestId('body-svg-front').locator('xpath=..')
      const description = page.getByLabel(/^Injury Description/i).first()
      const cardBox = await unionRect([card], 0)
      const mapsBox = await unionRect([maps], 0)
      const descBox = await unionRect([description], 0)
      const top = mapsBox.y - 12
      return { rect: { x: cardBox.x - 4, y: top, width: cardBox.width + 8, height: descBox.y + descBox.height + 14 - top } }
    },
  },

  'plan-trip-glance': {
    cropTarget: 'Trip detail header at a small-screen width: title, Back / Edit Trip, status line, the 2 x 2 at-a-glance figures and the first tabs',
    alt: 'Trip detail header for Sunshine Coast Beach Escape on a narrow screen: Confirmed, Caloundra QLD, SCB-2608, 14 to 17 Aug 2026, 4 days, above a two-by-two at-a-glance grid (5 / 3 participants and staff with a Waitlist flag, 2 outstanding tasks marked Action Needed, 2 / 2 high support and overnight with 1 wheelchair, insurance 4 / 5 marked Outstanding) and the first tabs Overview, Bookings, Accommodation and Vehicles.',
    notes: 'Narrow variant of plan-trip-glance (same mock data and clock), 640px app viewport. The tab strip scrolls sideways on narrow screens, so only the first four tabs are in view.',
  },

  'compliant-history': {
    cropTarget: 'Trip History tab at a small-screen width: event count and the audit timeline of who changed what and when',
    alt: 'History tab for Sunshine Coast Beach Escape on a narrow screen listing five recorded events, newest first, each with who and how long ago: Priya Nadarajah changed Status from Planning to Confirmed 3 hours ago, Callum Radford updated Notes, Priya changed Destination to Caloundra QLD, Callum changed Region to Sunshine Coast, and Callum created the trip 26 days ago.',
    notes: 'Narrow variant of compliant-history (same fixture and clock), 640px app viewport.',
  },
}
