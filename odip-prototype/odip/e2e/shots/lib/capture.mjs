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
  const vp = page.viewportSize()
  await page.mouse.move(vp.width - 4, vp.height - 4) // park first so a hover-driven change lands before the stability check
  let prev = null
  while (Date.now() < deadline) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const b = await box()
    const cur = b ? [b.x, b.y, b.width, b.height].map((v) => Math.round(v * 10)).join(',') : 'none'
    if (cur === prev) return
    prev = cur
  }
  throw new Error(`settle: layout still moving after ${SETTLE_MS}ms`)
}

// Run fn with the viewport grown to `width` x `height`, then restore it (and the touch emulation).
async function withViewport(page, width, height, touch, fn) {
  const vp = page.viewportSize()
  const grow = width > vp.width || height > vp.height
  try {
    if (grow) {
      await page.setViewportSize({ width: Math.max(width, vp.width), height: Math.max(height, vp.height) })
      if (touch) await pinCoarse(page)
    }
    return await fn()
  } finally {
    if (grow) {
      await page.setViewportSize(vp)
      if (touch) await pinCoarse(page)
    }
  }
}

const isCoarse = (page) => page.evaluate(() => matchMedia('(pointer: coarse)').matches)

// Shoot the whole element plus `pad` (a pad shrinks only at the page edge, or the right edge for a fluid-width element).
// The viewport grows to hold the element: its bottom plus pad, and its width when the element overflows it.
// Returns { file, clip, box, viewport, pad, coarse, touch, elementHeight }: clip is the real post-settle clip, box the element box.
export async function cropElement(page, locator, file, { pad = 16, touch } = {}) {
  touch ??= await isCoarse(page)
  await settle(page, locator)
  await page.evaluate(() => scrollTo(0, 0))
  const first = await locator.boundingBox()
  if (!first) throw new Error(`cropElement: no bounding box for ${file}`)
  return withViewport(page, Math.ceil(first.x + first.width), Math.ceil(first.y + first.height + pad), touch, async () => {
    await settle(page, locator)
    const box = await locator.boundingBox()
    const x = Math.max(0, box.x - pad)
    const y = Math.max(0, box.y - pad)
    const clip = { x, y, width: Math.min(box.x + box.width + pad, page.viewportSize().width) - x, height: box.y + box.height + pad - y }
    const coarse = await isCoarse(page)
    const viewport = page.viewportSize()
    await page.screenshot({ path: file, clip })
    return { file, clip, box, viewport, pad, coarse, touch, elementHeight: box.height }
  })
}

// Whole page: the viewport is grown to the page height (a fullPage clip drops touch emulation and resizes without settling),
// settled again, and checked for horizontal overflow before the shot. Put the file under <outDir>/full/.
// Returns { file, coarse, checks }: checks are records for writeChecks.
export async function fullPage(page, file, { touch } = {}) {
  touch ??= await isCoarse(page)
  await settle(page)
  const h = await page.evaluate(() => document.scrollingElement.scrollHeight)
  return withViewport(page, 0, Math.min(h, 4000), touch, async () => {
    await settle(page)
    const m = await page.evaluate(() => ({ scrollLeft: document.scrollingElement.scrollLeft, scrollWidth: document.scrollingElement.scrollWidth, clientWidth: document.scrollingElement.clientWidth, scrollHeight: document.scrollingElement.scrollHeight }))
    const coarse = await isCoarse(page)
    const vh = page.viewportSize().height
    const name = path.basename(file)
    const checks = [
      { name: `no horizontal scroll: ${name}`, pass: m.scrollLeft === 0 && m.scrollWidth <= m.clientWidth, detail: m },
      { name: `full page not truncated: ${name}`, pass: m.scrollHeight <= vh, detail: { scrollHeight: m.scrollHeight, viewportHeight: vh } },
    ]
    if (touch) checks.push({ name: `full page keeps touch emulation: ${name}`, pass: coarse, detail: { coarse } })
    await page.screenshot({ path: file })
    return { file, coarse, checks }
  })
}

// Passes only when the real clip holds the element plus pad on all four sides (1px rounding; a pad may shrink at the top/left
// page edge or the right viewport edge), lies inside the viewport, and the pointer stayed coarse for a touch crop.
export function checkCropHolds({ file, clip, box, viewport, pad, coarse, touch }) {
  const t = 1
  const holds = clip.x <= Math.max(0, box.x - pad) + t && clip.y <= Math.max(0, box.y - pad) + t
    && clip.x + clip.width >= Math.min(box.x + box.width + pad, viewport.width) - t && clip.y + clip.height >= box.y + box.height + pad - t
  const inside = clip.x >= 0 && clip.y >= 0 && clip.x + clip.width <= viewport.width + t && clip.y + clip.height <= viewport.height + t
  return { name: `crop holds the whole element: ${path.basename(file)}`, pass: holds && inside && (!touch || coarse), detail: { clip, box, viewport, pad, holds, inside, coarse } }
}

export function writeChecks(outDir, checks) {
  writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify(checks, null, 2))
  for (const c of checks) console.log(`CHECK ${c.pass ? 'ok' : 'FAIL'} ${c.name} = ${JSON.stringify(c.detail)}`)
  const pass = checks.filter((c) => c.pass).length
  console.log(`TOTAL ${pass}/${checks.length} pass`)
  return pass === checks.length
}
