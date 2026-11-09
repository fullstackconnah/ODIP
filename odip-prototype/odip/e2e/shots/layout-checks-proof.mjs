// Live test of layoutCheck (no app needed; set-content pages): three faulty fixtures give exactly their kind, a clean card gives none.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/layout-checks-proof.mjs <outdir>
import { layoutCheck, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const OUT_DIR = process.env.OUT_DIR
if (!OUT_DIR) throw new Error('OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const fixtures = {
  'inner-scroll': '<div style="width:768px;overflow-x:auto"><table><tr><td style="min-width:20rem">a</td><td style="min-width:20rem">b</td><td style="min-width:20rem">10/11/2026</td></tr></table></div>',
  'clipped-text': '<table style="table-layout:fixed;width:5ch"><tr><td style="overflow:hidden;white-space:nowrap">10/11/2026</td></tr></table>',
  'control-over-text': '<div style="position:relative;width:300px;height:60px"><p style="margin:0">Date 10/11/2026 and more words</p><button style="position:absolute;left:40px;top:0;width:120px;height:30px">Show details</button></div>',
  clean: '<div style="width:300px"><p style="margin:0">Date 10/11/2026</p><button style="margin-top:8px">Show details</button></div>',
}

const checks = []
const browser = await chromium.launch()
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  for (const [expected, html] of Object.entries(fixtures)) {
    await page.setContent(`<main>${html}</main>`)
    const r = await layoutCheck(page, page.locator('main'), expected)
    const kinds = [...new Set(r.detail.faults.map((f) => f.kind))]
    const want = expected === 'clean' ? [] : [expected]
    checks.push({ name: `fixture ${expected} gives ${want.join('') || 'no fault'}`, pass: kinds.length === want.length && kinds.every((k, i) => k === want[i]), detail: r.detail.faults })
  }
  await page.setContent(`<main>${fixtures['inner-scroll'].replace('<div ', '<div class="board" ')}</main>`)
  const skipped = await layoutCheck(page, page.locator('main'), 'allowed board', { allow: ['.board'] })
  checks.push({ name: 'allow skips a scroller and lists it', pass: skipped.pass && skipped.detail.allowed.length === 1, detail: skipped.detail })
} finally { await browser.close() }

if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
