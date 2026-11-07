// H32-3 Portal leave: after a refused withdraw (409) the list refetches, so the callout shows and the row has no Withdraw button.
// State portal-withdraw-refused, light theme, 390 touch and 1280. The mock answers the cancel with 409 and every list fetch after it with the request Approved.
// Numeric checks (exit 1 on any failure): the callout carries the server message, the Withdraw button is gone, the row reads Approved, no horizontal scroll, 390 stays touch.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks, AU_CONTEXT } from '../shots/lib/capture.mjs'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  ;({ chromium } = await import('@playwright/test'))
}

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const ROLE = 'SupportWorker'
const username = `dev.${ROLE.toLowerCase()}`
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username, role: ROLE, tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: `Dev ${ROLE}`, role: ROLE, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

const leave = (status) => ({
  id: 'leave-1', userId: '00000000-0000-0000-0000-0000000000a1', userFullName: `Dev ${ROLE}`, leaveType: 'Annual', startDate: '2026-12-14', endDate: '2026-12-18', status,
  reason: null, requestedByUserId: '00000000-0000-0000-0000-0000000000a1', requestedAt: '2026-11-02T01:00:00Z', decidedByUserId: status === 'Pending' ? null : 'u2', decidedAt: status === 'Pending' ? null : '2026-11-08T01:00:00Z', decisionNote: null, source: 'Odip',
})
const REFUSED = 'Only pending requests can be withdrawn.'

const VIEWPORTS = [
  { name: 'touch-390', width: 390, height: 844, touch: true },
  { name: 'desktop-1280', width: 1280, height: 900, touch: false },
]

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (vp, name, ok, detail = '') => { checks.push({ name: `${vp} ${name}`, pass: !!ok, detail }); console.log(`[hunt-32-fix] ${ok ? 'PASS' : 'FAIL'} ${vp} ${name}${detail ? ` (${detail})` : ''}`) }

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light' })
    const page = await context.newPage()
    let refused = false
    await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
    await page.route((url) => url.pathname === '/api/v1/portal/leave', (route) => route.fulfill({ json: envelope({ leave: [leave(refused ? 'Approved' : 'Pending')], unavailability: [] }) }))
    await page.route((url) => url.pathname === '/api/v1/portal/leave/leave-1/cancel', (route) => { refused = true; return route.fulfill({ status: 409, json: { success: false, data: null, message: REFUSED, errors: [REFUSED] } }) })
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/portal/leave`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const withdraw = page.getByRole('button', { name: /^withdraw: /i })
    await withdraw.first().waitFor({ state: 'visible', timeout: 60_000 })
    if (vp.touch) check(vp.name, 'pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))

    await withdraw.first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: /^withdraw$/i }).click()
    const callout = page.getByText(REFUSED, { exact: true })
    await callout.waitFor({ state: 'visible', timeout: 15_000 })
    await withdraw.first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(500)

    check(vp.name, 'callout carries the server message', (await callout.count()) === 1)
    check(vp.name, 'no Withdraw button after the refetch', (await withdraw.count()) === 0)
    check(vp.name, 'row reads Approved', (await page.getByText('Approved', { exact: true }).count()) >= 1)
    check(vp.name, 'no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    const opts = { touch: vp.touch }
    checks.push(checkCropHolds(await cropElement(page, callout, path.join(OUT_DIR, `${vp.name}-portal-withdraw-refused-callout.png`), { ...opts, also: page.getByText('Approved', { exact: true }).first() })))
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${vp.name}-portal-withdraw-refused.png`), opts)).checks)
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
