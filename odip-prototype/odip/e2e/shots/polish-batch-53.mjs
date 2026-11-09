// Captures and numeric checks for the Publish week confirm label (polish batch 53): "Publish 1 shift and 2 group activities", "Publish 2 group activities".
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Capture states: publish-mixed-390, publish-mixed-1280, publish-activities-only-390, publish-activities-only-1280
// Pinned: Coordinator, switch on, the fixture week 2026-09-07 (?date=), theme light, clock fixed; the mock board with activities injected through page.route.
import path from 'node:path'
import { AU_CONTEXT, cropElement, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const WEEK = '2026-09-07'
const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

const staffRow = (id, staffId, staffName) => ({ id, staffId, staffName, startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, findings: [] })
const activity = (id, serviceDate, title, staff) => ({
  id, serviceDate, startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, title, status: 'Draft', staffNeeded: staff.length, staffAssigned: staff.length, minStaffRequired: null, participants: [], staff, findings: [],
})
const ACTIVITIES = [
  activity('act-bowling', '2026-09-09', 'Bowling at the lanes', [staffRow('r1', 's-0003', "Jack O'Sullivan"), staffRow('r2', 's-0004', 'Mei Zhang')]),
  activity('act-pool', '2026-09-10', 'Pool afternoon', [staffRow('r3', 's-0003', "Jack O'Sullivan")]),
]

// Mixed keeps whatever Drafts the mock week has plus one staffed Draft added here; activities-only turns every Draft shift Published so the activities are the week's only Drafts.
const draftShift = { id: 'draft-1', participantId: 'p-0001', participantName: 'Liam Okafor', serviceDate: '2026-09-08', startTime: '09:00:00', endTime: '13:00:00', endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'Draft', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, staffId: 's-0003', staffName: "Jack O'Sullivan" }
function shape(body, mixed) {
  const rows = body.participantRows ?? []
  for (const row of rows) for (const s of row.shifts) if (s.status === 'Draft' && !s.groupActivityId) s.status = 'Published'
  if (mixed) rows.find((r) => r.participantId === 'p-0001')?.shifts.push(draftShift)
  body.groupActivitiesEnabled = true
  body.groupActivities = ACTIVITIES
}

async function open(browser, st, mixed) {
  const mobile = st.width === 390
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-09-04T10:00:00+10:00'))
  page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route('**/api/v1/rostering/board*', async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data?.groupBy === 'Participant' && body.data.weekStart === WEEK) shape(body.data, mixed)
    await r.fulfill({ response, json: body })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/rostering?date=${WEEK}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
  return { context, page }
}

// Opens the Publish dialog, crops it, and checks the confirm button's exact label, one line and house height, and no horizontal overflow.
async function dialogScene(page, st, name, expectLabel) {
  await page.getByRole('button', { name: 'Publish week' }).click()
  const dialog = page.locator('[role="dialog"], [role="alertdialog"]').first()
  await dialog.waitFor({ state: 'visible', timeout: 30_000 })
  const confirm = dialog.getByRole('button', { name: /^Publish/ }).last()
  await confirm.waitFor({ state: 'visible', timeout: 15_000 })
  // The house glues words with invisible characters, so the text is matched on letters, digits and full stops only.
  const clean = (t) => t.replace(/[^\p{L}\p{N}.]+/gu, ' ').trim()
  const label = clean(await confirm.innerText())
  const expected = expectLabel(clean(await dialog.locator('p').first().innerText()))
  add(`${name} confirm label [${st.name}]`, { label, expected }, label === expected)
  const c = await cropElement(page, dialog, path.join(OUT_DIR, `${name}-${st.name}.png`), { touch: st.width === 390, hideChrome: true, pad: 24 })
  const bb = await confirm.boundingBox()
  const controlH = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--control-h')))
  add(`${name} confirm label on one line, at most --control-h [${st.name}]`, { height: bb?.height, controlH }, !!bb && bb.height <= controlH + 1)
  const overflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || [...el.querySelectorAll('*')].some((n) => n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'visible'))
  add(`${name} no horizontal overflow [${st.name}]`, c.overlap ?? null, !overflow && c.overlap?.pass !== false)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
}

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    for (const mixed of [true, false]) {
      const { context, page } = await open(browser, st, mixed)
      try {
        if (mixed) await dialogScene(page, st, 'publish-mixed', (said) => { const n = /(\d+) draft shifts? goes?/.exec(said)?.[1]; return `Publish ${n} shift${n === '1' ? '' : 's'} and 2 group activities` })
        else await dialogScene(page, st, 'publish-activities-only', () => 'Publish 2 group activities')
      } catch (e) {
        add(`${mixed ? 'mixed' : 'activities-only'} scene ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false)
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
