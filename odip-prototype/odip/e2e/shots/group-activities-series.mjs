// Recurring group activities (PR A, PLAN.md section "Capture states"): captures plus the numeric checks of SHAPE.md. Computed boxes only; exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/group-activities-series.mjs <outdir>
// Pinned: the clock to Tue 2026-09-08 10:00 Sydney (inside the mock fixture week), the provider's today, theme light (dark sets are named), the mock board and its series fixtures.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, layoutCheck, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const WEEK = '2026-09-07'
const NOW = new Date('2026-09-08T10:00:00+10:00')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })
const VIEWPORTS = [{ w: 390, h: 844, touch: true }, { w: 1440, h: 900, touch: false }]

const row = (id, title, location, series, extra = {}) => ({
  id, serviceDate: '2026-09-08', startTime: '10:00:00', endTime: '13:00:00', endsNextDay: false, title, location, status: 'Published', staffNeeded: 1, staffAssigned: 1,
  participants: [], staff: [{ id: `r-${id}`, staffId: 's-1', staffName: 'Alex Rivera', startTime: '10:00:00', endTime: '13:00:00', endsNextDay: false, findings: [] }], findings: [], series, ...extra,
})
const weekly = { id: 'series-1', interval: 'Weekly', startDate: '2026-09-08', endDate: '2026-12-15' }
const LIST = [
  row('l-1', 'Bowling at the lanes', 'Strike Zone Entertainment Centre, Level 2 and the very long name beside it', weekly),
  row('l-2', 'Craft morning', null, { ...weekly, id: 'series-2', interval: 'Monthly' }),
  row('l-3', 'Pool afternoon', 'Aquatic Centre', null),
]

async function open(browser, { w, h, touch, dark }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  await page.addInitScript(() => { try { sessionStorage.setItem('odip.roster.boardView', 'activity') } catch { /* not available */ } })
  page.on('pageerror', (e) => check('no page error', false, String(e.message)))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route('**/api/v1/provider-today*', (r) => r.fulfill({ json: envelope({ date: '2026-09-08' }) }))
  await page.route('**/api/v1/rostering/board*', async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data) body.data.groupActivitiesEnabled = true
    await r.fulfill({ response, json: body })
  })
  await page.route('**/api/v1/settings/module-visibility*', async (r) => {
    const response = await r.fetch()
    const body = await response.json().catch(() => null)
    await r.fulfill({ response, json: body?.data ? { ...body, data: { ...body.data, groupActivitiesEnabled: true } } : envelope({ groupActivitiesEnabled: true }) })
  })
  await page.route((url) => url.pathname.endsWith('/api/v1/rostering/group-activities'), (r) => r.request().method() === 'GET'
    ? r.fulfill({ json: envelope({ items: LIST, totalCount: LIST.length }) }) : r.fallback())
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page, dark }
}
const toBoard = async (page, dark) => {
  await page.goto(`${BASE_URL}/rostering?date=${WEEK}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
  if (dark) await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
}

const tokenPx = (page, token) => page.evaluate((t) => { const p = document.createElement('div'); p.style.height = `var(${t})`; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h }, token)
// A control's tap size is the larger of its box and its TAP_AREA ::before (the transparent hit area under a coarse pointer).
const tapSize = (locator) => locator.evaluate((el) => { const b = el.getBoundingClientRect(), p = getComputedStyle(el, '::before'); return { w: Math.max(b.width, parseFloat(p.width) || 0), h: Math.max(b.height, parseFloat(p.height) || 0) } })
const box = (locator) => locator.evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom } })
const lines = (locator) => locator.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
const textLines = (locator) => locator.evaluate((el) => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const tops = new Set(); for (let n = w.nextNode(); n; n = w.nextNode()) { const r = document.createRange(); r.selectNodeContents(n); for (const q of r.getClientRects()) tops.add(Math.round(q.top)) } return tops.size })
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol
const shot = async (page, locator, file, opts = {}) => {
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  const crop = await cropElement(page, locator, path.join(OUT_DIR, file), opts)
  checks.push(checkCropHolds({ ...crop, touch: opts.touch ?? crop.touch }))
  return crop
}
const scene = async (name, fn) => { try { await fn() } catch (e) { check(`${name}: scene ran`, false, String(e.message).split('\n').slice(0, 4).join(' | ').slice(0, 400)) } }

const browser = await chromium.launch({ headless: true })

// ── Create: Repeats and Until ───────────────────────────────────────────────
async function openCreate(page) {
  await page.getByRole('button', { name: 'New', exact: true }).first().click()
  await page.getByRole('option', { name: 'Group activity' }).click()
  const dlg = page.getByRole('dialog', { name: 'New group activity' })
  await dlg.waitFor({ timeout: 10_000 })
  return dlg
}
const fillSeries = async (dlg, { date, repeats, until, title = 'Bowling' }) => {
  await dlg.getByLabel(/Title/).fill(title)
  if (date) await dlg.getByLabel(/^Date/).fill(date)
  if (repeats) await dlg.getByLabel(/^Repeats/).selectOption(repeats)
  if (until) await dlg.getByLabel(/^Until/).fill(until)
}

for (const vp of VIEWPORTS) {
  const tag = String(vp.w)
  const modes = [false, true]
  for (const dark of modes) {
    const suffix = dark ? '-dark' : ''
    await scene(`create ${tag}${suffix}`, async () => {
      const { context, page } = await open(browser, { ...vp })
      await toBoard(page, dark)
      const controlH = await tokenPx(page, '--control-h')
      const gapY = await tokenPx(page, '--field-gap-y')
      const dlg = await openCreate(page)
      const touch = vp.touch
      if (!dark) await shot(page, dlg, `a1-create-none-${tag}.png`, { touch, natural: touch })

      // create-weekly-valid: the numeric checks 1, 2, 3, 4, 9 live here.
      await fillSeries(dlg, { date: '2026-11-17', repeats: 'Weekly', until: '2027-03-09' })
      await dlg.getByText('Every Tuesday until 9 Mar 2027 · 17 activities').waitFor({ timeout: 5000 })
      await shot(page, dlg, `a1-create-weekly-valid-${tag}${suffix}.png`, { touch, natural: touch })
      if (!dark) {
        const sel = dlg.getByLabel(/^Repeats/), until = dlg.getByLabel(/^Until/), date = dlg.getByLabel(/^Date/)
        const start = dlg.getByLabel(/^Start/).first(), end = dlg.locator('[data-field="end"]').first()
        const [s, u, d, st, en] = await Promise.all([box(sel), box(until), box(date), box(start), box(end)])
        check(`${tag} 1 Repeats select height = --control-h`, near(s.h, controlH), { h: s.h, controlH })
        check(`${tag} 1 Until input height = Date input height = --control-h`, near(u.h, controlH) && near(d.h, controlH), { until: u.h, date: d.h, controlH })
        check(`${tag} 2 Repeats left = Start left`, near(s.x, st.x), { repeats: s.x, start: st.x })
        check(`${tag} 2 Until left = End left`, near(u.x, en.x), { until: u.x, end: en.x })
        check(`${tag} 2 Repeats top = Until top`, near(s.y, u.y), { repeats: s.y, until: u.y })
        const endsLabel = await box(dlg.locator('label', { hasText: 'Ends the next day' }).first())
        const repeatsLabel = await box(dlg.locator('label', { hasText: /^Repeats/ }).first())
        const summary = dlg.locator('[aria-live="polite"]').filter({ hasText: 'activities' }).first()
        const sm = await box(summary)
        const untilBottom = Math.max(u.b, s.b)
        check(`${tag} 3 gap Ends-the-next-day to Repeats row = --field-gap-y`, near(repeatsLabel.y - endsLabel.b, gapY, 2), { gap: repeatsLabel.y - endsLabel.b, gapY })
        check(`${tag} 3 gap Repeats row to summary = --field-gap-y`, near(sm.y - untilBottom, gapY, 2), { gap: sm.y - untilBottom, gapY })
        const btn = dlg.getByRole('button', { name: 'Create 17 drafts' }).last()
        const bb = await box(btn)
        const db = await box(dlg)
        check(`${tag} 9 "Create 17 drafts" on one line`, (await textLines(btn)) <= 1, { h: bb.h })
        check(`${tag} 9 footer has no sideways overflow`, await dlg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), { right: bb.r, dialogRight: db.r })
        if (vp.touch) check(`${tag} 4 summary at most 2 lines (weekly)`, (await lines(summary)) <= 2, { lines: await lines(summary) })
      }

      if (!dark) {
        // create-monthly-last: the longest summary text.
        await fillSeries(dlg, { date: '2026-09-30', repeats: 'Monthly', until: '2027-09-30' })
        const longest = dlg.getByText('Last Wednesday of each month until 30 Sep 2027 · 13 activities')
        await longest.waitFor({ timeout: 5000 })
        await shot(page, dlg, `a1-create-monthly-last-${tag}.png`, { touch, natural: touch })
        check(`${tag} 4 longest summary at most 2 lines`, (await lines(longest)) <= 2, { lines: await lines(longest) })

        // create-until-blank-tried
        await dlg.getByLabel(/^Until/).fill('')
        await dlg.getByRole('button', { name: /^Create (draft|\d+ drafts)$/ }).click()
        await dlg.getByText('Pick an end date.').first().waitFor({ timeout: 5000 })
        await shot(page, dlg, `a1-create-until-blank-tried-${tag}.png`, { touch, natural: touch })

        // create-range-error
        await fillSeries(dlg, { date: '2026-11-17', repeats: 'Weekly', until: '2027-12-23' })
        const rangeErr = dlg.getByText('Pick an end date by 22 Dec 2027. A series can run up to 400 days.')
        await rangeErr.waitFor({ timeout: 5000 })
        // Checked in `during`: at 390 the crop is natural height; at 1440 the Until field is centred so the sticky footer is not over it.
        let dialogLayout
        await shot(page, dlg, `a1-create-range-error-${tag}.png`, { touch, natural: touch, during: async () => { await dlg.getByLabel(/^Until/).evaluate((el) => el.scrollIntoView({ block: 'center' })); dialogLayout = await layoutCheck(page, dlg, `create dialog ${tag}`) } })
        const [s, u] = await Promise.all([box(dlg.getByLabel(/^Repeats/)), box(dlg.getByLabel(/^Until/))])
        check(`${tag} 2 Repeats top = Until top with the range error showing`, near(s.y, u.y), { repeats: s.y, until: u.y })
        check(`${tag} 10 Until range error at most 2 lines`, (await lines(rangeErr)) <= 2, { lines: await lines(rangeErr) })
        checks.push(dialogLayout)
      }
      await context.close()
    })
  }
}

// ── Occurrence: overview, when, scope dialogs, refusals ──────────────────────
async function openOccurrence(page) {
  await page.locator('[data-activity-card="series-weekly"] [data-activity-open]').first().click()
  const dlg = page.getByRole('dialog').first()
  await dlg.getByText(/^Repeats every Tuesday until/).first().waitFor({ timeout: 10_000 })
  return dlg
}
const gotoRow = (dlg, name) => dlg.getByRole('button', { name: new RegExp(`^${name}`) }).first().click()
const alert = (page) => page.getByRole('alertdialog')

for (const vp of VIEWPORTS) {
  const tag = String(vp.w)
  const touch = vp.touch
  await scene(`occurrence ${tag}`, async () => {
    const { context, page } = await open(browser, vp)
    await toBoard(page, false)
    const controlH = await tokenPx(page, '--control-h')
    const tapMin = await tokenPx(page, '--tap-min')
    let dlg = await openOccurrence(page)
    await shot(page, dlg, `a2-occurrence-overview-${tag}.png`, { touch, natural: touch })
    const line = dlg.getByText(/^Repeats every Tuesday until/).first()
    const ln = await lines(line)
    check(`${tag} 7 overview series line at most 2 lines`, ln <= 2, { lines: ln })

    await gotoRow(dlg, 'When and where')
    await dlg.getByText('Every Tuesday until').first().waitFor({ timeout: 5000 })
    await shot(page, dlg, `a2-occurrence-when-${tag}.png`, { touch, natural: touch })

    // save-scope-date-moved: type a new Date first, then open Save changes.
    await dlg.getByLabel(/^Date/).fill('2026-09-09')
    await dlg.getByRole('button', { name: 'Save changes' }).click()
    await alert(page).waitFor({ timeout: 5000 })
    await shot(page, alert(page), `a2-save-scope-date-moved-${tag}.png`, { touch })
    const movedRadio = alert(page).getByRole('radio', { name: /^This and all upcoming/ })
    check(`${tag} 5 date moved: "This and all upcoming" disabled`, await movedRadio.isDisabled(), '')
    await alert(page).getByRole('button', { name: 'Keep editing' }).click()

    // save-scope, then the refusal. A reload drops the moved date.
    await toBoard(page, false)
    dlg = await openOccurrence(page)
    await gotoRow(dlg, 'Details')
    await dlg.getByLabel(/Notes/).fill('Bring towels')
    await dlg.getByRole('button', { name: 'Save changes' }).click()
    await alert(page).waitFor({ timeout: 5000 })
    await shot(page, alert(page), `a2-save-scope-${tag}.png`, { touch })
    const rows = alert(page).locator('label:has(input[type=radio])')
    const heights = await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))
    check(`${tag} 5 scope Choice rows >= --control-h${touch ? ' and --tap-min' : ''}`, heights.length === 2 && heights.every((h) => h >= controlH - 0.5 && (!touch || h >= tapMin - 0.5)), { heights, controlH, tapMin })
    const subs = alert(page).locator('label span.text-xs')
    const subLines = await subs.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))))
    check(`${tag} 6 dialog sub lines at most 3 lines`, subLines.every((n) => n <= 3), { subLines })
    checks.push(await layoutCheck(page, alert(page), `save-scope dialog ${tag}`))
    await alert(page).getByRole('radio', { name: /^This and all upcoming/ }).check()
    await alert(page).getByRole('button', { name: 'Save changes' }).click()
    await dlg.getByText(/^Nothing was changed\. Tue 8 Dec:/).waitFor({ timeout: 8000 })
    await shot(page, dlg, `a2-save-refused-${tag}.png`, { touch, natural: touch })

    // cancel-scope, then the refusal. The Details edit is discarded by the refusal staying on the page; the footer button is on the overview.
    await page.keyboard.press('Escape').catch(() => {})
    await context.close()
  })
  await scene(`occurrence cancel ${tag}`, async () => {
    const { context, page } = await open(browser, vp)
    await toBoard(page, false)
    const dlg = await openOccurrence(page)
    await dlg.getByRole('button', { name: 'Cancel activity' }).click()
    await alert(page).waitFor({ timeout: 5000 })
    await alert(page).getByRole('radio', { name: /^This and all upcoming/ }).check()
    await shot(page, alert(page), `a2-cancel-scope-${tag}.png`, { touch })
    const subLines = await alert(page).locator('label span.text-xs').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))))
    check(`${tag} 6 cancel dialog sub lines at most 3 lines`, subLines.every((n) => n <= 3), { subLines })
    await alert(page).getByRole('button', { name: 'Cancel activities' }).click()
    await dlg.getByText(/^Nothing was changed\. Tue 8 Dec:/).waitFor({ timeout: 8000 })
    await shot(page, dlg, `a2-cancel-refused-${tag}.png`, { touch, natural: touch })
    await context.close()
  })
  // dark: save-scope
  await scene(`save-scope dark ${tag}`, async () => {
    const { context, page } = await open(browser, vp)
    await toBoard(page, true)
    const dlg = await openOccurrence(page)
    await gotoRow(dlg, 'Details')
    await dlg.getByLabel(/Notes/).fill('Bring towels')
    await dlg.getByRole('button', { name: 'Save changes' }).click()
    await alert(page).waitFor({ timeout: 5000 })
    await shot(page, alert(page), `a2-save-scope-${tag}-dark.png`, { touch })
    await context.close()
  })
}

// ── List marker ─────────────────────────────────────────────────────────────
for (const vp of VIEWPORTS) {
  const tag = String(vp.w)
  await scene(`list ${tag}`, async () => {
    const { context, page } = await open(browser, vp)
    await page.goto(`${BASE_URL}/rostering/group-activities`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const first = page.getByText(/^Weekly · Strike Zone/).first()
    await first.waitFor({ timeout: 15_000 })
    const rowEl = first.locator('xpath=ancestor::*[self::tr or self::li or @role="row"][1]')
    await shot(page, (await rowEl.count()) ? rowEl : first, `a3-list-marker-${tag}.png`, { touch: vp.touch })
    const info = await first.evaluate((el) => {
      const cs = getComputedStyle(el)
      const truncating = [el, ...el.querySelectorAll('*')].some((n) => getComputedStyle(n).textOverflow === 'ellipsis')
      return { lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight)), truncating }
    })
    // CellText truncates from md (768px) up and wraps below it, so 390 is checked for at most 2 wrapped lines (lead ruling 18).
    check(`${tag} 8 list second line: ${vp.touch ? 'wraps to at most 2 lines below md (CellText)' : '1 line with an ellipsis (CellText)'}`, vp.touch ? info.lines <= 2 : info.lines === 1 && info.truncating, info)
    await page.getByText('Monthly', { exact: true }).first().waitFor({ timeout: 5000 })
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `a3-list-${tag}.png`))).checks)
    await context.close()
  })
}

// ── PR B: scope on add and remove people, agreement warning (SHAPE.md Section B) ──
async function openPeople(page) {
  await page.locator('[data-activity-card="series-people"] [data-activity-open]').first().click()
  const dlg = page.getByRole('dialog').first()
  await dlg.getByText(/^Repeats every Saturday until/).first().waitFor({ timeout: 10_000 })
  return dlg
}
const prow = (dlg, i) => dlg.locator('[data-participant-row]').nth(i)

for (const vp of VIEWPORTS) {
  const tag = String(vp.w)
  const touch = vp.touch
  await scene(`people overview ${tag}`, async () => {
    const { context, page } = await open(browser, vp)
    await toBoard(page, false)
    const dlg = await openPeople(page)
    const pill = dlg.getByText('2 not in agreement')
    await pill.waitFor({ timeout: 5000 })
    await shot(page, dlg, `b-overview-people-pill-${tag}.png`, { touch, natural: touch })
    const b = await box(pill), d = await box(dlg)
    check(`${tag} B overview pill sits inside the dialog`, b.x >= d.x && b.r <= d.r, { pill: [b.x, b.r], dialog: [d.x, d.r] })
    await context.close()
  })
  for (const dark of [false, true]) {
    const suffix = dark ? '-dark' : ''
    await scene(`people warnings ${tag}${suffix}`, async () => {
      const { context, page } = await open(browser, vp)
      await toBoard(page, dark)
      const dlg = await openPeople(page)
      await gotoRow(dlg, 'People')
      const first = prow(dlg, 0), second = prow(dlg, 1)
      await first.getByText('Not in agreement').waitFor({ timeout: 5000 })
      if (!dark) await shot(page, first, `b-warning-noblock-${tag}.png`, { touch, natural: touch })
      await shot(page, second, `b-warning-time-${tag}${suffix}.png`, { touch, natural: touch })
      if (!dark) {
        for (const [name, r] of [['noblock', first], ['time', second]]) {
          const badge = r.locator('span', { hasText: /^(Not in agreement|Outside agreed time)$/ }).first()
          const line = r.locator('p.text-xs').last() // the warning paragraph follows the time-range paragraph; .first() counted the time range (1 line)
          const [bf, lf] = await Promise.all([badge.evaluate((el) => getComputedStyle(el).fontSize), line.evaluate((el) => getComputedStyle(el).fontSize)])
          check(`${tag} B5 ${name} badge is the sm StatusBadge (text-xs, same size as the line)`, bf === lf, { badge: bf, line: lf })
          const n = await lines(line)
          check(`${tag} B5 ${name} warning line at most 3 lines`, n <= 3, { lines: n })
          const rb = await box(r)
          const over = await r.evaluate((el) => el.scrollWidth - el.clientWidth)
          check(`${tag} B5 ${name} row has no sideways overflow`, over <= 0 && rb.r <= (await box(dlg)).r, { over })
        }
        // People list still open, so both widths show the same state; the board's own head and body frames (RosterGrid root carries --roster-sticky-col) scroll sideways by design
        checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `b-people-${tag}.png`), { allow: ['[class*="--roster-sticky-col"] div.overflow-x-auto'] })).checks)
        await page.keyboard.press('Escape').catch(() => {})
      }
      await context.close()
    })
  }
  await scene(`people add-scope ${tag}`, async () => {
    const { context, page } = await open(browser, vp)
    await toBoard(page, false)
    const dlg = await openPeople(page)
    await gotoRow(dlg, 'People')
    await dlg.getByRole('button', { name: 'Add participant' }).click()
    await dlg.getByRole('button', { name: 'Marcus Tran' }).click()
    await alert(page).waitFor({ timeout: 5000 })
    await alert(page).getByRole('radio', { name: /^This and all upcoming/ }).check()
    await shot(page, alert(page), `b-people-add-scope-${tag}.png`, { touch })
    const sub = await alert(page).locator('label span.text-xs').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))))
    check(`${tag} B4 add dialog sub lines at most 3 lines`, sub.every((n) => n <= 3), { sub })
    if (touch) {
      const tapMin = await tokenPx(page, '--tap-min'), hs = await alert(page).getByRole('button').evaluateAll((els) => els.map((el) => Math.max(el.getBoundingClientRect().height, parseFloat(getComputedStyle(el, '::before').height) || 0)))
      check(`${tag} B6 add-scope dialog buttons >= --tap-min`, hs.length > 0 && hs.every((h) => h >= tapMin - 0.5), { hs, tapMin })
    }
    await context.close()
  })
  await scene(`people remove-scope ${tag}`, async () => {
    const { context, page } = await open(browser, vp)
    await toBoard(page, false)
    const dlg = await openPeople(page)
    await gotoRow(dlg, 'People')
    if (touch) {
      const tapMin = await tokenPx(page, '--tap-min'), t = await tapSize(dlg.getByRole('button', { name: /^Remove Liam Okafor from/ }))
      check(`${tag} B6 People-row remove control >= --tap-min each way`, t.w >= tapMin - 0.5 && t.h >= tapMin - 0.5, { t, tapMin })
    }
    await dlg.getByRole('button', { name: /^Remove Liam Okafor from/ }).click()
    await alert(page).waitFor({ timeout: 5000 })
    await alert(page).getByRole('radio', { name: /^This and all upcoming/ }).check()
    await shot(page, alert(page), `b-people-remove-scope-${tag}.png`, { touch })
    const sub = await alert(page).locator('label span.text-xs').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))))
    check(`${tag} B4 remove dialog sub lines at most 3 lines`, sub.every((n) => n <= 3), { sub })
    if (touch) {
      const tapMin = await tokenPx(page, '--tap-min'), hs = await alert(page).getByRole('button').evaluateAll((els) => els.map((el) => Math.max(el.getBoundingClientRect().height, parseFloat(getComputedStyle(el, '::before').height) || 0)))
      check(`${tag} B6 remove-scope dialog buttons >= --tap-min`, hs.length > 0 && hs.every((h) => h >= tapMin - 0.5), { hs, tapMin })
    }
    await context.close()
  })
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
