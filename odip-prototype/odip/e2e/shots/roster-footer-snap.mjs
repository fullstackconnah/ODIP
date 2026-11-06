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
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'no-preference', locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: touch, isMobile: touch })
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
const sample = (page) => page.evaluate(() => {
  const box = document.querySelector('[data-fit-screen] [class~="lg:overflow-y-auto"]'), f = document.querySelector('footer')
  return { y: Math.round(scrollY * 10) / 10, board: box ? Math.round(box.scrollTop * 10) / 10 : null, footerTop: f ? Math.round(f.getBoundingClientRect().top) : null, innerHeight }
})
const wheel = async (page, dy) => { await page.mouse.wheel(0, dy); await page.waitForTimeout(500) }

for (const [w, h] of [[1280, 800], [1440, 900]]) {
  await step('w' + w, async () => {
    const { context, page } = await open(w, h)
    await page.mouse.move(w / 2, h / 2)
    // down until the footer is visible and nothing moves any more
    let prev = null, down = []
    for (let i = 0; i < 60; i++) {
      await wheel(page, 100); const s = await sample(page); down.push(s)
      if (prev && s.y === prev.y && s.board === prev.board && s.footerTop < s.innerHeight) break
      prev = s
    }
    await shot(page, `footer-visible-${w}`)
    const up = []
    // The first step is traced frame by frame: a snap is one frame, a scroll is several.
    await page.evaluate(() => { window.__tr = []; const t0 = performance.now(); const f = () => { window.__tr.push(Math.round(scrollY)); if (performance.now() - t0 < 600) requestAnimationFrame(f) }; requestAnimationFrame(f) })
    for (let i = 0; i < 40; i++) {
      await wheel(page, -100); const s = await sample(page); up.push(s)
      if (s.y === 0 && s.board === 0) break
    }
    await shot(page, `after-wheel-up-${w}`)
    const start = down[down.length - 1]
    const seq = [start, ...up]
    const ys = seq.map((s) => s.y), bs = seq.map((s) => s.board)
    // (a) first up step moves the window by <= step + 1 (or the board takes it)
    const a = Math.max(0, ys[0] - ys[1]) <= 101
    // (b) monotonic non-increasing for both
    const mono = (arr) => arr.every((v, i) => i === 0 || v <= arr[i - 1] + 0.5)
    // (c) board never jumps by more than a step
    const c = bs.every((v, i) => i === 0 || Math.abs(v - bs[i - 1]) <= 101)
    // no single step moves window by more than a step either
    const d = ys.every((v, i) => i === 0 || Math.abs(v - ys[i - 1]) <= 101)
    const trace = await page.evaluate(() => window.__tr)
    const between = new Set(trace.filter((v) => v > 0 && v < start.y)).size
    const e = between >= 3
    results[`w${w}`] = { e, between, trace: trace.filter((v, i) => i === 0 || v !== trace[i - 1]), a, b: mono(ys) && mono(bs), c, d, pass: e && a && mono(ys) && mono(bs) && c && d, startY: ys[0], startBoard: bs[0], up, down: down.slice(-4) }
    await context.close()
  })
}
await step('c390', async () => {
  const { context, page } = await open(390, 844)
  const ys = []
  for (let i = 0; i < 6; i++) { await page.evaluate(() => scrollBy(0, 100)); await page.waitForTimeout(150); ys.push((await sample(page)).y) }
  for (let i = 0; i < 6; i++) { await page.evaluate(() => scrollBy(0, -100)); await page.waitForTimeout(150); ys.push((await sample(page)).y) }
  results.c390 = { ys, pass: ys.every((v, i) => i === 0 || Math.abs(v - ys[i - 1]) <= 101) }
  await context.close()
})
const allPass = Object.values(results).every((v) => v.pass)
const out = { allPass, results, notes }
writeFileSync(path.join(OUT_DIR, 'checks.json'), JSON.stringify(out, null, 1))
await browser.close(); console.log('[rfs] DONE'); console.log(JSON.stringify(out))
