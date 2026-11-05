// Self-test for lib/capture.mjs, run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/lib-selftest.mjs <outdir> (an absolute script path)
// Crops one element taller than the 390 viewport at 1280 fine and 390 touch; asserts the crop holds it and the pointer stays coarse.
import path from 'node:path'
import { cropElement, fullPage, checkCropHolds, overlapCheck, waitForSidebar, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

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
  // overlapCheck and hideChrome on set-content pages (no app needed): the target sits at y 100-160, 1280 wide.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const target = page.locator('#t')
  const probe = async (name, opts) => {
    const r = await cropElement(page, target, path.join(OUT_DIR, `${name}.png`), { ...opts, during: (clip) => overlapCheck(target, clip, `${name}.png`) })
    return r.measured
  }
  const shell = (extra) => `<main><div id="t" style="margin:100px 300px;height:60px;background:#cde">target</div></main>${extra}`
  await page.setContent(shell('<div style="position:fixed;left:0;right:0;top:90px;height:80px;background:#333"></div>'))
  const over = await probe('overlap-fixed-chrome', {})
  checks.push({ name: 'overlapCheck fails when fixed chrome covers the crop', pass: !over.pass && over.detail.covered, detail: over.detail })
  const hidden = await probe('overlap-hidden-chrome', { hideChrome: true })
  checks.push({ name: 'overlapCheck passes with hideChrome', pass: hidden.pass, detail: hidden.detail })
  const restored = await page.evaluate(() => [...document.querySelectorAll('div')].every((d) => d.style.visibility !== 'hidden'))
  checks.push({ name: 'hideChrome restores the chrome after the shot', pass: restored, detail: { restored } })
  const dialogCase = async (name, html, label, expectPass) => {
    await page.setContent(html)
    const r = await probe(name, {})
    checks.push({ name: label, pass: r.pass === expectPass, detail: r.detail })
  }
  await dialogCase('overlap-in-dialog-plain', `<main></main><div role="dialog" style="position:fixed;inset:0;background:#fff"><div id="t" style="margin:100px 300px;height:60px;background:#cde">target</div></div>`, 'overlapCheck passes a target in a plain dialog', true)
  await dialogCase('overlap-in-dialog-cover', `<main></main><div role="dialog" style="position:fixed;inset:0;background:#fff"><div id="t" style="margin:100px 300px;height:60px;background:#cde">target</div><div style="position:absolute;left:0;right:0;top:90px;height:80px;background:#333"></div></div>`, 'overlapCheck fails a positioned cover inside the dialog', false)
  await dialogCase('overlap-in-dialog-sticky', `<main></main><div role="dialog" style="position:fixed;inset:0;background:#fff"><div id="t" style="margin:100px 300px;height:60px;background:#cde">target</div><div style="position:sticky;left:0;right:0;top:90px;height:80px;margin-top:-170px;background:#333"></div></div>`, 'overlapCheck fails a sticky dialog footer over the target', false)
  await dialogCase('overlap-in-dialog-element', `<main></main><dialog open style="position:fixed;inset:0;margin:0;width:100%;height:100%;border:0;padding:0"><div id="t" style="margin:100px 300px;height:60px;background:#cde">target</div></dialog>`, 'overlapCheck passes a target in an open <dialog>', true)
  await page.setContent(shell('<footer style="position:sticky;top:90px;height:80px;margin-top:-170px;background:#333"></footer>'))
  const stickyFoot = await probe('overlap-sticky-footer', { hideChrome: true })
  const footBack = await page.evaluate(() => document.querySelector('footer').style.visibility !== 'hidden')
  checks.push({ name: 'hideChrome hides a sticky page footer during the shot and restores it', pass: stickyFoot.pass && footBack, detail: { ...stickyFoot.detail, footBack } })
  await page.setContent(shell('<aside style="position:fixed;left:0;top:0;bottom:0;width:700px;background:#333"><nav aria-label="Main">menu</nav></aside>'))
  const t0 = Date.now()
  await waitForSidebar(page)
  const sidebarMs = Date.now() - t0
  const side = await probe('overlap-sidebar', {})
  checks.push({ name: 'overlapCheck does not fail on the sidebar; waitForSidebar returns at once when it is there', pass: side.pass && sidebarMs < 1500, detail: { ...side.detail, sidebarMs } })
  await page.setContent(shell(''))
  const t1 = Date.now()
  await waitForSidebar(page, 300)
  checks.push({ name: 'waitForSidebar gives up quietly when the page has none', pass: Date.now() - t1 >= 250, detail: {} })
  await context.close()
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
