// Polish batch 4: Reports "Show all" inset (A2), run modal sticky footer (A3), card-mode footer gap (A4), settings rail / incidents hover and focus (C1).
// Numeric checks come from polish-batch-4/SHAPE.md; computed boxes and styles only, never class names. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/polish-batch-4.mjs <outdir>
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

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const overdue = envelope([{ id: 'inc-1', title: 'Slip in kitchen', tripName: null, incidentType: 'Injury', severity: 'Low', status: 'Draft', reportedByName: 'Alex Rivera', incidentDateTime: '2026-09-01T10:00:00Z', qscReportingStatus: 'Required', isOverdue24h: true }])
const NAMES = ['Sam Lee', 'Jo Park', 'Alex Rivera', 'Mina Okafor', 'Tom Hughes', 'Priya Nair', 'Lena Fischer', 'Omar Haddad']
const hoursRows = NAMES.map((workerName, i) => ({ workerId: `w${i}`, workerName, approvedShifts: 3 + i, approvedHours: 20 + i * 3.5, awaitingApprovalHours: i % 3 }))
const fulfilment = [{ weekStart: '2026-10-05', partWeek: false, shifts: 20, filled: 18, unstaffed: 1, cancelled: 1, fillRatePercent: 90 }, { weekStart: '2026-10-12', partWeek: false, shifts: 22, filled: 22, unstaffed: 0, cancelled: 0, fillRatePercent: 100 }]
const leave = [{ leaveId: 'l1', workerId: 'w0', workerName: 'Sam Lee', type: 'Annual', from: '2026-10-06', to: '2026-10-08', daysInRange: 3 }]

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} = ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}
const safe = async (name, fn) => { try { await fn() } catch (e) { check(`${name} (script error)`, false, String(e.message).split('\n')[0]) } }
const within = (a, b, tol) => Math.abs(a - b) <= tol

const browser = await chromium.launch({ headless: true })

async function openPage(context) {
  const page = await context.newPage()
  // Left edge of an element's first non-empty text node (a Range, so the padding and buttons around it don't count).
  await page.addInitScript(() => {
    window.__textLeft = (el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) })
      const range = document.createRange()
      range.selectNodeContents(walker.nextNode())
      return range.getBoundingClientRect().left
    }
  })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/incidents/overdue-qsc*', (r) => r.fulfill({ json: overdue }))
  await page.route(/\/api\/v1\/reports\/hours-by-worker/, (r) => r.fulfill({ json: envelope(hoursRows) }))
  await page.route(/\/api\/v1\/reports\/shift-fulfilment/, (r) => r.fulfill({ json: envelope(fulfilment) }))
  await page.route(/\/api\/v1\/reports\/leave-taken/, (r) => r.fulfill({ json: envelope(leave) }))
  // Enough participants that the run modal's panel scrolls at 1280x842 and at 390x844.
  await page.route('**/api/v1/claims/from-shifts/preview', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    const base = body.data.participants
    const participants = Array.from({ length: 14 }, (_, i) => ({ ...base[i % base.length], participantId: `p${i}`, participantName: i < base.length ? base[i].participantName : NAMES[i % NAMES.length] }))
    await route.fulfill({ response: res, json: { ...body, data: { ...body.data, participants } } })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  return page
}
const gotoReady = async (page, url, dark) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('main, form').first().waitFor({ state: 'visible', timeout: 60_000 })
  if (dark) await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForTimeout(800)
}
// Fonts and animations done, two frames; the pointer is left where the caller put it (hover shots need that).
const quiet = async (page) => {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}
// Crop the union of the locators plus pad, clamped to the viewport; the check says the clip holds every box whole.
async function shoot(page, name, locators, pad = 16) {
  const list = Array.isArray(locators) ? locators : [locators]
  await list[list.length - 1].scrollIntoViewIfNeeded()
  await quiet(page)
  const boxes = []
  for (const l of list) boxes.push(await l.boundingBox())
  const vp = page.viewportSize()
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y))
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height))
  const clip = { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), width: 0, height: 0 }
  clip.width = Math.min(vp.width, x1 + pad) - clip.x
  clip.height = Math.min(vp.height, y1 + pad) - clip.y
  const holds = clip.x <= x0 + 1 && clip.y <= y0 + 1 && clip.x + clip.width >= x1 - 1 && clip.y + clip.height >= y1 - 1
  check(`crop holds the whole element: ${name}.png`, holds, { clip, box: { x0, y0, x1, y1 }, viewport: vp })
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), clip })
}
const tabTo = async (page, locator) => {
  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0) })
  for (let i = 0; i < 160; i++) {
    await page.keyboard.press('Tab')
    if (await locator.evaluate((el) => el === document.activeElement)) return true
  }
  return false
}
const hideTabBar = (page) => page.addStyleTag({ content: 'nav.fixed.bottom-0 { display: none !important; }' })

// A2: the "Show all" label against the table's own text.
async function reports(page, vp, scheme) {
  const tag = `A2 ${vp.name} ${scheme}`
  await gotoReady(page, '/reports', scheme === 'dark')
  const button = page.getByRole('button', { name: /^Show (all \d+|fewer)$/ }) // the label flips when expanded
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  const section = page.locator('section').filter({ has: button })
  const measure = () => button.evaluate((el) => {
    const sec = el.closest('section')
    const read = window.__textLeft
    const wrap = el.parentElement
    const cs = getComputedStyle(wrap)
    const th = sec.querySelector('thead th'), td = sec.querySelector('tbody td')
    return { label: read(el), thText: th ? read(th) : null, tdText: td ? read(td) : null, secLeft: sec.getBoundingClientRect().left, btnLeft: el.getBoundingClientRect().left, pl: cs.paddingLeft, pr: cs.paddingRight, headerPl: getComputedStyle(sec.firstElementChild).paddingLeft }
  })
  const m = await measure()
  if (vp.width >= 768) {
    check(`${tag}: label text left minus first th text left is 4+-1`, within(m.label - m.thText, 4, 1), { label: m.label, th: m.thText, delta: +(m.label - m.thText).toFixed(2) })
    check(`${tag}: label text left minus first td text left is 4+-1`, within(m.label - m.tdText, 4, 1), { label: m.label, td: m.tdText, delta: +(m.label - m.tdText).toFixed(2) })
  } else {
    check(`${tag}: wrapper padding-left equals main (the card pad, = its padding-right and the header's)`, m.pl === m.pr && m.pl === m.headerPl, { pl: m.pl, pr: m.pr, header: m.headerPl })
  }
  if (scheme === 'light') await shoot(page, `reports-showall-${vp.name}-light`, section)
  if (vp.width >= 768 && scheme === 'light') {
    const found = await tabTo(page, button)
    const f = await button.evaluate((el) => { const cs = getComputedStyle(el); return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth), offset: parseFloat(cs.outlineOffset), left: el.getBoundingClientRect().left, secLeft: el.closest('section').getBoundingClientRect().left, focusVisible: el.matches(':focus-visible') } })
    const edge = f.left - f.offset - f.width
    check(`${tag}: keyboard focus outline left edge >= the section's left edge`, found && f.focusVisible && f.style !== 'none' && edge >= f.secLeft, { ...f, edge })
    if (vp.name === '1280') await shoot(page, 'reports-showall-focus-1280-light', section)
    await button.click()
    await page.getByRole('button', { name: 'Show fewer' }).waitFor()
    const e = await measure()
    check(`${tag}: expanded label keeps its position (th delta 4+-1)`, within(e.label - e.thText, 4, 1), { delta: +(e.label - e.thText).toFixed(2) })
    if (vp.name === '1280') await shoot(page, 'reports-showall-expanded-1280-light', section)
  }
  if (scheme === 'light' && vp.name !== '768') {
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `reports-full-${vp.name}.png`), { touch: vp.touch })).checks)
  }
}

// A3 + A4 on the run modal: the sticky footer and the gap above the card-mode footer.
const cardGap = (root) => root.evaluate((el) => {
  const tfoot = el.querySelector('tfoot'), rows = el.querySelectorAll('tbody tr')
  if (!tfoot || !rows.length) return null
  return tfoot.getBoundingClientRect().top - rows[rows.length - 1].getBoundingClientRect().bottom
})
async function runModal(page, vp, scheme) {
  const tag = `${vp.name} ${scheme}`
  await page.route('**/api/v1/claim-hub/lines', (r) => r.fulfill({ json: envelope({ ready: [], rejected: [], managed: [] }) }))
  await gotoReady(page, '/claims', scheme === 'dark')
  await page.getByRole('button', { name: 'Claim shifts' }).click()
  const dialog = page.getByRole('dialog')
  const make = dialog.getByRole('button', { name: /^Make \d+ claims?$/ })
  await make.waitFor({ timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  await quiet(page)
  const sticky = await dialog.evaluate((panel) => {
    panel.scrollTop = 0
    const btn = [...panel.querySelectorAll('button')].find((b) => /^Make \d+ claims?$/.test(b.textContent.trim()))
    let el = btn.parentElement, found = null
    while (el && el !== panel.parentElement) { if (getComputedStyle(el).position === 'sticky') { found = el; break }; el = el.parentElement }
    const nav = document.querySelector('nav.fixed.bottom-0')
    const navTop = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : null
    return { scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight, makeBottom: btn.getBoundingClientRect().bottom, panelBottom: panel.getBoundingClientRect().bottom, sticky: !!found, navTop }
  })
  check(`A3 ${tag}: the panel scrolls (not vacuous)`, sticky.scrollHeight > sticky.clientHeight, { scrollHeight: sticky.scrollHeight, clientHeight: sticky.clientHeight })
  check(`A3 ${tag}: Make bottom <= panel bottom at scrollTop 0`, sticky.makeBottom <= sticky.panelBottom + 0.5, { makeBottom: sticky.makeBottom, panelBottom: sticky.panelBottom })
  check(`A3 ${tag}: Make has a position:sticky ancestor`, sticky.sticky)
  if (vp.touch) check(`A3 ${tag}: Make sits above the bottom tab bar`, sticky.navTop === null || sticky.makeBottom <= sticky.navTop + 0.5, { makeBottom: sticky.makeBottom, navTop: sticky.navTop })
  const gap = await cardGap(dialog)
  if (vp.touch) check(`A4 ${tag}: tfoot top - last card bottom is 12+-1`, gap !== null && within(gap, 12, 1), { gap })
  else check(`A4 ${tag}: tfoot top - last row bottom is 0+-1 (unchanged)`, gap !== null && within(gap, 0, 1), { gap })
  if (vp.touch) await hideTabBar(page)
  const wide = vp.touch ? '390' : '1280x842'
  await shoot(page, `runmodal-preview-${wide}-${scheme}`, dialog)
  if (vp.touch) {
    await dialog.locator('tfoot').scrollIntoViewIfNeeded()
    await shoot(page, `cardfoot-runmodal-390-${scheme}`, [dialog.locator('tbody tr').last(), dialog.locator('tfoot')], 24)
  }
  if (scheme === 'light') {
    // Tab reaches the footer buttons in order: Close, then Make.
    const close = dialog.getByRole('button', { name: 'Close' }).last()
    check(`A3 ${tag}: Tab reaches Close then Make`, (await tabTo(page, close)) && (await (async () => { await page.keyboard.press('Tab'); return make.evaluate((el) => el === document.activeElement) })()))
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `runmodal-full-${vp.name}.png`), { touch: vp.touch })).checks)
    if (!vp.touch) {
      await page.route('**/api/v1/claims/from-shifts', (r) => r.fulfill({ status: 500, json: { success: false, data: null, message: null, errors: [] } }), { times: 1 })
      await make.click()
      await dialog.getByRole('button', { name: 'Try again' }).waitFor()
      await shoot(page, 'runmodal-failure-1280-light', dialog)
    } else {
      let release
      const held = new Promise((res) => { release = res })
      await page.route('**/api/v1/claims/from-shifts', async (route) => { await held; await route.continue() }, { times: 1 })
      await make.click()
      await dialog.getByRole('button', { name: 'Claiming…' }).waitFor()
      await shoot(page, 'runmodal-pending-390-light', dialog)
      release()
      await dialog.getByRole('button', { name: 'Done' }).waitFor()
      await shoot(page, 'runmodal-done-390-light', dialog)
      const doneGap = await cardGap(dialog)
      check(`A4 ${tag} done: tfoot top - last card bottom is 12+-1 (null when the result has no table)`, doneGap === null || within(doneGap, 12, 1), { gap: doneGap })
    }
  }
}

// A4 reach: ClaimDetailPage:422 is a DataTable footer, so it gets the same check.
async function claimDetail(page, vp) {
  await gotoReady(page, '/claims/claim-0002', false)
  const table = page.locator('table.mobile-card-table:has(tfoot)').first()
  await table.waitFor({ state: 'attached', timeout: 60_000 })
  const gap = await cardGap(table)
  if (vp.touch) {
    check(`A4 claimdetail ${vp.name}: tfoot top - last card bottom is 12+-1`, gap !== null && within(gap, 12, 1), { gap })
    await hideTabBar(page)
    await shoot(page, 'cardfoot-claimdetail-390-light', [table.locator('tbody tr').last(), table.locator('tfoot')], 24)
  } else {
    check(`A4 claimdetail ${vp.name}: tfoot top - last row bottom is 0+-1 (unchanged)`, gap !== null && within(gap, 0, 1), { gap })
  }
}

// C1: the active settings item under hover and keyboard focus, and the incidents summary under hover.
async function settingsRail(page, scheme) {
  const tag = `C1 1280 ${scheme}`
  await gotoReady(page, '/settings?section=organisation', scheme === 'dark')
  const nav = page.getByRole('navigation', { name: 'Settings' })
  const active = nav.locator('a[aria-current="page"]')
  await active.waitFor({ state: 'visible', timeout: 60_000 })
  await active.hover()
  await quiet(page)
  const h = await active.evaluate((el) => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius } })
  check(`${tag}: hovered active item has no fill and a square left corner`, h.bg === 'rgba(0, 0, 0, 0)' && h.radius === '0px', h)
  await shoot(page, `settingsrail-active-hover-1280-${scheme}`, nav, 12)
  await page.mouse.move(700, 600)
  const found = await tabTo(page, active)
  const f = await active.evaluate((el) => {
    const cs = getComputedStyle(el)
    const layers = []
    let depth = 0, cur = ''
    for (const ch of cs.boxShadow) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { layers.push(cur.trim()); cur = '' } else cur += ch }
    layers.push(cur.trim())
    return { boxShadow: cs.boxShadow, layers: layers.filter((l) => l && l !== 'none' && !/rgba\(0, 0, 0, 0\)/.test(l)), focusVisible: el.matches(':focus-visible') }
  })
  const bar = f.layers.find((l) => /inset/.test(l)), ring = f.layers.find((l) => !/inset/.test(l) && /\s2px(\s|$)/.test(l.replace(/rgb[a]?\([^)]*\)/g, '')))
  check(`${tag}: keyboard-focused active item keeps the inset bar AND the 2px ring (OPEN-1 if not)`, found && f.focusVisible && !!bar && !!ring, f)
  await shoot(page, `settingsrail-active-focus-1280-${scheme}`, nav, 12)
}
async function incidentsHover(page) {
  await gotoReady(page, '/incidents', false)
  const summary = page.getByRole('alert').filter({ hasText: 'About the deadlines' }).locator('summary')
  await summary.waitFor({ state: 'visible', timeout: 60_000 })
  await page.mouse.move(700, 700)
  await quiet(page)
  const rest = await summary.evaluate((el) => getComputedStyle(el).textDecorationLine)
  await summary.hover()
  await page.waitForTimeout(300)
  const hover = await summary.evaluate((el) => getComputedStyle(el).textDecorationLine)
  check('C1 incidents summary: underline only on hover', rest === 'none' && hover.includes('underline'), { rest, hover })
  await shoot(page, 'incidents-deadlines-hover-1280-light', page.getByRole('alert').filter({ hasText: 'About the deadlines' }), 12)
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 842, touch: false, schemes: ['light', 'dark'] },
  { name: '768', width: 768, height: 900, touch: false, schemes: ['light'] },
  { name: '390', width: 390, height: 844, touch: true, schemes: ['light', 'dark'] },
]
try {
  for (const vp of VIEWPORTS) for (const scheme of vp.schemes) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: scheme, reducedMotion: 'reduce' })
    const page = await openPage(context)
    if (scheme === 'light') await safe(`A2 ${vp.name}`, () => reports(page, vp, scheme))
    if (vp.width !== 768) await safe(`A3/A4 ${vp.name} ${scheme}`, () => runModal(page, vp, scheme))
    if (vp.width !== 768 && scheme === 'light') await safe(`A4 claimdetail ${vp.name}`, () => claimDetail(page, vp))
    if (vp.name === '1280') {
      await safe(`C1 settings ${scheme}`, () => settingsRail(page, scheme))
      if (scheme === 'light') await safe('C1 incidents', () => incidentsHover(page))
    }
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
