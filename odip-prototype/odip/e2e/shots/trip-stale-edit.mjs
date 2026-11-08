// Captures and numeric checks for the stale trip edit refusal (H44-7): the Edit Trip form keeps the typed values and shows the server's 409 message in its error callout.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Trip t-0001 comes from the mock API; the trip PUT is routed to a 409 with the server's exact message.
import path from 'node:path'
import { AU_CONTEXT, cropElement, fullPage, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const MESSAGE = 'Someone else changed this trip while you were editing. Close it and open it again to see their changes.'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator' })

const STATES = [{ name: '390', width: 390 }, { name: '1280', width: 1280 }]
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: mobile ? 844 : 800 }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-11-06T10:00:00+11:00'))
    page.on('pageerror', (e) => add(`page error ${st.name}`, e.message, false))
    let putBody = null
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route(/\/api\/v1\/trips\/t-0001$/, (r) => {
      if (r.request().method() !== 'PUT') return r.fallback()
      putBody = r.request().postDataJSON()
      return r.fulfill({ status: 409, json: { success: false, data: null, message: null, errors: [MESSAGE] } })
    })
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/trips/t-0001`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Edit', exact: true }).click({ timeout: 60_000 })
    const dialog = page.getByRole('dialog', { name: 'Edit Trip' })
    await dialog.waitFor({ timeout: 30_000 })
    const name = dialog.getByLabel(/Trip Name/)
    await name.fill('Typed trip name')

    const crop = async (file) => {
      const r = await cropElement(page, dialog, path.join(OUT_DIR, file), { hideChrome: true })
      add(r.overlap ? `crop holds the whole dialog [${file}]` : `crop [${file}]`, { clip: r.clip, box: r.box }, r.overlap?.pass ?? true)
    }
    await crop(`trip-form-normal-${st.name}.png`)

    await dialog.getByRole('button', { name: 'Save' }).click()
    const callout = dialog.locator('[role="alert"]')
    await callout.waitFor({ timeout: 30_000 })
    add(`PUT carried expectedUpdatedAt [${st.name}]`, putBody?.expectedUpdatedAt, typeof putBody?.expectedUpdatedAt === 'string')
    add(`message sits in the existing error callout (dialog [role="alert"]) [${st.name}]`, await callout.allTextContents(), (await callout.count()) === 1 && (await callout.textContent()).includes(MESSAGE))
    add(`form stays open with the typed value [${st.name}]`, await name.inputValue(), (await name.inputValue()) === 'Typed trip name')
    const form = await dialog.evaluate((d) => {
      const scrollers = [d, ...d.querySelectorAll('*')].filter((e) => getComputedStyle(e).overflowX !== 'visible' && e.clientWidth)
      return { dialog: { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth }, wide: scrollers.filter((e) => e.scrollWidth > e.clientWidth).map((e) => e.tagName) }
    })
    add(`no horizontal overflow in the form [${st.name}]`, form, form.dialog.scrollWidth <= form.dialog.clientWidth && form.wide.length === 0)
    await callout.scrollIntoViewIfNeeded()
    await crop(`trip-form-stale-${st.name}.png`)
    const f = await fullPage(page, path.join(OUT_DIR, 'full', `trip-form-stale-${st.name}.png`))
    for (const c of f.checks) add(c.name, c.detail, c.pass)
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
