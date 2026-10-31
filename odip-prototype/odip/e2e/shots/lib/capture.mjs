// Shared capture helpers for shot scripts: settle before every frame, whole-element crops, touch kept at 390, one file per name.
// See lib/README.md. Playwright only; the caller owns the browser, context and page.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const SETTLE_MS = 5000
const cdpSessions = new WeakMap()

// Drop earlier PNGs (including the runner's shrink copies) and full/, then recreate full/.
export function prepareOutDir(outDir) {
  mkdirSync(outDir, { recursive: true })
  for (const f of readdirSync(outDir)) if (f.endsWith('.png')) rmSync(path.join(outDir, f))
  rmSync(path.join(outDir, 'full'), { recursive: true, force: true })
  mkdirSync(path.join(outDir, 'full'), { recursive: true })
}

// Touch emulation is lost when the viewport is resized, so it is applied again after every resize.
async function pinCoarse(page) {
  let cdp = cdpSessions.get(page)
  if (!cdp) { cdp = await page.context().newCDPSession(page); cdpSessions.set(page, cdp) }
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
}

// Fonts ready, animations finished, and the box (locator, else <main>) in the same place on two consecutive frame pairs.
export async function settle(page, locator) {
  const box = () => (locator ?? page.locator('main').first()).boundingBox()
  const deadline = Date.now() + SETTLE_MS
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: SETTLE_MS })
    .catch(() => { throw new Error(`settle: animations still running after ${SETTLE_MS}ms`) })
  let prev = null
  while (Date.now() < deadline) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const b = await box()
    const cur = b ? [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 10)).join(',') : 'none'
    if (cur === prev) {
      const vp = page.viewportSize()
      await page.mouse.move(vp.width - 4, vp.height - 4)
      return
    }
    prev = cur
  }
  throw new Error(`settle: layout still moving after ${SETTLE_MS}ms`)
}

// Run fn with the viewport grown to `height`, then restore it (and the touch emulation).
async function withHeight(page, height, touch, fn) {
  const vp = page.viewportSize()
  const grow = height > vp.height
  if (grow) {
    await page.setViewportSize({ width: vp.width, height })
    if (touch) await pinCoarse(page)
  }
  try { return await fn() } finally {
    if (grow) {
      await page.setViewportSize(vp)
      if (touch) await pinCoarse(page)
    }
  }
}

const isCoarse = (page) => page.evaluate(() => matchMedia('(pointer: coarse)').matches)

// Shoot the whole element plus `pad`. Returns { file, cropHeight, elementHeight, pad, coarse, touch }.
export async function cropElement(page, locator, file, { pad = 16, touch = false } = {}) {
  await settle(page, locator)
  await page.evaluate(() => scrollTo(0, 0))
  const first = await locator.boundingBox()
  if (!first) throw new Error(`cropElement: no bounding box for ${file}`)
  return withHeight(page, Math.ceil(first.y + first.height + pad), touch, async () => {
    await settle(page, locator)
    const bb = await locator.boundingBox()
    const x = Math.max(0, bb.x - pad)
    const y = Math.max(0, bb.y - pad)
    const clip = { x, y, width: Math.min(page.viewportSize().width - x, bb.width + 2 * pad), height: bb.height + 2 * pad }
    const coarse = await isCoarse(page)
    await page.screenshot({ path: file, clip })
    return { file, cropHeight: clip.height, elementHeight: bb.height, pad, coarse, touch }
  })
}

// Whole page: fullPage on a fine pointer; at touch the viewport is grown instead (a fullPage clip drops the emulation).
// Put `file` under <outDir>/full/.
export async function fullPage(page, file, { touch = false } = {}) {
  await settle(page)
  if (!touch) {
    await page.screenshot({ path: file, fullPage: true })
    return { file, coarse: false }
  }
  const h = await page.evaluate(() => document.scrollingElement.scrollHeight)
  return withHeight(page, Math.min(h, 4000), true, async () => {
    await settle(page)
    const coarse = await isCoarse(page)
    await page.screenshot({ path: file })
    return { file, coarse }
  })
}

// Passes only when the crop holds the whole element plus both pads (and the pointer stayed coarse for a touch crop).
export function checkCropHolds(result) {
  const need = result.elementHeight + 2 * result.pad - 1
  const pass = result.cropHeight >= need && (!result.touch || result.coarse)
  return { name: `crop holds the whole element: ${path.basename(result.file)}`, pass, detail: { cropHeight: result.cropHeight, elementHeight: result.elementHeight, need, coarse: result.coarse } }
}

export function writeChecks(outDir, checks) {
  writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify(checks, null, 2))
  for (const c of checks) console.log(`CHECK ${c.pass ? 'ok' : 'FAIL'} ${c.name} = ${JSON.stringify(c.detail)}`)
  const pass = checks.filter((c) => c.pass).length
  console.log(`TOTAL ${pass}/${checks.length} pass`)
  return pass === checks.length
}
