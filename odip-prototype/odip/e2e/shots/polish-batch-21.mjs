// Polish batch 21: (1) Queue 140, the finish page's handover step while the notes request is pending (no "No notes yet.", no Nothing to note box, Notes not listed as
// still to add), 390 touch; (4) F7, the End early notice with both sentences ("removed." before "Open roster"), 390 touch and 1280. Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-21.mjs <outdir>
// Sign-in is stubbed with page.route; the clock is pinned (NOW) and the theme is pinned in the user prefs, so every run paints the same.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const NOW = new Date('2026-11-04T23:00:00Z')
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000)
const SHIFT_ID = 'sh-next'
const ALL_MISSING = ['kilometres', 'tripTo', 'tripAfter', 'notes', 'handover', 'report']

const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }

// Provider-local date and "HH:mm:ss" of an instant.
function wall(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` }
}
const DOSE = {
  medicationId: 'med-1', medicationName: 'Paracetamol', strength: '500mg', doseDescription: '2 tablets', form: 'Tablet', route: 'Oral', directions: null, supportLevel: 'Administer',
  isHighRisk: false, scheduledAt: at(-120).toISOString(), scheduledTime: '08:00', state: 'Due', isOverdue: true, outcome: null,
  witness: { required: false, status: null, witnessName: null, requestedAt: null, respondedAt: null },
}

const world = (over = {}) => ({ status: 'InProgress', travelAsked: true, dose: false, missing: ALL_MISSING, saved: {}, saveFails: false, ...over })

async function open(browser, vp, { dark = false, draft = null, offline = false, admin = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id, theme, key, d]) => {
    try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme })) } catch { /* storage blocked */ }
    try { if (d && !sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(d)) } catch { /* storage blocked */ }
  }, [USER_ID, dark ? 'dark' : 'light', `odip-shift-end-draft:${SHIFT_ID}`, draft])
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  const login = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: admin ? 'dev.admin' : 'dev.worker', fullName: admin ? 'Dev Admin' : 'Dev Worker', role: admin ? 'Admin' : 'SupportWorker', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: admin ? 'dev.admin' : 'dev.worker', role: admin ? 'Admin' : 'SupportWorker', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(NOW)
  return { context, page, offline }
}

/** Patches the mock API's shift in flight from `w`; the finish and finish-details calls change `w` the way the server would. */
async function route(page, w) {
  let last = null
  const detail = () => {
    const d = structuredClone(last.data)
    const tz = 'Australia/Sydney'   // pinned, so the draft's provider-local times below match
    const s = wall(at(-240), tz), e = wall(at(0), tz)
    const ended = w.status === 'PendingReview'
    Object.assign(d, {
      id: SHIFT_ID, timeZoneId: tz, status: w.status, serviceDate: s.date, startTime: s.time, endTime: e.time, endsNextDay: e.date !== s.date, serviceLocation: null, travelAsked: w.travelAsked,
      breaks: [], prn: [], shiftRoutines: [], canRecordDoses: true, missingDetails: ended ? w.missing : [],
      medicationsDue: w.dose ? [DOSE] : [], finishBlockers: w.dose && !ended ? [{ code: 'DOSE_OUTCOME_MISSING', message: 'Paracetamol 500mg was due at 8:00 am.', medicationId: 'med-1', medicationName: 'Paracetamol', scheduledAt: DOSE.scheduledAt }] : [],
      completion: {
        ...(d.completion ?? {}), id: 'sc-1', shiftId: SHIFT_ID, actualStart: at(-240).toISOString(), actualEnd: ended ? NOW.toISOString() : null, originalActualStart: null, originalActualEnd: null,
        timeAdjustmentReason: null, startTimeReason: null, finishTimeReason: null, kilometres: null, anythingToReport: null, handoverText: null, nothingToHandOver: false,
        nothingToNoteConfirmed: false, preTravelNone: false, postTravelNone: false, breaks: [], breakMinutes: 0, netWorkedMinutes: 0, timesAdjusted: false, sentFromOffline: false,
        missingDetails: ended ? w.missing : [],
      },
    })
    return d
  }
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}`, async (r) => {
    const response = await r.fetch()
    last = await response.json()
    await r.fulfill({ response, json: envelope(detail()) })
  })
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}/finish`, (r) => { w.status = 'PendingReview'; r.fulfill({ json: envelope(detail()) }) })
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}/finish-details`, (r) => w.saveFails
    ? r.fulfill({ status: 422, json: { success: false, data: null, message: 'Kilometres are not accepted for this shift.', errors: ['Kilometres are not accepted for this shift.'] } })   // a 5xx would be queued as transient, not refused
    : r.fulfill({ json: envelope(detail()) }))
}
const gotoShift = async (page, hash = '') => {
  await page.goto(`${BASE_URL}/portal/shifts/${SHIFT_ID}${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
}
/** Taps End shift on the running shift and waits for the details page. */
async function endShift(page) {
  await gotoShift(page)
  const end = page.getByRole('button', { name: 'End shift' })
  await end.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(400)
  await end.click()
  await page.getByRole('heading', { level: 2, name: /^Ended / }).waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(400)
}

// hideChrome drops the sticky bar and bottom nav (their transition-all keeps visibility:hidden pending, hence the wait); overlapCheck fails a crop they still cover.
const shoot = async (page, loc, file) => {
  const shot = await cropElement(page, loc, file, { hideChrome: true, during: async (clip) => { await page.waitForTimeout(500); return overlapCheck(loc, clip, path.basename(file)) } })
  checks.push(shot.measured, checkCropHolds(shot))
}
const noHScroll = async (page, ctx) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`${ctx}: no horizontal scroll`, o <= 0, o) }

const browser = await chromium.launch({ headless: true })
try {
  // (1) handover-notes-loading: the notes request is held, so it stays pending. 390 touch.
  {
    const vp = { name: 'touch-390', width: 390, height: 844, touch: true }
    const { context, page } = await open(browser, vp)
    await route(page, world())
    await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}/notes`, () => {})   // never answered
    await endShift(page)
    check('1: pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
    const card = page.locator('section[aria-labelledby="finish-handover-card"]')
    await card.waitFor({ state: 'visible', timeout: 30_000 })
    check('1: "Your notes" heading and Add or edit notes stay', (await card.getByRole('heading', { name: 'Your notes' }).count()) === 1 && (await card.getByRole('button', { name: 'Add or edit notes' }).count()) === 1)
    check('1: no "No notes yet." while loading', (await page.getByText('No notes yet.').count()) === 0)
    check('1: no Nothing to note checkbox while loading', (await page.getByRole('checkbox', { name: 'Nothing to note' }).count()) === 0)
    check('1: Notes not listed under Still to add', !/Still to add:[^\n]*Notes/i.test(await page.locator('#finish').innerText()))
    await noHScroll(page, '1')
    await shoot(page, card, path.join(OUT_DIR, 'handover-notes-loading-touch-390.png'))
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'handover-notes-loading-390.png'), { touch: true })).checks)
    await context.close()
  }

  // (4) end-early-notice: p-0004's Core agreement is approved through the mock's own route, then ended early; the end-early reply has both counts.
  for (const vp of [{ name: 'touch-390', width: 390, height: 844, touch: true }, { name: 'desktop-1280', width: 1280, height: 900, touch: false }]) {
    const { context, page } = await open(browser, vp, { admin: true })
    await page.request.fetch(`${BASE_URL}/api/v1/participants/p-0004/service-agreement-drafts/draft-p-0004-v1/approve`, { method: 'POST', data: { acknowledgeOverlaps: true }, headers: { Authorization: 'Bearer mock-jwt-token' } })
    await page.route('**/api/v1/participants/p-0004/service-agreement-drafts/*/end-early', async (r) => {
      const mock = await r.fetch().catch(() => null)
      const draft = mock && mock.ok() ? (await mock.json()).data : {}
      await r.fulfill({ json: envelope({ ...draft, agreementEndDate: '2026-12-15', oldShiftsRemaining: { open: 2, assigned: 1, removed: 1 } }) })
    })
    await page.goto(`${BASE_URL}/participants/p-0004?tab=agreements`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: /Actions/ }).first().click({ timeout: 30_000 })
    await page.getByRole('menuitem', { name: /End early/ }).or(page.getByRole('option', { name: /End early/ })).first().click()
    const dialog = page.getByRole('alertdialog')
    const lastDay = dialog.locator('input[type=date]')
    await lastDay.fill(await lastDay.getAttribute('min'))
    await dialog.getByRole('button', { name: 'End early' }).click()
    const status = page.getByRole('status').filter({ hasText: 'removed.' })
    await status.waitFor({ state: 'visible', timeout: 30_000 })
    const text = await status.innerText()
    check(`${vp.name} 4: "removed." comes before "Open roster"`, text.indexOf('removed.') > -1 && text.indexOf('removed.') < text.indexOf('Open roster'), text.replace(/\s+/g, ' ').slice(0, 200))
    check(`${vp.name} 4: the notice ends on the roster link sentence`, /Open roster\s*$/.test(text), text.slice(-40))
    await noHScroll(page, `${vp.name} 4`)
    await shoot(page, status, path.join(OUT_DIR, `end-early-notice-${vp.name}.png`))
    if (!vp.touch) checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'end-early-notice-1280.png'), { touch: false })).checks)
    await context.close()
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
