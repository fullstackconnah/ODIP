// Captures and numeric checks for the roster fill card (SHAPE §9 checks 1-17, LEAD-RULINGS 1 and 3 as checks 18-19). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/roster-fill.mjs <outdir>
// The mock API serves each state (mock-api/mock-roster-fill.js); a fixture is asked for with `?fixture=`, added here by page.route.
// Prints "CHECK ok|FAIL name = value", writes checks.json, and exits non-zero when a check fails.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
// One file per name: drop the PNGs of any earlier run (the runner's shrink copies and full/ originals) before writing.
for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.png')) rmSync(path.join(OUT_DIR, f))
rmSync(path.join(OUT_DIR, 'full'), { recursive: true, force: true })
mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })

const VIEWPORTS = [{ name: '390', width: 390, height: 844, mobile: true }, { name: '1280', width: 1280, height: 800 }]
const KEY = 'odip.roster.fillHidden'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' })

const results = []
let failed = false
const check = (name, ctx, measured, pass) => {
  if (!pass) failed = true
  results.push({ check: name, ...ctx, pass: !!pass, measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${Object.values(ctx).join(' ')}] = ${JSON.stringify(measured)}`)
}
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})

// Fonts ready, animations done, and the card and main column in the same place on two consecutive frames pairs (the sidebar and the ResizeObserver have finished).
const settle = async (p) => {
  await settled(p)
  const stable = await p.evaluate(async () => {
    await document.fonts.ready
    const key = () => {
      const h = [...document.querySelectorAll('h3')].find((e) => e.textContent === 'How full the next weeks are')
      const c = h?.closest('.rounded-md')?.getBoundingClientRect()
      const m = document.querySelector('main')?.getBoundingClientRect()
      return [c?.left, c?.width, c?.height, m?.left, m?.width].map((v) => Math.round((v ?? -1) * 10)).join(',')
    }
    let prev = null
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const cur = key()
      if (cur === prev) return true
      prev = cur
    }
    return false
  })
  if (!stable) check('layout settles', {}, stable, false)
}

const browser = await chromium.launch({ headless: true })
const signIn = async (page) => {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}

try {
  const warm = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
  await signIn(warm)
  await warm.goto(`${BASE_URL}/rostering`, { waitUntil: 'networkidle', timeout: 120_000 })
  await warm.waitForTimeout(3000)
  await warm.context().close()

  for (const scheme of ['light', 'dark']) {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: scheme })
      const page = await context.newPage()
      const cdp = vp.mobile ? await context.newCDPSession(page) : null
      const pinCoarse = async () => {
        await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
        await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
      }
      await pinCoarse()
      page.on('pageerror', (e) => check('page error', { width: vp.name, theme: scheme }, e.message, false))

      let fixture = null
      let fill = null
      let padRows = true
      await page.route('**/api/v1/rostering/fill*', async (r) => {
        const url = new URL(r.request().url())
        if (fixture) url.searchParams.set('fixture', fixture)
        const response = await r.fetch({ url: url.toString() })
        if (response.ok()) fill = (await response.json()).data
        await r.fulfill({ response })
      })
      // The mock board has few participants; pad it so the board overflows its frame at 1280x800 (check 13).
      await page.route('**/api/v1/rostering/board*', async (r) => {
        const response = await r.fetch()
        const body = await response.json()
        const rows = body?.data?.participantRows
        if (padRows && Array.isArray(rows) && rows.length > 0) {
          const base = rows[0]
          for (let i = rows.length; i < 30; i++) rows.push({ ...base, participantId: `pad-${i}`, fullName: `Padded Participant ${i}`, shifts: [] })
        }
        await r.fulfill({ response, json: body })
      })
      await signIn(page)

      const heading = page.getByRole('heading', { name: 'How full the next weeks are' })
      const card = () => heading.locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
      const open = async ({ name, hidden, wait = true } = {}) => {
        fixture = name ?? null
        fill = null
        await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await page.evaluate(([k, v]) => { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* ignore */ } }, [KEY, hidden])
        // Week 2 of the fill is the board week (the fixture's second Monday), asked for through ?date=.
        await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await heading.waitFor({ timeout: 60_000 })
        if (wait) await page.waitForFunction(() => document.querySelector('[data-fill-week],[data-fill-row],[role="alert"],p') !== null, null, { timeout: 30_000 })
        await pinCoarse()
        if (fill) {
          const second = fill.weeks[1].weekStart
          await page.goto(`${BASE_URL}/rostering?date=${second}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
          await heading.waitFor({ timeout: 60_000 })
          await pinCoarse()
        }
        await settled(page)
        await page.waitForTimeout(400)
      }
      // The crop is the whole card plus 16px of padding. A page shorter than that is grown first (at 390 touch a fullPage clip drops the emulation), then restored.
      const park = () => page.mouse.move(vp.width - 4, vp.height - 4)
      const shot = async (name) => {
        await park(); await settle(page)
        await page.evaluate(() => scrollTo(0, 0))
        let bb = await card().boundingBox()
        const need = Math.ceil(bb.y + bb.height + 16)
        const grow = need > vp.height
        if (grow) { await page.setViewportSize({ width: vp.width, height: need }); await pinCoarse(); await settle(page); bb = await card().boundingBox() }
        const x = Math.max(0, bb.x - 16), y = Math.max(0, bb.y - 16)
        const clip = { x, y, width: Math.min(vp.width - x, bb.width + 32), height: bb.height + 32 }
        const vh = grow ? need : vp.height
        const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
        check('crop holds the whole card', { width: vp.name, theme: scheme, state: name }, { card: bb.height, crop: clip.height, bottom: Math.round(y + clip.height), viewport: vh, coarse }, clip.height >= bb.height && y + clip.height <= vh + 0.5 && (!vp.mobile || coarse))
        await page.screenshot({ path: path.join(OUT_DIR, `${name}-${vp.name}-${scheme}.png`), clip })
        if (grow) { await page.setViewportSize({ width: vp.width, height: vp.height }); await pinCoarse() }
      }
      // At 390 touch a fullPage shot drops the touch emulation; resize to the page height, re-pin, prove it is still coarse with a 44px control, then shoot.
      const fullShot = async (name, ctx) => {
        const file = path.join(OUT_DIR, 'full', `${name}-${vp.name}-${scheme}.png`)
        await park(); await settle(page)
        if (!vp.mobile) { await page.screenshot({ path: file, fullPage: true }); return }
        const h = await page.evaluate(() => document.scrollingElement.scrollHeight)
        await page.setViewportSize({ width: vp.width, height: Math.min(h, 4000) })
        await pinCoarse(); await settle(page); await page.waitForTimeout(250)
        const probe = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, control: document.querySelector('button')?.getBoundingClientRect().height ?? 0 }))
        check('full page keeps touch emulation', ctx, probe, probe.coarse && probe.control >= 44)
        await page.screenshot({ path: file })
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await pinCoarse()
      }
      const toggle = () => card().getByRole('button', { name: /^(Show|Hide) chart$/ })
      const cardMetrics = () => card().evaluate((c) => { const r = c.getBoundingClientRect(); return { h: r.height, right: r.right, inner: innerWidth, sw: document.documentElement.scrollWidth } })
      const lineCount = () => card().evaluate((c) => {
        const p = [...c.querySelectorAll('p')].find((el) => /shifts in the next|Nothing is rostered|Only the week/.test(el.textContent))
        if (!p) return 0
        const lh = parseFloat(getComputedStyle(p).lineHeight)
        return Math.round(p.getBoundingClientRect().height / lh)
      })

      // Default state per width (18): nothing stored, collapsed at 390, expanded at 1280.
      {
        const ctx = { width: vp.name, theme: scheme, state: 'default' }
        await open({ hidden: undefined })
        const expanded = await toggle().getAttribute('aria-expanded')
        check('18 default state per width', ctx, { expanded }, vp.mobile ? expanded === 'false' : expanded === 'true')
      }

      // ---- Expanded (the stored choice wins) ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'expanded' }
        await open({ hidden: '0' })
        const c = await cardMetrics()
        const gutter = vp.mobile ? 16 : 20
        check('1 no overflow, card inside gutter', ctx, c, c.sw <= c.inner && c.right <= c.inner - gutter)
        const mode = await page.evaluate(() => ({ rows: document.querySelectorAll('[data-fill-row]').length, cols: document.querySelectorAll('[data-fill-week]').length }))
        check('2 mode', ctx, mode, vp.mobile ? mode.rows === 8 && mode.cols === 0 : mode.cols === 8 && mode.rows === 0)
        const boxes = await page.evaluate(() => [...document.querySelectorAll('[data-fill-row],[data-fill-week]')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height } }))
        const sizeOk = boxes.every((b) => (vp.mobile ? b.h >= 44 : b.w >= 44))
        const gapOk = boxes.every((b, i) => i === 0 || (vp.mobile ? boxes[i - 1].b <= b.t + 0.5 : boxes[i - 1].r <= b.l + 0.5))
        check('3 target size and no overlap', ctx, { min: Math.min(...boxes.map((b) => (vp.mobile ? b.h : b.w))) }, sizeOk && gapOk)
        if (!vp.mobile) {
          const bars = await page.evaluate(() => [...document.querySelectorAll('[data-bar]')].map((e) => { const r = e.getBoundingClientRect(); return { kind: e.dataset.bar, w: r.width, h: r.height } }))
          check('4 bar width 16-48 and open >= 4 tall', ctx, { bars: bars.length }, bars.length > 0 && bars.every((b) => b.w >= 16 && b.w <= 48 && (b.kind !== 'open' || b.h >= 4)))
          const labels = await page.evaluate(() => [...document.querySelectorAll('[data-xlabel]')].map((e) => e.getBoundingClientRect()).sort((a, b) => a.left - b.left).map((r) => ({ l: r.left, r: r.right, t: r.top })))
          const sameRow = labels.filter((l) => Math.abs(l.t - labels[0].t) < 2)
          check('6 x labels do not overlap', ctx, { n: sameRow.length }, sameRow.every((l, i) => i === 0 || sameRow[i - 1].r + 4 <= l.l))
        }
        const small = await card().evaluate((cd) => {
          const out = []
          const walker = document.createTreeWalker(cd, NodeFilter.SHOW_TEXT)
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) continue
            const el = n.parentElement
            if (el.closest('.sr-only,[hidden]')) continue
            const fs = parseFloat(getComputedStyle(el).fontSize)
            if (fs < 12) out.push({ text: n.textContent.slice(0, 30), fs })
          }
          return out
        })
        check('5 text >= 12px', ctx, small, small.length === 0)
        const empties = await page.evaluate(() => [...document.querySelectorAll('[data-fill-empty]')].map((e) => { const p = e.closest('[data-fill-row]') ?? e.parentElement; const r = e.getBoundingClientRect(); const pr = p.getBoundingClientRect(); return { fits: e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight, inside: r.left >= pr.left - 1 && r.right <= pr.right + 1 && r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1 } }))
        check('7 not-rostered text fits and sits in its slot', ctx, empties, empties.length > 0 && empties.every((e) => e.fits && e.inside))
        const board = await page.evaluate(() => { const on = [...document.querySelectorAll('[data-on-board]')]; const label = on[0]?.closest('[data-fill-row]')?.querySelector('[data-xlabel]') ?? [...document.querySelectorAll('svg [data-xlabel]')][on[0] ? [...document.querySelectorAll('[data-fill-week]')].indexOf(on[0]) : 0]; return { n: on.length, weight: label ? Number(getComputedStyle(label).fontWeight) : 0 } })
        check('8 one board week, label bold', ctx, board, board.n === 1 && board.weight >= 600)
        const h = (await cardMetrics()).h
        check('9 card height expanded', ctx, { h, lines: await lineCount() }, vp.mobile ? h >= 520 && h <= 700 : h >= 180 && h <= 236)

        // 14. Focus ring on the plot.
        await page.locator('[data-plot]').focus()
        const ring = await page.locator('[data-plot]').evaluate((el) => { const s = getComputedStyle(el); const probe = document.createElement('i'); probe.style.color = 'var(--color-ring)'; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove(); return { width: s.outlineWidth, color: s.outlineColor, want } })
        check('14 focus ring 2px in --color-ring', ctx, ring, ring.width === '2px' && ring.color === ring.want)
        await page.locator('[data-plot]').evaluate((el) => el.blur())

        if (!vp.mobile) {
          // 15. Hovered readout lies inside the plot.
          const plot = await page.locator('[data-plot]').boundingBox()
          await page.mouse.move(plot.x + plot.width * 0.9, plot.y + plot.height * 0.4)
          await page.locator('[data-readout]').waitFor({ timeout: 5000 })
          const ro = await page.locator('[data-readout]').boundingBox()
          check('15 readout inside plot', ctx, { ro, plot }, ro.x >= plot.x - 0.5 && ro.x + ro.width <= plot.x + plot.width + 0.5 && ro.y >= plot.y - 0.5 && ro.y + ro.height <= plot.y + plot.height + 0.5)
          await park()
        } else {
          const tb = await toggle().evaluate((el) => { const r = el.getBoundingClientRect(); const pad = getComputedStyle(el, '::before'); return { w: r.width, h: r.height, padH: parseFloat(pad.height) || 0, padW: parseFloat(pad.width) || 0 } })
          check('16 toggle hit area >= 44', ctx, tb, Math.max(tb.h, tb.padH) >= 44 && Math.max(tb.w, tb.padW) >= 44)
        }
        if (!vp.mobile) {
          // 20-21. The plot stays inside the card's content box, settled and after a 1280 -> 1024 -> 1280 resize.
          const inside = () => card().evaluate((c) => {
            const cs = getComputedStyle(c); const r = c.getBoundingClientRect()
            const edge = r.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)
            const svg = c.querySelector('[data-plot] svg')?.getBoundingClientRect().right ?? null
            const plot = c.querySelector('[data-plot]').getBoundingClientRect().right
            return { edge: Math.round(edge * 10) / 10, svg: svg && Math.round(svg * 10) / 10, plot: Math.round(plot * 10) / 10, card: Math.round(r.right * 10) / 10 }
          })
          await park(); await settle(page)
          const settledEdges = await inside()
          check('20 plot inside card content box (settled)', ctx, settledEdges, settledEdges.svg !== null && settledEdges.svg <= settledEdges.edge + 0.5 && settledEdges.plot <= settledEdges.edge + 0.5)
          await page.setViewportSize({ width: 1024, height: vp.height }); await settle(page)
          const mid = await inside()
          check('21a plot inside card content box (1024)', ctx, mid, mid.plot <= mid.edge + 0.5 && (mid.svg === null || mid.svg <= mid.edge + 0.5))
          await page.setViewportSize({ width: vp.width, height: vp.height }); await park(); await settle(page)
          const back = await inside()
          check('21 plot inside card content box (after 1280 -> 1024 -> 1280)', ctx, back, back.svg !== null && back.svg <= back.edge + 0.5 && back.plot <= back.edge + 0.5)
        }
        await shot('loaded', ctx)
        await fullShot('page-loaded', ctx)
      }

      // ---- Collapsed ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'collapsed' }
        await open({ hidden: '1' })
        const lines = await lineCount()
        const h = (await cardMetrics()).h
        check('10 card height collapsed', ctx, { h, sentenceLines: lines }, h <= (vp.mobile ? 170 : 110))
        await shot('collapsed', ctx)
      }

      // ---- 13. Board frame: the card absent (baseline) first, then expanded and collapsed ----
      if (!vp.mobile) {
        const frame = () => page.evaluate(() => { const f = document.querySelector('div[style*="scroll-padding-left"]'); const r = f.getBoundingClientRect(); return { capped: f.scrollHeight > f.clientHeight, scroll: document.scrollingElement.scrollHeight, bottom: r.bottom, height: r.height, inner: innerHeight } })
        await open({ hidden: '0' })
        await heading.evaluate((h) => { h.closest('.rounded-md').parentElement.style.display = 'none' })
        await page.waitForTimeout(500)
        const base = await frame()
        check('13 board frame (baseline, no card)', { width: vp.name, theme: scheme, state: 'card-absent' }, base, base.capped && base.height >= 320)
        for (const [label, hidden] of [['expanded', '0'], ['collapsed', '1']]) {
          await open({ hidden })
          const fr = await frame()
          check('13 board frame fits', { width: vp.name, theme: scheme, state: label }, { ...fr, baselineScroll: base.scroll }, fr.capped && fr.scroll <= base.scroll + 1 && fr.bottom <= fr.inner + 1 && fr.height >= 320)
        }
      }

      // ---- No shifts ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'no-shifts' }
        await open({ name: 'empty', hidden: '0' })
        const h = (await cardMetrics()).h
        check('11 card height no shifts', ctx, { h }, h <= (vp.mobile ? 120 : 84))
        await shot('no-shifts', ctx)
      }

      // ---- Error (once per breakpoint, light) ----
      if (scheme === 'light') {
        const ctx = { width: vp.name, theme: scheme, state: 'error' }
        fixture = 'failing'
        await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await heading.waitFor({ timeout: 60_000 })
        await card().getByRole('button', { name: 'Try again' }).waitFor({ timeout: 30_000 })
        await pinCoarse(); await settled(page); await page.waitForTimeout(300)
        const h = (await cardMetrics()).h
        check('12 card height error', ctx, { h }, h <= (vp.mobile ? 200 : 130))
        await shot('error', ctx)
      }

      // ---- 19. The choice survives a reload ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'reload' }
        await open({ hidden: undefined })
        const before = await toggle().getAttribute('aria-expanded')
        await toggle().click()
        await page.reload({ waitUntil: 'domcontentloaded' })
        await heading.waitFor({ timeout: 60_000 })
        await pinCoarse()
        const after = await toggle().getAttribute('aria-expanded')
        check('19 choice survives a reload', ctx, { before, after }, before !== after)
      }

      // ---- 17. Forced colours (1280, light) ----
      if (!vp.mobile && scheme === 'light') {
        const ctx = { width: vp.name, theme: 'forced-colors', state: 'expanded' }
        await page.emulateMedia({ forcedColors: 'active' })
        await open({ hidden: '0' })
        const fc = await page.evaluate(() => { const f = document.querySelector('.rf-filled'); const o = document.querySelector('.rf-open'); return { filled: getComputedStyle(f).fill, open: getComputedStyle(o).fill, stroke: getComputedStyle(o).stroke } })
        check('17 forced colours: filled differs from open, open has a stroke', ctx, fc, fc.filled !== fc.open && fc.stroke !== 'none')
        await page.emulateMedia({ forcedColors: 'none' })
      }

      await context.close()
    }
  }
} finally {
  writeFileSync(path.join(OUT_DIR, 'checks.json'), JSON.stringify(results, null, 2))
  await browser.close()
}
console.log(`${results.filter((r) => r.pass).length}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
