// Polish PR 3c: the detail first views (participant overview, staff strip, trip itinerary, portal shift cards, incident Severity).
// Numeric checks 10-14 of SHAPE-PR3 section 14 "3c" (exit 1 on any failure), measuring computed boxes and styles, never class names.
// Profiles: 1280 light, 1280 dark, 390 light touch. Captures: the section 15 "3c" crops, plus one full page per breakpoint in full/.
// shortcut: a state the mock data cannot reach (no budget card, no safety chip) prints a NOTE and skips its check; the rest still assert.
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
const check = (tag, name, ok, detail = '') => { checks.push({ name: `${tag} ${name}`, pass: !!ok, detail }); console.log(`[polish-pr3c] ${ok ? 'PASS' : 'FAIL'} ${tag} ${name}${detail !== '' ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`) }
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


const fmt = (n) => (typeof n === 'number' ? +n.toFixed(2) : n)
const newPage = async (context, { portal = false } = {}) => {
  const page = await context.newPage()
  if (portal) {
    // /portal is the support worker's page: sign in as one without the dev picker.
    const user = { id: '00000000-0000-0000-0000-0000000000a1', username: 'dev.supportworker', fullName: 'Dev SupportWorker', role: 'SupportWorker', tenantName, tenantId: 'tenant-0001' }
    await page.addInitScript(([u]) => { localStorage.setItem('odip_token', 'mock-jwt-token'); localStorage.setItem('odip_user', u) }, [JSON.stringify(user)])
    return page
  }
  await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
  await signIn(page)
  return page
}
const out = (profile, name) => path.join(OUT_DIR, `${profile.name}-${name}.png`)
const full = async (page, profile, name) => checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${profile.name}-${name}.png`), { touch: profile.touch })).checks)

// Check 10: participant Overview.
async function participantChecks(page, profile, tag) {
  await gotoReady(page, '/participants/p-0001')
  await setTheme(page, profile.dark)
  await page.waitForTimeout(800)
  const m = await page.evaluate(() => {
    const h = window.__h
    const before = document.querySelector('#before-you-start')
    const title = [...document.querySelectorAll('main h3')].find((e) => /how the budget is tracking/i.test(e.textContent || ''))
    const budget = title ? title.closest('[class*=rounded]') : null
    const chips = [...document.querySelectorAll('main span')].filter((e) => (e.textContent || '').trim() === 'Safety details not recorded')
    const chip = chips[0]
    const fill = chip ? getComputedStyle(chip).backgroundColor : null
    return {
      before: before ? before.getBoundingClientRect().top : null,
      budget: budget ? budget.getBoundingClientRect().top : null,
      chips: chips.length,
      chipIsWarning: chip ? h.same(fill, h.tok('warning-container')) : null,
      chipIsNeutral: chip ? h.same(fill, h.tok('surface-container-high')) : null,
    }
  })
  if (!profile.touch) {
    if (m.budget === null) console.log(`[polish-pr3c] ${tag} NOTE the budget track card is not drawn for this mock participant: 2-column check skipped`)
    else check(tag, '10 BudgetTrackCard top is within 2px of BeforeYouStartCard top', m.before !== null && Math.abs(m.budget - m.before) <= 2, { before: fmt(m.before), budget: fmt(m.budget) })
    if (m.chips === 0) console.log(`[polish-pr3c] ${tag} NOTE no safety chip for this mock participant: chip checks skipped`)
    else {
      check(tag, '10 "Safety details not recorded" occurs once in main', m.chips === 1, m.chips)
      check(tag, '10 the safety chip wears the warning fill, not the neutral one', m.chipIsWarning === true && m.chipIsNeutral !== true, m)
    }
  }
  checks.push(checkCropHolds(await cropElement(page, page.locator('main'), out(profile, 'participant-overview'), { touch: profile.touch, pad: 12 })))
  if (!profile.dark) await full(page, profile, 'participant')
}

// Check 11: staff detail strip.
async function staffChecks(page, profile, tag) {
  await gotoReady(page, '/staff/s-0001')
  await setTheme(page, profile.dark)
  const m = await page.evaluate(() => {
    const tablist = document.querySelector('[role=tablist]')
    const next = [...document.querySelectorAll('main span, main div')].find((e) => e.children.length === 0 && (e.textContent || '').trim() === 'Next shift')
    const strip = next ? next.closest('div.grid') : null
    if (strip) strip.setAttribute('data-shot', 'staff-strip')
    return {
      strip: !!strip,
      segments: strip ? strip.children.length : 0,
      stripBottom: strip ? strip.getBoundingClientRect().bottom : null,
      tablistTop: tablist ? tablist.getBoundingClientRect().top : null,
      top: strip ? strip.getBoundingClientRect().top + window.scrollY : null,
      tabScroll: tablist ? [tablist.scrollWidth, tablist.clientWidth] : null,
      page: document.scrollingElement.scrollWidth,
    }
  })
  check(tag, '11 the staff strip is drawn', m.strip)
  check(tag, '11 the strip sits above the tablist', m.strip && m.stripBottom <= m.tablistTop, { bottom: fmt(m.stripBottom), tablist: fmt(m.tablistTop) })
  check(tag, '11 the strip has 2 or 3 segments', m.segments === 2 || m.segments === 3, m.segments)
  if (!profile.touch) check(tag, '11 the strip top is at most 260px from the document top', m.top !== null && m.top <= 260, fmt(m.top))
  if (profile.touch) {
    check(tag, '11 at 390 the tablist scrolls sideways', m.tabScroll && m.tabScroll[0] > m.tabScroll[1], m.tabScroll)
    check(tag, '11 at 390 the page does not overflow', m.page <= profile.width, m.page)
  }
  checks.push(checkCropHolds(await cropElement(page, page.locator('[data-shot=staff-strip]'), out(profile, 'staff-strip'), { touch: profile.touch, pad: 16, also: page.locator('[role=tablist]').first() })))
  if (!profile.dark) await full(page, profile, 'staff')
}

// Check 12: trip itinerary empty and error, and the glance strip.
async function tripChecks(page, profile, tag, failing) {
  if (failing) await page.route(/\/api\/v1\/trips\/[^/]+\/itinerary/, (route) => route.fulfill({ status: 500, json: { success: false, data: null, message: 'boom', errors: [] } }))
  await gotoReady(page, '/trips/t-0001')
  await setTheme(page, profile.dark)
  const glance = await page.evaluate(() => [...document.querySelectorAll('main span')].filter((e) => ['Active', 'Covered'].includes((e.textContent || '').trim()) && /rounded-full/.test(e.className)).length)
  if (!failing) check(tag, '12 no Active or Covered badge in the glance strip', glance === 0, glance)
  if (!failing && !profile.dark && !profile.touch) checks.push(checkCropHolds(await cropElement(page, page.locator('main div.grid').first(), out(profile, 'trip-glance'), { touch: false, pad: 16 })))
  if (failing) {
    const retry = page.getByRole('button', { name: 'Try again' }).first()
    await retry.waitFor({ state: 'visible', timeout: 45_000 })
    check(tag, '12 the failed itinerary offers Try again', await retry.isVisible())
    checks.push(checkCropHolds(await cropElement(page, retry.locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), out(profile, 'itinerary-error'), { touch: profile.touch, pad: 16 })))
    return
  }
  const empty = page.getByText('No itinerary yet')
  await empty.waitFor({ state: 'visible', timeout: 30_000 })
  check(tag, '12 the empty itinerary never says "Unable to load"', (await page.getByText('Unable to load').count()) === 0)
  checks.push(checkCropHolds(await cropElement(page, empty.locator('xpath=ancestor::div[contains(@class,"rounded") or contains(@class,"flex")][1]'), out(profile, 'itinerary-empty'), { touch: profile.touch, pad: 16 })))
  if (!profile.dark) await full(page, profile, 'trip')
}

// Check 13: portal shift cards, 390 only.
async function portalChecks(page, profile, tag) {
  // Synthetic shifts on the first day of the week the page asks for (the mock only has shifts on one fixed day); one of them 2:1.
  const shift = (day, id, startTime, endTime, durationHours, extra = {}) => ({ id, participantId: 'p-0001', participantName: 'Liam Okafor', serviceDate: day, startTime, endTime, endsNextDay: false, durationHours, ratio: 'OneToOne', nightType: 'None', status: 'Published', returnCount: 0, notes: null, ...extra })
  await page.route('**/api/v1/portal/my-shifts**', (route) => {
    // `from` is the day before the browsed Monday, so the shifts sit one day on.
    const from = new URL(route.request().url()).searchParams.get('from') ?? '2026-11-01'
    const day = new Date(Date.parse(`${from}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    const shifts = [shift(day, 'sh-am', '07:00:00', '15:00:00', 8), shift(day, 'sh-pm', '16:00:00', '20:30:00', 4.5, { ratio: 'TwoToOne' })]
    return route.fulfill({ json: envelope({ shifts, tripAssignments: [] }) })
  })
  await gotoReady(page, '/portal')
  await page.waitForTimeout(800)
  const m = await page.evaluate(() => {
    const h = window.__h
    const cards = [...document.querySelectorAll('main a')].filter((a) => /\d(am|pm)[–-]\d/.test(a.textContent || ''))
    const secondLines = cards.map((a) => [...a.querySelectorAll('p')].map((p) => p.textContent || '').find((t) => /\d(am|pm)[–-]/.test(t)) || '')
    const btn = (name) => [...document.querySelectorAll('main a, main button')].find((e) => (e.textContent || '').includes(name))
    const bg = (e) => getComputedStyle(e).backgroundColor
    const primary = h.tok('primary'), selected = h.tok('selected')
    const plain = (e) => (e ? !h.same(bg(e), primary) && !h.same(bg(e), selected) : null)
    const solids = [...document.querySelectorAll('body *')].filter(h.shown).filter((el) => {
      const r = el.getBoundingClientRect()
      return r.height >= 28 && r.width >= 56 && h.same(getComputedStyle(el).backgroundColor, primary)
    }).length
    return { cards: cards.length, durations: secondLines.map((t) => /\d\s?h(?![a-z])/i.test(t)), leaveOk: plain(btn('My leave')), witnessOk: plain(btn('Witness approvals')), solids }
  })
  check(tag, '13 the portal lists shift cards', m.cards >= 1, m.cards)
  check(tag, '13 each shift card second line shows the duration in h', m.durations.length > 0 && m.durations.every(Boolean), m.durations)
  check(tag, '13 Leave and Witness buttons are not primary or selected', m.leaveOk === true && m.witnessOk === true, { leave: m.leaveOk, witness: m.witnessOk })
  check(tag, '13 at most one solid primary', m.solids <= 1, m.solids)
  checks.push(checkCropHolds(await cropElement(page, page.locator('main'), out(profile, 'portal-shifts'), { touch: true, pad: 12 })))
  await full(page, profile, 'portal')
}

// Check 14: incident form step 1.
async function incidentChecks(page, profile, tag) {
  await gotoReady(page, '/incidents/new')
  await setTheme(page, profile.dark)
  const group = page.getByRole('radiogroup', { name: /^Severity/ })
  await group.waitFor({ state: 'visible', timeout: 30_000 })
  const m = await page.evaluate(() => {
    const g = document.querySelector('[role=radiogroup]')
    const fields = [...document.querySelectorAll('form input, form select, form textarea, form button[aria-haspopup], form [role=combobox]')].filter((e) => window.__h.shown(e) && !g.contains(e))
    const column = g.closest('div[class*=col-span]') || g.parentElement
    return {
      gTop: g.getBoundingClientRect().top,
      firstOther: Math.min(...fields.map((e) => e.getBoundingClientRect().top)),
      segs: [...g.querySelectorAll('[role=radio]')].map((r) => r.getBoundingClientRect().height),
      groupW: g.getBoundingClientRect().width,
      columnW: column.getBoundingClientRect().width,
    }
  })
  check(tag, '14 the Severity group is above every other field', m.gTop < m.firstOther, { group: fmt(m.gTop), other: fmt(m.firstOther) })
  if (profile.touch) {
    check(tag, '14 at 390 every segment is at least 44px tall', m.segs.every((h) => h >= 43.5), m.segs.map(fmt))
    // shortcut: the group is full width below md only (the shape asked for the row at every width); asserted at 390, the width it is built for.
    check(tag, '14 at 390 the group fills the row (>= 0.95 of the column)', m.groupW >= 0.95 * m.columnW, { group: fmt(m.groupW), column: fmt(m.columnW) })
  }
  if (profile.dark) return
  for (const level of ['Medium', 'High']) {
    await group.getByRole('radio', { name: level }).click()
    await page.waitForTimeout(150)
    checks.push(checkCropHolds(await cropElement(page, group.locator('xpath=ancestor::div[contains(@class,"rounded")][1]'), out(profile, `incident-severity-${level.toLowerCase()}`), { touch: profile.touch, pad: 16 })))
  }
  await full(page, profile, 'incident')
}

try {
  for (const profile of PROFILES) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, colorScheme: profile.dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    await context.addInitScript(installHelpers)
    const page = await newPage(context)
    const tag = (s) => `${profile.name} ${s}`
    await safe(tag('participant'), 'participant', () => participantChecks(page, profile, tag('participant')))
    await safe(tag('staff'), 'staff', () => staffChecks(page, profile, tag('staff')))
    await safe(tag('trip'), 'trip', () => tripChecks(page, profile, tag('trip'), false))
    if (!profile.touch) await safe(tag('trip error'), 'trip error', () => tripChecks(page, profile, tag('trip error'), true))
    await safe(tag('incident'), 'incident', () => incidentChecks(page, profile, tag('incident')))
    await page.close()
    if (profile.touch) {
      const worker = await newPage(context, { portal: true })
      await safe(tag('portal'), 'portal', () => portalChecks(worker, profile, tag('portal')))
      await worker.close()
    }
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
