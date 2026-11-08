// Polish batch 40: the notification log says when it shows only the latest 500 rows (H48-2).
// Capture states: notifications-capped-390, notifications-capped-1280, notifications-normal-1280
// Run through the runner: odip-test.sh <worktree> shots e2e/shots/polish-batch-40.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({
  id: `notif-${i}`, eventType: 'LeaveRequestSubmitted', entityType: 'LeaveRequest', entityId: `leave-${i}`, recipientUserId: 's-0001',
  recipientName: 'Callum Radford', status: 'Failed', attempts: 5, nextAttemptAt: '2026-09-13T04:00:00Z',
  lastError: 'SmtpCommandException: 421 Service not available', createdAt: '2026-09-12T09:00:05Z',
}))

const checks = []
const check = (name, detail, pass) => { checks.push({ name, pass, detail }) }
const browser = await chromium.launch({ headless: true })
const CAP_LINE = 'Showing the latest 500. Narrow the dates to see older ones.'

async function run(vp, name, count) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce', ...(vp.touch ? { hasTouch: true, isMobile: true } : {}) })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${name})`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/admin/notifications?*', (r) => r.fulfill({ json: envelope(rowsOf(count)) }))
  await page.route(/\/api\/v1\/admin\/notifications$/, (r) => r.fulfill({ json: envelope(rowsOf(count)) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/settings?section=failed-sends`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('heading', { name: 'Notification outbox' }).waitFor({ timeout: 45_000 })
  await page.getByText('Callum Radford').first().waitFor({ timeout: 45_000 })
  const region = page.getByRole('heading', { name: 'Notification outbox' }).locator("xpath=ancestor::div[contains(@class,'space-y-3')][1]")
  const line = page.getByText(CAP_LINE)
  const n = await line.count()
  check(`${name}: cap line ${count >= 500 ? 'visible' : 'absent'}`, n, count >= 500 ? n === 1 && (await line.isVisible()) : n === 0)
  const m = await region.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  check(`${name}: no horizontal overflow on the tab container`, m, m.sw <= m.cw)
  if (count >= 500) {
    const size = (l) => l.evaluate((el) => getComputedStyle(el).fontSize)
    const [a, b] = [await size(line), await size(page.getByText('From', { exact: true }))]
    check(`${name}: cap line font size equals the From label`, { line: a, label: b }, a === b)
  }
  checks.push(checkCropHolds(await cropElement(page, region, path.join(OUT_DIR, `${name}.png`), { touch: vp.touch, natural: true })))
  await context.close()
}

try {
  await run({ width: 390, height: 844, touch: true }, 'notifications-capped-390', 500)
  await run({ width: 1280, height: 900, touch: false }, 'notifications-capped-1280', 500)
  await run({ width: 1280, height: 900, touch: false }, 'notifications-normal-1280', 3)
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
