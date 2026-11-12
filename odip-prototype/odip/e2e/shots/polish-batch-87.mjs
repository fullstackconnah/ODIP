// Captures and numeric checks for polish batch 87: (1) the Funding ledger "What" text keeps the last separator with its quantity (the space after the last "·" is a no-break space, built by BudgetLedgerService);
// (2) the Deleted records "Record" column wraps to at most 2 lines at lg+ instead of one line with an ellipsis.
// The mock serves the old ledger wording, so this script rewrites three of p-0002's ledger rows in the response (page.route) to the server's new strings (NBSP before the quantity).
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
import path from 'node:path'
import { AU_CONTEXT, cropElement, fullPage, layoutCheck, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const NOW = new Date('2026-11-09T10:00:00+11:00')
const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const CODE = '01_010_0107_1_1'
const NBSP = String.fromCharCode(160)
const DOT = String.fromCharCode(183)
const LEDGER_ROWS = [
  [`TC-4302-20261002 ${DOT} 04_Weekday_STD ${DOT} 8 h`, `TC-4302-20261002 ${DOT} ${CODE} ${DOT}${NBSP}1 each`],
  [`TC-4302-20261006 ${DOT} 04_Weekday_STD ${DOT} 8 h`, `TC-4302-20261006 ${DOT} ${CODE} ${DOT}${NBSP}2 each`],
  [`TC-4302-20261009 ${DOT} 04_Weekday_STD ${DOT} 6 h`, `TC-4302-20261009 ${DOT} ${CODE} ${DOT}${NBSP}1 night`],
]
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const held = (o) => Object.entries(o).map(([field, old]) => ({ field, old, new: null }))
const DELETED = [
  { id: 'd1', entityType: 'Shift', entityId: 'e-d1', deletedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(), deletedByName: 'Sam Lee', fields: held({ ServiceDate: '2026-11-10', StartTime: '09:00:00', EndTime: '15:00:00', Notes: 'Community access' }) },
  { id: 'd2', entityType: 'ParticipantRiskEntry', entityId: 'e-d2', deletedAt: new Date(NOW.getTime() - 90 * 60_000).toISOString(), deletedByName: 'Priya Nair', fields: held({ Description: 'Choking risk at mealtimes', Severity: 'High' }) },
]
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

// Lines of an element's text as the browser broke them: every character's rect, grouped by its top.
const LINES_FN = `(root) => {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), lines = []
  let top = null
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    for (let i = 0; i < n.length; i++) {
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1)
      const b = r.getClientRects()[0]; if (!b) continue
      if (top === null || Math.abs(b.top - top) > 4) { lines.push(''); top = b.top }
      lines[lines.length - 1] += n.data[i]
    }
  }
  return lines.map((l) => l.trim())
}`

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    await page.clock.setFixedTime(NOW)
    await page.route('**/participants/p-0002/funding/ledger', async (r) => {
      let body = await (await r.fetch()).text()
      for (const [from, to] of LEDGER_ROWS) body = body.split(from).join(to)
      await r.fulfill({ contentType: 'application/json', body })
    })
    await page.route('**/api/v1/audit/deleted**', (r) => r.fulfill({ json: envelope({ items: DELETED, totalCount: DELETED.length, page: 1, pageSize: 25 }) }))
    page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const btn = page.getByRole('button', { name: 'Sign in as selected user' })
      await btn.waitFor({ state: 'visible', timeout: 60_000 })
      await btn.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    } catch (e) { add(`sign-in [${st.name}]`, String(e.message).slice(0, 300), false); await context.close(); continue }

    // Item 2: the ledger What text.
    try {
      await page.goto(`${BASE_URL}/participants/p-0002?tab=funding`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const els = page.getByText(CODE)
      await els.first().waitFor({ state: 'visible', timeout: 60_000 })
      const one = els.first()
      const raw = await one.evaluate((el) => el.textContent)
      add(`ledger: the character before the quantity is U+00A0 [${st.name}]`, JSON.stringify(raw), raw.endsWith(`${DOT}${NBSP}1 each`) && raw.split(' ').length > 3)
      const lines = await one.evaluate(new Function(`return (${LINES_FN})`)())
      const lastDot = lines.map((l) => l.includes(DOT)).lastIndexOf(true)
      const bad = lines.filter((l, i) => i === lastDot && (l.endsWith(DOT) || l === DOT))
      add(`ledger: the last middle dot does not end a line (it may start one: the dot then leads its quantity) [${st.name}]`, lines, bad.length === 0)
      // Counterfactual sweep: the same text laid out at every width from 100 to 320 px, with the old plain space and with the NBSP.
      // The old wording must break beside the dot at some width, or the check above proves nothing; the new one must never.
      const sweep = await one.evaluate((el, [fnSrc, nbsp, dot]) => {
        const linesOf = new Function(`return (${fnSrc})`)()
        const cs = getComputedStyle(el)
        const run = (text) => {
          const probe = document.createElement('div')
          Object.assign(probe.style, { position: 'absolute', left: '-9999px', top: '0', font: cs.font, letterSpacing: cs.letterSpacing, overflowWrap: cs.overflowWrap, wordBreak: cs.wordBreak, whiteSpace: 'normal' })
          probe.textContent = text
          document.body.appendChild(probe)
          let n = 0
          for (let w = 100; w <= 320; w++) { probe.style.width = `${w}px`; const ls = linesOf(probe), last = ls.map((l) => l.includes(dot)).lastIndexOf(true); if (last >= 0 && (ls[last].endsWith(dot) || ls[last] === dot)) n++ }
          probe.remove()
          return n
        }
        return { plain: run(el.textContent.split(nbsp).join(' ')), nbsp: run(el.textContent) }
      }, [LINES_FN, NBSP, DOT])
      add(`ledger sweep: old plain-space wording breaks beside the dot at some width, the NBSP wording at none [${st.name}]`, sweep, sweep.plain > 0 && sweep.nbsp === 0)
      const group = one.locator('xpath=ancestor::div[./h4 or ./h5][1]')
      const lc = await cropElement(page, group, path.join(OUT_DIR, `ledger-each-${st.name}.png`), { touch: mobile, hideChrome: true, pad: 16 })
      add(`ledger crop holds [${st.name}]`, lc.overlap ?? null, lc.overlap?.pass !== false)
      checks.push(await layoutCheck(page, group, `ledger group [${st.name}]`))
    } catch (e) { add(`ledger scene ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false) }

    // Item 3: the Deleted records Record cell.
    try {
      await page.goto(`${BASE_URL}/settings?section=deleted-records`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByText('Choking risk at mealtimes').first().waitFor({ state: 'visible', timeout: 60_000 })
      const table = page.locator('table').first()
      if (!mobile) {
        const m = await table.locator('tbody tr').first().locator('td').first().evaluate((td) => {
          const span = td.firstElementChild, cs = getComputedStyle(span), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5
          return { text: span.innerText, lines: Math.round(span.getBoundingClientRect().height / lh), wide: span.scrollWidth > span.clientWidth + 1, tall: span.scrollHeight > span.clientHeight + 1, maxW: cs.maxWidth }
        })
        add(`deleted: row 1 Record shows whole, no ellipsis [${st.name}]`, m, !m.wide && !m.tall && !m.text.includes(String.fromCharCode(8230)))
        add(`deleted: row 1 Record is at most 2 lines [${st.name}]`, m, m.lines >= 1 && m.lines <= 2)
        const cols = await table.locator('thead th').allInnerTexts()
        add(`deleted: columns keep their order [${st.name}]`, cols, cols.join('|').replace(/\s+/g, ' ').startsWith('Record|Type|Deleted by|Deleted'))
        const tc = await cropElement(page, table, path.join(OUT_DIR, `deleted-records-${st.name}.png`), { touch: mobile, hideChrome: true, pad: 16 })
        add(`deleted crop holds [${st.name}]`, tc.overlap ?? null, tc.overlap?.pass !== false)
      }
      await page.waitForLoadState('networkidle').catch(() => {})
      // AppLayout's page height follows the viewport height on this short page (900 -> 1051, 1051 -> 1151, 1151 -> 1151), so fullPage's first measure at 900 under-reads it. Start from a window taller than the page.
      if (!mobile) await page.setViewportSize({ width: st.width, height: 1200 })
      await page.waitForTimeout(600)
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `deleted-page-${st.name}.png`), { touch: mobile })).checks)
    } catch (e) { add(`deleted scene ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false) }
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
