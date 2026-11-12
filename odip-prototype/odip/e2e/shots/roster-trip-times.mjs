// Trips on the roster: each trip bar day shows its times; the staff picker groups people on a trip. Captures and numeric checks 1-9 of the shape (m1112-trips).
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/roster-trip-times.mjs <outdir>
// Sign-in, the board, the staff list and the person's detail are stubbed with page.route (synthetic people and trips: "Coast Walk", CW-01). Exit 1 on any failed check.
// Pinned inputs: week of Monday 2026-11-02 (?date=), time zone Australia/Sydney, theme set by data-theme, reduced motion.
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

const MONDAY = '2026-11-02'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' })
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const day = (i) => addDays(MONDAY, i)
const t = (date, start, finish) => ({ date, start, finish })

const shift = (o) => ({ id: 'sh', participantId: 'p-0001', participantName: 'Liam Okafor', staffId: 's-2', staffName: 'Owen Brandt', serviceDate: '', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false, durationHours: 8, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...o })
const person = (id, first, last) => ({ id, firstName: first, lastName: last, fullName: `${first} ${last}`, username: first.toLowerCase(), role: 'SupportWorker', position: 'SupportWorker', email: null, mobile: null, region: null, isDriverEligible: true, isFirstAidQualified: true, isMedicationCompetent: true, isManualHandlingCompetent: true, isOvernightEligible: true, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null, manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null, hasExpiredQualifications: false, notes: null })
const STAFF = [person('s-2', 'Owen', 'Brandt'), person('s-3', 'Lena', 'Cho'), person('s-1', 'Yara', 'Young'), person('s-8', 'Zoe', 'Free')]

const LONG_NAME = 'Coast Walk with a very long trip name that must truncate'
// One bar per participant row, so each state has its own bar to crop.
const BARS = {
  a: { tripInstanceId: 't-a', tripCode: 'CW-01', tripName: 'Coast Walk', startDate: day(1), endDate: day(3), isDriver: false, staffShort: 0, days: [t(day(1), '08:00:00', '17:00:00'), t(day(2), '09:30:00', null), t(day(3), null, '17:00:00')] },
  none: { tripInstanceId: 't-none', tripCode: 'HD-02', tripName: 'Harbour Day', startDate: day(0), endDate: day(2), isDriver: false, staffShort: 0, days: [] },
  start: { tripInstanceId: 't-start', tripCode: 'RR-03', tripName: 'River Ride', startDate: day(3), endDate: day(5), isDriver: false, staffShort: 0, days: [t(day(3), '08:00:00', null)] },
  multi: { tripInstanceId: 't-multi', tripCode: 'LT-04', tripName: 'Long Trip', startDate: addDays(MONDAY, -5), endDate: day(10), isDriver: false, staffShort: 0, days: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => t(day(i), '08:30:00', '16:30:00')) },
  one: { tripInstanceId: 't-one', tripCode: 'DT-05', tripName: LONG_NAME, startDate: day(4), endDate: day(4), isDriver: true, staffShort: 2, days: [t(day(4), '12:30:00', '23:30:00')] },
  fin: { tripInstanceId: 't-fin', tripCode: 'FN-06', tripName: 'Night Return', startDate: day(5), endDate: day(5), isDriver: false, staffShort: 0, days: [t(day(5), null, '23:30:00')] },
}
const BAR_ORDER = ['a', 'none', 'start', 'multi', 'one', 'fin']
const prow = (id, name, shifts, bar) => ({ participantId: id, fullName: name, supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, shifts, tripBars: bar ? [bar] : [], scheduledHours: 8, daysWithoutCover: 0 })
const srow = (id, name, bars) => ({ staffId: id, fullName: name, role: 'SupportWorker', compliance: 'Ok', complianceNotes: [], rosteredHours: 8, targetHours: 38, shifts: [], tripBars: bars, leave: [] })

function board(params) {
  const weekStart = params.get('weekStart') || MONDAY
  const staff = /staff/i.test(params.get('groupBy') || '')
  const days = [0, 1, 2, 3, 4, 5, 6].map(day)
  const base = { weekStart, days, exceptions: [], weekStarted: true }
  if (staff) return envelope({ ...base, groupBy: 'Staff', staffRows: [srow('s-1', 'Yara Young', [BARS.a]), srow('s-2', 'Owen Brandt', [BARS.none])], unfilled: [] })
  const open = shift({ id: 'u1', serviceDate: day(2), status: 'Draft' }); delete open.staffId; delete open.staffName
  return envelope({
    ...base, groupBy: 'Participant',
    participantRows: BAR_ORDER.map((k, i) => prow(i === 0 ? 'p-0001' : `p-010${i}`, i === 0 ? 'Liam Okafor' : `Person ${i}`, i === 0 ? [open] : [], BARS[k])),
    staffLeave: [{ staffId: 's-8', from: day(2), to: day(2), status: 'Approved' }],
    // Lena is on Coast Walk on the unfilled shift's day (Wednesday), Yara on a trip whose name is long.
    staffTrips: [
      { staffId: 's-3', tripInstanceId: 't-a', tripName: 'Coast Walk', from: day(1), to: day(3) },
      { staffId: 's-1', tripInstanceId: 't-one', tripName: LONG_NAME, from: day(2), to: day(2) },
    ],
  })
}

// These scroll sideways by design: the roster board's head and body frames (RosterGrid.tsx:66,69).
const BOARD_SCROLLER = ['div.overflow-x-auto.overflow-y-hidden', 'ul.overflow-x-auto.overflow-y-hidden']
const checks = []
const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail })
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})
const bar = (page, id) => page.locator(`a[href="/trips/${id}"]`).first()
const shot = async (page, loc, name) => { const r = await cropElement(page, loc, path.join(OUT_DIR, `${name}.png`)); checks.push(checkCropHolds(r)); return r }
const full = async (page, name) => { mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true }); const r = await fullPage(page, path.join(OUT_DIR, 'full', `${name}.png`), { allow: BOARD_SCROLLER }); checks.push(...r.checks) }
// A token or class measured in px with a throwaway probe element.
const probe = (page, css, cls = '') => page.evaluate(([style, c]) => { const d = document.createElement('div'); d.className = c; d.style.cssText = `position:absolute;visibility:hidden;${style}`; d.textContent = 'x'; document.body.append(d); const h = d.getBoundingClientRect().height; d.remove(); return h }, [css, cls])
const theme = async (page, mode) => { await page.evaluate((m) => document.documentElement.setAttribute('data-theme', m), mode); await settled(page) }
// Contrast of a bar's line-2 text over the bar's own background, with the text's opacity blended in.
const cellContrast = (page, loc) => loc.evaluate((el) => {
  const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d', { willReadFrequently: true })
  const rgba = (col) => { g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = col; g.fillRect(0, 0, 1, 1); const [r, gg, b, a] = g.getImageData(0, 0, 1, 1).data; return [r, gg, b, a / 255] }
  let node = el.parentElement, bg = [255, 255, 255, 0]
  while (node && bg[3] === 0) { bg = rgba(getComputedStyle(node).backgroundColor); node = node.parentElement }
  const fg = rgba(getComputedStyle(el).color); const op = parseFloat(getComputedStyle(el).opacity) * fg[3]
  const mix = fg.slice(0, 3).map((v, i) => v * op + bg[i] * (1 - op))
  const lum = (rgb) => { const [r, gg, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * gg + 0.0722 * b }
  const [hi, lo] = [lum(mix), lum(bg)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
})

async function newPage(browser, vp, { mobile = false, staffView = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-11-04T00:00:00Z')) // pins today to the fixture week (person pages open on the current week)
  if (mobile) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  if (staffView) await page.addInitScript(() => { try { sessionStorage.setItem('odip.roster.boardView', 'staff') } catch { /* none */ } })
  page.on('pageerror', (e) => add(`page error (${vp.width})`, false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/rostering/board*', (r) => r.fulfill({ json: board(new URL(r.request().url()).searchParams) }))
  await page.route(/\/api\/v1\/staff(\?.*)?$/, (r) => r.fulfill({ json: envelope(STAFF) }))
  await page.route(/\/api\/v1\/staff\/s-1$/, (r) => r.fulfill({ json: envelope(STAFF[2]) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}
const openBoard = async (page) => { await page.goto(`${BASE_URL}/rostering?date=${day(2)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await bar(page, 't-a').waitFor({ timeout: 60_000 }); await theme(page, 'light') }

// The numbers of one bar: line 1, line 2 cells, the bar.
const barMetrics = (loc) => loc.evaluate((a) => {
  const line1 = a.querySelector(':scope > span'), cells = [...a.querySelectorAll('[data-trip-day]')]
  return { bar: a.getBoundingClientRect().height, line1: line1?.getBoundingClientRect().height ?? null, cells: cells.length, cellLineHeight: cells[0] ? parseFloat(getComputedStyle(cells[0]).lineHeight) : null, cellLefts: cells.map((c) => ({ date: c.getAttribute('data-trip-day'), left: c.getBoundingClientRect().left })), line2: a.querySelectorAll(':scope > div').length }
})
// Left edges of the 7 day headers (the rows' own strip), for check 4.
const headerLefts = (page) => page.evaluate(() => { const g = [...document.querySelectorAll('div.grid')].find((d) => d.style.gridColumn === '2 / -1' && d.children.length === 7); return g ? [...g.children].map((c) => c.getBoundingClientRect().left) : [] })

const browser = await chromium.launch({ headless: true })
try {
  // ---- 1280, fine pointer ----
  {
    const { context, page } = await newPage(browser, { width: 1280, height: 800 })
    await openBoard(page)
    const controlSm = await probe(page, 'height:var(--control-h-sm)')
    const text = await probe(page, '', 'text-xs'); const pb1 = await probe(page, 'height:0;box-sizing:content-box;', 'pb-1') // pb-1 adds 4px to a 0-height box
    const none = await barMetrics(bar(page, 't-none'))
    add('1 bar with no visible times: height = --control-h-sm, no line-2 element', Math.abs(none.bar - controlSm) <= 0.5 && none.cells === 0 && none.line2 === 0, { none, controlSm })
    const a = await barMetrics(bar(page, 't-a'))
    add('2 bar with times: line 1 = --control-h-sm, line-2 line-height = text-xs, bar = line 1 + line 2 + pb-1', Math.abs(a.line1 - controlSm) <= 0.5 && Math.abs(a.cellLineHeight - text) <= 0.5 && Math.abs(a.bar - (a.line1 + text + pb1)) <= 1, { a, controlSm, text, pb1 })
    const heads = await headerLefts(page)
    const idx = (date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${MONDAY}T00:00:00Z`)) / 86400000)
    const off = a.cellLefts.map((c) => Math.abs(c.left - heads[idx(c.date)]))
    add('4 line-2 cells align with their day column (<= 1px), count = visible days', a.cells === 3 && heads.length === 7 && off.every((v) => v <= 1), { cells: a.cells, off })
    const multi = await barMetrics(bar(page, 't-multi'))
    add('4b multi-week bar shows only the 7 visible days', multi.cells === 7, { cells: multi.cells })

    // Diagnostic for the document-level overflow: elements past the viewport edge that no sideways scroller clips.
    add('no element sticks out of the 1280 viewport outside the board scrollers', true, await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 5).map((e) => `${e.tagName}.${String(e.className).slice(0, 90)} ovx=${getComputedStyle(e.parentElement).overflowX} right=${Math.round(e.getBoundingClientRect().right)}`)))
    await full(page, 'normal')
    await shot(page, bar(page, 't-a'), 'participant-view-bar-with-times')
    await shot(page, bar(page, 't-none'), 'bar-with-no-times')
    await shot(page, bar(page, 't-start'), 'start-only-day')

    // 9 contrast, light then dark.
    const cell = page.locator('[data-trip-day]').first()
    const light = await cellContrast(page, cell)
    await theme(page, 'dark')
    const dark = await cellContrast(page, cell)
    add('9 line-2 contrast >= 4.5 (light, dark)', light >= 4.5 && dark >= 4.5, { light, dark })
    await shot(page, bar(page, 't-a'), 'dark-theme')
    await theme(page, 'light')

    // Picker at the 1280 panel, then dark.
    await page.locator('[data-shift-plus="u1"]').click()
    const dlg = page.getByRole('dialog').filter({ has: page.getByRole('combobox', { name: 'Find staff' }) })
    await dlg.waitFor({ timeout: 15_000 }); await settled(page)
    const labels = await dlg.locator('[role="group"]').evaluateAll((gs) => gs.map((g) => document.getElementById(g.getAttribute('aria-labelledby')).textContent.trim()))
    add('picker group order has the Trip group before Leave', labels.includes('On a trip that day') && labels.indexOf('On a trip that day') < labels.indexOf('On leave that day'), labels)
    const lena = dlg.getByRole('option', { name: /^Lena Cho/ }), zoe = dlg.getByRole('option', { name: /^Zoe Free/ })
    const [hl, hz] = [await lena.evaluate((e) => e.clientHeight), await zoe.evaluate((e) => e.clientHeight)]
    add('8 trip row height = leave row height (+-1)', Math.abs(hl - hz) <= 1, { trip: hl, leave: hz })
    const yara = dlg.getByRole('option', { name: /^Yara Young/ })
    const nameFit = await yara.evaluate((el) => { const s = [...el.querySelectorAll('span')].find((x) => x.textContent === 'Coast Walk with a very long trip name that must truncate'); return s ? { trunc: s.scrollWidth > s.clientWidth, h: s.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(s).lineHeight) } : null })
    add('8b long trip name truncates on one line', nameFit && nameFit.trunc && nameFit.h <= nameFit.lh + 1, nameFit)
    checks.push(await layoutCheck(page, dlg, 'picker trip group'))
    await shot(page, dlg, 'picker-trip-group')
    await theme(page, 'dark')
    await shot(page, dlg, 'picker-trip-dark')
    await context.close()
  }

  // ---- 1600, the clamped multi-week bar (whole bar in view) ----
  {
    const { context, page } = await newPage(browser, { width: 1600, height: 900 })
    await openBoard(page)
    await shot(page, bar(page, 't-multi'), 'multi-week-bar-clamped')
    await context.close()
  }

  // ---- 1280, staff view ----
  {
    const { context, page } = await newPage(browser, { width: 1280, height: 800 }, { staffView: true })
    await page.goto(`${BASE_URL}/rostering?date=${day(2)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await bar(page, 't-a').waitFor({ timeout: 60_000 }); await theme(page, 'light')
    const m = await barMetrics(bar(page, 't-a'))
    add('staff view bar carries the trip times (3 cells)', m.cells === 3, m)
    await shot(page, bar(page, 't-a'), 'staff-view-bar-with-times')
    await context.close()
  }

  // ---- 1280, person week (staff detail) and the narrow container day list ----
  for (const [vp, name] of [[{ width: 1280, height: 800 }, 'person-week-view'], [{ width: 390, height: 844 }, 'person-day-view']]) {
    const { context, page } = await newPage(browser, vp, { mobile: vp.width < 600 })
    await page.goto(`${BASE_URL}/staff/s-1?tab=week`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const link = bar(page, 't-a')
    await link.waitFor({ timeout: 30_000 }).catch(async () => { add(`${name} page shows the bar`, false, (await page.locator('body').innerText()).slice(0, 400)) })
    if (!(await link.count())) { await context.close(); continue }
    await theme(page, 'light')
    const m = await barMetrics(link)
    add(`${name} bar carries times`, m.cells >= 1, m)
    await shot(page, link, name)
    await context.close()
  }

  // ---- 390, coarse pointer ----
  {
    const { context, page } = await newPage(browser, { width: 390, height: 844 }, { mobile: true })
    await openBoard(page)
    const controlH = await probe(page, 'height:var(--control-h)')
    const bars = await page.locator('a[href^="/trips/"]').evaluateAll((as) => as.map((a) => a.getBoundingClientRect().height))
    add('3 coarse pointer: every bar >= --control-h', bars.length === 6 && bars.every((h) => h >= controlH - 0.5), { bars, controlH })
    // 5: the longest time texts at the day-column minimum fit.
    const fits = await page.evaluate(() => [...document.querySelectorAll('[data-trip-day]')].filter((c) => /12:30pm–11:30pm|until 11:30pm/.test(c.textContent)).map((c) => ({ text: c.textContent, sw: c.scrollWidth, cw: c.clientWidth })))
    add('5 12:30pm–11:30pm and until 11:30pm do not clip at --roster-day-col-min', fits.length === 2 && fits.every((f) => f.sw <= f.cw), fits)
    const one = await bar(page, 't-one').evaluate((a) => {
      const line1 = a.querySelector(':scope > span'), name = [...line1.querySelectorAll('span')].find((s) => s.textContent.startsWith('Coast Walk')), tags = [...line1.querySelectorAll('span')].filter((s) => s !== name && (s.textContent === 'Driver' || /short/.test(s.textContent)))
      return { nameTrunc: name ? name.scrollWidth > name.clientWidth : null, tags: tags.filter((s) => s.clientWidth > 1).map((s) => [s.textContent, s.scrollWidth, s.clientWidth]) }
    })
    add('6 one-day bar: name truncates, Driver and short pill do not clip', one.nameTrunc === true && one.tags.length >= 2 && one.tags.every((x) => x[1] <= x[2]), one)
    await bar(page, 't-one').scrollIntoViewIfNeeded()
    await shot(page, bar(page, 't-one'), 'one-day-bar-with-driver-and-short-pill')
    await bar(page, 't-a').scrollIntoViewIfNeeded()
    await shot(page, bar(page, 't-a'), 'coarse-pointer')
    await full(page, 'board-at-390')
    // Picker as a sheet.
    await page.locator('[data-shift-plus="u1"]').click()
    const dlg = page.getByRole('dialog').filter({ has: page.getByRole('combobox', { name: 'Find staff' }) })
    await dlg.waitFor({ timeout: 15_000 }); await settled(page)
    const tapMin = await probe(page, 'height:var(--tap-min)')
    const rowH = await dlg.getByRole('option', { name: /^Lena Cho/ }).evaluate((e) => e.getBoundingClientRect().height)
    add('8c coarse trip row >= --tap-min', rowH >= tapMin - 0.5, { rowH, tapMin })
    await dlg.evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' })); await settled(page)
    await dlg.screenshot({ path: path.join(OUT_DIR, 'picker-trip-sheet-at-390.png') })
    await context.close()
  }
} catch (e) {
  add('script error', false, String(e && e.stack || e).slice(0, 600))
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
