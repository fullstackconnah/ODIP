// Captures and numeric checks for polish batch 82: the Claims hub Ready table keeps the Checks column's room at 1280 and 1536 (DataTable minWidth 16rem, md and up), and the phone card is unchanged.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Admin sign-in; the mock seed's Mia Chen line is blocked with two reasons, a clean line passes.
import path from 'node:path'
import { AU_CONTEXT, cropElement, fullPage, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }, { name: '1536', width: 1536, height: 900 }]
const REASON = 'Price is over the limit of $67.56'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin' })
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
    page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const btn = page.getByRole('button', { name: 'Sign in as selected user' })
      await btn.waitFor({ state: 'visible', timeout: 60_000 })
      await btn.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
      await page.goto(`${BASE_URL}/claims`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const panel = page.getByTestId('claims-panel-ready')
      const reason = panel.getByText(REASON).first()
      await reason.waitFor({ state: 'visible', timeout: 60_000 })

      const m = await reason.evaluate((el) => {
        const cell = el.closest('td'), row = el.closest('tr')
        const scroller = cell.closest('.overflow-x-auto') ?? cell.closest('table').parentElement
        const cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5
        const pass = [...document.querySelectorAll('[data-testid="claims-panel-ready"] [data-pass]')][0]?.closest('td')
        return {
          cellW: cell.getBoundingClientRect().width, rowW: row.getBoundingClientRect().width, basis: getComputedStyle(cell).flexBasis,
          lines: Math.round(el.getBoundingClientRect().height / lh), scrollW: scroller.scrollWidth, clientW: scroller.clientWidth,
          passDisplay: pass ? getComputedStyle(pass).display : null,
        }
      })
      if (mobile) {
        add(`390: Checks line is full width (basis-full) [${st.name}]`, m, m.basis === '100%' && m.cellW >= m.rowW * 0.8)
        add(`390: a passing line shows no Checks line [${st.name}]`, m.passDisplay, m.passDisplay === 'none')
      } else {
        add(`Checks cell of a blocked line is at least 16rem (256 px) [${st.name}]`, m, m.cellW >= 256)
        add(`blocked reason is at most 3 lines [${st.name}]`, m, m.lines <= 3)
        add(`ready table does not scroll sideways [${st.name}]`, m, m.scrollW <= m.clientW + 1)
      }

      const table = panel.locator('table').first()
      const target = mobile ? panel.getByRole('row').filter({ hasText: 'Mia Chen' }).first() : table
      const c = await cropElement(page, target, path.join(OUT_DIR, `claims-ready-checks-${st.name}.png`), { touch: mobile, hideChrome: true, pad: 16 })
      add(`ready crop holds [${st.name}]`, c.overlap ?? null, c.overlap?.pass !== false)
      if (st.name !== '1536') {
        // The Blocked filter keeps the phone page under the helper's 4000 px cap (52 clean seed lines would not fit); the tab strip scrolls sideways by design (Tabs.tsx, flex-nowrap below md).
        await panel.getByRole('radio', { name: /^Blocked/ }).click()
        await page.evaluate(() => window.scrollTo(0, 0))
        const full = await fullPage(page, path.join(OUT_DIR, 'full', `claims-hub-${st.name}.png`), { touch: mobile, allow: ['[role="tablist"]'] })
        checks.push(...full.checks)
      }
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
