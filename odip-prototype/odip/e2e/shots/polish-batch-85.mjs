// Captures and numeric checks for polish batch 85: (1) the Claims hub Ready table shows up to three blocked-reason lines at md and up (md:line-clamp-3), the phone card unchanged;
// (2) the Funding ledger "What" column reads "N each" for a shift-less Each claim line, "1 night" for a sleepover shift, "N h" for an hourly line. The wording is built by the server (BudgetLedgerService,
// pinned by dotnet tests); the mock serves the old wording, so this script rewrites three of p-0002's ledger rows in the response (page.route) to show the layout of the real strings.
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

const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const CODE = '01_010_0107_1_1'
const LEDGER_ROWS = [
  ['TC-4302-20261002 · 04_Weekday_STD · 8 h', `TC-4302-20261002 · ${CODE} · 1 each`],
  ['TC-4302-20261006 · 04_Weekday_STD · 8 h', `TC-4302-20261006 · ${CODE} · 2 each`],
  ['TC-4302-20261009 · 04_Weekday_STD · 6 h', `TC-4302-20261009 · ${CODE} · 1 night`],
]
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
    await page.route('**/participants/p-0002/funding/ledger', async (r) => {
      let body = await (await r.fetch()).text()
      for (const [from, to] of LEDGER_ROWS) body = body.split(from).join(to)
      await r.fulfill({ contentType: 'application/json', body })
    })
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
        // A reason that needs 3 lines or fewer is shown whole: scrollHeight <= clientHeight on the clamped span (md:line-clamp-3). 4+ lines would clamp.
        const spans = await panel.locator('[id^="claims-why-"]').evaluateAll((els) => els.map((e) => ({ lines: Math.round(e.getBoundingClientRect().height / (parseFloat(getComputedStyle(e).lineHeight) || 20)), clipped: e.scrollHeight > e.clientHeight + 1 })))
        add(`reasons seen: ${spans.length}, a 3-line reason is not clipped [${st.name}]`, spans.filter((t) => t.lines >= 3).slice(0, 5), spans.length > 0 && spans.every((t) => t.lines > 3 || !t.clipped))
        add(`ready table does not scroll sideways [${st.name}]`, m, m.scrollW <= m.clientW + 1)
      }

      const crop = async (target) => {
        const c = await cropElement(page, target, path.join(OUT_DIR, `claims-ready-checks-${st.name}.png`), { touch: mobile, hideChrome: true, pad: 16 })
        add(`ready crop holds [${st.name}]`, c.overlap ?? null, c.overlap?.pass !== false)
      }
      if (!mobile) await crop(panel.locator('table').first())
      if (st.name !== '1536') {
        // The Blocked filter keeps the phone page under the helper's 4000 px cap (52 clean seed lines would not fit); the tab strip scrolls sideways by design (Tabs.tsx, flex-nowrap below md).
        await panel.getByRole('radio', { name: /^Blocked/ }).click()
        // The phone crop is the Blocked filter's TC-45004 card: a Ready card with no checks text showed nothing of the change.
        if (mobile) await crop(panel.getByRole('row').filter({ hasText: 'TC-45004' }).first())
        await page.evaluate(() => window.scrollTo(0, 0))
        const full = await fullPage(page, path.join(OUT_DIR, 'full', `claims-hub-${st.name}.png`), { touch: mobile, allow: ['[role="tablist"]'] })
        checks.push(...full.checks)
      }
    } catch (e) {
      add(`scenes ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false)
    }
    try {
      await page.goto(`${BASE_URL}/participants/p-0002?tab=funding`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const one = page.getByText(`${CODE} · 1 each`).first()
      await one.waitFor({ state: 'visible', timeout: 60_000 })
      const textOf = async (t) => (await page.getByText(t).first().innerText()).replace(/\s+/g, ' ')
      const eachRow = await textOf(`${CODE} · 1 each`), twoRow = await textOf(`${CODE} · 2 each`), nightRow = await textOf(`${CODE} · 1 night`)
      add(`ledger: shift-less Each row ends "· 1 each", no " h" [${st.name}]`, eachRow, eachRow.endsWith('· 1 each') && !/ h\b/.test(eachRow))
      add(`ledger: shift-less Each row of 2 ends "· 2 each" [${st.name}]`, twoRow, twoRow.endsWith('· 2 each'))
      add(`ledger: shift-linked Sleepover row still shows "1 night" [${st.name}]`, nightRow, nightRow.endsWith('1 night'))
      const group = one.locator('xpath=ancestor::div[./h4 or ./h5][1]')
      const lc = await cropElement(page, group, path.join(OUT_DIR, `ledger-each-${st.name}.png`), { touch: mobile, hideChrome: true, pad: 16 })
      add(`ledger crop holds [${st.name}]`, lc.overlap ?? null, lc.overlap?.pass !== false)
    } catch (e) {
      add(`ledger scene ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
