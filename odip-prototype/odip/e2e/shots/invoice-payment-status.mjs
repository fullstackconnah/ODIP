// Invoice payment status (m1112-invpay): the register's Payment column and All Payments filter, and the claim detail invoices card's Payment column.
// Captures plus the shape's 11 numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/invoice-payment-status.mjs <outdir>
// Sign-in is stubbed with page.route (Admin); the mock API holds the data (mock-api/invoices.js: register rows reg-0.., claim-inv-pay). Light theme, reduced motion, clock pinned.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, layoutCheck, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const NOW = new Date('2026-11-04T23:00:00Z')

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openPage(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers('Admin', 'admin') }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login('Admin', 'admin') }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(NOW)
  await page.request.post(`${BASE_URL}/mock/invoices/state`, { data: { reset: true } }).catch(() => {})
  return { context, page }
}

const go = async (page, url, ready) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await ready.first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForLoadState('networkidle').catch(() => {})
}

// A desktop shot is the whole page; a phone shot is the page's <main>, cropped (fullPage resizes and would drop the touch emulation).
async function shot(page, vp, name) {
  if (!vp.touch) {
    const r = await fullPage(page, path.join(OUT_DIR, 'full', `${name}.png`), { touch: false })
    checks.push(...r.checks)
    return
  }
  const main = page.locator('main').first()
  const r = await cropElement(page, main, path.join(OUT_DIR, `${name}.png`), { touch: true, natural: true, pad: 0 })
  checks.push(checkCropHolds({ ...r, touch: true }))
  checks.push(await layoutCheck(page, main, name))
}

const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`1 ${ctx}: no horizontal scroll`, o <= 0, o)
}

// 2: every payment pill sits on one line and inside its cell's content box.
const pillsFit = async (page, ctx) => {
  const bad = await page.evaluate(() => [...document.querySelectorAll('td[data-label="Payment"]')].flatMap((td) => {
    if (getComputedStyle(td).display === 'none') return []
    return [...td.querySelectorAll('[data-status-badge]')].flatMap((pill) => {
      const c = td.getBoundingClientRect(), cs = getComputedStyle(td), p = pill.getBoundingClientRect()
      const lines = pill.getClientRects().length, right = c.right - parseFloat(cs.paddingRight)
      return lines === 1 && p.right <= right + 0.5 ? [] : [`${pill.textContent} lines=${lines} right=${p.right} limit=${right}`]
    })
  }))
  check(`2 ${ctx}: payment pills on one line and inside their cell`, bad.length === 0, bad)
}

const rem = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))
const rowHeight = (page, text) => page.locator('tr', { hasText: text }).first().evaluate((el) => el.getBoundingClientRect().height)

// 6 and 7: the filter pills.
async function filterChecks(page, vp) {
  const type = await page.getByRole('button', { name: /all types/i }).boundingBox()
  const status = await page.getByRole('button', { name: /all statuses/i }).boundingBox()
  const pay = await page.getByRole('button', { name: /all payments/i }).boundingBox()
  check(`6 ${vp.name}: Payment trigger height equals Status trigger height (${vp.touch ? 'coarse' : 'fine'})`, Math.abs(pay.height - status.height) <= 0.5, { pay: pay.height, status: status.height })
  if (vp.touch) {
    const sameLine = Math.abs(pay.y - type.y) <= 1
    check('7 390: Payment pill is on the Type line or starts at the Type pill left edge', sameLine || Math.abs(pay.x - type.x) <= 1, { type, status, pay })
  }
}

const VPS = [{ name: '390', width: 390, height: 844, touch: true }, { name: '1024', width: 1024, height: 800, touch: false }, { name: '1440', width: 1440, height: 900, touch: false }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const { context, page } = await openPage(browser, vp)
  const phone = vp.name === '390'

  // register-mixed: one row of each payment status, a voided invoice, a credit note (the first page of the mock register)
  await go(page, '/invoices', page.getByText('INV-9994'))
  await shot(page, vp, `register-mixed-${vp.name}`)
  await pillsFit(page, `register ${vp.name}`)
  if (phone) await noHScroll(page, 'register-mixed 390')
  else {
    const out = await rowHeight(page, 'INV-9994'), voided = await rowHeight(page, 'INV-9997')
    check(`3 register ${vp.name}: Outstanding and Voided rows are the same height`, Math.abs(out - voided) <= 1, { out, voided })
    const th = await page.locator('th', { hasText: /^Payment$/ }).first().evaluate((el) => el.getBoundingClientRect().width)
    const pill = await page.locator('tr', { hasText: 'INV-9994' }).locator('td[data-label="Payment"] [data-status-badge]').first().evaluate((el) => ({ w: el.getBoundingClientRect().width, text: el.textContent }))
    const px = parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cell-px'))) || 12
    const r = await rem(page)
    check(`4 register ${vp.name}: the widest pill plus both cell paddings fits 7rem, and the Payment column is at least 7rem`, pill.text.trim() === 'Outstanding' && pill.w + 2 * px <= 7 * r + 0.5 && th >= 7 * r - 0.5, { th, pill, px, rem: r })
  }
  if (phone) {
    // 9: the card of a row with no payment status has no Payment line; one with a status shows it with its pill
    const none = await page.locator('tr', { hasText: 'INV-9997' }).locator('td[data-label="Payment"]').evaluateAll((els) => els.map((e) => getComputedStyle(e).display))
    const has = await page.locator('tr', { hasText: 'INV-9994' }).locator('td[data-label="Payment"]').evaluateAll((els) => els.map((e) => ({ display: getComputedStyle(e).display, pill: !!e.querySelector('[data-status-badge]'), label: getComputedStyle(e, '::before').content })))
    check('9 390: a voided row has no visible Payment cell; an Outstanding row shows the label and the pill', none.every((d) => d === 'none') && has.some((h) => h.display !== 'none' && h.pill), { none, has })
  }
  await filterChecks(page, vp)

  // register-filter-outstanding
  if (vp.name !== '1024') {
    await go(page, '/invoices?paymentStatus=Outstanding', page.getByText('INV-9994'))
    await shot(page, vp, `register-filter-outstanding-${vp.name}`)
    await pillsFit(page, `register-filter-outstanding ${vp.name}`)
    if (phone) await noHScroll(page, 'register-filter-outstanding 390')
  }

  // register-filter-empty (Payment Paid with Status Voided) and the voided-only table (check 10)
  if (phone) {
    await go(page, '/invoices?paymentStatus=Paid&status=Voided', page.getByText(/have no payment status/i))
    await shot(page, vp, `register-filter-empty-${vp.name}`)
    await noHScroll(page, 'register-filter-empty 390')
  }
  await go(page, '/invoices?status=Voided', page.getByText('INV-9997'))
  check(`10 register-status-voided ${vp.name}: no Payment header in the DOM`, (await page.locator('th', { hasText: /^Payment$/ }).count()) === 0)

  // claim-invoices-mixed
  const mixedName = vp.name === '1024' ? 'claim-invoices-mixed-1024-admin' : `claim-invoices-mixed-${vp.name}`
  await go(page, '/claims/claim-inv-pay', page.getByText('INV-0050'))
  await shot(page, vp, mixedName)
  await pillsFit(page, `claim-invoices ${vp.name}`)
  if (phone) await noHScroll(page, 'claim-invoices-mixed 390')
  else {
    const out = await rowHeight(page, 'INV-0052'), voided = await rowHeight(page, 'INV-0053')
    check(`3 claim ${vp.name}: a Paid and a Voided row are the same height`, Math.abs(out - voided) <= 1, { out, voided })
    const r = await rem(page)
    const px = parseFloat(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cell-px'))) || 12
    const statusTh = await page.locator('th', { hasText: /^Status$/ }).first().evaluate((el) => el.getBoundingClientRect().width)
    const credited = await page.locator('tr', { hasText: 'INV-0054' }).locator('td[data-label="Status"] [data-status-badge]').first().evaluate((el) => el.getBoundingClientRect().width)
    const payTh = await page.locator('th', { hasText: /^Payment$/ }).first().evaluate((el) => el.getBoundingClientRect().width)
    const outstanding = await page.locator('tr', { hasText: 'INV-0050' }).locator('td[data-label="Payment"] [data-status-badge]').first().evaluate((el) => el.getBoundingClientRect().width)
    check(`4 claim ${vp.name}: Outstanding pill plus both paddings fits 7rem and the Payment column is at least 7rem`, outstanding + 2 * px <= 7 * r + 0.5 && payTh >= 7 * r - 0.5, { outstanding, payTh, px, rem: r })
    check(`5 claim ${vp.name}: Status column at least 7rem and the Credited pill fits`, statusTh >= 7 * r - 0.5 && credited + 2 * px <= statusTh + 0.5, { statusTh, credited, px })
    if (vp.name === '1024') {
      await noHScroll(page, 'claim-invoices-mixed 1024 admin')
      const frame = await page.evaluate(() => { const t = document.querySelector('main table'); let f = t?.parentElement; while (f && f.scrollWidth <= f.clientWidth + 1 && f !== document.body) f = f.parentElement; return f ? { tag: f.tagName, scrollWidth: f.scrollWidth, clientWidth: f.clientWidth, isDoc: f === document.body } : null })
      check('11 claim 1024 Admin: any overflow scrolls inside the table frame, not the document', !frame || !frame.isDoc, frame)
    }
  }
  if (phone) {
    const pay = await page.locator('tr', { hasText: 'INV-0050' }).locator('td[data-label="Payment"]').evaluateAll((els) => els.map((e) => ({ display: getComputedStyle(e).display, pill: !!e.querySelector('[data-status-badge]') })))
    const cn = await page.locator('tr', { hasText: 'CN-0009' }).locator('td[data-label="Payment"]').evaluateAll((els) => els.map((e) => getComputedStyle(e).display))
    check('9 390 claim: an invoice shows its Payment cell; a credit note shows none', pay.some((p) => p.display !== 'none' && p.pill) && cn.every((d) => d === 'none'), { pay, cn })
  }

  // claim-invoices-preview (check 10): a Draft claim shows previews, so no Payment header
  await go(page, '/claims/claim-inv-f1', page.getByText('Not issued').first())
  check(`10 claim-invoices-preview ${vp.name}: no Payment header in the DOM`, (await page.locator('th', { hasText: /^Payment$/ }).count()) === 0)

  await context.close()
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
