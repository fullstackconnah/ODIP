// Polish batch 29: (a) item 2, the Length select drops a chosen Ongoing once the start moves so the plan passes 800 days; (b) item 1, the leave form shows the server's
// overlap 409. 1280 and 390 touch, one crop and one full page each. Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-29.mjs <outdir>
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const OVERLAP = 'A request of this type already covers some of these dates.'
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }

async function open(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch { /* storage blocked */ } }, [USER_ID])
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' }) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}

// hideChrome drops the sticky bar and bottom nav; overlapCheck fails a crop they still cover.
const shoot = async (page, loc, file, { pad } = {}) => {
  const shot = await cropElement(page, loc, file, { pad, hideChrome: true, during: async (clip) => { await page.waitForTimeout(400); return overlapCheck(loc, clip, path.basename(file)) } })
  checks.push(shot.measured, checkCropHolds(shot))
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900, touch: false },
  { name: '390', width: 390, height: 844, touch: true },
]
const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    const { context, page } = await open(browser, vp)

    // Item 2: pick Ongoing, then move the start back so the plan runs past 800 days; Ongoing must drop to "Choose an end date".
    try {
      await page.goto(`${BASE_URL}/participants/p-0004/agreement-draft`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const length = page.getByLabel('Length')
      await length.waitFor({ state: 'visible', timeout: 60_000 })
      const ongoing = length.locator('option', { hasText: /^Ongoing/ })
      const canOngoing = await ongoing.count() && !(await ongoing.evaluate((o) => o.disabled))
      if (canOngoing) await length.selectOption({ label: 'Ongoing (until the plan ends)' })
      check(`${vp.name} agreement: Ongoing was selectable first`, canOngoing && (await length.inputValue()) === 'ongoing', await length.inputValue())
      await page.getByLabel('Agreement starts').fill('2020-01-01')
      await page.waitForTimeout(500)
      const value = await length.inputValue()
      check(`${vp.name} agreement: Length drops to custom, not a disabled Ongoing`, value === 'custom', value)
      const disabled = await ongoing.evaluate((o) => o.disabled)
      check(`${vp.name} agreement: Ongoing option stays disabled`, disabled, disabled)
      await shoot(page, length.locator('xpath=ancestor::div[1]'), path.join(OUT_DIR, `agreement-ongoing-cleared-${vp.name}.png`), { pad: 24 })
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `agreement-ongoing-cleared-${vp.name}.png`), { touch: vp.touch })).checks)
    } catch (e) { check(`${vp.name} agreement state reached`, false, String(e.message).split('\n')[0]) }

    // Item 1: the leave form shows the server's overlap 409 text.
    try {
      await page.route('**/api/v1/leave', (r) => (r.request().method() === 'POST'
        ? r.fulfill({ status: 409, json: { success: false, data: null, message: null, errors: [OVERLAP] } })
        : r.fallback()))
      await page.goto(`${BASE_URL}/rostering/leave`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: 'Enter on behalf' }).click()
      await page.getByRole('menuitem', { name: 'Leave' }).or(page.getByRole('option', { name: 'Leave' })).first().click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor({ state: 'visible', timeout: 30_000 })
      await dialog.getByPlaceholder('Search staff…').click()
      await page.getByRole('option').first().click()
      await dialog.getByLabel('Start date').fill('2026-09-14')
      await dialog.getByLabel('End date').fill('2026-09-16')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      const alert = dialog.getByRole('alert').filter({ hasText: OVERLAP })
      await alert.waitFor({ state: 'visible', timeout: 15_000 })
      check(`${vp.name} leave: the overlap message is shown in the form`, true, OVERLAP)
      await shoot(page, dialog, path.join(OUT_DIR, `leave-overlap-refused-${vp.name}.png`), { pad: 16 })
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `leave-overlap-refused-${vp.name}.png`), { touch: vp.touch })).checks)
    } catch (e) { check(`${vp.name} leave state reached`, false, String(e.message).split('\n')[0]) }

    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
