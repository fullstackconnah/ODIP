// Captures and numeric checks for polish batch 48 (H61-2, H46-1): a pasted shift note over 1,000 characters says it was shortened; a leave balance with no amount reads as a dash.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Sign-in is stubbed with page.route; the shift is the mock API's sh-next, made InProgress so notes open. H51F-N1 (staff conflict tone) was already fixed on main: no capture.
import path from 'node:path'
import { AU_CONTEXT, cropElement, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const WORKER = '00000000-0000-0000-0000-0000000000a1'
const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

async function open(browser, st, url, setup) {
  const mobile = st.width === 390
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
  page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
  await setup(page)
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.worker', role: 'SupportWorker', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: WORKER, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.worker', fullName: 'Dev Worker', role: 'SupportWorker', tenantName: 'Sample Support Co' }) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  return { context, page, mobile }
}

const noOverflow = async (page, label) => {
  const fit = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  add(`no horizontal overflow [${label}]`, fit, fit.scrollWidth <= fit.clientWidth)
}

const inProgressShift = async (page) => {
  await page.route('**/api/v1/portal/shifts/sh-next', async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data) {
      body.data.status = 'InProgress'
      const start = new Date(Date.now() - 2 * 3600_000).toISOString()
      body.data.completion = { id: 'sc-48', shiftId: 'sh-next', actualStart: start, actualEnd: null, timeZoneId: body.data.timeZoneId, geolocationDeclined: false, startWasManual: false, submittedByUserId: WORKER, submittedByName: 'Dev Worker', startedAt: start, submittedAt: null, reviewedByUserId: null, reviewedByName: null, reviewedAt: null, breaks: [], ...body.data.completion }
      body.data.breaks ??= []
    }
    await r.fulfill({ response, json: body })
  })
  await page.route(/\/api\/v1\/portal\/shifts\/[^/]+\/notes/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: envelope([]) }) : r.continue()))
}

const leaveScene = async (page) => {
  await page.route('**/api/v1/settings/module-visibility', async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    await r.fulfill({ json: { ...body, success: true, data: { ...(body?.data ?? {}), employmentHeroConnected: true } } })
  })
  await page.route('**/api/v1/portal/leave/balances', (r) => r.fulfill({ json: envelope({ status: 'Ready', balances: [
    { category: 'Annual leave', amount: 76, unit: 'Hours' }, { category: 'Long service leave', amount: null, unit: 'Hours' }, { category: 'Personal leave', amount: 0, unit: 'Hours' },
  ] }) }))
}

const browser = await chromium.launch({ headless: true })
let step = ''
try {
  for (const st of STATES) {
    // Scene 1: paste 1,500 characters into a new note; the box keeps 1,000 and a status line says so.
    try {
      step = 'open shift'
      const { context, page, mobile } = await open(browser, st, '/portal/shifts/sh-next', inProgressShift)
      step = 'notes tab'
      const tab = page.getByRole('tab', { name: /^Notes/ })
      const field = page.getByLabel('Add a note')
      await tab.or(field).first().waitFor({ state: 'visible', timeout: 60_000 })
      if (await tab.count()) await tab.click()
      await field.waitFor({ state: 'visible', timeout: 30_000 })
      await field.fill('x'.repeat(1500))
      await page.waitForTimeout(300)
      const len = await field.evaluate((el) => el.value.length)
      const status = page.getByRole('status').filter({ hasText: 'Note shortened to 1,000 characters' })
      add(`note value length is 1000 after pasting 1500 [${st.name}]`, len, len === 1000)
      add(`shortened status line is visible [${st.name}]`, await status.count(), await status.first().isVisible())
      await noOverflow(page, `note ${st.name}`)
      const form = field.locator('xpath=ancestor::form[1]')
      const c = await cropElement(page, form, path.join(OUT_DIR, `note-shortened-${st.name}.png`), { touch: mobile, hideChrome: true })
      add(`crop [note-shortened-${st.name}]`, { clip: c.clip, box: c.box }, c.overlap?.pass ?? true)
      await context.close()
    } catch (e) {
      add(`note scene ran [${st.name}]`, `${step}: ${String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500)}`, false)
    }

    // Scene 2: a balance with no amount shows a dash; zero stays 0.0 hours.
    try {
      step = 'open leave'
      const { context, page, mobile } = await open(browser, st, '/portal/leave', leaveScene)
      const section = page.getByRole('region', { name: 'Leave balances' })
      await section.waitFor({ state: 'visible', timeout: 60_000 })
      const text = await section.innerText()
      add(`unknown balance reads as a dash, zero stays 0.0 hours [${st.name}]`, text.replace(/\s+/g, ' ').slice(0, 200), /Long service leave\s*—/.test(text) && text.includes('0.0 hours') && text.includes('76.0 hours'))
      await noOverflow(page, `leave ${st.name}`)
      await section.scrollIntoViewIfNeeded()
      const c = await cropElement(page, section, path.join(OUT_DIR, `leave-balance-unknown-${st.name}.png`), { touch: mobile, hideChrome: true })
      add(`crop [leave-balance-unknown-${st.name}]`, { clip: c.clip, box: c.box }, c.overlap?.pass ?? true)
      await context.close()
    } catch (e) {
      add(`leave scene ran [${st.name}]`, `${step}: ${String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500)}`, false)
    }
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
