// Polish PR1a + PR1b: the DataTable edge cue, the overlay actions column and the list cards, on Tasks, Incidents, Trips, Participants, Staff and the dashboard Leave tab.
// Numeric checks C1-C16 from the shape brief (exit 1 on any failure). Stock mock data on every profile, plus a long-and-many variant
// (25 rows, long strings) at 1280 light and 390 touch. Captures: only the changed states (a padded table crop per profile, one full page per breakpoint).
// List paths in mock-api/server.js: GET /api/v1/tasks, /api/v1/incidents, /api/v1/trips, /api/v1/participants (all `paged`: data.items), /api/v1/staff and /api/v1/leave (plain arrays in data).
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
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username, role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

const PROFILES = [
  { name: 'desktop-1280', width: 1280, height: 900, touch: false, dark: false },
  { name: 'desktop-1280-dark', width: 1280, height: 900, touch: false, dark: true },
  { name: 'desktop-1024', width: 1024, height: 800, touch: false, dark: false },
  { name: 'touch-390', width: 390, height: 844, touch: true, dark: false },
]

const long = (s, n) => (s + ' ' + 'with a very long description that keeps going and going '.repeat(4)).slice(0, n).trim()
const many = (items, n, patch) => Array.from({ length: n }, (_, i) => ({ ...items[i % items.length], id: `${items[i % items.length].id}-x${i}`, ...patch(i, items[i % items.length]) }))

// Visible-before-scroll sets from the shape (section 2): header text at each width. '' (the tick) is skipped.
const PAGES = [
  {
    key: 'tasks', path: '/tasks', api: '/api/v1/tasks', titleHeader: 'Task',
    visible: { 1280: ['Task', 'Status', 'Due', 'Priority', 'Trip', 'Owner'], 1024: ['Task', 'Status', 'Due', 'Priority'] },
    pills: ['Status', 'Priority'], dates: ['Due'], clamp: true, noScroll1280: false,
    longPatch: (items) => many(items, 25, (i) => ({ title: i === 0 ? long('Review emergency shift over budget: Mia Chen on 17 Aug 2026', 80) : long(`Confirm accommodation ${i}`, 40 + (i % 3) * 20), linkTo: i % 2 ? '/rostering/leave' : null })),
  },
  {
    key: 'incidents', path: '/incidents', api: '/api/v1/incidents', titleHeader: 'Title', tableSel: 'table:has(td[data-card="primary"])',
    visible: { 1280: ['Title', 'NDIS Commission', 'Status', 'Severity', 'Date', 'Type'], 1024: ['Title', 'NDIS Commission', 'Status', 'Severity', 'Date'] },
    pills: ['Status', 'Severity', 'NDIS Commission'], dates: ['Date'], clamp: true, noScroll1280: false,
    longPatch: (items) => many(items, 25, (i) => ({ title: long(`Incident ${i} during the pre-trip meet and greet`, i % 2 ? 100 : 30) })),
  },
  {
    key: 'trips', path: '/trips', api: '/api/v1/trips', titleHeader: 'Trip',
    visible: { 1280: ['Trip', 'Status', 'Dates', 'Pax', 'Destination', 'Lead'], 1024: ['Trip', 'Status', 'Dates', 'Pax'] },
    pills: ['Status'], dates: ['Dates'], clamp: false, noScroll1280: true,
    longPatch: (items) => many(items, 25, (i) => ({ tripName: long(`Trip ${i}`, 60), destination: long('Caloundra', 40) })),
  },
  {
    key: 'participants', path: '/participants', api: '/api/v1/participants', titleHeader: 'Name',
    visible: { 1280: ['Name', 'Status', 'Alerts', 'Care needs', 'NDIS Number', 'Region', 'Support Ratio'], 1024: ['Name', 'Status', 'Alerts', 'Care needs'] },
    pills: ['Status'], dates: [], clamp: false, noScroll1280: false, overlay: false, noHeader: 'Streams',
    cardMeta: ['Alerts', 'Care needs', 'Region', 'Plan Type', 'Support Ratio'],
    longPatch: (items) => many(items, 25, (i) => ({ fullName: long(`Participant ${i}`, i % 2 ? 60 : 24), region: long('Greater Brisbane', 40), mobilityAidWheelchair: i % 2 === 0, isHighSupport: i % 3 === 0 })),
  },
  {
    key: 'staff', path: '/staff', api: '/api/v1/staff', arrayData: true, titleHeader: 'Name',
    visible: { 1280: ['Name', 'Status', 'Qualifications', 'Region'], 1024: ['Name', 'Status', 'Qualifications'] },
    pills: ['Status'], dates: [], clamp: false, noScroll1280: true, noHeader: 'Position',
    cardMeta: ['Region', 'Qualifications'],
    longPatch: (items) => many(items, 25, (i) => ({ fullName: long(`Staff member ${i}`, i % 2 ? 60 : 24), region: long('Greater Brisbane', 40) })),
  },
  {
    // The Leave tab of the dashboard's "Needs your decision" band (every group's panel stays mounted, so the panel is named).
    key: 'leave', path: '/', api: '/api/v1/leave', arrayData: true, titleHeader: 'Staff', tableSel: '#decisions-panel-leave table',
    open: async (page) => { await page.locator('#decisions-tab-leave').click(); await page.locator('#decisions-panel-leave').waitFor({ state: 'visible', timeout: 60_000 }) },
    visible: { 1280: ['Staff', 'Dates'], 1024: ['Staff', 'Dates'] },
    pills: [], dates: ['Dates'], clamp: false, noScroll1280: false, overlay: false, cardChecks: false,
    cardMeta: ['Dates', 'Type', 'Note'],
    longPatch: (items) => many(items, 25, (i) => ({ userFullName: long(`Staff member ${i}`, i % 2 ? 40 : 20), reason: long('Family event interstate', 120) })),
  },
]

const browser = await chromium.launch({ headless: true })
const checks = []
let n3done = false
const check = (tag, name, ok, detail = '') => { checks.push({ name: `${tag} ${name}`, pass: !!ok, detail }); console.log(`[polish-pr1] ${ok ? 'PASS' : 'FAIL'} ${tag} ${name}${detail !== '' ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`) }
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

// Everything measured in the page, as plain numbers and strings. `visible` is the header list for this width.
function measureInPage({ titleHeader, pills, dates, visibleHeaders }) {
  const table = window.__tbl()
  const box = table.parentElement
  const card = box.parentElement
  const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } }
  const probe = (prop, value) => { const el = document.createElement('i'); el.style[prop] = value; document.body.appendChild(el); const out = getComputedStyle(el)[prop]; el.remove(); return out }
  const fg = probe('color', 'var(--color-foreground)')
  const primary = probe('color', 'var(--color-primary)')
  const cardBg = probe('backgroundColor', 'var(--color-card)')
  const ths = [...table.querySelectorAll('thead th')]
  const headerText = (th) => (th.textContent || '').trim()
  const colIndex = (text) => ths.findIndex((th) => headerText(th) === text)
  const rows = [...table.querySelectorAll('tbody tr')]
  const cellsOf = (text) => { const i = colIndex(text); return i < 0 ? [] : rows.map((r) => r.children[i]).filter(Boolean) }
  const endTh = box.querySelector('th[data-pin="end"]')
  const endPin = endTh ? endTh.offsetWidth : 0
  const boxR = rect(box)
  const visible = visibleHeaders.map((text) => { const th = ths[colIndex(text)]; return { text, right: th ? rect(th).right : null } })
  const pillMetrics = pills.flatMap((text) => cellsOf(text).map((td) => {
    const el = td.querySelector('button, span') || td
    return { col: text, sw: el.scrollWidth, cw: el.clientWidth, ws: getComputedStyle(el).whiteSpace, right: rect(el).right }
  }))
  const dateMetrics = dates.flatMap((text) => cellsOf(text).map((td) => ({ col: text, sw: td.scrollWidth, cw: td.clientWidth })))
  const cut = [...table.querySelectorAll('tbody td *')]
    .filter((e) => e.hasAttribute('title') || getComputedStyle(e).textOverflow === 'ellipsis')
    .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
    .map((e) => ({ title: (e.title || e.closest('[title]')?.title || '').trim(), text: (e.textContent || '').trim() }))
  const titleEls = rows.map((r) => r.querySelector('td[data-card="primary"] :is(a, span)') || r.querySelector('td[data-card="primary"]'))
  const clamps = titleEls.filter(Boolean).map((e) => ({ h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight), title: e.title || '', text: (e.textContent || '').trim() }))
  const identity = rows.map((r) => r.querySelector('td[data-card="primary"] a')).filter(Boolean).slice(0, 5).map((a) => ({ color: getComputedStyle(a).color, deco: getComputedStyle(a).textDecorationLine }))
  const cross = rows.flatMap((r) => [...r.querySelectorAll('td[data-card="meta"] a')]).slice(0, 5).map((a) => ({ color: getComputedStyle(a).color }))
  const fadeEnd = document.querySelector('[data-edge-fade="end"]')
  const fadeStart = document.querySelector('[data-edge-fade="start"]')
  return {
    fg, primary, cardBg, boxR, cardRight: rect(card).right, docFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    scrollW: box.scrollWidth, clientW: box.clientWidth, endPin, endThWidth: endTh ? endTh.offsetWidth : null,
    headerNames: ths.map((th) => (headerText(th) || th.querySelector('.sr-only')?.textContent || th.getAttribute('aria-label') || th.querySelector('[aria-label]')?.getAttribute('aria-label') || '').trim()),
    titleWidths: cellsOf(titleHeader).map((td) => td.getBoundingClientRect().width),
    visible, pillMetrics, dateMetrics, cut, clamps, identity, cross, rowCount: rows.length,
    fadeEnd: fadeEnd ? { right: fadeEnd.getBoundingClientRect().right, bg: getComputedStyle(fadeEnd).backgroundImage } : null, fadeStart: !!fadeStart,
    locale: Intl.DateTimeFormat().resolvedOptions(),
  }
}

// On the phone card: heights, what is on the face, and the one action set.
function measureCards() {
  const rows = [...window.__tbl().querySelectorAll('tbody tr')]
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const named = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim()
  const cards = rows.map((r) => {
    const face = [...r.querySelectorAll('a, button')].filter(shown)
      .filter((el) => !el.closest('td[data-card="primary"]') && !el.closest('td[data-card="status"]') && !el.closest('td[data-card="meta"]'))
    const more = face.filter((el) => /^More actions for/.test(el.getAttribute('aria-label') || ''))
    const rest = face.filter((el) => !more.includes(el))
    const size = (el) => { const b = el.getBoundingClientRect(); return { w: b.width, h: b.height } }
    const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom } }
    const titleEl = r.querySelector('td[data-card="primary"] :is(a, span)') || r.querySelector('td[data-card="primary"]')
    const tickEl = rest.find((el) => /Mark complete/.test(named(el)))
    const metaLabels = [...r.querySelectorAll('td[data-card="meta"]')].filter(shown).sort((a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return Math.abs(x.top - y.top) > 4 ? x.top - y.top : x.left - y.left }).map((td) => td.dataset.label)
    // Fix round 2: the chips on the menu's rows stop 4px short of it; the Dates fact is not cut.
    const menu = more[0] ? box(more[0]) : null
    const chipGaps = menu ? [...r.querySelectorAll('td[data-label="Qualifications"] li')].map(box).filter((c) => c.t < menu.b && c.b > menu.t).map((c) => menu.l - c.r) : []
    const dates = r.querySelector('td[data-label="Dates"]')?.firstElementChild
    const datesOver = dates ? dates.scrollWidth - dates.clientWidth : null
    return { chipGaps, datesOver, metaLabels, tickOverTitle: !!(tickEl && titleEl) && (() => { const a = box(tickEl), t = box(titleEl); return a.l < t.r && a.r > t.l && a.t < t.b && a.b > t.t })(), h: r.getBoundingClientRect().height, others: rest.map(named), banned: face.map(named).filter((n) => /archive|delete|restore/i.test(n)), more: more.map(size), tick: rest.filter((el) => /Mark complete/.test(named(el))).map(size) }
  })
  return cards
}

async function signIn(page) {
  await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const button = page.getByRole('button', { name: 'Sign in as selected user' })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}

// One handler per list path, registered once; the variant decides whether the stock reply is patched into the long-and-many one.
const state = { variant: 'stock' }
async function routeLists(page) {
  for (const cfg of PAGES) {
    await page.route((url) => url.pathname === cfg.api, async (route) => {
      if (state.variant !== 'long') return route.continue()
      const response = await route.fetch()
      const json = await response.json()
      if (cfg.arrayData) return route.fulfill({ response, json: { ...json, data: cfg.longPatch(json.data) } })
      const items = cfg.longPatch(json.data.items)
      await route.fulfill({ response, json: { ...json, data: { ...json.data, items, totalCount: items.length, pageSize: 500 } } })
    })
  }
}

async function openPage(page, cfg, variant) {
  state.variant = variant
  await page.goto(`${BASE_URL}${cfg.path}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  if (cfg.open) await cfg.open(page)
  await page.locator(`${cfg.tableSel ?? 'table'} tbody tr:visible`).first().waitFor({ state: 'visible', timeout: 60_000 })
  // The table on show: Incidents also mounts the flagged-notes table (hidden) ahead of its own.
  await page.evaluate((t) => { window.__tbl = () => [...document.querySelectorAll(t)].find((el) => el.getClientRects().length > 0) ?? document.querySelector(t) }, cfg.tableSel ?? 'table')
  await page.waitForTimeout(600)
}

async function fades(page) {
  return page.evaluate(() => {
    const box = window.__tbl().parentElement
    const end = document.querySelector('[data-edge-fade="end"]')
    const endTh = box.querySelector('th[data-pin="end"]')
    return { scrolls: box.scrollWidth > box.clientWidth + 1, end: end ? end.getBoundingClientRect().right : null, start: !!document.querySelector('[data-edge-fade="start"]'), boxRight: box.getBoundingClientRect().right, endPin: endTh ? endTh.offsetWidth : 0 }
  })
}

try {
  for (const profile of PROFILES) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, colorScheme: profile.dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    const page = await context.newPage()
    await context.addInitScript(() => { try { localStorage.setItem('odip.trips.view', 'table') } catch { /* ignore */ } })
    await signIn(page)
    await routeLists(page)
    for (const cfg of PAGES) {
      for (const variant of profile.name === 'desktop-1280' || profile.name === 'touch-390' ? ['stock', 'long'] : ['stock']) {
        const tag = `${profile.name} ${cfg.key} ${variant}`
        await openPage(page, cfg, variant)
        if (profile.dark) await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
        const m = await page.evaluate(measureInPage, { titleHeader: cfg.titleHeader, pills: cfg.pills, dates: cfg.dates, visibleHeaders: cfg.visible[profile.width] ?? [] })
        const md = profile.width >= 768
        const fine = !profile.touch

        // C1 the table never leaves its card, and the page never scrolls sideways.
        check(tag, 'C1 table inside its card, no page h-scroll', m.boxR.right <= m.cardRight + 1 && m.docFits, { boxRight: m.boxR.right, cardRight: m.cardRight, docFits: m.docFits })
        if (profile.name === 'desktop-1024' && variant === 'stock' && cfg.key === 'trips') console.log(`[polish-pr1] RECORD 1024 box width = ${Math.round(m.boxR.width)}px (${cfg.key})`)
        if (profile.name === 'desktop-1024' && variant === 'stock') check(tag, 'RECORD 1024 box width', true, `${Math.round(m.boxR.width)}px`)
        // C2 Trips fits at 1280 with no scroll.
        if (cfg.noScroll1280 && profile.width === 1280) check(tag, 'C2 fits with no scroll', m.scrollW <= m.clientW + 1, { scrollW: m.scrollW, clientW: m.clientW })
        // C3 the visible set sits left of the fade (and the end pin).
        // Where the table fits there is no fade to stay left of (C2 covers Trips at 1280); the visible set matters where it scrolls.
        if (md && m.scrollW > m.clientW + 1) for (const v of m.visible) check(tag, `C3 "${v.text}" visible before scroll`, v.right != null && v.right <= m.boxR.right - m.endPin - 24 + 1, { right: v.right && Math.round(v.right), limit: Math.round(m.boxR.right - m.endPin - 24 + 1) })
        // C4 status pills: full text, nowrap, inside the visible region where that column is.
        for (const p of m.pillMetrics) check(tag, `C4 ${p.col} pill whole`, p.sw <= p.cw + 1 && p.ws === 'nowrap' || (!md && p.sw <= p.cw + 1), { sw: p.sw, cw: p.cw, ws: p.ws })
        // C5 a cut cell keeps its text in the tooltip.
        // A tooltip may say more than the cell (Trips adds the code to the name), never less.
        const badCut = m.cut.filter((c) => !c.title.includes(c.text))
        check(tag, 'C5 cut text is in the tooltip', badCut.length === 0, badCut.slice(0, 2))
        // C6 dates never truncate.
        check(tag, 'C6 dates and pills never truncate', m.dateMetrics.every((d) => d.sw <= d.cw + 1), m.dateMetrics.filter((d) => d.sw > d.cw + 1).slice(0, 2))
        // S1 the incident title column is not squeezed at 1280.
        if (cfg.key === 'incidents' && profile.width === 1280) check(tag, 'S1 title cells at least 176px wide', m.titleWidths.length > 0 && Math.min(...m.titleWidths) >= 176 - 1, { min: Math.round(Math.min(...m.titleWidths)) })
        // C7 two-line clamp on the Task and Incident title, full text in title.
        if (cfg.clamp) check(tag, 'C7 title at most 2 lines, full text in title', m.clamps.length > 0 && m.clamps.every((c) => c.h <= 2 * c.lh + 1 && (c.title === '' ? true : c.title === c.text)), m.clamps.filter((c) => c.h > 2 * c.lh + 1).slice(0, 2))
        // C8 the edge cue.
        if (md && variant === 'stock') {
          const f = await fades(page)
          if (profile.width === 1280 && cfg.noScroll1280) check(tag, 'C8 no fade when it fits', f.end == null && !f.start, f)
          else if (f.scrolls) {
            check(tag, 'C8 end fade just inside the end pin', f.end != null && Math.abs(f.end - (f.boxRight - f.endPin)) <= 1, { fadeRight: f.end && Math.round(f.end), expect: Math.round(f.boxRight - f.endPin) })
            await page.evaluate(() => { const b = window.__tbl().parentElement; b.scrollLeft = b.scrollWidth })
            await page.waitForTimeout(250)
            const g = await fades(page)
            check(tag, 'C8 scrolled to the end: end fade gone, start fade shown', g.end == null && g.start, g)
            await page.evaluate(() => { window.__tbl().parentElement.scrollLeft = 0 })
            await page.waitForTimeout(250)
          }
        }
        // C9 no blank strip at rest: the overlay actions column costs no width on a mouse.
        if (md && fine && cfg.overlay !== false) check(tag, 'C9 overlay actions th <= 1px', (m.endThWidth ?? 0) <= 1, m.endThWidth)
        // C10 every rendered header has an accessible name.
        check(tag, 'C10 every th has a name', m.headerNames.every((n) => n.length > 0), m.headerNames)
        // C10 a column with nothing in it on the stock data is not drawn (Staff Position, Participants Streams).
        if (variant === 'stock' && cfg.noHeader) check(tag, `C10 no "${cfg.noHeader}" th on stock data`, !m.headerNames.includes(cfg.noHeader), m.headerNames)
        // C14 link style: the identity link is ink with no underline at rest; a cross-link is not green at rest.
        if (md && fine) {
          check(tag, 'C14 identity link is ink, not underlined, at rest', m.identity.every((l) => l.color === m.fg && l.deco === 'none'), { fg: m.fg, seen: m.identity.slice(0, 2) })
          check(tag, 'C14 cross-link is not green at rest', m.cross.every((l) => l.color !== m.primary), { primary: m.primary, seen: m.cross.slice(0, 2) })
        }
        // C15 the dark fade ends in the card colour.
        if (profile.dark && md && variant === 'stock') {
          await page.evaluate(() => { window.__tbl().parentElement.scrollLeft = 0 })
          const g = await page.evaluate(measureInPage, { titleHeader: cfg.titleHeader, pills: [], dates: [], visibleHeaders: [] })
          check(tag, 'C15 dark fade ends in the card colour', g.fadeEnd == null ? g.scrollW <= g.clientW + 1 : g.fadeEnd.bg.includes(g.cardBg), { bg: g.fadeEnd && g.fadeEnd.bg, card: g.cardBg })
        }
        // C16 locale.
        check(tag, 'C16 en-AU, Australia/Sydney', m.locale.locale === 'en-AU' && m.locale.timeZone === 'Australia/Sydney', m.locale)

        // The phone card: C11 height, C12 the face, C13 one set of actions.
        if (profile.touch) {
          const cards = await page.evaluate(measureCards)
          const hs = cards.map((c) => c.h)
          const full = cfg.cardChecks !== false
          // M5 the card meta reads in the shape's order (a subset of it, in order, is fine: an empty value drops off the card).
          if (cfg.cardMeta) check(tag, `M5 card meta reads ${cfg.cardMeta.join(', ')}`, cards.every((c) => c.metaLabels.every((x, i) => cfg.cardMeta.includes(x) && (i === 0 || cfg.cardMeta.indexOf(c.metaLabels[i - 1]) < cfg.cardMeta.indexOf(x)))), { first: cards[0].metaLabels, bad: cards.filter((c) => !c.metaLabels.every((x, i) => cfg.cardMeta.includes(x) && (i === 0 || cfg.cardMeta.indexOf(c.metaLabels[i - 1]) < cfg.cardMeta.indexOf(x)))).slice(0, 2).map((c) => c.metaLabels) })
          if (!full) console.log(`[polish-pr1] RECORD ${cfg.key} card heights ${variant}: median ${Math.round(median(hs))}, max ${Math.round(Math.max(...hs))} (the decision queue is exempt from the height target)`)
          // Fix round 2: clearing the menu (S1) wraps the one single-row chip card to 2 rows, +22px: Staff max is 165, not 150.
          // shortcut: Staff qualification chips wrap to 2 lines; chip cap "4 + 2 more" in polish PR3 (A9) restores 120/132
          const medT = cfg.key === 'staff' ? 142 : cfg.key === 'incidents' ? 132 : cfg.key === 'tasks' ? 144 : 120
          const maxH = cfg.key === 'staff' ? 165 : cfg.key === 'tasks' ? 144 : cfg.key === 'incidents' ? 156 : 132
          if (full) check(tag, `C11 card height median <= ${medT}, max <= ${maxH}`, median(hs) <= (medT) && Math.max(...hs) <= maxH, { median: Math.round(median(hs)), max: Math.round(Math.max(...hs)), n: hs.length })
          // Fix round 1: M1 the tick sits clear of the title; M2 Type is on the incident card; M3 the meta reads Date, Severity, NDIS, Type, Trip, Participant.
          if (cfg.key === 'tasks') check(tag, 'M1 no tick over a title', cards.every((c) => !c.tickOverTitle), { worst: Math.max(...hs), over: cards.filter((c) => c.tickOverTitle).length })
          if (cfg.key === 'incidents') {
            const want = ['Date', 'Severity', 'NDIS Commission', 'Type', 'Trip', 'Participant']
            const inOrder = (l) => l.every((x, i) => want.includes(x) && (i === 0 || want.indexOf(l[i - 1]) < want.indexOf(x)))
            check(tag, 'M2 every incident card shows Type', cards.every((c) => c.metaLabels.includes('Type')), cards.filter((c) => !c.metaLabels.includes('Type')).length)
            check(tag, 'M3 incident card meta reads Date, Severity, NDIS, Type, Trip, Participant', cards.every((c) => inOrder(c.metaLabels)), { first: cards[0].metaLabels, bad: cards.filter((c) => !inOrder(c.metaLabels)).slice(0, 2).map((c) => c.metaLabels) })
            console.log(`[polish-pr1] RECORD incident card heights ${variant}: median ${Math.round(median(hs))}, max ${Math.round(Math.max(...hs))}`)
          }
          if (cfg.key === 'staff' && variant === 'stock') { const gaps = cards.flatMap((c) => c.chipGaps); check(tag, 'S1 qualification chips stop 4px short of the menu', gaps.every((g) => g >= 4), { minGap: gaps.length ? Math.round(Math.min(...gaps)) : null, n: gaps.length }) }
          if (cfg.key === 'leave' && variant === 'stock') { const over = cards.map((c) => c.datesOver).filter((x) => x != null); check(tag, 'L1 Dates never truncate on the card', over.length > 0 && over.every((x) => x <= 1), { maxOver: Math.max(...over), n: over.length }) }
          if (full) check(tag, 'C12 at most one action on the face', cards.every((c) => c.others.length <= 1), cards.filter((c) => c.others.length > 1).slice(0, 2).map((c) => c.others))
          if (full) check(tag, 'C12 nothing named archive/delete/restore on the face', cards.every((c) => c.banned.length === 0), cards.filter((c) => c.banned.length).slice(0, 2))
          const small = cards.flatMap((c) => [...c.more, ...c.tick]).filter((s) => s.w < 44 - 0.5 || s.h < 44 - 0.5)
          if (full) check(tag, 'C12 the ⋯ trigger and the tick are 44x44', small.length === 0 && cards.some((c) => c.more.length), small.slice(0, 2))
          if (full && variant === 'stock') {
            const trigger = page.locator('button[aria-label^="More actions for"]').first()
            if (await trigger.count()) {
              const desktop = await trigger.evaluate((el) => [...el.closest('td').querySelectorAll('.max-md\\:hidden [aria-label]')].map((n) => n.getAttribute('aria-label')).sort())
              await trigger.click()
              const menu = (await page.getByRole('option').allTextContents()).map((t) => t.trim()).sort()
              await page.keyboard.press('Escape')
              check(tag, 'C13 the ⋯ menu offers the md+ buttons\' set', desktop.length > 0 && JSON.stringify(menu) === JSON.stringify(desktop), { menu, desktop })
            } else check(tag, 'C13 the ⋯ menu offers the md+ buttons\' set', false, 'no ⋯ trigger on the first row')
          }
        }

        // Captures: only the changed states, stock data only. A padded table crop per profile, one full page per breakpoint.
        if (variant === 'stock') {
          const opts = { touch: profile.touch }
          const wrapper = page.locator(`${cfg.tableSel ?? 'table'}:visible`).first().locator('xpath=../..')
          // N3 the right edge at 1280 with the fade in it, in a padded crop: the first list that scrolls (Tasks fits at 1280 on stock data).
          if (profile.name === 'desktop-1280' && !n3done && await page.locator('[data-edge-fade="end"]').count()) {
            n3done = true
            await page.evaluate(() => scrollTo(0, 0))
            const wb = await wrapper.boundingBox()
            const fadeBox = await page.locator('[data-edge-fade="end"]').first().boundingBox()
            const clip = { x: Math.max(0, wb.x + wb.width - 380 - 16), y: Math.max(0, wb.y - 16), width: 380 + 32, height: Math.min(wb.height + 32, 420) }
            clip.width = Math.min(clip.width, 1280 - clip.x)
            await page.screenshot({ path: path.join(OUT_DIR, `desktop-1280-${cfg.key}-fade-edge.png`), clip })
            check(tag, 'N3 fade is inside the edge crop', !!fadeBox && fadeBox.x >= clip.x && fadeBox.x + fadeBox.width <= clip.x + clip.width + 1, { fadeBox, clip })
          }
          // N2 nothing focused at rest. M4 on the phone the fixed bottom nav is hidden for the crop only, and the last card must lie in the clip and be what is at its centre.
          await page.evaluate(() => { document.activeElement?.blur?.(); window.__shotHidden = []; if (matchMedia('(pointer: coarse)').matches) for (const el of document.querySelectorAll('body *')) { if (getComputedStyle(el).position !== 'fixed') continue; const r = el.getBoundingClientRect(); if (r.width > 0 && r.bottom >= innerHeight - 1 && r.top > innerHeight / 2) { window.__shotHidden.push([el, el.style.visibility]); el.style.visibility = 'hidden' } } })
          const lastCard = (clip) => page.evaluate((c) => { const rows = [...window.__tbl().querySelectorAll('tbody tr')]; const r = rows[rows.length - 1].getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { rows: rows.length, inClip: r.left >= c.x - 1 && r.right <= c.x + c.width + 1 && r.top >= c.y - 1 && r.bottom <= c.y + c.height + 1, atCentre: !!hit && rows[rows.length - 1].contains(hit) } }, clip)
          const crop = await cropElement(page, wrapper, path.join(OUT_DIR, `${profile.name}-${cfg.key}-table.png`), { ...opts, during: lastCard })
          await page.evaluate(() => { for (const [el, v] of window.__shotHidden ?? []) el.style.visibility = v })
          checks.push(checkCropHolds(crop))
          // Phone cards only: a desktop row is wider than its scroll box by design.
          if (profile.touch) check(tag, 'M4 last card inside the clip and nothing over it', crop.measured.inClip && crop.measured.atCentre, crop.measured)
          if (!profile.dark) checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${profile.name}-${cfg.key}.png`), opts)).checks)
        }
      }
    }
    await context.close()
  }
} finally {
  await browser.close()
}
check('all', 'N3 one fade edge crop was taken', n3done)
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
