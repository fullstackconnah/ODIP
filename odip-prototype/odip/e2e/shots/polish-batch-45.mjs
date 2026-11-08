// Captures and numeric checks for polish batch 45 (H58-1, H58-5): the shift panel's override reason stops at the 2,000-character column cap, and Escape during an in-flight create leaves the panel open.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// The shift check is routed to one reason-required finding; the shift POST is routed to hang for the second scene.
import path from 'node:path'
import { AU_CONTEXT, cropElement, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin' })
const FINDING = { code: 'STAFF_ON_LEAVE', severity: 'Warning', message: 'Staff is on approved leave.', requiresReason: true }
const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

async function openPanel(page, hangSave) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/rostering/shifts/check', (r) => r.fulfill({ json: envelope([FINDING]) }))
  if (hangSave) {
    await page.route('**/api/v1/rostering/shifts', (r) => (r.request().method() === 'POST' ? new Promise(() => {}) : r.fallback()))
  }
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 60_000 })
  await page.getByRole('button', { name: /^New shift$/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: 30_000 })
  await dialog.getByRole('button', { name: /select a participant/i }).click()
  await page.getByRole('option').first().click()
  const reason = dialog.getByLabel(/reason for override/i)
  await reason.waitFor({ state: 'visible', timeout: 30_000 })
  await reason.scrollIntoViewIfNeeded()
  return { dialog, reason }
}

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const newContext = () => browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })

    // Scene 1: type 2,010 characters; the box keeps 2,000.
    {
      const context = await newContext()
      const page = await context.newPage()
      await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
      page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
      try {
        const { dialog, reason } = await openPanel(page, false)
        await reason.click()
        await page.keyboard.type('x'.repeat(2010), { delay: 0 })
        await page.waitForTimeout(400)
        const len = await reason.evaluate((el) => el.value.length)
        add(`reason textarea value length is 2000 after typing 2010 [${st.name}]`, len, len === 2000)
        const fit = await dialog.evaluate((d) => ({ scrollWidth: d.scrollWidth, clientWidth: d.clientWidth }))
        add(`no horizontal overflow in the panel [${st.name}]`, fit, fit.scrollWidth <= fit.clientWidth)
        const field = reason.locator('xpath=ancestor::div[1]')
        const c = await cropElement(page, field, path.join(OUT_DIR, `roster-reason-limit-${st.name}.png`), { touch: mobile, hideChrome: true })
        add(`crop [roster-reason-limit-${st.name}]`, { clip: c.clip, box: c.box }, c.overlap?.pass ?? true)
      } catch (e) {
        add(`reason-limit scene ran [${st.name}]`, String(e.message).split('\n')[0], false)
      }
      await context.close()
    }

    // Scene 2: Save hangs; Escape leaves the panel open.
    {
      const context = await newContext()
      const page = await context.newPage()
      await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
      page.on('pageerror', (e) => add(`page error [saving ${st.name}]`, e.message, false))
      try {
        const { dialog, reason } = await openPanel(page, true)
        await reason.fill('Approved by the coordinator')
        await dialog.getByRole('button', { name: /^Save with override$/ }).click()
        await dialog.getByRole('button', { name: /^Saving/ }).waitFor({ timeout: 15_000 })
        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)
        const open = await dialog.isVisible()
        const prompt = await page.getByRole('alertdialog').count()
        add(`panel still open 500 ms after Escape while saving [${st.name}]`, { open, discardPrompt: prompt }, open && prompt === 0)
        const c = await cropElement(page, dialog, path.join(OUT_DIR, `shift-panel-saving-escape-${st.name}.png`), { touch: mobile, hideChrome: true })
        add(`crop [shift-panel-saving-escape-${st.name}]`, { clip: c.clip, box: c.box }, c.overlap?.pass ?? true)
      } catch (e) {
        add(`saving-escape scene ran [${st.name}]`, String(e.message).split('\n')[0], false)
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
