// Captures and numeric checks for the incidents-by-month card (SHAPE "Numeric checks" 1-19). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/incident-trend.mjs <outdir>
// The mock API serves each state (mock-api/mock-incident-trend.js); a fixture is asked for with `?fixture=`, added here by page.route.
// Prints "CHECK ok|FAIL name = value", writes checks.json, and exits non-zero when a check fails.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.png')) rmSync(path.join(OUT_DIR, f))
rmSync(path.join(OUT_DIR, 'full'), { recursive: true, force: true })
mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })

const VIEWPORTS = [{ name: '390', width: 390, height: 844, mobile: true }, { name: '1280', width: 1280, height: 800 }]
const KEY = 'odip.incidents.trendHidden'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' })
const overdue = envelope([{ id: 'overdue-1', title: 'Fall in the kitchen', incidentType: 'Injury', severity: 'High', status: 'Submitted', reportedByName: 'Alex Rivera', incidentDateTime: '2026-10-01T10:00:00', qscReportingStatus: 'Required', isOverdue24h: true }])

const results = []
let failed = false
const check = (name, ctx, measured, pass) => {
  if (!pass) failed = true
  results.push({ check: name, ...ctx, pass: !!pass, measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${Object.values(ctx).join(' ')}] = ${JSON.stringify(measured)}`)
}
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})

// Fonts ready, animations done, and the card in the same place on two consecutive frame pairs (the sidebar and the ResizeObserver have finished).
const settle = async (p) => {
  await settled(p)
  const stable = await p.evaluate(async () => {
    await document.fonts.ready
    const key = () => {
      const c = document.querySelector('[data-incident-trend]')?.getBoundingClientRect()
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
  await warm.goto(`${BASE_URL}/incidents`, { waitUntil: 'networkidle', timeout: 120_000 })
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
      await page.route('**/api/v1/incidents/trend*', async (r) => {
        const url = new URL(r.request().url())
        if (fixture) url.searchParams.set('fixture', fixture)
        await r.fulfill({ response: await r.fetch({ url: url.toString() }) })
      })
      // Check 19 needs the QSC banner: the mock may have no overdue incident today, so the banner's list always holds one.
      await page.route('**/api/v1/incidents/overdue-qsc*', (r) => r.fulfill({ json: overdue }))
      await signIn(page)

      const card = () => page.locator('[data-incident-trend]')
      const open = async ({ name, hidden } = {}) => {
        fixture = name ?? null
        await page.goto(`${BASE_URL}/incidents`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await page.evaluate(([k, v]) => { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* ignore */ } }, [KEY, hidden])
        await page.goto(`${BASE_URL}/incidents`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await card().waitFor({ timeout: 60_000 })
        await page.waitForFunction(() => { const c = document.querySelector('[data-incident-trend]'); return c && !c.hasAttribute('aria-busy') }, null, { timeout: 30_000 })
        await pinCoarse()
        await settled(page)
        await page.waitForTimeout(400)
      }
      const park = () => page.mouse.move(vp.width - 4, vp.height - 4)
      // The crop is the whole card plus 16px of padding. A page shorter than that is grown first (at 390 touch a fullPage clip drops the emulation), then restored.
      const shot = async (name, ctx) => {
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
        check('crop holds the whole card', { ...ctx, shot: name }, { card: bb.height, crop: clip.height, viewport: vh, coarse }, clip.height >= bb.height && y + clip.height <= vh && (!vp.mobile || coarse))
        // The fixed bottom nav would cover the card's lower edge in the crop: hide it for the shot only (layout unchanged).
        await page.addStyleTag({ content: 'nav[aria-label="Mobile"]{visibility:hidden !important}' }).then((h) => h.evaluate((el) => { el.id = 'shot-nav-hide' }))
        const seen = await page.evaluate(() => {
          const r = document.querySelector('[data-incident-trend]').getBoundingClientRect()
          const lbl = document.querySelector('[data-xlabel]')
          const lr = lbl?.getBoundingClientRect()
          const hit = lr ? document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2) : null
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, labelInCard: !lbl || !!hit?.closest('[data-incident-trend]') }
        })
        check('crop shows the whole card, axis row not covered', { ...ctx, shot: name }, seen, seen.top >= clip.y && seen.bottom <= clip.y + clip.height && seen.left >= clip.x && seen.right <= clip.x + clip.width && seen.labelInCard)
        await page.screenshot({ path: path.join(OUT_DIR, `${name}-${vp.name}-${scheme}.png`), clip })
        await page.evaluate(() => document.getElementById('shot-nav-hide')?.remove())
        if (grow) { await page.setViewportSize({ width: vp.width, height: vp.height }); await pinCoarse() }
      }
      // A full page: grow the viewport to the page height (Playwright's fullPage drops touch emulation at 390), re-pin, settle, assert it is still coarse, shoot.
      const fullShot = async (name, ctx) => {
        await park(); await settle(page)
        const h = await page.evaluate(() => document.scrollingElement.scrollHeight)
        await page.setViewportSize({ width: vp.width, height: Math.min(h, 4000) })
        if (vp.mobile) await pinCoarse()
        await park(); await settle(page); await page.waitForTimeout(250)
        const g = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, coarse: matchMedia('(pointer: coarse)').matches, control: document.querySelector('button')?.getBoundingClientRect().height ?? 0 }))
        check('full page settled', ctx, g, g.sw <= g.cw && (!vp.mobile || (g.coarse && g.control >= 44)))
        await page.screenshot({ path: path.join(OUT_DIR, 'full', `${name}-${vp.name}-${scheme}.png`) })
        await page.setViewportSize({ width: vp.width, height: vp.height })
        if (vp.mobile) await pinCoarse()
      }
      const toggle = () => card().getByRole('button', { name: /^(Show|Hide) chart$/ })
      const cardMetrics = () => card().evaluate((c) => { const r = c.getBoundingClientRect(); return { h: r.height, right: r.right, inner: innerWidth, sw: document.documentElement.scrollWidth } })

      // 12. Default state per width: nothing stored, collapsed at 390, expanded at 1280.
      {
        const ctx = { width: vp.name, theme: scheme, state: 'default' }
        await open({ name: 'longest', hidden: undefined })
        const expanded = await toggle().getAttribute('aria-expanded')
        check('12 default state per width', ctx, { expanded }, vp.mobile ? expanded === 'false' : expanded === 'true')
      }

      // ---- Expanded, the longest copy (the stored choice wins) ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'expanded' }
        await open({ name: 'longest', hidden: '0' })
        const c = await cardMetrics()
        const gutter = vp.mobile ? 16 : 20
        check('1 no overflow, card inside gutter', ctx, c, c.sw <= c.inner && c.right <= c.inner - gutter)

        const slots = await page.evaluate(() => [...document.querySelectorAll('[data-trend-month]')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width } }))
        check('2 six months', ctx, { n: slots.length }, slots.length === 6)
        check('3 slot >= 44, no overlap', ctx, { min: Math.min(...slots.map((s) => s.w)) }, slots.every((s, i) => s.w >= 44 && (i === 0 || slots[i - 1].r <= s.l + 0.5)))

        const bars = await page.evaluate(() => [...document.querySelectorAll('[data-bar]')].map((e) => { const r = e.getBoundingClientRect(); return { kind: e.dataset.bar, w: r.width, h: r.height } }))
        const rpW = bars.filter((b) => b.kind === 'rp').map((b) => b.w)
        // The hollow Other rect is drawn 1.5px inside the bar, so its outer width is w + 1.5.
        const widthOk = bars.every((b) => { const w = b.kind === 'other' ? b.w + 1.5 : b.w; return w >= 15.99 && w <= 48.01 })
        const sizeOk = vp.mobile ? rpW.every((w) => Math.abs(w - 25) <= 1) : rpW.every((w) => Math.abs(w - 48) <= 0.5)
        check('4 bar width 16-48, RP >= 2 tall, Other >= 4 tall', ctx, { rp: rpW[0], bars: bars.length }, bars.length > 0 && widthOk && sizeOk && bars.every((b) => (b.kind === 'rp' ? b.h >= 2 : b.h >= 4)))

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

        const labels = await page.evaluate(() => [...document.querySelectorAll('[data-xlabel]')].map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent, l: r.left, r: r.right } }))
        const monthRow = labels.filter((l) => l.text !== 'so far').sort((a, b) => a.l - b.l)
        const soFar = labels.find((l) => l.text === 'so far')
        check('6 x labels gapped, "so far" inside its slot', ctx, { n: monthRow.length, soFar }, monthRow.length === 6 && monthRow.every((l, i) => i === 0 || monthRow[i - 1].r + 4 <= l.l) && !!soFar && soFar.l >= slots[5].l - 0.5 && soFar.r <= slots[5].r + 0.5)

        const zero = await page.evaluate(() => {
          const z = document.querySelector('[data-zero]')
          const r = z?.getBoundingClientRect()
          const s = z?.closest('[data-trend-month]')?.getBoundingClientRect()
          return r && s ? { l: r.left, r: r.right, sl: s.left, sr: s.right } : null
        })
        check('8 zero marker inside its slot', ctx, zero, !!zero && zero.l >= zero.sl - 0.5 && zero.r <= zero.sr + 0.5)

        const legend = await page.evaluate(() => {
          const l = document.querySelector('[data-legend]')
          return l ? { h: l.getBoundingClientRect().height, tops: [...l.children].map((k) => k.getBoundingClientRect().top) } : null
        })
        check('9 legend on one line', ctx, legend, !!legend && legend.h <= 20 && legend.tops.every((t) => Math.abs(t - legend.tops[0]) <= 1))

        const h = (await cardMetrics()).h
        check('10 card height expanded', ctx, { h }, vp.mobile ? h >= 370 && h <= 450 : h >= 220 && h <= 260)

        // 17. Focus ring on the plot.
        await page.locator('[data-plot]').focus()
        const ring = await page.locator('[data-plot]').evaluate((el) => {
          const s = getComputedStyle(el)
          const probe = document.createElement('i')
          probe.style.color = 'var(--color-ring)'
          document.body.append(probe)
          const want = getComputedStyle(probe).color
          probe.remove()
          return { width: s.outlineWidth, color: s.outlineColor, want }
        })
        check('17 focus ring 2px in --color-ring', ctx, ring, ring.width === '2px' && ring.color === ring.want)
        await page.locator('[data-plot]').evaluate((el) => el.blur())

        // 15. The readout lies inside the plot: hovered at 1280, tapped at 390.
        const plot = await page.locator('[data-plot]').boundingBox()
        if (vp.mobile) await page.touchscreen.tap(plot.x + plot.width * 0.75, plot.y + plot.height * 0.4)
        else await page.mouse.move(plot.x + plot.width * 0.9, plot.y + plot.height * 0.4)
        await page.locator('[data-readout]').waitFor({ timeout: 5000 })
        const ro = await page.locator('[data-readout]').boundingBox()
        check('15 readout inside plot', ctx, { ro, plot }, ro.x >= plot.x - 0.5 && ro.x + ro.width <= plot.x + plot.width + 0.5 && ro.y >= plot.y - 0.5 && ro.y + ro.height <= plot.y + plot.height + 0.5)
        await shot('readout', ctx)
        await park()

        if (vp.mobile) {
          const tb = await toggle().evaluate((el) => {
            const r = el.getBoundingClientRect()
            const pad = getComputedStyle(el, '::before')
            return { w: r.width, h: r.height, padH: parseFloat(pad.height) || 0, padW: parseFloat(pad.width) || 0 }
          })
          check('16 toggle hit area >= 44', ctx, tb, Math.max(tb.h, tb.padH) >= 44 && Math.max(tb.w, tb.padW) >= 44)
        }

        // 19. The card sits below the QSC banner.
        const order = await page.evaluate(() => ({ banner: document.querySelector('[role="alert"]')?.getBoundingClientRect().bottom ?? null, card: document.querySelector('[data-incident-trend]').getBoundingClientRect().top }))
        check('19 card below the QSC banner', ctx, order, order.banner !== null && order.card > order.banner)

        await open({ name: 'longest', hidden: '0' })
        await shot('expanded', ctx)
        await fullShot('page-expanded', ctx)
      }

      // ---- 7. The widest y labels (a 1,240 month) stay inside the svg ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'high' }
        await open({ name: 'high', hidden: '0' })
        const y = await page.evaluate(() => {
          const s = document.querySelector('[data-plot] svg').getBoundingClientRect()
          return [...document.querySelectorAll('[data-ytick] text')].map((t) => t.getBoundingClientRect().left - s.left)
        })
        check('7 y labels inside the svg', ctx, { min: Math.min(...y), n: y.length }, y.length > 0 && y.every((v) => v >= -0.5))
        await shot('high', ctx)
      }

      // ---- Collapsed ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'collapsed' }
        await open({ name: 'longest', hidden: '1' })
        const h = (await cardMetrics()).h
        check('11 card height collapsed', ctx, { h }, h <= (vp.mobile ? 170 : 120))
        await shot('collapsed', ctx)
      }

      // ---- No incidents ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'no-incidents' }
        await open({ name: 'empty', hidden: '0' })
        const h = (await cardMetrics()).h
        check('13 card height no incidents', ctx, { h }, h <= (vp.mobile ? 110 : 84))
        await shot('no-incidents', ctx)
      }

      // ---- Error (once per breakpoint, light) ----
      if (scheme === 'light') {
        const ctx = { width: vp.name, theme: scheme, state: 'error' }
        fixture = 'failing'
        await page.goto(`${BASE_URL}/incidents`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await card().waitFor({ timeout: 60_000 })
        await card().getByRole('button', { name: 'Try again' }).waitFor({ timeout: 30_000 })
        await pinCoarse(); await settled(page); await page.waitForTimeout(300)
        const h = (await cardMetrics()).h
        check('14 card height error', ctx, { h }, h <= (vp.mobile ? 200 : 130))
        await shot('error', ctx)
      }

      // ---- 18. Forced colours (1280, light) ----
      if (!vp.mobile && scheme === 'light') {
        const ctx = { width: vp.name, theme: 'forced-colors', state: 'expanded' }
        await page.emulateMedia({ forcedColors: 'active' })
        await open({ name: 'longest', hidden: '0' })
        const fc = await page.evaluate(() => ({ rp: getComputedStyle(document.querySelector('.it-rp')).fill, other: getComputedStyle(document.querySelector('.it-other')).fill, stroke: getComputedStyle(document.querySelector('.it-other')).stroke }))
        check('18 forced colours: RP fill differs from Other, Other has a stroke', ctx, fc, fc.rp !== fc.other && fc.stroke !== 'none')
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
