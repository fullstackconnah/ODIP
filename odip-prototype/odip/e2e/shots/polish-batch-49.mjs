// Captures and numeric checks for polish batch 49: a participant list cut at 200 says so on the medication report filter, the roster board toolbar, the pattern panel and the trip booking panel.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Routed: sign-in as a Coordinator; GET /participants answers the mock API's own list with totalCount 250 (so the list reads as cut); every other call goes to the mock API.
import path from 'node:path'
import { AU_CONTEXT, cropElement, fullPage, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const NOTICE = /Showing the first \d+ of 250 participants\./
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
// The mock stores no role: sign in as a Coordinator so the medication Report tab exists.
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator' })
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

async function route(page) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  // useParticipants asks GET /participants?pageSize=200: the mock answers its own list, the total reads 250 so the list is cut.
  await page.route('**/api/v1/participants?*', async (r) => {
    const res = await r.fetch()
    const body = await res.json()
    if (body?.data?.items) body.data.totalCount = 250
    return r.fulfill({ response: res, json: body })
  })
}

// Crops the notice's parent (the control and its notice together) and checks the notice sits inside the crop.
async function shoot(page, st, name) {
  const notice = page.getByText(NOTICE).first()
  await notice.waitFor({ state: 'visible', timeout: 30_000 })
  const c = await cropElement(page, notice.locator('xpath=..'), path.join(OUT_DIR, `${name}-notice-${st.name}.png`), { touch: st.width === 390, hideChrome: true, pad: 24 })
  const nb = await notice.boundingBox()
  const inside = !!nb && nb.x >= c.clip.x - 1 && nb.y >= c.clip.y - 1 && nb.x + nb.width <= c.clip.x + c.clip.width + 1 && nb.y + nb.height <= c.clip.y + c.clip.height + 1
  add(`${name} "Showing the first" visible inside the crop [${st.name}]`, { clip: c.clip, notice: nb, text: await notice.textContent() }, inside && c.overlap?.pass !== false)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
    page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
    await route(page)
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const btn = page.getByRole('button', { name: 'Sign in as selected user' })
      await btn.waitFor({ state: 'visible', timeout: 60_000 })
      await btn.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

      await page.goto(`${BASE_URL}/medications?tab=report`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await shoot(page, st, 'report')

      await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await shoot(page, st, 'roster')
      const full = await fullPage(page, path.join(OUT_DIR, `roster-full-${st.name}.png`), { touch: mobile })
      checks.push(...full.checks)

      await page.goto(`${BASE_URL}/rostering/patterns`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: /new pattern/i }).click()
      await shoot(page, st, 'patterns')

      // Mock trip t-0001, Bookings tab (the tab is in the URL), Add Participant
      await page.goto(`${BASE_URL}/trips/t-0001?tab=bookings`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: /add participant/i }).click()
      await shoot(page, st, 'trip-bookings')
    } catch (e) {
      add(`scenes ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
