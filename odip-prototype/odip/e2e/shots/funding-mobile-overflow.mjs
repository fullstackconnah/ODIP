// Funding tab on a phone: the screen-reader budget table must not grow the layout viewport, so a dialog opened there keeps its 358 px width. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/funding-mobile-overflow.mjs <outdir>
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

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })
const W = 390

const browser = await chromium.launch({ headless: true })
try {
  const warm = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await warm.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await warm.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await warm.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await warm.getByRole('button', { name: 'Sign in as selected user' }).click()
  await warm.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await warm.goto(`${BASE_URL}/participants/p-0002?tab=funding`, { waitUntil: 'networkidle', timeout: 120_000 })

  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: W, height: 844 }, hasTouch: true, isMobile: true, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/participants/p-0002?tab=funding`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('[data-plot]').first().waitFor({ state: 'attached', timeout: 60_000 })
  await page.waitForTimeout(500)

  const table = await page.locator('table[data-table]').first().boundingBox()
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
  check('hidden budget table present', !!table, table)
  check(`page scrollWidth <= ${W}`, scrollWidth <= W, { scrollWidth })

  await page.getByRole('button', { name: 'Update' }).first().click()
  const dialog = page.getByRole('dialog').first()
  await dialog.waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForTimeout(400)
  const box = await dialog.boundingBox()
  check(`dialog fits the ${W}px viewport with 8px margins (<= ${W - 16})`, box && box.width <= W - 16 && box.x >= 0 && box.x + box.width <= W, box)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })
  const full = await fullPage(page, path.join(OUT_DIR, 'full', `funding-${W}.png`))
  checks.push(...full.checks.filter((c) => !c.name.startsWith('full page not truncated'))) // fullPage caps at 4000 px; this page is taller
} finally {
  await browser.close()
}
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
