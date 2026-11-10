// Live test of layoutCheck and fullPage (no app needed; set-content pages): faulty fixtures give exactly their kind, clean ones (a card, a truncated title beside a chip, a closed <details>, a transparent control) give none, and a fit-screen page with a footer holds.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/layout-checks-proof.mjs <outdir>
import path from 'node:path'
import { fullPage, layoutCheck, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

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
  // a truncate title whose full width runs under a neighbouring chip: only the visible part (0-60px) counts
  'clean truncated title beside a chip': '<div style="position:relative;width:60px;height:20px"><p style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Movie matinee with snacks</p><button style="position:absolute;left:70px;top:0">Go</button></div>',
  // the same title with the chip over its visible part is still a fault
  'control-over-text on the visible part of a truncated title': '<div style="position:relative;width:60px;height:20px"><p style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Movie matinee with snacks</p><button style="position:absolute;left:20px;top:0">Go</button></div>',
  'clean closed details': '<details><summary>Steps</summary><div style="position:relative"><p style="margin:0">Hidden text here</p><button style="position:absolute;left:0;top:0">Hidden</button></div></details>',
  'clean transparent control': '<div style="position:relative;width:300px;height:60px"><p style="margin:0">Date 10/11/2026 and more words</p><button style="position:absolute;left:40px;top:0;width:120px;height:30px;opacity:0">Show details</button></div>',
}

// A fit-screen page as the app builds it: main takes the viewport minus the header, the footer sits below the fold, [data-fit-screen] is inside main.
const fit = (inner) => `<style>body{margin:0}</style><header style="height:48px"></header><main style="height:calc(100dvh - 48px)"><div data-fit-screen style="height:100%">${inner}</div></main><footer style="height:97px"></footer>`

const checks = []
const browser = await chromium.launch()
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  for (const [key, html] of Object.entries(fixtures)) {
    await page.setContent(`<main>${html}</main>`)
    const r = await layoutCheck(page, page.locator('main'), key)
    const kinds = [...new Set(r.detail.faults.map((f) => f.kind))]
    const want = key.startsWith('clean') ? [] : [key.split(' ')[0]]
    checks.push({ name: `fixture ${key} gives ${want.join('') || 'no fault'}`, pass: kinds.length === want.length && kinds.every((k, i) => k === want[i]), detail: r.detail.faults })
  }
  await page.setContent(`<main>${fixtures['inner-scroll'].replace('<div ', '<div class="board" ')}</main>`)
  const skipped = await layoutCheck(page, page.locator('main'), 'allowed board', { allow: ['.board'] })
  checks.push({ name: 'allow skips a scroller and lists it', pass: skipped.pass && skipped.detail.allowed.length === 1, detail: skipped.detail })

  // fullPage on a fit-screen page at 1440: the footer stays below the fold however far the viewport grows, so only main's own overflow decides
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [name, html, pass] of [['fit-screen page with a footer holds', '<p style="margin:0">Board</p>', true], ['fit-screen page whose inner scroller is cut off still fails', '<div style="height:200px;overflow-y:auto"><div style="height:3000px">Board</div></div>', false]]) {
    await page.setContent(fit(html))
    const trunc = (await fullPage(page, path.join(OUT_DIR, 'full', `fit-${pass}.png`))).checks.find((c) => c.name.startsWith('full page not truncated'))
    checks.push({ name: `fullPage: ${name}`, pass: trunc.pass === pass, detail: trunc.detail })
  }
} finally { await browser.close() }

if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
