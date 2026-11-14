// Role label: the view-as banner and the user switcher list show the role as people read it ("Support Worker"), not the stored name.
// Numeric checks only. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/role-label-switcher.mjs <outdir>
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

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' })

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} = ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}
const safe = async (name, fn) => {
  try { await fn() } catch (e) { check(`${name} (script error)`, false, String(e.message).split('\n')[0]) }
}

const browser = await chromium.launch({ headless: true })

async function openPage(context, touchCdp) {
  const page = await context.newPage()
  const pinCoarse = async () => {
    if (!touchCdp) return
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.pinCoarse = pinCoarse
  await pinCoarse()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  return page
}
const gotoReady = async (page, url) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('main, form').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  await page.pinCoarse()
  await page.waitForTimeout(800)
}
const noOverflow = async (page, label) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  check(`no horizontal scroll (${label})`, o.sw <= o.iw, o)
}
const crop = async (page, vp, name, locator, pad = 16) => {
  checks.push(checkCropHolds(await cropElement(page, locator, path.join(OUT_DIR, `${name}.png`), { pad, touch: !!vp.touch, natural: false })))
}


const STORED = /^(SupportWorker|ReadOnly|SuperAdmin)$/
const TENANT_USERS = [
  { id: 'user-viewed-1', fullName: 'Jamie Support', role: 'SupportWorker', isActive: true },
  { id: 'user-ro-1', fullName: 'Robin Reader', role: 'ReadOnly', isActive: true },
  { id: 'user-coord-1', fullName: 'Casey Coordinator', role: 'Coordinator', isActive: true },
]

async function roleLabels(page, vp) {
  const tag = `RL ${vp.name}`
  await page.route('**/api/v1/admin/tenants/*/users', (r) => r.fulfill({ json: envelope(TENANT_USERS) }))
  // The tab views as a user: the keys the switcher writes (lib/viewAs.ts); the profile carries the viewed role.
  await page.evaluate(() => {
    sessionStorage.setItem('odip_viewing_tenant', 'tenant-1')
    sessionStorage.setItem('odip_viewing_user', 'user-viewed-1')
    sessionStorage.setItem('odip_viewing_profile', JSON.stringify({ id: 'user-viewed-1', fullName: 'Jamie Support', role: 'SupportWorker', tenantName: 'Sample Support Co' }))
  })
  await gotoReady(page, '/trips')
  const banner = page.locator('div.h-10', { hasText: 'Viewing as' }).first()
  await banner.waitFor({ state: 'visible', timeout: 30_000 })
  const b = await banner.evaluate((el) => ({ text: el.textContent ?? '', sw: el.scrollWidth, cw: el.clientWidth, bracket: (el.textContent ?? '').match(/\(([^)]*)\)/)?.[1] ?? null }))
  check(`${tag}: the banner role is not a stored name`, b.bracket !== null && !STORED.test(b.bracket), b)
  check(`${tag}: the banner role reads "Support Worker"`, b.bracket === 'Support Worker', b)
  check(`${tag}: the banner row has no horizontal overflow`, b.sw <= b.cw, b)
  await noOverflow(page, tag)
  await crop(page, vp, `banner-viewing-as-${vp.name}`, banner, 12)
  if (vp.name === '1280') {
    await page.getByRole('button', { name: /^USR / }).click()
    const menu = page.getByRole('menu', { name: 'View as user' })
    await menu.waitFor({ state: 'visible', timeout: 30_000 })
    const rows = await menu.getByRole('menuitemradio').evaluateAll((els) => els.map((e) => (e.querySelector('span:last-child')?.textContent ?? '').trim()))
    check(`${tag}: no switcher row role is a stored name`, rows.length === 3 && rows.every((t) => !STORED.test(t)), rows)
    check(`${tag}: the switcher rows read as people read the roles`, JSON.stringify(rows) === JSON.stringify(['Support Worker', 'Read Only', 'Coordinator']), rows)
    await crop(page, vp, 'switcher-open-1280', menu, 16)
    await page.keyboard.press('Escape')
  } else {
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'banner-full-390.png'), { touch: vp.touch })).checks)
  }
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800, touch: false },
  { name: '390', width: 390, height: 844, touch: true },
]
try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
    const page = await openPage(context, vp.touch)
    await safe(`RL ${vp.name}`, () => roleLabels(page, vp))
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
