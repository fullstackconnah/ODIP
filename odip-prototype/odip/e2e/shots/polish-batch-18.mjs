// Polish batch 18: a claimed shift's panel (Ratio, Night type, Support type locked, one hint line) at 390 and 1280, and the Claims hub Checks reason wrapping to at most two lines at 1280 and 768.
// States: shift-claimed-390, shift-claimed-1280, checks-1280, checks-768. Numeric checks in checks.json. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/polish-batch-18.mjs <outdir>
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }

async function signIn(browser, vp, role, username) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username, role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  const go = async () => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const btn = page.getByRole('button', { name: 'Sign in as selected user' })
    await btn.waitFor({ state: 'visible', timeout: 60_000 })
    await btn.click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  }
  return { context, page, login: go }
}

// A claimed shift on the roster board (copied from support-type.mjs).
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000))
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
const MON = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
const CLAIM = 'CLM-20261101-0042'
const SHIFT = {
  id: 'pb18-claimed', participantId: 'p-0001', participantName: 'Liam Okafor', staffId: 's-0003', staffName: "Jack O'Sullivan", serviceDate: MON, startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false,
  durationHours: 6, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, supportGroupCode: 'GRP_ART', claimReference: CLAIM,
}
const hourly = { id: 'b', itemNumber: '04_b', description: 'Hourly', unit: 'H', dayType: 'Weekday', isIntensive: false, effectiveFrom: '2025-07-01' }
const GROUPS = [{ id: 'g2', groupCode: 'GRP_ART', displayName: 'Art therapy', supportCategory: 4, isActive: true, items: [hourly] }]
const board = (url) => {
  const asked = new URL(url).searchParams.get('weekStart')
  const mon = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : MON
  return envelope({
    groupBy: 'Participant', weekStart: mon, weekStarted: true, days: [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i)), exceptions: [], staffLeave: [],
    participantRows: [{ participantId: 'p-0001', fullName: 'Liam Okafor', supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, shifts: mon === MON ? [SHIFT] : [], tripBars: [], scheduledHours: 6, daysWithoutCover: 6 }],
  })
}

async function shiftState(browser, vp) {
  const { context, page, login } = await signIn(browser, vp, 'Admin', 'dev.admin')
  await page.route('**/api/v1/rostering/board*', (r) => r.fulfill({ json: board(r.request().url()) }))
  await page.route('**/api/v1/rostering/shifts/check', (r) => r.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/support-catalogue', (r) => r.fulfill({ json: envelope(GROUPS) }))
  await login()
  await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const chip = page.locator(`[data-shift-open="${SHIFT.id}"]`).first()
  await chip.waitFor({ state: 'visible', timeout: 60_000 })
  await chip.scrollIntoViewIfNeeded()
  await chip.click({ position: { x: 6, y: 6 } })
  const dialog = page.getByRole('dialog').last()
  await dialog.waitFor({ state: 'visible', timeout: 30_000 })
  const field = dialog.locator('label', { hasText: /^Support type$/ }).locator('xpath=..')
  await field.locator('input[role=combobox]').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => [...document.querySelectorAll('input[role=combobox]')].every((i) => i.placeholder !== 'Loading support types…'), null, { timeout: 30_000 })
  await field.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  const t = (n) => `${vp.name}: ${n}`
  const m = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role=dialog]')].pop()
    const wrap = (name) => [...d.querySelectorAll('label')].find((l) => l.textContent.replace('*', '').trim() === name).parentElement
    const hint = [...wrap('Support type').querySelectorAll('p, span, div')].find((e) => e.textContent.includes('On claim'))
    let scroller = hint
    while (scroller && scroller !== document.body) { const o = getComputedStyle(scroller).overflowY; if (o === 'auto' || o === 'scroll') break; scroller = scroller.parentElement }
    const hb = hint.getBoundingClientRect(), db = d.getBoundingClientRect()
    const lh = parseFloat(getComputedStyle(hint).lineHeight)
    const walker = document.createTreeWalker(hint, NodeFilter.SHOW_TEXT), tn = walker.nextNode(), words = []
    const rr = document.createRange(); const re = /\S+/g; let mt
    while ((mt = re.exec(tn.data))) { rr.setStart(tn, mt.index); rr.setEnd(tn, mt.index + mt[0].length); words.push(rr.getBoundingClientRect().bottom) }
    const lastWords = words.filter((b) => b > Math.max(...words) - 2).length
    return {
      ratioOff: wrap('Ratio').querySelector('button').disabled, nightOff: wrap('Night type').querySelector('button').disabled, typeOff: wrap('Support type').querySelector('input').disabled,
      hint: hint.textContent.trim(), hintRight: hb.right, dialogRight: db.right, hintLines: Math.round(hb.height / lh), lastWords, sw: scroller?.scrollWidth, cw: scroller?.clientWidth,
    }
  })
  check(t('Ratio, Night type and Support type are all disabled'), m.ratioOff && m.nightOff && m.typeOff, JSON.stringify(m))
  check(t('the hint names the claim and says these'), m.hint === `On claim ${CLAIM}. Delete that claim to change these.`, m.hint)
  check(t('the hint stays inside the panel'), m.hintRight <= m.dialogRight + 0.5, `${m.hintRight} <= ${m.dialogRight}`)
  check(t('the hint is at most 2 lines'), m.hintLines <= 2, m.hintLines)
  check(t('the last hint line holds at least 2 words'), m.lastWords >= 2, m.lastWords)
  check(t('no horizontal overflow in the panel'), m.sw === undefined || m.sw <= m.cw, `${m.sw}/${m.cw}`)
  const row = dialog.locator('label', { hasText: /^Ratio$/ }).locator('xpath=../..')
  const r = await cropElement(page, field, path.join(OUT_DIR, `shift-claimed-${vp.name}.png`), { touch: vp.touch, also: row })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
  await context.close()
}

// Claims hub Ready tab: one blocked claim among passing ones (fixture copied from polish-batch-17.mjs).
const hubLine = (i, over = {}) => ({
  lineId: `l${i}`, claimId: `c${i}`, claimReference: `CLM-000${i}`, claimKind: 'shift', participantId: `p${i}`, participantName: ['Jo Park', 'Sam Lee', 'Alex Rivera', 'Mina Okafor'][i % 4],
  supportNumber: '04_104_0125_6_1', supportName: 'Short-notice cancellation', from: '2026-10-18', to: '2026-10-18', hours: 3, quantity: 3, unitPrice: 67.56, totalAmount: 202.68,
  gstCode: 'P2', claimType: 'Standard', fundingType: 'agency', ageDays: 5, ageBand: 'none', nextAttempt: 1, problems: [], ...over,
})
const blockMsg = "04_104_0125_6_1 can't be claimed as a short-notice cancellation. Check the short-notice setting for this item in the price guide."
const hubLines = { ready: [hubLine(0, { problems: [{ rule: 'CancellationNotAllowed', severity: 'block', message: blockMsg }] }), hubLine(1), hubLine(2), hubLine(3)], rejected: [], managed: [] }

async function checksState(browser, vp) {
  const { context, page, login } = await signIn(browser, vp, 'Admin', 'dev.admin')
  await page.route('**/api/v1/claim-hub/lines', (r) => r.fulfill({ json: envelope(hubLines) }))
  await login()
  await page.goto(`${BASE_URL}/claims`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const reason = page.getByText("can't be claimed as a short-notice").first()
  await reason.waitFor({ state: 'attached', timeout: 90_000 })
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  await page.waitForTimeout(800)
  const t = (n) => `${vp.name}: ${n}`
  const th = page.locator('th').filter({ hasText: /^Checks$/ }).first()
  await th.waitFor({ state: 'visible', timeout: 90_000 })
  const m = await th.evaluate((el, msg) => {
    const table = el.closest('table'), wrap = table.parentElement
    const idx = [...el.parentElement.children].indexOf(el)
    const cell = [...table.querySelectorAll('tbody tr')].map((tr) => tr.children[idx]).find((c) => c.textContent.includes(msg.slice(0, 20)))
    const span = [...cell.querySelectorAll('span')].find((s) => s.textContent.includes(msg.slice(0, 20)))
    const lh = parseFloat(getComputedStyle(span).lineHeight)
    return { reasonLines: Math.round(span.getBoundingClientRect().height / lh), wrapScroll: wrap.scrollWidth, wrapClient: wrap.clientWidth, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  }, blockMsg)
  check(t('the reason is at most 2 lines'), m.reasonLines <= 2, m.reasonLines)
  // At 768 the table scrolls inside its own wrapper by design; only the page may not overflow there.
  check(t('the table has no horizontal overflow'), (vp.width < 1280 || m.wrapScroll <= m.wrapClient) && m.doc <= 0, JSON.stringify(m))
  const table = page.locator('main table').filter({ has: page.locator('th', { hasText: /^Checks$/ }) }).first()
  await table.locator('xpath=..').evaluate((w) => { w.scrollLeft = w.scrollWidth })
  await page.waitForTimeout(300)
  const r = await cropElement(page, table.locator('xpath=..'), path.join(OUT_DIR, `checks-${vp.name}.png`), { touch: vp.touch, natural: true, pad: 8 })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
  await context.close()
}

const browser = await chromium.launch({ headless: true })
try {
  await shiftState(browser, { name: '1280', width: 1280, height: 900, touch: false })
  await shiftState(browser, { name: '390', width: 390, height: 844, touch: true })
  await checksState(browser, { name: '1280', width: 1280, height: 900, touch: false })
  await checksState(browser, { name: '768', width: 768, height: 1024, touch: false })
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
