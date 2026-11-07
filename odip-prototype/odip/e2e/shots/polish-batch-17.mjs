// Polish batch 17: the Claims hub Checks column keeps 16rem from md up (checks-1280, checks-390), and the renewed-tap notice is a calm info Callout (tap-stale-390, tap-stale-1280).
// States: checks-1280, checks-390, tap-stale-390, tap-stale-1280. Numeric checks in checks.json. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/polish-batch-17.mjs <outdir>
// The tap-stale part copies finish-later-pr2.mjs (the worker's shift is the mock API's, patched in flight; the clock is pinned).
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, fullPage, writeChecks } from '../shots/lib/capture.mjs'

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

/** One shift's server state, as the routes below serve it. */
const world = (over = {}) => ({ status: 'InProgress', travelAsked: true, dose: false, missing: ALL_MISSING, saved: {}, saveFails: false, ...over })

async function open(browser, vp, { dark = false, draft = null, offline = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id, theme, key, d]) => {
    try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme })) } catch { /* storage blocked */ }
    try { if (d && !sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(d)) } catch { /* storage blocked */ }
  }, [USER_ID, dark ? 'dark' : 'light', `odip-shift-end-draft:${SHIFT_ID}`, draft])
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  const login = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.worker', fullName: 'Dev Worker', role: 'SupportWorker', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.worker', role: 'SupportWorker', tenantName: 'Sample Support Co' }]) }))
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
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}/notes`, (r) => r.fulfill({ json: envelope([]) }))
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}/finish`, (r) => { w.status = 'PendingReview'; r.fulfill({ json: envelope(detail()) }) })
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}/finish-details`, (r) => w.saveFails
    ? r.fulfill({ status: 422, json: { success: false, data: null, message: 'Kilometres are not accepted for this shift.', errors: ['Kilometres are not accepted for this shift.'] } })   // a 5xx would be queued as transient, not refused
    : r.fulfill({ json: envelope(detail()) }))
}
const gotoShift = async (page, hash = '') => {
  await page.goto(`${BASE_URL}/portal/shifts/${SHIFT_ID}${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
}
const crop = async (page, locator, name, vp, pad = 8) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, `${name}-${vp.name}.png`), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
const px = (page, expr) => page.evaluate((e) => { const p = document.createElement('div'); p.style.height = `var(${e})`; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h }, expr)
const bar = (page) => page.getByRole('toolbar', { name: 'Shift actions' })
const noHScroll = async (page, ctx) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`${ctx}: no horizontal scroll`, o <= 0, o) }
const tapTargets = async (page, ctx) => {
  const small = await page.locator('#finish').evaluate((el) => [...el.querySelectorAll('button, input, select, textarea')].filter((e) => {
    const b = e.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0) || getComputedStyle(e).visibility === 'hidden') return false
    if (e.type === 'checkbox') return false   // the 44 high label row carries the hit area
    return Math.max(b.height, parseFloat(getComputedStyle(e, '::before').height) || 0) < 43.5
  }).map((e) => `${e.tagName} ${(e.id || e.textContent || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`))
  check(`${ctx} N1: tap targets at least --tap-min (44)`, small.length === 0, small.join('; '))
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


// Checks column: the Ready tab as an Admin, one blocked claim among passing ones (fixture copied from polish-batch-5.mjs).
const hubLine = (i, over = {}) => ({
  lineId: `l${i}`, claimId: `c${i}`, claimReference: `CLM-000${i}`, claimKind: 'shift', participantId: `p${i}`, participantName: ['Jo Park', 'Sam Lee', 'Alex Rivera', 'Mina Okafor'][i % 4],
  supportNumber: '04_104_0125_6_1', supportName: 'Short-notice cancellation', from: '2026-10-18', to: '2026-10-18', hours: 3, quantity: 3, unitPrice: 67.56, totalAmount: 202.68,
  gstCode: 'P2', claimType: 'Standard', fundingType: 'agency', ageDays: 5, ageBand: 'none', nextAttempt: 1, problems: [], ...over,
})
const blockMsg = "04_104_0125_6_1 can't be claimed as a short-notice cancellation. Check the short-notice setting for this item in the price guide."
const hubLines = { ready: [hubLine(0, { problems: [{ rule: 'CancellationNotAllowed', severity: 'block', message: blockMsg }] }), hubLine(1), hubLine(2), hubLine(3)], rejected: [], managed: [] }

async function checksState(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-1' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route('**/api/v1/claim-hub/lines', (r) => r.fulfill({ json: envelope(hubLines) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/claims`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const reason = page.getByText("can't be claimed as a short-notice").first()
  await reason.waitFor({ state: 'attached', timeout: 90_000 })
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(800)
  const t = (n) => `${vp.name}: ${n}`
  const doc = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  check(t('page has no horizontal scroll'), doc.sw <= doc.iw, JSON.stringify(doc))
  if (vp.width >= 768) {
    const th = page.locator('th').filter({ hasText: /^Checks$/ }).first()
    await th.waitFor({ state: 'visible', timeout: 90_000 })
    const m = await th.evaluate((el, msg) => {
      const table = el.closest('table'), wrap = table.parentElement
      const idx = [...el.parentElement.children].indexOf(el)
      const cell = [...table.querySelectorAll('tbody tr')].map((tr) => tr.children[idx]).find((c) => c.textContent.includes(msg.slice(0, 20)))
      const span = [...cell.querySelectorAll('span')].find((s) => s.textContent.includes(msg.slice(0, 20)))
      const lh = parseFloat(getComputedStyle(span).lineHeight)
      return { cellWidth: cell.getBoundingClientRect().width, reasonLines: Math.round(span.getBoundingClientRect().height / lh), wrapScroll: wrap.scrollWidth, wrapClient: wrap.clientWidth }
    }, blockMsg)
    check(t('Checks cell is at least 16rem wide'), m.cellWidth >= 255.5, JSON.stringify(m))
    check(t('longest seeded reason wraps to at most 3 lines'), m.reasonLines <= 3, m.reasonLines)
    check(t('table wrapper has no horizontal scroll'), m.wrapScroll <= m.wrapClient, JSON.stringify(m))
    await crop(page, page.locator('main table').filter({ has: page.locator('th', { hasText: /^Checks$/ }) }).first(), 'checks', vp)
  } else {
    await crop(page, reason.locator('xpath=ancestor::*[self::li or self::article or (self::div and contains(@class,"rounded"))][1]'), 'checks', vp)
  }
  await context.close()
}

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VPS) {
    const t = (n) => `${vp.name}: ${n}`
    await checksState(browser, vp)
    // b-tap-stale: the tap is 40 minutes old, so Submit takes a new one, sends nothing and says so; the Ended line shows the new time.
    {
      const draft = { open: true, touched: false, tappedAt: at(-40).toISOString() }
      const { context, page } = await open(browser, vp, { draft })
      let sends = 0
      page.on('request', (r) => { if (r.method() !== 'GET' && /\/finish/.test(r.url())) sends++ })
      await route(page, world())
      await gotoShift(page)
      await page.getByRole('heading', { level: 2, name: /^Ended / }).waitFor({ state: 'visible', timeout: 60_000 })
      await bar(page).getByRole('button', { name: 'Submit shift' }).click()
      const notice = page.getByText(/More than 25 minutes have passed/)
      await notice.waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(400)
      const nowClock = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', hour: 'numeric', minute: '2-digit' }).format(NOW).replace(/\s?([AP])M$/i, (_, c) => ` ${c.toLowerCase()}m`)
      check(t('b-tap-stale: nothing was sent on the stale press'), sends === 0, sends)
      check(t('b-tap-stale: the notice names the new time'), (await notice.innerText()).includes(`now ${nowClock}.`), nowClock)
      check(t('b-tap-stale: the Ended line shows the new time'), (await page.getByRole('heading', { level: 2, name: `Ended ${nowClock}` }).count()) === 1, nowClock)
      await crop(page, page.locator('#finish'), 'tap-stale', vp)
      await context.close()
    }
    {
      const { context, page } = await open(browser, vp, { draft: { open: true, touched: false, tappedAt: at(-40).toISOString() } })
      await route(page, world())
      await gotoShift(page)
      await page.getByRole('heading', { level: 2, name: /^Ended / }).waitFor({ state: 'visible', timeout: 60_000 })
      await bar(page).getByRole('button', { name: 'Submit shift' }).click()
      const callout = bar(page).getByRole('status').filter({ hasText: /More than 25 minutes/ })
      await callout.waitFor({ state: 'visible', timeout: 30_000 })
      check(t('tap-stale: the notice is the info status, and no red alert is in the bar'), (await callout.count()) === 1 && (await bar(page).getByRole('alert').count()) === 0)
      await context.close()
    }
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
