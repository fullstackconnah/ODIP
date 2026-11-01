// Captures and numeric checks for the claims sent-and-paid-by-week card on /claims (PLAN "Numeric checks for the shots" 1-7). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/claims-pipeline.mjs <outdir>
// The mock API serves each state (mock-api/mock-claims-pipeline.js); a fixture is asked for with `?fixture=`, added here by page.route.
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
const KEY = 'odip.claims.pipelineHidden'
// The mixed fixture's pinned sentence (sent 17,920.50, paid 14,210.50, waiting 5,230.25; mock-api/mock-claims-pipeline.js).
const MIXED_SENTENCE = "$17,920.50 sent to the NDIA in the last 12 weeks and $14,210.50 paid. $5,230.25 is waiting on the NDIA's results."
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' })

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
      const c = document.querySelector('[data-claims-pipeline]')?.getBoundingClientRect()
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
  await warm.goto(`${BASE_URL}/claims`, { waitUntil: 'networkidle', timeout: 120_000 })
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
      let hold = null // a promise the pipeline route waits on, for the loading shot
      await page.route('**/api/v1/claim-hub/pipeline*', async (r) => {
        const url = new URL(r.request().url())
        if (hold) await hold
        if (fixture) url.searchParams.set('fixture', fixture)
        await r.fulfill({ response: await r.fetch({ url: url.toString() }) })
      })
      await signIn(page)

      const card = () => page.locator('[data-claims-pipeline]')
      const open = async ({ name, hidden } = {}) => {
        fixture = name ?? null
        await page.goto(`${BASE_URL}/claims`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await page.evaluate(([k, v]) => { try { if (v === undefined) localStorage.removeItem(k); else localStorage.setItem(k, v) } catch { /* ignore */ } }, [KEY, hidden])
        await page.goto(`${BASE_URL}/claims`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await card().waitFor({ timeout: 60_000 })
        await page.waitForFunction(() => { const c = document.querySelector('[data-claims-pipeline]'); return c && !c.hasAttribute('aria-busy') }, null, { timeout: 30_000 })
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
          const r = document.querySelector('[data-claims-pipeline]').getBoundingClientRect()
          const lbl = document.querySelector('[data-xlabel]')
          const lr = lbl?.getBoundingClientRect()
          const hit = lr ? document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2) : null
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, labelInCard: !lbl || !!hit?.closest('[data-claims-pipeline]') }
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
      const cardMetrics = () => card().evaluate((c) => { const r = c.getBoundingClientRect(); return { h: r.height, right: r.right, inner: innerWidth, sw: document.documentElement.scrollWidth } })
      const weekCenters = () => page.evaluate(() => [...document.querySelectorAll('[data-cp-week]')].map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, c: (r.left + r.right) / 2, w: r.width } }))

      // ---- Normal, the full fixture: every week has both bars (checks 1, 2, 3, 4, 6, 7) ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'full' }
        await open({ name: 'full', hidden: '0' })
        const c = await cardMetrics()
        check('3 no horizontal scroll', ctx, c, c.sw <= c.inner && c.right <= c.inner)

        await page.locator('[data-plot]').scrollIntoViewIfNeeded()
        const weeks = await weekCenters()
        // The hatched Sent rect is drawn 0.75px inside its slot so its 1.5px outline stays in the slot: measure the outer edge, outline included.
        const bars = await page.evaluate(() => [...document.querySelectorAll('[data-bar]')].map((e) => { const r = e.getBoundingClientRect(); const o = e.dataset.bar === 'sent' ? 0.75 : 0; return { kind: e.dataset.bar, l: r.left - o, r: r.right + o, w: r.width + 2 * o, h: r.height + 2 * o, week: e.closest('[data-cp-week]')?.dataset.cpWeek } }))
        check('1 12 week columns, 24 bars', ctx, { weeks: weeks.length, bars: bars.length }, weeks.length === 12 && bars.length === 24)

        const labels = await page.evaluate(() => [...document.querySelectorAll('[data-xlabel]')].map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent, l: r.left, r: r.right, c: (r.left + r.right) / 2 } }))
        const row = labels.filter((l) => l.text !== 'so far').sort((a, b) => a.l - b.l)
        const want = vp.mobile ? [2, 5, 8, 11] : [...Array(12).keys()]
        const labelsOk = row.length === want.length && want.every((wi, i) => Math.abs(row[i].c - weeks[wi].c) <= 1.5)
        check('2 x labels: 4 at the current week -0/-3/-6/-9 at 390, 12 at 1280', ctx, { n: row.length, texts: row.map((l) => l.text) }, labelsOk)
        check('3 label boxes >= 4px apart', ctx, { n: row.length }, row.every((l, i) => i === 0 || row[i - 1].r + 4 <= l.l))
        const svgRight = await page.evaluate(() => document.querySelector('[data-plot] svg').getBoundingClientRect().right)
        check('F2 every x label (so far included) ends inside the svg', ctx, { svgRight, maxRight: Math.max(...labels.map((l) => l.r)) }, labels.length > 0 && labels.every((l) => l.r <= svgRight + 0.01))

        const byWeek = new Map()
        for (const b of bars) byWeek.set(b.week, { ...byWeek.get(b.week), [b.kind]: b })
        const gaps = [...byWeek.values()].filter((p) => p.sent && p.paid).map((p) => p.paid.l - p.sent.r)
        const minW = Math.min(...bars.map((b) => b.w))
        const maxW = Math.max(...bars.map((b) => b.w))
        check('2 bar width: >= 5px at 390, <= 27px at 1280; pair gap 2px +-0.5', ctx, { minW, maxW, gaps: [Math.min(...gaps), Math.max(...gaps)] },
          (vp.mobile ? minW >= 5 : maxW <= 27) && gaps.length === 12 && gaps.every((g) => Math.abs(g - 2) <= 0.5) && bars.every((b) => b.h >= 2))

        const text = await page.evaluate(() => [...document.querySelectorAll('[data-claims-pipeline] svg text')].map((t) => parseFloat(getComputedStyle(t).fontSize)))
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
        check('6 SVG text is 12px, no card text under 12px', ctx, { svg: [...new Set(text)], small }, text.length > 0 && text.every((v) => v === 12) && small.length === 0)

        // 6. Tab reaches the plot and its focus outline shows.
        let reached = false
        for (let i = 0; i < 80 && !reached; i++) {
          await page.keyboard.press('Tab')
          reached = await page.evaluate(() => document.activeElement?.hasAttribute('data-plot'))
        }
        const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: s.outlineWidth } })
        check('6 focus outline visible on the plot after Tab', ctx, { reached, ring }, reached && ring.style !== 'none' && parseFloat(ring.width) >= 2)
        if (reached) await shot('keyboard-focus', ctx)
        await page.evaluate(() => document.activeElement?.blur())

        // 7. Every money string is dollars and cents (axis ticks excepted).
        const money = await card().evaluate((cd) => {
          const clone = cd.cloneNode(true)
          clone.querySelectorAll('[data-ytick]').forEach((e) => e.remove())
          return (clone.textContent.match(/\$[\d,]+(?:\.\d*)?/g) ?? [])
        })
        check('7 money strings are $d,ddd.dd', ctx, { n: money.length, bad: money.filter((m) => !/^\$[\d,]+\.\d{2}$/.test(m)) }, money.length > 0 && money.every((m) => /^\$[\d,]+\.\d{2}$/.test(m)))

        // 4. The pinned readout stays inside the plot on the first and last week.
        const plot = await page.locator('[data-plot]').boundingBox()
        for (const [which, wi] of [['first', 0], ['last', 11]]) {
          const target = weeks[wi]
          if (vp.mobile) await page.touchscreen.tap(target.c, plot.y + plot.height * 0.4)
          else await page.mouse.move(target.c, plot.y + plot.height * 0.4)
          await page.locator('[data-readout]').waitFor({ timeout: 5000 })
          const ro = await page.locator('[data-readout]').boundingBox()
          check(`4 readout inside plot (${which} week)`, ctx, { ro, plot }, ro.x >= plot.x - 0.5 && ro.x + ro.width <= plot.x + plot.width + 0.5 && ro.y >= plot.y - 0.5 && ro.y + ro.height <= plot.y + plot.height + 0.5)
          if (which === 'last') await shot('readout-pinned', ctx)
          if (vp.mobile) await page.touchscreen.tap(vp.width - 4, 4)
          await park()
        }

        await open({ name: 'full', hidden: '0' })
        await shot('normal', ctx)
        if (scheme === 'light' || vp.mobile) await fullShot('page-normal', ctx)
      }

      // ---- Mixed: zero weeks have no bar (check 1), the pinned sentence and the card above the files strip (check 5) ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'mixed' }
        await open({ name: 'mixed', hidden: '0' })
        const n = await page.evaluate(() => ({ weeks: document.querySelectorAll('[data-cp-week]').length, bars: document.querySelectorAll('[data-bar]').length }))
        check('1 mixed: 12 weeks, a bar only where there are dollars', ctx, n, n.weeks === 12 && n.bars === 12)
        const s = await card().evaluate((cd) => cd.querySelector('p.max-w-prose')?.textContent ?? null)
        check('5 sentence matches the pinned copy', ctx, { s }, s === MIXED_SENTENCE)
        const order = await page.evaluate(() => ({ card: document.querySelector('[data-claims-pipeline]').getBoundingClientRect().bottom, strip: document.querySelector('[data-testid="claims-strip"]')?.getBoundingClientRect().top ?? null }))
        check('5 card bottom above the files strip', ctx, order, order.strip !== null && order.card <= order.strip)
        await shot('mixed', ctx)
      }

      // ---- The widest y labels (a six-figure week) stay inside the svg ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'high' }
        await open({ name: 'high', hidden: '0' })
        const y = await page.evaluate(() => {
          const s = document.querySelector('[data-plot] svg').getBoundingClientRect()
          return [...document.querySelectorAll('[data-ytick] text')].map((t) => t.getBoundingClientRect().left - s.left)
        })
        check('y labels inside the svg', ctx, { min: Math.min(...y), n: y.length }, y.length > 0 && y.every((v) => v >= -0.5))
        await shot('high', ctx)
      }

      // ---- Hidden, empty (with the owed clause), nothing owed ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'hidden' }
        await open({ name: 'mixed', hidden: '1' })
        const hidden = await card().evaluate((cd) => ({ plot: !cd.querySelector('[data-plot]') || cd.querySelector('[data-plot]').offsetParent === null, sentence: !!cd.querySelector('p.max-w-prose') }))
        check('hidden: plot gone, sentence kept', ctx, hidden, hidden.plot && hidden.sentence)
        await shot('hidden', ctx)
      }
      for (const name of ['owed', 'empty']) {
        const ctx = { width: vp.name, theme: scheme, state: name }
        await open({ name, hidden: '0' })
        const n = await page.evaluate(() => document.querySelectorAll('[data-cp-week]').length)
        check(`${name}: sentence only, no chart`, ctx, { n }, n === 0)
        await shot(name, ctx)
      }

      // ---- Error (both themes, both breakpoints) ----
      {
        const ctx = { width: vp.name, theme: scheme, state: 'error' }
        fixture = 'failing'
        await page.goto(`${BASE_URL}/claims`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await card().waitFor({ timeout: 60_000 })
        await card().getByRole('button', { name: 'Try again' }).waitFor({ timeout: 30_000 })
        await pinCoarse(); await settled(page); await page.waitForTimeout(300)
        await shot('error', ctx)
      }

      // ---- Loading (390, light): the skeleton holds the loaded card's height ----
      if (vp.mobile && scheme === 'light') {
        const ctx = { width: vp.name, theme: scheme, state: 'loading' }
        await open({ name: 'full', hidden: '0' })
        const loaded = (await card().boundingBox()).height
        let release
        hold = new Promise((r) => { release = r })
        await page.goto(`${BASE_URL}/claims`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        await page.locator('[data-claims-pipeline][aria-busy="true"]').waitFor({ timeout: 60_000 })
        await pinCoarse(); await page.waitForTimeout(300)
        const busy = (await card().boundingBox()).height
        // The skeleton reserves the worst-case sentence and footnote, so it is never shorter than the loaded card (nothing is pushed down); the delta is reported.
        check('loading: skeleton is at least the loaded card height (delta reported)', ctx, { busy, loaded, delta: busy - loaded }, busy >= loaded - 0.5)
        await shot('loading', ctx)
        release(); hold = null
      }

      // ---- Stale data (390, light): a failed refetch keeps the chart and adds the note ----
      if (vp.mobile && scheme === 'light') {
        const ctx = { width: vp.name, theme: scheme, state: 'stale' }
        await open({ name: 'full', hidden: '0' })
        fixture = 'failing'
        await page.waitForTimeout(31_000) // the query's staleTime is 30s: a remount before that does not refetch
        // Leave and re-enter /claims inside the app: the remounted card refetches the stale query while the cached weeks stay on screen.
        const go = (to) => page.evaluate((u) => { history.pushState({}, '', u); window.dispatchEvent(new PopStateEvent('popstate')) }, to)
        await go('/'); await page.waitForTimeout(500); await go('/claims')
        await card().getByRole('button', { name: 'Try again' }).waitFor({ timeout: 40_000 })
        await settled(page); await page.waitForTimeout(300)
        const n = await page.evaluate(() => document.querySelectorAll('[data-cp-week]').length)
        check('stale: the 12 weeks stay beside the note', ctx, { n }, n === 12)
        await shot('stale', ctx)
      }

      // ---- Forced colours (1280, light): Paid and Sent differ and Sent has a stroke ----
      if (!vp.mobile && scheme === 'light') {
        const ctx = { width: vp.name, theme: 'forced-colors', state: 'full' }
        await page.emulateMedia({ forcedColors: 'active' })
        await open({ name: 'full', hidden: '0' })
        const fc = await page.evaluate(() => {
          const s = getComputedStyle(document.querySelector('[data-bar="sent"]'))
          const p = getComputedStyle(document.querySelector('[data-bar="paid"]'))
          return { sent: s.fill, paid: p.fill, stroke: s.stroke }
        })
        check('forced colours: Paid fill differs from Sent, Sent has a stroke', ctx, fc, fc.sent !== fc.paid && fc.stroke !== 'none')
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
