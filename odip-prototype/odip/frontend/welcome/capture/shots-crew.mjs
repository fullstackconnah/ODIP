/**
 * Stage 3: CREW shots (roster board, roster warning dialog, credentials). Same shape as shots.mjs.
 */
import { rosterBoardStaffWeek } from './fixtures-crew.mjs'

export const shots = []

const envelope = (data) => JSON.stringify({ success: true, data, message: null, errors: null })

/** Serve the By staff board fixture for groupBy=staff; every other board request falls through to the mock. */
export async function routeStaffBoard(page) {
  await page.route(/\/api\/v1\/rostering\/board(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('groupBy') !== 'staff') return route.fallback()
    return route.fulfill({ status: 200, contentType: 'application/json', body: envelope(rosterBoardStaffWeek) })
  })
}

shots.push({
  name: 'crew-roster-board',
  stage: 'crew',
  priority: 'P1',
  route: '/rostering',
  cropTarget: 'Rostering week toolbar plus the By staff roster board: Unfilled lane, five staff rows with shift chips, hours meters, a compliance note and trip bars',
  fixture: true,
  now: '2026-08-10T08:00:00+10:00',
  viewport: { width: 1390, height: 900 },
  alt: 'Week roster board for 10 to 16 August in the By staff view: an Unfilled lane with four dashed shift chips above rows for five staff, each with day-by-day shift chips and an hours-out-of-38 meter; three staff carry a bar for the Sunshine Coast Beach Escape trip SCB-2608 from Friday, and Tom Beattie has a full-week Leave bar and a first aid expired note. The toolbar shows 1 exception.',
  notes: 'Fixture: the mock answers every board request with the participant view for 7-13 Sep and ignores groupBy, so GET rostering/board?groupBy=staff is fed a By staff week (10-16 Aug 2026) built from mock staff, participants, the SCB-2608 trip staffing and the mock annual leave of Tom Beattie. Chip names are truncated to a stub by the app at this column width. 1390px viewport = about the narrowest width where all seven day columns fit without horizontal scroll (195px sticky column + 7 x 127px minimum day columns + 24px of column gaps + 8px padding = 1116px board).',
  async setup(page) {
    await routeStaffBoard(page)
  },
  async run({ page, goto, settle }) {
    await goto('/rostering')
    await page.getByRole('radio', { name: 'By staff' }).click()
    await page.getByRole('link', { name: 'Callum Radford' }).first().waitFor()
    await settle()
    const frame = page.locator('main .overflow-auto').filter({ hasText: 'Unfilled' }).first()
    const spill = await frame.evaluate((e) => e.scrollWidth - e.clientWidth)
    if (spill > 1) throw new Error(`Roster board scrolls horizontally by ${spill}px at this viewport; widen it so all seven days show`)
    const toolbarLeft = page.getByRole('button', { name: 'This week' })
    const toolbarRight = page.getByRole('button', { name: /New shift/ })
    return { locator: [toolbarLeft, toolbarRight, frame], pad: { x: 0, y: 8 } }
  },
})

// Optional wide variant of the board: at 1920px the day columns are wide enough for the chips to show participant names,
// at the cost of a 1650px-wide crop. Same fixture and steps as crew-roster-board.
const boardShot = shots[0]
shots.push({
  ...boardShot,
  name: 'crew-roster-board-wide',
  priority: 'P2',
  viewport: { width: 1920, height: 900 },
  alt: 'Week roster board for 10 to 16 August in the By staff view at a wide width: shift chips show the participant names (Liam Okafor, Sienna Whitfield, Marcus Tran, Grace Palmer-Hughes, Dylan Marchetti) beside their times, an Unfilled lane with four dashed chips above five staff rows with hours meters, trip bars for SCB-2608 and a full-week Leave bar for Tom Beattie.',
  notes: boardShot.notes + ' OPTIONAL wide variant (1920px viewport, about 1650px crop) for when participant names on the chips matter more than keeping the image near 1100px wide.',
})

// ---- Assign with warnings (drag an Unfilled shift onto a staff row) ---------------------------------------------
// Grace's unfilled Thu 13 Aug overnight dragged onto Tom Beattie: POST rostering/shifts/rs-0015/assign answers 422 with the
// findings (the contract getRosterFindings() reads: status 422, findings in data). Tom is on approved leave (mock annual leave
// 10-21 Aug), is not overnight-eligible and has an expired first aid certificate (mock staff record). Wording follows
// RosterConflictService (backend).
const tomFindings = [
  { code: 'STAFF_ON_LEAVE', severity: 'Warning', requiresReason: true, message: "Tom Beattie's approved leave covers this window — cannot roster without a reason." },
  { code: 'COMPETENCY_MISSING', severity: 'Warning', requiresReason: false, message: 'Tom Beattie is not overnight-eligible but this shift requires overnight support for Grace Palmer-Hughes.' },
  { code: 'CREDENTIAL_EXPIRED', severity: 'Warning', requiresReason: false, message: "Tom Beattie's first aid certificate expired 1 Jul 2026." },
]

shots.push({
  name: 'crew-roster-warning',
  stage: 'crew',
  priority: 'P2',
  route: '/rostering',
  cropTarget: 'The Assign with warnings dialog after dragging an unfilled overnight shift onto a staff row: three flagged findings (one marked Reason required), a reason box and Cancel / Assign anyway',
  fixture: true,
  now: '2026-08-10T08:00:00+10:00',
  viewport: { width: 1390, height: 900 },
  alt: 'Assign with warnings dialog listing three roster findings for Tom Beattie (approved leave covers this window, marked Reason required; not overnight-eligible for Grace Palmer-Hughes; first aid certificate expired 1 Jul 2026), with an empty reason box and Cancel and a disabled Assign anyway button.',
  notes: 'Fixture: the board (By staff) and the 422 assign response are both fed; the dialog itself is the app reacting to a real drag of the Unfilled Thu 13 Aug overnight shift onto Tom Beattie row. Finding wording follows the backend RosterConflictService. The dark page scrim is painted in the page background colour for the crop, so the rounded corners are clean (no dark wedges, no page text bleeding through).',
  async setup(page) {
    await routeStaffBoard(page)
    await page.route(/\/api\/v1\/rostering\/shifts\/rs-0015\/assign(\?.*)?$/, (route) =>
      route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, data: tomFindings, message: 'Roster checks raised findings', errors: ['Roster checks raised findings'] }),
      }))
  },
  async run({ page, goto, settle }) {
    await goto('/rostering')
    await page.getByRole('radio', { name: 'By staff' }).click()
    await page.getByRole('link', { name: 'Tom Beattie' }).first().waitFor()
    await settle()
    const handle = page.getByRole('button', { name: /Drag to move Grace Palmer-Hughes/ }).first() // first = the Unfilled lane chip
    const rowCell = page.getByRole('link', { name: 'Tom Beattie' }).first().locator('xpath=ancestor::div[contains(@class,"sticky")][1]/following-sibling::div[1]')
    const h = await handle.boundingBox()
    const r = await rowCell.boundingBox()
    const chip = await handle.locator('xpath=ancestor::div[contains(@class,"rounded-sm")][1]').boundingBox()
    // Move the chip so its centre lands on the centre of Tom's row (dnd-kit uses closest-centre collision).
    const dx = r.x + r.width / 2 - (chip.x + chip.width / 2)
    const dy = r.y + r.height / 2 - (chip.y + chip.height / 2)
    const sx = h.x + h.width / 2
    const sy = h.y + h.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(sx + 12, sy + 12, { steps: 4 })
    await page.mouse.move(sx + dx, sy + dy, { steps: 20 })
    await page.mouse.up()
    const dialog = page.getByRole('alertdialog', { name: 'Assign with warnings' })
    await dialog.waitFor()
    await page.addStyleTag({ content: '.bg-black\/50 { background: var(--color-background) !important; }' })
    await settle()
    return { locator: dialog, pad: -1 }
  },
})

// ---- Credentials expiry dashboard (mock data, no fixture) ---------------------------------------------------------
shots.push({
  name: 'crew-credentials',
  stage: 'crew',
  priority: 'P2',
  route: '/qualifications',
  cropTarget: 'Staff Qualification Expiry page: warning-window line, All Issues / Expired / Expiring Soon tabs and the two staff groups expanded to their credential rows with EXPIRED and days-left chips',
  fixture: false,
  now: '2026-08-08T10:00:00+10:00',
  viewport: { width: 768, height: 900 },
  alt: 'Staff Qualification Expiry page with tabs All Issues, Expired, Expiring Soon and No Date Set, showing two staff groups expanded: a credential marked EXPIRED for Tom Beattie and one expiring in 12 days for Jack O\'Sullivan.',
  notes: 'Mock data, no fixtures. Clock pinned to 2026-08-08 so Jack O\'Sullivan\'s first aid expiry (20 Aug) reads as 12 days. The warning window (30 days) is the app setting. Round 2: shot at a 768px viewport (no sidebar) so the crop is about 720px wide at natural text size.',
  async run({ page, goto, settle }) {
    await goto('/qualifications')
    await page.getByRole('heading', { level: 1, name: /Staff Qualification Expiry/ }).waitFor()
    await page.getByRole('button', { name: "Jack O'Sullivan" }).first().click()
    await page.getByRole('button', { name: 'Tom Beattie' }).first().click()
    await page.getByText('12 days').first().waitFor()
    await page.getByText(/^expired$/i).first().waitFor()
    await settle()
    const title = page.getByRole('heading', { level: 1, name: /Staff Qualification Expiry/ })
    const lastGroup = page.getByRole('button', { name: 'Tom Beattie' }).first().locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]')
    return { locator: [title, lastGroup], pad: { x: 4, y: 8 } }
  },
})
