/**
 * Shot definitions for capture.mjs (the registry comment there has the shape), in page order: the 11 screens of
 * SHAPE section 5, then the 7 narrow "-m" crops. `run` receives { page, goto, settle, fulfil, unionRect, ratio, BASE_URL }
 * and returns { rect }. Each base shot's `area` finds the region that shows its state; `run` fits that region to the
 * frame's ratio, and a variant fits the same region, shot at a 640px app viewport, to 4:5.
 */
import { myShiftsWeek, pendingWitnessRequests, routeStaffBoard } from './fixtures.mjs'
import { driveIncidentToDetails } from './drivers.mjs'

const NOW = '2026-10-16T09:30:00+10:00' // the mock's completions, bookings and claims fall in the weeks around it

/**
 * Fit a region to w:h at its own width. A region taller than that is cut at the bottom; a shorter one is centred in the
 * frame, but never reaches above the app's sticky top bar (its search placeholder and the sidebar are not part of a crop).
 */
async function fit({ page, ratio }, r, w, h) {
  const out = ratio(r, w, h)
  if (out.height <= r.height) return out
  const bar = await page.locator('header').first().evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY).catch(() => 0)
  return { ...out, y: Math.max(bar + 8, r.y - (out.height - r.height) / 2) }
}

/** Grow the viewport to the whole page first, as capture.mjs does before it shoots, so sticky footers are measured where they will be. */
async function grow(page) {
  const vp = page.viewportSize()
  const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  if (h > vp.height) await page.setViewportSize({ width: vp.width, height: h })
}

/** A region w:h whose bottom sits `below` px under the region: for a block whose neighbour underneath must stay out of the frame. */
const upFrom = (r, w, h, below = 16) => {
  const height = (r.width * h) / w
  return { ...r, y: r.y + r.height + below - height, height }
}

const phone = { x: 0, y: 0, width: 390, height: 844 } // the whole first screen; the bottom nav sits at the foot of the grown page

const BASE = [
  {
    name: 'decisions', stage: 't0830', route: '/', viewport: { width: 1200, height: 900 }, w: 16, h: 10,
    cropTarget: "Dashboard Needs your decision: the group tabs, the Completions group with two rows ticked and the bulk bar's count and action",
    alt: "The dashboard's decision queue on its Completions tab as cards: four finished shifts with staff, participant, times and variance, two of them ticked under a bar reading 2 selected, with an Approve 2 button.",
    async area({ page, goto, settle, unionRect }, w, h) {
      await goto('/')
      await page.getByRole('tab', { name: /^Completions/ }).click()
      const panel = page.getByRole('tabpanel')
      // Each row's box sits under its tap-area label, which takes the click.
      for (const i of [1, 2]) await panel.getByRole('checkbox').nth(i).locator('xpath=..').click()
      await page.getByText('2 selected').waitFor()
      await settle()
      // Upcoming trips sits under the queue, so a frame taller than the queue grows upward from it, never down.
      const r = await unionRect([page.locator('#dashboard-decisions').locator('xpath=..')], { x: 12, y: 12 })
      return r.height >= (r.width * h) / w ? r : upFrom(r, w, h)
    },
  },
  {
    name: 'roster-board', stage: 't1000', route: '/rostering', fixture: true, now: '2026-08-10T08:00:00+10:00', viewport: { width: 1390, height: 900 }, w: 16, h: 10,
    cropTarget: 'Roster board, By staff: the week toolbar, the Unfilled lane with one shift, five staff rows with shift chips and hours',
    alt: "A week of the roster laid out by staff, 10 to 16 August: one shift for Dylan Marchetti waits in the Unfilled lane on Tuesday, five support workers have their shifts by day and their hours out of 38, and Tom Beattie is on leave.",
    notes: 'Fixture: the mock answers every board request with the participant view and ignores groupBy, so GET rostering/board?groupBy=staff is fed a By staff week (10-16 Aug 2026) built from mock staff and participants and Tom Beattie\'s mock annual leave. 1390px viewport: about the narrowest width where all seven day columns fit.',
    setup: routeStaffBoard,
    async area({ page, goto, settle, unionRect }) {
      await goto('/rostering')
      await page.getByRole('radio', { name: 'By staff' }).click()
      await page.getByRole('link', { name: 'Callum Radford' }).first().waitFor()
      await settle()
      const frame = page.locator('main .overflow-auto').filter({ hasText: 'Unfilled' }).first()
      return unionRect([page.getByRole('heading', { level: 1, name: 'Roster board' }), page.getByRole('button', { name: /New shift/ }), frame], { x: 12, y: 10 })
    },
  },
  {
    name: 'enquiries', stage: 't1130', route: '/participants?tab=enquiries', viewport: { width: 1440, height: 900 }, w: 16, h: 10,
    cropTarget: 'Participants, Enquiries tab: the open enquiries table with Start intake on each new enquiry',
    alt: "The open enquiries table: seven people with their contact, source and status, intake visits booked for some with confirmation badges, and Start intake, Resume intake and Edit enquiry buttons on the rows.",
    async area({ page, goto, settle, unionRect }) {
      await goto('/participants?tab=enquiries')
      await page.getByRole('button', { name: /^Start intake/ }).first().waitFor()
      await settle()
      return unionRect([page.getByRole('heading', { level: 1, name: 'Participants' }), page.locator('main table').first()], { x: 4, y: 10 })
    },
  },
  {
    name: 'intake-booking', stage: 't1130', route: '/participants?tab=enquiries', viewport: { width: 1920, height: 900 }, w: 4, h: 3,
    cropTarget: "The intake visit panel for a new enquiry: date, start time, length, where and who's going filled in, above the Send invite button",
    alt: "The intake visit panel for Noah Fitzgerald, open over the dimmed enquiries list: his email, 22 October at 10:00 for an hour and a half at his home, and Callum Radford as the one going.",
    async area({ page, goto, settle, unionRect }) {
      await goto('/participants?tab=enquiries')
      await page.getByRole('button', { name: 'Book intake for Noah Fitzgerald' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await dialog.getByLabel(/email/).fill('noah.fitzgerald@example.org')
      await dialog.getByLabel(/^Date/).fill('2026-10-22')
      await dialog.getByLabel(/^Start time/).fill('10:00')
      await dialog.getByLabel(/^Where/).fill("Noah's home")
      await page.getByLabel(/^Who's going/).first().click()
      await page.getByRole('listbox').last().getByRole('option').first().click()
      await settle()
      await grow(page)
      // The panel is narrow and tall: the frame widens leftward over the dimmed enquiries behind it, starting clear of the app's
      // search box (its placeholder reads "Search trips, participants"), and takes the 4:3 height that width gives.
      const r = await unionRect([dialog], 0)
      const search = await unionRect([page.getByPlaceholder(/^Search trips/)], 0)
      const x = search.x + search.width + 32
      const width = r.x + r.width - x
      return { x, y: r.y, width, height: Math.min(r.height, (width * 3) / 4) }
    },
  },
  {
    name: 'agreement-draft', stage: 't1300', route: '/participants/p-0004/agreement-draft', w: 16, h: 10,
    cropTarget: 'Service agreement draft at the Week step: the step rail, the week pattern lines and the running total in the footer',
    alt: "Grace Palmer-Hughes's draft service agreement on its Week step: personal care, community access and group activity shifts from Tuesday to Sunday, and a footer with the weekly and agreement totals and an over-budget warning.",
    async area({ page, goto, settle, unionRect }, w, h) {
      await goto('/participants/p-0004/agreement-draft')
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByText('Step 2 of 4').waitFor()
      await settle()
      await grow(page)
      // The week runs long; the crop ends at the footer, so the running total beside Next is in it.
      const r = await unionRect([page.getByRole('heading', { level: 1 }), page.getByText('Step 2 of 4'), page.getByRole('button', { name: 'Next' })], { x: 16, y: 12 })
      return r.height > (r.width * h) / w ? upFrom(r, w, h, 0) : r
    },
  },
  {
    name: 'incident-body-map', stage: 't1430', route: '/incidents/new', viewport: { width: 1000, height: 900 }, w: 4, h: 3,
    cropTarget: 'Report incident at the Incident details step: the Injuries card with the front and back body map, the left forearm selected, the injury type and description',
    alt: "The injuries part of a new incident report: region buttons grouped by body area with Left forearm selected, front and back figures with the left forearm shaded green, Abrasion as the injury type and a short description.",
    async area({ page, goto, settle, unionRect }) {
      await driveIncidentToDetails(page, goto)
      await page.getByText('Selected region:').waitFor()
      await settle()
      const card = page.getByRole('heading', { name: 'Injuries' }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]')
      return unionRect([card], { x: 8, y: 0 })
    },
  },
  {
    name: 'credentials', stage: 't1430', route: '/qualifications', now: '2026-08-08T10:00:00+10:00', viewport: { width: 1100, height: 900 }, w: 16, h: 10,
    cropTarget: 'Qualifications: the issue tabs and the two staff groups opened, one credential expired and one expiring inside the 30-day window',
    alt: "Qualifications with two issues across two active staff: Jack O'Sullivan's first aid due in 12 days and Tom Beattie's first aid expired on 1 July, each listed with their current credentials and an Edit link.",
    async area({ page, goto, settle, unionRect }) {
      await goto('/qualifications')
      await page.getByRole('button', { name: "Jack O'Sullivan" }).first().click()
      await page.getByRole('button', { name: 'Tom Beattie' }).first().click()
      await settle()
      const lastGroup = page.getByRole('button', { name: 'Tom Beattie' }).first().locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]')
      return unionRect([page.getByRole('heading', { level: 1, name: /Qualifications/ }), lastGroup], { x: 8, y: 10 })
    },
  },
  {
    name: 'completions', stage: 't1600', route: '/rostering/completions', viewport: { width: 1280, height: 900 }, w: 16, h: 10,
    cropTarget: 'Completions review queue: four finished shifts, three ticked, with Approve selected (3) in the toolbar',
    alt: "The completions queue with four finished shifts pending review, each with rostered against actual times and the variance; three are ticked and an Approve selected (3) button sits above the filters.",
    async area({ page, goto, settle, unionRect }) {
      await goto('/rostering/completions')
      const rows = page.locator('main table tbody').getByRole('checkbox')
      for (const i of [1, 2, 3]) await rows.nth(i).check()
      await page.getByRole('button', { name: /Approve selected \(3\)/ }).waitFor()
      await settle()
      return unionRect([page.getByRole('heading', { level: 1, name: 'Completions' }), page.locator('main table').first()], { x: 4, y: 10 })
    },
  },
  {
    name: 'claim-preview', stage: 't1600', route: '/participants/p-0001?tab=claims', viewport: { width: 1440, height: 1000 }, w: 4, h: 3,
    cropTarget: 'The Generate claim from shifts dialog at its preview: claim lines from approved shifts before anything is generated',
    alt: "A claim preview for Liam Okafor's approved shifts: two weekday lines with item codes, hours and unit prices, the total at the top, a note that one sleepover shift is left out, and Back, Cancel and Confirm buttons.",
    async area({ page, goto, settle, unionRect }) {
      await goto('/participants/p-0001?tab=claims')
      await page.getByRole('button', { name: 'Generate from shifts' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel(/^From/).fill('2026-09-01')
      await dialog.getByLabel(/^To/).fill('2026-10-16')
      await dialog.getByRole('button', { name: /Preview/ }).click()
      await dialog.getByText('Claim preview').first().waitFor()
      await settle()
      return unionRect([dialog], 24) // the dialog with an even band of the dimmed page round it
    },
  },
  {
    name: 'myshifts-week', stage: 'onshift', role: 'SupportWorker', route: '/portal', mobile: true, fixture: true, now: '2026-09-13T08:30:00+10:00',
    cropTarget: "My shifts on a phone: the week of 7 to 13 September, today's shift and the rest of the week",
    alt: "A support worker's week on a phone, 7 to 13 September: today's shift with Sienna Whitfield from 9am, starting in 30 minutes, with an Open shift button, then the earlier shifts on Friday, Thursday and Tuesday.",
    notes: "Fixture: GET portal/my-shifts is fed the mock's three portal shifts plus one more day shift, so the week reads like a real roster; no witness requests.",
    async setup(page) {
      const json = (data) => JSON.stringify({ success: true, data, message: null, errors: null })
      await page.route(/\/api\/v1\/portal\/my-shifts(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: json(myShiftsWeek) }))
      await page.route(/\/api\/v1\/portal\/witness-requests(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: json(pendingWitnessRequests) }))
    },
    async area({ page, goto, settle }) {
      await goto('/portal')
      await page.getByText('Sienna Whitfield').first().waitFor()
      await settle()
      return phone
    },
  },
  {
    name: 'myshifts-during', stage: 'onshift', role: 'SupportWorker', route: '/portal/shifts/shift-0003', mobile: true, now: '2026-09-13T09:05:00+10:00',
    cropTarget: 'A shift in progress on a phone: the shift started, the During view with the dose sheet and a dose due',
    alt: "Sienna Whitfield's shift in progress on a phone: the handover note from the last worker, her anaphylaxis and epilepsy flags, and the During the shift list with an overdue Levetiracetam dose and a Record button.",
    async area({ page, goto, settle, unionRect }) {
      await goto('/portal/shifts/shift-0003')
      await page.getByRole('button', { name: 'Start shift' }).click()
      await page.getByText('During the shift').waitFor()
      await settle()
      const back = await unionRect([page.getByText('Back', { exact: true }).first()], 0)
      return { ...phone, y: back.y - 16 } // from Back down, so the dose sheet is in the frame
    },
  },
]

const ALT_M = {
  "decisions": "On a narrow screen, the decision queue's Completions tab as stacked cards: four finished shifts, two ticked, under the 2 selected bar with its Approve 2 button.",
  "roster-board": "On a narrow screen, the roster by staff from Monday to Wednesday: the Unfilled lane with one Tuesday shift, five staff rows with shift chips and hours, and Tom Beattie on leave.",
  "enquiries": "On a narrow screen, open enquiries as stacked cards with name, contact, source and status: Noah Fitzgerald with Book intake and Start intake, then Priya Nair and Tomas Becker with Resume intake.",
  "agreement-draft": "On a narrow screen, the agreement draft's Week step: the shifts for each day from Monday to Sunday, then the weekly and agreement totals with an over-budget warning and the Next button.",
  "incident-body-map": "On a narrow screen, the incident report's injuries section: body area buttons with Left forearm selected above the front and back figures, the left forearm shaded on both.",
  "credentials": "On a narrow screen, Qualifications with both staff groups open: Jack O'Sullivan's first aid due in 12 days and Tom Beattie's expired first aid among their current credentials, each with an Edit link.",
  "completions": "On a narrow screen, the completions queue as stacked cards with rostered and actual times and the variance; three of the four are ticked under an Approve selected (3) button."
}

const NARROW = ['decisions', 'roster-board', 'enquiries', 'agreement-draft', 'incident-body-map', 'credentials', 'completions']

const shot = (s) => ({ role: 'Admin', fixture: false, notes: '', now: NOW, ...s, run: async (ctx) => {
  const r = await s.area(ctx, s.w, s.h)
  return { rect: s.mobile ? r : await fit(ctx, r, s.w, s.h) }
} })

const VARIANTS = NARROW.map((name) => {
  const base = BASE.find((s) => s.name === name)
  return shot({
    ...base,
    name: `${name}-m`,
    variantOf: name,
    viewport: { width: 640, height: 900 },
    w: 4,
    h: 5,
    cropTarget: `${base.cropTarget}, at a 640px app width`,
    alt: ALT_M[name],
  })
})

export const SHOTS = [...BASE.map(shot), ...VARIANTS]
