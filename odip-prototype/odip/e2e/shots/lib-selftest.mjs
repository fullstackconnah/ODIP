// Self-test for lib/capture.mjs, run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/lib-selftest.mjs <outdir> (an absolute script path)
// Crops one element taller than the 390 viewport at 1280 fine and 390 touch; asserts the crop holds it and the pointer stays coarse.
import path from 'node:path'
import { cropElement, fullPage, checkCropHolds, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const checks = []
const browser = await chromium.launch({ headless: true })
try {
  for (const vp of [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 390, touch: true }]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch })
    const page = await context.newPage()
    // The login page needs no sign-in. A 900px element is injected so it is taller than the 390 viewport; it grows after a delay to exercise settle.
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.evaluate(() => {
      const el = document.createElement('div')
      el.id = 'selftest-tall'
      el.style.cssText = 'height:10px;margin:40px 8px;background:linear-gradient(#cde,#fed);transition:height 300ms'
      document.body.prepend(el)
      setTimeout(() => { el.style.height = '900px' }, 100)
    })
    const r = await cropElement(page, page.locator('#selftest-tall'), path.join(OUT_DIR, `tall-${vp.name}.png`), { touch: !!vp.touch })
    checks.push(checkCropHolds(r))
    checks.push({ name: `element settled at full height [${vp.name}]`, pass: r.elementHeight >= 899, detail: { elementHeight: r.elementHeight } })
    if (vp.touch) checks.push({ name: 'pointer coarse after crop at 390 touch', pass: r.coarse, detail: { coarse: r.coarse } })
    const f = await fullPage(page, path.join(OUT_DIR, 'full', `page-${vp.name}.png`), { touch: !!vp.touch })
    checks.push(...f.checks)
    const after = page.viewportSize()
    checks.push({ name: `viewport restored [${vp.name}]`, pass: after.width === vp.width && after.height === vp.height, detail: after })
    await context.close()
  }
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
