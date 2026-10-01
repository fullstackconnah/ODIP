/**
 * Shot definitions for capture.mjs. See the registry comment there for the shape.
 * `run` receives { page, goto, settle, fulfil, unionRect, BASE_URL } and returns { locator | rect, pad? }.
 */
import { myShiftsWeek, pendingWitnessRequests, graceAlerts } from './fixtures.mjs'
import { driveIncidentToDetails } from './drivers.mjs'

const LOCAL = []

// ---- Stage 1: PLAN ------------------------------------------------------------------------------
LOCAL.push({
  name: 'plan-trip-glance',
  stage: 'plan',
  priority: 'P1',
  route: '/trips/t-0001',
  cropTarget: 'Trip detail header: title row (status, destination, trip code, dates), the four-segment at-a-glance figure bar and the tab strip',
  fixture: false,
  alt: 'Trip detail for Sunshine Coast Beach Escape, SCB-2608, Caloundra QLD, 14 to 17 August 2026: status Confirmed, with an at-a-glance bar of participants and staff, outstanding tasks, high support and overnight counts, and insurance confirmations, above the tab strip.',
  notes: 'Mock data, no fixtures. Clock pinned to 2026-08-04.',
  async run({ page, goto }) {
    await goto('/trips/t-0001')
    await page.getByRole('heading', { level: 1, name: 'Sunshine Coast Beach Escape' }).waitFor()
    const header = page.locator('main h1').locator('xpath=../../..')
    const tabs = page.getByRole('tablist', { name: 'Trip detail sections' })
    return { locator: [header, tabs], pad: 8 }
  },
})

// ---- Stage 6: STAY COMPLIANT ---------------------------------------------------------------------
LOCAL.push({
  name: 'compliant-overdue',
  stage: 'stay-compliant',
  priority: 'P1',
  route: '/incidents',
  cropTarget: 'Red QSC banner ("1 incident requires QSC reporting: 24-hour deadline exceeded") plus the incident table with the solid OVERDUE badge in the QSC column',
  fixture: false,
  alt: 'Incident Reports list with a red banner reading "1 incident requires QSC reporting: 24-hour deadline exceeded" and a "View overdue incidents" link above a table of three incidents; the escalation incident for Grace Palmer-Hughes carries a solid red OVERDUE badge in the QSC column.',
  notes: 'Mock data, no fixtures. Clock pinned to 2026-08-04 so the 30 Jul incident is past its 24-hour QSC deadline. The banner description is truncated with an ellipsis by the app itself at this width.',
  viewport: process.env.OVERDUE_VW ? { width: Number(process.env.OVERDUE_VW), height: 900 } : undefined,
  async run({ page, goto }) {
    await goto('/incidents')
    const banner = page.getByRole('alert').filter({ hasText: 'QSC reporting' })
    await banner.waitFor()
    await page.getByText('OVERDUE', { exact: true }).waitFor()
    const table = page.locator('main table').first().locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
    return { locator: [banner, table], pad: 8 }
  },
})

LOCAL.push({
  name: 'compliant-incident-wizard',
  stage: 'stay-compliant',
  priority: 'P1',
  route: '/incidents/new',
  cropTarget: 'Report New Incident wizard on the Incident Details step: step rail, the details card and the Injuries card with the front/back body map',
  fixture: false,
  now: '2026-07-11T15:00:00+10:00',
  // 1000px is just under the 1024px lg breakpoint, so the step rail renders as the horizontal pill row instead of the
  // vertical list (which draws stray centred connector ticks at desktop width). The crop has no sidebar either way.
  viewport: { width: 1000, height: 900 },
  alt: 'Report New Incident wizard on step 2 of 4, Incident Details: date, location, description and immediate actions filled in, then an Injuries card with region buttons, a front and back body map with the left forearm marked, and one recorded injury (Left forearm, Abrasion, small graze cleaned and dressed on site).',
  notes: 'Mock data; the form is filled in through the real UI (fictional sample text, participant and trip from the mock). No fixtures. Shot at a 1000px-wide viewport (just under the 1024px lg breakpoint) so the step rail is the horizontal pill row; at 1280px the same rail is a vertical list with stray centred connector ticks. App quirks visible: the current step has no highlighted pill and the Add injury button has dark text on dark green (both come from src, not editable here).',
  async run({ page, goto, settle }) {
    await driveIncidentToDetails(page, goto, { addInjury: true })
    await settle(page)
    const top = page.getByRole('heading', { level: 1, name: 'Report New Incident' })
    const injuries = page.getByRole('heading', { name: 'Injuries' }).locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
    return { locator: [top, injuries], pad: 8 }
  },
})

// ---- Stage 4: CARE -------------------------------------------------------------------------------
LOCAL.push({
  name: 'care-my-shifts-phone',
  stage: 'care',
  priority: 'P1',
  route: '/portal',
  cropTarget: 'My Shifts page content on a phone (title, leave and witness-approval buttons, week switcher, day-grouped shift cards); top bar and bottom nav excluded',
  fixture: true,
  now: '2026-09-11T12:00:00+10:00',
  mobile: true,
  alt: 'My Shifts on a phone for the week 7 to 13 September: shifts grouped by day, each a card with the participant, time range and a status badge, including an overnight active-night shift shown as +1 day and a Witness approvals button with a count of 1.',
  notes: 'Fixture: the mock has no GET portal/my-shifts, so it is fed the mock portal shifts (shift-0001/2/3, same dates and participants) plus one extra day shift, and one pending witness request for the badge. iPhone-sized viewport 390x844, shot at 3x and downscaled (2x file = 780 px wide).',
  async setup(page) {
    await page.route(/\/api\/v1\/portal\/my-shifts(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: myShiftsWeek, message: null, errors: null }) }))
    await page.route(/\/api\/v1\/portal\/witness-requests(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: pendingWitnessRequests, message: null, errors: null }) }))
  },
  async run({ page, goto }) {
    await goto('/portal')
    await page.getByRole('heading', { level: 1, name: 'My Shifts' }).waitFor()
    await page.getByText('Aisha Rahimi').waitFor()
    const root = page.locator('main > div').first()
    const r = await root.evaluate((el) => {
      const b = el.getBoundingClientRect()
      return { top: b.top + window.scrollY, bottom: b.bottom + window.scrollY }
    })
    // Full phone width; from the top of <main> (just under the top bar) to a little below the last card.
    return { rect: { x: 0, y: r.top - 16, width: 390, height: r.bottom - r.top + 32 } }
  },
})

LOCAL.push({
  name: 'care-risk-alerts',
  stage: 'care',
  priority: 'P1',
  route: '/participants/p-0004',
  cropTarget: 'Participant header (name, status, action buttons) with the ranked risk-alert banner, the tab strip and the top of the first Identity card (cut below the Date of Birth row)',
  fixture: true,
  alt: 'Participant page for Grace Palmer-Hughes with a stack of risk alerts under her name: a red Critical alert that a QSC report is overdue, then Warning alerts for an open High incident and an overdue restrictive practice review, and a note of one more alert; below are the participant tabs and the start of an Identity card.',
  notes: 'Fixture: the mock returns no alerts, so GET participants/p-0004/alerts is fed alerts worded like the backend ParticipantAlertsService, based on the mock incident inc-0003 (open High, QSC overdue). The plan end date and practice review date are fixture values.',
  async setup(page) {
    await page.route(/\/api\/v1\/participants\/p-0004\/alerts(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: graceAlerts, message: null, errors: null }) }))
  },
  async run({ page, goto, unionRect }) {
    await goto('/participants/p-0004')
    await page.getByRole('heading', { level: 1 }).first().waitFor()
    const banner = page.locator('[aria-label="Participant risk alerts"]')
    await banner.waitFor()
    const head = page.locator('main h1').first()
    const firstAction = page.getByText('Intake Form PDF').first()
    const more = page.getByRole('button', { name: /more alert/ })
    const tabs = page.getByRole('tablist', { name: 'Participant detail sections' })
    const dob = page.getByText('Date of Birth', { exact: true }).first()
    await dob.waitFor()
    // Header, alert stack and tab strip, then the top of the first details card, cut just below its Date of Birth row.
    const top = await unionRect([head, firstAction, banner, more, tabs], 8)
    const dobBox = await unionRect([dob])
    const nextBox = await unionRect([page.getByText('Gender', { exact: true }).first()])
    const cutY = (dobBox.y + dobBox.height + nextBox.y) / 2 // midway between the two rows, so no row is sliced
    return { rect: { x: top.x, y: top.y, width: top.width, height: cutY - top.y } }
  },
})

// ---- Assemble: every shot module, ordered plan > stay > crew > care > fund-and-claim > stay-compliant ----------
import { shots as crewShots } from './shots-crew.mjs'
import { shots as stayShots } from './shots-stay.mjs'
import { shots as fundShots } from './shots-fund.mjs'
import { shots as compliantShots } from './shots-compliant.mjs'
import { shots as careShots } from './shots-care.mjs'

const STAGE_ORDER = ['plan', 'stay', 'crew', 'care', 'fund-and-claim', 'stay-compliant']
const ALL = [...LOCAL, ...crewShots, ...stayShots, ...fundShots, ...compliantShots, ...careShots]
export const SHOTS = ALL
  .map((s, i) => [s, i])
  .sort((a, b) => STAGE_ORDER.indexOf(a[0].stage) - STAGE_ORDER.indexOf(b[0].stage) || a[1] - b[1])
  .map(([s]) => s)
