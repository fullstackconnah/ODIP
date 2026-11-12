// ABN in the organisation details setup step: To do with one hint line until a valid ABN is saved. Captures plus numeric checks (checks.json). Exit 1 on any failure.
// States: setup-abn-missing, setup-abn-missing-dark, setup-abn-done, dashboard-abn-missing.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/abn-setup-step.mjs <outdir>
// Sign-in and the few routes each state changes are stubbed with page.route (synthetic data); everything else is the mock API's.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const provider = {
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Melbourne VIC 3000',
  state: 'VIC', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null, timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}
const W = 390

const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }
/** One failing state is reported and the run carries on. */
const state = async (name, fn) => { try { await fn() } catch (e) { check(`${name}: state reached`, false, String(e.message).slice(0, 200)) } }

async function openPage(browser, { role = 'Admin', username = 'dev.admin', width = W, touch = true, dark = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height: touch ? 844 : 900 }, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id, theme]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme })) } catch { /* storage blocked */ } }, ['00000000-0000-0000-0000-0000000000a1', dark ? 'dark' : 'light'])
  const page = await context.newPage()
  page.on('pageerror', (e) => check('page error', false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}
const go = (page, url) => page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
const noHScroll = async (page, ctx) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`${ctx}: no horizontal scroll at ${W}`, o <= 0, o) }
const crop = async (page, locator, name) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, `${name}.png`), { touch: true, natural: true, pad: 12 })
  checks.push(checkCropHolds({ ...r, touch: true }))
}
/** WCAG contrast of an element's text on its own (or nearest opaque) background; colours are normalised through a canvas so oklch and color-mix read as rgb. */
const contrast = (locator) => locator.evaluate((el) => {
  const px = (css) => { const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); c.canvas.width = c.canvas.height = 1; c.fillStyle = '#000'; c.clearRect(0, 0, 1, 1); c.fillStyle = css; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data] }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  let bg = [255, 255, 255], layers = []
  for (let n = el; n; n = n.parentElement) { const c = px(getComputedStyle(n).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] === 255) break }
  for (const c of layers.reverse()) bg = bg.map((v, i) => i < 3 ? Math.round(c[i] * c[3] / 255 + v * (1 - c[3] / 255)) : v)
  const fg = px(getComputedStyle(el).color)
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return { ratio: (a + 0.05) / (b + 0.05), fg, bg }
})
const MIN_CONTRAST = 4.5   // WCAG AA for small text, the house minimum
const plainColor = (locator) => locator.evaluate((el) => { const p = document.createElement('span'); p.style.color = 'var(--color-muted-foreground)'; document.body.append(p); const want = getComputedStyle(p).color; p.remove(); return { got: getComputedStyle(el).color, want } })
const browser = await chromium.launch({ headless: true })
const HINT = /Add your ABN to finish this step\./
const SETUP = { staffCount: 0, participantCount: 0, participantsWithPlanCount: 0, firstPublishedWeekStart: null, hasInvoice: false, employmentHeroAvailable: false }
/** The hint is a plain muted paragraph: token colour, AA contrast, whole text inside the viewport and its box. */
async function hintChecks(page, name, dark) {
  const hint = page.getByText(HINT).first()
  await hint.waitFor({ state: 'visible', timeout: 90_000 })
  await page.waitForTimeout(500)
  check(`${name}: page is in the ${dark ? 'dark' : 'light'} scheme`, (await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)) === dark)
  const c = await contrast(hint)
  check(`${name}: hint contrast >= ${MIN_CONTRAST}`, c.ratio >= MIN_CONTRAST, `${c.ratio.toFixed(2)} fg ${c.fg} bg ${c.bg}`)
  const col = await plainColor(hint)
  check(`${name}: hint uses --color-muted-foreground`, col.got === col.want, `${col.got} vs ${col.want}`)
  const clip = await hint.evaluate((el) => { const r = el.getBoundingClientRect(); return { right: r.right, vw: document.documentElement.clientWidth, sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight, overflowX: getComputedStyle(el).overflowX } })
  check(`${name}: hint text not clipped`, clip.right <= clip.vw && clip.sw <= clip.cw + 1 && clip.sh <= clip.ch + 1 && clip.overflowX === 'visible', JSON.stringify(clip))
  await noHScroll(page, name)
  return hint
}
try {
  for (const dark of [false, true]) {
    const name = dark ? 'setup-abn-missing-dark' : 'setup-abn-missing'
    await state(name, async () => {
      const { context, page } = await openPage(browser, { dark })
      await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope({ ...provider, abn: '' }) }))
      await go(page, '/settings?section=setup')
      const hint = await hintChecks(page, name, dark)
      const row = hint.locator('xpath=ancestor::li[1]')
      check(`${name}: row status reads To do`, (await row.getByText('To do', { exact: true }).count()) === 1)
      await crop(page, row, name)
      await context.close()
    })
  }
  await state('setup-abn-done', async () => {
    const { context, page } = await openPage(browser)
    await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope({ ...provider, abn: '51 824 753 556', registrationNumber: '' }) }))
    await go(page, '/settings?section=setup')
    const done = page.getByText('Details recorded', { exact: true })
    await done.waitFor({ state: 'visible', timeout: 90_000 })
    await page.waitForTimeout(500)
    check('setup-abn-done: a spaced valid ABN with a blank registration number is done', true)
    check('setup-abn-done: no ABN line', (await page.getByText(/your ABN/).count()) === 0)
    await noHScroll(page, 'setup-abn-done')
    await crop(page, done.locator('xpath=ancestor::li[1]'), 'setup-abn-done')
    await context.close()
  })
  await state('dashboard-abn-missing', async () => {
    const { context, page } = await openPage(browser)
    await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope({ ...provider, abn: '' }) }))
    await page.route('**/api/v1/dashboard/setup', (r) => r.fulfill({ json: envelope(SETUP) }))
    await go(page, '/')
    const hint = await hintChecks(page, 'dashboard-abn-missing', false)
    await crop(page, hint.locator('xpath=ancestor::li[1]'), 'dashboard-abn-missing')
    mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })
    const full = await fullPage(page, path.join(OUT_DIR, 'full', 'dashboard-abn-missing-390.png'), { touch: true })
    checks.push(...full.checks)
    await context.close()
  })
} finally {
  await browser.close()
}
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
