// Polish batch 77: the Admin dashboard loads on the mock API (the Shift completions rows carry missingDetails), plus a measurement of the roster board's layout faults (GMR-B1).
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-77.mjs <outdir>
// Pinned: Admin through the dev-login intercepts; dashboard light at 1280; roster fixture week 2026-09-07 (?date=), dark, group activities injected as in ga-modal-overview (the run that found the faults).
// Exit 1 only on the dashboard checks; the roster checks are measurements (names start "measure:"), copied into the report whatever they say.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const WEEK = '2026-09-07'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const loginAs = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role) => envelope([{ username: 'dev.admin', role, tenantName: 'Sample Support Co' }])
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

// Fixtures copied from ga-modal-overview.mjs
const shiftOf = (id, participantId, participantName, serviceDate, startTime, endTime, extra = {}) => ({
  id, participantId, participantName, serviceDate, startTime, endTime, endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...extra,
})
const staffRow = (id, staffId, staffName, startTime, endTime) => ({ id, staffId, staffName, startTime, endTime, endsNextDay: false, findings: [] })
const person = (participantId, participantName, shiftIds, extra = {}) => ({ participantId, participantName, ratio: 'OneToOne', shiftIds, timesDiffer: false, didNotAttend: false, ...extra })
const act = (id, serviceDate, title, startTime, endTime, extra = {}) => ({
  id, serviceDate, startTime, endTime, endsNextDay: false, title, status: 'Published', staffNeeded: 3, staffAssigned: 2, minStaffRequired: null, participants: [], staff: [], findings: [], ...extra,
})
const TWO = [person('p-0001', 'Liam Okafor', ['gs-1']), person('p-0004', 'Grace Palmer-Hughes', ['gs-1b'])]
const CREW = [staffRow('r1', 's-0003', "Jack O'Sullivan", '10:00:00', '14:00:00'), staffRow('r2', 's-0004', 'Mei Zhang', '10:00:00', '14:00:00')]
const A = {
  draft: act('act-draft', '2026-09-09', 'Bowling at the lanes', '10:00:00', '14:00:00', { status: 'Draft', participants: TWO, staff: CREW, notes: 'Bring towels.', minStaffRequired: 3 }),
  published: act('act-pub', '2026-09-10', 'Pool afternoon', '12:00:00', '15:00:00', { participants: [TWO[0]], staff: [CREW[0]], staffNeeded: 2, staffAssigned: 1 }),
  started: act('act-started', '2026-09-07', 'Art class with a long name that must truncate on a phone', '10:00:00', '13:00:00', { status: 'InProgress', participants: [TWO[0], { ...TWO[1], didNotAttend: true }], staff: CREW, staffAssigned: 2, staffNeeded: 2 }),
  completed: act('act-done', '2026-09-08', 'Movie matinee', '13:00:00', '16:00:00', { status: 'Completed', participants: [TWO[0], { ...TWO[1], didNotAttend: true }], staff: CREW, staffAssigned: 2, staffNeeded: 2 }),
  cancelled: act('act-cancelled', '2026-09-11', 'Swim', '09:00:00', '11:00:00', { status: 'Cancelled', participants: [TWO[0]], staffAssigned: 0, staffNeeded: 0 }),
  fresh: act('act-new', '2026-09-09', 'Picnic', '10:00:00', '14:00:00', { status: 'Draft', staffAssigned: 0, staffNeeded: 0 }),
}
const ALL = Object.values(A)
// A card renders in a participant's row only through an attached shift, so each activity gets one per person (the shift ids the people carry).
for (const a of ALL) a.participants = a.participants.map((pp, i) => ({ ...pp, shiftIds: [`${a.id}-s${i}`] }))
const attached = (pid) => ALL.flatMap((a) => a.participants.filter((pp) => pp.participantId === pid).map((pp) => shiftOf(pp.shiftIds[0], pid, pp.participantName, a.serviceDate, a.startTime, a.endTime, { groupActivityId: a.id, status: a.status === 'Cancelled' ? 'Cancelled' : 'Published' })))
const PLAIN = shiftOf('plain-1', 'p-0001', 'Liam Okafor', '2026-09-08', '09:00:00', '13:00:00', { staffId: 's-0003', staffName: "Jack O'Sullivan", isGroupLine: true })

async function signedIn(browser, { width, height, touch, theme, board }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: theme })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers('Admin') }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: loginAs('Admin') }))
  if (board) {
    await page.route('**/api/v1/rostering/board*', async (r) => {
      const response = await r.fetch()
      const body = await response.json()
      if (body?.data?.groupBy === 'Participant' && body.data.weekStart === WEEK) {
        const liam = body.data.participantRows.find((x) => x.participantId === 'p-0001')
        const grace = body.data.participantRows.find((x) => x.participantId === 'p-0004')
        liam.shifts = [PLAIN, ...attached('p-0001')]
        grace.shifts = [...grace.shifts, ...attached('p-0004')]
        body.data.groupActivitiesEnabled = true
        body.data.groupActivities = ALL
      }
      await r.fulfill({ response, json: body })
    })
  }
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page, errors }
}

mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })
const browser = await chromium.launch({ headless: true })

// Items 1-2: the Admin dashboard on the mock API. Before the fix the Shift completions rows threw on missingDetails.length and the error screen showed.
try {
  const { context, page, errors } = await signedIn(browser, { width: 1280, height: 900, touch: false, theme: 'light' })
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('#decisions-tab-completions').click({ timeout: 60_000 })
  const panel = page.locator('#decisions-panel-completions')
  await panel.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(800)
  const full = await fullPage(page, path.join(OUT_DIR, 'full', 'dashboard-admin-1280.png'), { touch: false })
  const rowText = await panel.innerText()
  check('dashboard: no error boundary text', (await page.getByText('Something went wrong').count()) === 0)
  check('dashboard: #decisions-panel-completions shows the queue rows', /Priya Nadarajah|Tom Beattie|Callum Radford/.test(rowText), rowText.slice(0, 160))
  check('dashboard: no page error', errors.length === 0, errors.slice(0, 2))
  checks.push(...full.checks.map((c) => ({ ...c, name: `dashboard ${c.name}` })))
  await context.close()
} catch (e) {
  check('dashboard: ran', false, String(e.message).split('\n')[0])
}

// Item 3 (GMR-B1): the roster board week view with the slide-over closed; fullPage runs the helper's layout checks with no `allow`.
for (const vp of [{ w: 390, h: 844, touch: true }, { w: 1440, h: 900, touch: false }]) {
  try {
    const { context, page } = await signedIn(browser, { width: vp.w, height: vp.h, touch: vp.touch, theme: 'dark', board: true })
    await page.goto(`${BASE_URL}/rostering?date=${WEEK}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(800)
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    const closed = (await page.getByRole('dialog').count()) === 0
    const full = await fullPage(page, path.join(OUT_DIR, 'full', `roster-${vp.w}.png`), { touch: vp.touch })
    checks.push({ name: `measure: roster @${vp.w} slide-over closed`, pass: closed, detail: {} })
    checks.push(...full.checks.map((c) => ({ ...c, name: `measure: roster ${c.name}` })))
    await context.close()
  } catch (e) {
    checks.push({ name: `measure: roster @${vp.w} ran`, pass: false, detail: String(e.message).split('\n')[0] })
  }
}

await browser.close()
writeChecks(OUT_DIR, checks)
if (checks.some((c) => !c.pass && !c.name.startsWith('measure:'))) process.exitCode = 1
