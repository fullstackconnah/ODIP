#!/usr/bin/env node
/**
 * Bunya Support landing page: product screenshot capture (re-runnable). Two halves, because browsers run only on the
 * homelab server runner and the WebP encode runs on this PC:
 *
 *   1. Shoot (server):  bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <slot> shots <abs path>/welcome/capture/server-shots.mjs <outdir>
 *        SHOT_NAMES=a,b   only those shots;   SHOT_PROBE=1   load each shot's route as its role and record what renders
 *   2. Encode (local):  PYTHON=<python with Pillow> node capture.mjs --encode <outdir>
 *   `node capture.mjs --list` prints the shot names.
 *
 * Needs
 *   - Shoot: the runner's shots target (mock API + Vite dev server with VITE_DEV_AUTH=true, Playwright's Chromium). Each
 *     context signs in through the dev panel as the shot's role (default Admin), as the runner's example-shots.mjs does.
 *   - Encode: Node 20+ and Python 3 + Pillow (./webp.py; the interpreter is PYTHON).
 *
 * Output: shoot writes <outdir>/<name>.png and <outdir>/shots.json (probe: probe-<name>.png and probe.json);
 * encode writes ../assets/screens/<name>.webp (1x) + <name>@2x.webp (2x) and rewrites manifest.json in SHOTS order.
 *
 * Layout of this folder
 *   capture.mjs          this runner: context setup and sign-in, crop + screenshot, the probe, the WebP encode and the manifest
 *   server-shots.mjs     the runner entry: imports chromium and calls capture()
 *   shots.mjs            shot registry: the 11 page screens plus 7 narrow "-m" crops
 *   drivers.mjs          helpers that drive the real UI (dropdown picking, the incident wizard walk-through)
 *   fixtures.mjs         realistic API JSON for screens the mock cannot show (only shots flagged fixture: true use it)
 *   webp.py              PNG -> WebP at 1x/2x (quality 82 stepping down to 70 to stay under 90 KB / 260 KB)
 *
 * Honesty rules baked in here:
 *   - Everything on screen is the mock's fictional sample data. Screens the mock has no data for are fed
 *     realistic API JSON through page.route() (shots flagged `fixture: true`); the DOM is never edited to
 *     fake a state. Capture-only CSS switches animations/caret off, hides scrollbars and drops the sticky top bar's
 *     shadow. Forms are filled and dialogs opened by driving the real UI (clicks, typing).
 *   - The clock is pinned (Date only, timers keep running) to CAPTURE_NOW, or a shot's own `now`, so the mock's
 *     dates read as current/upcoming.
 *   - Tall crops grow the viewport height to the whole document first, so sticky bars never float across a crop.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { SHOTS } from './shots.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(HERE, '../assets/screens')
const NOW = process.env.CAPTURE_NOW || '2026-08-04T10:00:00+10:00'
const DESKTOP = { width: 1280, height: 900 }
const PHONE = { width: 390, height: 844 }

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

/** The page's crops are 16:10, 4:3 or 4:5 (SHAPE section 5): keep the rect's width and top, set the height to match. */
export const ratio = (rect, w, h) => ({ ...rect, height: (rect.width * h) / w })

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

/** The dev panel's sign-in as `role` (the runner's Vite sets VITE_DEV_AUTH; the mock stores no role, so both calls are answered here). */
async function signIn(page, baseUrl, role) {
  const username = `dev.${role.toLowerCase()}`
  await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: envelope([{ username, role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({
    json: envelope({
      id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username,
      fullName: `Dev ${role}`, role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001',
    }),
  }))
  // The first load of a fresh dev server pre-bundles its dependencies, so be patient.
  await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const button = page.getByRole('button', { name: 'Sign in as selected user' })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}

async function newShotContext(browser, shot, baseUrl) {
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
  const problems = []
  page.on('pageerror', (e) => problems.push('pageerror: ' + String(e.message).slice(0, 160)))
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console.error: ' + m.text().slice(0, 160))
  })
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url().replace(baseUrl, '')}`)
  })
  await signIn(page, baseUrl, shot.role || 'Admin')
  return { context, page, problems }
}

// ---------------------------------------------------------------------------------------------
// Shot registry (shots.mjs). Each shot: { name, stage, role?, route, cropTarget, fixture, alt, notes,
//   mobile?, viewport?, dsf?, now?, variantOf?, setup?(page), run(ctx) -> { locator | rect, pad? } }
// `run` navigates + drives the UI and returns what to crop (a locator, or a document-space rect).
// ---------------------------------------------------------------------------------------------
async function runShot(browser, shot, { baseUrl, pngDir }) {
  const t0 = Date.now()
  const { context, page, problems } = await newShotContext(browser, shot, baseUrl)
  try {
    if (shot.setup) await shot.setup(page)
    const goto = async (route) => {
      await page.goto(baseUrl + route, { waitUntil: 'domcontentloaded' })
      await settle(page)
    }
    const target = await shot.run({ page, goto, settle: () => settle(page), fulfil: (p, d, o) => fulfil(page, p, d, o), unionRect, ratio, BASE_URL: baseUrl })
    await page.mouse.move(2, 2) // park the pointer in the sidebar corner so no crop shows a hover tint
    await page.evaluate(() => {
      const a = document.activeElement
      if (a && a !== document.body) a.blur()
    })
    // Grow the viewport to the whole document (width unchanged) so sticky/fixed bars sit at their natural edges
    // instead of floating across the middle of a tall crop, then scroll to the top and measure the crop rectangle.
    const vp = page.viewportSize()
    const docH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
    if (docH > vp.height) await page.setViewportSize({ width: vp.width, height: docH })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    const rect = snap(target.rect || (await unionRect([].concat(target.locator), target.pad || 0)))
    // `rect` is document-space; fullPage lets Playwright capture beyond the viewport.
    await page.screenshot({ path: path.join(pngDir, `${shot.name}.png`), clip: rect, fullPage: true, animations: 'disabled', caret: 'hide', type: 'png' })
    console.log(`OK   ${shot.name}  ${rect.width}x${rect.height} css px  ${((Date.now() - t0) / 1000).toFixed(1)}s`)
    if (problems.length) console.log('     page problems:\n       ' + [...new Set(problems)].slice(0, 8).join('\n       '))
    return {
      ok: true,
      entry: {
        name: shot.name, stage: shot.stage, route: shot.route, role: shot.role || 'Admin', cropTarget: shot.cropTarget,
        fixture: !!shot.fixture, alt: shot.alt, notes: shot.notes || '', ...(shot.variantOf ? { variantOf: shot.variantOf } : {}),
        dsf: shot.dsf || (shot.mobile ? 3 : 2),
      },
    }
  } catch (err) {
    console.log(`FAIL ${shot.name}: ${String(err.stack || err).split('\n').slice(0, 4).join('\n     ')}`)
    if (problems.length) console.log('     page problems:\n       ' + [...new Set(problems)].slice(0, 8).join('\n       '))
    try {
      await page.screenshot({ path: path.join(pngDir, `_fail-${shot.name}.png`) })
    } catch {}
    return { ok: false }
  } finally {
    await context.close()
  }
}

/** Probe: load each shot's route as its role and record what the mock gives (errors, 4xx/5xx, the error boundary). */
async function probeShot(browser, shot, { baseUrl, pngDir }) {
  const { context, page, problems } = await newShotContext(browser, { ...shot, viewport: shot.viewport || (shot.mobile ? PHONE : DESKTOP) }, baseUrl)
  try {
    if (shot.setup) await shot.setup(page)
    await page.goto(baseUrl + shot.route, { waitUntil: 'domcontentloaded' })
    await settle(page)
    await page.screenshot({ path: path.join(pngDir, `probe-${shot.name}.png`) })
    const boundary = (await page.getByText('Something went wrong').count()) > 0
    console.log(`PROBE ${shot.name} ${page.url().replace(baseUrl, '')} boundary=${boundary} problems=${problems.length}`)
    return { name: shot.name, route: shot.route, url: page.url(), problems: [...new Set(problems)], boundary }
  } catch (err) {
    console.log(`PROBE-FAIL ${shot.name}: ${String(err).split('\n')[0]}`)
    return { name: shot.name, route: shot.route, error: String(err).split('\n')[0], problems: [...new Set(problems)] }
  } finally {
    await context.close()
  }
}

/** The runner half: shoot PNGs (or probe) with the chromium the caller imported. */
export async function capture({ chromium, baseUrl, pngDir, names = [], probe = false }) {
  if (!baseUrl || !pngDir) throw new Error('capture() needs baseUrl and pngDir (the runner sets BASE_URL and OUT_DIR)')
  baseUrl = baseUrl.replace(/\/$/, '')
  const order = SHOTS.map((s) => s.name)
  const unknown = names.filter((n) => !order.includes(n))
  if (unknown.length) throw new Error('Unknown shot(s): ' + unknown.join(', '))
  const todo = SHOTS.filter((s) => !names.length || names.includes(s.name))
  fs.mkdirSync(pngDir, { recursive: true })
  // The context's locale sets the page's language, not the date inputs: those follow the browser's UI language.
  const browser = await chromium.launch({ args: ['--lang=en-AU'], env: { ...process.env, LANG: 'en_AU.UTF-8', LANGUAGE: 'en_AU' } })
  const results = []
  let failed = 0
  try {
    for (const shot of todo) {
      if (probe) {
        // A variant shares its base shot's route, so probing the 11 base shots is enough.
        if (!shot.variantOf) results.push(await probeShot(browser, shot, { baseUrl, pngDir }))
        continue
      }
      const r = await runShot(browser, shot, { baseUrl, pngDir })
      if (r.ok) results.push(r.entry)
      else failed++
    }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(path.join(pngDir, probe ? 'probe.json' : 'shots.json'), JSON.stringify(results, null, 2) + '\n')
  if (failed) process.exitCode = 1
}

/** The local half: PNG -> WebP through webp.py, then manifest.json from scratch in SHOTS order. */
function encode(dir) {
  const python = process.env.PYTHON
  if (!python) throw new Error('Set PYTHON to an interpreter with Pillow (see the header comment).')
  const shots = JSON.parse(fs.readFileSync(path.join(dir, 'shots.json'), 'utf8'))
  const order = SHOTS.map((s) => s.name)
  let previous = []
  try {
    previous = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'manifest.json'), 'utf8'))
  } catch {
    previous = []
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const byName = new Map(previous.filter((e) => order.includes(e.name)).map((e) => [e.name, e])) // partial re-runs keep the rest
  let over = 0
  for (const s of shots) {
    const file1x = `${s.name}.webp`
    const file2x = `${s.name}@2x.webp`
    const out = execFileSync(python, [path.join(HERE, 'webp.py'), path.join(dir, `${s.name}.png`), path.join(OUT_DIR, file1x), path.join(OUT_DIR, file2x), String(s.dsf)], { encoding: 'utf8' })
    const info = JSON.parse(out.trim().split('\n').pop())
    // The words (alt, crop target, notes) come from the registry as it is now, so fixing an alt needs no re-shoot.
    const shot = SHOTS.find((x) => x.name === s.name)
    byName.set(s.name, {
      name: s.name, file1x, file2x, width1x: info.width1x, height1x: info.height1x, width2x: info.width2x, height2x: info.height2x,
      kb1x: info.kb1x, kb2x: info.kb2x, route: shot.route, role: shot.role || 'Admin', cropTarget: shot.cropTarget, fixture: !!shot.fixture,
      alt: shot.alt, notes: shot.notes || '', ...(shot.variantOf ? { variantOf: shot.variantOf } : {}),
    })
    if (info.over.length) over++
    console.log(`${info.over.length ? 'OVER BUDGET ' + info.over.join(',') : 'OK'}  ${s.name}  ${info.width1x}x${info.height1x} (1x ${info.kb1x} KB q${info.q1x}, 2x ${info.kb2x} KB q${info.q2x})`)
  }
  const list = order.filter((n) => byName.has(n)).map((n) => byName.get(n))
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(list, null, 2) + '\n')
  console.log(`manifest.json: ${list.length} entries`)
  if (over) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (args.includes('--list')) for (const s of SHOTS) console.log(`${s.name}\t${s.stage}${s.variantOf ? '\tvariant of ' + s.variantOf : ''}`)
  else if (args[0] === '--encode' && args[1]) encode(path.resolve(args[1]))
  else {
    console.error('Usage: node capture.mjs --list | --encode <png dir>   (shooting runs on the server: see the header comment)')
    process.exitCode = 1
  }
}
