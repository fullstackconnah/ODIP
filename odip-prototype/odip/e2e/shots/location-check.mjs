// Location check PR2: the Start sheets (no fix: denied and insecure; off site) and the approval line on the completion review dialog. Captures plus numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/location-check.mjs <outdir>
// Sign-in is stubbed with page.route; the worker's shift, the Start answer and the completion are the mock API's, patched in flight. The phone's location is a stub.
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
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const PLACE = { name: 'Southside community day centre', address: '12 Riverside Parade, Southside Heights QLD 4101' }

// The plan's 6.4 table, word for word.
const LINES = {
  atLocation: 'At location (40 m, accuracy 15 m).',
  notAtLocation: 'Not at location (850 m away): The gate was locked, so I started at the car park.',
  unavailable: 'Location not available: Phone location was turned off.',
  noReason: 'Not at location (850 m away). No reason given.',
}
const REVIEWS = [
  ['review-at-location', { locationCheck: 'AtLocation', locationDistanceMetres: 40, locationAccuracyMetres: 15, locationReason: null }, LINES.atLocation],
  ['review-not-at-location', { locationCheck: 'NotAtLocation', locationDistanceMetres: 850, locationAccuracyMetres: 12, locationReason: 'The gate was locked, so I started at the car park.' }, LINES.notAtLocation],
  ['review-unavailable', { locationCheck: 'Unavailable', locationDistanceMetres: null, locationAccuracyMetres: null, locationReason: 'Phone location was turned off.' }, LINES.unavailable],
  ['review-no-reason', { locationCheck: 'NotAtLocation', locationDistanceMetres: 850, locationAccuracyMetres: 12, locationReason: null }, LINES.noReason],
]

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

// The worker's Published shift with the place on it. Every GET is patched, so a Start in one state never hides the button in the next.
async function routeWorkerShift(page, start) {
  let last = null
  await page.route('**/api/v1/portal/shifts/sh-next', async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data) { body.data.status = 'Published'; body.data.serviceLocation = PLACE; last = body }
    await r.fulfill({ response, json: body })
  })
  await page.route('**/api/v1/portal/shifts/sh-next/start', (r) => {
    const data = { ...(last?.data ?? {}), status: 'InProgress', serviceLocation: PLACE, completion: { ...(last?.data?.completion ?? {}), ...start } }
    return r.fulfill({ json: envelope(data) })
  })
  await page.route('**/api/v1/portal/shifts/sh-next/location-reason', (r) => r.fulfill({ json: envelope({ ...(last?.data ?? {}), serviceLocation: PLACE }) }))
}
const openShift = async (page) => {
  await page.goto(`${BASE_URL}/portal/shifts/sh-next`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const startBtn = page.getByRole('button', { name: 'Start shift' })
  await startBtn.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(400)
  return startBtn
}

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const tag = vp.touch ? `${vp.name}-touch` : vp.name

  // start-nofix-sheet, denied and insecure
  for (const [state, opts, cause] of [['start-nofix-sheet-denied', { geo: 'denied' }, 'Location is turned off for Bunya Support on this phone.'], ['start-nofix-sheet-insecure', { geo: 'denied', insecure: true }, "This web address can't use your location. Open Bunya Support from your usual secure link next time."]]) {
    try {
      const { context, page } = await openPage(browser, vp, { role: 'SupportWorker', username: 'dev.worker', ...opts })
      await routeWorkerShift(page, {})
      await (await openShift(page)).click()
      const dialog = page.getByRole('dialog', { name: "We couldn't check your location" })
      await dialog.waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(400)
      check(t(`${state}: cause line is the plan's wording`), await dialog.getByText(cause, { exact: true }).isVisible())
      const retry = await dialog.getByRole('button', { name: 'Try again' }).count()
      check(t(`${state}: Try again ${state.endsWith('insecure') ? 'is left out' : 'is offered'}`), state.endsWith('insecure') ? retry === 0 : retry === 1, retry)
      check(t(`${state}: Start shift is offered`), await dialog.getByRole('button', { name: 'Start shift' }).isVisible())
      await noHScroll(page, t(state))
      await noCoordinates(page, t(state))
      if (vp.touch) await tapTargets(dialog, t(state))
      await crop(page, dialog, `${state}-${tag}.png`, vp)
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }

  // start-offsite-sheet: the fix is 850 m out, the server says Not at location
  try {
    const { context, page } = await openPage(browser, vp, { role: 'SupportWorker', username: 'dev.worker', geo: 'fix' })
    await routeWorkerShift(page, { locationCheck: 'NotAtLocation', locationDistanceMetres: 850, locationAccuracyMetres: 12 })
    await (await openShift(page)).click()
    const dialog = page.getByRole('dialog', { name: `You're about 850 m from ${PLACE.name}` })
    await dialog.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(400)
    check(t('start-offsite-sheet: Send waits for a note'), await dialog.getByRole('button', { name: 'Send' }).isDisabled())
    await dialog.getByLabel("Why you're starting here").fill('The gate was locked.')
    check(t('start-offsite-sheet: Send is on once there is a note'), await dialog.getByRole('button', { name: 'Send' }).isEnabled())
    await dialog.getByLabel("Why you're starting here").fill('')
    await noHScroll(page, t('start-offsite-sheet'))
    await noCoordinates(page, t('start-offsite-sheet'))
    if (vp.touch) await tapTargets(dialog, t('start-offsite-sheet'))
    await crop(page, dialog, `start-offsite-sheet-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('start-offsite-sheet ran'), false, String(e.message).split('\n')[0]) }

  // review-*: the approve dialog on the completion queue, with the completion's location fields patched
  for (const [state, fields, expected] of REVIEWS) {
    try {
      const { context, page } = await openPage(browser, vp, { role: 'Admin', username: 'dev.admin' })
      await page.route('**/api/v1/rostering/shifts/*/completion', async (r) => {
        const response = await r.fetch()
        const body = await response.json()
        if (body?.data) Object.assign(body.data, fields)
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
      check(t(`${state}: the line reads exactly the plan's 6.4 text`), items.includes(expected), items)
      await noHScroll(page, t(state))
      await noCoordinates(page, t(state))
      if (vp.touch) await tapTargets(dialog, t(state))
      await crop(page, dialog, `${state}-${tag}.png`, vp)
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
