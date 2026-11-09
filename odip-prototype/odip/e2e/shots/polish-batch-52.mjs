// Captures and numeric checks for polish batch 52: the Group activities list (a long title fills its column; no filters when the switch is off) and the catalogue import (one name, no widow in the 10 MB refusal).
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Pinned inputs: the clock is 2026-11-09 10:00 Sydney (Monday of the rows' week); sign-in is a mocked dev login (Coordinator for the list, SuperAdmin for the catalogue).
import path from 'node:path'
import { AU_CONTEXT, cropElement, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const TOO_BIG = 'This file is over 10 MB. Choose the NDIS Support Catalogue .xlsx file.'
const HINT = 'Upload the NDIS Support Catalogue .xlsx file to preview changes.'
const LONG_TITLE = 'Community garden working bee with the Riverside group'
const OVER = Buffer.alloc(10 * 1024 * 1024 + 1, 'a')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

const staff = (names) => names.map((staffName, i) => ({ id: `r${i}`, staffId: `s${i}`, staffName, startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, role: null, findings: [] }))
const person = (n) => ({ participantId: `p-${n}`, participantName: n, ratio: 'OneToOne', shiftIds: [], timesDiffer: false, didNotAttend: false })
const activity = (id, o) => ({
  id, serviceDate: '2026-11-09', startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, title: 'Bowling', activityId: null, activityName: null, location: 'Strike Zone',
  serviceLocationId: null, notes: null, minStaffRequired: 1, status: 'Published', staffNeeded: 2, staffAssigned: 2, participants: [person('Mia'), person('Ben')], staff: staff(['Alex Rivera', 'Sam Wilson']), findings: [], ...o,
})
const ROWS = [
  activity('a1'),
  activity('a2', { serviceDate: '2026-11-10', title: LONG_TITLE, location: 'Riverside Community Garden, Fortitude Valley', status: 'Draft', staffNeeded: 3, staffAssigned: 1, staff: staff(['Jo Lee']), participants: [person('Mia'), person('Ben'), person('Zoe')] }),
  activity('a3', { serviceDate: '2026-11-11', title: 'Picnic', location: null, status: 'PendingReview', staffNeeded: 2, staffAssigned: 0, staff: [], participants: [person('Mia')] }),
  activity('a4', { serviceDate: '2026-11-12', title: 'Movie afternoon', status: 'Cancelled', staffNeeded: 2, staffAssigned: 3, staff: staff(['Alex Rivera', 'Sam Wilson', 'Jo Lee']) }),
]

async function route(page, role, scene) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role }) }))
  await page.route('**/api/v1/settings/module-visibility', (r) => r.fulfill({ json: envelope({ hiddenAccommodation: false, hiddenVehicles: false, hiddenTrips: false, groupActivitiesEnabled: scene.on }) }))
  await page.route(/\/api\/v1\/rostering\/group-activities(\?|$)/, (r) => r.request().method() !== 'GET' ? r.fallback() : r.fulfill({ json: envelope({ items: ROWS, totalCount: ROWS.length, page: 1, pageSize: 25 }) }))
  await page.route('**/api/v1/support-catalogue/import/preview', (r) => r.fulfill({ status: 413, contentType: 'text/html', body: '413' }))
}

async function signIn(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}

async function crop(page, st, name, locator, pad = 16) {
  await locator.waitFor({ state: 'visible', timeout: 30_000 })
  const c = await cropElement(page, locator, path.join(OUT_DIR, `${name}-${st.name}.png`), { touch: st.width === 390, hideChrome: true, pad })
  add(`${name} crop holds [${st.name}]`, c.clip, c.overlap?.pass !== false)
}

// The words on the last rendered line of an element's text (a Range per character, grouped by its top).
const lastLineWords = (loc) => loc.evaluate((el) => {
  const node = [...el.childNodes].find((n) => n.nodeType === 3) ?? el.firstChild
  const text = node.textContent; const tops = []
  for (let i = 0; i < text.length; i++) { const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); const b = r.getBoundingClientRect(); tops.push(b.height ? Math.round(b.top) : null) }
  const last = Math.max(...tops.filter((t) => t !== null))
  const line = text.split('').filter((_, i) => tops[i] === last).join('').trim()
  return { line, words: line.split(/\s+/).filter(Boolean).length }
})

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const open = async (role, scene) => {
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
      const page = await context.newPage()
      await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
      page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
      await route(page, role, scene)
      await signIn(page)
      return { context, page }
    }
    try {
      // The list, switch on, with a long title.
      let s = await open('Coordinator', { on: true })
      await s.page.goto(`${BASE_URL}/rostering/group-activities`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await s.page.getByText(LONG_TITLE).first().waitFor({ state: 'visible', timeout: 60_000 })
      await crop(s.page, st, 'ga-list-normal', s.page.locator('main').first())
      add(`Status select is present with the switch on [${st.name}]`, null, (await s.page.getByRole('button', { name: /Status/ }).count()) === 1)
      if (!mobile) {
        const t = await s.page.evaluate((title) => {
          const table = document.querySelector('main table'); let box = table.parentElement
          while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowX)) box = box.parentElement
          const span = [...table.querySelectorAll('tbody span')].find((el) => el.textContent === title)
          const pills = [...table.querySelectorAll('tbody td:last-child *')].filter((el) => /^(Published|Draft|Pending review|Cancelled)$/.test(el.textContent) && el.children.length === 0).map((el) => Math.round(el.getBoundingClientRect().right))
          const head = [...table.querySelectorAll('th')].find((th) => th.textContent.trim() === 'Status')
          const col = [...table.querySelectorAll('th')].findIndex((th) => th.textContent.trim() === 'Staff')
          const staff = [...table.querySelectorAll('tbody tr')].map((tr) => { const td = tr.children[col]; const el = td.firstElementChild || td; const lh = parseFloat(getComputedStyle(el).lineHeight); return { w: Math.round(td.getBoundingClientRect().width), lines: Math.round(el.getBoundingClientRect().height / lh) } })
          return { scrollWidth: box.scrollWidth, clientWidth: box.clientWidth, titleWidth: Math.round(span.getBoundingClientRect().width), titleAttr: span.title, pills, head: Math.round(head.getBoundingClientRect().right), viewport: innerWidth, staff }
        }, LONG_TITLE)
        add('table fits without horizontal scroll [1280]', t, t.scrollWidth <= t.clientWidth)
        add('every Status pill and the header are inside the viewport [1280]', t, t.pills.length === ROWS.length && t.pills.every((r) => r <= t.viewport) && t.head <= t.viewport)
        add('the long title is wider than the old 256 px cap [1280]', t, t.titleWidth > 256)
        add('every Staff cell is at least 176 px wide [1280]', t.staff, t.staff.length === ROWS.length && t.staff.every((c) => c.w >= 176))
        add('no Staff cell text is over 2 lines [1280]', t.staff, t.staff.every((c) => c.lines <= 2))
        add('the long title keeps its tooltip [1280]', t, t.titleAttr === LONG_TITLE)
      } else {
        add('no horizontal page scroll [390]', null, await s.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      }
      await s.context.close()

      // The list, switch off: the turned-off state alone, no filters.
      s = await open('Coordinator', { on: false })
      await s.page.goto(`${BASE_URL}/rostering/group-activities`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await s.page.getByText('Group activities are turned off').waitFor({ state: 'visible', timeout: 60_000 })
      await crop(s.page, st, 'ga-list-switch-off', s.page.locator('main').first())
      add(`no Status select, From or To when the switch is off [${st.name}]`, null, (await s.page.getByRole('button', { name: /Status/ }).count()) === 0 && (await s.page.locator('main input[type="date"]').count()) === 0)
      await s.context.close()

      // The catalogue import: the dialog's hint, then the over-10 MB refusal.
      s = await open('SuperAdmin', { on: true })
      await s.page.goto(`${BASE_URL}/settings?section=catalogue`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await s.page.getByRole('button', { name: 'Import catalogue' }).click({ timeout: 60_000 })
      const modal = s.page.getByRole('dialog').first()
      await crop(s.page, st, 'catalogue-dialog', modal, 24)
      add(`the upload hint says NDIS Support Catalogue [${st.name}]`, null, (await modal.getByText(HINT).count()) === 1)
      await s.page.locator('input[type=file]').setInputFiles({ name: 'catalogue.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: OVER })
      const msg = modal.getByText(TOO_BIG)
      await msg.waitFor({ state: 'visible', timeout: 30_000 })
      await crop(s.page, st, 'catalogue-too-big', modal, 24)
      const last = await lastLineWords(msg)
      add(`the refusal's last line is more than one word [${st.name}]`, last, last.words > 1)
      await s.context.close()
    } catch (e) {
      add(`scenes ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false)
    }
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
