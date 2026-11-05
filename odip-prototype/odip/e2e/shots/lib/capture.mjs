// Shared capture helpers for shot scripts: settle before every frame, whole-element crops, touch kept at 390, one file per name.
// See lib/README.md. Playwright only; the caller owns the browser, context and page.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const SETTLE_MS = 5000

// Australian dates and times in every shot: spread it into `browser.newContext({ ...AU_CONTEXT, viewport })`.
export const AU_CONTEXT = { locale: 'en-AU', timezoneId: 'Australia/Sydney' }
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
// Hide fixed and sticky elements that are not the target(s), their ancestors or descendants; returns the restore function.
async function hideChrome(page, locators) {
  const keep = await Promise.all(locators.map((l) => l.elementHandle()))
  await page.evaluate((keepEls) => {
    const hidden = []
    for (const e of document.body.querySelectorAll('*')) {
      const p = getComputedStyle(e).position
      if ((p === 'fixed' || p === 'sticky') && !keepEls.some((k) => e.contains(k) || k.contains(e))) { hidden.push([e, e.style.visibility]); e.style.visibility = 'hidden' }
    }
    window.__restoreChrome = () => hidden.forEach(([e, v]) => { e.style.visibility = v })
  }, keep)
  return () => page.evaluate(() => window.__restoreChrome?.())
}

// Wait for the app sidebar (<nav aria-label="Main">) to be visible; a page without one (390 with the drawer closed) just waits out a short timeout. Call before settle.
export async function waitForSidebar(page, timeout = 2000) {
  await page.locator('nav[aria-label="Main"]').first().waitFor({ state: 'visible', timeout }).catch(() => {})
}

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
// The viewport grows in height only, never in width: an element wider than the viewport fails checkCropHolds (overflowX).
// Returns { file, clip, box, viewport, pad, coarse, touch, elementHeight }: clip is the real post-settle clip, box the element box.
export async function cropElement(page, locator, file, { pad = 16, touch, also, natural, during, hideChrome: hide } = {}) {
  touch ??= await isCoarse(page)
  await settle(page, locator)
  await page.evaluate(() => scrollTo(0, 0))
  // `also` widens the crop to a second element (the save foot); `natural` grows the viewport to the page height so sticky and fixed chrome sits in its natural place, not over the element.
  const boxOf = async () => {
    const own = await locator.boundingBox()
    const extra = also ? await also.boundingBox() : null
    if (!own) return null
    if (!extra) return own
    const x = Math.min(own.x, extra.x), y = Math.min(own.y, extra.y)
    return { x, y, width: Math.max(own.x + own.width, extra.x + extra.width) - x, height: Math.max(own.y + own.height, extra.y + extra.height) - y }
  }
  const first = await boxOf()
  if (!first) throw new Error(`cropElement: no bounding box for ${file}`)
  const pageH = natural ? Math.min(await page.evaluate(() => document.scrollingElement.scrollHeight), 4000) : 0
  return withViewport(page, 0, Math.max(pageH, Math.ceil(first.y + first.height + pad)), touch, async () => {
    await settle(page, locator)
    const box = await boxOf()
    const x = Math.max(0, box.x - pad)
    const y = Math.max(0, box.y - pad)
    const clip = { x, y, width: Math.min(box.x + box.width + pad, page.viewportSize().width) - x, height: box.y + box.height + pad - y }
    const coarse = await isCoarse(page)
    const viewport = page.viewportSize()
    const restore = hide ? await hideChrome(page, also ? [locator, also] : [locator]) : null
    let measured
    try {
      measured = during ? await during(clip) : undefined
      await page.screenshot({ path: file, clip })
    } finally { await restore?.() }
    return { file, clip, box, viewport, pad, coarse, touch, elementHeight: box.height, measured }
  })
}

// Pass = the element lies inside the clip and the topmost element at its centre is the element or inside it. Run it from `during`.
// Ignored: the app sidebar, and anything inside the open dialog, popover or drawer the element lives in. Returns { name, pass, detail }.
export async function overlapCheck(locator, clip, file) {
  const detail = await locator.evaluate((el, c) => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    const host = el.closest('[role=dialog],[popover]')
    const ignored = !!hit && (!!hit.closest('aside:has(nav[aria-label="Main"]),nav[aria-label="Main"]') || (!!host && host.contains(hit)))
    return { inClip: r.left >= c.x - 1 && r.top >= c.y - 1 && r.right <= c.x + c.width + 1 && r.bottom <= c.y + c.height + 1, covered: !hit || (!el.contains(hit) && !ignored), hit: hit ? hit.tagName + '.' + String(hit.className).split(' ')[0] : null }
  }, clip)
  return { name: `crop is clear of fixed or sticky chrome: ${file}`, pass: detail.inClip && !detail.covered, detail }
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

// Passes only when the real clip holds the element plus pad on all four sides (1px rounding; the clip must also hold the bare element box, which must lie inside the viewport width; a pad may shrink at the top/left
// page edge or the right viewport edge), lies inside the viewport, and the pointer stayed coarse for a touch crop.
export function checkCropHolds({ file, clip, box, viewport, pad, coarse, touch }) {
  const t = 1
  const holds = clip.x <= Math.max(0, box.x - pad) + t && clip.y <= Math.max(0, box.y - pad) + t
    && clip.x + clip.width >= Math.min(box.x + box.width + pad, viewport.width) - t && clip.y + clip.height >= box.y + box.height + pad - t
  const overflowX = box.x < -t || box.x + box.width > viewport.width + t
  const whole = clip.x <= box.x + t && clip.y <= box.y + t && clip.x + clip.width >= box.x + box.width - t && clip.y + clip.height >= box.y + box.height - t && !overflowX
  const inside = clip.x >= 0 && clip.y >= 0 && clip.x + clip.width <= viewport.width + t && clip.y + clip.height <= viewport.height + t
  return { name: `crop holds the whole element: ${path.basename(file)}`, pass: holds && whole && inside && (!touch || coarse), detail: { clip, box, viewport, pad, holds, whole, overflowX, inside, coarse } }
}

export function writeChecks(outDir, checks) {
  writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify(checks, null, 2))
  for (const c of checks) console.log(`CHECK ${c.pass ? 'ok' : 'FAIL'} ${c.name} = ${JSON.stringify(c.detail)}`)
  const pass = checks.filter((c) => c.pass).length
  console.log(`TOTAL ${pass}/${checks.length} pass`)
  return pass === checks.length
}
