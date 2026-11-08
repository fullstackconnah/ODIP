// Group activities payroll shots: a group staff line on Payroll (the "Group activity" pill) and the dashboard's "Group activities" decision tab.
// States: payroll 390 and 1280 expanded group lines (Sent, Waiting, Failed, Not linked), payroll 390 long title; dashboard 1280 and 390 group tab, dashboard 1280 flag off.
// Numeric checks P1 to P5 (Payroll) and D1 to D4 (dashboard), each against a house token. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/ga-payroll.mjs <outdir>
// The payroll, settings and review reads are stubbed with page.route; the rest of the dashboard reads the mock-api. The clock, theme and zone are pinned.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const NOW = new Date('2026-10-21T01:00:00Z')   // 12:00 pm Wednesday 21 Oct in Sydney (AEDT)
const checks = []
const check = (name, detail, pass) => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }
const px = (page, token) => page.evaluate((t) => { const p = document.createElement('div'); p.style.height = `var(${t})`; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h }, token)
const crop = async (page, locator, file, vp, pad = 8) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, `${file}.png`), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
const LONG = 'Community access afternoon with the Riverside Craft Group at the Old Mill'   // 60+ characters

const shift = (id, o = {}) => ({
  shiftId: id, serviceDate: '2026-10-14', participantName: 'Alex Example', rosteredStart: '09:00', rosteredEnd: '15:00', endsNextDay: false, rosteredMinutes: 360,
  actualStart: '2026-10-13T22:02:00Z', actualEnd: '2026-10-14T04:01:00Z', timeZoneId: 'Australia/Sydney', breakMinutes: 30, paidMinutes: 330, nightType: 'None',
  status: 'Sent', reason: '', sentAt: '2026-10-15T01:00:00Z', sendable: false, paidStart: '2026-10-13T22:02:00Z', paidEnd: '2026-10-14T04:01:00Z', extraTimeHeld: false, ...o,
})
const group = (id, title, o = {}) => shift(id, { participantName: title, isGroupActivity: true, ...o })
const payrollCheck = (shifts, worker = {}) => ({
  from: '2026-10-06', to: '2026-10-19', approved: shifts.length, sent: 1, waiting: 1, failed: 1, changed: 0, notLinked: 1, sendable: shifts.filter((s) => s.sendable).length, awaitingApproval: 0,
  workers: [{ userId: 'u-w', name: 'Wendy Worker', linked: true, rosteredMinutes: 360 * shifts.length, paidMinutes: 330 * shifts.length, shifts, ...worker }],
})
const STATES = [
  group('g-sent', 'Ten-pin bowling'),
  group('g-wait', 'Ten-pin bowling', { serviceDate: '2026-10-15', status: 'Waiting', sentAt: null, sendable: true, reason: 'Not queued yet. Send missing queues it.' }),
  group('g-fail', 'Craft morning', { serviceDate: '2026-10-16', status: 'Failed', sentAt: null, sendable: true, reason: "Employment Hero refused it. We'll try again at 3:15 pm." }),
  group('g-link', 'Picnic at the park', { serviceDate: '2026-10-17', status: 'NotLinked', sentAt: null, reason: 'Wendy Worker has no Employment Hero ID.' }),
]
const WITH_HELD = [...STATES, shift('held', { serviceDate: '2026-10-18', extraTimeHeld: true, status: 'Waiting', sentAt: null })]
const LONG_LINE = [group('g-long', LONG, { status: 'NotLinked', sentAt: null, reason: 'Wendy Worker has no Employment Hero ID.' })]

const review = (id, o = {}) => ({
  rowId: id, groupActivityId: 'ga-1', activityTitle: 'Ten-pin bowling', serviceDate: '2026-10-20', userId: `u-${id}`, staffName: 'Wendy Worker', role: null,
  startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false, actualStart: '2026-10-19T22:02:00Z', actualEnd: '2026-10-20T04:01:00Z', breakStartedAt: null, breakEndedAt: null,
  timeZoneId: 'Australia/Sydney', state: 'Finished', locationCheck: 'AtLocation', offRoster: false, adjustmentReason: null, payrollLinked: true, participantCount: 2, ...o,
})
const REVIEWS = [
  review('r1'),
  review('r2', { staffName: 'Omar Offroster', offRoster: true, locationCheck: 'NotAtLocation', payrollLinked: false, adjustmentReason: 'Phone died' }),   // three flags
  review('r3', { staffName: 'Sam Started', state: 'Started', actualEnd: null }),
]
const LONG_REVIEWS = [review('r1', { activityTitle: LONG }), review('r2', { activityTitle: LONG, staffName: 'Omar Offroster', offRoster: true })]

async function open(browser, vp, { periodsAndCheck, reviews, flag = true }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch { /* storage blocked */ } }, [USER_ID])
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, e.message, false))
  const login = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route((u) => u.pathname === '/api/v1/settings', async (r) => {
    const res = await r.fetch()
    const body = await res.json()
    await r.fulfill({ response: res, json: { ...body, data: { ...(body.data ?? {}), groupActivitiesEnabled: flag } } })
  })
  await page.route((u) => u.pathname === '/api/v1/rostering/group-activities/staff-reviews', (r) => r.fulfill({ json: envelope({ rows: reviews ?? [], total: (reviews ?? []).length }) }))
  await page.route((u) => u.pathname === '/api/v1/integrations/employment-hero/payroll/periods', (r) => r.fulfill({
    json: envelope({ connected: true, today: '2026-10-14', periods: [{ payScheduleId: 1, scheduleName: 'Fortnightly', from: '2026-10-06', to: '2026-10-19', finalised: false }] }) }))
  await page.route((u) => u.pathname === '/api/v1/integrations/employment-hero/payroll', (r) => r.fulfill({ json: envelope(periodsAndCheck ?? payrollCheck(STATES)) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(NOW)
  return { context, page }
}

async function payroll(browser, vp, data, file, tag) {
  const { context, page } = await open(browser, vp, { periodsAndCheck: data })
  await page.goto(`${BASE_URL}/rostering/payroll`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  // A worker with any unsent line opens by default; only a closed one needs the click.
  const toggle = page.getByRole('button', { name: /^(Show|Hide) shifts: Wendy Worker$/ })
  await toggle.waitFor({ timeout: 60_000 })
  if (/^Show/.test(await toggle.getAttribute('aria-label'))) await toggle.click()
  const list = page.locator('ul[id^="shifts-"]')
  await list.waitFor()
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await crop(page, list, file, vp)
  const lis = list.locator('> li')
  const n = await lis.count()
  const over = await page.evaluate(() => document.documentElement.scrollWidth)
  check(`${tag} no horizontal scroll`, `${over} vs ${vp.width}`, over <= vp.width)
  // Word badge right edge within 1 px of its li right edge, on every line.
  let worst = 0
  for (let i = 0; i < n; i++) {
    const li = await lis.nth(i).boundingBox()
    const word = await lis.nth(i).locator('> div').first().locator('> *').last().boundingBox()
    worst = Math.max(worst, Math.abs(li.x + li.width - (word.x + word.width)))
  }
  check(`${tag} Word badge right edge within 1 px of its line`, `${worst.toFixed(2)} px over ${n} lines`, worst <= 1)
  return { context, page, list }
}

const browser = await chromium.launch({ headless: true })
try {
  const phone = { name: '390', width: 390, height: 844, touch: true }
  const desk = { name: '1280', width: 1280, height: 900, touch: false }

  // Payroll: the four word states on group lines.
  let r = await payroll(browser, phone, payrollCheck(WITH_HELD), 'payroll-390-expanded-group-lines', 'P1/P3 payroll 390')
  const tapMin = await px(r.page, '--tap-min')
  const ctl = await px(r.page, '--control-h')
  const groupPill = r.page.getByText('Group activity', { exact: true }).first()
  const heldPill = r.page.getByText('Extra time held', { exact: true })
  const gh = (await groupPill.boundingBox()).height, hh = (await heldPill.boundingBox()).height
  check('P2 Group pill box height equals the Extra time held pill', `${gh} vs ${hh}`, Math.abs(gh - hh) === 0)
  const link = r.page.getByRole('link', { name: /Link in Settings/ }).first()
  const lh = (await link.boundingBox()).height
  check('P4 the Link in Settings link is at least --tap-min tall on a coarse pointer', `${Math.round(lh)} vs ${tapMin}`, lh >= tapMin - 0.5)
  await r.context.close()

  r = await payroll(browser, desk, payrollCheck(STATES), 'payroll-1280-expanded-group-lines', 'P3 payroll 1280')
  await crop(r.page, r.list, 'payroll-1280-same', desk)
  const send = r.page.getByRole('button', { name: /^Send missing/ })
  const sh = (await send.boundingBox()).height
  const label = (await send.textContent()).trim()
  const expected = STATES.filter((s) => s.sendable).length
  check('P5 Send missing is --control-h tall and counts the sendable group lines', `${Math.round(sh)} vs ${ctl}; "${label}"; expected ${expected}`, Math.abs(sh - ctl) <= 1 && label.includes(`(${expected})`))
  await r.context.close()

  r = await payroll(browser, phone, payrollCheck(LONG_LINE), 'payroll-390-long-title', 'P1 payroll 390 long title')
  await r.context.close()

  // Dashboard: the Group activities tab.
  const dash = async (vp, file, { flag = true, reviews = REVIEWS } = {}) => {
    const { context, page } = await open(browser, vp, { reviews, flag })
    await page.route(/\/api\/v1\/rostering\/completions(\?.*)?$/, (route) => route.fulfill({ json: envelope({ items: [], totalCount: 0, page: 1, pageSize: 1 }) }))
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('heading', { level: 2, name: 'Needs your decision' }).waitFor({ timeout: 60_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    const tab = page.getByRole('tab', { name: /^Group activities/ })
    if (flag) { await tab.waitFor({ timeout: 30_000 }); await tab.click() }
    const section = page.getByRole('heading', { level: 2, name: 'Needs your decision' }).locator('xpath=..')
    await section.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    await crop(page, section, file, vp)
    return { context, page, section, tab }
  }

  let d = await dash(desk, 'dashboard-1280-group-tab')
  const fine = await px(d.page, '--control-h')
  const approve = d.section.getByRole('button', { name: /^Approve hours: Wendy Worker/ })
  const review1 = d.section.getByRole('link', { name: /^Review hours: Omar Offroster/ })
  const ah = (await approve.boundingBox()).height, rh = (await review1.boundingBox()).height
  check('D1 Approve and Review are --control-h tall on a fine pointer', `${Math.round(ah)} and ${Math.round(rh)} vs ${fine}`, Math.abs(ah - fine) <= 1 && rh >= fine - 1)
  const chipWords = ['Off roster', 'Off site', 'No payroll ID', 'Edited']
  const row = d.section.locator('tr', { hasText: 'Omar Offroster' }).first()
  const drawn = (await Promise.all(chipWords.map(async (w) => (await row.getByText(w, { exact: true }).count())))).reduce((a, b) => a + b, 0)
  check('D4 at most 2 flag chips are drawn on a row with 3 flags', `${drawn} drawn`, drawn <= 2 && drawn >= 1)
  const tabsOn = await d.page.getByRole('tab').evaluateAll((els) => els.map((e) => ({ t: e.textContent.replace(/\s*\(\d+\)\s*$/, '').trim(), x: Math.round(e.getBoundingClientRect().x * 100) / 100 })))
  await d.context.close()

  d = await dash(desk, 'dashboard-1280-flag-off', { flag: false })
  const tabsOff = await d.page.getByRole('tab').evaluateAll((els) => els.map((e) => ({ t: e.textContent.replace(/\s*\(\d+\)\s*$/, '').trim(), x: Math.round(e.getBoundingClientRect().x * 100) / 100 })))
  const present = (tabsOn.find((t) => t.t === 'Group activities'))
  const moved = tabsOff.filter((o) => { const on = tabsOn.find((t) => t.t === o.t); return !on || Math.abs(on.x - o.x) > 0 })
  check('D3 existing tabs keep their x positions with and without the Group activities tab, and the flag-off page has no such tab', `${tabsOff.length} tabs; moved ${moved.length}; tab on with flag: ${!!present}; off: ${tabsOff.some((t) => t.t === 'Group activities')}`, moved.length === 0 && !!present && !tabsOff.some((t) => t.t === 'Group activities'))
  await d.context.close()

  d = await dash(phone, 'dashboard-390-group-tab', { reviews: LONG_REVIEWS })
  const over = await d.page.evaluate(() => document.documentElement.scrollWidth)
  check('D2 no horizontal scroll at 390 with a 60-character activity title', `${over} vs 390`, over <= 390)
  const btn = d.section.getByRole('button', { name: /^Approve hours: Wendy Worker/ })
  const bh = (await btn.boundingBox()).height
  check('D1 Approve is at least --tap-min tall on a coarse pointer', `${Math.round(bh)} vs ${tapMin}`, bh >= tapMin - 0.5)
  await d.context.close()
} finally {
  await browser.close()
}

writeChecks(OUT_DIR, checks)
const failed = checks.filter((c) => !c.pass)
console.log(`${checks.length - failed.length} of ${checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)
