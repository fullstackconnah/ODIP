// Captures and numeric checks for the budget graph on the Funding tab (SHAPE §11 checks 1-15, PLAN §5.2 checks 16-17). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/budget-graph.mjs <outdir>
// The mock API serves each state (mock-api/mock-budget-series.js); a fixture other than the participant's own is asked for with `?fixture=`, added here by page.route.
// Prints "CHECK ok|FAIL name = value", writes checks.json, and exits non-zero when a check fails.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })

const VIEWPORTS = [{ name: '390', width: 390, height: 844, mobile: true }, { name: '1280', width: 1280, height: 900 }]
const FIXTURES = [
  { name: 'current-normal', id: 'p-0002', legend: 4, booked: true },
  { name: 'ended', id: 'p-0003', legend: 2, ended: true },
  { name: 'no-agreement', id: 'p-0004', legend: 3, booked: true },
  { name: 'no-spend', id: 'p-0002', fixture: 'noSpend', pickZero: true },
  { name: 'mid-revision', id: 'p-0005', legend: 4, booked: true },
  { name: 'four-pool', id: 'p-0002', fixture: 'fourPool', legend: 4, booked: true },
]
const STROKES = {
  light: { budget: '#7a8070', used: '#396200', booked: '#396200', expected: '#2f6db5' },
  dark: { budget: '#8a9180', used: '#a6d66b', booked: '#a6d66b', expected: '#5f95e0' },
}
const M = { top: 20, right: 12, bottom: 28, left: 48 }
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

const results = []
let failed = false
const check = (name, ctx, measured, pass) => {
  if (!pass) failed = true
  results.push({ check: name, ...ctx, pass: !!pass, measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${Object.values(ctx).join(' ')}] = ${JSON.stringify(measured)}`)
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol
const dayOf = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000
const hex = (rgb) => '#' + rgb.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
const lum = (h) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})

const browser = await chromium.launch({ headless: true })
const signIn = async (page) => {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}

try {
  // Warm-up: the dev server pre-bundles on the first visit.
  const warm = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await signIn(warm)
  await warm.goto(`${BASE_URL}/participants/p-0002?tab=funding`, { waitUntil: 'networkidle', timeout: 120_000 })
  await warm.waitForTimeout(3000)
  await warm.context().close()

  for (const scheme of ['light', 'dark']) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: scheme, reducedMotion: 'reduce' })
      const page = await context.newPage()
      const cdp = vp.mobile ? await context.newCDPSession(page) : null
      const pinCoarse = async () => { await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }); await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] }) }
      await pinCoarse()
      page.on('pageerror', (e) => check('page error', { width: vp.name, theme: scheme }, e.message, false))
      let fixture = null
      let series = null
      await page.route('**/funding/ledger/series*', async (r) => {
        const url = new URL(r.request().url())
        if (fixture) url.searchParams.set('fixture', fixture)
        const response = await r.fetch({ url: url.toString() })
        if (response.ok()) series = (await response.json()).data
        await r.fulfill({ response })
      })
      await signIn(page)

      const open = async (id, name) => {
        fixture = name ?? null
        series = null
        await page.goto(`${BASE_URL}/participants/${id}?tab=funding`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await pinCoarse()
      }
      const card = () => page.locator('[data-plot]').locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
      const shot = async (name, loc) => {
        await loc.scrollIntoViewIfNeeded()
        await settled(page); await page.waitForTimeout(150)
        const bb = await loc.boundingBox()
        const clip = { x: Math.max(0, bb.x - 16), y: Math.max(0, bb.y - 16), width: Math.min(vp.width - Math.max(0, bb.x - 16), bb.width + 32), height: Math.min(vp.height - Math.max(0, bb.y - 16), bb.height + 32) }
        await page.screenshot({ path: path.join(OUT_DIR, `${name}-${vp.name}-${scheme}.png`), clip })
      }

      for (const f of FIXTURES) {
        const ctx = { fixture: f.name, width: vp.name, theme: scheme }
        await open(f.id, f.fixture)
        const plot = page.locator('[data-plot]')
        await plot.locator('svg').waitFor({ timeout: 30_000 })
        const s = series
        let scope = s.scopes[0]
        // The no-spend fixture's point is its zero pool, so that pool is chosen and every check below runs on it.
        if (f.pickZero) {
          scope = s.scopes.find((sc) => sc.scopeKey !== 'plan' && sc.summary.used === 0)
          if (vp.mobile) await card().locator('select').selectOption({ label: scope.name })
          else await card().getByRole('radio', { name: scope.name }).click()
          await page.getByText('nothing used yet').first().waitFor({ timeout: 10_000 })
        }
        const hasBooked = f.pickZero ? s.planIsCurrent && scope.summary.bookedEnd !== undefined : f.booked
        const wantLegend = f.pickZero ? 2 + (hasBooked ? 1 : 0) + (s.expected.status === 'Ok' && scope.points.some((p) => p.expected !== undefined) ? 1 : 0) : f.legend
        const stops = scope.points.filter((p) => !p.isEdge)
        const geo = await plot.evaluate((el) => ({ W: el.clientWidth, svgH: el.querySelector('svg').getBoundingClientRect().height }))
        const W = geo.W
        const plotW = W - M.left - M.right
        const span = Math.max(dayOf(s.planEnd) - dayOf(s.planStart), 1)
        const xOf = (iso) => M.left + ((dayOf(iso) - dayOf(s.planStart)) / span) * plotW

        // 1. Height.
        const wantH = Math.min(360, Math.max(220, Math.round(W / 2)))
        check('1 svg height', ctx, { W, height: geo.svgH, want: wantH }, near(geo.svgH, wantH))
        // 2. No horizontal scroll.
        const scroll = await card().evaluate((c) => ({ page: document.scrollingElement.scrollWidth, inner: innerWidth, card: c.scrollWidth, cardClient: c.clientWidth }))
        check('2 no horizontal scroll', ctx, scroll, scroll.page <= scroll.inner && scroll.card <= scroll.cardClient)
        // 3. Ticks.
        const ticks = await plot.evaluate((el, M) => {
          const svg = el.querySelector('svg'); const H = svg.getBoundingClientRect().height; const base = H - M.bottom
          const labels = [...svg.querySelectorAll('text')].filter((t) => Math.abs(Number(t.getAttribute('y')) - (base + 18)) < 0.5).map((t) => t.getBoundingClientRect()).sort((a, b) => a.left - b.left)
          const gaps = labels.slice(1).map((b, i) => Math.round(b.left - labels[i].right))
          const y = [...svg.querySelectorAll('[data-ytick]')].map((g) => Number(g.getAttribute('data-ytick')))
          return { xCount: labels.length, minGap: gaps.length ? Math.min(...gaps) : null, yTicks: y, plotH: H - M.top - M.bottom }
        }, M)
        const maxPlotted = Math.max(scope.limit, ...scope.points.flatMap((p) => [p.budget, p.used ?? 0, p.usedAndBooked ?? 0, p.expected ?? 0]))
        check('3 x tick count and gap', ctx, ticks, ticks.xCount <= Math.floor(plotW / 64) && (ticks.minGap === null || ticks.minGap >= 8))
        check('3 y ticks', ctx, { ...ticks, maxPlotted }, ticks.yTicks.length === (ticks.plotH < 200 ? 3 : 5) && Math.max(...ticks.yTicks) >= maxPlotted && Math.max(...ticks.yTicks) < 1.5 * maxPlotted)
        // 4 and 5. Strokes.
        const strokes = await plot.evaluate((el) => {
          let node = el; let bg = 'rgb(255, 255, 255)'
          while (node) { const b = getComputedStyle(node).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') { bg = b; break } node = node.parentElement }
          return { bg, paths: Object.fromEntries([...el.querySelectorAll('path[data-series]')].map((p) => { const c = getComputedStyle(p); return [p.dataset.series, { width: c.strokeWidth, dash: c.strokeDasharray, cap: c.strokeLinecap, color: c.stroke }] })) }
        })
        const want4 = { used: ['2px', 'none'], booked: ['2px', '6px, 4px'], expected: ['2.5px', '0px, 5px'], budget: ['1.5px', 'none'] }
        for (const [k, p] of Object.entries(strokes.paths)) {
          const [w, d] = want4[k]
          check(`4 stroke ${k}`, ctx, p, p.width === w && p.dash.replace(/\s/g, '') === d.replace(/\s/g, '') && (k !== 'expected' || p.cap === 'round'))
          const c = hex(p.color); const ratio = Math.round(contrast(c, hex(strokes.bg)) * 100) / 100
          check(`5 stroke colour ${k}`, ctx, { color: c, want: STROKES[scheme][k], bg: hex(strokes.bg), ratio }, c === STROKES[scheme][k] && ratio >= 3)
        }
        // 6 and 7. Today, used and booked meet.
        const ends = await plot.evaluate((el) => {
          const coords = (sel) => { const d = el.querySelector(sel)?.getAttribute('d'); return d ? d.split(/[ML]/).filter(Boolean).map((p) => p.split(',').map(Number)) : null }
          const today = el.querySelector('[data-today] line')
          return { used: coords('[data-series=used]'), booked: coords('[data-series=booked]'), todayX: today ? Number(today.getAttribute('x1')) : null }
        })
        const usedLast = ends.used.at(-1)
        if (f.ended) {
          check('7 ended: no today, no booked, used reaches the right edge', ctx, { todayX: ends.todayX, booked: !!ends.booked, usedLastX: usedLast[0], right: W - M.right }, ends.todayX === null && !ends.booked && near(usedLast[0], W - M.right))
        } else {
          const todayX = xOf(s.today)
          check('6 today line at the today point', ctx, { todayX: ends.todayX, want: Math.round(todayX * 10) / 10 }, near(ends.todayX, todayX))
          check('6 used ends at today', ctx, { usedLastX: usedLast[0], todayX: ends.todayX }, near(usedLast[0], ends.todayX))
          if (hasBooked) check('6 booked starts where used ends', ctx, { usedLast, bookedFirst: ends.booked?.[0] }, !!ends.booked && near(ends.booked[0][0], usedLast[0]) && near(ends.booked[0][1], usedLast[1]))
        }
        // 8. Legend.
        const legend = await page.evaluate(() => { const items = [...document.querySelectorAll('[data-legend]')]; return { count: items.length, bottom: Math.max(...items.map((i) => i.getBoundingClientRect().bottom)), plotTop: document.querySelector('[data-plot]').getBoundingClientRect().top } })
        check('8 legend count and place', ctx, legend, legend.count === wantLegend && legend.bottom <= legend.plotTop + 0.5)
        // 18. The "Used" label stays clear of the booked, expected and budget lines in its x span.
        const label = await plot.evaluate((el) => {
          const t = el.querySelector('[data-used-label]'); if (!t) return null
          const b = t.getBBox(); const hit = []
          for (const k of ['booked', 'expected', 'budget']) {
            const path = el.querySelector('path[data-series=' + k + ']'); if (!path) continue
            const len = path.getTotalLength()
            for (let d = 0; d <= len; d += 1) { const q = path.getPointAtLength(d); if (q.x >= b.x && q.x <= b.x + b.width && q.y >= b.y && q.y <= b.y + b.height) { hit.push(k); break } }
          }
          return { box: [b.x, b.y, b.width, b.height].map((n) => Math.round(n * 10) / 10), anchor: t.getAttribute('text-anchor'), hit }
        })
        if (!f.ended) check('18 Used label overlaps no booked, expected or budget line', ctx, label, label !== null && label.hit.length === 0)
        if (vp.mobile && (f.name === 'current-normal' || f.name === 'four-pool')) check('18 Used label stays left of the dot at 390', ctx, label, label?.anchor === 'end')
        if (f.pickZero) {
          const zero = await plot.evaluate((el) => { const d = el.querySelector('path[data-series=used]')?.getAttribute('d'); return { ys: d ? d.split(/[ML]/).filter(Boolean).map((q) => Number(q.split(',')[1])) : [], sentence: el.parentElement.querySelector('p')?.textContent } })
          const base = geo.svgH - M.bottom
          check('0 no-spend: used sits on the baseline, 2px, and the sentence says nothing used yet', ctx, { base, ys: [Math.min(...zero.ys), Math.max(...zero.ys)], width: strokes.paths.used?.width, sentence: zero.sentence }, zero.ys.length > 1 && zero.ys.every((y) => near(y, base)) && strokes.paths.used?.width === '2px' && zero.sentence.includes('nothing used yet'))
        }
        if (f.name === 'mid-revision') {
          const tick = await plot.evaluate((el) => [...el.querySelectorAll('[data-revision]')].map((l) => ({ x: Number(l.getAttribute('x1')), y1: Number(l.getAttribute('y1')), y2: Number(l.getAttribute('y2')) })))
          const inside = tick.every((t) => t.x >= M.left && t.x <= W - M.right && t.y1 >= M.top && t.y2 <= geo.svgH - M.bottom)
          check('19 revision tick exists and sits in the plot', ctx, { tick, want: s.expected.revisionChanges.length }, tick.length === s.expected.revisionChanges.length && tick.length > 0 && inside)
        }
        // 9. Text sizes.
        const small = await card().evaluate((c) => {
          const out = []; const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) { const t = walker.currentNode; if (!t.textContent.trim()) continue; const size = parseFloat(getComputedStyle(t.parentElement).fontSize); if (size < 12) out.push(`${t.textContent.trim().slice(0, 30)} ${size}px`) }
          return out
        })
        check('9 text 12px or more', ctx, small, small.length === 0)
        // 10. The table.
        const table = await page.evaluate(() => { const t = document.querySelector('[data-table]'); return { rows: t.querySelectorAll('tbody tr').length, display: getComputedStyle(t).display, caption: !!t.querySelector('caption')?.textContent.trim() } })
        check('10 table rows = points', ctx, { ...table, points: stops.length }, table.rows === stops.length && table.display !== 'none' && table.caption)
        // 11 and 12. Keyboard and the readout's place.
        const cardBox = async () => card().evaluate((c) => { const r = c.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } })
        const readoutIn = async (which) => {
          // Let the readout re-measure itself (its ResizeObserver) and re-place before reading where it sits.
          await settled(page); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
          const r = await page.locator('[data-readout]').evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom } })
          const c = await cardBox()
          check(`12 readout inside the card (${which})`, ctx, { readout: r, card: c }, r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5)
        }
        const crossX = async () => Number(await page.locator('[data-cross]').getAttribute('x1'))
        await plot.focus()
        await page.locator('[data-readout]').waitFor()
        await readoutIn('rest point')
        if (scheme === 'light' && vp.mobile && f.name === 'current-normal') await shot('readout-keyboard-today', card())
        await page.keyboard.press('End')
        const atEnd = await crossX()
        check('11 End puts the crosshair on the last point', ctx, { crossX: atEnd, want: xOf(stops.at(-1).date) }, (await page.locator('[data-readout]').isVisible()) && near(atEnd, xOf(stops.at(-1).date)))
        await readoutIn('last point')
        await page.keyboard.press('ArrowLeft')
        const dx = (await crossX()) - atEnd
        const want = xOf(stops.at(-2).date) - xOf(stops.at(-1).date)
        check('11 ArrowLeft steps one point', ctx, { dx, want }, near(dx, want))
        await page.keyboard.press('Home')
        await readoutIn('first point')
        await page.keyboard.press('Escape')
        await page.evaluate(() => document.activeElement?.blur())
        // 14 and 15. The switch.
        const sw = await page.evaluate(() => ({ select: !!document.querySelector('[data-plot]')?.closest('div.rounded-md')?.querySelector('select'), radiogroup: document.querySelector('[data-plot]')?.closest('div.rounded-md')?.querySelector('[role=radiogroup]')?.querySelectorAll('[role=radio]').length ?? 0 }))
        if (f.name === 'four-pool') check('14 four pools use a select', ctx, sw, sw.select && sw.radiogroup === 0)
        if (f.name === 'current-normal') check('14 two pools: radios at 1280, a select at 390', ctx, sw, vp.mobile ? sw.select && sw.radiogroup === 0 : !sw.select && sw.radiogroup === 3)
        if (vp.mobile && sw.select) {
          const h = await card().locator('select').evaluate((el) => el.getBoundingClientRect().height)
          check('15 coarse switch height 44 or more', ctx, h, h >= 43.5)
        }
        // Captures.
        if (scheme === 'light' || f.name === 'current-normal' || f.name === 'mid-revision') await shot(`card-${f.name}`, card())
        if (scheme === 'light' && f.name === 'current-normal') {
          await page.screenshot({ path: path.join(OUT_DIR, `page-current-normal-${vp.name}-light.png`), fullPage: true })
          await pinCoarse()
        }
        // A tap pins the readout (390 only).
        if (scheme === 'light' && vp.mobile && f.name === 'current-normal') {
          await plot.scrollIntoViewIfNeeded()
          const b = await plot.boundingBox()
          await page.touchscreen.tap(b.x + b.width * 0.3, b.y + b.height * 0.5)
          await page.waitForTimeout(600)
          const shown = await page.locator('[data-readout]').isVisible()
          check('tap pins the readout', ctx, shown, shown)
          if (shown) await shot('readout-tap', card())
        }
      }

      // 16. No pricing: the strip and no plot.
      {
        const ctx = { fixture: 'no-pricing', width: vp.name, theme: scheme }
        await open('p-0002', 'noPricing')
        const strip = page.locator('[data-chart-state="no-pricing"]')
        await strip.waitFor({ timeout: 30_000 })
        const text = await strip.textContent()
        check('16 no-pricing strip, no plot', ctx, { text, plots: await page.locator('[data-plot]').count() }, text.includes('price list') && (await page.locator('[data-plot]').count()) === 0)
        if (scheme === 'light') await shot('no-pricing', strip)
      }
      // 13 and 17. The skeleton keeps the loaded body's height (the series held 2.5 s by the mock).
      {
        const ctx = { fixture: 'slow', width: vp.name, theme: scheme }
        await open('p-0002', 'slow')
        const skeleton = page.locator('[data-chart-skeleton]')
        await skeleton.waitFor({ timeout: 30_000 })
        const skeletonCard = skeleton.locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
        const skH = (await skeletonCard.boundingBox()).height
        const parts = (loc) => loc.evaluate((c) => [...c.firstElementChild.children].map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10))
        const skParts = await parts(skeletonCard)
        if (scheme === 'light' && vp.mobile) await shot('skeleton', skeleton.locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]'))
        await page.locator('[data-plot] svg').waitFor({ timeout: 30_000 })
        const loadedH = (await page.locator('[data-plot]').locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]').boundingBox()).height
        check('13/17 skeleton card height = loaded card height, so the pool cards below stay put', ctx, { skeleton: Math.round(skH * 10) / 10, loaded: Math.round(loadedH * 10) / 10, skParts, loadedParts: await parts(page.locator('[data-plot]').locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')) }, near(skH, loadedH, 24))
      }
      // The failure (light, 390): the query retries before it gives up.
      if (scheme === 'light' && vp.mobile) {
        await open('p-0002', 'failing')
        const failure = page.getByText("The budget chart couldn't load. The figures below are not affected.")
        await failure.waitFor({ timeout: 45_000 })
        await shot('failure', failure.locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]'))
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
  writeFileSync(path.join(OUT_DIR, 'checks.json'), JSON.stringify(results, null, 2))
  console.log(`CHECKS ${results.filter((r) => r.pass).length}/${results.length} passed`)
}
process.exit(failed ? 1 : 0)
