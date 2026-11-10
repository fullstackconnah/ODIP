// Claims hub file panel, polish batch 63: the Mark paid modal's amounts (a $0 and an over-total line start blank), and the import summary's "paid amounts differ" line.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/claims-batch-amounts.mjs <outdir>
// The mock API serves the files (mock-api/claimHub.js); the two POST answers are stubbed with page.route (synthetic rows). Exit 1 on any failed check.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, layoutCheck, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' })
// The Lines table scrolls sideways on purpose at 1280 (PB63-F2), so layoutCheck skips that scroller.
const LINES_SCROLLER = [String.raw`div.relative.md\:bg-\[var\(--color-card\)\]`]
const batchDto = (id, fileName, status, extra) => ({ id, fileName, status, createdAt: '2026-10-20T01:00:00Z', createdByName: 'Sam Lee', uploadedAt: '2026-10-21T01:00:00Z', uploadedByName: 'Jo Carter', resultsImportedAt: null, discardedAt: null, lineCount: 120, totalAmount: 16214.4, pending: 0, successful: 0, rejected: 0, withdrawn: 0, paid: 0, paidAmount: 0, ...extra })

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })
const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]

async function openPanel(browser, vp, fileId, routes) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await routes(page)
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/claims?tab=files&file=${fileId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  return { context, page }
}
const crop = async (page, locator, name, vp, pad = 16) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
const calloutOf = (page, textRe) => page.getByText(textRe).first().locator('xpath=ancestor::*[@role="status"][1]')
// The callout stays inside the viewport and none of its paragraphs overflow sideways.
const fitChecks = async (page, callout, ctx) => {
  const m = await callout.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { right: r.right, vw: document.documentElement.clientWidth, overP: [...el.querySelectorAll('p')].map((p) => p.scrollWidth - p.clientWidth), page: document.documentElement.scrollWidth - document.documentElement.clientWidth }
  })
  check(`${ctx}: callout inside the viewport`, m.right <= m.vw + 1, m)
  check(`${ctx}: no paragraph overflows sideways`, m.overP.every((o) => o <= 1), m.overP)
  check(`${ctx}: no horizontal page scroll`, m.page <= 0, m.page)
}

const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`

  // mark-paid-modal: Mark 6 lines as paid. The mock's first line was paid $0 and its second above its total, so both start blank; the rest hold the NDIA amount.
  try {
    const { context, page } = await openPanel(browser, vp, 'b-results', async () => {})
    await page.getByRole('button', { name: 'Mark 6 lines as paid' }).click({ timeout: 60_000 })
    const modal = page.getByRole('dialog').last()
    const input = (name) => modal.getByLabel(`Paid for ${name}`)
    await input('Ava Nguyen').waitFor({ state: 'visible', timeout: 30_000 })
    check(t('mark-paid-modal: the line paid $0 starts empty'), (await input('Ava Nguyen').inputValue()) === '', await input('Ava Nguyen').inputValue())
    check(t('mark-paid-modal: the line paid above its total starts empty'), (await input('Sam Lee').inputValue()) === '', await input('Sam Lee').inputValue())
    check(t('mark-paid-modal: a normal line holds its NDIA amount'), Number(await input('Jo Carter').inputValue()) === 135.12, await input('Jo Carter').inputValue())
    const hint = modal.getByText(/^Each amount starts at what the NDIA paid/)
    const hm = await hint.evaluate((el) => { const r = el.getBoundingClientRect(); return { over: el.scrollWidth - el.clientWidth, right: r.right, vw: document.documentElement.clientWidth, h: r.height } })
    check(t('mark-paid-modal: hint visible and unclipped'), (await hint.isVisible()) && hm.over <= 1 && hm.right <= hm.vw && hm.h > 0, hm)
    if (vp.touch) {
      const tapMin = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')))
      const hs = await Promise.all(['Ava Nguyen', 'Sam Lee', 'Jo Carter'].map(async (n) => (await input(n).boundingBox())?.height ?? 0))
      check(t('mark-paid-modal: each input is at least --tap-min'), tapMin > 0 && hs.every((h) => h >= tapMin), { tapMin, hs })
    }
    checks.push(await layoutCheck(page, modal, t('mark-paid-modal'), { allow: LINES_SCROLLER }))
    await crop(page, modal, `mark-paid-modal-${vp.name}.png`, vp, 0)
    await context.close()
  } catch (e) { check(t('mark-paid-modal ran'), false, String(e.message).split('\n')[0]) }

  // import-differs: 2 differ (plural, captured); 1 differs (singular); 0 (no line).
  for (const [n, capture] of [[2, true], [1, false], [0, false]]) {
    try {
      const { context, page } = await openPanel(browser, vp, 'b-uploaded', async (p) => {
        await p.route('**/api/v1/claim-batches/b-uploaded/results', (r) => r.fulfill({ json: envelope({ successful: 118, rejected: 2, unchanged: 0, leftAlone: 0, conflicts: [], unknownReferences: [], unreadRows: [], batch: batchDto('b-uploaded', 'BPR261028001.csv', 'Uploaded', { successful: 118, rejected: 2 }), amountDiffers: n }) }))
      })
      await page.getByLabel('Results file (.csv)').setInputFiles({ name: 'results.csv', mimeType: 'text/csv', buffer: Buffer.from('a') })
      await page.getByTestId('file-next-action').click({ timeout: 60_000 })
      const callout = calloutOf(page, /^118 successful/)
      await callout.waitFor({ state: 'visible', timeout: 30_000 })
      const text = await callout.innerText()
      const want = n === 2 ? '2 paid amounts differ from what was claimed.' : n === 1 ? '1 paid amount differs from what was claimed.' : null
      check(t(`import-differs ${n}: ${want ?? 'no differs line'}`), want ? text.includes(want) : !/differ/.test(text), text)
      if (capture) {
        await fitChecks(page, callout, t('import-differs'))
        await crop(page, callout, `import-differs-${vp.name}.png`, vp, 24)
        const panel = page.getByRole('dialog').first()
        checks.push(await layoutCheck(page, panel, t('import-differs panel'), { allow: LINES_SCROLLER }))
        await crop(page, panel, `import-differs-panel-${vp.name}.png`, vp, 0)
      }
      await context.close()
    } catch (e) { check(t(`import-differs ${n} ran`), false, String(e.message).split('\n')[0]) }
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
