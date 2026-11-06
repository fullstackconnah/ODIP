// Participant overview PR1: the Quick add band, the chart role gate and the Overview empty/error states. Light theme pinned (colorScheme), Australian dates, reduced motion.
// bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to this script> <outdir>
// Mock API: p-0002 has a current plan (chart), p-0001 has none. Numeric checks follow SHAPE.md "Numeric checks" 1-6, 9, 11 (7, 8 and 10 are PR2 chart marks).
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsersFor = (role) => envelope([{ username: 'dev.' + role.toLowerCase(), role, tenantName: 'Sample Support Co' }])
const devLoginFor = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.' + role.toLowerCase(), fullName: 'Dev ' + role, role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const TITLE = 'How the budget is tracking'
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail })

// Opens a signed-in page for a role. `requests` collects every budget-series request; `failing` makes the mock answer 500.
async function open(browser, { role, width, height = 900, mobile = false, scheme = 'light', failing = false }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: mobile, isMobile: mobile, colorScheme: scheme, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const requests = []
  page.on('pageerror', (e) => check(`page error (${role} ${width})`, false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsersFor(role) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLoginFor(role) }))
  await page.route('**/funding/ledger/series*', async (r) => {
    requests.push(r.request().url())
    if (!failing) return r.continue()
    const url = new URL(r.request().url()); url.searchParams.set('fixture', 'failing')
    return r.fulfill({ response: await r.fetch({ url: url.toString() }) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page, requests }
}
const go = async (page, id) => {
  await page.goto(`${BASE_URL}/participants/${id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('tablist').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(500)
}
const bandOf = (page) => page.locator('section[aria-labelledby="quick-add-heading"]')
const cardOf = (page) => page.getByRole('heading', { name: TITLE }).locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')

// Runs in the page: every PR1 band measurement in one pass. Tokens are resolved from the house custom properties, never typed in.
function measureBand() {
  const probe = (v) => { const d = document.createElement('div'); d.style.cssText = `position:absolute;visibility:hidden;height:var(${v})`; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h }
  const tokens = { tapMin: probe('--tap-min'), controlH: probe('--control-h'), sectionGap: probe('--section-gap') }
  const band = document.querySelector('section[aria-labelledby="quick-add-heading"]')
  if (!band) return { tokens, tiles: [] }
  const tiles = [...band.querySelectorAll('ul > li > a')].map((a) => {
    const r = a.getBoundingClientRect(), icon = a.children[0].getBoundingClientRect(), label = a.children[1], plus = a.querySelector('svg.lucide-plus')
    const lh = parseFloat(getComputedStyle(label).lineHeight)
    return { name: a.getAttribute('aria-label'), left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, padL: parseFloat(getComputedStyle(a).paddingLeft), padT: parseFloat(getComputedStyle(a).paddingTop),
      iconW: icon.width, iconH: icon.height, plusW: plus ? plus.getBoundingClientRect().width : null, truncated: label.scrollWidth > label.clientWidth + 1, lines: Math.round(label.getBoundingClientRect().height / lh) }
  })
  const b = band.getBoundingClientRect()
  const h = [...document.querySelectorAll('h3,h2')].find((e) => e.textContent.trim() === 'How the budget is tracking')
  const card = h ? h.closest('div.rounded-md') : null, cr = card ? card.getBoundingClientRect() : null
  return { tokens, tiles, band: { top: b.top, bottom: b.bottom, width: b.width, left: b.left }, card: cr ? { top: cr.top, bottom: cr.bottom, width: cr.width, left: cr.left } : null, scrollWidth: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }
}
const near = (a, b, t = 1) => Math.abs(a - b) <= t
const rowsOf = (tiles) => { const by = new Map(); for (const t of tiles) { const k = Math.round(t.top); by.set(k, [...(by.get(k) ?? []), t]) } return [...by.values()] }

function runChecks(tag, m, { width, count, withCard }) {
  const { tokens: tk, tiles } = m
  check(`${tag} tile count = ${count}`, tiles.length === count, tiles.map((t) => t.name))
  // 1. Every tile at least --tap-min tall; tiles in one row share one height.
  check(`1 ${tag} tiles >= --tap-min (${tk.tapMin})`, tiles.every((t) => t.height >= tk.tapMin - 0.5), tiles.map((t) => Math.round(t.height)))
  check(`1 ${tag} tiles in a row share one height`, rowsOf(tiles).every((r) => r.every((t) => near(t.height, r[0].height))), rowsOf(tiles).map((r) => r.map((t) => Math.round(t.height))))
  // 2. Icon square = --control-h; Plus badge 14; padding 12; 8 between tiles.
  check(`2 ${tag} icon square = --control-h (${tk.controlH})`, tiles.every((t) => near(t.iconW, tk.controlH) && near(t.iconH, tk.controlH)), tiles.map((t) => [t.iconW, t.iconH]))
  const plus = tiles.filter((t) => t.plusW != null)
  check(`2 ${tag} Plus badge = 14px`, plus.every((t) => near(t.plusW, 14)), plus.map((t) => t.plusW))
  check(`2 ${tag} tile padding = 12px`, tiles.every((t) => near(t.padL, 12) && near(t.padT, 12)), tiles.map((t) => [t.padL, t.padT]))
  const gaps = rowsOf(tiles).flatMap((r) => r.slice(1).map((t, i) => t.left - r[i].right))
  check(`2 ${tag} 8px between tiles in a row`, gaps.every((g) => near(g, 8)), gaps.map((g) => Math.round(g * 10) / 10))
  // 3. Layout: 1280 one row, equal widths; 390 two columns, an odd last tile spans both.
  const rows = rowsOf(tiles)
  if (width >= 1024) check(`3 ${tag} one row, equal widths and tops`, rows.length === 1 && tiles.every((t) => near(t.width, tiles[0].width)), { rows: rows.length, widths: tiles.map((t) => Math.round(t.width)) })
  else {
    const first = rows.slice(0, -1).every((r) => r.length === 2), last = rows.at(-1)
    const lastOk = count % 2 === 0 ? last.length === 2 : last.length === 1 && near(last[0].width, tiles[0].width * 2 + 8, 2)
    check(`3 ${tag} two columns${count % 2 ? ', the odd last tile spans both' : ''}`, first && lastOk, rows.map((r) => r.length))
  }
  // 4. No label truncates, two lines at most.
  check(`4 ${tag} no label truncates, <= 2 lines`, tiles.every((t) => !t.truncated && t.lines <= 2), tiles.map((t) => [t.name, t.lines, t.truncated]))
  // 5. No horizontal overflow.
  check(`5 ${tag} no horizontal overflow`, m.scrollWidth <= m.innerWidth, [m.scrollWidth, m.innerWidth])
  // 6 and 9. Blocks --section-gap apart; the chart card is as wide as the band.
  if (withCard && m.card) {
    check(`6 ${tag} band to chart gap = --section-gap (${tk.sectionGap})`, near(m.card.top - m.band.bottom, tk.sectionGap, 1), m.card.top - m.band.bottom)
    if (width >= 1024) check(`9 ${tag} chart card as wide as the band`, near(m.card.width, m.band.width, 1), [m.card.width, m.band.width])
  }
}

const browser = await chromium.launch({ headless: true })
try {
  const shot = async (page, loc, name, opts = {}) => { const r = await cropElement(page, loc, path.join(OUT_DIR, name), opts); checks.push(checkCropHolds(r)); return r }

  // 1280 Coordinator, light: on-track (p-0002) and no plan (p-0001).
  {
    const { context, page } = await open(browser, { role: 'Coordinator', width: 1280 })
    await go(page, 'p-0002')
    await cardOf(page).waitFor({ state: 'visible', timeout: 30_000 })
    runChecks('1280 coordinator on-track', await page.evaluate(measureBand), { width: 1280, count: 7, withCard: true })
    await shot(page, bandOf(page), 'overview-1280-coordinator-on-track.png', { also: cardOf(page) })
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'overview-1280-fullpage.png'), { touch: false })).checks)
    await go(page, 'p-0001')
    await page.getByText('No plan budget to chart').waitFor({ state: 'visible', timeout: 30_000 })
    const m = await page.evaluate(measureBand)
    runChecks('1280 coordinator no-plan', m, { width: 1280, count: 7, withCard: true })
    check('2 1280 no-plan: the budget tile offers "Record the plan budget" with the Plus badge', m.tiles.some((t) => t.name === 'Record the plan budget' && t.plusW != null), m.tiles.map((t) => t.name))
    await shot(page, bandOf(page), 'overview-1280-coordinator-no-plan.png', { also: cardOf(page) })
    await context.close()
  }
  // 1280 Coordinator, dark.
  {
    const { context, page } = await open(browser, { role: 'Coordinator', width: 1280, scheme: 'dark' })
    await go(page, 'p-0002')
    await cardOf(page).waitFor({ state: 'visible', timeout: 30_000 })
    await shot(page, bandOf(page), 'overview-1280-coordinator-dark.png', { also: cardOf(page) })
    await context.close()
  }
  // 1280 chart error (the mock answers 500), and 1280 ReadOnly (no band, no chart).
  {
    const { context, page } = await open(browser, { role: 'Coordinator', width: 1280, failing: true })
    await go(page, 'p-0002')
    await page.getByText("The budget chart couldn't load.").waitFor({ state: 'visible', timeout: 30_000 })
    const m = await page.evaluate(measureBand)
    check('chart error: no "figures below" line on the Overview', (await page.getByText('The figures below are not affected').count()) === 0, null)
    check('6 chart error: band to card gap = --section-gap', m.card && near(m.card.top - m.band.bottom, m.tokens.sectionGap, 1), m.card && m.card.top - m.band.bottom)
    await shot(page, bandOf(page), 'overview-1280-chart-error.png', { also: cardOf(page) })
    await context.close()
  }
  {
    const { context, page, requests } = await open(browser, { role: 'ReadOnly', width: 1280 })
    await go(page, 'p-0002')
    check('readonly: no Quick add band', (await bandOf(page).count()) === 0, null)
    check('11 readonly: zero requests to /funding/ledger/series and no chart card', requests.length === 0 && (await cardOf(page).count()) === 0, requests.length)
    await shot(page, page.getByRole('tabpanel').first(), 'overview-1280-readonly.png')
    await context.close()
  }
  // 390 touch: Coordinator (7 tiles, the 7th spans both) and Support Worker (2 tiles side by side, no chart request).
  {
    const { context, page } = await open(browser, { role: 'Coordinator', width: 390, height: 844, mobile: true })
    await go(page, 'p-0002')
    await cardOf(page).waitFor({ state: 'visible', timeout: 30_000 })
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    check('390 coordinator: pointer is coarse', coarse, coarse)
    const m = await page.evaluate(measureBand)
    runChecks('390 coordinator', m, { width: 390, count: 7, withCard: true })
    check('1 390 coordinator: a 44px control (every tile at least 44 tall)', m.tiles.every((t) => t.height >= 44), m.tiles.map((t) => Math.round(t.height)))
    await shot(page, bandOf(page), 'overview-390-coordinator.png', { also: cardOf(page), touch: true })
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'overview-390-fullpage.png'), { touch: true })).checks)
    await context.close()
  }
  {
    const { context, page, requests } = await open(browser, { role: 'SupportWorker', width: 390, height: 844, mobile: true })
    await go(page, 'p-0002')
    const m = await page.evaluate(measureBand)
    runChecks('390 support-worker', m, { width: 390, count: 2, withCard: false })
    check('3 390 support-worker: the 2 tiles sit side by side', m.tiles.length === 2 && near(m.tiles[0].top, m.tiles[1].top, 1), m.tiles.map((t) => [t.name, Math.round(t.top)]))
    check('11 support-worker: zero requests to /funding/ledger/series and no chart card', requests.length === 0 && (await cardOf(page).count()) === 0, requests.length)
    await shot(page, bandOf(page), 'overview-390-support-worker.png', { touch: true })
    await context.close()
  }
  // 390 touch: Add a note from Quick add opens the dialog on Notes; ?add=1 is gone from the URL.
  {
    const { context, page } = await open(browser, { role: 'Coordinator', width: 390, height: 844, mobile: true })
    await go(page, 'p-0002')
    await page.getByRole('link', { name: 'Add a note' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 30_000 })
    check('add=1 stripped from the URL after the dialog opened', !page.url().includes('add=1'), page.url())
    await shot(page, dialog, 'overview-390-note-dialog-from-quick-add.png', { touch: true })
    await context.close()
  }
} finally { await browser.close() }

if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
