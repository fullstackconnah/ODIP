// Group activities PR3 shots: the worker's activity card (Start, Finish, the finish sheet) and the coordinator's "Group activity staff" review section.
// States: worker 390 - card-not-started, card-started, finish-sheet-break, finish-sheet-break-error, card-finished, card-approved, participants-open, offline-disabled;
// coordinator 1280 and 390 - review-mixed, record-times-error, approve-confirm, approve-partial. Numeric checks N1 to N6. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/ga-pr3.mjs <outdir>
// Everything the pages call is stubbed with page.route. The clock (NOW), the theme (light), the zone (Sydney) and the dates are pinned, so every run paints the same.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const refusal = (code, message, status = 409) => ({ status, json: { success: false, data: null, message, errors: [message], code } })
const NOW = new Date('2026-11-16T04:00:00Z')   // 3:00 pm Monday 16 Nov in Sydney (AEDT)
const checks = []
const check = (name, detail, pass) => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }
const px = (page, token) => page.evaluate((t) => { const p = document.createElement('div'); p.style.height = `var(${t})`; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h }, token)
const crop = async (page, locator, name, vp, pad = 8) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, `${name}-${vp.name}.png`), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}

const PEOPLE = [{ shiftId: 'sh-1', participantId: 'p-1', name: 'Mia Chen' }, { shiftId: 'sh-2', participantId: 'p-2', name: 'Sam Lee' }]
const activity = (over = {}) => ({
  id: 'row-1', groupActivityId: 'ga-1', title: 'Ten-pin bowling', serviceDate: '2026-11-16', startTime: '13:00:00', endTime: '17:00:00', endsNextDay: false,
  location: 'Strike Lanes, Parramatta', role: 'Driver', state: 'NotStarted', actualStart: null, actualEnd: null, breakStartedAt: null, breakEndedAt: null, participants: PEOPLE, ...over,
})
const STATES = {
  notStarted: activity(),
  started: activity({ state: 'Started', actualStart: '2026-11-16T02:02:00Z' }),
  finished: activity({ state: 'Finished', actualStart: '2026-11-16T02:02:00Z', actualEnd: '2026-11-16T03:50:00Z', breakStartedAt: '2026-11-16T03:00:00Z', breakEndedAt: '2026-11-16T03:30:00Z' }),
  approved: activity({ state: 'Approved', actualStart: '2026-11-16T02:02:00Z', actualEnd: '2026-11-16T03:50:00Z' }),
}

const review = (id, over = {}) => ({
  rowId: id, groupActivityId: 'ga-1', activityTitle: 'Ten-pin bowling', serviceDate: '2026-11-16', userId: `u-${id}`, staffName: 'Wendy Worker', role: null,
  startTime: '13:00:00', endTime: '17:00:00', endsNextDay: false, actualStart: '2026-11-16T02:02:00Z', actualEnd: '2026-11-16T06:10:00Z', breakStartedAt: null, breakEndedAt: null,
  timeZoneId: 'Australia/Sydney', state: 'Finished', locationCheck: null, offRoster: false, adjustmentReason: null, payrollLinked: true, participantCount: 2, ...over,
})
const REVIEWS = [
  review('r1'),
  review('r2', { staffName: 'Omar Offroster', offRoster: true, locationCheck: 'NotAtLocation', actualEnd: '2026-11-16T07:30:00Z' }),
  review('r3', { staffName: 'Penny NoPayroll', payrollLinked: false, adjustmentReason: 'Phone died, times recorded by the coordinator' }),
  review('r4', { staffName: 'Sam Started', state: 'Started', actualEnd: null }),
  review('r5', { staffName: 'Nora NotStarted', state: 'NotStarted', actualStart: null, actualEnd: null }),
]

async function open(browser, vp, role) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch { /* storage blocked */ } }, [USER_ID])
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, e.message, false))
  const login = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(NOW)
  return { context, page }
}

async function worker(browser) {
  const vp = { name: '390', width: 390, height: 844, touch: true }
  const { context, page } = await open(browser, vp, 'SupportWorker')
  let current = STATES.notStarted
  await page.route((u) => u.pathname === '/api/v1/portal/my-shifts', (r) => r.fulfill({ json: envelope({ shifts: [], tripAssignments: [], timeZoneId: 'Australia/Sydney', activityShifts: [current] }) }))
  await page.route('**/api/v1/portal/shifts/*/notes', (r) => r.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/portal/activity-staff/*/finish', (r) => r.fulfill(refusal('GA_BREAK', 'Enter both break times, or neither.', 400)))
  let startMode = 'hang'
  await page.route('**/api/v1/portal/activity-staff/*/start', (r) => startMode === 'hang' ? new Promise(() => {}) : r.fulfill(startMode === '404' ? { status: 404, json: { success: false, data: null, message: null, errors: [] } } : refusal('GA_CANCELLED', 'This group activity is cancelled.')))
  const show = async (state) => {
    current = state
    // the saved copy of the list is fresh under the pinned clock, so clear it or the previous state paints and never refetches
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('shifts:')) localStorage.removeItem(k) })
    await page.goto(`${BASE_URL}/portal`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('Ten-pin bowling').first().waitFor({ timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    return page.getByTestId('activity-shift-card')
  }
  const tapMin = await px(page, '--tap-min')
  const ctl = await px(page, '--control-h')

  let card = await show(STATES.notStarted)
  await crop(page, card, 'card-not-started', vp)
  const start = card.getByRole('button', { name: 'Start' })
  const sb = await start.boundingBox(), cb = await card.boundingBox()
  check('N1 Start is at least --tap-min tall and fills the card width', `${Math.round(sb.height)} vs ${tapMin}; ${Math.round(sb.width)} of ${Math.round(cb.width)}`, sb.height >= tapMin - 0.5 && sb.width >= cb.width - 40)
  const badge = card.getByText('Not started')
  const bb = await badge.boundingBox()
  check('N2 the state badge is one line', `${Math.round(bb.height)}px, nowrap`, bb.height < 30 && (await badge.evaluate((e) => getComputedStyle(e).whiteSpace)) === 'nowrap')
  const over = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }))
  const cardOver = await card.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  check('N3 no horizontal overflow on the page or the card at 390', JSON.stringify({ over, cardOver }), over.sw <= over.cw && cardOver.sw <= cardOver.cw + 1)

  card = await show(STATES.started)
  await crop(page, card, 'card-started', vp)
  const finish = card.getByRole('button', { name: 'Finish' })
  await finish.click()
  const sheet = page.getByRole('dialog')
  await sheet.getByRole('button', { name: 'Add a break' }).click()
  const bs = sheet.getByLabel('Break start')
  const h = (await bs.boundingBox()).height
  check('N4 the time inputs are --control-h tall', `${Math.round(h)} vs ${ctl}`, h >= ctl - 0.5)
  await bs.fill('2026-11-16T13:00')
  await sheet.getByLabel('Break end').fill('2026-11-16T13:30')
  await crop(page, sheet, 'finish-sheet-break', vp)
  await sheet.getByLabel('Break end').fill('')
  await sheet.getByRole('button', { name: 'Finish shift' }).click()
  await sheet.getByRole('alert').waitFor()
  check('N5 the break error uses the server wording and is tied to the field', await sheet.getByRole('alert').textContent(), (await sheet.getByRole('alert').textContent()) === 'Enter both break times, or neither.' && !!(await sheet.getByLabel('Break end').getAttribute('aria-describedby')))
  await crop(page, sheet, 'finish-sheet-break-error', vp)
  await page.keyboard.press('Escape')
  check('N6 closing the sheet returns focus to Finish', await page.evaluate(() => document.activeElement?.textContent), await finish.evaluate((e) => e === document.activeElement).catch(() => false) || (await page.evaluate(() => document.activeElement?.textContent)) === 'Finish')

  card = await show(STATES.finished)
  await crop(page, card, 'card-finished', vp)
  card = await show(STATES.approved)
  await crop(page, card, 'card-approved', vp)

  card = await show(STATES.notStarted)
  await card.getByRole('button', { name: /Participants/ }).click()
  await card.getByRole('button', { name: 'Notes' }).first().click()
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await crop(page, card, 'participants-open', vp)

  card = await show(STATES.notStarted)
  await context.setOffline(true)
  await page.waitForTimeout(300)
  check('offline: Start is disabled with the helper text', '', await card.getByRole('button', { name: 'Start' }).isDisabled() && (await card.getByText("You're offline. Start and finish need a connection.").count()) === 1)
  await crop(page, card, 'offline-disabled', vp)
  await context.setOffline(false)

  card = await show(STATES.notStarted)
  await card.getByRole('button', { name: 'Start' }).click()
  await card.getByRole('button', { name: 'Starting…' }).waitFor({ timeout: 30_000 })
  await crop(page, card, 'card-sending', vp)
  for (const [mode, name] of [['409', 'card-start-error-409'], ['404', 'card-start-error-404']]) {
    startMode = mode
    card = await show(STATES.notStarted)
    await card.getByRole('button', { name: 'Start' }).click()
    await card.getByRole('alert').waitFor({ timeout: 30_000 })
    await crop(page, card, name, vp)
  }
  card = await show(activity({ state: 'Started', startTime: '06:00:00', endTime: '10:00:00', actualStart: '2026-11-15T19:00:00Z' }))
  await crop(page, card, 'card-started-past', vp)
  card = await show(activity({ endTime: '14:00:00' }))
  await card.getByRole('button', { name: 'Finish' }).click()
  const startSheet = page.getByRole('dialog')
  await startSheet.getByRole('button', { name: 'Finish shift' }).click()
  await startSheet.getByRole('alert').waitFor()
  check('start time error uses the 24 hour wording', await startSheet.getByRole('alert').textContent(), (await startSheet.getByRole('alert').textContent()) === 'Enter a start time in the last 24 hours.')
  await crop(page, startSheet, 'finish-sheet-start-error', vp)
  const full = await fullPage(page, path.join(OUT_DIR, 'full', 'portal-shifts-390.png'), { touch: true })
  checks.push(...full.checks)
  await context.close()
}

async function coordinator(browser, vp) {
  const { context, page } = await open(browser, vp, 'Coordinator')
  const paged = { items: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrevious: false }
  await page.route((u) => u.pathname === '/api/v1/rostering/completions', (r) => r.fulfill({ json: envelope(paged) }))
  let reviewsMode = 'ok', approveMode = 'busy', putMode = 'long'
  await page.route((u) => u.pathname === '/api/v1/rostering/group-activities/staff-reviews', (r) => reviewsMode === 'hang' ? new Promise(() => {}) : r.fulfill(reviewsMode === '500' ? { status: 500, json: { success: false, data: null, message: 'Server error', errors: ['Server error'] } } : { json: envelope({ rows: REVIEWS, total: REVIEWS.length }) }))
  await page.route((u) => u.pathname.includes('/staff/') && u.pathname.endsWith('/actuals'), (r) => r.fulfill(putMode === 'long' ? refusal('GA_ACTUALS_LONG', 'These times are over 24 hours. Record times first.') : refusal('GA_TIMES', 'The finish must be after the start.', 400)))
  await page.route((u) => u.pathname === '/api/v1/rostering/group-activities/staff-reviews/approve', (r) => approveMode === 'busy' ? r.fulfill(refusal('GA_BOARD_BUSY', 'Someone else is changing this board. Try again in a moment.')) : r.fulfill({ json: envelope([
    { rowId: 'r1', ok: true, code: null, message: null },
    { rowId: 'r2', ok: false, code: 'GA_ACTUALS_LONG', message: 'These times are over 24 hours. Record times first.' },
  ]) }))
  await page.goto(`${BASE_URL}/rostering/completions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const section = page.locator('section[aria-labelledby="group-staff-heading"]')
  await section.getByText('Wendy Worker').first().waitFor({ timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

  await crop(page, section, 'review-mixed', vp, 12)
  const o = await section.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  check(`coordinator section does not overflow (${vp.name})`, JSON.stringify(o), o.sw <= o.cw + 1)
  const order = await section.locator('thead th, [role="columnheader"]').allTextContents()
  if (!vp.touch) check('columns are in the design order', order.join('|'), ['Date', 'Activity', 'Staff', 'Planned', 'Actual', 'State', 'Flags', 'Actions'].every((n, i) => (order[i + 1] ?? order[i]).includes(n) || order.some((t) => t.includes(n))))

  await section.getByRole('button', { name: /^Record times for Wendy/ }).first().click()
  const modal = page.getByRole('dialog')
  await modal.getByRole('button', { name: 'Save times' }).click()
  await modal.getByRole('alert').waitFor()
  await crop(page, modal, 'record-times-error', vp)
  await modal.getByLabel('Reason').fill('Phone died, times recorded by the coordinator')
  await modal.getByRole('button', { name: 'Save times' }).click()
  await modal.getByRole('alert').filter({ hasText: 'over 24 hours' }).waitFor()
  await crop(page, modal, 'record-times-error-actuals', vp)
  putMode = 'times'
  await modal.getByRole('button', { name: 'Save times' }).click()
  await modal.getByRole('alert').filter({ hasText: 'must be after' }).waitFor()
  await crop(page, modal, 'record-times-error-times', vp)
  await page.keyboard.press('Escape')

  await (vp.touch ? section.getByRole('checkbox').first() : page.getByRole('checkbox', { name: /select all/i }).first()).click()
  await page.getByRole('button', { name: /approve selected \(\d+\)/i }).click()
  const dialog = page.getByRole('alertdialog')
  await crop(page, dialog, 'approve-confirm', vp)
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  await crop(page, dialog, 'approve-busy-board', vp)
  approveMode = 'ok'
  await dialog.getByRole('button', { name: 'Approve', exact: true }).click()
  const result = section.getByRole('status').filter({ hasText: 'could not be approved' })
  await result.waitFor({ timeout: 15_000 })
  check(`partial failure names the row and its message (${vp.name})`, await result.textContent(), /Omar Offroster, Ten-pin bowling: These times are over 24 hours/.test((await result.textContent()) ?? ''))
  await crop(page, result, 'approve-partial', vp)
  const full = await fullPage(page, path.join(OUT_DIR, 'full', `completions-${vp.name}.png`), { touch: vp.touch })
  checks.push(...full.checks)
  reviewsMode = 'hang'
  await page.goto(`${BASE_URL}/rostering/completions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const loading = page.locator('[role="status"].h-64')
  await loading.waitFor({ timeout: 30_000 })
  await crop(page, loading, 'review-loading', vp)
  reviewsMode = '500'
  await page.goto(`${BASE_URL}/rostering/completions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const loadError = page.getByRole('alert').filter({ hasText: "Couldn't load group activity staff" })
  await loadError.waitFor({ timeout: 60_000 })
  await crop(page, loadError, 'review-query-error', vp)
  await context.close()
}

const browser = await chromium.launch({ headless: true })
try {
  await worker(browser)
  await coordinator(browser, { name: '1280', width: 1280, height: 800, touch: false })
  await coordinator(browser, { name: '390', width: 390, height: 844, touch: true })
} finally {
  writeChecks(OUT_DIR, checks)
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
process.exit(failed.length ? 1 : 0)
