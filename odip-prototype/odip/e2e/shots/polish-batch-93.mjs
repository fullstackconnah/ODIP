// Captures and numeric checks for polish batch 93: (1) an unscoped SuperAdmin's dashboard asks for an organisation and never requests /dashboard/summary;
// (2) the witness statement count hint (hidden under 3,600; "n / 4,000" from 3,600; the limit line at 4,000, in the house warning text token).
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
import path from 'node:path'
import { AU_CONTEXT, cropElement, fullPage, layoutCheck, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const NOW = new Date('2026-11-12T10:00:00+11:00')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username, tenantId) => ({
  users: envelope([{ username, role, tenantName: 'Sample Support Co' }]),
  login: envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId }),
})
const SUPER = login('SuperAdmin', 'dev.super', null)
const WORKER = login('SupportWorker', 'dev.worker', 'tenant-0001')
const WITNESS = {
  id: 'witness-1', sourceType: 'Incident', participantId: 'participant-1', participantName: 'Sophie Brown', medicationId: null, medicationName: null, strength: null,
  doseDescription: null, doseGiven: null, incidentReportId: 'incident-1', incidentTitle: 'Slip near pool', incidentType: 'PropertyDamage', incidentSeverity: 'Medium',
  recordedByName: 'Alex Rivera', administeredAt: null, administeredAtTimeZone: null, incidentDateTime: '2026-11-11T08:05:00Z',
}
const LIMIT_LINE = "4,000 / 4,000. That's the limit, so check the end of your statement."
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

async function signIn(page, who) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: who.users }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: who.login }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}

const browser = await chromium.launch({ headless: true })
try {
  for (const st of [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]) {
    const mobile = st.width === 390
    // Item 1: an unscoped SuperAdmin on the dashboard.
    {
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
      const page = await context.newPage()
      await page.clock.setFixedTime(NOW)
      const summaryRequests = []
      page.on('request', (r) => { if (r.url().includes('/dashboard/summary')) summaryRequests.push(r.url()) })
      page.on('pageerror', (e) => add(`page error [dashboard ${st.name}]`, e.message, false))
      try {
        await signIn(page, SUPER)
        await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        const line = page.getByText('Choose an organisation to see its dashboard.')
        await line.waitFor({ state: 'visible', timeout: 60_000 })
        await page.waitForLoadState('networkidle').catch(() => {})
        add(`dashboard-noorg: the line is visible [${st.name}]`, await line.count(), await line.isVisible())
        const alerts = await page.getByRole('alert').count()
        add(`dashboard-noorg: no alert role element [${st.name}]`, alerts, alerts === 0)
        add(`dashboard-noorg: zero requests to /dashboard/summary [${st.name}]`, summaryRequests, summaryRequests.length === 0)
        if (!mobile) await page.setViewportSize({ width: st.width, height: 1200 })
        await page.waitForTimeout(600)
        checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `dashboard-noorg-${st.name}.png`), { touch: mobile })).checks)
      } catch (e) { add(`dashboard scene ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false) }
      await context.close()
    }
    // Item 2: the witness statement hint (390 only, as the brief asks).
    if (!mobile) continue
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: true, isMobile: true })
    const page = await context.newPage()
    await page.clock.setFixedTime(NOW)
    page.on('pageerror', (e) => add(`page error [witness ${st.name}]`, e.message, false))
    await page.route('**/api/v1/portal/witness-requests', (r) => r.fulfill({ json: envelope([WITNESS]) }))
    try {
      await signIn(page, WORKER)
      await page.goto(`${BASE_URL}/portal/witness-approvals`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: /approve/i }).first().click({ timeout: 60_000 })
      const dialog = page.getByRole('alertdialog')
      const field = dialog.getByLabel(/witness statement/i)
      await field.waitFor({ state: 'visible', timeout: 30_000 })
      const hint = dialog.locator('#witness-statement-hint')
      const label = field.locator('xpath=ancestor::label[1]')
      // The house field hint (FormField's text-xs): a probe with the same class gives the size to match.
      const houseSize = await page.evaluate(() => { const p = document.createElement('p'); p.className = 'text-xs'; document.body.appendChild(p); const s = getComputedStyle(p).fontSize; p.remove(); return s })
      for (const [n, file] of [[3599, null], [3612, 'witness-hint'], [4000, 'witness-limit']]) {
        await field.fill('a'.repeat(n))
        await page.waitForTimeout(150)
        const text = (await hint.textContent()) ?? ''
        const m = await hint.evaluate((el) => { const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return { size: cs.fontSize, color: cs.color, right: r.right } })
        const f = await field.evaluate((el) => ({ right: el.getBoundingClientRect().right }))
        if (n === 3599) { add(`witness: 3,599 characters show no hint text [${st.name}]`, JSON.stringify(text), text === ''); continue }
        if (n === 3612) {
          add(`witness: hint is "3,612 / 4,000" [${st.name}]`, JSON.stringify(text), text === '3,612 / 4,000')
          add(`witness: hint font size equals the house field hint (text-xs = ${houseSize}) [${st.name}]`, m.size, m.size === houseSize)
        } else {
          add(`witness: 4,000 shows the limit line [${st.name}]`, JSON.stringify(text), text === LIMIT_LINE)
          add(`witness: limit line stays inside the field's width [${st.name}]`, { hintRight: m.right, fieldRight: f.right }, m.right <= f.right + 0.5)
          add(`witness: buttons stay enabled at the limit [${st.name}]`, null, await dialog.getByRole('button', { name: /^approve$/i }).isEnabled())
        }
        const live = await hint.getAttribute('aria-live'), describedby = await field.getAttribute('aria-describedby')
        add(`witness: hint is aria-live polite and the field is described by it (${n}) [${st.name}]`, { live, describedby }, live === 'polite' && describedby === 'witness-statement-hint')
        const c = await cropElement(page, label, path.join(OUT_DIR, `${file}-${st.name}.png`), { touch: true, hideChrome: true, pad: 16 })
        add(`witness crop holds (${n}) [${st.name}]`, c.overlap ?? null, c.overlap?.pass !== false)
        checks.push(await layoutCheck(page, label, `witness label (${n}) [${st.name}]`))
      }
    } catch (e) { add(`witness scene ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false) }
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
