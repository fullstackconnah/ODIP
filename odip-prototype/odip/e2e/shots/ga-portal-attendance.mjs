// Worker marks "Didn't attend" on the portal group-activity card (ga-portal-attendance). Numeric checks 1 to 10 from SHAPE.md; exit 1 on any failure.
// States: started-unmarked, started-marked, started-saving, started-error, started-offline, started-long-name, notstarted-coordinator-marked, finished-marked, approved-marked
// (390 with touch), plus started-unmarked at 1280 and one full page per breakpoint.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/ga-portal-attendance.mjs <outdir>
// Everything the pages call is stubbed with page.route. The clock, theme (light) and zone (Sydney) are pinned.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const refusal = (code, message, status = 409) => ({ status, json: { success: false, data: null, message, errors: [message], code } })
const NOW = new Date('2026-11-16T04:00:00Z')   // 3:00 pm Monday 16 Nov in Sydney (AEDT)
const OFFLINE_HELP = "You're offline. Start, finish and attendance need a connection."
const LONG_NAME = 'Annabelle-Louise Featherstonehaugh-Smyth'
const checks = []
const check = (name, detail, pass) => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol
const px = (page, token) => page.evaluate((t) => { const p = document.createElement('div'); p.style.height = `var(${t})`; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h }, token)
const crop = async (page, locator, name, vp, pad = 8) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, `${name}-${vp.name}.png`), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}

const people = (...marks) => [
  { shiftId: 'sh-1', participantId: 'p-1', name: 'Mia Chen', didNotAttend: !!marks[0] },
  { shiftId: 'sh-2', participantId: 'p-2', name: 'Sam Lee', didNotAttend: !!marks[1] },
]
const activity = (over = {}) => ({
  id: 'row-1', groupActivityId: 'ga-1', title: 'Ten-pin bowling', serviceDate: '2026-11-16', startTime: '13:00:00', endTime: '17:00:00', endsNextDay: false,
  location: 'Strike Lanes, Parramatta', role: 'Driver', state: 'NotStarted', actualStart: null, actualEnd: null, breakStartedAt: null, breakEndedAt: null, participants: people(), ...over,
})
const started = (participants = people()) => activity({ state: 'Started', actualStart: '2026-11-16T02:02:00Z', participants })
const done = { actualStart: '2026-11-16T02:02:00Z', actualEnd: '2026-11-16T03:50:00Z' }

async function open(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch { /* storage blocked */ } }, [USER_ID])
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, e.message, false))
  const login = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role: 'SupportWorker', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role: 'SupportWorker', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(NOW)
  return { context, page }
}

async function run(browser, vp) {
  const { context, page } = await open(browser, vp)
  let current = activity()
  let mode = 'ok'   // the attendance POST: ok | hang | locked
  await page.route((u) => u.pathname === '/api/v1/portal/my-shifts', (r) => r.fulfill({ json: envelope({ shifts: [], tripAssignments: [], timeZoneId: 'Australia/Sydney', activityShifts: [current] }) }))
  await page.route('**/api/v1/portal/shifts/*/notes', (r) => r.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/portal/activity-staff/*/attendance', (r) => {
    if (mode === 'hang') return new Promise(() => {})
    if (mode === 'locked') return r.fulfill(refusal('GA_SHIFT_LOCKED', 'Your coordinator needs to change this.'))
    const body = r.request().postDataJSON()
    current = { ...current, participants: current.participants.map((p) => (p.participantId === body.participantId ? { ...p, didNotAttend: !body.attended } : p)) }
    return r.fulfill({ json: envelope(current) })
  })
  const show = async (state, { list = true } = {}) => {
    current = state
    mode = 'ok'
    // the saved copy of the list is fresh under the pinned clock, so clear it or the previous state paints and never refetches
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.includes('shifts:')) localStorage.removeItem(k) })
    await page.goto(`${BASE_URL}/portal`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('Ten-pin bowling').first().waitFor({ timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    const card = page.getByTestId('activity-shift-card')
    if (list) await card.getByRole('button', { name: /Participants/ }).click()
    return card
  }
  const row = (card, name) => card.locator('li').filter({ hasText: name })
  const attendBtn = (card, name) => row(card, name).getByRole('button', { name: new RegExp(`(Mark ${name} as didn't attend|Undo didn't attend for ${name})`) })
  const measure = async (card, name) => {
    const b = attendBtn(card, name), li = row(card, name)
    const [bb, lb, cb] = await Promise.all([b.boundingBox(), li.boundingBox(), card.boundingBox()])
    const notes = await li.getByRole('button', { name: 'Notes' }).boundingBox().catch(() => null)
    return { w: bb.width, h: bb.height, right: bb.x + bb.width, mid: bb.y + bb.height / 2, li: lb.height, card: cb.height, notesRight: notes ? notes.x + notes.width : null }
  }
  const tapMin = await px(page, '--tap-min')
  const ctl = await px(page, '--control-h')

  // unmarked, saving, marked: the same button in the same place
  let card = await show(started())
  await crop(page, card, 'started-unmarked', vp)
  const un = await measure(card, 'Mia Chen')
  check(`1 attendance Button is --control-h tall (${vp.name})`, `${un.h} vs ${ctl}`, near(un.h, ctl) && (!vp.touch || un.h >= tapMin - 0.5))

  mode = 'hang'
  await attendBtn(card, 'Mia Chen').click()
  await row(card, 'Mia Chen').locator('button[aria-disabled="true"]').waitFor({ timeout: 10_000 })
  const sv = await measure(card, 'Mia Chen')
  const savingOk = (await attendBtn(card, 'Mia Chen').getAttribute('aria-disabled')) === 'true' && !(await attendBtn(card, 'Mia Chen').evaluate((e) => e.disabled))
  await crop(page, card, 'started-saving', vp)

  card = await show(started(people(true)))
  await crop(page, card, 'started-marked', vp)
  const mk = await measure(card, 'Mia Chen')
  check(`2 button width and right edge hold across unmarked, saving, marked (${vp.name})`, `w ${un.w}/${sv.w}/${mk.w}; right ${un.right}/${sv.right}/${mk.right}; notes right ${un.notesRight}`,
    near(un.w, sv.w) && near(un.w, mk.w) && near(un.right, sv.right) && near(un.right, mk.right) && near(un.right, un.notesRight))
  check(`3 participant row and card height hold across the three states (${vp.name})`, `li ${un.li}/${sv.li}/${mk.li}; card ${un.card}/${sv.card}/${mk.card}`,
    near(un.li, sv.li) && near(un.li, mk.li) && near(un.card, sv.card) && near(un.card, mk.card))
  const badge = row(card, 'Mia Chen').locator('[data-status-badge]')
  const bbx = await badge.boundingBox()
  check(`4 badge is a StatusBadge, centred on the button (${vp.name})`, `${bbx.y + bbx.height / 2} vs ${mk.mid}; text ${await badge.textContent()}`, Math.abs(bbx.y + bbx.height / 2 - mk.mid) <= 1 && (await badge.textContent()) === "Didn't attend")
  check(`saving state is aria-disabled, not disabled (${vp.name})`, savingOk, savingOk)

  // keyboard focus stays on the same row's button after a mark and an undo
  card = await show(started())
  await attendBtn(card, 'Mia Chen').focus()
  await page.keyboard.press('Enter')
  await card.getByRole('button', { name: "Undo didn't attend for Mia Chen" }).waitFor({ timeout: 10_000 })
  const afterMark = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  await page.keyboard.press('Enter')
  await card.getByRole('button', { name: "Mark Mia Chen as didn't attend" }).waitFor({ timeout: 10_000 })
  const afterUndo = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
  check(`9 focus stays on the row's button after a mark and an undo (${vp.name})`, `${afterMark} / ${afterUndo}`, afterMark === "Undo didn't attend for Mia Chen" && afterUndo === "Mark Mia Chen as didn't attend")

  // refused
  card = await show(started())
  mode = 'locked'
  await attendBtn(card, 'Mia Chen').click()
  const alert = row(card, 'Mia Chen').getByRole('alert')
  await alert.waitFor({ timeout: 10_000 })
  await crop(page, card, 'started-error', vp)
  check(`10 the row's alert is the routed server message (${vp.name})`, await alert.textContent(), (await alert.textContent()) === 'Your coordinator needs to change this.' && (await card.getByRole('alert').count()) === 1)

  if (vp.touch) {
    // long name
    card = await show(started([{ shiftId: 'sh-1', participantId: 'p-1', name: LONG_NAME, didNotAttend: false }, ...people().slice(1)]))
    await crop(page, card, 'started-long-name', vp)
    const nameEl = card.locator('li').first().getByText(LONG_NAME)
    const n = await nameEl.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, to: getComputedStyle(e).textOverflow, h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight), right: e.getBoundingClientRect().right }))
    const notes = await card.locator('li').first().getByRole('button', { name: 'Notes' }).boundingBox()
    check('5 a 40-character name wraps, never ellipsises, and clears Notes by gap-2', JSON.stringify({ ...n, notesLeft: notes.x }),
      n.sw <= n.cw && n.to !== 'ellipsis' && n.h <= 2 * n.lh + 0.5 && n.right <= notes.x - 8 + 0.5)
    const over = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: window.innerWidth }))
    const cardOver = await card.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
    check('6 no horizontal overflow on the page or the card at 390', JSON.stringify({ over, cardOver }), over.sw <= 390 && cardOver.sw === cardOver.cw)

    // offline
    card = await show(started())
    await context.setOffline(true)
    await page.waitForTimeout(300)
    const buttons = card.getByRole('button', { name: /^(Mark .* as didn't attend|Undo didn't attend for .*)$/ })
    let allDisabled = (await buttons.count()) === 2
    for (let i = 0; i < (await buttons.count()); i++) allDisabled = allDisabled && (await buttons.nth(i).isDisabled())
    await crop(page, card, 'started-offline', vp)
    check('7 offline: every attendance Button is disabled and the hint reads exactly once', '', allDisabled && (await card.getByText(OFFLINE_HELP, { exact: true }).count()) === 1)
    await context.setOffline(false)

    // read-only states
    let readOnlyOk = true
    for (const [name, state] of [['notstarted-coordinator-marked', activity({ participants: people(true) })], ['finished-marked', activity({ state: 'Finished', ...done, participants: people(true) })], ['approved-marked', activity({ state: 'Approved', ...done, participants: people(true) })]]) {
      card = await show(state)
      await crop(page, card, name, vp)
      const ok = (await card.getByRole('button', { name: /didn't attend/ }).count()) === 0 && (await card.locator('[data-status-badge]').filter({ hasText: "Didn't attend" }).count()) === 1
      readOnlyOk = readOnlyOk && ok
    }
    check('8 read-only states: no attendance Button, exactly one "Didn\'t attend" badge', '', readOnlyOk)
  }

  card = await show(started())
  await fullPage(page, path.join(OUT_DIR, 'full', `started-unmarked-${vp.name}.png`), { touch: vp.touch })
  await context.close()
}

const browser = await chromium.launch({ headless: true })
try {
  await run(browser, { name: '390', width: 390, height: 844, touch: true })
  await run(browser, { name: '1280', width: 1280, height: 800, touch: false })
} finally {
  writeChecks(OUT_DIR, checks)
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
process.exit(failed.length ? 1 : 0)
