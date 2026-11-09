// Claims hub file panel, polish batch 63: the paid result that names the lines left unpaid, and the import summary's "paid amounts differ" line.
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
const LONG_REF = 'TC-46003-20261001-A-LONGER-THAN-USUAL-REFERENCE-WITH-NO-SPACES-AT-ALL'
const LEFT_OUT = [
  { batchLineId: 'b-results-l1', claimReference: 'TC-46001-20261001', ndiaAmount: 0, lineTotal: 135.12 },
  { batchLineId: 'b-results-l2', claimReference: 'TC-46002-20261001', ndiaAmount: 500, lineTotal: 135.12 },
  { batchLineId: 'b-results-l3', claimReference: LONG_REF, ndiaAmount: 0, lineTotal: 135.12 },
]
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

  // paid-left-out: Mark 6 lines as paid, the server answers with three lines left unpaid (one long reference).
  try {
    const { context, page } = await openPanel(browser, vp, 'b-results', async (p) => {
      await p.route('**/api/v1/claim-batches/b-results/paid', (r) => r.fulfill({ json: envelope({ ...batchDto('b-results', 'BPR261020001.csv', 'ResultsImported', { successful: 6, rejected: 6, resultsImportedAt: '2026-10-22T01:00:00Z' }), leftOut: LEFT_OUT }) }))
    })
    await page.getByRole('button', { name: 'Mark 6 lines as paid' }).click({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Mark as paid' }).click()
    const callout = calloutOf(page, /^\d+ lines? need an amount:/)
    await callout.waitFor({ state: 'visible', timeout: 30_000 })
    const text = await callout.innerText()
    check(t('paid-left-out: says how many were marked'), text.includes('Marked 3 lines as paid.'), text)
    check(t('paid-left-out: names every left-out reference'), text.includes(`3 lines need an amount: TC-46001-20261001, TC-46002-20261001, ${LONG_REF}.`), text)
    const again = page.getByRole('button', { name: 'Mark 6 lines as paid' })
    check(t('paid-left-out: the Mark as paid button is still there'), await again.isEnabled(), '')
    if (vp.touch) { const h = (await again.boundingBox())?.height ?? 0; check(t('paid-left-out: button is a touch target (>= 44 px)'), h >= 44, h) }
    await fitChecks(page, callout, t('paid-left-out'))
    await crop(page, callout, `paid-left-out-${vp.name}.png`, vp, 24)
    const panel = page.getByRole('dialog').first()
    checks.push(await layoutCheck(page, panel, t('paid-left-out panel')))
    await crop(page, panel, `paid-left-out-panel-${vp.name}.png`, vp, 0)
    await context.close()
  } catch (e) { check(t('paid-left-out ran'), false, String(e.message).split('\n')[0]) }

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
        checks.push(await layoutCheck(page, panel, t('import-differs panel')))
        await crop(page, panel, `import-differs-panel-${vp.name}.png`, vp, 0)
      }
      await context.close()
    } catch (e) { check(t(`import-differs ${n} ran`), false, String(e.message).split('\n')[0]) }
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
