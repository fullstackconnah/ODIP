// Polish batch 41: shift notes cap (H49-1), Dismiss tap minimum (GA3-N1), headcount without didn't-attend people (GA5-N1).
// Capture states: notes-at-limit-390, approve-partial-390, approve-partial-1280, card-headcount-1280
// The group activity card shows no participant headcount; the one place a started-or-not activity counts people is the Add to activity chooser, so card-headcount-1280 is that chooser.
// Run through the runner: odip-test.sh <worktree> shots e2e/shots/polish-batch-41.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const WEEK = '2026-09-07'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })
const scene = async (name, fn) => { try { await fn() } catch (e) { check(`${name}: scene ran`, false, String(e.message).split('\n')[0]) } }

const shiftOf = (id, participantId, participantName, serviceDate, startTime, endTime, extra = {}) => ({
  id, participantId, participantName, serviceDate, startTime, endTime, endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...extra,
})
const person = (participantId, participantName, shiftIds, extra = {}) => ({ participantId, participantName, ratio: 'OneToOne', shiftIds, timesDiffer: false, didNotAttend: false, ...extra })
// Three people on the activity, one of them marked as not coming: the chooser must say 2 people.
const POOL = {
  id: 'act-pool', serviceDate: '2026-09-10', startTime: '12:00:00', endTime: '15:00:00', endsNextDay: false, title: 'Pool afternoon', status: 'Published', staffNeeded: 3, staffAssigned: 3, minStaffRequired: null,
  participants: [person('p-0001', 'Liam Okafor', ['gs-2']), person('p-0004', 'Grace Palmer-Hughes', ['gs-2b']), person('p-0002', 'Sam Chen', ['gs-2c'], { didNotAttend: true })], staff: [], findings: [],
}
const GROUP_LINE = shiftOf('gl-2', 'p-0004', 'Grace Palmer-Hughes', '2026-09-10', '09:00:00', '13:00:00', { isGroupLine: true })

const browser = await chromium.launch({ headless: true })

async function session(vp, routes) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce', ...(vp.touch ? { hasTouch: true, isMobile: true } : {}) })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await routes(page)
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { page, context }
}
const go = async (page, p) => {
  await page.goto(`${BASE_URL}${p}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
}
const tokenPx = (page, token) => page.evaluate((t) => {
  const p = document.createElement('div')
  p.style.height = `var(${t})`
  document.body.appendChild(p)
  const h = p.getBoundingClientRect().height
  p.remove()
  return h
}, token)
const crop = async (page, vp, state, region, opts = {}) => {
  await region.scrollIntoViewIfNeeded().catch(() => {})
  const r = await cropElement(page, region, path.join(OUT_DIR, `${state}.png`), { touch: vp.touch, natural: true, ...opts })
  checks.push(checkCropHolds(r))
  const m = await region.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  check(`${state}: no horizontal overflow`, m.sw <= m.cw, m)
}

const board = (flag) => async (page) => {
  await page.route('**/api/v1/rostering/board*', async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data?.groupBy === 'Participant' && body.data.weekStart === WEEK) {
      const grace = body.data.participantRows.find((x) => x.participantId === 'p-0004')
      grace.shifts = [...grace.shifts, GROUP_LINE]
      body.data.groupActivitiesEnabled = flag
      body.data.groupActivities = flag ? [POOL] : []
    }
    await r.fulfill({ response, json: body })
  })
  await page.route('**/api/v1/rostering/group-activities/**', (r) => r.fulfill({ json: envelope(POOL) }))
}

try {
  // notes-at-limit-390: the shift panel's Notes holds 2000 and takes no more.
  await scene('notes-at-limit-390', async () => {
    const vp = { name: '390', width: 390, height: 844, touch: true }
    const { page, context } = await session(vp, board(false))
    await go(page, `/rostering?date=${WEEK}`)
    await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 60_000 })
    await page.getByRole('button', { name: /^Add a shift for/ }).first().click({ timeout: 20_000, force: true })
    const dialog = page.getByRole('dialog')
    const notes = dialog.getByLabel('Notes')
    await notes.waitFor({ timeout: 30_000 })
    await notes.click()
    await notes.fill('n'.repeat(1990))
    await page.keyboard.type('x'.repeat(30))
    const state = await notes.evaluate((el) => ({ max: el.maxLength, len: el.value.length }))
    check('notes-at-limit-390: maxlength is 2000', state.max === 2000, state)
    check('notes-at-limit-390: typing past the limit stops at 2000', state.len === 2000, state)
    await crop(page, vp, 'notes-at-limit-390', notes.locator('xpath=ancestor::div[1]'))
    await context.close()
  })

  // approve-partial: one of two rows refused, so the Dismiss callout shows.
  const review = (rows) => async (page) => {
    await page.route('**/api/v1/rostering/completions?*', (r) => r.fulfill({ json: envelope({ items: [], totalCount: 0, page: 1, pageSize: 20, totalPages: 0, hasNext: false, hasPrevious: false }) }))
    await page.route('**/api/v1/rostering/group-activities/staff-reviews', (r) => r.fulfill({ json: envelope({ rows, total: rows.length }) }))
    await page.route('**/api/v1/rostering/group-activities/staff-reviews/approve', (r) => r.fulfill({ json: envelope([
      { rowId: rows[0].rowId, ok: true, code: null, message: null },
      { rowId: rows[1].rowId, ok: false, code: 'GA_STAFF_NOT_FINISHED', message: 'Not finished yet.' },
    ]) }))
  }
  const row = (n, name) => ({
    rowId: `r${n}`, groupActivityId: 'ga1', activityTitle: 'Bowling', serviceDate: WEEK, userId: `u${n}`, staffName: name, role: null, startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false,
    actualStart: `${WEEK}T00:02:00Z`, actualEnd: `${WEEK}T06:10:00Z`, breakStartedAt: null, breakEndedAt: null, timeZoneId: 'Australia/Sydney', state: 'Finished', locationCheck: null, offRoster: false,
    adjustmentReason: null, payrollLinked: true, participantCount: 2, didNotAttendCount: 0,
  })
  for (const vp of [{ name: '390', width: 390, height: 844, touch: true }, { name: '1280', width: 1280, height: 900, touch: false }]) {
    await scene(`approve-partial-${vp.name}`, async () => {
      const { page, context } = await session(vp, review([row(1, 'Wendy Worker'), row(2, 'Fred Finished')]))
      await go(page, '/rostering/completions')
      const section = page.locator('section[aria-labelledby="group-staff-heading"]')
      await section.waitFor({ timeout: 45_000 })
      await section.getByRole('checkbox', { name: /select all/i }).first().check({ force: true })
      await section.getByRole('button', { name: /^Approve Wendy Worker/ }).click()
      const dismiss = section.getByRole('button', { name: 'Dismiss' })
      await dismiss.waitFor({ timeout: 20_000 })
      await dismiss.scrollIntoViewIfNeeded()
      const box = await dismiss.boundingBox()
      const minH = await dismiss.evaluate((el) => getComputedStyle(el).minHeight)
      if (vp.touch) {
        const floor = await tokenPx(page, '--tap-min')
        check('approve-partial-390: Dismiss hit area >= --tap-min', floor > 0 && box.height >= floor - 0.5, { height: box.height, floor })
      } else {
        check('approve-partial-1280: Dismiss keeps the sm size (box height 24, no touch floor)', box.height <= 32 && (minH === '0px' || minH === 'auto'), { minH, box })
        console.log(`Dismiss box at 1280: ${JSON.stringify(box)}`)
      }
      await crop(page, vp, `approve-partial-${vp.name}`, dismiss.locator("xpath=ancestor::div[@role='status'][1]"))
      await context.close()
    })
  }

  // card-headcount-1280: the Add to activity chooser counts 2 people for the 3-with-1-didn't-attend activity.
  await scene('card-headcount-1280', async () => {
    const vp = { name: '1280', width: 1280, height: 900, touch: false }
    const { page, context } = await session(vp, board(true))
    await go(page, `/rostering?date=${WEEK}`)
    await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 60_000 })
    const chip = page.locator('[data-shift-chip="gl-2"]')
    await chip.waitFor({ timeout: 45_000 })
    await chip.scrollIntoViewIfNeeded()
    await chip.hover()
    await chip.getByRole('button', { name: /^Actions for/ }).click()
    await page.getByRole('option', { name: 'Add to an activity…' }).click()
    const dialog = page.getByRole('dialog').first()
    await dialog.waitFor({ timeout: 10_000 })
    const text = await dialog.getByRole('radio', { name: /Pool afternoon/ }).locator('xpath=ancestor::label[1]').innerText()
    check('card-headcount-1280: reads 2 people for 3 with 1 not attending', /· 2 people/.test(text), text)
    await crop(page, vp, 'card-headcount-1280', dialog, { pad: 0 })
    await context.close()
  })
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
