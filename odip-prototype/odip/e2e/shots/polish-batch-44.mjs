// Captures and numeric checks for the booking edit dialog (H57-1, H57-3): a 400 from ASP.NET's default validation (errors OBJECT) shows the server's sentence, and closing with unsaved edits asks first.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// The mock serves booking b-0001; its PUT is routed to a 400 with the exact ValidationProblemDetails body.
import path from 'node:path'
import { AU_CONTEXT, cropElement, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const MESSAGE = 'The field Notes must be a string with a maximum length of 4000.'
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
    await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
    page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route(/\/api\/v1\/bookings\/b-0001$/, (r) => {
      if (r.request().method() !== 'PUT') return r.fallback()
      return r.fulfill({ status: 400, json: { title: 'One or more validation errors occurred.', status: 400, errors: { Notes: [MESSAGE] } } })
    })
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/trips/t-0001?tab=bookings`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTitle('Edit booking').first().click()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Edit Booking' })
    const notes = dialog.getByPlaceholder('Optional notes...')
    await notes.waitFor({ timeout: 60_000 })
    await notes.fill('Typed note')
    await dialog.getByRole('button', { name: 'Save' }).click()
    const msg = page.getByRole('alert').filter({ hasText: MESSAGE })
    await msg.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(600) // let the scroll-into-view settle
    add(`alert text equals the server sentence [${st.name}]`, await msg.innerText(), (await msg.innerText()).trim() === MESSAGE)

    // The sentence (role=alert) sits inside the dialog's visible area with no inner scrolling needed to read it, and nothing overflows sideways.
    const fit = await msg.evaluate((el) => {
      const dlg = el.closest('[role="dialog"]')
      const r = el.getBoundingClientRect()
      const d = dlg.getBoundingClientRect()
      let scroller = el.parentElement
      while (scroller && scroller !== dlg && scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller.parentElement
      const foot = [...dlg.querySelectorAll('div')].find((x) => getComputedStyle(x).position === 'sticky')
      const footTop = foot ? foot.getBoundingClientRect().top : d.bottom
      return { footTop, top: r.top, bottom: r.bottom, dialogTop: d.top, dialogBottom: d.bottom, viewport: innerHeight, scrolls: !!scroller && scroller !== dlg, scrollWidth: dlg.scrollWidth, clientWidth: dlg.clientWidth }
    })
    add(`server message visible inside the dialog [${st.name}]`, fit, fit.top >= 0 && fit.bottom <= fit.viewport && fit.top >= fit.dialogTop && fit.bottom <= fit.dialogBottom && fit.bottom <= fit.footTop)
    add(`no horizontal overflow in the dialog [${st.name}]`, { scrollWidth: fit.scrollWidth, clientWidth: fit.clientWidth }, fit.scrollWidth <= fit.clientWidth)
    add(`connection fallback not shown [${st.name}]`, null, (await dialog.getByText(/check your connection/i).count()) === 0)
    // The whole dialog as the user sees it after Save: the panel scrolls, so at 390 the title may be scrolled off while the message shows.
    const titleBox = await dialog.getByText(/^Edit Booking/).first().boundingBox()
    add(`dialog title in the crop (info; false = scrolled off at 390) [${st.name}]`, titleBox, true)
    const v = await cropElement(page, dialog, path.join(OUT_DIR, `booking-edit-validation-${st.name}.png`), { hideChrome: true })
    add(`crop [booking-edit-validation-${st.name}]`, { clip: v.clip, box: v.box }, v.overlap?.pass ?? true)

    // Escape with unsaved edits asks first (the save is no longer pending: the 400 came back).
    await page.keyboard.press('Escape')
    const prompt = page.getByRole('alertdialog').or(page.getByRole('dialog')).filter({ hasText: 'Discard changes?' }).last()
    await prompt.waitFor({ timeout: 10_000 })
    const tapMin = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')) || 0)
    await page.waitForTimeout(600) // the prompt scales in; measure it at rest
    const heights = await prompt.getByRole('button', { name: /^(Keep editing|Discard)$/ }).evaluateAll((bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height)))
    const need = mobile ? tapMin : 0
    add(`discard prompt buttons >= --tap-min (${need}px) [${st.name}]`, { tapMin, heights }, heights.length === 2 && heights.every((h) => h >= need) && (!mobile || tapMin > 0))
    add(`edit dialog still open behind the prompt [${st.name}]`, null, await notes.isVisible())
    const p = await cropElement(page, prompt, path.join(OUT_DIR, `booking-edit-discard-${st.name}.png`), { hideChrome: true })
    add(`crop [booking-edit-discard-${st.name}]`, { clip: p.clip, box: p.box }, p.overlap?.pass ?? true)
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
