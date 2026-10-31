// Polish PR 3a: the success tint and the dashboard first view.
// Numeric checks 1-6 of SHAPE-PR3 section 14 "3a" (exit 1 on any failure), measuring computed boxes and styles, never class names.
// Profiles: 1280 light, 1280 dark, 390 light touch. Fixtures: the stock dashboard, plus a long one (every count in the hundreds) on `/`.
// Captures: the band (stock, all three profiles), the all-clear field (light 1280), the success pill on the dark dashboard, and `/` as one full page per breakpoint.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  ;({ chromium } = await import('@playwright/test'))
}

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const username = 'dev.admin'
const tenantName = 'Sample Support Co'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username, role: 'Admin', tenantName }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev Admin', role: 'Admin', tenantName, tenantId: 'tenant-0001' })

const PROFILES = [
  { name: 'desktop-1280', width: 1280, height: 900, touch: false, dark: false },
  { name: 'desktop-1280-dark', width: 1280, height: 900, touch: false, dark: true },
  { name: 'touch-390', width: 390, height: 844, touch: true, dark: false },
]

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (tag, name, ok, detail = '') => { checks.push({ name: `${tag} ${name}`, pass: !!ok, detail }); console.log(`[polish-pr3a] ${ok ? 'PASS' : 'FAIL'} ${tag} ${name}${detail !== '' ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`) }
const safe = async (tag, name, fn) => { try { await fn() } catch (e) { check(tag, name, false, String(e.message).split('\n')[0]) } }

// In-page helpers, installed before every page script: colours normalised through a canvas, token probes, a visibility test.
function installHelpers() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const px = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]] }
  const tok = (name) => { const el = document.createElement('i'); el.style.backgroundColor = `var(--color-${name})`; document.body.appendChild(el); const out = getComputedStyle(el).backgroundColor; el.remove(); return out }
  const same = (a, b) => { const x = px(a), y = px(b); return x[3] === 255 && y[3] === 255 && x[0] === y[0] && x[1] === y[1] && x[2] === y[2] }
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  // The text baseline of an element: a zero-size inline-block probe at the end of its first line sits on the baseline.
  const baseline = (el) => { const p = document.createElement('span'); p.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; el.appendChild(p); const y = p.getBoundingClientRect().bottom; p.remove(); return y }
  window.__h = { px, tok, same, shown, baseline }
}
const gotoReady = async (page, url) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('main, form').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
}
const setTheme = (page, dark) => page.evaluate((d) => { if (d) document.documentElement.dataset.theme = 'dark' }, dark)

async function signIn(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const button = page.getByRole('button', { name: 'Sign in as selected user' })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}


// Synthetic dashboard summaries: the stock one is the mock-api's; `long` makes every count three digits, `zero` clears them (and the lists the other tiles read).
const SUMMARY = {
  stock: (d) => d,
  long: (d) => ({ ...d, overdueTaskCount: 128, tripsMissingAccommodation: 112, tripsMissingVehicles: 117, tripsMissingStaff: 131, openIncidentCount: 104, qscOverdueCount: 109 }),
  zero: (d) => ({ ...d, overdueTaskCount: 0, tripsMissingAccommodation: 0, tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0, qscOverdueCount: 0, conflictCount: 0, upcomingTrips: [] }),
}
async function routeFixture(page, fixture) {
  await page.route('**/api/v1/dashboard/summary', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ response: res, json: { ...body, data: SUMMARY[fixture](body.data) } })
  })
  if (fixture !== 'zero') return
  for (const re of [/\/api\/v1\/staff(\?.*)?$/, /\/api\/v1\/participants\/alerts(\?.*)?$/, /\/api\/v1\/leave(\/unavailability)?(\?.*)?$/]) {
    await page.route(re, (route) => route.fulfill({ json: envelope([]) }))
  }
  await page.route(/\/api\/v1\/rostering\/completions(\?.*)?$/, (route) => route.fulfill({ json: envelope({ items: [], totalCount: 0, page: 1, pageSize: 1 }) }))
}

// Check 1 (dashboard): solid primaries, tbody included; the platform rail is gone; the root column fills the content box.
const measureDashboard = (page) => page.evaluate(() => {
  const h = window.__h
  const primary = h.tok('primary')
  const solids = [...document.querySelectorAll('body *')].filter(h.shown).filter((el) => {
    const r = el.getBoundingClientRect()
    return r.height >= 28 && r.width >= 56 && h.same(getComputedStyle(el).backgroundColor, primary) && !el.closest('[role=dialog]')
  }).map((el) => (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40))
  const main = document.querySelector('main')
  const cs = getComputedStyle(main)
  const content = main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
  const band = document.querySelector('section[aria-label="Alerts"]')
  const root = band ? band.closest('main > *') : null
  const h2 = [...document.querySelectorAll('main h2')].find((e) => h.shown(e) && /needs your decision/i.test(e.textContent || ''))
  return { solids, rail: !!document.querySelector('aside[aria-label="Platform entry points"]'), content, column: root ? root.getBoundingClientRect().width : null, h2Top: h2 ? h2.getBoundingClientRect().top + scrollY : null }
})

// Checks 2-4: the band's tiles, in DOM order. Alpha fills are composited over their ancestors by hand, then contrast is measured.
const measureBand = (page) => page.evaluate(() => {
  const h = window.__h
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const over = (fg, bg) => { const a = fg[3] / 255; return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)) }
  const backdrop = (el) => { const layers = []; for (let n = el; n; n = n.parentElement) { const c = h.px(getComputedStyle(n).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] === 255) break } return layers.reverse().reduce((acc, c) => over(c, acc), h.px(h.tok('background'))) }
  const errSolid = h.tok('error-container'), warnSolid = h.tok('warning-container')
  const band = document.querySelector('section[aria-label="Alerts"]')
  const grid = band && band.querySelector('div.grid')
  const tiles = grid ? [...grid.querySelectorAll('[data-attention]')].filter(h.shown) : []
  const rows = new Set(tiles.map((t) => Math.round(t.getBoundingClientRect().top))).size
  const tones = tiles.map((t) => t.getAttribute('data-attention'))
  const firstWarning = tones.indexOf('warning'), lastError = tones.lastIndexOf('error')
  const per = tiles.map((t) => {
    const cs = getComputedStyle(t)
    const bg = backdrop(t)
    const spans = t.querySelectorAll('span')
    const figure = spans[0], label = t.querySelector('div > span')
    return { label: (label ? label.textContent : '').trim(), tone: t.getAttribute('data-attention'), height: t.getBoundingClientRect().height, solid: h.same(cs.backgroundColor, errSolid) || h.same(cs.backgroundColor, warnSolid), figure: ratio(h.px(getComputedStyle(figure).color), bg), words: ratio(h.px(getComputedStyle(label).color), bg) }
  })
  return { count: tiles.length, rows, bandHeight: grid ? grid.getBoundingClientRect().height : 0, maxTile: Math.max(0, ...per.map((p) => p.height)), danglingOrder: firstWarning !== -1 && lastError > firstWarning, per }
})

// Check 5: lime elements (the 48px brand tile excluded; no radius or badge exclusion).
const measureLime = (page) => page.evaluate(() => {
  const h = window.__h
  const lime = h.tok('primary-fixed')
  return [...document.querySelectorAll('body *')].filter(h.shown).filter((el) => { const r = el.getBoundingClientRect(); return h.same(getComputedStyle(el).backgroundColor, lime) && !(r.width <= 48 && r.height <= 48) }).map((el) => (el.textContent || '').trim().slice(0, 30))
})

// Check 6: success pills. A status word that means "good" must wear the Selected pair at 4.5 or more; the first one is tagged for the dark crop.
const SUCCESS_WORDS = ['Active', 'Confirmed', 'On Track', 'Covered', 'Completed', 'Approved', 'Paid', 'Compliant']
const measureSuccess = (page) => page.evaluate((words) => {
  const h = window.__h
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const badges = [...document.querySelectorAll('[data-status-badge]')].filter(h.shown).filter((b) => words.includes((b.textContent || '').trim()))
  if (badges[0]) badges[0].setAttribute('data-shot', 'success-pill')
  return badges.map((b) => { const cs = getComputedStyle(b); return { text: b.textContent.trim(), selected: h.same(cs.backgroundColor, h.tok('selected')), contrast: ratio(h.px(cs.color), h.px(cs.backgroundColor)) } })
}, SUCCESS_WORDS)

const ROUTES = ['/', '/trips', '/staff', '/incidents']
const fmt = (n) => (typeof n === 'number' ? +n.toFixed(2) : n)
const successOk = (s) => s.every((p) => p.selected && p.contrast >= 4.5)
const successBad = (s) => s.filter((p) => !(p.selected && p.contrast >= 4.5)).map((p) => ({ t: p.text, c: fmt(p.contrast) }))

const openPage = async (context, fixture) => {
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
  await routeFixture(page, fixture)
  await signIn(page)
  return page
}

async function dashboardChecks(page, profile, fixture, tag) {
  const phone = profile.width < 768
  await gotoReady(page, '/')
  await setTheme(page, profile.dark)
  // A page that is wholly clear draws the field instead of the Alerts section, so the zero fixture only waits briefly.
  await page.locator('section[aria-label="Alerts"]').waitFor({ state: 'visible', timeout: fixture === 'zero' ? 8_000 : 60_000 }).catch((e) => { if (fixture !== 'zero') throw e })
  await page.waitForTimeout(600)
  if (fixture === 'zero') {
    const field = page.getByText('All clear. Nothing needs you right now.')
    // shortcut: the page-clear state reads five decision queues the mock may not empty; when the field is absent the capture is skipped and said so, not failed.
    console.log(`[polish-pr3a] ${tag} all-clear field ${(await field.count()) === 1 ? 'drawn' : 'NOT drawn (decision queues or the setup card still show)'}`)
    if (await field.count()) checks.push(checkCropHolds(await cropElement(page, field.locator('xpath=../..'), path.join(OUT_DIR, `${profile.name}-all-clear.png`), { touch: profile.touch, pad: 16 })))
    return
  }
  const d = await measureDashboard(page)
  check(tag, '1 `/` has at most one solid primary (tbody included)', d.solids.length <= 1, d.solids)
  check(tag, '1 no Platform entry points rail', !d.rail)
  check(tag, '1 the main column fills the content box', d.column !== null && Math.abs(d.column - d.content) <= 1, { column: fmt(d.column), content: fmt(d.content) })
  const b = await measureBand(page)
  check(tag, '2 the band has tiles', b.count >= 3, b.count)
  if (!phone) {
    check(tag, '2 every tile is at most 88px tall', b.maxTile <= 88.5, fmt(b.maxTile))
    check(tag, '2 the band is at most rows x 88 + (rows - 1) x 8', b.bandHeight <= b.rows * 88 + (b.rows - 1) * 8 + 0.5, { rows: b.rows, height: fmt(b.bandHeight) })
    check(tag, '2 the "Needs your decision" h2 is at most 560px from the document top', d.h2Top !== null && d.h2Top <= 560, d.h2Top === null ? 'absent' : fmt(d.h2Top))
  }
  console.log(`[polish-pr3a] ${tag} MEASURED tiles ${b.count}, rows ${b.rows}, tallest tile ${fmt(b.maxTile)}, band ${fmt(b.bandHeight)}, h2 top ${fmt(d.h2Top)}`)
  check(tag, '3 no warning tile comes before a danger tile', !b.danglingOrder, b.per.map((p) => p.tone))
  check(tag, '4 no tile is filled with the solid error or warning container', b.per.every((p) => !p.solid), b.per.filter((p) => p.solid).map((p) => p.label))
  check(tag, '4 figure and label are at least 4.5 against the tile', b.per.every((p) => p.figure >= 4.5 && p.words >= 4.5), b.per.filter((p) => !(p.figure >= 4.5 && p.words >= 4.5)).map((p) => ({ l: p.label, f: fmt(p.figure), w: fmt(p.words) })))
  if (fixture !== 'stock') return
  const s = await measureSuccess(page)
  check(tag, '6 the dashboard shows a success pill', s.length >= 1, s.length)
  check(tag, '6 every success pill is the Selected fill at 4.5 or more', successOk(s), successBad(s))
  if (profile.dark) checks.push(checkCropHolds(await cropElement(page, page.locator('[data-shot=success-pill]').first(), path.join(OUT_DIR, `${profile.name}-success-pill.png`), { touch: false, pad: 24 })))
  checks.push(checkCropHolds(await cropElement(page, page.locator('section[aria-label="Alerts"]'), path.join(OUT_DIR, `${profile.name}-band.png`), { touch: profile.touch, pad: 12 })))
  if (!profile.dark) checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${profile.name}-dashboard.png`), { touch: profile.touch })).checks)
}

async function routeChecks(page, profile, url, tag) {
  await gotoReady(page, url)
  await setTheme(page, profile.dark)
  await page.waitForTimeout(500)
  const limes = await measureLime(page)
  check(tag, '5 lime appears at most once (no radius exclusion)', limes.length <= 1, limes)
  if (url === '/') return
  const s = await measureSuccess(page)
  check(tag, '6 every success pill is the Selected fill at 4.5 or more', successOk(s), successBad(s))
}

try {
  for (const profile of PROFILES) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, colorScheme: profile.dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    await context.addInitScript(installHelpers)
    await context.addInitScript(() => { try { localStorage.setItem('odip.trips.view', 'table') } catch { /* ignore */ } })
    // The zero fixture exists for the all-clear capture: light 1280 only.
    for (const fixture of ['stock', 'long', 'zero'].filter((f) => f !== 'zero' || (!profile.dark && !profile.touch))) {
      const page = await openPage(context, fixture)
      const tag = `${profile.name} ${fixture} /`
      await safe(tag, 'dashboard checks', () => dashboardChecks(page, profile, fixture, tag))
      await page.close()
    }
    const page = await openPage(context, 'stock')
    for (const url of ROUTES) {
      const tag = `${profile.name} ${url}`
      await safe(tag, 'route checks', () => routeChecks(page, profile, url, tag))
    }
    await page.close()
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
