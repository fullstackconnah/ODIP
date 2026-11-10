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

// Hide fixed and sticky elements that are not the target(s), their ancestors or descendants; returns the restore function.
async function hideChrome(page, locators) {
  const keep = await Promise.all(locators.map((l) => l.elementHandle()))
  await page.evaluate((keepEls) => {
    const hidden = []
    for (const e of document.body.querySelectorAll('*')) {
      const p = getComputedStyle(e).position
      if ((p === 'fixed' || p === 'sticky') && !keepEls.some((k) => e.contains(k) || k.contains(e))) { hidden.push([e, e.style.visibility, e.style.transition]); e.style.visibility = 'hidden'; e.style.transition = 'none' }
    }
    window.__restoreChrome = () => hidden.forEach(([e, v, t]) => { e.style.visibility = v; e.style.transition = t })
  }, keep)
  return () => page.evaluate(() => window.__restoreChrome?.())
}

// Wait for the app sidebar (<nav aria-label="Main">) to be visible; a page without one (390 with the drawer closed) just waits out a short timeout. Call before settle.
export async function waitForSidebar(page, timeout = 2000) {
  await page.locator('nav[aria-label="Main"]').first().waitFor({ state: 'visible', timeout }).catch(() => {})
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
// The viewport grows in height only, never in width: an element wider than the viewport fails checkCropHolds (overflowX).
// Returns { file, clip, box, viewport, pad, coarse, touch, elementHeight, measured, overlap }: clip is the real post-settle clip, box the element box, overlap the overlapCheck result.
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
    let measured, overlap
    try {
      measured = during ? await during(clip) : undefined
      // always run: a sticky bar or bottom nav over the element must fail checkCropHolds, not pass on geometry alone
      const covers = [await overlapCheck(locator, clip, file), ...(also ? [await overlapCheck(also, clip, file)] : [])]
      overlap = covers.length === 1 ? covers[0] : { ...covers[0], pass: covers.every((c) => c.pass), detail: covers.map((c) => c.detail) }
      await page.screenshot({ path: file, clip })
    } finally { await restore?.() }
    return { file, clip, box, viewport, pad, coarse, touch, elementHeight: box.height, measured, overlap }
  })
}

// Pass = the element lies inside the clip and the topmost element at its centre and 2 px inside its bottom edge at 25% and 75% of the width is the element or inside it. Run it from `during`.
// Ignored: the app sidebar, and the dialog, popover or drawer the element lives in and its unpositioned content (a positioned cover inside it still fails). Returns { name, pass, detail }; detail.point names the covered point (centre, bottom-quarter-left, bottom-quarter-right).
export async function overlapCheck(locator, clip, file) {
  const detail = await locator.evaluate((el, c) => {
    const r = el.getBoundingClientRect()
    // a positioned element between hit and the dialog (not an ancestor of the target) is a real cover
    const onPath = (n, h) => { for (; n && n !== h; n = n.parentElement) if (getComputedStyle(n).position !== 'static') return true; return false }
    const host = el.closest('dialog,[role=dialog],[role=alertdialog],[aria-modal=true],[popover]')
    const ignored = (hit) => !!hit && (!!hit.closest('aside:has(nav[aria-label="Main"]),nav[aria-label="Main"]') || (!!host && host.contains(hit) && (hit === host || hit.contains(el) || !onPath(hit, host))))
    const clamp = (v, max) => Math.max(0, Math.min(v, max - 1))
    const points = [['centre', r.left + r.width / 2, r.top + r.height / 2], ['bottom-quarter-left', r.left + r.width * 0.25, r.bottom - 2], ['bottom-quarter-right', r.left + r.width * 0.75, r.bottom - 2]]
    let hit = null, point = null, covered = false
    for (const [name, x, y] of points) {
      const h = document.elementFromPoint(clamp(x, innerWidth), clamp(y, innerHeight))
      if (!h || (!el.contains(h) && !ignored(h))) { hit = h; point = name; covered = true; break }
      hit ??= h
    }
    return { inClip: r.left >= c.x - 1 && r.top >= c.y - 1 && r.right <= c.x + c.width + 1 && r.bottom <= c.y + c.height + 1, covered, point, hit: hit ? hit.tagName + '.' + String(hit.className).split(' ')[0] : null }
  }, clip)
  return { name: `crop is clear of fixed or sticky chrome: ${file}`, pass: detail.inClip && !detail.covered, detail }
}

// Layout faults the document-level checks miss. layoutFaults is pure (plain snapshot in, faults out); collectLayout builds the snapshot in the browser.
// Snapshot: { elements: [{ selector, overflowX, scrollWidth, clientWidth, ownText, textOverflow, matchedBy }], controls: [{ selector, rect }], texts: [{ selector, rect, inControls: [index into controls] }] }.
function scanLayout(snapshot, { allow = [] } = {}) {
  const faults = [], allowed = []
  const put = (el, fault) => (el.matchedBy?.some((s) => allow.includes(s)) ? allowed : faults).push({ ...fault, selector: el.selector })
  for (const el of snapshot.elements) {
    if (el.scrollWidth <= el.clientWidth + 1) continue
    const detail = { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }
    if (el.overflowX === 'auto' || el.overflowX === 'scroll') put(el, { kind: 'inner-scroll', detail })
    else if ((el.overflowX === 'hidden' || el.overflowX === 'clip') && el.ownText && el.textOverflow !== 'ellipsis') put(el, { kind: 'clipped-text', detail })
  }
  snapshot.controls.forEach((c, i) => {
    for (const t of snapshot.texts) {
      if (t.inControls.includes(i)) continue
      const ox = Math.min(c.rect.right, t.rect.right) - Math.max(c.rect.left, t.rect.left)
      const oy = Math.min(c.rect.bottom, t.rect.bottom) - Math.max(c.rect.top, t.rect.top)
      if (ox > 2 && oy > 2) faults.push({ kind: 'control-over-text', selector: c.selector, detail: { text: t.selector, overlap: { x: Math.round(ox), y: Math.round(oy) }, control: c.rect, textRect: t.rect } })
    }
  })
  return { faults, allowed }
}

// kind: inner-scroll | clipped-text | control-over-text. `allow`: CSS selectors of containers meant to scroll sideways.
export const layoutFaults = (snapshot, opts) => scanLayout(snapshot, opts).faults

// One evaluate inside `root`: skips hidden (closed <details>, opacity 0 included) or sub-2px elements (sr-only), cuts text rects down to the part their scrolling/clipping ancestors (a truncate box included) leave visible, excludes the document scrollers (fullPage measures those).
// With a modal dialog open inside `root`, controls and text runs come from inside it only (the page behind the scrim is inert); inner-scroll and clipped-text still scan all of root.
// shortcut: a dialog portalled outside `root` is not seen, so root is scanned whole; pass the dialog as `root` for that case.
export function collectLayout(root, allow = []) {
  return root.evaluate((rootEl, allowSel) => {
    const name = (e) => e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + [...e.classList].slice(0, 2).map((c) => `.${c}`).join('')
    const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    // checkVisibility also drops a closed <details> body (content-visibility: hidden keeps real rects) and opacity 0; Playwright's Chromium always has it
    const seen = (e) => { const r = e.getBoundingClientRect(); return r.width >= 2 && r.height >= 2 && e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) }
    const all = [rootEl, ...rootEl.querySelectorAll('*')].filter((e) => !['SCRIPT', 'STYLE', 'OPTION', 'HTML', 'BODY'].includes(e.tagName) && seen(e))
    const dialog = all.filter((e) => e.matches('[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]') && e !== rootEl).pop()
    const inScope = (e) => !dialog || dialog.contains(e)
    const controls = all.filter((e) => inScope(e) && e.matches('button,a[href],[role=button],input,select'))
    const elements = all.map((e) => {
      const s = getComputedStyle(e)
      return { selector: name(e), overflowX: s.overflowX, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, textOverflow: s.textOverflow, ownText: [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()), matchedBy: allowSel.filter((a) => e.matches(a)) }
    })
    const clipRects = (e) => { const out = []; for (let a = e; a && a !== rootEl.parentElement; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible' && a !== document.documentElement && a !== document.body) out.push(a.getBoundingClientRect()); return out }
    const texts = []
    for (const e of all) for (const n of e.childNodes) {
      if (!inScope(e) || n.nodeType !== 3 || !n.textContent.trim()) continue
      const range = document.createRange(); range.selectNodeContents(n)
      const clips = clipRects(e)
      for (const r of range.getClientRects()) {
        const v = clips.reduce((a, c) => ({ left: Math.max(a.left, c.left), top: Math.max(a.top, c.top), right: Math.min(a.right, c.right), bottom: Math.min(a.bottom, c.bottom) }), box(r))
        if (r.width < 1 || r.height < 1 || v.right - v.left < 1 || v.bottom - v.top < 1) continue
        texts.push({ selector: name(e), rect: v, inControls: controls.flatMap((c, i) => (c.contains(e) ? [i] : [])) })
      }
    }
    return { elements, controls: controls.map((c) => ({ selector: name(c), rect: box(c.getBoundingClientRect()) })), texts }
  }, allow)
}

// A check record for writeChecks: pass = no faults; detail lists the faults and the ones `allow` skipped.
export async function layoutCheck(page, root, label, { allow = [] } = {}) {
  const { faults, allowed } = scanLayout(await collectLayout(root, allow), { allow })
  return { name: `layout holds: ${label}`, pass: faults.length === 0, detail: { faults, allowed } }
}

// Whole page: the viewport is grown to the page height (a fullPage clip drops touch emulation and resizes without settling),
// settled again, and checked for horizontal overflow before the shot. Put the file under <outDir>/full/.
// Also runs layoutCheck on <main> (else <body>); `allow` is passed through. Returns { file, coarse, checks }: checks are records for writeChecks.
export async function fullPage(page, file, { touch, allow } = {}) {
  touch ??= await isCoarse(page)
  await settle(page)
  const h = await page.evaluate(() => document.scrollingElement.scrollHeight)
  return withViewport(page, 0, Math.min(h, 4000), touch, async () => {
    await settle(page)
    const m = await page.evaluate(() => {
      // A fit-screen page (AppLayout's lg:has-[[data-fit-screen]]) re-grows main with the viewport, so its footer stays below the fold: judge main alone (cut = its scrollHeight past clientHeight), not the document; columns scrolling inside main scroll by design.
      const main = document.querySelector('main'), d = document.scrollingElement
      const fit = matchMedia('(min-width:1024px)').matches && !!main?.querySelector('[data-fit-screen]')
      const cut = fit ? main.scrollHeight - main.clientHeight : 0
      return { scrollLeft: d.scrollLeft, scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, scrollHeight: d.scrollHeight, fit, cut }
    })
    const coarse = await isCoarse(page)
    const vh = page.viewportSize().height
    const name = path.basename(file)
    const checks = [
      { name: `no horizontal scroll: ${name}`, pass: m.scrollLeft === 0 && m.scrollWidth <= m.clientWidth, detail: m },
      { name: `full page not truncated: ${name}`, pass: m.scrollHeight <= vh || (m.fit && m.cut <= 1), detail: { scrollHeight: m.scrollHeight, viewportHeight: vh, fit: m.fit, cut: m.cut } },
    ]
    if (touch) checks.push({ name: `full page keeps touch emulation: ${name}`, pass: coarse, detail: { coarse } })
    const main = page.locator('main').first()
    checks.push(await layoutCheck(page, (await main.count()) ? main : page.locator('body'), name, { allow }))
    await page.screenshot({ path: file })
    return { file, coarse, checks }
  })
}

// Passes only when the real clip holds the element plus pad on all four sides (1px rounding; the clip must also hold the bare element box, which must lie inside the viewport width; a pad may shrink at the top/left
// page edge or the right viewport edge), lies inside the viewport, the pointer stayed coarse for a touch crop, and (when given) `overlap` passed.
export function checkCropHolds({ file, clip, box, viewport, pad, coarse, touch, overlap }) {
  const t = 1
  const holds = clip.x <= Math.max(0, box.x - pad) + t && clip.y <= Math.max(0, box.y - pad) + t
    && clip.x + clip.width >= Math.min(box.x + box.width + pad, viewport.width) - t && clip.y + clip.height >= box.y + box.height + pad - t
  const overflowX = box.x < -t || box.x + box.width > viewport.width + t
  const whole = clip.x <= box.x + t && clip.y <= box.y + t && clip.x + clip.width >= box.x + box.width - t && clip.y + clip.height >= box.y + box.height - t && !overflowX
  const inside = clip.x >= 0 && clip.y >= 0 && clip.x + clip.width <= viewport.width + t && clip.y + clip.height <= viewport.height + t
  return { name: `crop holds the whole element: ${path.basename(file)}`, pass: holds && whole && inside && (!touch || coarse) && (overlap?.pass ?? true), detail: { clip, box, viewport, pad, holds, whole, overflowX, inside, coarse, ...(overlap && { overlap }) } }
}

export function writeChecks(outDir, checks) {
  writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify(checks, null, 2))
  for (const c of checks) console.log(`CHECK ${c.pass ? 'ok' : 'FAIL'} ${c.name} = ${JSON.stringify(c.detail)}`)
  const pass = checks.filter((c) => c.pass).length
  console.log(`TOTAL ${pass}/${checks.length} pass`)
  return pass === checks.length
}
