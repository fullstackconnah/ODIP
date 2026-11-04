// R4: the staff picker's "Available that day" group. Captures and numeric checks at the 1280 panel and the 390 sheet. Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/roster-who-is-free.mjs <outdir>
// Sign-in, the board and the staff list are stubbed with page.route (synthetic people), as eh-future-hires-picker.mjs does.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' })
const VIEWPORTS = [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 844, mobile: true }]

const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const shift = (o) => ({ id: 'sh', participantId: 'p-0001', participantName: 'Liam Okafor', staffId: 's-2', staffName: 'Owen Brandt', serviceDate: '', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false, durationHours: 8, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...o })
const person = (id, first, last) => ({ id, firstName: first, lastName: last, fullName: `${first} ${last}`, username: first.toLowerCase(), role: 'SupportWorker', position: 'SupportWorker', email: null, mobile: null, region: null, isDriverEligible: true, isFirstAidQualified: true, isMedicationCompetent: true, isManualHandlingCompetent: true, isOvernightEligible: true, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null, manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null, hasExpiredQualifications: false, notes: null })
// Staff-list order is by last name. Yara is Preferred but listed last, so the Preferred-first sort shows.
const STAFF = [person('s-6', 'Hana', 'Bell'), person('s-2', 'Owen', 'Brandt'), person('s-3', 'Lena', 'Cho'), person('s-7', 'Bartholomew', 'Featherstonehaugh-Smythe-Cholmondeley-Worthington'), person('s-8', 'Zoe', 'Free'), person('s-1', 'Yara', 'Young')]

let monday = null
const day = (i) => addDays(monday, i)
const board = (weekStart, withDays) => {
  monday = weekStart
  const open = shift({ id: 'u1', serviceDate: day(2), status: 'Draft' }); delete open.staffId; delete open.staffName
  const overlap = shift({ id: 'o1', participantId: 'p-0002', participantName: 'Ava Chen', serviceDate: day(2), startTime: '10:00:00', endTime: '14:00:00', durationHours: 4 })
  const row = (id, name, shifts) => ({ participantId: id, fullName: name, supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, shifts, tripBars: [], scheduledHours: 8, daysWithoutCover: 0 })
  const d = (staffId, preferred) => ({ staffId, date: day(2), preferred })
  return envelope({
    groupBy: 'Participant', weekStart, days: [0, 1, 2, 3, 4, 5, 6].map(day), exceptions: [], weekStarted: true,
    participantRows: [row('p-0001', 'Liam Okafor', [open]), row('p-0002', 'Ava Chen', [overlap])],
    staffLeave: [{ staffId: 's-3', from: day(2), to: day(2), status: 'Approved' }],
    // Owen is Available but on another shift (lands in Move); Lena's leave has no day entry, as the real API never sends both.
    staffAvailableDays: withDays ? [d('s-1', true), d('s-6', false), d('s-7', false), d('s-2', false)] : [],
  })
}

const lines = []
let failed = false
const check = (name, value, ok) => { if (!ok) failed = true; const l = `CHECK ${ok ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(value)}`; lines.push(l); console.log(l) }
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})
// Contrast ratio of two "rgb(a)" strings.
const contrast = (fg, bg) => {
  const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { const s = +v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    const tag = vp.name
    let withDays = true
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, reducedMotion: 'reduce' })
    const page = await context.newPage()
    const cdp = vp.mobile ? await context.newCDPSession(page) : null
    await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
    page.on('pageerror', (e) => check(`${tag} page error`, e.message, false))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route('**/api/v1/rostering/board*', (r) => r.fulfill({ json: board(new URL(r.request().url()).searchParams.get('weekStart'), withDays) }))
    await page.route(/\/api\/v1\/staff(\?.*)?$/, (r) => r.fulfill({ json: envelope(STAFF) }))
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
    // The dialog itself, shot as an element (no fullPage): instant scroll first so a sheet is in view.
    const shoot = async (dlg, state) => { await settled(page); await dlg.evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' })); await dlg.screenshot({ path: path.join(OUT_DIR, `${state}.png`) }) }
    const labelOf = (dlg, text) => dlg.getByText(text, { exact: true })
    const height = (loc) => loc.evaluate((el) => el.clientHeight)
    const opt = (dlg, name) => dlg.getByRole('option', { name: new RegExp(name) })

    // 1. Days present.
    let dlg = await open()
    const labels = await dlg.locator('[role="group"]').evaluateAll((gs) => gs.map((g) => document.getElementById(g.getAttribute('aria-labelledby')).textContent.trim()))
    check(`${tag} group order`, labels, JSON.stringify(labels) === JSON.stringify(['Available that day', 'Free at this time', 'On another shift at this time', 'On leave that day']))
    const hAvail = await height(labelOf(dlg, 'Available that day')); const hFree = await height(labelOf(dlg, 'Free at this time'))
    check(`${tag} 1 Available label one line (height equals Free label)`, [hAvail, hFree], hAvail === hFree)
    const badge = dlg.getByText('Prefers this day', { exact: true }); const leaveBadge = dlg.getByText('On leave', { exact: true })
    const [hb, hl] = [await height(badge), await height(leaveBadge)]
    const bw = await badge.evaluate((el) => [el.scrollWidth, el.clientWidth])
    check(`${tag} 2 Prefers badge height = On leave badge height, no clipping`, { hb, hl, bw }, hb === hl && bw[0] <= bw[1])
    const [oP, oL, oA, oF] = await Promise.all([height(opt(dlg, '^Yara Young')), height(opt(dlg, '^Lena Cho')), height(opt(dlg, '^Hana Bell')), height(opt(dlg, '^Zoe Free'))])
    check(`${tag} 3 option heights (Preferred~leave, Available~Free, +-1)`, { oP, oL, oA, oF }, Math.abs(oP - oL) <= 1 && Math.abs(oA - oF) <= 1)
    const lbm = await dlg.getByRole('listbox', { name: 'Staff' }).evaluate((el) => [el.scrollWidth, el.clientWidth])
    check(`${tag} 4 listbox no sideways scroll`, lbm, lbm[0] - lbm[1] <= 0)
    const long = await opt(dlg, '^Bartholomew').evaluate((el) => {
      const [name, meter] = el.querySelectorAll('span > span')
      return { nameTrunc: name.scrollWidth > name.clientWidth, meterRight: meter.getBoundingClientRect().right, optRight: el.getBoundingClientRect().right }
    })
    check(`${tag} 5 long name truncates, meter inside px-3`, long, long.nameTrunc && long.meterRight <= long.optRight - 12 + 0.5)
    const order = await dlg.getByRole('option').evaluateAll((os) => os.map((o) => ({ name: o.getAttribute('aria-label'), group: document.getElementById(o.closest('[role="group"]').getAttribute('aria-labelledby')).textContent.trim() })))
    const iP = order.findIndex((o) => /^Yara/.test(o.name)); const iA = order.findIndex((o) => /^Hana/.test(o.name))
    check(`${tag} 6 first option in Available group, Preferred before Available-only`, order.slice(0, 3), order[0].group === 'Available that day' && iP >= 0 && iP < iA)
    const owen = order.find((o) => /^Owen/.test(o.name))
    check(`${tag} 6b Owen (available but on another shift) is in Move`, owen, owen.group === 'On another shift at this time')
    const light = await badge.evaluate((el) => { const c = getComputedStyle(el); return [c.color, c.backgroundColor] })
    check(`${tag} 8 Prefers badge contrast light >= 4.5`, [light, contrast(...light)], contrast(...light) >= 4.5)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await settled(page)
    const dark = await badge.evaluate((el) => { const c = getComputedStyle(el); return [c.color, c.backgroundColor] })
    check(`${tag} 8 Prefers badge contrast dark >= 4.5`, [dark, contrast(...dark)], contrast(...dark) >= 4.5)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light')); await settled(page)
    await shoot(dlg, vp.mobile ? 'picker-available-390' : 'picker-available-desktop')

    // 2. Search narrows the Available group.
    await dlg.getByRole('combobox', { name: 'Find staff' }).fill('Yara')
    const narrowed = await dlg.locator('[role="group"]').count()
    check(`${tag} search keeps only the Available group`, narrowed, narrowed === 1 && (await labelOf(dlg, 'Available that day').count()) === 1)
    await shoot(dlg, vp.mobile ? 'picker-search-available-390' : 'picker-search-available-desktop')

    // 3. No days: today's picker.
    withDays = false
    dlg = await open()
    const none = await dlg.locator('[role="group"]').count()
    check(`${tag} 7 no days: group count equals today's fixture (3), label absent`, none, none === 3 && (await labelOf(dlg, 'Available that day').count()) === 0)
    await shoot(dlg, vp.mobile ? 'picker-none-available-390' : 'picker-none-available-desktop')
    await context.close()
  }
} finally {
  await browser.close()
  writeFileSync(path.join(OUT_DIR, 'measure.txt'), lines.join('\n') + '\n')
}
console.log(`CHECKS total ${lines.length}, failed ${lines.filter((l) => l.includes(' FAIL ')).length}`)
if (failed) process.exit(1)
