// Participant overview PR2: the budget limit line, the at-this-rate pace line, the reach dot and the renewal line on the shared chart (Overview and Funding tab).
// Keeps PR1's setup and checks 1-6, 9 and 11; adds SHAPE.md numeric checks 7 (labels >= 12px), 8 (mark strokes 3:1 on the card) and 10 (no label box on another label, a line or a dot).
// bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to this script> <outdir>
// Light theme pinned (colorScheme), Australian dates, reduced motion. The series is the mock's, reshaped here so each state is exact: `projected` (pace 10% over the limit, reach ahead),
// `past` (used 12% over the limit, reach behind) and `ontrack` (pace 8% under, no reach). Fictional figures only.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsersFor = (role) => envelope([{ username: 'dev.' + role.toLowerCase(), role, tenantName: 'Sample Support Co' }])
const devLoginFor = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.' + role.toLowerCase(), fullName: 'Dev ' + role, role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const TITLE = 'How the budget is tracking'
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: !!pass, detail })

const DAY = 86_400_000
const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY
const isoOf = (day) => new Date(day * DAY).toISOString().slice(0, 10)
const r2 = (n) => Math.round(n * 100) / 100
// Rescales each scope's spend so the state is exact, then works LimitReachedOn out by the server's rule (BudgetSeries.LimitReachedOn).
function reshape(series, mode) {
  const total = dayOf(series.planEnd) - dayOf(series.planStart) + 1
  const elapsed = dayOf(series.planIsCurrent ? series.today : series.planEnd) - dayOf(series.planStart) + 1
  for (const sc of series.scopes ?? []) {
    const s = sc.summary
    if (!s.used) continue
    const pace = (s.used * total) / elapsed
    const f = mode === 'past' ? (1.12 * sc.limit) / s.used : ((mode === 'projected' ? 1.1 : 0.92) * sc.limit) / pace
    for (const p of sc.points) for (const k of ['used', 'usedAndBooked']) if (p[k] !== undefined) p[k] = r2(p[k] * f)
    s.used = r2(s.used * f); s.aheadOfEven = r2(s.used - s.evenToDate)
    if (s.bookedEnd !== undefined) s.bookedEnd = r2(s.bookedEnd * f)
    if (series.planIsCurrent && s.pace !== undefined) { s.pace = r2((s.used * total) / elapsed); s.paceGapAtEnd = r2(s.pace - sc.limit) }
    if (!series.planIsCurrent) s.leftAtEnd = r2(sc.limit - s.used)
    delete s.limitReachedOn
    const over = sc.points.find((p) => p.used !== undefined && p.used >= sc.limit)
    if (over) s.limitReachedOn = over.date
    else if (s.pace !== undefined && s.pace > sc.limit) s.limitReachedOn = isoOf(dayOf(series.planStart) + Math.min(total, Math.ceil((sc.limit * elapsed) / s.used)) - 1)
  }
}

// Opens a signed-in page for a role. `requests` collects every budget-series request; `mode` reshapes the series; `forced` turns forced colours on.
async function open(browser, { role, width, height = 900, mobile = false, scheme = 'light', mode, forced = false }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: mobile, isMobile: mobile, colorScheme: scheme, reducedMotion: 'reduce', ...(forced ? { forcedColors: 'active' } : {}) })
  const page = await context.newPage()
  const requests = []
  page.on('pageerror', (e) => check(`page error (${role} ${width})`, false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsersFor(role) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLoginFor(role) }))
  await page.route('**/funding/ledger/series*', async (r) => {
    requests.push(r.request().url())
    if (!mode) return r.continue()
    const response = await r.fetch()
    const body = await response.json()
    reshape(body.data ?? body, mode)
    return r.fulfill({ response, json: body })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page, requests }
}
const go = async (page, id, tab) => {
  await page.goto(`${BASE_URL}/participants/${id}${tab ? `?tab=${tab}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('tablist').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.locator('[data-plot] svg').or(page.getByText('No plan budget to chart')).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(500)
}
const plotCard = (page) => page.locator('[data-plot]').locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')

const bandOf = (page) => page.locator('section[aria-labelledby="quick-add-heading"]')
const cardOf = (page) => page.getByRole('heading', { name: TITLE }).locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')

// Runs in the page: every PR1 band measurement in one pass. Tokens are resolved from the house custom properties, never typed in.
function measureBand() {
  const probe = (v) => { const d = document.createElement('div'); d.style.cssText = `position:absolute;visibility:hidden;height:var(${v})`; document.body.appendChild(d); const h = d.getBoundingClientRect().height; d.remove(); return h }
  const tokens = { tapMin: probe('--tap-min'), controlH: probe('--control-h'), sectionGap: probe('--section-gap') }
  const band = document.querySelector('section[aria-labelledby="quick-add-heading"]')
  if (!band) return { tokens, tiles: [] }
  const tiles = [...band.querySelectorAll('ul > li > a')].map((a) => {
    const r = a.getBoundingClientRect(), icon = a.children[0].getBoundingClientRect(), label = a.children[1], plus = a.querySelector('svg.lucide-plus')
    const lh = parseFloat(getComputedStyle(label).lineHeight)
    return { name: a.getAttribute('aria-label'), left: r.left, top: r.top, width: r.width, height: r.height, right: r.right, padL: parseFloat(getComputedStyle(a).paddingLeft), padT: parseFloat(getComputedStyle(a).paddingTop),
      iconW: icon.width, iconH: icon.height, plusW: plus ? plus.getBoundingClientRect().width : null, truncated: label.scrollWidth > label.clientWidth + 1, lines: Math.round(label.getBoundingClientRect().height / lh) }
  })
  const b = band.getBoundingClientRect()
  const h = [...document.querySelectorAll('h3,h2')].find((e) => e.textContent.trim() === 'How the budget is tracking')
  const card = h ? h.closest('div.rounded-md') : null, cr = card ? card.getBoundingClientRect() : null
  return { tokens, tiles, band: { top: b.top, bottom: b.bottom, width: b.width, left: b.left }, card: cr ? { top: cr.top, bottom: cr.bottom, width: cr.width, left: cr.left } : null, scrollWidth: document.scrollingElement.scrollWidth, innerWidth: window.innerWidth }
}
const near = (a, b, t = 1) => Math.abs(a - b) <= t
const rowsOf = (tiles) => { const by = new Map(); for (const t of tiles) { const k = Math.round(t.top); by.set(k, [...(by.get(k) ?? []), t]) } return [...by.values()] }

function runChecks(tag, m, { width, count, withCard }) {
  const { tokens: tk, tiles } = m
  check(`${tag} tile count = ${count}`, tiles.length === count, tiles.map((t) => t.name))
  // 1. Every tile at least --tap-min tall; tiles in one row share one height.
  check(`1 ${tag} tiles >= --tap-min (${tk.tapMin})`, tiles.every((t) => t.height >= tk.tapMin - 0.5), tiles.map((t) => Math.round(t.height)))
  check(`1 ${tag} tiles in a row share one height`, rowsOf(tiles).every((r) => r.every((t) => near(t.height, r[0].height))), rowsOf(tiles).map((r) => r.map((t) => Math.round(t.height))))
  // 2. Icon square = --control-h; Plus badge 14; padding 12; 8 between tiles.
  check(`2 ${tag} icon square = --control-h (${tk.controlH})`, tiles.every((t) => near(t.iconW, tk.controlH) && near(t.iconH, tk.controlH)), tiles.map((t) => [t.iconW, t.iconH]))
  const plus = tiles.filter((t) => t.plusW != null)
  check(`2 ${tag} Plus badge = 14px`, plus.every((t) => near(t.plusW, 14)), plus.map((t) => t.plusW))
  check(`2 ${tag} tile padding = 12px`, tiles.every((t) => near(t.padL, 12) && near(t.padT, 12)), tiles.map((t) => [t.padL, t.padT]))
  const gaps = rowsOf(tiles).flatMap((r) => r.slice(1).map((t, i) => t.left - r[i].right))
  check(`2 ${tag} 8px between tiles in a row`, gaps.every((g) => near(g, 8)), gaps.map((g) => Math.round(g * 10) / 10))
  // 3. Layout: 1280 one row, equal widths; 390 two columns, an odd last tile spans both.
  const rows = rowsOf(tiles)
  if (width >= 1024) check(`3 ${tag} one row, equal widths and tops`, rows.length === 1 && tiles.every((t) => near(t.width, tiles[0].width)), { rows: rows.length, widths: tiles.map((t) => Math.round(t.width)) })
  else {
    const first = rows.slice(0, -1).every((r) => r.length === 2), last = rows.at(-1)
    const lastOk = count % 2 === 0 ? last.length === 2 : last.length === 1 && near(last[0].width, tiles[0].width * 2 + 8, 2)
    check(`3 ${tag} two columns${count % 2 ? ', the odd last tile spans both' : ''}`, first && lastOk, rows.map((r) => r.length))
  }
  // 4. No label truncates, two lines at most.
  check(`4 ${tag} no label truncates, <= 2 lines`, tiles.every((t) => !t.truncated && t.lines <= 2), tiles.map((t) => [t.name, t.lines, t.truncated]))
  // 5. No horizontal overflow.
  check(`5 ${tag} no horizontal overflow`, m.scrollWidth <= m.innerWidth, [m.scrollWidth, m.innerWidth])
  // 6 and 9. Blocks --section-gap apart; the chart card is as wide as the band.
  if (withCard && m.card) {
    check(`6 ${tag} band to chart gap = --section-gap (${tk.sectionGap})`, near(m.card.top - m.band.bottom, tk.sectionGap, 1), m.card.top - m.band.bottom)
    if (width >= 1024) check(`9 ${tag} chart card as wide as the band`, near(m.card.width, m.band.width, 1), [m.card.width, m.band.width])
  }
}

// Runs in the page: SHAPE numeric checks 7, 8 and 10 on the one chart on screen.
function measureChart() {
  const plot = document.querySelector('[data-plot]'), svg = plot?.querySelector('svg')
  if (!svg) return null
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const rgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const card = plot.closest('div.rounded-md'), cardBg = rgb(getComputedStyle(card).backgroundColor)
  const texts = [...svg.querySelectorAll('text')].map((t) => { const b = t.getBBox(); return { text: t.textContent.trim(), size: parseFloat(getComputedStyle(t).fontSize), box: [b.x, b.x + b.width, b.y, b.y + b.height] } })
  const marks = {}
  for (const sel of ['[data-mark="limit"]', '[data-mark="pace"]', '[data-mark="renew"]', '[data-dot="reach"]']) {
    const el = svg.querySelector(sel)
    if (!el) { marks[sel] = null; continue }
    const cs = getComputedStyle(el), dot = sel.includes('dot'), c = dot && cs.fill !== 'none' ? cs.fill : cs.stroke
    marks[sel] = { colour: c, ratio: Math.round(ratio(rgb(c), cardBg) * 100) / 100, width: parseFloat(cs.strokeWidth), dash: cs.strokeDasharray }
  }
  // Lines as sampled points (every data line except the used line, whose label sits against its own dot by design) and the dots as small boxes.
  const lines = [...svg.querySelectorAll('[data-mark], [data-series]')].filter((e) => e.getAttribute('data-series') !== 'used').map((e) => {
    const len = e.getTotalLength(), n = Math.max(2, Math.ceil(len / 4)), pts = []
    for (let i = 0; i <= n; i++) { const p = e.getPointAtLength((len * i) / n); pts.push([p.x, p.y]) }
    return { name: e.getAttribute('data-mark') ?? e.getAttribute('data-series'), pts }
  })
  const dots = [...svg.querySelectorAll('circle[data-dot]')].map((c) => ({ name: 'dot ' + c.getAttribute('data-dot'), box: [c.cx.baseVal.value - c.r.baseVal.value, c.cx.baseVal.value + c.r.baseVal.value, c.cy.baseVal.value - c.r.baseVal.value, c.cy.baseVal.value + c.r.baseVal.value] }))
  const inset = (b) => [b[0] + 0.5, b[1] - 0.5, b[2] + 0.5, b[3] - 0.5]
  const hit = (a, b) => a[0] < b[1] && b[0] < a[1] && a[2] < b[3] && b[2] < a[3]
  const clashes = []
  texts.forEach((t, i) => {
    const tb = inset(t.box)
    texts.slice(i + 1).forEach((u) => { if (hit(tb, inset(u.box))) clashes.push(`${t.text} x ${u.text}`) })
    dots.forEach((d) => { if (hit(tb, d.box)) clashes.push(`${t.text} x ${d.name}`) })
    for (const l of lines) if (l.pts.some(([x, y]) => x > tb[0] && x < tb[1] && y > tb[2] && y < tb[3])) clashes.push(`${t.text} x ${l.name} line`)
  })
  return { texts: texts.map((t) => [t.text, t.size]), marks, clashes, hasReachDot: !!svg.querySelector('[data-dot="reach"]'), labels: texts.map((t) => t.text) }
}

// Checks 7, 8, 10 for one state. `reach`: 'ahead' | 'past' | 'none' says which reach label the state must carry.
function chartChecks(tag, m, { reach, colours = true }) {
  if (!m) return check(`${tag} chart drew`, false, null)
  check(`7 ${tag} every chart label >= 12px`, m.texts.every(([, s]) => s >= 12), m.texts.filter(([, s]) => s < 12))
  if (colours) for (const [sel, v] of Object.entries(m.marks)) {
    if (sel.includes('reach') && reach === 'none') continue
    check(`8 ${tag} ${sel} drawn and 3:1 on the card`, v && v.ratio >= 3, v)
  }
  check(`10 ${tag} no label box on another label, a line or a dot`, m.clashes.length === 0, m.clashes)
  const want = { ahead: /^Reaches budget /, past: /^Reached budget /, none: null }[reach]
  if (want) check(`${tag} reach dot and "${want}" label`, m.hasReachDot && m.labels.some((l) => want.test(l)), m.labels)
  else check(`${tag} no reach dot or label`, !m.hasReachDot && !m.labels.some((l) => /^Reache[sd] budget/.test(l)), m.labels)
  check(`${tag} limit label and renewal label drawn`, m.labels.some((l) => /^Budget \$/.test(l)) && m.labels.some((l) => /^(Plan ends|Ended) /.test(l)), m.labels)
}

const state = async (fn) => { try { await fn() } catch (e) { check('state crashed', false, String(e.message).slice(0, 300)) } }

const browser = await chromium.launch({ headless: true })
try {
  const shot = async (page, loc, name, opts = {}) => { const r = await cropElement(page, loc, path.join(OUT_DIR, name), opts); checks.push(checkCropHolds(r)); return r }
  const chart = (page) => page.evaluate(measureChart)

  // 1280 Coordinator, light: on-track, reach projected, reached in the past, and no plan.
  for (const [mode, name, reach] of [['ontrack', 'on-track', 'none'], ['projected', 'reach-projected', 'ahead'], ['past', 'reached-past', 'past']]) await state(async () => {
    const { context, page } = await open(browser, { role: 'Coordinator', width: 1280, mode })
    await go(page, 'p-0002')
    await cardOf(page).waitFor({ state: 'visible', timeout: 30_000 })
    runChecks(`1280 coordinator ${name}`, await page.evaluate(measureBand), { width: 1280, count: 7, withCard: true })
    chartChecks(`1280 coordinator ${name}`, await chart(page), { reach })
    await shot(page, bandOf(page), `overview-1280-coordinator-${name}.png`, { also: cardOf(page) })
    if (mode === 'ontrack') {
      await go(page, 'p-0001')
      await page.getByText('No plan budget to chart').waitFor({ state: 'visible', timeout: 30_000 })
      runChecks('1280 coordinator no-plan', await page.evaluate(measureBand), { width: 1280, count: 7, withCard: true })
      await shot(page, bandOf(page), 'overview-1280-coordinator-no-plan.png', { also: cardOf(page) })
    }
    await context.close()
  })
  // Dark, and forced colours.
  await state(async () => {
    const { context, page } = await open(browser, { role: 'Coordinator', width: 1280, scheme: 'dark', mode: 'projected' })
    await go(page, 'p-0002')
    await cardOf(page).waitFor({ state: 'visible', timeout: 30_000 })
    chartChecks('1280 coordinator dark reach-projected', await chart(page), { reach: 'ahead' })
    await shot(page, bandOf(page), 'overview-1280-coordinator-dark-reach-projected.png', { also: cardOf(page) })
    await context.close()
  })
  await state(async () => {
    const { context, page } = await open(browser, { role: 'Coordinator', width: 1280, mode: 'projected', forced: true })
    await go(page, 'p-0002')
    await cardOf(page).waitFor({ state: 'visible', timeout: 30_000 })
    const m = await chart(page)
    chartChecks('1280 forced-colors reach-projected', m, { reach: 'ahead', colours: false })
    const dashes = m ? ['limit', 'pace', 'renew'].map((k) => m.marks[`[data-mark="${k}"]`]?.dash) : []
    check('forced colours: limit, pace and renewal lines differ by dash pattern, not colour', new Set(dashes).size === 3, dashes)
    await shot(page, cardOf(page), 'overview-1280-forced-colors-chart.png')
    await context.close()
  })
  // 390 touch: Coordinator reach projected, Support Worker.
  await state(async () => {
    const { context, page } = await open(browser, { role: 'Coordinator', width: 390, height: 844, mobile: true, mode: 'projected' })
    await go(page, 'p-0002')
    await cardOf(page).waitFor({ state: 'visible', timeout: 30_000 })
    runChecks('390 coordinator reach-projected', await page.evaluate(measureBand), { width: 390, count: 7, withCard: true })
    chartChecks('390 coordinator reach-projected', await chart(page), { reach: 'ahead' })
    await shot(page, bandOf(page), 'overview-390-coordinator-reach-projected.png', { also: cardOf(page), touch: true })
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'overview-390-fullpage.png'), { touch: true })).checks)
    await context.close()
  })
  await state(async () => {
    const { context, page, requests } = await open(browser, { role: 'SupportWorker', width: 390, height: 844, mobile: true })
    await go(page, 'p-0002')
    runChecks('390 support-worker', await page.evaluate(measureBand), { width: 390, count: 2, withCard: false })
    check('11 support-worker: zero requests to /funding/ledger/series and no chart card', requests.length === 0 && (await cardOf(page).count()) === 0, requests.length)
    await shot(page, bandOf(page), 'overview-390-support-worker.png', { touch: true })
    await context.close()
  })
  // Funding tab, 1280: reach projected (current plan p-0002) and an ended plan (p-0003) that went over.
  for (const [id, mode, name, reach] of [['p-0002', 'projected', 'reach-projected', 'ahead'], ['p-0003', 'past', 'ended-plan', 'past']]) await state(async () => {
    const { context, page } = await open(browser, { role: 'Coordinator', width: 1280, mode })
    await go(page, id, 'funding')
    await plotCard(page).waitFor({ state: 'visible', timeout: 30_000 })
    chartChecks(`1280 funding tab ${name}`, await chart(page), { reach })
    await shot(page, plotCard(page), `funding-tab-1280-chart-${name}.png`)
    await context.close()
  })
} finally { await browser.close() }

if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
