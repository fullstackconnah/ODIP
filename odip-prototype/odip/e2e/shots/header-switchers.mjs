// Header switchers: the SuperAdmin tenant and user menus gain role="menu", menuitemradio rows and arrow-key handling; the look is unchanged.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/header-switchers.mjs <outdir>
// Signs in as a SuperAdmin through page.route stubs; the tenant list and the tenant's users are stubbed too (the mock API has neither).
// Captures tenant-open-1280, user-open-1280, item-focus-1280, tenant-open-390, user-open-390, item-focus-390, user-open-dark-390, plus a closed full page per breakpoint.
// Prints the checks (a-f) and exits 1 when one fails.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.super', role: 'SuperAdmin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.super', fullName: 'Dev SuperAdmin', role: 'SuperAdmin', tenantName: 'Sample Support Co' })
const TENANTS = [
  { id: 'tenant-1', name: 'Sample Support Co', isActive: true },
  { id: 'tenant-2', name: 'Hillcrest Community Care', isActive: true },
  { id: 'tenant-3', name: 'Old Harbour Services', isActive: false },
]
const USERS = [
  { id: 'u-1', fullName: 'Jamie Support', role: 'SupportWorker', isActive: true },
  { id: 'u-2', fullName: 'Casey Coordinator', role: 'Coordinator', isActive: true },
  { id: 'u-3', fullName: 'Robin Retired', role: 'SupportWorker', isActive: false },
]

const checks = []
const check = (name, ctx, detail, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(detail)}`)
}

const browser = await chromium.launch({ headless: true })

async function openPage(width, height, touch, scheme) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: scheme, reducedMotion: 'reduce' })
  await context.addInitScript(() => sessionStorage.setItem('odip_viewing_tenant', 'tenant-1'))
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route(/\/api\/v1\/admin\/tenants$/, (r) => r.fulfill({ json: envelope(TENANTS) }))
  await page.route(/\/api\/v1\/admin\/tenants\/[^/]+\/users$/, (r) => r.fulfill({ json: envelope(USERS) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/trips`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('button[aria-label^="SA "]').waitFor({ timeout: 60_000 })
  await page.locator('button[aria-label^="USR "]').waitFor({ timeout: 60_000 })
  return { context, page }
}

const KINDS = {
  tenant: { trigger: 'button[aria-label^="SA "]', label: 'tenant' },
  user: { trigger: 'button[aria-label^="USR "]', label: 'user' },
}

// Measures one open menu against the viewport; the item heights and the trigger width are checked by the caller.
const measureMenu = (page, kind) => page.evaluate((sel) => {
  const trigger = document.querySelector(sel)
  const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
  const r = menu?.getBoundingClientRect()
  const items = [...(menu?.querySelectorAll('[role^="menuitem"]') ?? [])].map((i) => Math.round(i.getBoundingClientRect().height * 10) / 10)
  return {
    menu: r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null,
    viewport: { w: document.documentElement.clientWidth, h: window.innerHeight },
    items,
    triggerWidth: trigger.getBoundingClientRect().width,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }
}, KINDS[kind].trigger)

async function run(width, height, touch, scheme, plan) {
  const { context, page } = await openPage(width, height, touch, scheme)
  const crop = async (kind, file) => {
    const r = await cropElement(page, page.locator(KINDS[kind].trigger), path.join(OUT_DIR, file), { touch, also: page.locator('[role="menu"]'), pad: 12 })
    checks.push(checkCropHolds({ ...r, touch }))
  }
  try {
    for (const [kind, name, how] of plan) {
      const ctx = `${name} ${width} ${scheme}`
      const trigger = page.locator(KINDS[kind].trigger)
      const before = (await trigger.boundingBox()).width
      if (how === 'click') await trigger.click()
      else {
        await trigger.focus()
        await page.keyboard.press('Enter')
        await page.keyboard.press('ArrowDown')
      }
      await page.locator('[role="menu"]').waitFor({ timeout: 30_000 })
      const m = await measureMenu(page, kind)
      check('a menu sits inside the viewport', ctx, { menu: m.menu, viewport: m.viewport }, m.menu && m.menu.left >= 0 && m.menu.right <= m.viewport.w && m.menu.top >= 0 && m.menu.bottom <= m.viewport.h)
      if (width === 390) check('b every item is at least 44px tall', ctx, m.items, m.items.length >= 2 && m.items.every((h) => h >= 44))
      check('c trigger width unchanged by opening (1px)', ctx, { before, open: m.triggerWidth }, Math.abs(before - m.triggerWidth) <= 1)
      check('e no horizontal overflow', ctx, m.overflow, m.overflow <= 0)
      const inMenu = await page.evaluate(() => !!document.activeElement?.closest('[role="menu"]') && document.activeElement.matches('[role^="menuitem"]'))
      check('f opening puts focus on an item inside the menu', ctx, inMenu, inMenu)
      await crop(kind, name + '.png')
      await page.keyboard.press('Escape')
      const back = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), KINDS[kind].trigger)
      check('d after Escape the trigger has focus', ctx, back, back)
      check('d the menu is gone after Escape', ctx, await page.locator('[role="menu"]').count(), (await page.locator('[role="menu"]').count()) === 0)
    }
    const size = width === 390 ? '390' : '1280'
    if (scheme === 'light') {
      const f = await fullPage(page, path.join(OUT_DIR, 'full', `closed-${size}.png`), { touch })
      checks.push(...f.checks)
    }
  } catch (e) {
    check('script error', `${width} ${scheme}`, String(e.message).split('\n')[0], false)
  }
  await context.close()
}

await run(1280, 800, false, 'light', [['tenant', 'tenant-open-1280', 'click'], ['user', 'user-open-1280', 'click'], ['tenant', 'item-focus-1280', 'key']])
await run(390, 844, true, 'light', [['tenant', 'tenant-open-390', 'click'], ['user', 'user-open-390', 'click'], ['user', 'item-focus-390', 'key']])
await run(390, 844, true, 'dark', [['user', 'user-open-dark-390', 'click']])
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
