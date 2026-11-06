// Sign out asks first. Captures dialog-1280, dialog-390-drawer, dialog-unsent-1280, dark-1280. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/sign-out-confirm.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const queued = (id) => ({
  id, userId: USER_ID, viewAsTenant: 'tenant-0001', viewAsUser: null, shiftId: 's1', kind: 'note', path: '/portal/shifts/s1/notes', method: 'POST',
  body: { id, createdAt: '2026-10-28T02:00:00Z', body: 'x' }, clientTime: '2026-10-28T02:00:00Z', createdAt: '2026-10-28T02:00:00Z', status: 'waiting',
  label: { participant: 'Jordan Smith', serviceDate: '2026-10-28', rostered: '9:00 am – 1:00 pm' },
})

const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail }) }

const browser = await chromium.launch({ headless: true })

async function run({ name, width, height, touch, scheme, unsent, drawer, title }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: scheme, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  page.on('pageerror', (e) => check(`${name}: page error`, false, e.message))
  let logout = 0
  await page.route('**/api/v1/auth/logout', (r) => { logout++; r.fulfill({ json: envelope(null) }) })
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    if (unsent) { // after the app has loaded (the sidebar is there, so odip_user is written): a fresh sign-in may clear the previous queue
      await page.locator('aside').getByRole('button', { name: /Sign out$/ }).first().waitFor({ timeout: 60_000 })
      const uid = await page.evaluate(() => JSON.parse(localStorage.getItem('odip_user') ?? '{}').id)
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`odip_offline:${uid}:queue`, JSON.stringify([queued('q1'), queued('q2')])])
      await page.route('**/api/v1/portal/**', (r) => r.abort()) // the queue sends on load; a refused send keeps the records waiting
      await page.reload({ waitUntil: 'domcontentloaded' })
    }
    await page.waitForLoadState('networkidle')
    if (drawer) await page.locator('nav[aria-label="Mobile"] button[aria-controls="app-menu"]').click()
    await page.locator('aside').getByRole('button', { name: /Sign out$/ }).first().click({ force: unsent })
    const dialog = page.getByRole('alertdialog', { name: title })
    await dialog.waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(400)
    check(`${name}: nothing signed out before confirming`, logout === 0, { logout })
    check(`${name}: only one dialog`, (await page.getByRole('alertdialog').count()) === 1)
    const m = await page.evaluate(() => {
      const d = document.querySelector('[role="alertdialog"]')
      const r = d.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const tapMin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')) || 0
      return {
        inside: !!hit && d.contains(hit), tapMin,
        buttons: [...d.querySelectorAll('button')].filter((b) => b.textContent.trim()).map((b) => ({ t: b.textContent.trim(), h: b.getBoundingClientRect().height })),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    check(`${name}: dialog is above the drawer scrim (elementFromPoint at its centre)`, m.inside)
    check(`${name}: both buttons >= --tap-min (${m.tapMin}px)`, m.buttons.length >= 2 && m.buttons.every((b) => b.h >= m.tapMin - 0.5), m.buttons)
    if (touch) check(`${name}: no horizontal overflow`, m.overflow <= 0, m.overflow)
    const r = await cropElement(page, dialog, path.join(OUT_DIR, `${name}.png`), { touch, pad: 16 })
    checks.push(checkCropHolds({ ...r, touch }))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    check(`${name}: Escape closes it and signs nothing out`, (await page.getByRole('alertdialog').count()) === 0 && logout === 0)
  } catch (e) {
    const dump = await page.evaluate(() => ({ local: Object.keys(localStorage), session: { ...sessionStorage }, user: (localStorage.getItem('odip_user') ?? '').slice(0, 160), btns: [...document.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') ?? b.textContent).trim().slice(0, 30)).filter((t) => /sign/i.test(t)), url: location.pathname, asides: document.querySelectorAll('aside').length })).catch(() => null)
    check(`${name}: script error`, false, { e: String(e.message).split('\n')[0], dump })
  }
  await context.close()
}

await run({ name: 'dialog-1280', width: 1280, height: 800, touch: false, scheme: 'light', title: 'Sign out?' })
await run({ name: 'dialog-390-drawer', width: 390, height: 844, touch: true, scheme: 'light', drawer: true, title: 'Sign out?' })
await run({ name: 'dialog-unsent-1280', width: 1280, height: 800, touch: false, scheme: 'light', unsent: true, title: 'Sign out and delete unsent changes?' })
await run({ name: 'dark-1280', width: 1280, height: 800, touch: false, scheme: 'dark', title: 'Sign out?' })
await browser.close()
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
