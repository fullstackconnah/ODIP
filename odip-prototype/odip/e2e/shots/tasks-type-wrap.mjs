// Tasks table at 1280: the longest Type label shows whole (wraps to at most 2 lines), no horizontal scroll. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/tasks-type-wrap.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, fullPage, cropElement, settle, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' })

// The two longest TASK_TYPE_LABELS: the first is the row we measure, the second shares the table.
const LONGEST = ['IncidentCommissionDetailedReport', 'RestrictivePracticeRegisterAddition']
const LABELS = ['NDIS Commission 5-day report', 'Restrictive practice register']

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

const browser = await chromium.launch({ headless: true })
try {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: 1280, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route(/\/api\/v1\/tasks(\?|$)/, async (route) => {
      const res = await route.fetch()
      const body = await res.json()
      const rows = body.data?.items ?? body.data ?? []
      LONGEST.forEach((t, i) => { if (rows[i]) rows[i].taskType = t })
      await route.fulfill({ response: res, json: body })
    })
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/tasks`, { waitUntil: 'networkidle', timeout: 120_000 })
    const table = page.locator('main table').first()
    await table.waitFor({ state: 'visible', timeout: 60_000 })
    await settle(page, table)

    for (const label of LABELS) {
      const cell = page.locator('tbody td[data-label="Type"]', { hasText: label }).first()
      check(`${scheme}: "${label}" row present`, await cell.count() > 0)
      if (!await cell.count()) continue
      const m = await cell.evaluate((td) => {
        const cs = getComputedStyle(td)
        const range = document.createRange(); range.selectNodeContents(td)
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5
        return { scrollWidth: td.scrollWidth, clientWidth: td.clientWidth, textHeight: range.getBoundingClientRect().height, lineHeight: lh, rowHeight: td.parentElement.getBoundingClientRect().height }
      })
      check(`${scheme}: "${label}" not truncated (scrollWidth <= clientWidth)`, m.scrollWidth <= m.clientWidth, m)
      check(`${scheme}: "${label}" text is at most 2 lines`, m.textHeight <= m.lineHeight * 2 + 1, m)
      check(`${scheme}: "${label}" row height <= 2 lines + cell padding`, m.rowHeight <= m.lineHeight * 2 + 24, m)
    }
    const sx = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    const wrapper = await table.evaluate((t) => { const w = t.closest('[class*="overflow"]') ?? t.parentElement; return { scrollWidth: w.scrollWidth, clientWidth: w.clientWidth } })
    check(`${scheme}: no page horizontal scroll at 1280`, sx.scrollWidth <= sx.clientWidth, sx)
    check(`${scheme}: table has no horizontal scroll`, wrapper.scrollWidth <= wrapper.clientWidth, wrapper)

    await cropElement(page, table, path.join(OUT_DIR, `tasks-table-${scheme}.png`), { pad: 16 })
    if (scheme === 'light') {
      const full = await fullPage(page, path.join(OUT_DIR, 'full', 'tasks-1280.png'))
      checks.push(...full.checks)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
