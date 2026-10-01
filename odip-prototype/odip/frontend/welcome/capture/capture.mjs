#!/usr/bin/env node
/**
 * Odip landing page: product screenshot capture (re-runnable).
 *
 *   PW_CORE_PATH=<abs path to the playwright-core package dir> node capture.mjs [name ...]
 *
 * With no names every shot runs; with names only those run (e.g. `node capture.mjs plan-trip-glance`).
 * `node capture.mjs --list` prints the shot names.
 *
 * Needs
 *   - Node 20+, playwright-core (path in PW_CORE_PATH) with a Chromium build installed.
 *   - Python 3 + Pillow: PNG -> WebP conversion is done by ./webp.py (override the interpreter with PYTHON).
 *   - The frontend dev server on CAPTURE_BASE_URL (default http://localhost:5179), started with the
 *     mock-preview shim and proxying /api to the mock API, i.e. from odip-prototype/odip:
 *         node mock-api/server.js                                   (port 5062)
 *         cd frontend && VITE_MOCK_PREVIEW=1 ODIP_API_TARGET=http://localhost:5062 npx vite --port 5179
 *     A fresh browser context makes src/main.tsx seed an Admin session, so no login is needed.
 *
 * Output: ../assets/screens/<name>.webp (1x) + <name>@2x.webp (2x) + manifest.json (rewritten per shot).
 * PNG originals are kept in CAPTURE_PNG_DIR (default: <os tmp>/odip-capture) so they can be eyeballed.
 *
 * Layout of this folder
 *   capture.mjs          this runner: browser/context setup, crop + screenshot, WebP conversion, manifest upsert
 *   shots.mjs            shot registry (assembles the shots-*.mjs modules, ordered by stage) + the first shots
 *   shots-<stage>.mjs    one module per stage: crew, stay, care, fund, compliant (same shot shape)
 *   drivers.mjs          helpers that drive the real UI (dropdown picking, the incident wizard walk-through)
 *   fixtures*.mjs        realistic API JSON for screens the mock cannot show (only shots flagged fixture: true use it)
 *   webp.py              PNG -> WebP at 1x/2x (quality 82 stepping down to 70 to stay under 90 KB / 260 KB)
 *
 * Honesty rules baked in here:
 *   - Everything on screen is the mock's fictional sample data. Screens the mock has no data for are fed
 *     realistic API JSON through page.route() (shots flagged `fixture: true`); the DOM is never edited to
 *     fake a state. Capture-only CSS switches animations/caret off, hides scrollbars and drops the sticky top bar's
 *     shadow; one or two shots also drop the dark modal scrim so a dialog's rounded corners are clean. Forms are
 *     filled and dialogs opened by driving the real UI (clicks, typing, a real drag).
 *   - The clock is pinned (Date only, timers keep running) to CAPTURE_NOW, or a shot's own `now`, so the mock's
 *     Jul-Sep 2026 dates read as current/upcoming.
 *   - Tall crops grow the viewport height to the whole document first, so sticky bars never float across a crop.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { SHOTS } from './shots.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(HERE, '../assets/screens')
const PNG_DIR = process.env.CAPTURE_PNG_DIR || path.join(os.tmpdir(), 'odip-capture')
const BASE_URL = (process.env.CAPTURE_BASE_URL || 'http://localhost:5179').replace(/\/$/, '')
const NOW = process.env.CAPTURE_NOW || '2026-08-04T10:00:00+10:00'
const PYTHON = process.env.PYTHON || 'python'
const DESKTOP = { width: 1280, height: 900 }
const PHONE = { width: 390, height: 844 }

const require = createRequire(import.meta.url)
function loadPlaywright() {
  const p = process.env.PW_CORE_PATH
  if (!p) throw new Error('Set PW_CORE_PATH to the playwright-core package directory (see the header comment).')
  return require(p)
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** The ApiResponse<T> envelope the frontend's axios client unwraps. */
export const envelope = (data) => ({ success: true, data, message: null, errors: null })
export const paged = (items) => ({
  items, totalCount: items.length, page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrevious: false,
})

/**
 * Answer GET/POST calls to /api/v1/<apiPath> with realistic JSON (the real response DTO shape).
 * `data` may be a value or `(url, request) => value`. `method` defaults to GET.
 */
export async function fulfil(page, apiPath, data, { method = 'GET' } = {}) {
  const re = new RegExp('/api/v1/' + apiPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?(\\?.*)?$')
  await page.route(re, async (route) => {
    const req = route.request()
    if (req.method() !== method) return route.fallback()
    const value = typeof data === 'function' ? data(new URL(req.url()), req) : data
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(envelope(value)),
    })
  })
}

/** Wait until the page has quietly finished loading: network idle, no spinners/skeletons, fonts ready. */
export async function settle(page, { extra = 350 } = {}) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page
    .waitForFunction(() => {
      const root = document.querySelector('main') || document.body
      return !root.querySelector('.animate-pulse, .animate-spin, [aria-busy="true"]')
    }, null, { timeout: 12000 })
    .catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(extra)
}

/** Document-space rectangle of a locator (viewport rect + scroll offsets). */
async function docRect(locator) {
  return locator.first().evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }
  })
}

/** Union of several locators' document rectangles, optionally padded. */
export async function unionRect(locators, pad = 0) {
  const { x: padX, y: padY } = typeof pad === 'number' ? { x: pad, y: pad } : pad
  const rects = []
  for (const l of locators) rects.push(await docRect(l))
  const x1 = Math.min(...rects.map((r) => r.x))
  const y1 = Math.min(...rects.map((r) => r.y))
  const x2 = Math.max(...rects.map((r) => r.x + r.width))
  const y2 = Math.max(...rects.map((r) => r.y + r.height))
  return { x: x1 - padX, y: y1 - padY, width: x2 - x1 + padX * 2, height: y2 - y1 + padY * 2 }
}

/** Snap a rect outward to whole CSS pixels so the crop has no blurred fractional edges. */
function snap(r) {
  const x = Math.floor(r.x)
  const y = Math.floor(r.y)
  return { x, y, width: Math.ceil(r.x + r.width) - x, height: Math.ceil(r.y + r.height) - y }
}

const NO_MOTION_CSS = `
*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; scroll-behavior: auto !important; }
html { scrollbar-width: none !important; }
header { box-shadow: none !important; } /* the sticky top bar's soft shadow would bleed into crops that start just under it */
*::-webkit-scrollbar { display: none !important; }
`

async function newShotContext(browser, shot) {
  const mobile = !!shot.mobile
  const context = await browser.newContext({
    viewport: shot.viewport || (mobile ? PHONE : DESKTOP),
    deviceScaleFactor: shot.dsf || (mobile ? 3 : 2),
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'en-AU',
    timezoneId: 'Australia/Brisbane',
    colorScheme: 'light',
  })
  await context.addInitScript((css) => {
    const add = () => {
      const s = document.createElement('style')
      s.setAttribute('data-capture', '1')
      s.textContent = css
      document.head.appendChild(s)
    }
    if (document.head) add()
    else document.addEventListener('DOMContentLoaded', add, { once: true })
  }, NO_MOTION_CSS)
  const page = await context.newPage()
  // Date only: timers, rAF and network keep running normally.
  await page.clock.setFixedTime(new Date(shot.now || NOW))
  return { context, page }
}

function upsertManifest(order, entry) {
  const file = path.join(OUT_DIR, 'manifest.json')
  let list = []
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    list = []
  }
  const i = list.findIndex((e) => e.name === entry.name)
  if (i >= 0) list[i] = entry
  else list.push(entry)
  list.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
  fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n')
}

// ---------------------------------------------------------------------------------------------
// Shot registry. Each shot: { name, stage, priority, route, cropTarget, fixture, alt, notes,
//   mobile?, viewport?, dsf?, now?, setup?(page), run(ctx) -> { locator | rect, pad? } }
// `run` navigates + drives the UI and returns what to crop (a locator, or a document-space rect).
// ---------------------------------------------------------------------------------------------
async function runShot(browser, shot, order) {
  const t0 = Date.now()
  const { context, page } = await newShotContext(browser, shot)
  const problems = []
  page.on('pageerror', (e) => problems.push('pageerror: ' + String(e.message).slice(0, 160)))
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console.error: ' + m.text().slice(0, 160))
  })
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url().replace(BASE_URL, '')}`)
  })
  try {
    if (shot.setup) await shot.setup(page)
    const goto = async (route) => {
      await page.goto(BASE_URL + route, { waitUntil: 'domcontentloaded' })
      await settle(page)
    }
    const target = await shot.run({ page, goto, settle: () => settle(page), fulfil: (p, d, o) => fulfil(page, p, d, o), unionRect, BASE_URL })
    await page.mouse.move(2, 2) // park the pointer in the sidebar corner so no crop shows a hover tint
    await page.evaluate(() => {
      const a = document.activeElement
      if (a && a !== document.body) a.blur()
    })
    // Grow the viewport to the whole document (width unchanged) so sticky/fixed bars (top bar, wizard footer,
    // mobile nav) sit at their natural edges instead of floating across the middle of a tall crop, then
    // scroll to the top and measure the crop rectangle.
    const vp = page.viewportSize()
    const docH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
    if (docH > vp.height) await page.setViewportSize({ width: vp.width, height: docH })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    const rect = snap(target.rect || (await unionRect([].concat(target.locator), target.pad || 0)))
    fs.mkdirSync(PNG_DIR, { recursive: true })
    const png = path.join(PNG_DIR, `${shot.name}.png`)
    // `rect` is document-space; fullPage lets Playwright capture beyond the viewport.
    await page.screenshot({ path: png, clip: rect, fullPage: true, animations: 'disabled', caret: 'hide', type: 'png' })
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const file1x = `${shot.name}.webp`
    const file2x = `${shot.name}@2x.webp`
    const dsf = shot.dsf || (shot.mobile ? 3 : 2)
    const out = execFileSync(PYTHON, [path.join(HERE, 'webp.py'), png, path.join(OUT_DIR, file1x), path.join(OUT_DIR, file2x), String(dsf)], { encoding: 'utf8' })
    const info = JSON.parse(out.trim().split('\n').pop())
    upsertManifest(order, {
      name: shot.name,
      stage: shot.stage,
      file1x,
      file2x,
      width1x: info.width1x,
      height1x: info.height1x,
      width2x: info.width2x,
      height2x: info.height2x,
      kb1x: info.kb1x,
      kb2x: info.kb2x,
      route: shot.route,
      cropTarget: shot.cropTarget,
      fixture: !!shot.fixture,
      alt: shot.alt,
      notes: shot.notes || '',
      ...(shot.variantOf ? { variantOf: shot.variantOf } : {}),
    })
    console.log(
      `OK   ${shot.name}  ${info.width1x}x${info.height1x} (1x ${info.kb1x} KB q${info.q1x}, 2x ${info.kb2x} KB q${info.q2x})` +
        (info.over.length ? `  OVER BUDGET: ${info.over.join(',')}` : '') +
        `  ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    )
    if (problems.length) console.log('     page problems:\n       ' + [...new Set(problems)].slice(0, 8).join('\n       '))
    return { ok: true, info, problems }
  } catch (err) {
    console.log(`FAIL ${shot.name}: ${String(err.stack || err).split('\n').slice(0, 4).join('\n     ')}`)
    if (problems.length) console.log('     page problems:\n       ' + [...new Set(problems)].slice(0, 8).join('\n       '))
    try {
      fs.mkdirSync(PNG_DIR, { recursive: true })
      await page.screenshot({ path: path.join(PNG_DIR, `_fail-${shot.name}.png`) })
    } catch {}
    return { ok: false, problems }
  } finally {
    await context.close()
  }
}

async function main() {
  const args = process.argv.slice(2)
  const order = SHOTS.map((s) => s.name)
  if (args.includes('--list')) {
    for (const s of SHOTS) console.log(`${s.name}\t${s.priority}\t${s.stage}`)
    return
  }
  const wanted = args.filter((a) => !a.startsWith('--'))
  const unknown = wanted.filter((n) => !order.includes(n))
  if (unknown.length) throw new Error('Unknown shot(s): ' + unknown.join(', ') + '. Try --list.')
  const todo = SHOTS.filter((s) => !wanted.length || wanted.includes(s.name))
  const { chromium } = loadPlaywright()
  const browser = await chromium.launch()
  let failed = 0
  try {
    for (const shot of todo) {
      const r = await runShot(browser, shot, order)
      if (!r.ok) failed++
    }
  } finally {
    await browser.close()
  }
  if (failed) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
