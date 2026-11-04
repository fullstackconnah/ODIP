// CT1 shots: the Compatibility table (participants x staff). Fixture: 40 participants x 60 staff, mocked at the route.
// States: empty, filled, one focused cell with the inspector, the bulk confirm, at 1280; a coarse-pointer run at 900; the 390 board fallback.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const OUT_DIR = process.env.OUT_DIR, BASE_URL = process.env.BASE_URL
mkdirSync(OUT_DIR, { recursive: true })
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const FIRST = ['Ava', 'Noah', 'Olivia', 'Ethan', 'Isla', 'Lucas', 'Chloe', 'Jack', 'Mia', 'Leo']
const LAST = ['Nguyen', 'Williams', 'Brown', 'Singh', 'Roberts', 'Martin', 'Kelly', 'Taylor', 'Chen', 'Okafor', 'Hall', 'Wong']
const person = (kind, i) => { const f = FIRST[i % 10], l = LAST[(i * 7 + 3) % 12]; return { id: `${kind}-${String(i).padStart(3, '0')}`, firstName: f, lastName: l, fullName: `${f} ${l} ${i}` } }
const PARTICIPANTS = Array.from({ length: 40 }, (_, i) => person('p', i))
const STAFF = Array.from({ length: 60 }, (_, i) => ({ ...person('s', i), username: `staff${i}`, role: 'SupportWorker', position: 'SupportWorker', isActive: true }))
const mkRow = (p, s, level, rank, reason) => ({ staffId: s.id, staffName: s.fullName, participantId: p.id, participantName: p.fullName, level, rank, reason, updatedAt: '2026-10-01T00:00:00Z' })
function fixtureRows() {
  const rows = []
  PARTICIPANTS.forEach((p, i) => {
    rows.push(mkRow(p, STAFF[i % 60], 'Preferred', 1, i % 3 ? null : 'Knows the routine'))
    rows.push(mkRow(p, STAFF[(i + 1) % 60], 'Backup', 1, null))
    rows.push(mkRow(p, STAFF[(i + 2) % 60], 'Emergency', 1, null))
    if (i % 4 === 0) rows.push(mkRow(p, STAFF[(i + 9) % 60], 'Excluded', 0, 'Past conflict'))
  })
  return rows
}

const browser = await chromium.launch({ headless: true })
const results = {}, notes = {}
async function open(width, height, { rows, touch = false, to = '/rostering/compatibility?view=table', role = 'Coordinator' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: touch, isMobile: touch })
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch (e) {} }, [USER_ID])
  const page = await context.newPage()
  const live = rows.map((r) => ({ ...r }))
  const puts = []
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }) }))
  await page.route((u) => u.pathname === '/api/v1/staff', (r) => r.fulfill({ json: envelope(STAFF) }))
  await page.route((u) => u.pathname === '/api/v1/participants', (r) => r.fulfill({ json: envelope({ items: PARTICIPANTS, totalCount: PARTICIPANTS.length, page: 1, pageSize: 500, totalPages: 1, hasNext: false, hasPrevious: false }) }))
  await page.route((u) => u.pathname === '/api/v1/rostering/compatibility', async (r) => {
    const req = r.request()
    if (req.method() === 'PUT') {
      const b = req.postDataJSON(); puts.push(b)
      const p = PARTICIPANTS.find((x) => x.id === b.participantId), s = STAFF.find((x) => x.id === b.staffId)
      const i = live.findIndex((x) => x.participantId === b.participantId && x.staffId === b.staffId)
      if (i >= 0) live.splice(i, 1)
      const inTier = live.filter((x) => x.participantId === b.participantId && x.level === b.level).length
      const row = mkRow(p, s, b.level, b.level === 'Allowed' || b.level === 'Excluded' ? 0 : (b.rank ?? inTier + 1), b.reason ?? null)
      if (b.level !== 'Allowed') live.push(row)
      return r.fulfill({ json: envelope(row) })
    }
    return r.fulfill({ json: envelope(live) })
  })
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' }); await signIn.waitFor({ state: 'visible', timeout: 60000 }); await signIn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  await page.goto(BASE_URL + to, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  if (width >= 1024) await page.waitForFunction(() => { const m = document.querySelector('#main'), a = document.querySelector('aside'); return m && a && m.getBoundingClientRect().left >= a.getBoundingClientRect().right - 1 }, null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1000)
  return { context, page, puts }
}
const shot = (page, n, opts = {}) => page.screenshot({ path: path.join(OUT_DIR, n + '.png'), ...opts })
const step = async (n, fn) => { try { await fn() } catch (e) { notes[n] = String(e).slice(0, 240); console.log('[ct1] FAIL', n, notes[n]) } }
const rnd = (n) => Math.round(n * 10) / 10
const cellOf = (page, p, s) => page.locator(`td[role="gridcell"][data-r="${p}"][data-c="${s}"]`)

// 1280: empty, filled, sticky, focus, bulk.
await step('empty', async () => {
  const { context, page } = await open(1280, 800, { rows: [] })
  await page.getByRole('grid').waitFor({ state: 'visible', timeout: 15000 })
  await shot(page, 'table-empty-1280')
  const m = await page.evaluate(() => ({ cells: document.querySelectorAll('td[role="gridcell"]').length, hScroll: document.documentElement.scrollWidth > innerWidth, hint: !!document.body.innerText.match(/Nothing set yet|No pairings|Allowed by default/i) }))
  results.empty = { ...m, pass: m.cells > 0 && !m.hScroll }
  await context.close()
})
await step('filled', async () => {
  const { context, page, puts } = await open(1280, 800, { rows: fixtureRows() })
  await page.getByRole('grid').waitFor({ state: 'visible', timeout: 15000 })
  await shot(page, 'table-filled-1280')
  // Sticky header and first column, measured against the scroll box.
  const sticky = await page.evaluate(async () => {
    const grid = document.querySelector('table[role="grid"]'), box = grid.parentElement, r = (el) => el.getBoundingClientRect()
    const th = grid.querySelector('thead th[scope="col"]:nth-child(2)'), rh = grid.querySelector('tbody th[scope="row"]'), corner = grid.querySelector('thead th:first-child')
    box.scrollTop = 400; box.scrollLeft = 300; await new Promise((res) => setTimeout(res, 300))
    const b = r(box)
    return {
      scrolledY: box.scrollTop, scrolledX: box.scrollLeft,
      headTopDelta: rnd2(r(th).top - (b.top + box.clientTop)), cornerTopDelta: rnd2(r(corner).top - (b.top + box.clientTop)),
      firstColLeftDelta: rnd2(r(rh).left - (b.left + box.clientLeft)), cornerLeftDelta: rnd2(r(corner).left - (b.left + box.clientLeft)),
    }
    function rnd2(n) { return Math.round(n * 10) / 10 }
  })
  await shot(page, 'table-scrolled-1280')
  results.sticky = { ...sticky, pass: sticky.scrolledY > 0 && sticky.scrolledX > 0 && Math.abs(sticky.headTopDelta) <= 1 && Math.abs(sticky.cornerTopDelta) <= 1 && Math.abs(sticky.firstColLeftDelta) <= 1 && Math.abs(sticky.cornerLeftDelta) <= 1 }
  await page.evaluate(() => { const b = document.querySelector('table[role="grid"]').parentElement; b.scrollTop = 0; b.scrollLeft = 0 })
  // One focused cell with the inspector (hover/focus line), then a keyed write.
  const cell = cellOf(page, 2, 3)
  await cell.focus() // a click on a writer's cell also opens the menu; the focus state is the one to look at
  await page.waitForTimeout(300)
  const insp = await page.evaluate(() => { const s = document.querySelector('[role="status"]'); return { status: s ? s.textContent : null, focused: document.activeElement && document.activeElement.getAttribute('role') } })
  await shot(page, 'table-focused-inspector-1280', { clip: { x: 0, y: 160, width: 1280, height: 440 } })
  await page.keyboard.press('b')
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => document.activeElement && document.activeElement.textContent)
  results.focus = { ...insp, putsAfterKey: puts.length, firstPut: puts[0] || null, cellTextAfterB: after, pass: insp.focused === 'gridcell' && puts.length === 1 && puts[0].level === 'Backup' }
  // Bulk confirm from the first staff column header menu: the column has Preferred cells, so the dialog says what clears.
  await page.getByRole('button', { name: 'Options for ' + STAFF[5].fullName }).first().click() // the header comes first in the DOM; participant 5 shares the name
  await page.getByRole('option', { name: 'Set all shown to Backup' }).click()
  const dlg = page.getByRole('alertdialog'); await dlg.waitFor({ state: 'visible', timeout: 5000 })
  const dtext = await dlg.innerText()
  await shot(page, 'table-bulk-confirm-1280')
  results.bulk = { dialog: dtext.replace(/\s+/g, ' ').slice(0, 300), mentionsPreferred: /clears the preferred worker/i.test(dtext), pass: /clears the preferred worker/i.test(dtext) }
  await dlg.getByRole('button', { name: 'Cancel' }).click()
  await context.close()
})
// 900 touch: coarse-pointer target sizes (the table shows from md up).
await step('touch900', async () => {
  const { context, page } = await open(900, 900, { rows: fixtureRows(), touch: true })
  await page.getByRole('grid').waitFor({ state: 'visible', timeout: 15000 })
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  const sizes = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect(), cells = [...document.querySelectorAll('td[role="gridcell"]')]
    const kebabs = [...document.querySelectorAll('button[aria-label^="Options for "]')]
    return { cellMinW: Math.min(...cells.map((c) => r(c).width)), cellMinH: Math.min(...cells.map((c) => r(c).height)), kebabMinW: Math.min(...kebabs.map((k) => r(k).width)), kebabMinH: Math.min(...kebabs.map((k) => r(k).height)), kebabs: kebabs.length, hScroll: document.documentElement.scrollWidth > innerWidth }
  })
  await cellOf(page, 1, 1).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menu').waitFor({ state: 'visible', timeout: 5000 })
  const menuMin = await page.evaluate(() => Math.min(...[...document.querySelectorAll('[role="menuitem"]')].map((i) => i.getBoundingClientRect().height)))
  await shot(page, 'table-touch-menu-900')
  results.touch900 = { coarse, ...sizes, menuItemMinH: rnd(menuMin), pass: coarse && sizes.cellMinW >= 44 && sizes.cellMinH >= 44 && sizes.kebabMinW >= 44 && sizes.kebabMinH >= 44 && menuMin >= 44 && !sizes.hScroll }
  await context.close()
})
// 390 touch: the participant board shows; no table, no Table segment, no horizontal scroll.
await step('phone390', async () => {
  const { context, page } = await open(390, 844, { rows: fixtureRows(), touch: true })
  await page.waitForTimeout(800)
  const m = await page.evaluate(() => ({ grid: !!document.querySelector('table[role="grid"]'), tableSegment: [...document.querySelectorAll('[role="radio"]')].some((e) => /^Table$/.test(e.textContent.trim()) && e.offsetParent !== null), hScroll: document.documentElement.scrollWidth > innerWidth, headings: document.querySelectorAll('h2,h3').length }))
  await shot(page, 'board-fallback-390')
  results.phone390 = { ...m, pass: !m.grid && !m.tableSegment && !m.hScroll }
  await context.close()
})
const allPass = Object.keys(notes).length === 0 && ['empty', 'sticky', 'focus', 'bulk', 'touch900', 'phone390'].every((k) => results[k] && results[k].pass)
const out = { allPass, results, notes }
writeFileSync(path.join(OUT_DIR, 'checks.json'), JSON.stringify(out, null, 1))
await browser.close(); console.log('[ct1] DONE'); console.log(JSON.stringify(out))
