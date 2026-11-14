// Role label in an organisation's users table (SuperAdmin): badges read "Support Worker", never the stored name. Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/role-label-tenant-users.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, fullPage, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.super', role: 'SuperAdmin', tenantName: null }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.super', fullName: 'Dev Super', role: 'SuperAdmin', tenantName: null, tenantId: null })
// The seed has no organisation with mixed roles, so the tenant list and its users are mocked (the only mocks).
const TENANT = { id: 'tenant-0001', name: 'Sample Support Co', emailDomain: null, isActive: true, createdAt: '2026-01-01T00:00:00Z', userCount: 4 }
const USERS = [
  { id: 'u-1', fullName: 'Sam Lee', role: 'SupportWorker', isActive: true },
  { id: 'u-2', fullName: 'Ravi Patel', role: 'ReadOnly', isActive: true },
  { id: 'u-3', fullName: 'Ada Nguyen', role: 'Admin', isActive: true },
  { id: 'u-4', fullName: 'Kim Ho', role: 'SuperAdmin', isActive: false },
]
const STORED = /^(SupportWorker|ReadOnly|SuperAdmin)$/
const TWO_WORD = /^(Support Worker|Read Only|Super Admin)$/

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} = ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}
const safe = async (name, fn) => {
  try { await fn() } catch (e) { check(`${name} (script error)`, false, String(e.message).split('\n')[0] + ' | ' + (await globalThis.__page?.evaluate(() => (document.querySelector('main') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 500)).catch(() => ''))) }
}

const browser = await chromium.launch({ headless: true })

async function openPage(context, touch) {
  const page = await context.newPage()
  if (touch) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  }
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/admin/tenants', (r) => r.fulfill({ json: envelope([TENANT]) }))
  await page.route(`**/api/v1/admin/tenants/${TENANT.id}/users*`, (r) => r.fulfill({ json: envelope(USERS) }))
  // The mock API's provider settings carry no registration number, which this view trims; a complete row keeps the page up.
  await page.route(`**/api/v1/admin/tenants/${TENANT.id}/provider-settings*`, (r) => r.fulfill({ json: envelope({ registrationNumber: '4050012345', abn: '51824753556', organisationName: TENANT.name, address: '1 Example Street', state: 'WA' }) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  return page
}

async function usersTable(page, vp) {
  await page.goto(`${BASE_URL}/settings?section=tenants`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: `View Users: ${TENANT.name}` }).click()
  const card = page.getByRole('heading', { name: 'Users', level: 4 }).locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]')
  await card.waitFor({ state: 'visible', timeout: 15_000 })
  await card.getByText('Sam Lee').first().waitFor({ state: 'visible', timeout: 15_000 })
  const badges = await card.locator('span.inline-flex.rounded-full').evaluateAll((els) => els.map((e) => {
    const cs = getComputedStyle(e)
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    return { text: e.textContent.trim(), scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, oneLine: e.getBoundingClientRect().height <= lh + pad + 2 }
  }))
  const roles = badges.filter((b) => /^(Support Worker|Read Only|Admin|Super Admin|SupportWorker|ReadOnly|SuperAdmin)$/.test(b.text))
  check(`no Role badge shows a stored name (${vp.name})`, roles.length > 0 && !roles.some((b) => STORED.test(b.text)), roles.map((b) => b.text))
  check(`a badge reads a two-word label (${vp.name})`, roles.some((b) => TWO_WORD.test(b.text)))
  check(`no role badge overflows or wraps (${vp.name})`, roles.every((b) => b.scrollWidth <= b.clientWidth && b.oneLine), roles)
  checks.push(checkCropHolds(await cropElement(page, card, path.join(OUT_DIR, `tenant-users-table-${vp.name}.png`), { pad: 16, touch: vp.touch, natural: vp.touch })))
  if (vp.name === '390') await fullPage(page, path.join(OUT_DIR, 'tenant-users-full-390.png'), { touch: true })
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800, touch: false },
  { name: '390', width: 390, height: 844, touch: true },
]
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
    const page = await openPage(context, vp.touch)
    globalThis.__page = page
    await safe(`users table ${vp.name}`, () => usersTable(page, vp))
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
