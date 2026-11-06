// PB12: the approver line on the completion review when the Start was queued offline (no prefix) and when it was live (prefix kept). Captures plus numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/pb12-approver-line.mjs <outdir>
// Sign-in is stubbed with page.route; the worker's shift, the Start answer and the completion are the mock API's, patched in flight. The phone's location is a stub.
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
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])


const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openPage(browser, vp, { role, username, geo = 'denied', insecure = false }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([g, insecureFlag]) => {
    if (insecureFlag) Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const answer = g === 'fix'
      ? (ok) => ok({ coords: { latitude: -27.4012345, longitude: 153.0412345, accuracy: 12 }, timestamp: Date.now() })
      : (_ok, fail) => fail({ code: 1, message: 'denied' })
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (ok, fail) => answer(ok, fail), watchPosition: () => 0, clearWatch: () => {} }, configurable: true })
  }, [geo, insecure])
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}

const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${ctx}: no horizontal scroll`, o <= 0, o)
}
// Every visible button, input, select and textarea inside `root` has at least 44px of height to tap, its own box or its TAP_AREA pad.
const tapTargets = async (root, ctx) => {
  const small = await root.evaluate((el) => [...el.querySelectorAll('button, input, select, textarea')].filter((e) => {
    const b = e.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0) || getComputedStyle(e).visibility === 'hidden') return false
    const pad = parseFloat(getComputedStyle(e, '::before').height) || 0
    return Math.max(b.height, pad) < 43.5
  }).map((e) => `${e.tagName} ${(e.getAttribute('aria-label') || e.textContent || e.name || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`))
  check(`${ctx}: tap targets at least 44 high`, small.length === 0, small)
}
const noCoordinates = async (page, ctx) => {
  const text = await page.evaluate(() => document.body.innerText)
  check(`${ctx}: no coordinate digits in the text`, !/-?\d{1,3}\.\d{4,}/.test(text), text.match(/-?\d{1,3}\.\d{4,}/)?.[0] ?? '')
}
const crop = async (page, locator, name, vp, pad = 0) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}


const STATES = [
  ['offline-typed', 'Started offline: Phone had no signal at the front gate', true],
  ['offline-bare', 'Started offline', true],
  ['online-unavailable', 'GPS would not lock', false],
]
const CAPTURES = [['offline-typed', '1280'], ['offline-bare', '1280'], ['online-unavailable', '1280'], ['offline-typed', '390']]
const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const [state, reason, offline] of STATES) {
  for (const vp of VPS) {
    const t = (n) => `${vp.name}: ${state}: ${n}`
    const tag = vp.name
    const shoot = CAPTURES.some(([s, w]) => s === state && w === vp.name)
    try {
      const { context, page } = await openPage(browser, vp, { role: 'Admin', username: 'dev.admin' })
      await page.route('**/api/v1/rostering/shifts/*/completion', async (r) => {
        const response = await r.fetch()
        const body = await response.json()
        if (body?.data) Object.assign(body.data, { locationCheck: 'Unavailable', locationDistanceMetres: null, locationAccuracyMetres: null, locationReason: reason })
        await r.fulfill({ response, json: body })
      })
      await page.goto(`${BASE_URL}/rostering/completions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const approve = page.getByRole('button', { name: /^Approve .* on / }).first()
      await approve.waitFor({ state: 'visible', timeout: 60_000 })
      await approve.click()
      const dialog = page.getByRole('alertdialog')
      await dialog.waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForTimeout(400)
      const items = (await dialog.getByRole('listitem').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())
      const line = items.find((i) => /Started offline|Location not available/.test(i)) ?? ''
      check(t('an approver line is shown'), line !== '', items)
      check(t('no "::" or ": Started offline"'), !line.includes('::') && !line.includes(': Started offline'), line)
      check(t(offline ? 'no "Location not available"' : 'keeps "Location not available: "'), offline ? !line.includes('Location not available') : line.startsWith('Location not available: '), line)
      if (offline) check(t('line is the stored reason alone'), line === reason, line)
      await noHScroll(page, t('page'))
      if (shoot) await crop(page, dialog, `${state}-${tag}.png`, vp)
      if (state === 'offline-typed') checks.push(...(await fullPage(page, path.join(OUT_DIR, `full-${tag}.png`), { touch: vp.touch })).checks)
      await context.close()
    } catch (e) { check(t('ran'), false, String(e.message).split('\n')[0]) }
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
