// CFS shots: Compatibility "By participant" fits the screen from lg; the participant list scrolls under a pinned search, the board scrolls in its own column.
// Fixture: 40 participants x 60 staff mocked at the route, so the list overflows at 800 and 900 px tall. States: list-scrolled-1280, top-1440, table-1280, mobile-390 (touch).
// At lg the page IS the viewport, so the crops are the viewport itself (cropElement/fullPage would grow the viewport and undo the fit); the 390 page scrolls, so it uses fullPage.
import path from 'node:path'
import { prepareOutDir, fullPage, writeChecks } from '../shots/lib/capture.mjs'
let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const FIRST = ['Ava', 'Noah', 'Olivia', 'Ethan', 'Isla', 'Lucas', 'Chloe', 'Jack', 'Mia', 'Leo']
const LAST = ['Nguyen', 'Williams', 'Brown', 'Singh', 'Roberts', 'Martin', 'Kelly', 'Taylor', 'Chen', 'Okafor', 'Hall', 'Wong']
const person = (kind, i) => { const f = FIRST[i % 10], l = LAST[(i * 7 + 3) % 12]; return { id: `${kind}-${String(i).padStart(3, '0')}`, firstName: f, lastName: l, fullName: `${f} ${l} ${i}` } }
const PARTICIPANTS = Array.from({ length: 40 }, (_, i) => person('p', i))
const STAFF = Array.from({ length: 60 }, (_, i) => ({ ...person('s', i), username: `staff${i}`, role: 'SupportWorker', position: 'SupportWorker', isActive: true }))
const mkRow = (p, s, level, rank, reason) => ({ staffId: s.id, staffName: s.fullName, participantId: p.id, participantName: p.fullName, level, rank, reason, updatedAt: '2026-10-01T00:00:00Z' })
const ROWS = PARTICIPANTS.flatMap((p, i) => [
  mkRow(p, STAFF[i % 60], 'Preferred', 1, 'Knows the routine'), mkRow(p, STAFF[(i + 1) % 60], 'Backup', 1, null),
  mkRow(p, STAFF[(i + 2) % 60], 'Emergency', 1, null), mkRow(p, STAFF[(i + 9) % 60], 'Excluded', 0, 'Past conflict'),
])

const checks = []
const check = (name, value, ok) => { checks.push({ name, pass: !!ok, detail: String(value) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value}`) }
const browser = await chromium.launch({ headless: true })

async function open(width, height, touch, to) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: touch, isMobile: touch })
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch (e) {} }, [USER_ID])
  const page = await context.newPage()
  if (touch) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.on('pageerror', (e) => check(`page error (${width})`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role: 'Coordinator', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role: 'Coordinator', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }) }))
  await page.route((u) => u.pathname === '/api/v1/staff', (r) => r.fulfill({ json: envelope(STAFF) }))
  await page.route((u) => u.pathname === '/api/v1/participants', (r) => r.fulfill({ json: envelope({ items: PARTICIPANTS, totalCount: PARTICIPANTS.length, page: 1, pageSize: 500, totalPages: 1, hasNext: false, hasPrevious: false }) }))
  await page.route((u) => u.pathname === '/api/v1/rostering/compatibility', (r) => r.fulfill({ json: envelope(ROWS) }))
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' }); await signIn.waitFor({ state: 'visible', timeout: 60000 }); await signIn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  await page.goto(BASE_URL + to, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  if (width >= 1024) await page.waitForFunction(() => { const m = document.querySelector('#main'), a = document.querySelector('aside'); return m && a && m.getBoundingClientRect().left >= a.getBoundingClientRect().right - 1 }, null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1000)
  return page
}
const NAV = 'nav[aria-label="Participants"]'
const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) })

async function desktop(width, height, scrolled) {
  const bp = String(width)
  const page = await open(width, height, false, '/rostering/compatibility?participant=p-000')
  await page.locator(NAV).waitFor({ timeout: 30000 })
  const list = page.locator(`${NAV} ul`), search = page.locator(`${NAV} input`)
  const m0 = await page.evaluate(() => {
    const foot = document.querySelector('footer')
    return { over: document.documentElement.scrollHeight - innerHeight, foot: foot ? Math.round(foot.getBoundingClientRect().height) : 0, fit: !!document.querySelector('[data-fit-screen]'),
      tall: [...document.querySelectorAll('body *')].map((e) => ({ t: e.tagName + (e.id ? '#' + e.id : '') + '.' + String(e.className).slice(0, 40), b: Math.round(e.getBoundingClientRect().bottom + scrollY) })).sort((a, b) => b.b - a.b).slice(0, 3) }
  })
  check(`page fits the screen (${bp}): overflow <= footer + 1`, `${m0.over} vs footer ${m0.foot} ${JSON.stringify(m0.tall)}`, m0.fit && m0.over <= m0.foot + 1)
  const l0 = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop }))
  check(`list overflows its scroller (${bp})`, JSON.stringify(l0), l0.sh > l0.ch)
  const top0 = (await search.boundingBox()).y
  const lb = await list.boundingBox()
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
  await page.mouse.wheel(0, 400)
  await page.waitForTimeout(400)
  const l1 = await list.evaluate((el) => el.scrollTop), wy = await page.evaluate(() => scrollY)
  check(`wheel over the list scrolls the list, not the window (${bp})`, `scrollTop ${l1}, scrollY ${wy}`, l1 > 0 && wy === 0)
  const top1 = (await search.boundingBox()).y
  check(`search stays pinned (${bp})`, `${top0} -> ${top1}`, Math.abs(top1 - top0) < 0.5)
  const board = await page.locator('h2', { hasText: PARTICIPANTS[0].fullName }).locator('xpath=..').boundingBox()
  check(`board panel not clipped (${bp})`, `bottom ${Math.round(board.y + board.height)} vs ${height}`, board.y + board.height <= height + 0.5)
  await shot(page, scrolled ? `list-scrolled-${bp}` : `top-${bp}`)
  await page.context().close()
}

async function table() {
  const page = await open(1280, 800, false, '/rostering/compatibility?view=table')
  await page.getByRole('grid').waitFor({ timeout: 30000 })
  const fit = await page.evaluate(() => !!document.querySelector('[data-fit-screen]'))
  const tall = await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)
  check('table view keeps the window scroll (1280)', `fit ${fit}, window scrolls ${tall}`, !fit && tall)
  await shot(page, 'table-1280')
  await page.context().close()
}

async function mobile() {
  const page = await open(390, 844, true, '/rostering/compatibility')
  await page.locator(NAV).waitFor({ timeout: 30000 })
  const m = await page.evaluate((nav) => {
    const ul = document.querySelector(`${nav} ul`), n = document.querySelector(nav)
    return { winScrolls: document.documentElement.scrollHeight > innerHeight, ulY: getComputedStyle(ul).overflowY, navY: getComputedStyle(n).overflowY, coarse: matchMedia('(pointer: coarse)').matches }
  }, NAV)
  check('390: window scrolls, no inner scroller, as on main', JSON.stringify(m), m.winScrolls && m.ulY === 'visible' && m.navY === 'visible' && m.coarse)
  const r = await fullPage(page, path.join(OUT_DIR, 'full', 'mobile-390.png'), { touch: true })
  checks.push(...r.checks)
  await page.context().close()
}

try {
  await desktop(1280, 800, true)
  await desktop(1440, 900, false)
  await table()
  await mobile()
} finally {
  writeChecks(OUT_DIR, checks)
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
process.exit(failed.length ? 1 : 0)
