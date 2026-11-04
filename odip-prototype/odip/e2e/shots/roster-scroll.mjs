// ROSTER-SCROLL shots: Publish bar gap and window-first scroll-up hand-off, real wheel input only.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const OUT_DIR = process.env.OUT_DIR, BASE_URL = process.env.BASE_URL
mkdirSync(OUT_DIR, { recursive: true })
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const WEEK = '2026-09-07'
const shift = (id, pid, pname, staffId, staffName, date, start, end, status, findings = []) => ({
  id, participantId: pid, participantName: pname, staffId, staffName, serviceDate: date, startTime: start, endTime: end, endsNextDay: false,
  durationHours: 6, ratio: 'OneToOne', nightType: 'None', status, shiftPatternId: null, notes: null, overrideReason: null, findings, assigneeOnApprovedLeave: false,
})
const block = (code, message) => ({ code, severity: 'Blocking', message, requiresReason: false })
const NAMES = ['Ava Nguyen', 'Noah Williams', 'Olivia Brown', 'Ethan Singh', 'Isla Roberts', 'Lucas Martin', 'Chloe Kelly', 'Jack Taylor']

// mode: drafts (default) | blocked (only blocked drafts) | published | unstarted
function shape(board, mode) {
  const rows = board.participantRows
  for (let i = 0; i < 28; i++) {
    const pid = `p-busy-${i}`
    rows.push({ participantId: pid, fullName: `${NAMES[i % 8]} ${i}`, supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, inOnboarding: false,
      shifts: [shift(`busy-r${i}`, pid, 'x', 's-0003', "Jack O'Sullivan", board.days[i % 7], '09:00:00', '15:00:00', mode === 'drafts' && i % 2 ? 'Draft' : 'Published')],
      tripBars: [], scheduledHours: 6, daysWithoutCover: 6 })
  }
  if (mode === 'blocked') rows[0].shifts.push(shift('blk-1', rows[0].participantId, 'x', 's-0003', "Jack O'Sullivan", board.days[1], '07:00:00', '13:00:00', 'Draft', [block('QUALIFICATION_EXPIRED', 'First aid certificate expired.')]))
  if (mode === 'unstarted') board.weekStarted = false
  if (mode === 'drafts') board.pendingAgreements = [{ participantId: 'p-0001', displayName: 'Liam Okafor', draftId: 'd-1', version: 2, canReceiveServices: true }]
  return board
}

const browser = await chromium.launch({ headless: true })
const results = {}
const notes = {}
async function open(width, height, { mode = 'drafts', theme = 'light', role = 'Coordinator', to = '/rostering?date=' + WEEK } = {}) {
  const touch = width < 700
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce', locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: touch, isMobile: touch })
  await context.addInitScript(([id, t]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: t })) } catch (e) {} }, [USER_ID, theme])
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }) }))
  await page.route('**/api/v1/rostering/board*', async (route) => {
    const res = await route.fetch(); const body = await res.json()
    if (body && body.data && body.data.weekStart === WEEK) body.data = shape(body.data, mode)
    return route.fulfill({ response: res, json: body })
  })
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' }); await signIn.waitFor({ state: 'visible', timeout: 60000 }); await signIn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  await page.goto(BASE_URL + to, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  if (width >= 1024) await page.waitForFunction(() => { const m = document.querySelector('#main'), a = document.querySelector('aside'); return m && a && m.getBoundingClientRect().left >= a.getBoundingClientRect().right - 1 }, null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
  return { context, page }
}
const shot = (page, n) => page.screenshot({ path: path.join(OUT_DIR, n + '.png') })
const step = async (n, fn) => { try { await fn() } catch (e) { notes[n] = String(e).slice(0, 200); console.log('[rs] FAIL', n, notes[n]) } }

const rnd = (n) => Math.round(n * 10) / 10
// Page-side numbers: bar, footer, window scroll, board scroller.
const probe = (page) => page.evaluate(() => {
  const r = (el) => el.getBoundingClientRect(), se = document.scrollingElement
  const bar = document.querySelector('[data-publish-bar]'), f = document.querySelector('footer')
  const box = document.querySelector('[data-fit-screen] [class~="lg:overflow-y-auto"]')
  const o = { scrollTop: Math.round(se.scrollTop), scrollMax: se.scrollHeight - innerHeight, innerHeight, hScroll: document.documentElement.scrollWidth > innerWidth }
  if (bar) { o.barBottom = r(bar).bottom; o.barTop = r(bar).top }
  if (f) { o.footerTop = r(f).top; o.footerBottom = r(f).bottom; o.footerHeight = r(f).height }
  if (box) { o.boxBottom = r(box).bottom; o.boxScrollable = box.scrollHeight > box.clientHeight }
  return o
})
const toEnd = async (page) => { await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight)); await page.waitForTimeout(300) }
const cropBar = async (page, name) => {
  const y = Math.max(0, (await page.evaluate(() => innerHeight)) - 360)
  await page.screenshot({ path: path.join(OUT_DIR, name + '.png'), clip: { x: 0, y, width: await page.evaluate(() => innerWidth), height: 360 } })
}

// Bar buttons: edges, height, and the bar's own height (checks g, h, i).
const barBox = (page) => page.evaluate(() => {
  const bar = document.querySelector('[data-publish-bar]'), w = innerWidth
  const b = [...bar.querySelectorAll('button')].map((x) => x.getBoundingClientRect())
  return { barH: bar.firstElementChild.getBoundingClientRect().height, minLeft: Math.min(...b.map((r) => r.left)), maxRight: Math.max(...b.map((r) => r.right)), minH: Math.min(...b.map((r) => r.height)), n: b.length, w }
})

const board = (page) => page.evaluate(() => {
  const b = document.querySelector('[data-fit-screen] [class~="lg:overflow-y-auto"]'), f = document.querySelector('footer'), se = document.scrollingElement
  return { y: Math.round(se.scrollTop), yMax: se.scrollHeight - innerHeight, top: Math.round(b.scrollTop), topMax: b.scrollHeight - b.clientHeight, footerTop: f.getBoundingClientRect().top, innerHeight }
})
const gaps = (page) => page.evaluate(() => {
  const bar = document.querySelector('[data-publish-bar]'), call = bar.firstElementChild, nav = document.querySelector('nav[aria-label="Mobile"]')
  const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--section-gap'))
  const floor = nav && nav.getBoundingClientRect().height > 0 ? nav.getBoundingClientRect().top : innerHeight
  return { token, gap: floor - call.getBoundingClientRect().bottom, barToFloor: floor - bar.getBoundingClientRect().bottom }
})
const wheel = async (page, dy, wait = 700) => { await page.mouse.wheel(0, dy); await page.waitForTimeout(wait) }

await step('w1280', async () => {
  const { context, page } = await open(1280, 800)
  const o = await board(page)
  const box = await page.evaluate(() => { const r = document.querySelector('[data-fit-screen] [class~="lg:overflow-y-auto"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })
  await page.mouse.move(box.x, box.y)
  // (a) gap with the window at top.
  const ga = await gaps(page)
  results.a1280 = { ...ga, scrollY: o.y, pass: o.y === 0 && ga.gap >= ga.token - 0.5 }
  await cropBar(page, 'bar-top-1280')
  results.hNormal = { ...(await barBox(page)) }; results.hNormal.pass = results.hNormal.barH <= 56
  await page.screenshot({ path: path.join(OUT_DIR, 'full-1280.png'), fullPage: true })
  // (e) down: board first, then the footer.
  const down = []
  for (let i = 0; i < 40; i++) { await wheel(page, 300); const s = await board(page); down.push([s.top, s.y]); if (s.y >= s.yMax - 1) break }
  const firstWindow = down.find(([, y]) => y > 0), end = await board(page)
  results.e = { steps: down.length, boardTopWhenWindowStarted: firstWindow && firstWindow[0], topMax: end.topMax, endY: end.y, yMax: end.yMax, pass: !!firstWindow && firstWindow[0] >= end.topMax - 1 && end.y >= end.yMax - 1 && end.footerTop < end.innerHeight }
  await cropBar(page, 'bar-footer-1280')
  const ga2 = await gaps(page)
  results.a1280footer = { ...ga2, pass: ga2.gap >= ga2.token - 0.5 }
  // (b) one wheel up of ~120 at the end state.
  const before = await board(page)
  await wheel(page, -120)
  const b1 = await board(page)
  results.b = { before: [before.y, before.top], after: [b1.y, b1.top], pass: b1.y < before.y && b1.top === before.top }
  // (c) keep wheeling until the footer is below the viewport; the board must not move meanwhile; then it must.
  let moved = false
  for (let i = 0; i < 10; i++) { const s = await board(page); if (s.footerTop >= s.innerHeight - 1) break; if (s.top !== before.top) moved = true; await wheel(page, -120) }
  const c1 = await board(page)
  await wheel(page, -120)
  const c2 = await board(page)
  results.c = { footerTopAtGone: Math.round(c1.footerTop), boardMovedBeforeFooterGone: moved, y: c1.y, topBefore: c1.top, topAfter: c2.top, pass: c1.footerTop >= c1.innerHeight - 1 && !moved && c1.top === before.top && c2.top < c1.top }
  // (d) up to the board's top, then one more wheel: the window is at 0.
  for (let i = 0; i < 60; i++) { const s = await board(page); if (s.top === 0) break; await wheel(page, -400, 300) }
  await wheel(page, -120)
  const d = await board(page)
  results.d = { top: d.top, y: d.y, pass: d.top === 0 && d.y === 0 }
  await page.getByRole('button', { name: 'Select shifts' }).click()
  await page.waitForFunction(() => document.querySelector('[data-publish-bar] [aria-live="polite"]') !== null)
  await page.waitForTimeout(300)
  await cropBar(page, 'selecting-1280')
  results.hSelecting = { ...(await barBox(page)) }; results.hSelecting.pass = results.hSelecting.barH <= 56
  const ga3 = await gaps(page)
  results.aSelecting = { ...ga3, pass: ga3.gap >= ga3.token - 0.5 }
  await context.close()
})
await step('w390', async () => {
  const { context, page } = await open(390, 844)
  const ga = await gaps(page)
  const m = await page.evaluate(() => ({ hScroll: document.documentElement.scrollWidth > innerWidth }))
  const innerScroller = await page.evaluate(() => { const b = document.querySelector('[data-fit-screen] [class*="overflow-y-auto"]'); return b ? getComputedStyle(b).overflowY : 'none' })
  await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight))
  await page.waitForTimeout(400)
  await cropBar(page, 'bar-390')
  const gN = await barBox(page)
  await page.getByRole('button', { name: 'Select shifts' }).click()
  await page.waitForFunction(() => document.querySelector('[data-publish-bar] [aria-live="polite"]') !== null)
  await page.evaluate(() => scrollTo(0, document.scrollingElement.scrollHeight))
  await page.waitForTimeout(400)
  await cropBar(page, 'selecting-390')
  const gS = await barBox(page)
  const fits = (g) => g.minLeft >= 16 && g.maxRight <= g.w - 16
  results.g = { normal: gN, selecting: gS, pass: fits(gN) && fits(gS) }
  results.i = { normal: gN.minH, selecting: gS.minH, pass: gN.minH >= 44 && gS.minH >= 44 }
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.waitForTimeout(300)
  const h = await page.evaluate(() => document.scrollingElement.scrollHeight)
  await page.setViewportSize({ width: 390, height: h })
  await page.waitForTimeout(500)
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  await page.screenshot({ path: path.join(OUT_DIR, 'full-390.png') })
  results.a390 = { ...ga, innerScroller, coarseAfterResize: coarse, pass: ga.gap >= ga.token - 0.5 && Math.abs(ga.barToFloor) <= 1 && innerScroller === 'visible' }
  results.f = { hScroll: m.hScroll, pass: !m.hScroll }
  await context.close()
})
const allPass = ['a1280', 'a1280footer', 'aSelecting', 'a390', 'b', 'c', 'd', 'e', 'f', 'g', 'hNormal', 'hSelecting', 'i'].every((k) => results[k] && results[k].pass)
const out = { allPass, results, notes }
writeFileSync(path.join(OUT_DIR, 'checks.json'), JSON.stringify(out, null, 1))
await browser.close(); console.log('[rs] DONE'); console.log(JSON.stringify(out))
