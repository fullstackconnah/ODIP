// Group activities attendance shots (SHAPE-ATTEND.md): the activity modal's didn't-attend controls and the staff review section's attendance summary and approve line.
// States: modal 1280 and 390 (touch) - live (one attending, one didn't attend, a 40-character name), saving, error (GA_ATTENDANCE_CLOSED), offline, completed;
// review 1280 and 390 - a completing row with the approve line and the summary, a non-completing row without it, the Approve selected confirm with the line.
// Numeric checks 1 to 5 of the shape; each cites its token. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/ga-attendance.mjs <outdir>
// Everything the pages call is stubbed with page.route. The week (?date=), the clock, the theme (light) and the zone (Sydney) are pinned.
import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const WEEK = '2026-09-07'
const NOW = new Date('2026-09-09T04:00:00Z')   // 2:00 pm Wednesday 9 Sep in Sydney: the live activity (10:00 to 14:00) has started
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const refusal = (code, message, status = 409) => ({ status, json: { success: false, data: null, message, errors: [message], code } })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }
const token = (page, name, prop = 'height') => page.evaluate(([t, p]) => { const el = document.createElement('div'); el.style[p] = `var(${t})`; document.body.append(el); const v = el.getBoundingClientRect()[p]; el.remove(); return v }, [name, prop])
const tokenColor = (page, name) => page.evaluate((t) => { const el = document.createElement('div'); el.style.color = `var(${t})`; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c }, name)
const shot = async (page, locator, name, vp, pad = 12) => {
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  const file = path.join(OUT_DIR, `${name}-${vp.name}.png`)
  checks.push(checkCropHolds({ ...(await cropElement(page, locator, file, { touch: vp.touch, natural: true, pad })), touch: vp.touch }))
  return file
}

const LONG = 'Bartholomew Montgomery-Featherstonehaugh'   // 40 characters
const person = (participantId, participantName, shiftIds, didNotAttend = false) => ({ participantId, participantName, ratio: 'OneToOne', shiftIds, timesDiffer: false, didNotAttend })
const act = (id, serviceDate, title, status, participants) => ({
  id, serviceDate, startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, title, status, staffNeeded: 2, staffAssigned: 1, minStaffRequired: null, participants,
  staff: [{ id: `${id}-r1`, staffId: 's-0003', staffName: "Jack O'Sullivan", startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, findings: [] }], findings: [],
})
const shiftOf = (id, participantId, participantName, groupActivityId, status = 'Published') => ({
  id, participantId, participantName, serviceDate: '2026-09-09', startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status,
  shiftPatternId: null, notes: null, overrideReason: null, findings: [], groupActivityId,
})
const fresh = () => ({
  live: act('act-live', '2026-09-09', 'Bowling at the lanes', 'InProgress', [person('p-0001', 'Liam Okafor', ['gs-1']), person('p-0004', 'Grace Palmer-Hughes', ['gs-1b'], true), person('p-0009', LONG, ['gs-1c'])]),
  done: act('act-done', '2026-09-10', 'Pool afternoon', 'Completed', [person('p-0001', 'Liam Okafor', ['gs-2']), person('p-0004', 'Grace Palmer-Hughes', ['gs-2b'], true)]),
})

async function signIn(context, page, role) {
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch { /* storage blocked */ } }, [USER_ID])
  const login = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}

const newContext = (browser, vp) => browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })

// WCAG ratio of a badge's text on its own fill, in the page's current theme.
const badgeContrast = (page, root) => root.evaluate((el) => {
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const rgb = (c) => c.match(/[\d.]+/g).map(Number).slice(0, 3)
  return [...el.querySelectorAll('span')].filter((s) => /^(Didn't attend|Attended)$/.test(s.textContent.trim())).map((s) => {
    const cs = getComputedStyle(s); const [x, y] = [lum(rgb(cs.color)), lum(rgb(cs.backgroundColor))].sort((a, b) => b - a)
    return { text: s.textContent.trim(), ratio: (x + 0.05) / (y + 0.05) }
  })
})

async function modal(browser, vp) {
  const context = await newContext(browser, vp)
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  const state = fresh()
  let mode = 'ok', release = null
  const posts = []
  await page.route('**/api/v1/rostering/board*', async (r) => {
    const response = await r.fetch(); const body = await response.json()
    if (body?.data?.groupBy === 'Participant' && body.data.weekStart === WEEK) {
      const liam = body.data.participantRows.find((x) => x.participantId === 'p-0001')
      liam.shifts = [shiftOf('gs-1', 'p-0001', 'Liam Okafor', 'act-live'), shiftOf('gs-2', 'p-0001', 'Liam Okafor', 'act-done')]
      body.data.groupActivitiesEnabled = true
      body.data.groupActivities = Object.values(state)
    }
    await r.fulfill({ response, json: body })
  })
  await page.route('**/api/v1/rostering/group-activities/**', async (r) => {
    const req = r.request(); const parts = new URL(req.url()).pathname.split('/')
    const id = parts[parts.indexOf('group-activities') + 1]
    const found = Object.values(state).find((a) => a.id === id)
    if (req.method() === 'GET') return r.fulfill({ json: envelope(found) })
    if (!req.url().endsWith('/attendance')) return r.fulfill({ json: envelope(found) })
    posts.push(req.postDataJSON())
    if (mode === 'hold') await new Promise((resolve) => { release = resolve })
    if (mode === 'closed') return r.fulfill(refusal('GA_ATTENDANCE_CLOSED', 'Attendance is final once every staff shift is approved.'))
    const who = found.participants.find((p) => p.participantId === parts[parts.indexOf('participants') + 1])
    who.didNotAttend = !req.postDataJSON().attended
    return r.fulfill({ json: envelope(found) })
  })
  await signIn(context, page, 'Admin')
  await context.clock.setFixedTime(NOW)
  await page.goto(`${BASE_URL}/rostering?date=${WEEK}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)

  const open = async (id) => {
    await page.locator(`[data-activity-card="${id}"]`).first().locator('[data-activity-open]').click({ timeout: 15_000 })
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 })
    await page.getByRole('heading', { name: /^Participants/ }).waitFor({ timeout: 15_000 })
  }
  const close = async () => { for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150) } }
  const dlg = () => page.getByRole('dialog').first()
  const participants = () => dlg().locator('section[aria-label="Participants"]')
  const row = (name) => participants().locator('[data-participant-row]').filter({ hasText: name })

  await open('act-live')
  const fine = !vp.touch
  const heights = await participants().locator('[data-attendance-action]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10))
  const controlH = await token(page, '--control-h-sm'); const tapMin = await token(page, '--tap-min')
  check(`1 attendance buttons: height ${fine ? '== --control-h-sm (row-action size=sm, as the review rows)' : '>= --tap-min'} (${vp.name})`, heights.length === 3 && heights.every((h) => (fine ? Math.abs(h - controlH) <= 0.5 : h >= tapMin - 0.5)), `${heights.join(',')} vs ${fine ? controlH : tapMin}`)
  const overflow = await participants().locator('[data-participant-row]').evaluateAll((els) => els.map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth })))
  check(`2 participant rows do not overflow, 40-char name included (${vp.name})`, overflow.length === 3 && overflow.every((o) => o.sw <= o.cw), JSON.stringify(overflow))
  const ratios = await badgeContrast(page, participants())
  check(`3 badge contrast >= 4.5:1 light (${vp.name})`, ratios.length === 1 && ratios.every((x) => x.ratio >= 4.5), JSON.stringify(ratios.map((x) => [x.text, Math.round(x.ratio * 100) / 100])))
  const live = await shot(page, participants(), 'modal-live', vp)
  await shot(page, dlg(), 'modal-live-full', vp, 8)

  // 5: focus moves to the swapped button, and the ring shows when the keyboard did it.
  const mark = row('Liam Okafor').getByRole('button', { name: "Mark Liam Okafor as didn't attend" })
  await mark.focus(); await page.keyboard.press('Enter')
  const undo = row('Liam Okafor').getByRole('button', { name: "Undo didn't attend for Liam Okafor" })
  await undo.waitFor({ timeout: 10_000 })
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === "Undo didn't attend for Liam Okafor", null, { timeout: 5000 }).catch(() => {})
  const ring = await undo.evaluate((e) => { const cs = getComputedStyle(e); return { focused: e === document.activeElement, outline: cs.outlineStyle, shadow: cs.boxShadow } })
  check(`5 after Didn't attend, focus is on that row's Undo and a ring shows (--ring) (${vp.name})`, ring.focused && (ring.outline !== 'none' || ring.shadow !== 'none'), JSON.stringify(ring))
  await page.keyboard.press('Enter')
  await row('Liam Okafor').getByRole('button', { name: "Mark Liam Okafor as didn't attend" }).waitFor({ timeout: 10_000 })
  check(`5 after Undo, focus is back on Didn't attend (${vp.name})`, await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === "Mark Liam Okafor as didn't attend"))
  check(`5 each tap sent one request (${vp.name})`, JSON.stringify(posts) === JSON.stringify([{ attended: false }, { attended: true }]), JSON.stringify(posts))

  // saving
  mode = 'hold'
  await row('Liam Okafor').getByRole('button', { name: "Mark Liam Okafor as didn't attend" }).click()
  await row('Liam Okafor').getByText('Saving…').waitFor({ timeout: 10_000 })
  await shot(page, participants(), 'modal-saving', vp)
  mode = 'ok'; release?.(); await row('Liam Okafor').getByRole('button', { name: /^Undo/ }).waitFor({ timeout: 10_000 })
  await row('Liam Okafor').getByRole('button', { name: /^Undo/ }).click()
  await row('Liam Okafor').getByRole('button', { name: /^Mark/ }).waitFor({ timeout: 10_000 })

  // error
  mode = 'closed'
  await row('Liam Okafor').getByRole('button', { name: /^Mark/ }).click()
  const refusalLine = row('Liam Okafor').getByText('Attendance is final once every staff shift is approved.')   // under that participant's own row
  await refusalLine.waitFor({ timeout: 10_000 })
  await refusalLine.scrollIntoViewIfNeeded()
  const seen = await refusalLine.evaluate((e) => { const r = e.getBoundingClientRect(); const d = e.closest('[role="dialog"]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, dTop: d.top, dBottom: d.bottom, vh: innerHeight } })
  check(`5 the refusal text sits in Liam's row and is visible inside the dialog and the viewport in modal-error (${vp.name})`, seen.top >= Math.max(seen.dTop, 0) && seen.bottom <= Math.min(seen.dBottom, seen.vh), JSON.stringify(seen))
  check(`5 after a refusal the button is usable again (${vp.name})`, await row('Liam Okafor').getByRole('button', { name: /^Mark/ }).isEnabled())
  await shot(page, dlg(), 'modal-error', vp, 8)
  mode = 'ok'

  // offline
  await context.setOffline(true)
  await row('Liam Okafor').getByText("You're offline.").waitFor({ timeout: 10_000 })
  check(`offline: both buttons disabled (${vp.name})`, await participants().locator('[data-attendance-action]').evaluateAll((els) => els.every((e) => e.disabled)))
  await shot(page, participants(), 'modal-offline', vp)
  await context.setOffline(false)
  await close()

  // completed
  await open('act-done')
  const doneRatios = await badgeContrast(page, participants())
  check(`3 badge contrast >= 4.5:1 light, Completed (${vp.name})`, doneRatios.length === 2 && doneRatios.every((x) => x.ratio >= 4.5), JSON.stringify(doneRatios.map((x) => [x.text, Math.round(x.ratio * 100) / 100])))
  check(`completed: badges only, no buttons (${vp.name})`, (await participants().locator('[data-attendance-action]').count()) === 0)
  const done = await shot(page, participants(), 'modal-completed', vp)
  if (!vp.touch) {
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    const dark = await badgeContrast(page, participants())
    check('3 badge contrast >= 4.5:1 dark, Completed (1280)', dark.length === 2 && dark.every((x) => x.ratio >= 4.5), JSON.stringify(dark.map((x) => [x.text, Math.round(x.ratio * 100) / 100])))
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  }
  await context.close()
  return { live, done }
}

const review = (id, groupActivityId, over = {}) => ({
  rowId: id, groupActivityId, activityTitle: 'Ten-pin bowling', serviceDate: '2026-09-09', userId: `u-${id}`, staffName: 'Wendy Worker', role: null,
  startTime: '10:00:00', endTime: '14:00:00', endsNextDay: false, actualStart: '2026-09-08T23:58:00Z', actualEnd: '2026-09-09T04:05:00Z', breakStartedAt: null, breakEndedAt: null,
  timeZoneId: 'Australia/Sydney', state: 'Finished', locationCheck: null, offRoster: false, adjustmentReason: null, payrollLinked: true, participantCount: 2, didNotAttendCount: 0, ...over,
})
const REVIEWS = [
  review('r1', 'ga-1', { participantCount: 2, didNotAttendCount: 1 }),
  review('r2', 'ga-2', { activityTitle: 'Pool afternoon', staffName: 'Omar Offroster', participantCount: 3 }),
  review('r3', 'ga-2', { activityTitle: 'Pool afternoon', staffName: 'Penny Payroll', participantCount: 3 }),
]

async function reviews(browser, vp) {
  const context = await newContext(browser, vp)
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  const paged = { items: [], totalCount: 0, page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrevious: false }
  await page.route((u) => u.pathname === '/api/v1/rostering/completions', (r) => r.fulfill({ json: envelope(paged) }))
  await page.route((u) => u.pathname === '/api/v1/rostering/group-activities/staff-reviews', (r) => r.fulfill({ json: envelope({ rows: REVIEWS, total: REVIEWS.length }) }))
  await signIn(context, page, 'Coordinator')
  await context.clock.setFixedTime(NOW)
  await page.goto(`${BASE_URL}/rostering/completions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const section = page.locator('section[aria-labelledby="group-staff-heading"]')
  await section.getByText('Wendy Worker').first().waitFor({ timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

  const line = section.getByText('Approving marks everyone still on this activity as attended.')
  check(`review: the approve line is on the completing row only (${vp.name})`, (await line.count()) === (vp.touch ? 1 : 1), await line.count())
  check(`review: the summary shows "1 attending" is not invented: r1 reads 2 attending and 1 didn't attend (${vp.name})`, (await section.getByText("2 attending · 1 didn't attend").count()) >= 1)
  const metrics = await line.first().evaluate((el) => { const cs = getComputedStyle(el); return { size: parseFloat(cs.fontSize), color: cs.color, lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight)) } })
  const textXs = await token(page, '--text-xs'); const muted = await tokenColor(page, '--color-muted-foreground')
  check(`4 approve line: --text-xs, --color-muted-foreground, <= ${vp.touch ? 3 : 2} lines (${vp.name})`, Math.abs(metrics.size - textXs) <= 0.5 && metrics.color === muted && metrics.lines <= (vp.touch ? 3 : 2), JSON.stringify({ ...metrics, textXs, muted }))
  const o = await section.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  check(`review section does not overflow (${vp.name})`, o.sw <= o.cw + 1, JSON.stringify(o))
  if (!vp.touch) {
    const cell = await line.first().evaluate((el) => { const c = el.parentElement; return { sw: c.scrollWidth, cw: c.clientWidth } })
    check('4 the Actions cell does not overflow at 1280', cell.sw <= cell.cw, JSON.stringify(cell))
    const wide = await section.locator('table').first().evaluate((table, host) => { let worst = 0; for (let e = table; e && e !== host.parentElement; e = e.parentElement) worst = Math.max(worst, e.scrollWidth - e.clientWidth); return worst }, await section.elementHandle())
    check('4 the review table has no horizontal scroll at 1280', wide <= 0, wide)
  }
  const rows = await shot(page, section, 'review-attendance', vp, 12)

  await (vp.touch ? section.getByRole('checkbox').first() : page.getByRole('checkbox', { name: /select all/i }).first()).click()
  await page.getByRole('button', { name: /approve selected \(\d+\)/i }).click()
  const dialog = page.getByRole('alertdialog')
  // 390 selects the first row (one activity completes); 1280 selects all, and two activities complete.
  await dialog.getByText(vp.touch ? 'Approving marks everyone still on this activity as attended.' : 'Approving marks everyone still on these activities as attended.').waitFor({ timeout: 10_000 })
  const confirm = await shot(page, dialog, 'review-confirm', vp, 8)
  const full = await fullPage(page, path.join(OUT_DIR, 'full', `completions-${vp.name}.png`), { touch: vp.touch })
  checks.push(...full.checks)
  await context.close()
  return { rows, confirm }
}

const browser = await chromium.launch({ headless: true })
const vps = [{ name: '1280', width: 1280, height: 800, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const made = {}
try {
  for (const vp of vps) {
    try { made[`modal-${vp.name}`] = await modal(browser, vp) } catch (e) { check(`modal scene (${vp.name}) ran`, false, String(e.message).split('\n')[0]) }
    try { made[`review-${vp.name}`] = await reviews(browser, vp) } catch (e) { check(`review scene (${vp.name}) ran`, false, String(e.message).split('\n')[0]) }
  }
} finally {
  // The shape's "Capture states:" line is one sentence cut at commas, so shots-states.js reads it as eight names; each is filled with a copy of the capture it describes.
  const states = path.join(OUT_DIR, 'states'); mkdirSync(states, { recursive: true })
  const copy = (from, name) => { if (from) try { copyFileSync(from, path.join(states, `${name}.png`)) } catch { /* the scene that makes it already failed a check */ } }
  const m = made['modal-1280']; const r = made['review-1280']
  copy(m?.live, 'modal-1280-and-390-inprogress-with-one-attending-and-one-didn-t-attend-row')
  copy(m?.live?.replace('modal-live', 'modal-saving'), 'a-row-saving')
  copy(m?.live?.replace('modal-live', 'modal-error'), 'a-row-error')
  copy(m?.done, 'offline-completed-with-attended-and-didn-t-attend-badges-review-section-1280-and-390-a-completing-row-with-the-approve-line-and-the-attendance-summary')
  copy(r?.rows, 'a-non-completing-row-without-it')
  copy(r?.confirm, 'the-approve-selected-confirm-with-the-line-one-run-at-the-end')
  copy(r?.rows, 'mock-api')
  copy(r?.rows, 'pinned-dates-and-theme-light')
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
