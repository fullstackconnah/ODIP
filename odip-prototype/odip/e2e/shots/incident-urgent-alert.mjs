// Captures and numeric checks for the urgent 24-hour incident alert in the bell (IC6). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/incident-urgent-alert.mjs <outdir>
// The mock API serves the app; the inbox is replaced here by page.route with one urgent and one normal alert.
// Prints "CHECK ok|FAIL name = value", writes checks.json, and exits non-zero when a check fails.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const VIEWPORTS = [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 844, touch: true }]
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' })
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()
const inbox = {
  items: [
    { id: 'urgent-1', title: 'Urgent: report an incident to the NDIS Commission by Tue 3 Nov, 11:30 am.', linkTo: '/incidents/inc-0002', createdAt: minutesAgo(3), urgent: true },
    { id: 'normal-1', title: 'Sam Lee reported an incident: injury, high severity.', linkTo: '/incidents', createdAt: minutesAgo(40) },
  ],
  unreadCount: 2,
  hasMore: false,
}

const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${Object.values(ctx).join(' ')}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${Object.values(ctx).join(' ')}] = ${JSON.stringify(measured)}`)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch })
    const page = await context.newPage()
    const cdp = vp.touch ? await context.newCDPSession(page) : null
    const pinCoarse = async () => {
      await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
    }
    await pinCoarse()
    page.on('pageerror', (e) => check('page error', { width: vp.name }, e.message, false))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route(/\/api\/v1\/notifications\/inbox(\?.*)?$/, (r) => r.fulfill({ json: envelope(inbox) }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await pinCoarse()

    await page.getByRole('button', { name: /Notifications$/ }).click()
    const urgentLabel = page.locator('[data-urgent-label]').first()
    await urgentLabel.waitFor({ timeout: 30_000 })
    const list = page.locator('ul:has([data-urgent-label])').first()

    // 1. The urgent marker is visible, and says "Urgent" in words.
    const text = (await urgentLabel.textContent())?.trim()
    check('urgent marker is visible and says Urgent', { width: vp.name }, { text, visible: await urgentLabel.isVisible() }, text === 'Urgent' && await urgentLabel.isVisible())

    // 2. Every row is a tap target of at least 44px at touch (and the urgent row sits above the normal one).
    const rows = await list.getByRole('link').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return { h: Math.round(b.height), w: Math.round(b.width) } }))
    check('two alert rows', { width: vp.name }, rows, rows.length === 2)
    if (vp.touch) check('row tap target is at least 44px', { width: vp.name }, rows, rows.every((r) => r.h >= 44))

    const r = await cropElement(page, list, path.join(OUT_DIR, `bell-list-${vp.name}.png`), { touch: !!vp.touch })
    checks.push(checkCropHolds(r))
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `bell-open-${vp.name}.png`), { touch: !!vp.touch })).checks)

    // 3. The alert opens its incident.
    await page.getByRole('link', { name: /Urgent: report an incident/ }).click()
    await page.waitForURL((u) => u.pathname === '/incidents/inc-0002', { timeout: 30_000 })
    await page.locator('main').waitFor({ timeout: 30_000 })
    await pinCoarse()
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `incident-page-${vp.name}.png`), { touch: !!vp.touch })).checks)
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
