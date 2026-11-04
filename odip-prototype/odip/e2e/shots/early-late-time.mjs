// Early/late shift time PR1: the Start time-check sheet, the Finish reason box, the Submit drift line and the coordinator's review row and detail.
// Captures plus numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/early-late-time.mjs <outdir>
// Sign-in is stubbed with page.route; the worker's shift and the coordinator's completion are the mock API's, patched in flight. The clock is pinned (NOW)
// and the shift's rostered times are set from it, so "12 minutes early" is the same on every run.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])

const NOW = new Date('2026-11-04T23:00:00Z')
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000)
const SHIFT_ID = 'sh-next'

// Provider-local date and "HH:mm:ss" of an instant.
function wall(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` }
}

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openPage(browser, vp, { role, username, now = NOW, draft = null }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  if (draft) await context.addInitScript(([id, d]) => { try { if (!sessionStorage.getItem(`odip-shift-end-draft:${id}`)) sessionStorage.setItem(`odip-shift-end-draft:${id}`, JSON.stringify(d)) } catch { /* storage blocked */ } }, [SHIFT_ID, draft])
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(now)
  return { context, page }
}

const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${ctx}: no horizontal scroll`, o <= 0, o)
}
// Every visible button, input, select and textarea inside `root` has at least 44px of height to tap, its own box or its TAP_AREA pad.
const tapTargets = async (root, ctx) => {
  const small = await root.evaluate((el) => [...el.querySelectorAll('button, input, select, textarea')].filter((e) => {
    const b = e.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0) || getComputedStyle(e).visibility === 'hidden') return false
    const pad = parseFloat(getComputedStyle(e, '::before').height) || 0
    return Math.max(b.height, pad) < 43.5
  }).map((e) => `${e.tagName} ${(e.getAttribute('aria-label') || e.textContent || e.name || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`))
  check(`${ctx}: tap targets at least 44 high`, small.length === 0, small)
}
// An element wraps to at most `max` lines (its height over its line height).
const maxLines = async (locator, max, ctx) => {
  const lines = await locator.evaluate((el) => { const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2; return Math.round(el.getBoundingClientRect().height / lh * 10) / 10 })
  check(`${ctx}: at most ${max} lines`, lines <= max + 0.1, lines)
}
const fontAtLeast = async (locator, px, ctx) => {
  const size = await locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  check(`${ctx}: text at least ${px}px`, size >= px, size)
}
const crop = async (page, locator, name, vp, pad = 0) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}

// The worker's shift: rostered start `startOff` and end `endOff` minutes from NOW, Published or InProgress (started on time). Every GET is patched.
async function routeWorkerShift(page, { startOff, endOff, status = 'Published', startFails = false }) {
  let last = null
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}`, async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data) {
      const tz = body.data.timeZoneId ?? 'Australia/Sydney'
      const s = wall(at(startOff), tz), e = wall(at(endOff), tz)
      Object.assign(body.data, { id: SHIFT_ID, status, serviceDate: s.date, startTime: s.time, endTime: e.time, endsNextDay: e.date !== s.date, serviceLocation: null })
      if (status === 'InProgress') body.data.completion = { ...(body.data.completion ?? {}), actualStart: at(startOff).toISOString(), startTimeReason: null }
      last = body
      page.rosteredStart = s.time
    }
    await r.fulfill({ response, json: body })
  })
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}/start`, (r) => startFails
    ? r.fulfill({ status: 400, json: { success: false, data: null, message: 'This shift cannot be started right now.', errors: [] } })
    : r.fulfill({ json: envelope({ ...(last?.data ?? {}), status: 'InProgress' }) }))
}
const gotoShift = async (page) => {
  await page.goto(`${BASE_URL}/portal/shifts/${SHIFT_ID}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
}

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const tag = vp.touch ? `${vp.name}-touch` : vp.name

  // start-early-sheet, start-late-sheet, start-sheet-error
  for (const [state, startOff, fails, title] of [
    ['start-early-sheet', 12, false, "You're starting 12 minutes early"],
    ['start-late-sheet', -7, false, "You're starting 7 minutes late"],
    ['start-sheet-error', 12, true, "You're starting 12 minutes early"],
  ]) {
    try {
      const { context, page } = await openPage(browser, vp, { role: 'SupportWorker', username: 'dev.worker' })
      await routeWorkerShift(page, { startOff, endOff: startOff + 480, startFails: fails })
      await gotoShift(page)
      const startBtn = page.getByRole('button', { name: 'Start shift' })
      await startBtn.waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(400)
      await startBtn.click()
      const dialog = page.getByRole('dialog', { name: title })
      await dialog.waitFor({ state: 'visible', timeout: 30_000 })
      if (fails) {
        await dialog.getByRole('button', { name: 'Start shift' }).click()
        await dialog.getByRole('alert').waitFor({ state: 'visible', timeout: 30_000 })
      }
      await page.waitForTimeout(400)
      check(t(`${state}: Not yet and Start shift are both offered`), (await dialog.getByRole('button', { name: 'Not yet' }).isVisible()) && (await dialog.getByRole('button', { name: 'Start shift' }).isVisible()))
      await maxLines(dialog.getByRole('heading').first(), 2, t(`${state} title`))
      await fontAtLeast(dialog.getByText(/^Your shift is rostered to start at/), 14, t(`${state} body`))
      const [hh, mm] = page.rosteredStart.split(':').map(Number)
      const expected = `Your shift is rostered to start at ${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}.`
      const bodyText = (await dialog.getByText(/^Your shift is rostered to start at/).innerText()).trim()
      check(t(`${state}: body names the real rostered start`), bodyText === expected, `${bodyText} | want ${expected}`)
      await fontAtLeast(dialog.locator('#start-time-reason-help'), 12, t(`${state} helper`))
      await noHScroll(page, t(state))
      if (vp.touch) await tapTargets(dialog, t(state))
      await crop(page, dialog, `${state}-${tag}.png`, vp)
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }

  // finish-late-reason, finish-early-reason: step 1 of the Finish flow, 12 minutes after and 10 minutes before the rostered end
  for (const [state, endOff, label] of [
    ['finish-late-reason', -12, 'Why are you finishing 12 minutes late? (optional)'],
    ['finish-early-reason', 10, 'Why are you finishing 10 minutes early? (optional)'],
  ]) {
    try {
      const { context, page } = await openPage(browser, vp, { role: 'SupportWorker', username: 'dev.worker', draft: { step: 'times', reached: 'times' } })
      await routeWorkerShift(page, { startOff: endOff - 480, endOff, status: 'InProgress' })
      await gotoShift(page)
      const box = page.getByLabel(label)
      await box.waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(400)
      const edges = await page.evaluate(() => {
        const left = (el) => (el ? Math.round(el.getBoundingClientRect().left * 10) / 10 : null)
        return { box: left(document.getElementById('finish-time-reason')), field: left([...document.querySelectorAll('p')].find((p) => p.textContent === 'Started')) }
      })
      check(t(`${state}: reason box lines up with the time fields (within 1px)`), edges.box !== null && edges.field !== null && Math.abs(edges.box - edges.field) <= 1, edges)
      await fontAtLeast(page.locator('#finish-time-reason-help'), 12, t(`${state} helper`))
      await noHScroll(page, t(state))
      if (vp.touch) await tapTargets(page.locator('main').first(), t(state))
      await crop(page, page.locator('#finish-time-reason').locator('xpath=ancestor::div[1]'), `${state}-${tag}.png`, vp, 24)
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }

  // submit-drift-line: step 1 did not ask (finishAsked false), the clock is now 8 minutes past the rostered end
  let driftPage = null
  try {
    const { context, page } = await openPage(browser, vp, { role: 'SupportWorker', username: 'dev.worker', draft: { step: 'submit', reached: 'submit', finishAsked: false, nothingToNote: true, nothingToHandOver: true, anythingToReport: 'no' } })
    driftPage = page
    await routeWorkerShift(page, { startOff: -8 - 480, endOff: -8, status: 'InProgress' })
    await gotoShift(page)
    const line = page.getByText(/You're now finishing 8 minutes late\./)
    await line.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)
    const add = page.getByRole('button', { name: 'Add a reason' })
    const addBox = await add.boundingBox()
    const lineText = (await add.locator('xpath=..').innerText()).replace(/\s+/g, ' ').trim()
    check(t('submit-drift-line: Add a reason is a visible control'), await add.isVisible() && addBox !== null, addBox)
    check(t('submit-drift-line: the line reads as the plan copy'), /^You're now finishing 8 minutes late\.\s?Add a reason$/.test(lineText) && !lineText.includes('?'), lineText)
    if (vp.touch) check(t('submit-drift-line: Add a reason is at least 44 high'), addBox !== null && addBox.height >= 43.5, addBox)
    await noHScroll(page, t('submit-drift-line'))
    if (vp.touch) await tapTargets(page.locator('main').first(), t('submit-drift-line'))
    await crop(page, line.locator('xpath=ancestor::div[2]'), `submit-drift-line-${tag}.png`, vp, 24)
    await context.close()
  } catch (e) {
    const seen = driftPage ? await driftPage.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400)).catch(() => '') : ''
    check(t('submit-drift-line ran'), false, `${String(e.message).split('\n')[0]} | ${seen}`)
  }

  // review-row-off-roster, review-detail-reasons: the coordinator's queue row and the approve dialog, with the completion patched
  try {
    const { context, page } = await openPage(browser, vp, { role: 'Admin', username: 'dev.admin' })
    await page.route('**/api/v1/rostering/completions*', async (r) => {
      const response = await r.fetch()
      const body = await response.json()
      const list = Array.isArray(body?.data) ? body.data : body?.data?.items
      if (Array.isArray(list) && list[0]) Object.assign(list[0], { offRoster: true, varianceMinutesStart: -12, varianceMinutesEnd: 8 })
      await r.fulfill({ response, json: body })
    })
    await page.route('**/api/v1/rostering/shifts/*/completion', async (r) => {
      const response = await r.fetch()
      const body = await response.json()
      if (body?.data) Object.assign(body.data, { offRosterStart: true, offRosterFinish: true, varianceMinutesStart: -12, varianceMinutesEnd: 8, startTimeReason: 'The bus was early, so I went in.', finishTimeReason: null })
      await r.fulfill({ response, json: body })
    })
    await page.goto(`${BASE_URL}/rostering/completions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const badge = page.getByText('Off roster', { exact: true }).first()
    await badge.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)
    if (!vp.touch) await maxLines(badge, 2, t('review-row-off-roster badge'))
    await noHScroll(page, t('review-row-off-roster'))
    const row = badge.locator('xpath=ancestor::tr[1]')
    await crop(page, (await row.count()) ? row : badge.locator('xpath=ancestor::div[2]'), `review-row-off-roster-${tag}.png`, vp, 8)
    const approve = page.getByRole('button', { name: /^Approve .* on / }).first()
    await approve.click()
    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForTimeout(400)
    const items = (await dialog.getByRole('listitem').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())
    check(t('review-detail-reasons: the start line carries its reason'), items.includes('Started 12 min early. Reason: The bus was early, so I went in.'), items)
    check(t('review-detail-reasons: the finish line says no reason given'), items.includes('Finished 8 min late. No reason given.'), items)
    await noHScroll(page, t('review-detail-reasons'))
    if (vp.touch) await tapTargets(dialog, t('review-detail-reasons'))
    await crop(page, dialog, `review-detail-reasons-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('review states ran'), false, String(e.message).split('\n')[0]) }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
