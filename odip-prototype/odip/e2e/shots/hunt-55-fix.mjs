// Captures and numeric checks for the two H55 messages: the Settings 409 that refuses switching group activities off (H55-2), and the staff form's stale-save 409 in the warning tone (H51F-N1).
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// The Settings GET is served here (the switch on) and its PUT routed to a 409; staff s-0001 comes from the mock with an updatedAt added and its PUT routed to a 409.
import path from 'node:path'
import { AU_CONTEXT, cropElement, fullPage, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const UPDATED_AT = '2026-11-01T03:04:05.123456Z'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin' })
const visibility = { hiddenAccommodation: false, hiddenVehicles: false, hiddenTrips: false, groupActivitiesEnabled: true, employmentHeroConnected: false }
const SETTINGS_MESSAGE = "Group activities can't be turned off while 2 activities are in progress or waiting for review. Finish and review them first, then try again."
const STAFF_MESSAGE = 'Someone else just changed this staff member. Reload the page to see their changes, then save again.'
const STATES = [{ name: '390', width: 390 }, { name: '1280', width: 1280 }]
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    for (const key of ['settings', 'staff']) {
      const tag = `${key} ${st.name}`
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: mobile ? 844 : 800 }, hasTouch: mobile, isMobile: mobile })
      const page = await context.newPage()
      await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
      page.on('pageerror', (e) => add(`page error [${tag}]`, e.message, false))
      await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
      await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
      await page.route(/\/api\/v1\/settings\/module-visibility$/, (r) => {
        if (r.request().method() === 'GET') return r.fulfill({ json: envelope(visibility) })
        return r.fulfill({ status: 409, json: { success: false, data: null, message: null, errors: [SETTINGS_MESSAGE] } })
      })
      await page.route(/\/api\/v1\/staff\/s-0001$/, async (r) => {
        if (r.request().method() === 'GET') {
          const res = await r.fetch()
          const body = await res.json()
          return r.fulfill({ response: res, json: { ...body, data: { ...body.data, updatedAt: UPDATED_AT } } })
        }
        if (r.request().method() !== 'PUT') return r.fallback()
        return r.fulfill({ status: 409, json: { success: false, data: null, message: null, errors: [STAFF_MESSAGE] } })
      })
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: 'Sign in as selected user' }).click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

      if (key === 'settings') {
        await page.goto(`${BASE_URL}/settings?section=workspace-visibility`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        const box = page.getByRole('checkbox', { name: 'Group activities' })
        await box.waitFor({ timeout: 60_000 })
        const section = page.locator('section[aria-labelledby]').filter({ has: box }).last()
        await box.uncheck()
        await page.getByRole('button', { name: 'Save changes' }).click()
        await page.getByRole('button', { name: 'Turn off' }).click()
        const msg = section.locator('[role="alert"]', { hasText: SETTINGS_MESSAGE })
        await msg.waitFor({ timeout: 30_000 })
        await msg.scrollIntoViewIfNeeded()
        const inView = await msg.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth })
        add(`refusal message visible without scrolling the section [${tag}]`, await msg.allTextContents(), (await msg.count()) === 1 && inView)
        add(`switch is back on after the refusal [${tag}]`, null, await box.isChecked())
        const overflow = await section.evaluate((d) => ({ scrollWidth: d.scrollWidth, clientWidth: d.clientWidth }))
        add(`no horizontal overflow in the section [${tag}]`, overflow, overflow.scrollWidth <= overflow.clientWidth)
        const fonts = await section.evaluate((d) => ({ msg: getComputedStyle(d.querySelector('[role="alert"]')).fontSize, existing: getComputedStyle(d.querySelector('[role="status"]')).fontSize }))
        add(`message font size equals the section's existing small text [${tag}]`, fonts, fonts.msg === fonts.existing)
        const r = await cropElement(page, section, path.join(OUT_DIR, `settings-switch-off-refused-${st.name}.png`), { hideChrome: true })
        add(r.overlap ? `crop holds the whole section [settings ${st.name}]` : `crop [settings ${st.name}]`, { clip: r.clip, box: r.box }, r.overlap?.pass ?? true)
        // No full page for Settings: its content scrolls inside the app frame, so the helper's document-height check cannot hold; the section crop above is the capture.
      } else {
        await page.goto(`${BASE_URL}/staff/s-0001/edit`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        const form = page.locator('form').first()
        await form.waitFor({ timeout: 60_000 })
        const nameBox = form.getByLabel(/First Name/).first()
        await nameBox.fill('Typed name')
        await form.getByRole('button', { name: /^Save$/ }).click()
        const wrap = form.locator('xpath=..')
        const callout = wrap.locator('[role="alert"]', { hasText: STAFF_MESSAGE })
        await callout.waitFor({ timeout: 30_000 })
        await callout.scrollIntoViewIfNeeded()
        const inView = await callout.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth })
        add(`409 message visible without scrolling [${tag}]`, await callout.allTextContents(), (await callout.count()) === 1 && inView)
        const cls = await callout.evaluate((e) => e.className)
        add(`callout uses the warning tone class the medication form uses [${tag}]`, cls, /warning-container/.test(cls))
        const overflow = await form.evaluate((d) => ({ scrollWidth: d.scrollWidth, clientWidth: d.clientWidth }))
        add(`no horizontal overflow in the form [${tag}]`, overflow, overflow.scrollWidth <= overflow.clientWidth)
        const r = await cropElement(page, wrap, path.join(OUT_DIR, `staff-stale-${st.name}.png`), { hideChrome: true })
        add(r.overlap ? `crop holds the whole form area [staff ${st.name}]` : `crop [staff ${st.name}]`, { clip: r.clip, box: r.box }, r.overlap?.pass ?? true)
        const fp = await fullPage(page, path.join(OUT_DIR, 'full', `staff-stale-${st.name}.png`))
        for (const c of fp.checks) add(c.name, c.detail, c.pass)
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
