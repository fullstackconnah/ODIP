// Captures and numeric checks for the restrictive practice monthly reports (RP PR2b, SHAPE "Numeric checks" 1-9). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/rp-monthly-reports.mjs <outdir>
// The mock API serves the fixture (mock-api/mock-rp-reports.js). The clock is pinned to 2026-11-04 10:00 Sydney, light theme.
// Prints "CHECK ok|FAIL name = value", writes checks.json, and exits non-zero when a check fails.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, settle, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const VIEWPORTS = [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 844, touch: true }]
const NOW = '2026-11-04T10:00:00+11:00'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const who = (role) => ({
  users: envelope([{ username: `dev.${role.toLowerCase()}`, role, tenantName: 'Sample Support Co' }]),
  login: envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: `dev.${role.toLowerCase()}`, fullName: `Dev ${role}`, role, tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' }),
})

const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${Object.values(ctx).join(' ')}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${Object.values(ctx).join(' ')}] = ${JSON.stringify(measured)}`)
}

const browser = await chromium.launch({ headless: true })

async function open(vp, role = 'Coordinator', extraRoutes) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch, colorScheme: 'light' })
  const page = await context.newPage()
  const cdp = vp.touch ? await context.newCDPSession(page) : null
  const pinCoarse = async () => {
    await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  await pinCoarse()
  await page.clock.setFixedTime(NOW)
  page.on('pageerror', (e) => check('page error', { width: vp.name }, e.message, false))
  const w = who(role)
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: w.users }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: w.login }))
  if (extraRoutes) await extraRoutes(page)
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await pinCoarse()
  return { context, page, pinCoarse }
}

const noOverflow = async (page, name, ctx, width) => {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth)
  check(name, ctx, sw, sw <= width)
}
const crop = async (page, locator, file, vp, opts = {}) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, file), { touch: !!vp.touch, ...opts })
  checks.push(checkCropHolds(r))
}
const goTab = async (page) => {
  await page.goto(`${BASE_URL}/incidents?view=rp-reports`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('tab', { name: /RP monthly reports/ }).waitFor({ timeout: 60_000 })
  await page.getByText('Alex Demo').first().waitFor({ timeout: 60_000 })
}
const dialog = (page) => page.locator('[role="dialog"], [role="alertdialog"]').last()

try {
  for (const vp of VIEWPORTS) {
    const ctx = { width: vp.name }
    const { context, page } = await open(vp)

    // 1. The tab, as a full page.
    await goTab(page)
    const tab = page.getByRole('tab', { name: /RP monthly reports/ })
    const tabName = (await tab.textContent()) ?? ''
    check('tab label count is 3', ctx, tabName.trim(), /RP monthly reports \(3\)/.test(tabName))
    const tablist = page.getByRole('tablist').first()
    const tl = await tablist.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    check('tablist does not overflow', ctx, tl, tl.sw <= tl.cw)
    await noOverflow(page, 'tab: no horizontal scroll', ctx, vp.width)
    const dueText = await page.locator('table').first().innerText()
    check('Oct 2026 Due by reads 06/11/2026', ctx, dueText.includes('06/11/2026'), dueText.includes('06/11/2026'))
    if (!vp.touch) {
      const rows = await page.locator('table tbody tr').evaluateAll((trs) => trs.map((tr) => Math.round(tr.getBoundingClientRect().height)))
      const rowH = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) || 34)
      check('every row is --row-h tall', ctx, { rows, rowH }, rows.length >= 4 && rows.every((h) => h === rowH))
    }
    const csv = page.getByRole('button', { name: /CSV for/ })
    const csvBox = await csv.boundingBox()
    check('CSV button is one line', ctx, csvBox?.height, !!csvBox && csvBox.height <= 44)
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `tab-${vp.name}.png`), { touch: !!vp.touch })).checks)

    // 2. The routine lodge modal with Varied use picked.
    await page.getByRole('button', { name: 'Lodge the October 2026 report for Alex Demo' }).click()
    await page.getByRole('button', { name: /Report type/ }).click()
    await page.getByRole('option', { name: 'Varied use' }).click()
    await page.getByRole('radio', { name: 'Increased' }).click().catch(() => page.getByRole('button', { name: 'Increased' }).click())
    await settle(page, dialog(page))
    const toggles = await dialog(page).locator('[role="radiogroup"], [role="group"]').first().locator('button, [role="radio"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)))
    check('varied toggle options sit on one row', ctx, toggles, toggles.length === 3 && new Set(toggles).size === 1)
    await noOverflow(page, 'modal: no horizontal scroll', ctx, vp.width)
    if (vp.touch) {
      const foot = await dialog(page).getByRole('button', { name: /Lodge report|Cancel/ }).evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
      check('modal footer buttons are 44+ tall (coarse)', ctx, foot, foot.length === 2 && foot.every((h) => h >= 44))
    }
    await crop(page, dialog(page), `routine-lodge-varied-${vp.name}.png`, vp)

    // 4. The 409 Callout: the lodge call is answered with a conflict.
    await page.route('**/api/v1/restrictive-practice-reports', (r) => (r.request().method() === 'POST'
      ? r.fulfill({ status: 409, json: { success: false, errors: ['This month has already been recorded as lodged.'] } })
      : r.continue()))
    await dialog(page).getByRole('radio', { name: 'No' }).click().catch(() => dialog(page).getByRole('button', { name: 'No', exact: true }).click())
    await dialog(page).getByRole('button', { name: 'Lodge report' }).click()
    await dialog(page).getByText(/already been lodged/).waitFor({ timeout: 20_000 })
    await crop(page, dialog(page), `conflict-${vp.name}.png`, vp)
    await page.unroute('**/api/v1/restrictive-practice-reports')
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    // 3. The PRN lodge modal with uses.
    await page.getByRole('button', { name: 'Lodge the October 2026 report for Jordan Demo' }).click()
    await dialog(page).getByText(/Uses in October 2026 \(2\)/).waitFor({ timeout: 20_000 })
    await noOverflow(page, 'PRN modal: no horizontal scroll', ctx, vp.width)
    await crop(page, dialog(page), `prn-lodge-${vp.name}.png`, vp)
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()

    // 5/6. The view modal with Undo, and the undo confirm.
    await page.getByRole('button', { name: 'View the August 2026 report for Alex Demo' }).click()
    await dialog(page).getByRole('button', { name: 'Undo lodging' }).waitFor({ timeout: 20_000 })
    await crop(page, dialog(page), `view-${vp.name}.png`, vp)
    await dialog(page).getByRole('button', { name: 'Undo lodging' }).click()
    await page.getByText('Undo this lodged report?').waitFor({ timeout: 20_000 })
    await crop(page, dialog(page), `undo-confirm-${vp.name}.png`, vp)
    await context.close()

    // 7. No organisation: a SuperAdmin who has not picked one.
    {
      const su = await open(vp, 'SuperAdmin')
      await su.page.goto(`${BASE_URL}/incidents?view=rp-reports`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const empty = su.page.getByText('Choose an organisation to view as first.')
      await empty.waitFor({ timeout: 60_000 })
      await crop(su.page, su.page.locator('main'), `no-organisation-${vp.name}.png`, vp)
      await su.context.close()
    }

    // 8. No lines at all.
    {
      const nl = await open(vp, 'Coordinator', (p) => p.route(/\/api\/v1\/restrictive-practice-reports(\?.*)?$/, (r) => r.fulfill({ json: envelope([]) })))
      await nl.page.goto(`${BASE_URL}/incidents?view=rp-reports`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await nl.page.getByText('No monthly reports yet.').waitFor({ timeout: 60_000 })
      await crop(nl.page, nl.page.locator('main'), `no-lines-${vp.name}.png`, vp)
      await nl.context.close()
    }

    // 9/10/12. The Health tab cards with the chips, and the deactivate prompt.
    {
      const h = await open(vp)
      await h.page.goto(`${BASE_URL}/participants/p-0001?tab=restrictive-practices`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const chip = h.page.getByRole('button', { name: /Lodge the .* monthly report/ }).first()
      await chip.waitFor({ timeout: 60_000 })
      const badge = chip.locator('span').first()
      const bb = await badge.boundingBox()
      check('chip text is one line (badge <= 24px)', ctx, bb?.height, !!bb && bb.height <= 24)
      const cb = await chip.boundingBox()
      if (vp.touch) check('chip hit box is 44x44+ (coarse)', ctx, cb, !!cb && cb.width >= 44 && cb.height >= 44)
      await noOverflow(h.page, 'Health tab: no horizontal scroll', ctx, vp.width)
      const card = chip.locator('xpath=ancestor::*[self::article or self::li or self::div][.//button[contains(., "Edit")]][1]')
      await crop(h.page, card, `health-chips-${vp.name}.png`, vp)

      await h.page.getByRole('button', { name: 'Edit' }).first().click()
      await h.page.getByLabel('Active').click()
      await h.page.getByRole('button', { name: /save entry/i }).click()
      await h.page.getByText('Was this practice eliminated?').waitFor({ timeout: 20_000 })
      await crop(h.page, dialog(h.page), `deactivate-prompt-${vp.name}.png`, vp)
      await h.context.close()
    }

    // 11. The dashboard tile.
    {
      const d = await open(vp)
      await d.page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const tile = d.page.getByRole('group', { name: 'RP monthly reports overdue 1' })
      await tile.waitFor({ timeout: 60_000 })
      check('dashboard tile count is 1', ctx, await tile.innerText(), true)
      await noOverflow(d.page, 'dashboard: no horizontal scroll', ctx, vp.width)
      await crop(d.page, tile, `dashboard-tile-${vp.name}.png`, vp)
      await d.context.close()
    }
  }
} catch (e) {
  check('script ran to the end', {}, String(e?.stack ?? e).split('\n').slice(0, 4).join(' | '), false)
} finally {
  await browser.close()
}

if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
