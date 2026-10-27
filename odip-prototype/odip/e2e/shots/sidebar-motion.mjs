// The sidebar collapse/expand motion ("the rail gathers"): seeks every animation to fixed times and prints the numeric checks
// (widths, label opacity, content edge, end states, totals, overflow, clipped badge or ring), plus padded crops of the aside.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/sidebar-motion.mjs <outdir>
// Time is faked (page.clock) so the 80/110ms timers fire exactly when asked; every Animation is paused and given currentTime = T - offset.
import { mkdirSync } from 'node:fs'
import path from 'node:path'

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

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devLogin = envelope({
  id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin',
  role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001',
})

let pass = 0
let fail = 0
const check = (label, ok, detail) => {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail ?? ''}`)
}
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol

// Page-side helpers, installed once per page.
const INSTALL = (pauseOnClick) => {
  window.__pauseAll = () => document.getAnimations().forEach((a) => a.pause())
  // Runs after React's own click handling (bubble, document level): the commit and its layout effect have happened, so the
  // WAAPI animations exist; getAnimations() flushes style, so the CSS transitions exist too. Pausing now = time 0 of the click.
  if (pauseOnClick) document.addEventListener('click', () => window.__pauseAll())
  window.__maxEnd = 0
  window.__seek = (T, dir, finish) => {
    const zone = (a) => (a.effect?.target?.closest?.('[data-foot]') ? 'foot' : 'nav')
    for (const a of document.getAnimations()) {
      a.pause()
      const sb = typeof a.id === 'string' && a.id.startsWith('sb-')
      let offset = 0
      if (sb) offset = zone(a) === 'foot' ? (dir === 'collapse' ? (T >= 80 ? 80 : 0) : 110) : dir === 'collapse' ? 80 : 0
      const end = a.effect.getComputedTiming().endTime
      if (sb) window.__maxEnd = Math.max(window.__maxEnd, offset + end)
      if (finish && T - offset >= end) a.finish()
      else a.currentTime = Math.min(Math.max(T - offset, 0), end)
    }
  }
  const px = (el) => el.getBoundingClientRect()
  const opacity = (el) => {
    // effective opacity: this element times its ancestors up to the aside
    let o = 1
    for (let e = el; e && e.tagName !== 'ASIDE'; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity)
    return o
  }
  window.__measure = () => {
    const aside = document.querySelector('aside#app-menu')
    const main = aside.nextElementSibling
    const dash = aside.querySelector('nav a[href="/"]')
    const toggle = aside.querySelector('[data-glide="toggle"]')
    const header = document.querySelector('header')
    const label = dash.querySelector('[data-fold="label"]')
    const badges = [...aside.querySelectorAll('span.rounded-full')].filter((s) => /^\d/.test(s.textContent))
    const rowBadge = [...aside.querySelectorAll('[data-fold="trail"]')].find((s) => /^\d/.test(s.textContent))
    const tg = px(toggle)
    const glides = [...aside.querySelectorAll('[data-glide]')]
    const moving = glides.map((g) => ({ key: g.dataset.glide, t: getComputedStyle(g).transform })).filter((g) => g.t && g.t !== 'none')
    const tile = aside.querySelector('[data-brand]')
    return {
      asideW: px(aside).width,
      asideRight: px(aside).right,
      mainLeft: px(main).left,
      dashWide: !dash.classList.contains('size-10'),
      labelOpacity: label ? opacity(label) : null,
      rowBadgeOpacity: rowBadge ? opacity(rowBadge) : null,
      folding: aside.hasAttribute('data-folding'),
      toggleSize: [tg.width, tg.height],
      toggleRight: tg.right,
      movingCount: moving.length,
      moving: moving.slice(0, 3),
      tileOpacity: tile ? opacity(tile) : null,
      noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      headerH: px(header).height,
      headerRight: px(header.firstElementChild.lastElementChild).right,
      badgeRights: badges.filter((b) => opacity(b) > 0.01).map((b) => px(b).right),
      activeIsToggle: document.activeElement === toggle,
      itemSizes: [...aside.querySelectorAll('nav > a, nav > button')].map((e) => [Math.round(px(e).width), Math.round(px(e).height)]),
      widthDur: document.getAnimations().filter((a) => a.transitionProperty === 'width').map((a) => a.effect.getTiming().duration),
    }
  }
  // the translate left on the Dashboard link at progress 0 = old position - new position
  window.__dashDx = () => {
    const el = document.querySelector('aside#app-menu a[href="/"]')
    const saved = document.getAnimations().filter((a) => a.id === 'sb-glide').map((a) => [a, a.currentTime])
    saved.forEach(([a]) => (a.currentTime = 0))
    const m = new DOMMatrix(getComputedStyle(el).transform)
    saved.forEach(([a, t]) => (a.currentTime = t))
    return m.e
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function open(browser, vp, { collapsed, reduced = false, clock = true, drawer = false }) {
  const context = await browser.newContext({
    viewport: vp, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: reduced ? 'reduce' : 'no-preference',
  })
  if (collapsed) {
    await context.addInitScript((id) => localStorage.setItem(`odip_ui_prefs:${id}`, JSON.stringify({ sidebarCollapsed: true })), USER_ID)
  }
  await context.addInitScript(() => localStorage.setItem('odip_nav_open_groups', JSON.stringify(['trips'])))
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`PAGEERROR ${e.message}`))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route(/\/api\/v1\/leave(\?|$)/, (r) => r.fulfill({ json: envelope([{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }]) }))
  if (clock) await page.clock.install({ time: new Date() })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/trips`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  // below lg the toggle is hidden and the aside is a drawer behind the header's menu button
  if (drawer) await page.getByRole('button', { name: 'Open menu' }).waitFor({ state: 'visible', timeout: 60_000 })
  else await page.locator('aside#app-menu [data-glide="toggle"]').waitFor({ state: 'visible', timeout: 60_000 })
  // the pending-leave badge shows up when the (mock) leave queue answers
  await page.waitForFunction(() => [...document.querySelectorAll('aside#app-menu span.rounded-full')].some((s) => /^\d/.test(s.textContent)), null, { timeout: 30_000, polling: 100 })
  await page.evaluate(INSTALL, clock)
  await page.waitForTimeout(500) // let route-level data and transitions settle on the real clock
  if (clock) await page.clock.pauseAt(new Date(Date.now() + 2000))
  return { context, page }
}

const press = async (page) => {
  await page.locator('aside#app-menu [data-glide="toggle"]').focus()
  await page.keyboard.press('Enter')
}

async function waitFor(page, fn, what) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(fn)) return
    await sleep(50)
  }
  throw new Error(`timed out waiting for ${what}`)
}

const SWAP = {
  collapse: () => document.querySelector('aside#app-menu a[href="/"]').classList.contains('size-10'),
  expand: () => document.querySelector('aside#app-menu [data-glide="toggle"]').getBoundingClientRect().width > 150,
}
const WIDTH = { collapse: { 0: 232, 60: 93, 120: 65, 200: 64 }, expand: { 0: 64, 60: 195, 120: 228, 200: 232 } }

async function run(browser, vp, dir) {
  const tag = `${vp.width}-${dir}`
  const { context, page } = await open(browser, vp, { collapsed: dir === 'expand' })
  const crop = (name) => page.screenshot({ path: path.join(OUT_DIR, `${tag}-${name}.png`), clip: { x: 0, y: 0, width: 272, height: vp.height } })
  const swapAt = dir === 'collapse' ? 80 : 110
  await press(page)
  let prev = 0
  let dx = null
  for (const T of [0, 60, 120, 200]) {
    if (T > prev) await page.clock.runFor(T - prev)
    // the timer fired inside this step: wait for React's commit of the swap
    if (prev < swapAt && T >= swapAt) {
      await waitFor(page, SWAP[dir], 'the layout swap')
      if (dir === 'collapse') dx = await page.evaluate(() => window.__dashDx())
    }
    prev = T
    await page.evaluate(([t, d, fin]) => window.__seek(t, d, fin), [T, dir, T === 200])
    const m = await page.evaluate(() => window.__measure())
    const L = `${tag} T=${T}`
    check(`${L} aside width`, near(m.asideW, WIDTH[dir][T], 2), m.asideW.toFixed(1))
    check(`${L} content edge tracks the sidebar edge`, near(m.mainLeft, m.asideRight, 1), `${m.mainLeft.toFixed(1)} vs ${m.asideRight.toFixed(1)}`)
    check(`${L} no horizontal overflow`, m.noOverflow)
    check(`${L} header 48 high`, m.headerH === 48, `h=${m.headerH}`)
    check(`${L} focus stays on the toggle`, m.activeIsToggle)
    check(`${L} no visible badge past the aside edge`, m.badgeRights.every((r) => r <= m.asideRight + 0.5), m.badgeRights.map((r) => r.toFixed(1)).join(','))
    check(`${L} toggle ring (+2px) inside the aside`, m.toggleRight + 2 <= m.asideRight + 0.5, `${(m.toggleRight + 2).toFixed(1)} <= ${m.asideRight.toFixed(1)}`)
    console.log(`      label=${m.labelOpacity?.toFixed?.(2) ?? 'sr-only'} rowBadge=${m.rowBadgeOpacity?.toFixed?.(2) ?? 'none'} folding=${m.folding} wide=${m.dashWide} toggle=${m.toggleSize.map((v) => Math.round(v))} moving=${m.movingCount} tile=${m.tileOpacity?.toFixed?.(2) ?? '-'} headerRight=${m.headerRight.toFixed(1)}`)
    if (dir === 'collapse') {
      if (T === 0) check(`${L} wide, label 1, toggle 40x40, row badge 0`, m.dashWide && near(m.labelOpacity, 1, 0.05) && near(m.toggleSize[0], 40, 1) && (m.rowBadgeOpacity ?? 0) < 0.05)
      if (T === 60) check(`${L} wide, label 0, folding`, m.dashWide && m.labelOpacity < 0.05 && m.folding)
      if (T === 120) check(`${L} rail, an item below the group moving`, !m.dashWide && m.movingCount > 0, JSON.stringify(m.moving[0] ?? null))
      if (T === 200) check(`${L} rail, items 40x40, tile 1`, !m.dashWide && m.itemSizes.every(([w, h]) => w === 40 && h === 40) && near(m.tileOpacity, 1, 0.05), JSON.stringify(m.itemSizes.slice(0, 3)))
    } else {
      if (T === 0) check(`${L} wide nav, label 0, toggle still 40x40`, m.dashWide && near(m.labelOpacity, 0, 0.05) && near(m.toggleSize[0], 40, 1))
      if (T === 60) check(`${L} label 0.94, row badge 0`, near(m.labelOpacity, 0.94, 0.05) && (m.rowBadgeOpacity ?? 0) < 0.05, `${m.labelOpacity?.toFixed(2)} / ${m.rowBadgeOpacity?.toFixed?.(2)}`)
      if (T === 120) check(`${L} label 1, foot wide, row badge > 0`, near(m.labelOpacity, 1, 0.05) && near(m.toggleSize[0], 208, 2) && (m.rowBadgeOpacity ?? 0) > 0, `${m.labelOpacity?.toFixed(2)} / ${m.rowBadgeOpacity?.toFixed?.(2)} toggle=${Math.round(m.toggleSize[0])}`)
    }
    if (vp.width === 1280 && (dir === 'collapse' || T === 200)) await crop(`T${T}`)
    if (vp.width === 1280 && dir === 'collapse' && (T === 0 || T === 200)) {
      const w = T === 0 ? 240 : 72
      await page.screenshot({ path: path.join(OUT_DIR, `1280-brand-row-${T === 0 ? 'expanded' : 'collapsed'}.png`), clip: { x: 0, y: 0, width: w, height: 72 } })
    }
    if (T === 0) check(`${L} width transition ${dir === 'collapse' ? 140 : 160}ms`, m.widthDur.includes(dir === 'collapse' ? 140 : 160), JSON.stringify(m.widthDur))
  }
  const left = await page.evaluate(() => document.getAnimations().map((a) => `${a.id || a.constructor.name}:${a.transitionProperty ?? ''}:${a.playState}`))
  const maxEnd = await page.evaluate(() => window.__maxEnd)
  check(`${tag} no animations left at the end`, left.length === 0, left.join(' ') || 'none')
  check(`${tag} last motion ends at ${dir === 'collapse' ? 180 : 170}ms`, near(maxEnd, dir === 'collapse' ? 180 : 170, 5), `${maxEnd}`)
  if (dx !== null) check(`${tag} Dashboard icon moves <= 1px sideways at the swap`, Math.abs(dx) <= 1, `dx=${dx.toFixed(2)}`)
  await page.screenshot({ path: path.join(OUT_DIR, `${vp.width}-${dir === 'collapse' ? 'collapsed' : 'expanded'}-page.png`) })
  await context.close()
}

async function reduced(browser, vp) {
  const { context, page } = await open(browser, vp, { collapsed: false, reduced: true, clock: false })
  for (const [dir, want] of [['collapse', 64], ['expand', 232]]) {
    await press(page)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const m = await page.evaluate(() => ({ ...window.__measure(), sb: document.getAnimations().filter((a) => a.id?.startsWith('sb-')).length }))
    check(`${vp.width} reduced motion ${dir}: final layout one frame later`, near(m.asideW, want, 1) && m.dashWide === (dir === 'expand') && m.sb === 0 && !m.folding, `w=${m.asideW} wide=${m.dashWide} sb=${m.sb}`)
  }
  await context.close()
}

// Opening and closing a nav group keeps its own transitions (the fold rule must not override them): the panel grows over 200ms, the chevron turns over 150ms.
async function groups(browser, vp, drawer) {
  const { context, page } = await open(browser, vp, { collapsed: false, clock: false, drawer })
  if (drawer) {
    await page.getByRole('button', { name: 'Open menu' }).click()
    await page.locator('aside#app-menu').getByRole('button', { name: /Trips/ }).waitFor({ state: 'visible' })
    await sleep(500)
  }
  const m = await page.evaluate(async () => {
    const g = [...document.querySelectorAll('aside#app-menu button[aria-controls]')].find((b) => /Trips/.test(b.textContent))
    const panel = document.getElementById(g.getAttribute('aria-controls'))
    const chevron = g.querySelector('svg')
    const h = () => panel.getBoundingClientRect().height
    const openH = h()
    g.click()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))) // React commits, the transition starts
    const ps = getComputedStyle(panel)
    const cs = getComputedStyle(chevron)
    const out = { openH, panelProp: ps.transitionProperty, panelDur: ps.transitionDuration, chevProp: cs.transitionProperty, chevDur: cs.transitionDuration }
    const anims = document.getAnimations().filter((a) => a.transitionProperty === 'grid-template-rows')
    anims.forEach((a) => { a.pause(); a.currentTime = 100 })
    out.nAnims = anims.length
    out.midH = h()
    anims.forEach((a) => a.finish())
    out.closedH = h()
    return out
  })
  const L = `${vp.width}${drawer ? ' drawer' : ''} group`
  check(`${L} panel transition grid-template-rows 200ms`, m.panelProp.includes('grid-template-rows') && m.panelDur.includes('0.2s'), `${m.panelProp} ${m.panelDur}`)
  check(`${L} chevron transition transform 150ms`, m.chevProp.includes('transform') && m.chevDur.includes('0.15s'), `${m.chevProp} ${m.chevDur}`)
  check(`${L} panel height at 100ms is between closed and open`, m.nAnims > 0 && m.midH > m.closedH && m.midH < m.openH, `closed=${m.closedH} mid=${m.midH.toFixed(1)} open=${m.openH} anims=${m.nAnims}`)
  await context.close()
}

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of [{ width: 1280, height: 800 }, { width: 1024, height: 768 }]) {
    await run(browser, vp, 'collapse')
    await run(browser, vp, 'expand')
    await reduced(browser, vp)
  }
  await groups(browser, { width: 1280, height: 800 }, false)
  await groups(browser, { width: 390, height: 844 }, true)
} finally {
  await browser.close()
}
console.log(`CHECKS: ${pass} pass, ${fail} fail`)
