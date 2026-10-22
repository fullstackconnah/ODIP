// Employment Hero PR 2 captures and the shape brief's numeric checks (section 8, checks 1-10).
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh eh-pr2 shots frontend/pr2-shots.mjs <outdir>
// Every Employment Hero call is answered here (page.route), so the mock API only has to serve the shell. Exits non-zero on any failed check.
import { mkdirSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })

const env = data => ({ success: true, data, message: null, errors: [] })
const fail = message => ({ success: false, data: null, message, errors: [] })
const LONG = 'Alexandria-Montgomery-Featherstonehaugh-Worthington-Smythe'
const WORDS = ['Sent', 'Waiting', 'Failed', 'Changed', 'Not linked']

const shift = (i, status, o = {}) => ({
  shiftId: `s${i}`, serviceDate: '2026-10-1' + (i % 9), participantName: 'Alex Example', rosteredStart: '09:00', rosteredEnd: '17:00', endsNextDay: false,
  rosteredMinutes: 480, actualStart: '2026-10-13T22:00:00Z', actualEnd: '2026-10-14T06:30:00Z', timeZoneId: 'Australia/Sydney', breakMinutes: 30,
  paidMinutes: 480, nightType: 'None', status, reason: status === 'Sent' ? '' : `Why ${status}.`, sentAt: status === 'Sent' ? '2026-10-15T01:00:00Z' : null,
  sendable: status === 'Waiting' || status === 'Failed', ...o,
})
const worker = (id, name, shifts, linked = true) => ({
  userId: id, name, linked, rosteredMinutes: shifts.length * 480, paidMinutes: shifts.length * 480, shifts,
})
const workers = (afterSend = false) => [
  worker('w1', 'Casey Changed', [shift(1, 'Changed', { reason: 'Changed after the pay run was finalised: fix it in Employment Hero.' })]),
  worker('w2', 'Fran Failed', [shift(2, 'Failed', { reason: 'Employment Hero refused the hours.' }), shift(3, 'Sent')]),
  worker('w3', 'Nina Notlinked', [shift(4, 'NotLinked', { reason: 'Not linked to Employment Hero.' })], false),
  worker('w4', LONG, [shift(5, afterSend ? 'Sent' : 'Waiting', { nightType: 'ActiveNight' }), shift(6, 'Sent', { nightType: 'Sleepover' })]),
  worker('w5', 'Sam Support', [shift(7, 'Sent'), shift(8, 'Sent')]),
  worker('w6', 'Wendy Waiting', [shift(9, afterSend ? 'Sent' : 'Waiting')]),
]
const counts = (afterSend = false) => ({
  from: '2026-10-06', to: '2026-10-19', approved: 10, sent: afterSend ? 8 : 6, waiting: afterSend ? 0 : 2, failed: 1, changed: 1, notLinked: 1,
  sendable: afterSend ? 1 : 3, awaitingApproval: 2, workers: workers(afterSend),
})
const emptyCheck = (from, to) => ({ from, to, approved: 0, sent: 0, waiting: 0, failed: 0, changed: 0, notLinked: 0, sendable: 0, awaitingApproval: 0, workers: [] })
const periods = [
  { payScheduleId: 1, scheduleName: 'Fortnightly', from: '2026-10-06', to: '2026-10-19', finalised: false },
  { payScheduleId: 1, scheduleName: 'Fortnightly', from: '2026-10-20', to: '2026-11-02', finalised: false },
  { payScheduleId: 1, scheduleName: 'Fortnightly', from: '2026-09-22', to: '2026-10-05', finalised: true },
]
const status = {
  configured: true, connected: true, businessId: '777', businessName: 'Acme Care', connectedAt: '2026-10-13T01:00:00Z', connectedByName: 'Ada Admin',
  lastSyncAt: '2026-10-14T01:00:00Z', lastSyncError: null, staffLinked: 12, staffNotLinked: 1, timesheetsSent: 1284, timesheetsWaiting: 3,
  workTypes: { standard: null, activeNight: '6', passiveNight: null, sleepover: null }, attention: [],
}
const workTypeList = [{ id: '5', name: 'Ordinary hours' }, { id: '6', name: 'Active night' }, { id: '7', name: 'Passive night' }, { id: '8', name: 'Sleepover' }]

const mode = { periods: 'ok', send: 'ok', workTypes: 'ok', save: 'ok', connected: true, sent: false }

async function stub(page) {
  await page.route('**/api/v1/auth/dev-users', r => r.fulfill({ json: env([{ username: 'dev.x', role: ROLE.current, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', r => r.fulfill({
    json: env({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.x', fullName: `Dev ${ROLE.current}`, role: ROLE.current, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }),
  }))
  await page.route('**/api/v1/integrations/employment-hero**', async route => {
    const url = new URL(route.request().url())
    const p = url.pathname.replace(/^.*employment-hero/, '')
    const method = route.request().method()
    if (p === '/payroll/periods') {
      if (mode.periods === 'error') return route.fulfill({ status: 500, json: fail('Boom') })
      return route.fulfill({ json: env({ connected: mode.connected, today: '2026-10-14', periods: mode.connected ? periods : [] }) })
    }
    if (p === '/payroll/send-missing' && method === 'POST') {
      await new Promise(r => setTimeout(r, 800))
      mode.sent = true
      return route.fulfill({ json: env({ queued: 3, check: counts(true) }) })
    }
    if (p === '/payroll') {
      const from = url.searchParams.get('from')
      if (from === '2026-10-06') return route.fulfill({ json: env(counts(mode.sent)) })
      return route.fulfill({ json: env(emptyCheck(from, url.searchParams.get('to'))) })
    }
    if (p === '/work-types' && method === 'PUT') {
      return mode.save === 'refused'
        ? route.fulfill({ status: 400, json: fail("That work type isn't in Employment Hero any more. Pick again.") })
        : route.fulfill({ json: env(status) })
    }
    if (p === '/work-types') {
      return mode.workTypes === 'error' ? route.fulfill({ status: 503, json: fail('Employment Hero is not answering.') }) : route.fulfill({ json: env(workTypeList) })
    }
    return route.fulfill({ json: env(status) })
  })
}

const ROLE = { current: 'Admin' }
const browser = await chromium.launch({ headless: true })
// Headless Chromium reports a fine pointer even with touch emulation; the 390 pass needs `pointer: coarse` for the house touch sizes.
const touchBrowser = await chromium.launch({ headless: true, args: ['--blink-settings=primaryPointerType=4,availablePointerTypes=4,primaryHoverType=1,availableHoverTypes=1'] })
const problems = []
const check = (ok, what) => { if (!ok) problems.push(what) }
const VIEWPORTS = [{ name: '1440', width: 1440, height: 900, touch: false }, { name: '1024', width: 1024, height: 768, touch: false }, { name: '390', width: 390, height: 844, touch: true }]

async function open(vp, role) {
  ROLE.current = role
  Object.assign(mode, { periods: 'ok', send: 'ok', workTypes: 'ok', save: 'ok', connected: true, sent: false })
  const context = await (vp.touch ? touchBrowser : browser).newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, locale: 'en-AU', timezoneId: 'Australia/Sydney' })
  const page = await context.newPage()
  page.on('pageerror', e => problems.push(`[${vp.name}] page error: ${e.message}`))
  await stub(page)
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return page
}
const go = async (page, p) => { await page.goto(`${BASE_URL}${p}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.locator('#main').waitFor({ state: 'attached', timeout: 60_000 }) }
const shot = (page, vp, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}-${vp.name}.png`), fullPage: true })
const rect = async loc => loc.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
const overflow = page => page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth)
const touchOk = async (page, loc, what, vp) => {
  if (vp.name !== '390') return
  for (const el of await loc.all()) {
    if (!(await el.isVisible())) continue
    const r = await rect(el)
    check(r.w >= 44 && r.h >= 44, `[390] ${what} is ${Math.round(r.w)}x${Math.round(r.h)}, under 44`)
  }
}

for (const vp of VIEWPORTS) {
  // Admin: the default page.
  let page = await open(vp, 'Admin')
  await go(page, '/rostering/payroll')
  await page.getByText('Casey Changed').first().waitFor({ timeout: 60_000 })
  await page.waitForTimeout(500)
  check((await overflow(page)) <= 0, `[${vp.name}] check 1: payroll scrolls sideways`)
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  console.log(`[${vp.name}] pointer coarse: ${coarse}`)
  check(coarse === vp.touch, `[${vp.name}] pointer: coarse is ${coarse}`)
  await touchOk(page, page.getByLabel('Pay period'), 'Pay period select', vp)
  await touchOk(page, page.getByRole('button', { name: /Send missing/ }), 'Send missing', vp)
  await touchOk(page, page.locator('#main button[aria-label*="shifts:"]'), 'disclosure button', vp)
  await touchOk(page, page.getByRole('link', { name: 'Open Completions' }), 'Open Completions', vp)
  await shot(page, vp, 'payroll-default') // a full-page screenshot drops touch emulation until the next navigation, so it comes last
  const badges = await page.locator('#main span.rounded-full').allInnerTexts()
  check(badges.length > 0 && badges.every(t => WORDS.includes(t.trim())), `[${vp.name}] check 7: badge words ${JSON.stringify([...new Set(badges)])}`)

  // 3: the long name wraps and is not clipped.
  const nameEl = page.getByText(LONG).first()
  const fit = await nameEl.evaluate(e => ({ sw: e.scrollWidth, cw: e.clientWidth, h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) || 20 }))
  check(fit.sw <= fit.cw + 1, `[${vp.name}] check 3: long name clipped (${fit.sw} > ${fit.cw})`)
  if (vp.name === '390') check(fit.h / fit.lh >= 1.5, `[${vp.name}] check 3: long name did not wrap (${fit.h}/${fit.lh})`)

  // 10: at 1024 a scrolling table keeps the Worker cell sticky.
  if (vp.name === '1024') {
    const sticky = await page.evaluate(() => {
      const t = document.querySelector('#main table'); if (!t) return null
      let box = t.parentElement; while (box && box.scrollWidth <= box.clientWidth && box !== document.body) box = box.parentElement
      const scrolls = box && box !== document.body && box.scrollWidth > box.clientWidth
      const cell = t.querySelector('tbody td, tbody th')
      return { scrolls, position: cell ? getComputedStyle(cell).position : null }
    })
    if (sticky?.scrolls) check(sticky.position === 'sticky', `[1024] check 10: Worker cell is ${sticky.position}`)
  }

  // 5: opening a closed disclosure moves nothing above it.
  const closedLabel = await page.locator('button[aria-expanded="false"]').first().getAttribute('aria-label')
  const closed = page.getByRole('button', { name: closedLabel ?? '' })
  if (closedLabel) {
    const above = await rect(page.getByText('Casey Changed').first())
    await closed.evaluate(e => { e.scrollIntoView({ block: "center" }); e.click() })
    await page.waitForTimeout(200)
    const aboveAfter = await rect(page.getByText('Casey Changed').first())
    check(above.y === aboveAfter.y, `[${vp.name}] check 5: rows above moved ${aboveAfter.y - above.y}px`)
    check((await closed.getAttribute('aria-expanded')) === 'true', `[${vp.name}] check 5: aria-expanded not true`)
    const controls = await closed.getAttribute('aria-controls')
    check(!!controls && (await page.locator(`#${controls}`).isVisible()), `[${vp.name}] check 5: detail not visible`)
    await shot(page, vp, 'payroll-worker-open')
  }

  // 4: Send missing (800 ms): the button and the first row do not move.
  const btn = page.getByRole('button', { name: /Send missing/ })
  const first = page.getByText('Casey Changed').first()
  const b0 = await rect(btn), f0 = await rect(first)
  await btn.evaluate(e => { e.scrollIntoView({ block: "center" }); e.click() })
  await page.waitForTimeout(200)
  const b1 = await rect(btn), f1 = await rect(first)
  await shot(page, vp, 'payroll-send-pending')
  await page.getByText(/Queued 3 shifts/).waitFor({ timeout: 10_000 })
  const b2 = await rect(page.getByRole('button', { name: /Send missing/ })), f2 = await rect(first)
  for (const [n, b, f] of [['during', b1, f1], ['after', b2, f2]]) {
    check(b.x === b0.x && b.w === b0.w, `[${vp.name}] check 4 ${n}: button moved or resized`)
    check(f.y === f0.y, `[${vp.name}] check 4 ${n}: first row moved ${f.y - f0.y}px`)
  }
  await shot(page, vp, 'payroll-send-done')

  // 6: changing the period keeps the select and the summary slot where they are.
  const sel = page.getByLabel('Pay period')
  const slot = page.locator('#main div[class*="min-h-[4.5rem]"]').first()
  const s0 = await rect(sel), h0 = (await rect(slot)).h
  await sel.selectOption({ index: 1 })
  await page.getByText('No approved shifts in this period.').waitFor({ timeout: 15_000 })
  const s1 = await rect(sel), h1 = (await rect(slot)).h
  check(s0.x === s1.x && s0.y === s1.y && s0.w === s1.w && s0.h === s1.h, `[${vp.name}] check 6: the select moved`)
  check(h0 === h1, `[${vp.name}] check 6: summary slot ${h0} -> ${h1}`)
  await shot(page, vp, 'payroll-empty-period')
  check((await overflow(page)) <= 0, `[${vp.name}] check 1: empty period scrolls sideways`)

  // Not connected, and the periods error.
  mode.connected = false
  await go(page, '/rostering/payroll')
  await page.getByRole('link', { name: 'Open Integrations' }).waitFor({ timeout: 30_000 })
  await shot(page, vp, 'payroll-not-connected')
  check((await overflow(page)) <= 0, `[${vp.name}] check 1: not connected scrolls sideways`)
  mode.connected = true
  mode.periods = 'error'
  await go(page, '/rostering/payroll')
  const retry = page.getByRole('button', { name: 'Try again' }).first()
  await retry.waitFor({ timeout: 30_000 })
  await touchOk(page, retry, 'Try again', vp)
  await shot(page, vp, 'payroll-periods-error')
  check((await overflow(page)) <= 0, `[${vp.name}] check 1: periods error scrolls sideways`)

  // The card: Work types loaded, refused (9), failed.
  mode.periods = 'ok'
  await go(page, '/settings?section=integrations')
  await page.getByRole('button', { name: 'Save work types' }).waitFor({ timeout: 30_000 })
  check((await overflow(page)) <= 0, `[${vp.name}] check 1: settings scrolls sideways`)
  const labels = ['Day and evening shifts', 'Active nights', 'Passive nights', 'Sleepovers']
  await touchOk(page, page.getByRole('button', { name: 'Save work types' }), 'Save work types', vp)
  for (const l of labels) await touchOk(page, page.getByLabel(l), `${l} select`, vp)
  await shot(page, vp, 'card-work-types')
  mode.save = 'refused'
  await page.getByLabel('Day and evening shifts').selectOption('5')
  await page.getByLabel('Passive nights').selectOption('7')
  await page.getByRole('button', { name: 'Save work types' }).click()
  await page.getByText(/isn't in Employment Hero any more/).first().waitFor({ timeout: 15_000 })
  const kept = await Promise.all(labels.map(l => page.getByLabel(l).inputValue()))
  check(kept[0] === '5' && kept[1] === '6' && kept[2] === '7', `[${vp.name}] check 9: values lost ${JSON.stringify(kept)}`)
  await shot(page, vp, 'card-work-types-refused')
  mode.workTypes = 'error'
  await go(page, '/settings?section=integrations')
  await page.getByRole('button', { name: 'Try again' }).first().waitFor({ timeout: 30_000 })
  await shot(page, vp, 'card-work-types-failed')
  await page.context().close()
}

// 8: a Coordinator gets no Send missing and is told why.
{
  const vp = VIEWPORTS[0]
  const page = await open(vp, 'Coordinator')
  await go(page, '/rostering/payroll')
  await page.getByText('Casey Changed').first().waitFor({ timeout: 60_000 })
  check((await page.getByRole('button', { name: /Send missing/ }).count()) === 0, '[coordinator] check 8: Send missing is in the DOM')
  check((await page.getByText('An Admin can send missing hours.').count()) === 1, '[coordinator] check 8: reason line missing')
  await shot(page, { name: '1440-coordinator' }, 'payroll-coordinator')
  await page.context().close()
}

await browser.close()
await touchBrowser.close()
if (problems.length) {
  console.error(`PR2 SHOTS FAILED (${problems.length}):\n` + problems.map(p => ' - ' + p).join('\n'))
  process.exit(1)
}
console.log('PR2 SHOTS OK: checks 1-10 passed')
