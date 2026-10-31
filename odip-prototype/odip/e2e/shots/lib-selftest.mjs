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
// checkCropHolds must judge the clip itself: a hand-made cut crop must fail, a whole one must pass.
const whole = { file: 'x.png', clip: { x: 0, y: 0, width: 110, height: 140 }, box: { x: 10, y: 20, width: 80, height: 100 }, viewport: { width: 200, height: 200 }, pad: 16, coarse: true, touch: true }
checks.push({ name: 'checkCropHolds passes a whole crop', pass: checkCropHolds(whole).pass, detail: {} })
checks.push({ name: 'checkCropHolds fails a crop 20px short', pass: !checkCropHolds({ ...whole, clip: { ...whole.clip, height: 120 } }).pass, detail: {} })
checks.push({ name: 'checkCropHolds fails a clip beyond the viewport', pass: !checkCropHolds({ ...whole, viewport: { width: 200, height: 100 } }).pass, detail: {} })
checks.push({ name: 'checkCropHolds fails an element wider than the viewport', pass: (() => { const r = checkCropHolds({ ...whole, box: { x: 10, y: 20, width: 300, height: 100 }, clip: { x: 0, y: 4, width: 200, height: 132 } }); return !r.pass && r.detail.overflowX === true })(), detail: {} })
const browser = await chromium.launch({ headless: true })
try {
  for (const vp of [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 390, touch: true }]) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch })
    const page = await context.newPage()
    // The login page needs no sign-in. A 900px element is injected so it is taller than the 390 viewport; it grows after a delay to exercise settle.
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.evaluate(() => {
      document.body.innerHTML = '<main></main>' // drop the login page: its viewport-height layout would make fullPage chase its own tail
      const el = document.createElement('div')
      el.id = 'selftest-tall'
      el.style.cssText = 'height:10px;margin:40px 8px;background:linear-gradient(#cde,#fed);transition:height 300ms'
      document.querySelector('main').append(el)
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
    if (vp.touch) {
      // An element wider than the viewport must fail the check, and the crop must not widen the viewport (that would shoot another breakpoint).
      await page.evaluate(() => {
        const w = document.createElement('div')
        w.id = 'selftest-wide'
        w.style.cssText = 'width:600px;height:40px;margin:8px;background:#cde'
        document.querySelector('main').append(w)
      })
      const wide = await cropElement(page, page.locator('#selftest-wide'), path.join(OUT_DIR, 'wide-390.png'), { touch: true })
      const c = checkCropHolds(wide)
      checks.push({ name: 'wide element keeps the 390 viewport and fails the crop check with overflowX', pass: wide.viewport.width === 390 && !c.pass && c.detail.overflowX === true, detail: { viewport: wide.viewport, overflowX: c.detail.overflowX } })
    }
    await context.close()
  }
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
