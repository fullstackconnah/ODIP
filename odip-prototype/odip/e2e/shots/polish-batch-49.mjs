// Captures and numeric checks for polish batch 49: a participant list cut at 200 says so on the medication report filter, the roster board toolbar, the pattern panel and the trip booking panel.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Routed: GET /participants answers the mock API's own list with totalCount 250 (so the list reads as cut); every other call goes to the mock API.
import path from 'node:path'
import { AU_CONTEXT, cropElement, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const NOTICE = /Showing the first \d+ of 250 participants\./
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

async function route(page) {
  await page.route('**/api/v1/participants?*', async (r) => {
    const res = await r.fetch()
    const body = await res.json()
    if (body?.data?.items) body.data.totalCount = 250
    return r.fulfill({ response: res, json: body })
  })
}

const overflow = (page) => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))

async function shoot(page, st, name) {
  const notice = page.getByText(NOTICE).first()
  await notice.waitFor({ state: 'visible', timeout: 30_000 })
  add(`${name} notice visible [${st.name}]`, await notice.textContent(), await notice.isVisible())
  const fit = await overflow(page)
  add(`no horizontal overflow on ${name} [${st.name}]`, fit, fit.scrollWidth <= fit.clientWidth)
  const c = await cropElement(page, notice, path.join(OUT_DIR, `${name}-truncated-${st.name}.png`), { touch: st.width === 390, hideChrome: true, pad: 48 })
  add(`crop [${name}-truncated-${st.name}]`, { clip: c.clip, box: c.box }, c.overlap?.pass ?? true)
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

      // Medication report filter
      await page.goto(`${BASE_URL}/medications`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('tab', { name: /report/i }).click()
      await shoot(page, st, 'report-filter')

      // Roster board toolbar
      await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await shoot(page, st, 'board-toolbar')

      // Pattern panel
      await page.goto(`${BASE_URL}/rostering/patterns`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: /new pattern/i }).click()
      await shoot(page, st, 'pattern-panel')

      // Trip booking panel: the first trip in the list, Bookings tab, Add participant
      await page.goto(`${BASE_URL}/trips`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.locator('a[href^="/trips/"]').first().click()
      await page.getByRole('tab', { name: /bookings/i }).click()
      await page.getByRole('button', { name: /add participant/i }).click()
      await shoot(page, st, 'trip-booking-panel')
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
