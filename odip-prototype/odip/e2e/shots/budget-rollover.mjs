// Budget rollover (S2): the rolled-over box on the funding plan editor, and the Check step's "Includes ... rolled over" line. Captures plus numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/budget-rollover.mjs <outdir>
// The mock API serves p-0002's plan (a Core pool of four quarters) and its ledger; the plans answer is patched with page.route to hold one amount set by hand,
// and the agreement check answer is patched to carry a rolled-over amount. Time-driven inputs: the Funding hints read the ledger's saved figures only, so the date does not move a number.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

const BY_HAND = 2500

async function openPage(browser, vp, scheme, { byHand = true, carryIn = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: scheme, reducedMotion: 'reduce' })
  await context.addInitScript(installContrast)
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers('Admin', 'dev.admin') }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login('Admin', 'dev.admin') }))
  if (byHand) {
    await page.route(/\/participants\/p-0002\/funding\/plans(\?.*)?$/, async (r) => {
      const response = await r.fetch()
      const body = await response.json()
      const periods = body?.data?.plans?.[0]?.pools?.[0]?.periods
      if (periods?.[2]) periods[2].rolloverOverride = BY_HAND
      await r.fulfill({ response, json: body })
    })
  }
  if (carryIn) {
    await page.route('**/funding/agreement-check', async (r) => {
      const response = await r.fetch()
      const body = await response.json()
      const periods = body?.data?.pools?.[0]?.periods
      if (periods?.length) { const p = periods[periods.length - 1]; p.carriedIn = 1250; p.carriedSetByHand = true }
      await r.fulfill({ response, json: body })
    })
  }
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}

async function openEditor(page) {
  await page.goto(`${BASE_URL}/participants/p-0002?tab=funding`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const edit = page.locator('[data-edit-plan]').first()
  await edit.waitFor({ state: 'visible', timeout: 60_000 })
  await edit.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: 30_000 })
  await dialog.locator('input[aria-label^="Rolled over"]').first().waitFor({ state: 'visible', timeout: 30_000 })
  // The ledger answers after the dialog opens; the hint under the box leaves "Working out" when it has.
  await page.waitForFunction(() => !document.body.innerText.includes('Working out the rolled-over amount'), null, { timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(400)
  return dialog
}

const crop = async (page, locator, name, vp, pad = 12) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}

// Contrast of an element's text against the first opaque background above it.
const installContrast = () => { window.__contrast = (el) => {
  const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number)
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  let bg = [255, 255, 255]
  for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.95) { bg = c.slice(0, 3); break } }
  const fg = parse(getComputedStyle(el).color).slice(0, 3)
  const [a, b] = [lum(fg), lum(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
} }

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const tag = vp.touch ? `${vp.name}-touch` : vp.name

  // editor-rollover-worked-out, editor-rollover-set-by-hand, editor-rollover-first-period, editor-rollover-390 and the numeric checks
  try {
    const { context, page } = await openPage(browser, vp, 'light')
    const dialog = await openEditor(page)
    const pool = dialog.locator('section[data-pool-key]').first()
    const table = pool.locator('table').first()

    const geo = await page.evaluate(() => {
      const d = document.querySelector('[role=dialog]')
      const scrollers = [d, ...d.querySelectorAll('*')].filter((e) => { const o = getComputedStyle(e).overflowY; return o === 'auto' || o === 'scroll' })
      const tbl = d.querySelector('section[data-pool-key] table')
      const boxes = [...d.querySelectorAll('input[aria-label^="Rolled over"]')].map((i) => { const b = i.getBoundingClientRect(); return { w: Math.round(b.width), right: b.right, label: i.getAttribute('aria-label') } })
      const hintOf = (i) => i.parentElement.parentElement.querySelector(':scope > p')
      const hints = [...d.querySelectorAll('input[aria-label^="Rolled over"]')].map((i) => { const p = hintOf(i), s = getComputedStyle(p); return { h: Math.round(p.getBoundingClientRect().height), line: parseFloat(s.lineHeight) || parseFloat(s.fontSize) * 1.4 } })
      const spans = [...d.querySelectorAll('section[data-pool-key]:first-of-type input[aria-label^="Plan amount, "]')].map((i) => i.getAttribute('aria-label').slice('Plan amount, '.length))
      const perSpan = spans.map((s) => d.querySelectorAll(`section[data-pool-key]:first-of-type input[aria-label="Rolled over, ${s}"]`).length)
      return {
        bodyOverflow: scrollers.map((e) => e.scrollWidth - e.clientWidth),
        tableOverflow: tbl.scrollWidth - tbl.clientWidth, tableRight: tbl.getBoundingClientRect().right,
        boxes, hints, perSpan,
      }
    })
    check(t('dialog body and periods table scrollWidth <= clientWidth'), geo.bodyOverflow.every((o) => o <= 0) && geo.tableOverflow <= 0, geo)
    check(t('rollover input is 112px wide and inside the table'), geo.boxes.length > 0 && geo.boxes.every((b) => b.w === 112 && b.right <= geo.tableRight + 0.5), geo.boxes)
    check(t(vp.touch ? 'sub-row hint at most 56px high' : 'sub-row hint is one line'), geo.hints.length > 0 && geo.hints.every((h) => (vp.touch ? h.h <= 56 : h.h <= h.line * 1.5)), geo.hints)
    check(t('P1 has 0 Rolled over inputs, P2 onward exactly 1 each'), geo.perSpan.length >= 2 && geo.perSpan[0] === 0 && geo.perSpan.slice(1).every((n) => n === 1), geo.perSpan)

    const reset = dialog.getByRole('button', { name: 'Use worked-out amount' }).first()
    check(t('set by hand: the reset button is shown and the box holds the amount'), (await reset.isVisible()) && (await dialog.getByLabel(/^Rolled over, /).evaluateAll((els) => els.some((e) => e.value === '2500' || e.value === '2500.00'))), '')
    if (vp.touch) check(t('reset button at least 44px high'), (await reset.boundingBox()).height >= 43.5, (await reset.boundingBox()).height)

    // contrast of the hint and the first-period line, light then dark
    const ratio = await page.evaluate(() => {
      const fn = window.__contrast
      const d = document.querySelector('[role=dialog]')
      const hint = d.querySelector('input[aria-label^="Rolled over"]').parentElement.parentElement.querySelector(':scope > p')
      const first = [...d.querySelectorAll('p')].find((p) => p.textContent.includes('Nothing rolls over into the first period'))
      return [fn(hint), fn(first)]
    })
    check(t('light: hint and first-period line contrast >= 4.5'), ratio.every((r) => r >= 4.5), ratio)

    // worked-out state: a pool row whose box is empty
    await crop(page, pool, `editor-rollover-set-by-hand-${tag}.png`, vp)
    if (vp.touch) await crop(page, table, `editor-rollover-390-${tag}.png`, vp)
    await reset.click()
    await page.waitForTimeout(300)
    await crop(page, pool, `editor-rollover-worked-out-${tag}.png`, vp)
    const firstLine = pool.getByText('Nothing rolls over into the first period.').first()
    await crop(page, firstLine.locator('xpath=ancestor::tr[1]'), `editor-rollover-first-period-${tag}.png`, vp)

    // editor-rollover-error: a negative amount
    const box = dialog.locator('input[aria-label^="Rolled over"]').nth(1)
    await box.fill('-5')
    await box.blur()
    const message = dialog.locator('p', { hasText: /rolled-over amount|rolled over/i }).filter({ hasText: /at least|can't be|cannot|must/i }).first()
    if (!(await message.isVisible().catch(() => false))) await dialog.getByRole('button', { name: /^Save/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
    const errText = await dialog.locator('p.text-\\[var\\(--color-destructive\\)\\]').first().innerText().catch(() => '')
    check(t('error: a rolled-over message shows for -5'), /roll/i.test(errText), errText)
    await crop(page, pool, `editor-rollover-error-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('editor states ran'), false, String(e.message).split('\n')[0]) }

  // dark theme contrast of the same two lines (1280 only; the colours do not change with width)
  if (!vp.touch) {
    try {
      const { context, page } = await openPage(browser, vp, 'dark')
      await openEditor(page)
      const ratio = await page.evaluate(() => {
        const fn = window.__contrast
        const d = document.querySelector('[role=dialog]')
        const hint = d.querySelector('input[aria-label^="Rolled over"]').parentElement.parentElement.querySelector(':scope > p')
        const first = [...d.querySelectorAll('p')].find((p) => p.textContent.includes('Nothing rolls over into the first period'))
        return [fn(hint), fn(first)]
      })
      check(t('dark: hint and first-period line contrast >= 4.5'), ratio.every((r) => r >= 4.5), ratio)
      await context.close()
    } catch (e) { check(t('dark contrast ran'), false, String(e.message).split('\n')[0]) }
  }

  // check-step-rolled-over: the Check step of a draft; best effort, the step needs a complete agreement block
  try {
    const { context, page } = await openPage(browser, vp, 'light', { byHand: false, carryIn: true })
    await page.goto(`${BASE_URL}/participants/p-0004/agreement-draft`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const next = page.getByRole('button', { name: 'Next', exact: true })
    await next.waitFor({ state: 'visible', timeout: 60_000 })
    const line = page.getByText(/rolled over from the last period/).first()
    for (let i = 0; i < 3 && !(await line.isVisible().catch(() => false)); i++) { await next.click(); await page.waitForTimeout(1200) }
    await line.waitFor({ state: 'visible', timeout: 15_000 })
    const m = await page.evaluate(() => {
      const l = [...document.querySelectorAll('p')].find((p) => p.textContent.includes('rolled over from the last period'))
      const li = l.closest('li')
      const prev = l.previousElementSibling
      const lb = l.getBoundingClientRect(), pb = prev.getBoundingClientRect()
      return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, lineScroll: l.scrollWidth - l.clientWidth, gap: lb.top - pb.bottom, inLi: !!li }
    })
    check(t('check step: rolled-over line has no horizontal overflow and sits within 8px below its pool line'), m.overflow <= 0 && m.lineScroll <= 0 && m.gap <= 8 && m.gap >= -1, m)
    await crop(page, line.locator('xpath=ancestor::li[1]'), `check-step-rolled-over-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('check-step-rolled-over reached'), false, String(e.message).split('\n')[0]) }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
