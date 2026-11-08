// Captures and numeric checks for the risk entry Delete gate (hunt 45 fix, H45-1): Delete only for Admin/Coordinator; SupportWorker keeps Edit; ReadOnly has no actions.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <path to this script> <outdir>
// Capture states: coordinator, supportworker, readonly
import path from 'node:path'
import { AU_CONTEXT, cropElement, fullPage, prepareOutDir, writeChecks, checkCropHolds } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role) => {
  const username = `dev.${role.toLowerCase()}`
  return {
    users: envelope([{ username, role, tenantName: 'Sample Support Co' }]),
    token: envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: `Dev ${role}`, role, tenantName: 'Sample Support Co' }),
  }
}
const DESC = 'Participant may leave the property unsupervised when distressed near the road.'
const entries = [{ id: 'risk-1', participantId: 'p-0003', atRiskParty: 'Participant', description: DESC, mitigationNotes: 'Keep the front gate latched and stay within arm\'s reach on outings.',
  isActive: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }]

const STATES = [
  { name: 'coordinator', role: 'Coordinator', deletes: 1, edits: 1 },
  { name: 'supportworker', role: 'SupportWorker', deletes: 0, edits: 1 },
  { name: 'readonly', role: 'ReadOnly', deletes: 0, edits: 0 },
]
const VIEWPORTS = [{ name: '390', width: 390, height: 844, touch: true }, { name: '1280', width: 1280, height: 900, touch: false }]

const checks = []
const add = (name, detail, pass) => { checks.push({ name, detail, pass: !!pass }); console.log(`[risk-delete-gate] ${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`) }

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    for (const st of STATES) {
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch })
      const page = await context.newPage()
      if (vp.touch) {
        const cdp = await context.newCDPSession(page)
        await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
      }
      page.on('pageerror', (e) => add(`page error ${st.name}-${vp.name}`, e.message, false))
      const { users, token } = login(st.role)
      await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: users }))
      await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: token }))
      await page.route(/\/api\/v1\/participants\/p-0003\/risk-entries(\?.*)?$/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: envelope(entries) }) : r.continue()))
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: 'Sign in as selected user' }).click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
      await page.goto(`${BASE_URL}/participants/p-0003?tab=health#risks`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const text = page.getByText(DESC)
      if (!(await text.isVisible().catch(() => false))) await page.getByRole('tab', { name: /Risks & practices/ }).or(page.getByRole('button', { name: /Risks & practices/ })).first().click({ timeout: 30_000 }).catch(() => {})
      await text.waitFor({ state: 'visible', timeout: 60_000 })
      const row = text.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]')
      const label = `${st.name}-${vp.name}`

      const deletes = await row.getByRole('button', { name: 'Delete', exact: true }).count()
      const edits = await row.getByRole('button', { name: 'Edit', exact: true }).count()
      add(`${label}: Delete buttons in the row = ${st.deletes}`, { deletes }, deletes === st.deletes)
      add(`${label}: Edit buttons in the row = ${st.edits}`, { edits }, edits === st.edits)

      const m = await row.evaluate((el) => {
        const probe = document.createElement('div')
        probe.style.cssText = 'position:absolute;visibility:hidden;height:var(--control-h-sm)'
        document.body.append(probe)
        const ctlSm = probe.getBoundingClientRect().height
        probe.remove()
        const buttons = [...el.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height)
        return { ctlSm, buttons, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
      })
      add(`${label}: every action button is at least --control-h-sm (${m.ctlSm}px, the size=sm row-action height; --tap-min is for content-sized controls) tall`, { heights: m.buttons }, m.buttons.every((h) => h + 0.5 >= m.ctlSm))
      add(`${label}: no horizontal overflow on the row`, { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth }, m.scrollWidth <= m.clientWidth)

      const r = await cropElement(page, row, path.join(OUT_DIR, `${st.name}-${vp.name}.png`), { touch: vp.touch, hideChrome: true })
      checks.push(checkCropHolds(r))
      if (st.name === 'supportworker') checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `supportworker-page-${vp.name}.png`), { touch: vp.touch })).checks)
      await context.close()
    }
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
