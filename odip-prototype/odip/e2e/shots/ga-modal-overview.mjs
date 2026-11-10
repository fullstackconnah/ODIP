// Group activity modal, direction B (overview and drill-in): captures plus the numeric checks of SHAPE section 6. Computed boxes only; exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/ga-modal-overview.mjs <outdir>
// Pinned: the fixture week 2026-09-07 (?date=), theme dark for every state, light also for the 10 required states at 390; the mock board with activities injected through page.route.
// Files are named b-<state tokens>-<width>-<theme>.png so shots-states.js finds each state of the Capture states line.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, layoutCheck, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const WEEK = '2026-09-07'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const loginAs = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role) => envelope([{ username: 'dev.admin', role, tenantName: 'Sample Support Co' }])
const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
const shiftOf = (id, participantId, participantName, serviceDate, startTime, endTime, extra = {}) => ({
  id, participantId, participantName, serviceDate, startTime, endTime, endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...extra,
})
const staffRow = (id, staffId, staffName, startTime, endTime) => ({ id, staffId, staffName, startTime, endTime, endsNextDay: false, findings: [] })
const person = (participantId, participantName, shiftIds, extra = {}) => ({ participantId, participantName, ratio: 'OneToOne', shiftIds, timesDiffer: false, didNotAttend: false, ...extra })
const act = (id, serviceDate, title, startTime, endTime, extra = {}) => ({
  id, serviceDate, startTime, endTime, endsNextDay: false, title, status: 'Published', staffNeeded: 3, staffAssigned: 2, minStaffRequired: null, participants: [], staff: [], findings: [], ...extra,
})
const TWO = [person('p-0001', 'Liam Okafor', ['gs-1']), person('p-0004', 'Grace Palmer-Hughes', ['gs-1b'])]
const CREW = [staffRow('r1', 's-0003', "Jack O'Sullivan", '10:00:00', '14:00:00'), staffRow('r2', 's-0004', 'Mei Zhang', '10:00:00', '14:00:00')]
const A = {
  draft: act('act-draft', '2026-09-09', 'Bowling at the lanes', '10:00:00', '14:00:00', { status: 'Draft', participants: TWO, staff: CREW, notes: 'Bring towels.', minStaffRequired: 3 }),
  published: act('act-pub', '2026-09-10', 'Pool afternoon', '12:00:00', '15:00:00', { participants: [TWO[0]], staff: [CREW[0]], staffNeeded: 2, staffAssigned: 1 }),
  started: act('act-started', '2026-09-07', 'Art class with a long name that must truncate on a phone', '10:00:00', '13:00:00', { status: 'InProgress', participants: [TWO[0], { ...TWO[1], didNotAttend: true }], staff: CREW, staffAssigned: 2, staffNeeded: 2 }),
  completed: act('act-done', '2026-09-08', 'Movie matinee', '13:00:00', '16:00:00', { status: 'Completed', participants: [TWO[0], { ...TWO[1], didNotAttend: true }], staff: CREW, staffAssigned: 2, staffNeeded: 2 }),
  cancelled: act('act-cancelled', '2026-09-11', 'Swim', '09:00:00', '11:00:00', { status: 'Cancelled', participants: [TWO[0]], staffAssigned: 0, staffNeeded: 0 }),
  fresh: act('act-new', '2026-09-09', 'Picnic', '10:00:00', '14:00:00', { status: 'Draft', staffAssigned: 0, staffNeeded: 0 }),
}
const ALL = Object.values(A)
// A card renders in a participant's row only through an attached shift, so each activity gets one per person (the shift ids the people carry).
for (const a of ALL) a.participants = a.participants.map((pp, i) => ({ ...pp, shiftIds: [`${a.id}-s${i}`] }))
const attached = (pid) => ALL.flatMap((a) => a.participants.filter((pp) => pp.participantId === pid).map((pp) => shiftOf(pp.shiftIds[0], pid, pp.participantName, a.serviceDate, a.startTime, a.endTime, { groupActivityId: a.id, status: a.status === 'Cancelled' ? 'Cancelled' : 'Published' })))
const PLAIN = shiftOf('plain-1', 'p-0001', 'Liam Okafor', '2026-09-08', '09:00:00', '13:00:00', { staffId: 's-0003', staffName: "Jack O'Sullivan", isGroupLine: true })
const warning = { success: false, message: 'Warnings need a reason.', errors: [], data: [{ code: 'STAFF_ON_LEAVE', severity: 'Warning', requiresReason: true, message: 'Mei Zhang is on leave.' }] }

async function openBoard(browser, { width, height, touch, theme = 'dark', role = 'Admin' }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message)))
  page.mode = {}   // per-scene switches: getDelay, getFail, postStatus, postBody
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: loginAs(role) }))
  await page.route('**/api/v1/rostering/board*', async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data?.groupBy === 'Participant' && body.data.weekStart === WEEK) {
      const liam = body.data.participantRows.find((x) => x.participantId === 'p-0001')
      const grace = body.data.participantRows.find((x) => x.participantId === 'p-0004')
      liam.shifts = [PLAIN, ...attached('p-0001')]
      grace.shifts = [...grace.shifts, ...attached('p-0004')]
      body.data.groupActivitiesEnabled = true
      body.data.groupActivities = ALL
    }
    await r.fulfill({ response, json: body })
  })
  await page.route('**/api/v1/rostering/group-activities/**', async (r) => {
    const req = r.request()
    const id = new URL(req.url()).pathname.split('/').find((_, i, a) => a[i - 1] === 'group-activities')
    if (req.method() === 'GET') {
      if (page.mode.getFail) return r.fulfill({ status: 500, json: { success: false, message: 'down', errors: [] } })
      if (page.mode.getDelay) await new Promise((f) => setTimeout(f, page.mode.getDelay))
      return r.fulfill({ json: envelope(ALL.find((a) => a.id === id) ?? A.fresh) })
    }
    if (page.mode.postDelay) await new Promise((f) => setTimeout(f, page.mode.postDelay))
    if (page.mode.post) return r.fulfill({ status: page.mode.post.status, json: page.mode.post.body })
    return r.fulfill({ json: envelope(ALL.find((a) => a.id === id) ?? A.fresh) })
  })
  await page.route('**/api/v1/rostering/group-activities', async (r) => {
    if (r.request().method() !== 'POST') return r.fallback()
    if (page.mode.postDelay) await new Promise((f) => setTimeout(f, page.mode.postDelay))
    if (page.mode.post) return r.fulfill({ status: page.mode.post.status, json: page.mode.post.body })
    return r.fulfill({ json: envelope(A.fresh) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/rostering?date=${WEEK}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
  await page.evaluate((t) => { document.documentElement.dataset.theme = t }, theme)
  return { context, page, errors }
}

const sheet = (page) => page.getByRole('dialog').first()
const openNew = async (page) => {
  await page.getByRole('button', { name: 'New', exact: true }).first().click()
  await page.getByRole('option', { name: 'Group activity' }).click()
  await page.getByRole('dialog', { name: 'New group activity' }).waitFor({ timeout: 10_000 })
}
const openEdit = async (page, key) => {
  await page.locator(`[data-activity-card="${A[key].id}"] [data-activity-open]`).first().click({ timeout: 10_000 })
  await sheet(page).getByRole('heading', { level: 2 }).first().waitFor({ timeout: 10_000 })
}
const openFromShift = async (page) => {
  await page.locator('[data-shift-open="plain-1"]').focus()
  await page.keyboard.press('Enter')
  await page.getByRole('button', { name: 'Make a group activity' }).click({ timeout: 10_000 })
  await page.getByRole('dialog', { name: 'New group activity' }).waitFor({ timeout: 10_000 })
}
/** A row of the overview opens its page (the 390 layout); from 1440 the column and page are both shown, so the click only changes the page. */
const goRow = async (page, name) => { await sheet(page).locator('[data-overview-row]').filter({ hasText: name }).first().click(); await page.waitForTimeout(350) }
const press = async (page, name) => { await sheet(page).getByRole('button', { name, exact: true }).first().click(); await page.waitForTimeout(350) }

// ── Numeric checks (SHAPE section 6) ──────────────────────────────────────────────────────────────────────────────────────
const tokens = (page) => page.evaluate(() => {
  const px = (v) => { const p = document.createElement('div'); p.style.height = v; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h }
  return { controlH: px('var(--control-h)'), controlHSm: px('var(--control-h-sm)'), tapMin: px('var(--tap-min)'), rowH: px('var(--row-h)') }
})
const audit = async (page, label, { touch }) => {
  const t = await tokens(page)
  const dlg = sheet(page)
  const r = await dlg.evaluate((root, tk) => {
    const vis = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]') }
    const eff = (el) => {
      const target = el.matches('input[type=checkbox],input[type=radio]') && el.closest('label') ? el.closest('label') : el
      const b = target.getBoundingClientRect()
      const before = getComputedStyle(el, '::before')
      const w = before.position === 'absolute' ? parseFloat(before.width) || 0 : 0
      const h = before.position === 'absolute' ? parseFloat(before.height) || 0 : 0
      return { w: Math.max(b.width, w), h: Math.max(b.height, h), box: b }
    }
    const els = [...root.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=option]')].filter(vis)
    const under = els.filter((el) => { const e = eff(el); return e.h < tk.tapMin - 0.5 || e.w < tk.tapMin - 0.5 }).map((el) => `${el.tagName}:${(el.getAttribute('aria-label') || el.textContent || el.name || '').trim().slice(0, 30)}`)
    const field = els.filter((el) => el.matches('input:not([type=checkbox]):not([type=radio]):not([type=search]), select')).map((el) => Math.round(el.getBoundingClientRect().height * 10) / 10)
    const buttons = els.filter((el) => el.matches('button') && !el.matches('[data-overview-row]') && !el.closest('li') && el.textContent.trim().length > 0 && !el.closest('[role=option]')).map((el) => ({ name: el.textContent.trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height * 10) / 10, hit: Math.round(eff(el).h * 10) / 10 }))
    const rows = [...root.querySelectorAll('[data-overview-row]')].filter(vis).map((el) => Math.round(el.getBoundingClientRect().height * 10) / 10)
    const pick = [...root.querySelectorAll('ul button')].filter((el) => vis(el) && !el.hasAttribute('data-overview-row')).map((el) => Math.round(el.getBoundingClientRect().height * 10) / 10)
    const doc = document.scrollingElement
    return { under, field, buttons, rows, pick, scrollW: doc.scrollWidth, clientW: doc.clientWidth }
  }, t)
  const md = Math.max(t.controlH, t.tapMin), sm = t.controlHSm, row = Math.max(t.rowH, t.tapMin)
  check(`${label}: no horizontal scroll (scrollWidth == clientWidth)`, r.scrollW === r.clientW, { scrollW: r.scrollW, clientW: r.clientW })
  if (touch) check(`${label}: 0 interactive targets under --tap-min (${t.tapMin})`, r.under.length === 0, r.under)
  check(`${label}: input and select height == max(--control-h, --tap-min) (${md})`, r.field.every((h) => h === md), r.field)
  const buttonOk = (b) => b.h === md || (b.h === sm && (!touch || b.hit >= t.tapMin - 0.5))   // small: box == --control-h-sm, TAP_AREA hit area >= --tap-min at touch
  check(`${label}: buttons == ${md}, or small == ${sm} with a hit area >= ${t.tapMin}`, r.buttons.every(buttonOk), r.buttons.filter((b) => !buttonOk(b)))
  check(`${label}: overview and picker rows >= max(--row-h, --tap-min) (${row})`, r.rows.concat(r.pick).every((h) => h >= row - 0.5), { rows: r.rows, pick: r.pick })
}

const shot = async (page, name, { touch, light } = {}) => {
  const file = path.join(OUT_DIR, `${name}.png`)
  const crop = await cropElement(page, sheet(page), file, { touch })
  checks.push(checkCropHolds({ ...crop, touch: touch ?? crop.touch }))
  return crop
}

// ── Polish batch 71 checks (computed styles; each fails on the code before the batch) ─────────────────────────────────────
// Back to draft is a secondary sm Button: --control-h-sm tall, a --tap-min hit area at touch, and a border and text colour the "Workers can see it" hint lacks (GMR-F3; ghost was plain muted text on a mouse).
const backToDraft = async (page, label, { touch }) => {
  const t = await tokens(page)
  const r = await sheet(page).evaluate((root) => {
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Back to draft')
    const hint = [...root.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Workers can see it')
    const cs = getComputedStyle(btn), hs = getComputedStyle(hint), before = getComputedStyle(btn, '::before')
    return { h: btn.getBoundingClientRect().height, hit: before.position === 'absolute' ? parseFloat(before.height) || 0 : 0, border: parseFloat(cs.borderTopWidth), color: cs.color, hintColor: hs.color, hintBorder: parseFloat(hs.borderTopWidth) }
  })
  check(`${label}: Back to draft box >= --control-h-sm (${t.controlHSm})`, r.h >= t.controlHSm - 0.5, r.h)
  if (touch) check(`${label}: Back to draft hit area >= --tap-min (${t.tapMin})`, Math.max(r.h, r.hit) >= t.tapMin - 0.5, { h: r.h, hit: r.hit })
  check(`${label}: Back to draft has a border and a text colour unlike the hint's`, r.border >= 1 && r.hintBorder === 0 && r.color !== r.hintColor, r)
}

// Below lg the overview column is the dialog's own ground (--color-card), the same as the page pushed over it (GMR-F4). The seam only exists where the two tokens differ, so that is asserted too.
const overviewGround = async (page, label) => {
  const read = () => sheet(page).evaluate((dlg) => {
    const probe = document.createElement('div'); document.body.append(probe)
    const tok = (name) => { probe.style.backgroundColor = `var(${name})`; return getComputedStyle(probe).backgroundColor }
    const r = { dialog: getComputedStyle(dlg).backgroundColor, card: tok('--color-card'), low: tok('--color-surface-container-low') }
    probe.remove()
    const aside = dlg.querySelector('aside[aria-label="Overview"]'), pushed = dlg.querySelector('section.ga-push')
    return { ...r, aside: aside && getComputedStyle(aside).backgroundColor, pushed: pushed && getComputedStyle(pushed).backgroundColor }
  })
  const overview = await read()
  await goRow(page, 'People')   // the push: the overview leaves, the page takes the dialog
  const page2 = await read()
  check(`${label}: narrow overview ground == the pushed page ground == --color-card`, overview.aside === page2.pushed && overview.aside === overview.card && page2.pushed === page2.card, { overview, page2 })
  check(`${label}: --color-card differs from --color-surface-container-low in this theme (the seam check is not vacuous)`, overview.card !== overview.low, overview)
}

// Cancel activity is ghost-danger. On a mouse its fill is transparent at rest; under touch the house variant keeps its --color-error-container wash on (pointer-coarse, buttonClasses.ts), and hover cannot stick there (GMR-F5).
const cancelFill = async (page, label, { touch }) => {
  if (!touch) { await page.mouse.move(0, 0); await page.waitForTimeout(250) }   // the open click leaves the pointer over the board; background-color transitions 100 ms
  const r = await sheet(page).evaluate((dlg) => {
    const btn = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel activity')
    const probe = document.createElement('div'); document.body.append(probe); probe.style.backgroundColor = 'var(--color-error-container)'
    const wash = getComputedStyle(probe).backgroundColor; probe.remove()
    return { bg: getComputedStyle(btn).backgroundColor, wash, coarse: matchMedia('(pointer: coarse)').matches, canHover: matchMedia('(hover: hover)').matches, hovered: btn.matches(':hover') }
  })
  if (touch) check(`${label}: Cancel activity under touch (hover: none) carries the pointer-coarse --color-error-container wash`, r.coarse && !r.canHover && !r.hovered && r.bg === r.wash, r)
  else check(`${label}: Cancel activity on a mouse is transparent at rest`, !r.coarse && !r.hovered && r.bg === 'rgba(0, 0, 0, 0)', r)
}

// WCAG ratios by pixel-free token sampling in the current theme: text on the card and on the overview fill, and the non-text marks.
const contrast = (page) => page.evaluate(() => {
  const probe = document.createElement('div'); document.body.append(probe)
  const rgb = (token) => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color.match(/[\d.]+/g).map(Number).slice(0, 3) }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100 }
  const pairs = [
    ['foreground on card', '--color-foreground', '--color-card', 4.5], ['muted on card', '--color-muted-foreground', '--color-card', 4.5],
    ['foreground on overview fill', '--color-foreground', '--color-surface-container-low', 4.5], ['muted on overview fill', '--color-muted-foreground', '--color-surface-container-low', 4.5],
    ['on-warning on warning fill (short chip)', '--color-on-warning-container', '--color-warning-container', 4.5],
    ['step disc: on-activity on activity fill', '--color-on-activity-container', '--color-activity-container', 4.5],
    ['non-text: current-row edge (primary) on card', '--color-primary', '--color-card', 3], ['non-text: step ring (muted) on overview fill', '--color-muted-foreground', '--color-surface-container-low', 3],
    ['non-text: field border on card', '--color-field-border', '--color-card', 3],
  ].map(([name, fg, bg, floor]) => ({ name, value: ratio(fg, bg), floor }))
  probe.remove()
  return pairs
})

// ── States ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// light: also captured in the light theme at 390 (the 10 required states).
const STATES = [
  { name: 'create-empty', light: true, run: async (p) => { await openNew(p) } },
  { name: 'create-filled', light: true, run: async (p) => { await openNew(p); await sheet(p).getByLabel(/Title/).fill('Bowling at the lanes') } },
  { name: 'validation-error', light: true, run: async (p) => { await openNew(p); await sheet(p).getByLabel('End *').fill('09:00'); await press(p, 'Create draft') } },
  { name: 'saving', run: async (p) => { p.mode.postDelay = 6000; await openNew(p); await sheet(p).getByLabel(/Title/).fill('Picnic'); await sheet(p).getByRole('button', { name: 'Create draft' }).click(); await sheet(p).getByRole('button', { name: 'Creating…' }).waitFor() } },
  { name: 'server-error-on-save', light: true, run: async (p) => { p.mode.post = { status: 500, body: { success: false, message: 'The connection dropped.', errors: [] } }; await openNew(p); await sheet(p).getByLabel(/Title/).fill('Picnic'); await press(p, 'Create draft'); await sheet(p).getByText(/Couldn't save/).waitFor() } },
  { name: 'from-a-shift', light: true, run: async (p) => { await openFromShift(p); await sheet(p).getByLabel(/Title/).fill('Pool') } },
  { name: 'edit-draft-overview', light: true, wide: false, run: async (p) => { await openEdit(p, 'draft') }, measure: (p, label) => overviewGround(p, label) },
  { name: 'edit-draft-people', wide: true, run: async (p) => { await openEdit(p, 'draft') } },
  { name: 'edit-published', light: true, run: async (p) => { await openEdit(p, 'published') }, measure: backToDraft },
  { name: 'started', light: true, run: async (p) => { await openEdit(p, 'started') }, measure: cancelFill },
  { name: 'completed', run: async (p) => { await openEdit(p, 'completed') } },
  { name: 'cancelled', run: async (p) => { await openEdit(p, 'cancelled') } },
  { name: 'loading', run: async (p) => { p.mode.getDelay = 8000; await p.emulateMedia({ reducedMotion: 'reduce' }); await p.addStyleTag({ content: '*, *::before, *::after { animation: none !important }' }); await p.locator(`[data-activity-card="${A.draft.id}"] [data-activity-open]`).first().click(); await sheet(p).locator('[aria-busy=true]').first().waitFor() } },
  { name: 'load-failed', run: async (p) => { p.mode.getFail = true; await p.locator(`[data-activity-card="${A.draft.id}"] [data-activity-open]`).first().click(); await sheet(p).getByText("Couldn't load this activity.").waitFor() } },
  { name: 'people', light: true, run: async (p) => { await openEdit(p, 'draft'); await goRow(p, 'People') } },
  { name: 'staff', light: true, run: async (p) => { await openEdit(p, 'draft'); await goRow(p, 'Staff') } },
  { name: 'details', light: true, run: async (p) => { await openEdit(p, 'draft'); await goRow(p, 'Details') } },
  { name: 'when-and-where', run: async (p) => { await openEdit(p, 'draft'); await goRow(p, 'When and where') } },
  { name: 'participant-picker', light: true, run: async (p) => { await openEdit(p, 'draft'); await goRow(p, 'People'); await press(p, 'Add participant') } },
  { name: 'staff-picker', run: async (p) => { await openEdit(p, 'draft'); await goRow(p, 'Staff'); await press(p, 'Add staff') } },
  { name: 'staff-override-prompt', run: async (p) => {
    p.mode.post = { status: 422, body: warning }
    await openEdit(p, 'draft'); await goRow(p, 'Staff'); await press(p, 'Add staff')
    await sheet(p).getByRole('option').first().click()
    await p.getByRole('alertdialog').waitFor({ timeout: 10_000 })
  }, layer: 'alertdialog' },
  { name: 'remove-confirm', run: async (p) => { await openEdit(p, 'draft'); await goRow(p, 'People'); await sheet(p).getByRole('button', { name: /^Remove Liam/ }).click(); await p.getByRole('alertdialog').waitFor() }, layer: 'alertdialog' },
  { name: 'cancel-confirm', run: async (p) => { await openEdit(p, 'draft'); await sheet(p).getByRole('button', { name: 'Cancel activity' }).click(); await p.getByRole('alertdialog').waitFor() }, layer: 'alertdialog' },
  { name: 'discard-prompt', run: async (p) => { await openEdit(p, 'draft'); await goRow(p, 'Details'); await sheet(p).getByLabel(/Notes/).fill('Bring towels and sunscreen'); const prompt = p.getByRole('alertdialog', { name: 'Discard changes?' }); await p.keyboard.press('Escape'); if (!(await prompt.isVisible({ timeout: 1500 }).catch(() => false))) await p.keyboard.press('Escape'); await prompt.waitFor({ timeout: 10_000 }) }, layer: 'alertdialog' },
  { name: 'refused-add', run: async (p) => {
    p.mode.post = { status: 409, body: { success: false, message: 'Mia Chen is not ready for group support yet.', errors: ['Mia Chen is not ready for group support yet.'] } }
    await openEdit(p, 'draft'); await goRow(p, 'People'); await press(p, 'Add participant')
    await sheet(p).locator('ul button:not([data-overview-row])').first().click()   // at 1440 the overview column's rows are also ul buttons
    await sheet(p).getByRole('heading', { name: /wasn't added/ }).or(sheet(p).getByText(/wasn't added/)).first().waitFor({ timeout: 10_000 })
  } },
  { name: 'offline', run: async (p) => { await openEdit(p, 'started'); await goRow(p, 'People'); await p.context().setOffline(true); await p.waitForTimeout(500); await sheet(p).getByText(/You're offline/).waitFor({ timeout: 5000 }) } },
]

const browser = await chromium.launch({ headless: true })
const VIEWPORTS = [{ w: 390, h: 844, touch: true }, { w: 1440, h: 900, touch: false }]

for (const vp of VIEWPORTS) {
  for (const st of STATES) {
    if (vp.touch && st.wide) continue
    if (!vp.touch && st.wide === false) continue
    const themes = vp.touch && st.light ? ['dark', 'light'] : ['dark']
    for (const theme of themes) {
      const label = `${st.name}@${vp.w}-${theme}`
      let session
      try {
        session = await openBoard(browser, { width: vp.w, height: vp.h, touch: vp.touch, theme, role: st.role ?? 'Admin' })
        const { page } = session
        await st.run(page)
        await page.waitForTimeout(400)
        const file = `b-${st.name}-${vp.w}-${theme}`
        if (st.layer) {
          // The prompt is centred over the sheet: capture the sheet and the prompt together (the viewport crop), and audit the prompt's own targets.
          await page.screenshot({ path: path.join(OUT_DIR, `${file}.png`) })
        } else {
          await shot(page, file, { touch: vp.touch })
          if (theme === 'dark') await audit(page, label, { touch: vp.touch })
        }
        if (st.name === 'edit-draft-overview' || st.name === 'people') {
          if (theme === 'dark') for (const c of await contrast(page)) check(`${label}: contrast ${c.name} >= ${c.floor}`, c.value >= c.floor, c.value)
        }
        if (st.measure) await st.measure(page, label, { touch: vp.touch })   // last: overviewGround pushes a page
        if (session.errors.length) check(`${label}: no page errors`, false, session.errors)
      } catch (e) {
        check(`${label}: state ran`, false, String(e.message).split('\n')[0])
      } finally {
        await session?.context.close()
      }
    }
  }

  // One full page per breakpoint: the board with the edit-draft overview open over it.
  let session
  try {
    session = await openBoard(browser, { width: vp.w, height: vp.h, touch: vp.touch })
    await openEdit(session.page, 'draft')
    await session.page.waitForTimeout(400)
    mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })
    const fullFile = path.join(OUT_DIR, 'full', `b-full-page-${vp.w}-dark.png`)
    const allow = ['.overflow-x-auto']   // the roster board's sideways strip
    checks.push(await layoutCheck(session.page, sheet(session.page), `sheet @${vp.w}`, { allow }))
    // The sheet stays open. fullPage checks <main>, so a fault it reports is a board element behind the scrim (queued as GMR-B1), never the sheet: the scoped check above covers that.
    const full = await fullPage(session.page, fullFile, { touch: vp.touch, allow })
    checks.push(...full.checks)
  } catch (e) {
    check(`full page @${vp.w}: ran`, false, String(e.message).split('\n')[0])
  } finally {
    await session?.context.close()
  }

  // Motion: the page push animates transform and opacity only, nothing loops; reduced motion swaps it for a fade (SHAPE section 6).
  try {
    for (const reduce of [false, true]) {
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.w, height: vp.h }, hasTouch: vp.touch, isMobile: vp.touch, reducedMotion: reduce ? 'reduce' : 'no-preference' })
      await context.close()
    }
    session = await openBoard(browser, { width: vp.w, height: vp.h, touch: vp.touch })
    await openEdit(session.page, 'draft')
    const anim = await session.page.evaluate(() => {
      const probe = document.querySelector('.ga-push') ?? document.querySelector('[role=dialog] section')
      const cs = probe ? getComputedStyle(probe) : null
      return { name: cs?.animationName, iterations: cs?.animationIterationCount }
    })
    check(`motion @${vp.w}: the page entrance has no infinite animation`, anim.iterations !== 'infinite', anim)
  } catch (e) {
    check(`motion @${vp.w}: ran`, false, String(e.message).split('\n')[0])
  } finally {
    await session?.context.close()
  }
}

await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
