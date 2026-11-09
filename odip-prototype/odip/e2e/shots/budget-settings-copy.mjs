// Settings > Budget tab at 390 and 1280: the "both modes" paragraph names what a hard limit cannot see (polish batch 61). Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/budget-settings-copy.mjs <outdir>
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
const NEW_TAIL = 'Shifts the system cannot price yet are not checked, so a hard limit does not see them. These are sleepovers and passive nights on a group activity, 1:2 to 1:5 and shared-support shifts that are not on a group activity, and group shifts with no agreed number of participants, or where that number changes part-way through.'

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

const browser = await chromium.launch({ headless: true })
try {
  mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })
  for (const [W, H, touch] of [[1280, 900, false], [390, 844, true]]) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch, colorScheme: 'light', reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/settings?section=budgets`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const line = page.getByText(NEW_TAIL, { exact: false })
    await line.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)
    check(`new sentence shown at ${W}`, (await line.count()) === 1)
    check(`old sentence gone at ${W}`, (await page.getByText('sleepovers, passive nights and shared support at 1:2 or more').count()) === 0)
    // The shell is as tall as the viewport asks (sidebar column), so one grow can leave the page taller: grow to the measured height until it fits, then fullPage checks and shoots it whole.
    for (let i = 0; i < 4; i++) {
      const h = await page.evaluate(() => document.scrollingElement.scrollHeight)
      if (h <= page.viewportSize().height) break
      await page.setViewportSize({ width: W, height: h })
      await page.waitForTimeout(300)
    }
    const full = await fullPage(page, path.join(OUT_DIR, 'full', `budget-settings-${W}.png`))
    checks.push(...full.checks)
    await context.close()
  }
} finally {
  await browser.close()
}
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
