// Retention 2b polish: the card dates carry labels at 390, and no "Kind N" item of the Records line splits across lines. Same mock-API setup as retention-2b.mjs.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/retention-polish.mjs <outdir>
// Captures list-2due-390, list-2due-1280 and list-2due-dark-390, plus due-align-390, due-align-1280 and due-align-dark-390 (the Estimated card, Due level with Starts). Prints "CHECK ok|FAIL name [ctx] = value"; exits 1 when a check fails.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' })
const NOW = '2026-11-06T10:00:00+11:00'
const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(measured)}`)
}

const browser = await chromium.launch({ headless: true })
const section = (page) => page.locator('section[aria-labelledby="data-retention-heading"]')

for (const [width, height, touch, scheme, file, alignFile] of [[390, 844, true, 'light', 'list-2due-390.png', 'due-align-390.png'], [1280, 800, false, 'light', 'list-2due-1280.png', 'due-align-1280.png'], [390, 844, true, 'dark', 'list-2due-dark-390.png', 'due-align-dark-390.png']]) {
  const ctx = `${width} ${scheme}`
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: scheme, reducedMotion: 'reduce' })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  page.on('pageerror', (e) => check('page error', ctx, e.message, false))
  try {
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/settings?tab=retention`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('heading', { level: 3, name: 'Due for purge' }).waitFor({ timeout: 60_000 })
    await page.getByText('Zoe Campbell').first().waitFor({ timeout: 30_000 })

    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('section[aria-labelledby="data-retention-heading"] tbody tr')]
      const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' }
      const labels = []
      const splits = []
      let items = 0
      for (const tr of rows) {
        for (const [col, word] of [['Retention starts', 'Starts'], ['Due for purge', 'Due']]) {
          const td = tr.querySelector(`td[data-label="${col}"]`)
          const lab = td && [...td.querySelectorAll('span')].find((s) => s.textContent.trim() === word)
          labels.push({ col, word, visible: !!lab && shown(lab) })
        }
        for (const it of tr.querySelectorAll('td[data-label="Records"] span.whitespace-nowrap')) {
          items++
          const tops = new Set([...it.getClientRects()].map((r) => Math.round(r.top)))
          if (tops.size > 1) splits.push(it.textContent)
        }
      }
      // The first Estimated card: its Due text must start on the Starts date's line.
      const est = rows.find((tr) => tr.querySelector('td[data-label="Retention starts"]')?.textContent.includes('Estimated'))
      const dateSpan = est?.querySelector('td[data-label="Retention starts"] span > span')
      const dueSpan = est?.querySelector('td[data-label="Due for purge"] span')
      const align = dateSpan && dueSpan ? { estimatedCard: est.getBoundingClientRect().top, startsTop: dateSpan.getBoundingClientRect().top, dueTop: dueSpan.getBoundingClientRect().top } : null
      return { rows: rows.length, align, labels, items, splits, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    })
    if (width === 390) check('a every date has a visible label', ctx, m.labels, m.rows >= 2 && m.labels.length === m.rows * 2 && m.labels.every((l) => l.visible))
    else check('a the labels are hidden at 1280 (the header row names the columns)', ctx, m.labels, m.labels.every((l) => !l.visible))
    if (width === 390) check('d Estimated card: Due top within 2px of the Starts date top', ctx, m.align, !!m.align && Math.abs(m.align.dueTop - m.align.startsTop) <= 2)
    check('b no kinds item is split across lines', ctx, { items: m.items, splits: m.splits }, m.items >= 6 && m.splits.length === 0)
    check('c no horizontal overflow', ctx, m.overflow, m.overflow <= 0)
    const r = await cropElement(page, section(page), path.join(OUT_DIR, file), { touch })
    checks.push(checkCropHolds(r))
    const r2 = await cropElement(page, section(page), path.join(OUT_DIR, alignFile), { touch })
    checks.push(checkCropHolds(r2))
  } catch (e) {
    check('script error', ctx, String(e.message).split('\n')[0], false)
  }
  await context.close()
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
