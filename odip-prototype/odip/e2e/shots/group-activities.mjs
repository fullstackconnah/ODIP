// Group activities PR2 (spec 2026-11-08, SHAPE.md): captures plus the numeric checks of section 9. Computed boxes only; exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/group-activities.mjs <outdir>
// Pinned: the fixture week 2026-09-07 (?date=), theme light (one dark set for board-normal and modal-normal), the mock board with activities injected through page.route.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks, settle } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const WEEK = '2026-09-07'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
const shiftOf = (id, participantId, participantName, serviceDate, startTime, endTime, extra = {}) => ({
  id, participantId, participantName, serviceDate, startTime, endTime, endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...extra,
})
const staffRow = (id, staffId, staffName, startTime, endTime) => ({ id, staffId, staffName, startTime, endTime, endsNextDay: false, findings: [] })
const person = (participantId, participantName, shiftIds, extra = {}) => ({ participantId, participantName, ratio: 'OneToOne', shiftIds, timesDiffer: false, ...extra })
const short = { code: 'ACTIVITY_STAFF_SHORT', severity: 'Warning', message: '2 more staff needed.', requiresReason: false }
const act = (id, serviceDate, title, startTime, endTime, extra = {}) => ({
  id, serviceDate, startTime, endTime, endsNextDay: false, title, status: 'Published', staffNeeded: 3, staffAssigned: 3, minStaffRequired: null, participants: [], staff: [], findings: [], ...extra,
})
const A = {
  normal: act('act-normal', '2026-09-09', 'Bowling at the lanes', '10:00:00', '14:00:00', {
    participants: [person('p-0001', 'Liam Okafor', ['gs-1']), person('p-0004', 'Grace Palmer-Hughes', ['gs-1b'])],
    staff: [staffRow('r1', 's-0003', "Jack O'Sullivan", '10:00:00', '14:00:00'), staffRow('r2', 's-0004', 'Mei Zhang', '10:00:00', '14:00:00'), staffRow('r3', 's-0001', 'Priya Nair', '10:00:00', '14:00:00')],
  }),
  short: act('act-short', '2026-09-10', 'Pool afternoon', '12:00:00', '15:00:00', {
    staffAssigned: 1, participants: [person('p-0001', 'Liam Okafor', ['gs-2'])], staff: [staffRow('r4', 's-0003', "Jack O'Sullivan", '12:00:00', '15:00:00')], findings: [short],
  }),
  finding: act('act-finding', '2026-09-11', 'Movie matinee', '13:00:00', '16:00:00', {
    staffAssigned: 2, staffNeeded: 2, participants: [person('p-0001', 'Liam Okafor', ['gs-3'])],
    staff: [staffRow('r5', 's-0004', 'Mei Zhang', '13:00:00', '16:00:00')],
    findings: [{ code: 'DOUBLE_BOOKED_SHIFT', severity: 'Warning', message: "Also on Grace Palmer-Hughes's shift at this time.", requiresReason: false }],
  }),
  differ: act('act-differ', '2026-09-07', 'Art class with a long name that must truncate', '10:00:00', '13:00:00', {
    staffAssigned: 1, staffNeeded: 1, participants: [person('p-0001', 'Liam Okafor', ['gs-4'], { timesDiffer: true, agreementStartTime: '09:00:00', agreementEndTime: '13:00:00' })], staff: [staffRow('r6', 's-0003', "Jack O'Sullivan", '10:00:00', '13:00:00')],
  }),
  draft: act('act-draft', '2026-09-12', 'Picnic', '11:00:00', '15:00:00', { status: 'Draft', staffAssigned: 0, staffNeeded: 2, participants: [person('p-0001', 'Liam Okafor', ['gs-5'])], findings: [{ ...short, message: '2 more staff needed.' }] }),
  cancelled: act('act-cancelled', '2026-09-08', 'Swim', '09:00:00', '11:00:00', { status: 'Cancelled', staffAssigned: 0, staffNeeded: 0, participants: [person('p-0001', 'Liam Okafor', ['gs-6'])] }),
}
const ALL = Object.values(A)
const ATTACHED = [
  shiftOf('gs-1', 'p-0001', 'Liam Okafor', '2026-09-09', '10:00:00', '14:00:00', { groupActivityId: 'act-normal' }),
  shiftOf('gs-2', 'p-0001', 'Liam Okafor', '2026-09-10', '12:00:00', '15:00:00', { groupActivityId: 'act-short' }),
  shiftOf('gs-3', 'p-0001', 'Liam Okafor', '2026-09-11', '13:00:00', '16:00:00', { groupActivityId: 'act-finding' }),
  shiftOf('gs-4', 'p-0001', 'Liam Okafor', '2026-09-07', '10:00:00', '13:00:00', { groupActivityId: 'act-differ' }),
  shiftOf('gs-5', 'p-0001', 'Liam Okafor', '2026-09-12', '11:00:00', '15:00:00', { groupActivityId: 'act-draft', status: 'Draft' }),
  shiftOf('gs-6', 'p-0001', 'Liam Okafor', '2026-09-08', '09:00:00', '11:00:00', { groupActivityId: 'act-cancelled', status: 'Cancelled' }),
]
const GRACE = [
  shiftOf('gs-1b', 'p-0004', 'Grace Palmer-Hughes', '2026-09-09', '10:00:00', '14:00:00', { groupActivityId: 'act-normal' }),
  shiftOf('gl-1', 'p-0004', 'Grace Palmer-Hughes', '2026-09-07', '10:00:00', '13:00:00', { isGroupLine: true, staffId: 's-0003', staffName: "Jack O'Sullivan" }),
  shiftOf('gl-2', 'p-0004', 'Grace Palmer-Hughes', '2026-09-10', '09:00:00', '13:00:00', { isGroupLine: true }),
]
const PLAIN = shiftOf('plain-1', 'p-0001', 'Liam Okafor', '2026-09-08', '09:00:00', '13:00:00', { staffId: 's-0003', staffName: "Jack O'Sullivan" })

async function openBoard(browser, { width, height, touch, flag = true, theme, onGroupPost, activities = ALL }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route('**/api/v1/rostering/board*', async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data?.groupBy === 'Participant' && body.data.weekStart === WEEK) {
      const liam = body.data.participantRows.find((x) => x.participantId === 'p-0001')
      const grace = body.data.participantRows.find((x) => x.participantId === 'p-0004')
      liam.shifts = [PLAIN, ...ATTACHED]
      grace.shifts = [...grace.shifts, ...GRACE]
      body.data.groupActivitiesEnabled = flag
      body.data.groupActivities = flag ? activities : []
    }
    await r.fulfill({ response, json: body })
  })
  await page.route('**/api/v1/rostering/group-activities/**', async (r) => {
    const req = r.request()
    const url = new URL(req.url())
    const id = url.pathname.split('/').find((_, i, a) => a[i - 1] === 'group-activities')
    if (req.method() === 'GET') {
      if (page.__activityGet) return page.__activityGet(r, id)
      const found = ALL.find((a) => a.id === id)
      return r.fulfill({ json: envelope(found) })
    }
    if (onGroupPost) return onGroupPost(r)
    return r.fulfill({ json: envelope(ALL.find((a) => a.id === id) ?? ALL[0]) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/rostering?date=${WEEK}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
  if (theme === 'dark') await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  return { context, page, errors }
}

const px = (page, locator) => locator.evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })
const controlH = (page) => page.evaluate(() => { const p = document.createElement('div'); p.style.height = 'var(--control-h)'; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h })
const shot = async (page, locator, file, opts = {}) => {
  await locator.scrollIntoViewIfNeeded().catch(() => {})
  const crop = await cropElement(page, locator, path.join(OUT_DIR, file), opts)
  checks.push(checkCropHolds({ ...crop, touch: opts.touch ?? crop.touch }))
  return crop
}
const scene = async (name, fn) => { try { await fn() } catch (e) { check(`${name}: scene ran`, false, String(e.message).split('\n')[0]) } }

// WCAG ratio of two colours read from tokens in the page's current theme.
const contrastPairs = (page) => page.evaluate(() => {
  const probe = document.createElement('div'); document.body.append(probe)
  const rgb = (token) => { probe.style.color = `var(${token})`; const m = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number); return m.slice(0, 3) }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const out = [
    ['foreground on fill', '--color-foreground', '--color-activity-container', 4.5],
    ['muted-foreground on fill', '--color-muted-foreground', '--color-activity-container', 3],
    ['on-warning-container on fill', '--color-on-warning-container', '--color-activity-container', 4.5],
    ['on-activity-container on fill', '--color-on-activity-container', '--color-activity-container', 3],
    ['on-activity-container on card', '--color-on-activity-container', '--color-card', 3],
    ['ring on fill', '--color-ring', '--color-activity-container', 3],
  ].map(([name, fg, bg, floor]) => ({ name, value: Math.round(ratio(fg, bg) * 100) / 100, floor }))
  probe.remove()
  return { fill: getComputedStyle(document.documentElement).getPropertyValue('--color-activity-container').trim(), out }
})

const browser = await chromium.launch({ headless: true })
let offOverhang = null

// ── 1280 fine pointer: the board ──────────────────────────────────────────────────────────────────────────────
await scene('board-1280', async () => {
  const { context, page, errors } = await openBoard(browser, { width: 1280, height: 900, touch: false })
  const cards = page.locator('[data-activity-card]')
  await cards.first().waitFor({ state: 'visible', timeout: 30_000 })
  const ch = await controlH(page)
  const chip = await px(page, page.locator('[data-shift-chip="plain-1"]'))
  const normal = page.locator('[data-activity-card="act-normal"]').first()
  const box = await px(page, normal)
  check('1 card height == plain ShiftChip height (fine, 56)', box.h === chip.h && box.h === 56, { card: box.h, chip: chip.h })
  const drop = await px(page, normal.locator('[data-activity-drop]'))
  check('2 drop chip height == --control-h (fine)', drop.h === ch, { drop: drop.h, controlH: ch })
  const fit = await cards.evaluateAll((els) => els.map((el) => {
    const count = el.querySelector('[data-activity-count]'), title = el.querySelector('[data-activity-title]')
    const range = title.previousElementSibling && title.parentElement.firstElementChild
    return { id: el.dataset.activityCard, count: [count.scrollWidth, count.clientWidth], range: [range.scrollWidth, range.clientWidth], titleEllipsis: title.scrollWidth > title.clientWidth }
  }))
  check('3 count cell and time not clipped on every card', fit.every((f) => f.count[0] <= f.count[1] && f.range[0] <= f.range[1]), fit)
  check('3 the long title truncates (ellipsis) while the time stays whole', fit.find((f) => f.id === 'act-differ')?.titleEllipsis === true, fit.find((f) => f.id === 'act-differ'))
  check('no page errors on the board', errors.length === 0, errors)

  // board-normal, row crop with two cards and a chip (Liam's row), light then dark
  const row = normal.locator('xpath=ancestor::*[count(.//*[@data-activity-card]) >= 2][1]')
  await shot(page, row, 'board-normal-1280.png', { pad: 16 })
  await shot(page, page.locator('[data-activity-card="act-short"]').first(), 'board-staff-short.png')
  await shot(page, page.locator('[data-activity-card="act-finding"]').first(), 'board-finding.png')
  await shot(page, page.locator('[data-activity-card="act-differ"]').first(), 'board-times-differ.png')
  await shot(page, page.locator('[data-activity-card="act-draft"]').first(), 'board-draft.png')
  await shot(page, page.locator('[data-activity-card="act-cancelled"]').first(), 'board-cancelled.png')
  const light = await contrastPairs(page)
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForTimeout(300)
  const dark = await contrastPairs(page)
  check('9 dark theme is applied (fill token changed)', light.fill !== dark.fill, { light: light.fill, dark: dark.fill })
  for (const [theme, r] of [['light', light], ['dark', dark]]) for (const p of r.out) check(`9 contrast ${theme}: ${p.name} >= ${p.floor}`, p.value >= p.floor, p.value)
  await shot(page, row, 'board-normal-dark-1280.png')
  await page.evaluate(() => { delete document.documentElement.dataset.theme })

  // The New menu
  const newBtn = page.getByRole('button', { name: 'New', exact: true }).first()
  await newBtn.click()
  const options = await page.getByRole('option').allTextContents()
  check('newmenu: Shift, Trip, Group activity', JSON.stringify(options) === JSON.stringify(['Shift', 'Trip', 'Group activity']), options)
  await shot(page, page.getByRole('listbox').first(), 'newmenu-open.png', { also: newBtn })
  await page.keyboard.press('Escape')

  // Carrying: the card's text must not move and the day slot must not cover the card. Mei is not on Pool afternoon, so the drop is a real join.
  const target = page.locator('[data-activity-card="act-short"]').first()
  const strip = page.getByRole('button', { name: /^Mei Zhang,/ }).first()
  const textX = (el) => { const c = el.getBoundingClientRect(); return { title: el.querySelector('[data-activity-title]').getBoundingClientRect().left - c.left, count: el.querySelector('[data-activity-count]').getBoundingClientRect().left - c.left, cardLeft: c.left, cardWidth: c.width } }
  const before = await target.evaluate(textX)
  const s = await strip.boundingBox()
  const dropBox = () => target.locator('[data-activity-drop]').boundingBox()
  let d = await dropBox()
  // The puck is grabbed at its top-left and let hover at the chip's bottom-right corner, so the carried overlay trails away from the card and the ring and card stay in view.
  const corner = () => ({ x: d.x + d.width - 3, y: d.y + d.height - 3 })
  await page.mouse.move(s.x + 3, s.y + 3)
  await page.mouse.down()
  await page.mouse.move(s.x + 11, s.y + 3, { steps: 4 })
  await page.mouse.move(corner().x, corner().y, { steps: 20 })
  await page.waitForTimeout(300)
  const during = await target.evaluate((el) => {
    const c = el.getBoundingClientRect()
    let p = el.parentElement
    while (p && !p.querySelector('[data-day-slot]')) p = p.parentElement
    const slot = p ? p.querySelector('[data-day-slot]') : null
    const sb = slot ? slot.getBoundingClientRect() : null
    return { title: el.querySelector('[data-activity-title]').getBoundingClientRect().left - c.left, count: el.querySelector('[data-activity-count]').getBoundingClientRect().left - c.left, cardLeft: c.left, cardWidth: c.width, overlap: sb ? !(sb.right <= c.left || sb.left >= c.right || sb.bottom <= c.top || sb.top >= c.bottom) : false, hasSlot: Boolean(slot) }
  })
  check('4 carrying: card text x unchanged inside the card (title, count offsets from the card edge)', during.title === before.title && during.count === before.count, { before, during })
  check('4 carrying: the day slot does not overlap the card', !during.overlap, during)
  // cropElement parks the mouse to settle, so the hover is restored inside `during` just before the shot.
  const crop = await cropElement(page, target, path.join(OUT_DIR, 'drop-hover.png'), {
    during: async () => { d = await dropBox(); await page.mouse.move(corner().x, corner().y, { steps: 6 }); await page.waitForTimeout(250) },
  })
  checks.push(checkCropHolds(crop))
  const ring = await target.locator('[data-activity-drop]').evaluate((el) => getComputedStyle(el).boxShadow)
  check('drop-hover: the drop chip draws the ring', ring && ring !== 'none', ring)
  await page.mouse.up()
  await context.close()
})

// ── drop-pending and drop-conflict ────────────────────────────────────────────────────────────────────────────
for (const mode of ['pending', 'conflict']) {
  await scene(`drop-${mode}`, async () => {
    let release
    const gate = new Promise((res) => { release = res })
    const { context, page } = await openBoard(browser, {
      width: 1280, height: 900, touch: false,
      onGroupPost: async (r) => {
        if (mode === 'pending') { await gate; return r.fulfill({ json: envelope(A.normal) }) }
        return r.fulfill({ status: 400, json: { success: false, data: null, message: 'Mei Zhang is already on a shift at this time.', errors: ['Mei Zhang is already on a shift at this time.'] } })
      },
    })
    const card = page.locator('[data-activity-card="act-short"]').first()
    await card.waitFor({ state: 'visible', timeout: 30_000 })
    const s = await page.getByRole('button', { name: /^Mei Zhang,/ }).first().boundingBox()
    const d = await card.locator('[data-activity-drop]').boundingBox()
    await page.mouse.move(s.x + s.width / 2, s.y + s.height / 2)
    await page.mouse.down()
    await page.mouse.move(s.x + s.width / 2 + 8, s.y + s.height / 2, { steps: 4 })
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2, { steps: 20 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    if (mode === 'pending') {
      const text = await card.locator('[data-activity-count]').textContent()
      check('drop-pending: the count cell reads Adding Mei…', /Adding Mei/.test(text ?? ''), text)
      await shot(page, card, 'drop-pending.png')
      release()
    } else {
      const callout = page.getByText('Mei Zhang is already on a shift at this time.').first()
      await callout.waitFor({ state: 'visible', timeout: 10_000 })
      check('drop-conflict: the server message shows in the write-error callout', await callout.isVisible())
      await shot(page, callout.locator('xpath=ancestor::*[@role="alert" or @role="status"][1]').first(), 'drop-conflict.png')
    }
    await context.close()
  })
}

// ── Modal states at 1280 ──────────────────────────────────────────────────────────────────────────────────────
const modalChecks = async (page, tag, widthExpected) => {
  const dlg = page.getByRole('dialog').first()
  const panel = await px(page, dlg)
  const cols = await dlg.locator('section[aria-label]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
  if (widthExpected) {
    check(`5 ${tag}: modal panel == max-w-4xl (896)`, Math.abs(panel.w - 896) <= 1, panel.w)
    check(`5 ${tag}: three columns of 272 +-1`, cols.length === 3 && cols.every((w) => Math.abs(w - 272) <= 1), cols)
  }
  return dlg
}
await scene('modal-1280', async () => {
  const { context, page } = await openBoard(browser, { width: 1280, height: 900, touch: false })
  const card = page.locator('[data-activity-card="act-normal"]').first()
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  await card.locator('[data-activity-open]').click()
  await page.getByRole('heading', { name: /Staff · 3 of 3/ }).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(600) // the open animation scales the panel for a moment
  const dlg = await modalChecks(page, 'modal-normal', true)
  const titleFocus = await page.evaluate(() => document.activeElement?.getAttribute('id') || document.activeElement?.tagName)
  console.log('[group-activities] focus on open:', titleFocus)
  await shot(page, dlg, 'modal-normal.png', { pad: 16 })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForTimeout(300)
  await shot(page, dlg, 'modal-normal-dark.png', { pad: 16 })
  await page.evaluate(() => { delete document.documentElement.dataset.theme })
  // S1: the time inputs hold their widest values at 1280. The native clock icon covers the text tail, which scrollWidth cannot see:
  // measured text + left and right padding + 28 px for the icon must fit the clientWidth.
  for (const [i, label, value, text] of [[0, 'Start', '14:00', '02:00 PM'], [1, 'End', '09:00', '09:00 AM']]) {
    const input = dlg.locator('input[type=time]').nth(i)
    await input.fill(value)
    const fit = await input.evaluate((el, t) => {
      const cs = getComputedStyle(el)
      const ctx = document.createElement('canvas').getContext('2d')
      ctx.font = cs.font
      const need = ctx.measureText(t).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 28
      return [Math.ceil(need), el.clientWidth]
    }, text)
    check(`S1 time input ${label} shows ${text} clear of the icon at 1280 (need <= clientWidth)`, fit[0] <= fit[1], fit)
  }
  await page.keyboard.press('Escape')
  await context.close()
})
await scene('modal-new-empty', async () => {
  const { context, page } = await openBoard(browser, { width: 1280, height: 900, touch: false })
  await page.getByRole('button', { name: 'New', exact: true }).first().click()
  await page.getByRole('option', { name: 'Group activity' }).click()
  const dlg = page.getByRole('dialog', { name: 'New group activity' })
  await dlg.waitFor({ timeout: 10_000 })
  await shot(page, dlg, 'modal-new-empty.png')
  await context.close()
})
await scene('modal-staff-short', async () => {
  const { context, page } = await openBoard(browser, { width: 1280, height: 900, touch: false })
  await page.locator('[data-activity-card="act-short"] [data-activity-open]').first().click()
  const dlg = page.getByRole('dialog').first()
  await dlg.getByText('2 more staff needed.').first().waitFor({ timeout: 10_000 })
  await shot(page, dlg, 'modal-staff-short.png')
  await context.close()
})
await scene('modal-cancelled', async () => {
  const { context, page } = await openBoard(browser, { width: 1280, height: 900, touch: false })
  await page.locator('[data-activity-card="act-cancelled"] [data-activity-open]').first().click()
  const dlg = page.getByRole('dialog').first()
  await dlg.getByText('Cancelled').first().waitFor({ timeout: 10_000 })
  await shot(page, dlg, 'modal-cancelled.png')
  await context.close()
})
await scene('modal-loading', async () => {
  const { context, page } = await openBoard(browser, { width: 1280, height: 900, touch: false })
  let release
  const gate = new Promise((res) => { release = res })
  page.__activityGet = async (r) => { await gate; r.fulfill({ json: envelope(A.normal) }) }
  await page.locator('[data-activity-card="act-normal"] [data-activity-open]').first().click()
  const dlg = page.getByRole('dialog').first()
  await dlg.waitFor({ timeout: 10_000 })
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important}' }) // a spinner never settles; the frozen frame is the capture
  await page.waitForTimeout(300)
  await shot(page, dlg, 'modal-loading.png')
  release()
  await context.close()
})
await scene('modal-error', async () => {
  const { context, page } = await openBoard(browser, { width: 1280, height: 900, touch: false })
  page.__activityGet = (r) => r.fulfill({ status: 500, json: { success: false, data: null, message: 'boom', errors: ['boom'] } })
  await page.locator('[data-activity-card="act-normal"] [data-activity-open]').first().click()
  const dlg = page.getByRole('dialog').first()
  await dlg.getByText("Couldn't load this activity.").waitFor({ timeout: 15_000 })
  await shot(page, dlg, 'modal-error.png')
  await context.close()
})
await scene('board-flag-off', async () => {
  const { context, page } = await openBoard(browser, { width: 1280, height: 1300, touch: false, flag: false })
  const n = await page.locator('[data-activity-card]').count()
  check('board-flag-off: no activity card', n === 0, n)
  await page.getByRole('button', { name: 'New', exact: true }).first().click()
  const options = await page.getByRole('option').allTextContents()
  check('board-flag-off: New menu keeps two items', options.length === 2, options)
  await page.keyboard.press('Escape')
  const off = await fullPage(page, path.join(OUT_DIR, 'full', 'board-flag-off-1280.png'))
  checks.push(...off.checks.filter((c) => !c.name.startsWith('full page not truncated')))
  offOverhang = off.checks.find((c) => c.name.startsWith('full page not truncated')).detail
  await context.close()
})
await scene('full-1280', async () => {
  const { context, page } = await openBoard(browser, { width: 1280, height: 1300, touch: false })
  await page.locator('[data-activity-card]').first().waitFor({ timeout: 30_000 })
  const on = await fullPage(page, path.join(OUT_DIR, 'full', 'board-1280.png'))
  checks.push(...on.checks.filter((c) => !c.name.startsWith('full page not truncated')))
  const d = on.checks.find((c) => c.name.startsWith('full page not truncated')).detail
  check('full page overhang equals the flag-off board (the shell, not the feature)', offOverhang && d.scrollHeight - d.viewportHeight === offOverhang.scrollHeight - offOverhang.viewportHeight, { on: d, off: offOverhang })
  await context.close()
})

// ── 390 touch ───────────────────────────────────────────────────────────────────────────────────────────────────
await scene('touch-390', async () => {
  const { context, page } = await openBoard(browser, { width: 390, height: 844, touch: true })
  const card = page.locator('[data-activity-card="act-normal"]').first()
  await card.waitFor({ state: 'visible', timeout: 30_000 })
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  check('390: pointer is coarse', coarse)
  const ch = await controlH(page)
  const chip = await px(page, page.locator('[data-shift-chip="plain-1"]'))
  const box = await px(page, card)
  check('1 card height == plain ShiftChip height (coarse, 68)', box.h === chip.h && box.h === 68, { card: box.h, chip: chip.h })
  const drop = await px(page, card.locator('[data-activity-drop]'))
  check('2 drop chip height == --control-h (coarse)', drop.h === ch, { drop: drop.h, controlH: ch })
  await shot(page, card, 'board-normal-390.png', { touch: true })
  await shot(page, card.locator('xpath=ancestor::*[count(.//*[@data-activity-card]) >= 2][1]'), 'board-row-390.png', { touch: true })

  await scene('modal-390', async () => {
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150) }
  // modal at 390
  await card.locator('[data-activity-open]').click({ timeout: 8000 }).catch(async (e) => { console.log('[group-activities] 390 modal click debug:', JSON.stringify(await card.evaluate((el) => { const b = el.querySelector('[data-activity-open]').getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { b: [b.left, b.top, b.width, b.height], hit: h ? h.tagName + '.' + String(h.className).slice(0, 80) : null, dialogs: document.querySelectorAll('[role=dialog]').length } }))); throw e })
  const dlg = page.getByRole('dialog').first()
  await page.getByRole('heading', { name: /Staff · 3 of 3/ }).waitFor({ timeout: 10_000 })
  await page.waitForTimeout(400)
  const m = await page.evaluate(() => {
    const d = document.querySelector('[role=dialog]')
    const tops = ['Activity', 'Participants', 'Staff'].map((n) => [...d.querySelectorAll('h4')].find((h) => h.textContent.startsWith(n))?.getBoundingClientRect().top)
    return { page: [document.documentElement.scrollWidth, document.documentElement.clientWidth], panel: [d.scrollWidth, d.clientWidth], tops }
  })
  check('6 390 modal: page scrollWidth <= clientWidth', m.page[0] <= m.page[1], m.page)
  check('6 390 modal: panel scrollWidth <= clientWidth', m.panel[0] <= m.panel[1], m.panel)
  check('7 390 columns stack Activity, Participants, Staff', m.tops[0] < m.tops[1] && m.tops[1] < m.tops[2], m.tops)
  const tap = await dlg.evaluate((root) => {
    const min = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')) || 44
    const size = (el0) => { const el = (el0.type === 'checkbox' || el0.type === 'radio') ? (el0.closest('label') ?? el0) : el0; const b = el.getBoundingClientRect(); const pb = getComputedStyle(el, '::before'); const pw = parseFloat(pb.minWidth) || parseFloat(pb.width) || 0, ph = parseFloat(pb.minHeight) || parseFloat(pb.height) || 0; return [Math.max(b.width, pw), Math.max(b.height, ph)] }
    const bad = []
    for (const el of root.querySelectorAll('button, input:not([type=hidden]), select, textarea, [role=checkbox]')) {
      const b = el.getBoundingClientRect(); if (!b.width || !b.height) continue
      const [w, h] = size(el)
      if (h < min - 0.5 || (el.tagName === 'BUTTON' && w < min - 0.5)) bad.push({ el: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 30), w, h })
    }
    const ratio = root.querySelector('select[aria-label^="Ratio for"]')
    return { min, bad, ratioH: ratio ? ratio.getBoundingClientRect().height : null }
  })
  check('8 coarse: every modal control >= --tap-min both ways', tap.bad.length === 0, tap)
  check('8 coarse: Ratio select height == --control-h', tap.ratioH === ch, { ratio: tap.ratioH, controlH: ch })
  await dlg.evaluate((el) => el.scrollTo?.(0, 0))
  await shot(page, dlg, 'modal-390.png', { touch: true, natural: true })
  await shot(page, dlg.locator('section[aria-label="Participants"]'), 'modal-390-participants.png', { touch: true, natural: true })
  await shot(page, dlg.locator('section[aria-label="Staff"]'), 'modal-390-staff.png', { touch: true, natural: true, hideChrome: true })
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'modal-390.png'), { touch: true })).checks)
  })
  await context.close()
})

await scene('chooser-390', async () => {
  const { context, page } = await openBoard(browser, { width: 390, height: 844, touch: true })
  await page.locator('[data-activity-card]').first().waitFor({ state: 'visible', timeout: 30_000 })
  // chooser step 1 (same times) and step 2 (times differ) from a group-line shift's menu
  for (const [shiftId, tag] of [['gl-2', 'chooser-times-differ'], ['gl-1', 'chooser']]) {
    const chipEl = page.locator(`[data-shift-chip="${shiftId}"]`)
    await chipEl.scrollIntoViewIfNeeded()
    await chipEl.getByRole('button', { name: /^Actions for/ }).click()
    await page.getByRole('option', { name: 'Add to an activity…' }).click()
    const dlg = page.getByRole('dialog').first()
    await dlg.waitFor({ timeout: 10_000 })
    const radio = dlg.getByRole('radio').first()
    await radio.check({ force: true })
    if (tag === 'chooser') {
      await shot(page, dlg, 'chooser-390.png', { touch: true })
      const tall = await dlg.getByRole('radio').evaluateAll((els) => els.map((e) => { const l = e.closest('label') ?? e; const b = l.getBoundingClientRect(); return [b.width, b.height] }))
      check('8 chooser radios >= 44 both ways', tall.length > 0 && tall.every(([w, h]) => w >= 44 && h >= 44), tall)
    } else {
      await dlg.getByRole('button', { name: 'Continue' }).click()
      await dlg.getByText(/Agreement .*activity /).waitFor({ timeout: 10_000 })
      await shot(page, dlg, 'chooser-times-differ-390.png', { touch: true })
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
  }

  await context.close()
})
await scene('slideover-390', async () => {
  const { context, page } = await openBoard(browser, { width: 390, height: 844, touch: true })
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[group-activities] console', m.type(), m.text().slice(0, 200)) })
  page.setDefaultTimeout(8000)
  await page.locator('[data-activity-card]').first().waitFor({ state: 'visible', timeout: 30_000 })
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(150) }
  // slide-over: Make a group activity
  // the chip body nests the staff name as a link, so a centre click navigates: open it from the keyboard like the chip's own handler
  await page.locator('[data-shift-open="gl-1"]').focus()
  await page.keyboard.press('Enter')
  const make = page.getByRole('button', { name: 'Make a group activity' })
  await make.waitFor({ timeout: 10_000 }).catch(async (e) => { console.log('[group-activities] slide-over debug:', JSON.stringify({ dialogs: (await page.getByRole('dialog').allTextContents()).map((t) => t.slice(0, 160)), headings: await page.getByRole('heading').allTextContents() })); throw e })
  await make.scrollIntoViewIfNeeded()
  await shot(page, make.locator('xpath=..'), 'slideover-make-activity-390.png', { touch: true })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  await context.close()
})

await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
