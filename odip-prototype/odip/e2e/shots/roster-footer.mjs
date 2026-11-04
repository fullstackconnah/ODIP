// RFOOT shots: footer below the fold, the Publish bar rests on the viewport bottom.
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

for (const w of [1280, 1440]) {
  const h = w === 1280 ? 800 : 900
  await step('w' + w, async () => {
    const { context, page } = await open(w, h)
    const top = await probe(page)
    await cropBar(page, `top-${w}-bottom-crop`)
    await page.screenshot({ path: path.join(OUT_DIR, `full-${w}.png`), fullPage: true })
    // Check 1.
    const c1 = { barBottomToViewport: rnd(top.innerHeight - top.barBottom), footerTop: rnd(top.footerTop), scrollTop: top.scrollTop }
    c1.pass = top.scrollTop === 0 && Math.abs(top.innerHeight - top.barBottom) <= 2 && top.footerTop >= top.innerHeight - 1
    // Check 2.
    await toEnd(page)
    const end = await probe(page)
    await cropBar(page, `end-${w}-bottom-crop`)
    const c2 = { footerTop: rnd(end.footerTop), footerBottom: rnd(end.footerBottom), footerHeight: rnd(end.footerHeight), barBottom: rnd(end.barBottom), scrollDistance: end.scrollTop, innerHeight: end.innerHeight }
    c2.pass = end.footerTop >= 0 && end.footerBottom <= end.innerHeight + 1 && end.barBottom <= end.footerTop + 1 && end.scrollTop <= end.footerHeight + 24
    // Check 3.
    await page.evaluate(() => scrollTo(0, 0))
    const c3 = await page.evaluate(async () => {
      const box = document.querySelector('[data-fit-screen] [class~="lg:overflow-y-auto"]'), r = (el) => el.getBoundingClientRect()
      const band = box.children[0]
      box.scrollTop = 400; await new Promise((res) => setTimeout(res, 250))
      const o = { scrollable: box.scrollHeight > box.clientHeight, scrolled: box.scrollTop, bandTopDelta: Math.round((r(band).top - r(box).top) * 10) / 10 }
      box.scrollTop = 0
      return o
    })
    c3.pass = c3.scrollable && c3.scrolled > 0 && Math.abs(c3.bandTopDelta) <= 1
    results[`w${w}`] = { c1, c2, c3 }
    await context.close()
  })
}
// Check 4: roster footer height vs /participants footer (1280).
await step('c4', async () => {
  const a = await open(1280, 800)
  await toEnd(a.page)
  const roster = await probe(a.page)
  await a.context.close()
  const b = await open(1280, 800, { to: '/participants' })
  await toEnd(b.page)
  await b.page.screenshot({ path: path.join(OUT_DIR, 'participants-1280.png') })
  const part = await probe(b.page)
  await b.context.close()
  results.c4 = { rosterFooterHeight: rnd(roster.footerHeight), participantsFooterHeight: rnd(part.footerHeight), pass: Math.abs(roster.footerHeight - part.footerHeight) <= 1 }
})
// Check 5: 390 touch.
await step('c5', async () => {
  const { context, page } = await open(390, 844)
  const m = await page.evaluate(async () => {
    const r = (el) => el.getBoundingClientRect(), bar = document.querySelector('[data-publish-bar]'), nav = document.querySelector('nav[aria-label="Mobile"]'), f = document.querySelector('footer')
    const o = { barBottom: bar && r(bar).bottom, navTop: nav && r(nav).top, footerTopAtTop: f && r(f).top, innerHeight, hScroll: document.documentElement.scrollWidth > innerWidth }
    scrollTo(0, document.scrollingElement.scrollHeight); await new Promise((res) => setTimeout(res, 300))
    o.footerBottomAtEnd = r(f).bottom; o.footerTopAtEnd = r(f).top
    return o
  })
  await page.screenshot({ path: path.join(OUT_DIR, 'end-390.png') })
  results.c5 = { ...m, pass: !m.hScroll && m.footerTopAtTop >= m.innerHeight - 1 && m.footerTopAtEnd < m.innerHeight && Math.abs(m.barBottom - m.navTop) <= 1 }
  await context.close()
})
// Check 6: no drafts, no bar: the board still fills to the viewport bottom.
await step('c6', async () => {
  const { context, page } = await open(1280, 800, { mode: 'published' })
  const p = await probe(page)
  await cropBar(page, 'nodrafts-1280-bottom-crop')
  results.c6 = { barPresent: p.barBottom !== undefined, boxBottom: rnd(p.boxBottom), innerHeight: p.innerHeight, footerTop: rnd(p.footerTop), pass: p.barBottom === undefined && p.innerHeight - p.boxBottom <= 2 && p.footerTop >= p.innerHeight - 1 }
  await context.close()
})
const allPass = Object.values(results).every((v) => (v.pass !== undefined ? v.pass : [v.c1, v.c2, v.c3].every((c) => c.pass)))
const out = { allPass, results, notes }
writeFileSync(path.join(OUT_DIR, 'checks.json'), JSON.stringify(out, null, 1))
await browser.close(); console.log('[rf] DONE'); console.log(JSON.stringify(out))
