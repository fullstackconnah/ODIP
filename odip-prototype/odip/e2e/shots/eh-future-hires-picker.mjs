// Captures and numeric checks for the Needs staff picker with an Employment Hero start date (I15 fix 1). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/eh-future-hires-picker.mjs <outdir>
// The board, the staff list and the assign refusal come from page.route stubs. Exits non-zero when a check fails; every measured
// value is printed as "CHECK ok|FAIL name = value", and measure.txt in OUT_DIR holds the same lines.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' })

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '390', width: 390, height: 844, mobile: true },
]
const LABELS = ['Free at this time', 'On another shift at this time', 'On leave that day', "Hasn't started yet"]

const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const shift = (o) => ({ id: 'sh', participantId: 'p-0001', participantName: 'Liam Okafor', staffId: 's-2', staffName: 'Owen Brandt', serviceDate: '', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false, durationHours: 8, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...o })
const person = (id, first, last, o = {}) => ({ id, firstName: first, lastName: last, fullName: `${first} ${last}`, username: first.toLowerCase(), role: 'SupportWorker', position: 'SupportWorker', email: null, mobile: null, region: null, isDriverEligible: true, isFirstAidQualified: true, isMedicationCompetent: true, isManualHandlingCompetent: true, isOvernightEligible: true, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null, manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null, hasExpiredQualifications: false, notes: null, ...o })

let monday = null   // the week the page asked for; the stubs are keyed on it so the shift's date is always on the board
const day = (i) => addDays(monday, i)
const STAFF = () => [
  person('s-1', 'Freya', 'Anders'),                                          // free
  person('s-5', 'Bo', 'Boundary', { employmentStartDate: day(2) }),         // starts ON the shift date: free
  person('s-2', 'Owen', 'Brandt'),                                           // on an overlapping shift
  person('s-3', 'Lena', 'Cho'),                                              // on approved leave
  person('s-4', 'Nia', 'Starter', { employmentStartDate: day(3) }),         // starts after the shift date
]
const board = (weekStart) => {
  monday = weekStart
  const days = [0, 1, 2, 3, 4, 5, 6].map(day)
  const open = shift({ id: 'u1', serviceDate: day(2), status: 'Draft' }); delete open.staffId; delete open.staffName
  const overlap = shift({ id: 'o1', participantId: 'p-0002', participantName: 'Ava Chen', serviceDate: day(2), startTime: '10:00:00', endTime: '14:00:00', durationHours: 4 })
  const row = (id, name, shifts) => ({ participantId: id, fullName: name, supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, shifts, tripBars: [], scheduledHours: 8, daysWithoutCover: 0 })
  return envelope({
    groupBy: 'Participant', weekStart, days, exceptions: [], weekStarted: true,
    participantRows: [row('p-0001', 'Liam Okafor', [open]), row('p-0002', 'Ava Chen', [overlap])],
    staffLeave: [{ staffId: 's-3', from: day(2), to: day(2), status: 'Approved' }],
  })
}
const refusal = { success: false, data: [{ code: 'STAFF_NOT_STARTED', severity: 'Blocking', message: "Nia Starter starts on 02/11/2026 – can't be rostered before then.", requiresReason: false }], message: 'Roster check failed', errors: [] }

const lines = []
let failed = false
const check = (name, value, ok) => { if (!ok) failed = true; const l = `CHECK ${ok ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(value)}`; lines.push(l); console.log(l) }
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    const tag = vp.name
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce' })
    const page = await context.newPage()
    // The touch emulation alone left `pointer: coarse` false on the first page of a run; pin it so the 44px density tokens apply.
    const cdp = vp.mobile ? await context.newCDPSession(page) : null
    await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
    page.on('pageerror', (e) => check(`${tag} page error`, e.message, false))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route('**/api/v1/rostering/board*', (r) => r.fulfill({ json: board(new URL(r.request().url()).searchParams.get('weekStart')) }))
    await page.route(/\/api\/v1\/staff(\?.*)?$/, (r) => r.fulfill({ json: envelope(STAFF()) }))
    await page.route('**/api/v1/rostering/shifts/*/assign', (r) => r.fulfill({ status: 422, json: refusal }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

    const open = async () => {
      await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const plus = page.locator('[data-shift-plus="u1"]')
      await plus.waitFor({ timeout: 60_000 })
      await plus.click()
      const dlg = page.getByRole('dialog').filter({ has: page.getByRole('combobox', { name: 'Find staff' }) })
      await dlg.waitFor({ timeout: 15_000 })
      await settled(page)
      return dlg
    }
    // A padded crop of a locator, kept inside the viewport.
    const shoot = async (loc, state) => {
      await settled(page)
      const b = await loc.boundingBox()
      const x = Math.max(0, b.x - 24); const y = Math.max(0, b.y - 24)
      await page.screenshot({ path: path.join(OUT_DIR, `${state}-${tag}.png`), clip: { x, y, width: Math.min(vp.width - x, b.width + 48), height: Math.min(vp.height - y, b.height + 48) } })
    }
    const groupLabels = (dlg) => dlg.locator('[role="group"]').evaluateAll((gs) => gs.map((g) => document.getElementById(g.getAttribute('aria-labelledby')).textContent.trim()))
    const groupOf = (dlg, name) => dlg.locator('[role="group"]').filter({ has: dlg.page().getByRole('option', { name: new RegExp(name) }) }).evaluateAll((gs) => gs.map((g) => document.getElementById(g.getAttribute('aria-labelledby')).textContent.trim()))
    const fits = async (dlg, name) => {
      const m = await page.evaluate(() => ({ page: document.documentElement.scrollWidth }))
      const d = await dlg.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
      check(`${tag} ${name} no horizontal overflow (page scrollWidth <= ${vp.width})`, m.page, m.page <= vp.width)
      check(`${tag} ${name} picker fits itself`, d, d.sw <= d.cw + 1)
    }

    // 1. All four groups, in order; at 390 scrolled to the last group.
    let dlg = await open()
    const labels = await groupLabels(dlg)
    check(`${tag} group label order`, labels, JSON.stringify(labels) === JSON.stringify(LABELS))
    const boundary = await groupOf(dlg, 'Bo Boundary')
    check(`${tag} boundary person's group`, boundary, boundary.length === 1 && boundary[0] === LABELS[0])
    if (vp.mobile) await dlg.getByRole('listbox', { name: 'Staff' }).evaluate((el) => { el.scrollTop = el.scrollHeight })
    await fits(dlg, 'picker open')
    await shoot(dlg, 'picker-open')

    // 2. The not-started row with its badge, beside the leave row.
    const lb = dlg.getByRole('listbox', { name: 'Staff' })
    await lb.evaluate((el) => { el.scrollTop = el.scrollHeight })
    const nia = dlg.getByRole('option', { name: /Nia Starter/ })
    const badge = await nia.getByText("Hasn't started yet").count()
    check(`${tag} not-started row carries the badge`, badge, badge === 1)
    check(`${tag} leave row beside it`, await dlg.getByRole('option', { name: /Lena Cho/ }).isVisible(), await dlg.getByRole('option', { name: /Lena Cho/ }).isVisible())
    await shoot(dlg, 'not-started-row')

    // 3. That row keyboard-active, showing the selected fill.
    await dlg.getByRole('combobox', { name: 'Find staff' }).focus()
    let activeIsNia = false
    for (let i = 0; i < 12 && !activeIsNia; i++) {
      await page.keyboard.press('ArrowDown')
      activeIsNia = await dlg.getByRole('combobox', { name: 'Find staff' }).evaluate((el) => document.getElementById(el.getAttribute('aria-activedescendant') ?? '')?.textContent?.includes('Nia Starter') ?? false)
    }
    check(`${tag} arrow keys reach the not-started row`, activeIsNia, activeIsNia)
    const bgOf = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
    await settled(page)
    const fill = { selected: await nia.getAttribute('aria-selected'), active: await bgOf(nia), idle: await bgOf(dlg.getByRole('option', { name: /Lena Cho/ })) }
    check(`${tag} active row is selected and has a fill`, fill, fill.selected === 'true' && fill.active !== 'rgba(0, 0, 0, 0)' && fill.active !== fill.idle)
    await shoot(dlg, 'keyboard-active')

    // 4. Search narrowed to the not-started person's name.
    await dlg.getByRole('combobox', { name: 'Find staff' }).fill('Nia Starter')
    const narrowed = await groupLabels(dlg)
    check(`${tag} search narrows to the one group`, narrowed, JSON.stringify(narrowed) === JSON.stringify([LABELS[3]]))
    await shoot(dlg, 'search-narrowed')

    // 5. The refusal after picking that row.
    await dlg.getByRole('option', { name: /Nia Starter/ }).click()
    const alert = page.getByRole('alertdialog')
    await alert.waitFor({ timeout: 15_000 })
    const said = await alert.innerText()
    check(`${tag} refusal names the start date`, said.slice(0, 160), /starts on/.test(said))
    await fits(alert, 'refusal')
    await shoot(alert, 'refusal')

    // 6. The boundary person under Free at this time.
    dlg = await open()
    await dlg.getByRole('combobox', { name: 'Find staff' }).fill('Boundary')
    const free = await groupLabels(dlg)
    check(`${tag} boundary search shows only Free`, free, JSON.stringify(free) === JSON.stringify([LABELS[0]]))
    await shoot(dlg, 'boundary-free')
    await context.close()
  }
} finally {
  await browser.close()
  writeFileSync(path.join(OUT_DIR, 'measure.txt'), lines.join('\n') + '\n')
}
const bad = lines.filter((l) => l.includes(' FAIL '))
console.log(`CHECKS total ${lines.length}, failed ${bad.length}`)
if (failed) process.exit(1)
