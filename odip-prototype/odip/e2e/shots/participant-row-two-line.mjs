// Roster participant row header on two lines: captures plus the numeric checks. Computed boxes only. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/participant-row-two-line.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])

const LONG_NAME = 'Alexandrina Papadopoulos-Whitfield'
const shiftOf = (id, who, name, day, staffId) => ({
  id, participantId: who, participantName: name, staffId, staffName: staffId ? 'Mei Zhang' : null, serviceDate: day,
  startTime: '08:00:00', endTime: '12:00:00', endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'Published',
  shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false,
})
const row = (id, name, ratio, shifts, extra = {}) => ({
  participantId: id, fullName: name, supportRatio: ratio, overnightSupport: 'None', hasRestrictivePractice: false, shifts, tripBars: [],
  scheduledHours: 4, daysWithoutCover: 7 - new Set(shifts.map((s) => s.serviceDate)).size, ...extra,
})
// Rows 0-2 are all "2:1 with one open shift", so their ratio chips must share one right edge; row 3 is fully covered (informational only).
const fixtureRows = (days) => [
  row('p-9001', LONG_NAME, 'TwoToOne', [shiftOf('s-9001a', 'p-9001', LONG_NAME, days[1], null), shiftOf('s-9001b', 'p-9001', LONG_NAME, days[3], 's-0004')], {
    hasRestrictivePractice: true, inOnboarding: true, readinessIssues: ['Intake not complete', 'No signed service agreement'], notReadyForRostering: false,
  }),
  row('p-9002', 'Mia Chen', 'TwoToOne', [shiftOf('s-9002a', 'p-9002', 'Mia Chen', days[0], null)]),
  row('p-9003', 'Noah Blake', 'TwoToOne', [shiftOf('s-9003a', 'p-9003', 'Noah Blake', days[2], null)]),
  row('p-9004', 'Zara Covered', 'OneToOne', [shiftOf('9004', 'p-9004', 'Zara Covered', days[0], 's-0004')]),
  // No shifts at all: the header alone sets this row's height (the board lists participants by name, so these two sort last).
  row('p-9005', 'Zed Empty', 'TwoToOne', [], { inOnboarding: true, readinessIssues: ['Intake not complete'], notReadyForRostering: false }),
  // 12 open shifts: a 2-digit unassigned count, which sorts last and must still end on the same ratio-chip edge.
  row('p-9006', 'Zoe Twelve', 'TwoToOne', Array.from({ length: 12 }, (_, i) => shiftOf(`s-9006${i}`, 'p-9006', 'Zoe Twelve', days[i % 7], null))),
]

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openRoster(browser, { width, height, touch, dark }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light' })
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') console.log(`[participant-row-two-line] console ${m.text().slice(0, 200)}`) })
  page.on('pageerror', (e) => console.log(`[participant-row-two-line] pageerror ${String(e.message).slice(0, 200)}`))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login('Admin') }))
  let boardCalls = 0, mutated = 0
  await page.route('**/api/v1/rostering/board*', async (r) => {
    boardCalls++
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data?.participantRows) { mutated++; body.data.weekStarted = true; body.data.participantRows = fixtureRows(body.data.days); body.data.exceptions = []; body.data.pendingAgreements = [] }
    await r.fulfill({ response, json: body })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  try {
    await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByRole('link', { name: LONG_NAME }).waitFor({ state: 'visible', timeout: 30_000 })
  } catch (e) {
    console.log(`[participant-row-two-line] open failed: heading=${await page.locator('#roster-week-heading').count()} links=${JSON.stringify(await page.locator('a[title]').evaluateAll((a) => a.slice(0, 8).map((x) => x.title)))} ratio=${await page.locator('[role=img][aria-label$=" support"]').count()} boards=${boardCalls} mutated=${mutated} groupRadios=${JSON.stringify(await page.getByRole('radio').evaluateAll((a) => a.map((x) => x.getAttribute('aria-checked') + x.textContent)))}`)
    throw e
  }
  await page.waitForTimeout(800)
  return { context, page }
}

// Every participant row header (the sticky cell holding a name link and a "... support" chip), first three plus the covered fourth.
const measure = (page) => page.evaluate(() => {
  const heads = [...document.querySelectorAll('div.sticky')].filter((h) => h.querySelector('a[title]') && h.querySelector('[role=img][aria-label$=" support"]')).slice(0, 6)
  const r = (el) => el.getBoundingClientRect()
  return {
    coarse: matchMedia('(pointer: coarse)').matches,
    rowH: getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim(),
    rows: heads.map((h) => {
      const cs = getComputedStyle(h), hb = r(h)
      const innerRight = hb.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)
      const name = h.querySelector('a[title]'), ratio = h.querySelector('[role=img][aria-label$=" support"]')
      const nb = r(name), rb = r(ratio)
      const line2 = ratio.parentElement.parentElement.getBoundingClientRect()
      const past = [...h.querySelectorAll('*')].filter((e) => r(e).width > 0 && r(e).right > innerRight + 0.5).map((e) => (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 30))
      // Upper bound on the old one-line name width: inner width minus the right-hand group, its gap, and the marker/hourglass glyphs (12px + 4px gap each).
      const tail = ratio.parentElement.getBoundingClientRect()
      const markers = h.querySelectorAll('[role=img][aria-label^="Restrictive"], [role=img][aria-label^="Agreement"]').length * 16
      const innerWidth = innerRight - (hb.left + parseFloat(cs.paddingLeft))
      return {
        name: name.textContent, headHeight: hb.height, contentHeight: line2.bottom - nb.top, nameBottom: nb.bottom, ratioTop: rb.top, ratioRight: rb.right, nameWidth: nb.width,
        nameFits: name.scrollWidth <= name.clientWidth, oldNameWidthBound: innerWidth - tail.width - 8 - markers, past,
      }
    }),
  }
})

function runChecks(tag, m, fine) {
  check(`${tag}: pointer is ${fine ? 'fine' : 'coarse'}`, m.coarse === !fine, m.rowH)
  check(`${tag}: found 6 participant rows`, m.rows.length === 6, m.rows.length)

  check(`${tag}: 1 name above ratio chip (name bottom <= ratio top) on every row`, m.rows.every((x) => x.nameBottom <= x.ratioTop + 0.5), m.rows.map((x) => [x.nameBottom, x.ratioTop]))
  if (fine) {
    // The rows with bars are taller than --row-h (the bar sets it), so the header cell is measured on the empty row, where it sets the height itself; every row's two lines must also fit in 34px.
    const empty = m.rows[4]
    check(`${tag}: 2 header height == --row-h (34px, +-1) on the row with no bars`, !!empty && Math.abs(empty.headHeight - 34) <= 1, empty?.headHeight)
    check(`${tag}: 2b two lines fit within 34px on every row`, m.rows.every((x) => x.contentHeight <= 34.5), m.rows.map((x) => x.contentHeight))
  }
  check(`${tag}: 3 no header child past the inner right edge`, m.rows.every((x) => x.past.length === 0), m.rows.map((x) => x.past))
  check(`${tag}: 4 long name shows whole or is >= the old one-line bound`, m.rows.every((x) => x.nameFits || x.nameWidth >= x.oldNameWidthBound), m.rows.map((x) => [x.name, x.nameFits, x.nameWidth, x.oldNameWidthBound]))
  const edges = m.rows.map((x) => x.ratioRight)
  check(`${tag}: 5 ratio chips' right edges line up across all rows incl. covered and 2-digit count (+-1)`, m.rows.length >= 6 && Math.max(...edges) - Math.min(...edges) <= 1, edges)
  if (m.rows[3]) console.log(`[participant-row-two-line] ${tag} info: ratio edges ${edges}`)
}

const browser = await chromium.launch({ headless: true })
const SCENES = [
  { tag: '1280-light', width: 1280, height: 900, touch: false, dark: false },
  { tag: '390-light', width: 390, height: 844, touch: true, dark: false },
  { tag: '1280-dark', width: 1280, height: 900, touch: false, dark: true },
]
for (const s of SCENES) {
  try {
    const { context, page } = await openRoster(browser, s)
    const m = await measure(page)
    console.log(`[participant-row-two-line] ${s.tag} ${JSON.stringify(m)}`)
    runChecks(s.tag, m, !s.touch)
    const head0 = page.locator('div.sticky', { has: page.getByRole('link', { name: LONG_NAME }) }).first()
    const head2 = page.locator('div.sticky', { has: page.getByRole('link', { name: 'Noah Blake' }) }).first()
    const secondDay = head2.locator('xpath=following-sibling::div[1]/*[2]')
    // Box = sticky column of rows 0-2 and, via the row 2 day cell, two day columns; head0 starts the crop.
    // At 390 two day columns do not fit the viewport (the crop would fail checkCropHolds), so only the sticky column is cropped there.
    const crop = await cropElement(page, head0, path.join(OUT_DIR, `rows-${s.tag}.png`), { touch: s.touch, also: s.touch ? head2 : secondDay })
    checks.push(checkCropHolds({ ...crop, touch: s.touch }))
    if (s.tag !== '1280-dark') checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${s.tag}.png`), { touch: s.touch })).checks)
    await context.close()
  } catch (e) {
    check(`${s.tag}: scene ran`, false, String(e.message).split('\n')[0])
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
