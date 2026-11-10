// Live test of layoutCheck and fullPage (no app needed; set-content pages): faulty fixtures give exactly their kind, clean ones (a card, a truncated title beside a chip, a closed <details>, a transparent control, a modal dialog over a busy page) give none, and a fit-screen page holds unless main itself is cut off.
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
  // an open modal dialog lies over page text and controls behind its scrim: its button over the board text, and the board button over its title, pair across the dialog edge and are no fault
  'clean dialog over page text and controls': '<div style="position:relative;height:60px"><p style="margin:0">Board 10/11/2026</p><button style="position:absolute;left:300px;top:0;width:120px;height:30px">Board action</button><div style="position:fixed;inset:0;background:rgba(0,0,0,.5)"></div><div role="alertdialog" aria-modal="true" style="position:absolute;left:0;top:0;width:500px;height:50px;background:#fff"><p style="position:absolute;left:300px;top:5px;margin:0">Sheet title</p><button style="position:absolute;left:40px;top:0;width:120px;height:30px">Close</button></div></div>',
  // a control inside the dialog over text inside the dialog is still a fault
  'control-over-text inside an open dialog': '<div style="position:relative;height:60px"><p style="margin:0">Board 10/11/2026</p><div role="dialog" aria-modal="true" style="position:absolute;left:0;top:30px;width:300px;height:60px;background:#fff"><p style="margin:0">Date 10/11/2026 and more words</p><button style="position:absolute;left:40px;top:0;width:120px;height:30px">Show details</button></div></div>',
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

  // fullPage on a fit-screen page at 1440: the footer stays below the fold however far the viewport grows, so only main's own overflow decides (a column scrolling inside main scrolls by design)
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [key, name, html, pass] of [
    ['footer', 'fit-screen page with a footer holds', '<p style="margin:0">Board</p>', true],
    ['scroller', 'fit-screen page with an inner scroller taller than its box holds', '<div style="height:200px;overflow-y:auto"><div style="height:3000px">Board</div></div>', true],
    ['cut', 'fit-screen page whose main is cut off still fails', '<div style="height:6000px">Board</div>', false],
  ]) {
    await page.setContent(fit(html))
    const trunc = (await fullPage(page, path.join(OUT_DIR, 'full', `fit-${key}.png`))).checks.find((c) => c.name.startsWith('full page not truncated'))
    checks.push({ name: `fullPage: ${name}`, pass: trunc.pass === pass, detail: trunc.detail })
  }
} finally { await browser.close() }

if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
