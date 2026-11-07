// Self-check for overlapCheck's bottom corners and hideChrome's transition:none (no app needed; set-content pages).
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/capture-helper-selfcheck.mjs <outdir>
import path from 'node:path'
import { cropElement, overlapCheck, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const OUT_DIR = process.env.OUT_DIR
if (!OUT_DIR) throw new Error('OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const checks = []
const browser = await chromium.launch()
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  const target = page.locator('#t')
  const probe = async (name, opts) => {
    const r = await cropElement(page, target, path.join(OUT_DIR, `${name}.png`), { ...opts, during: (clip) => overlapCheck(target, clip, `${name}.png`) })
    return r.measured
  }
  const shell = (extra) => `<main><div id="t" style="margin:100px 300px;height:100px;background:#cde">target</div></main>${extra}`
  // the bar covers the block's bottom 20 px only (y 180-200), so the centre (y 150) is clear
  const bar = (style) => `<div style="position:fixed;left:0;right:0;top:180px;height:60px;background:#333;${style}"></div>`

  await page.setContent(shell(bar('')))
  const over = await probe('bottom-bar-covers', {})
  checks.push({ name: 'overlapCheck fails a fixed bar over the bottom 20px', pass: !over.pass && over.detail.covered && over.detail.point !== 'centre', detail: over.detail })

  await page.setContent(shell(''))
  const clear = await probe('nothing-over', {})
  checks.push({ name: 'overlapCheck passes a block with nothing over it', pass: clear.pass, detail: clear.detail })

  await page.setContent(shell(bar('transition:all 400ms')))
  const hidden = await probe('bar-transition-hidden', { hideChrome: true })
  checks.push({ name: 'hideChrome beats a transition-all bar with no wait', pass: hidden.pass, detail: hidden.detail })
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
