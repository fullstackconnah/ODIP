// Captures and numeric checks for the Group activities list (/rostering/group-activities): every state at 390 and 1280.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Routed: sign-in as a Coordinator; the module-visibility switch and the list endpoint answer from `scene`; everything else goes to the mock API.
import path from 'node:path'
import { copyFileSync } from 'node:fs'
import { AU_CONTEXT, cropElement, fullPage, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator' })
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

const staff = (names) => names.map((staffName, i) => ({ id: `r${i}`, staffId: `s${i}`, staffName, startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, role: null, findings: [] }))
const person = (n, didNotAttend = false) => ({ participantId: `p-${n}`, participantName: n, ratio: 'OneToOne', shiftIds: [], timesDiffer: false, didNotAttend })
const activity = (id, o) => ({
  id, serviceDate: '2026-11-09', startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, title: 'Bowling', activityId: null, activityName: null, location: 'Strike Zone',
  serviceLocationId: null, notes: null, minStaffRequired: 1, status: 'Published', staffNeeded: 2, staffAssigned: 2, participants: [person('Mia'), person('Ben')], staff: staff(['Alex Rivera', 'Sam Wilson']), findings: [], ...o,
})
const ROWS = [
  activity('a1'),
  activity('a2', { serviceDate: '2026-11-10', title: 'Community garden working bee with the Riverside group', location: 'Riverside Community Garden, Fortitude Valley', status: 'Draft', staffNeeded: 3, staffAssigned: 1, staff: staff(['Jo Lee']), participants: [person('Mia'), person('Ben'), person('Zoe')] }),
  activity('a3', { serviceDate: '2026-11-11', title: 'Picnic', location: null, status: 'PendingReview', staffNeeded: 2, staffAssigned: 0, staff: [], participants: [person('Mia')] }),
  activity('a4', { serviceDate: '2026-11-12', title: 'Movie afternoon', status: 'Cancelled', staffNeeded: 2, staffAssigned: 3, staff: staff(['Alex Rivera', 'Sam Wilson', 'Jo Lee']) }),
]
const scene = { on: true, mode: 'ok', hold: null }
const list = (items) => envelope({ items, totalCount: items.length, page: 1, pageSize: 25 })

async function route(page) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/settings/module-visibility', (r) => r.fulfill({ json: envelope({ hiddenAccommodation: false, hiddenVehicles: false, hiddenTrips: false, groupActivitiesEnabled: scene.on }) }))
  await page.route(/\/api\/v1\/rostering\/group-activities(\?|$)/, async (r) => {
    if (r.request().method() !== 'GET') return r.fallback()
    if (scene.hold) await scene.hold
    if (scene.mode === 'error') return r.fulfill({ status: 500, json: { success: false, data: null, message: null, errors: ['boom'] } })
    // Mirrors the server's status filter, so a chosen status shows only its own rows.
    const only = new URL(r.request().url()).searchParams.get('status')
    return r.fulfill({ json: list(scene.mode === 'empty' ? [] : ROWS.filter((a) => !only || a.status === only)) })
  })
}

// Crops the page's content (header, filters and list) and checks the crop holds.
async function shoot(page, st, name) {
  const main = page.locator('main').first()
  await main.waitFor({ state: 'visible', timeout: 30_000 })
  const c = await cropElement(page, main, path.join(OUT_DIR, `${name}-${st.name}.png`), { touch: st.width === 390, hideChrome: true, pad: 16 })
  add(`${name} crop holds [${st.name}]`, c.clip, c.overlap?.pass !== false)
}

async function pickStatus(page, name) {
  await page.getByRole('button', { name: /Status/ }).click()
  await page.getByRole('option', { name, exact: true }).click()
}

async function open(page, mode, on = true) {
  scene.mode = mode; scene.on = on; scene.hold = null
  await page.goto(`${BASE_URL}/rostering/group-activities`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('heading', { level: 1, name: 'Group activities' }).waitFor({ state: 'visible', timeout: 60_000 })
}

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    // Pinned inputs: Monday 2026-11-09 is the default week's start, so the rows above fall in the default range.
    await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
    page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
    await route(page)
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const btn = page.getByRole('button', { name: 'Sign in as selected user' })
      await btn.waitFor({ state: 'visible', timeout: 60_000 })
      await btn.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

      await open(page, 'ok')
      await page.getByText('Community garden working bee').first().waitFor({ state: 'visible', timeout: 30_000 })
      await shoot(page, st, 'normal')
      // Numeric checks on the full list first (every status in view), then the single-status states below.
      const pillRe = /^(Published|Draft|Pending review|Cancelled)$/
      if (mobile) {
        const cards = await page.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => {
          const b = tr.getBoundingClientRect(); const pr = parseFloat(getComputedStyle(tr).paddingRight) || 0
          const limit = b.right - pr
          // The trail cell (participants) sits in the card's bottom-right corner inside the padding by house design (index.css), so it is exempt.
          const over = [...tr.querySelectorAll('*')].filter((el) => !el.closest('td[data-card="trail"]') && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > limit + 0.5).map((el) => el.tagName + ':' + Math.round(el.getBoundingClientRect().right))
          return { right: Math.round(b.right), limit: Math.round(limit), over: over.slice(0, 4) }
        }))
        add('every card child ends inside the card padding [390]', cards, cards.length === ROWS.length && cards.every((c) => c.over.length === 0))
        const pills = await page.locator('tbody').getByText(pillRe).evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); const c = el.closest('tr').getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), cardLeft: Math.round(c.left), cardRight: Math.round(c.right) } }))
        add('each status pill is fully inside its card [390]', pills, pills.length === ROWS.length && pills.every((p) => p.left >= p.cardLeft && p.right <= p.cardRight))
      } else {
        const t = await page.evaluate(() => {
          const table = document.querySelector('main table'); let box = table.parentElement
          while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowX)) box = box.parentElement
          const bb = box.getBoundingClientRect()
          return { scrollWidth: box.scrollWidth, clientWidth: box.clientWidth, boxRight: Math.round(bb.right), viewport: innerWidth }
        })
        add('table fits without horizontal scroll [1280]', t, t.scrollWidth <= t.clientWidth)
        const head = await page.getByRole('columnheader', { name: 'Status' }).evaluate((el) => Math.round(el.getBoundingClientRect().right))
        const pills = await page.locator('tbody').getByText(pillRe).evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().right)))
        add('Status header and every pill are inside the viewport [1280]', { head, pills, viewport: t.viewport, boxRight: t.boxRight }, head <= t.viewport && head <= t.boxRight && pills.length === ROWS.length && pills.every((r) => r <= t.viewport && r <= t.boxRight))
      }
      const fp = mobile ? await fullPage(page, path.join(OUT_DIR, 'mobile-390.png'), { touch: true }) : await fullPage(page, path.join(OUT_DIR, 'normal-1280-full.png'))
      checks.push(...fp.checks)
      copyFileSync(path.join(OUT_DIR, mobile ? 'mobile-390.png' : 'normal-1280-full.png'), path.join(OUT_DIR, 'full', mobile ? 'normal-390-full.png' : 'normal-1280-full.png'))

      await pickStatus(page, 'Draft')
      await page.getByText('Community garden working bee').first().waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByText('Movie afternoon').waitFor({ state: 'detached', timeout: 30_000 })
      await shoot(page, st, 'draft-and-short-staffed')
      await pickStatus(page, 'Cancelled')
      await page.getByText('Movie afternoon').waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByText('Community garden working bee').waitFor({ state: 'detached', timeout: 30_000 })
      await shoot(page, st, 'cancelled')
      await pickStatus(page, 'All statuses')
      await page.getByText('Community garden working bee').first().waitFor({ state: 'visible', timeout: 30_000 })
      add(`short-staffed cell says how many more [${st.name}]`, null, (await page.getByText(/2 more needed/).count()) >= 1 && (await page.getByText('Nobody yet').count()) === 1)

      if (mobile) {
        add('no horizontal page scroll [390]', null, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
        const tap = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')) || 0)
        const heights = await page.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.getBoundingClientRect().height))
        add('each stacked row is at least --tap-min tall [390]', { tap, heights }, heights.length === ROWS.length && heights.every((h) => h >= tap))
        const pills = await page.getByText(/^(Published|Draft|Pending review|Cancelled)$/).evaluateAll((els) => els.map((el) => ({ white: getComputedStyle(el).whiteSpace, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) || 0 })))
        add('status pills do not wrap [390]', pills, pills.length >= 4 && pills.every((p) => p.white === 'nowrap' && (p.lh === 0 || p.h < p.lh * 2)))
        const control = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--control-h')) || 0)
        const fields = await page.locator('main button[aria-haspopup="listbox"], main input[type="date"]').evaluateAll((els) => els.map((el) => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), left: Math.round(b.left), h: Math.round(b.height) } }))
        add('filters stack one per line at --control-h [390]', { control, fields }, fields.length === 3 && fields.every((f) => f.h >= control) && new Set(fields.map((f) => f.top)).size === 3 && new Set(fields.map((f) => f.left)).size === 1)
      }

      await open(page, 'empty')
      await page.getByText('No group activities this week').waitFor({ state: 'visible', timeout: 30_000 })
      await shoot(page, st, 'empty')
      await pickStatus(page, 'Draft')
      await page.getByText('No group activities match these filters').waitFor({ state: 'visible', timeout: 30_000 })
      await shoot(page, st, 'filtered-empty')

      await open(page, 'ok', false)
      await page.getByText('Group activities are turned off').waitFor({ state: 'visible', timeout: 30_000 })
      await shoot(page, st, 'switch-off')

      await open(page, 'error')
      await page.getByRole('button', { name: 'Try again' }).waitFor({ state: 'visible', timeout: 30_000 })
      await shoot(page, st, 'error')

      let release
      scene.mode = 'ok'; scene.on = true; scene.hold = new Promise((resolve) => { release = resolve })
      await page.goto(`${BASE_URL}/rostering/group-activities`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByText(/Loading group activities/).waitFor({ state: 'visible', timeout: 30_000 })
      await shoot(page, st, 'loading')
      release()
    } catch (e) {
      add(`scenes ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
