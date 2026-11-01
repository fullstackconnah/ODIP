// Shift billing PR2: the Support type field in the shift and pattern slide-overs, every state, with the plan's nine numeric checks. Computed boxes only. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/support-type.mjs <outdir>
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
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

// Synthetic catalogue: three hourly groups (one with a long name), one per-event group, one whose hourly rate ended last financial year.
const hourly = (id, from = '2025-07-01', to) => ({ id, itemNumber: `04_${id}`, description: 'Hourly', unit: 'H', dayType: 'Weekday', isIntensive: false, effectiveFrom: from, ...(to ? { effectiveTo: to } : {}) })
const GROUPS = [
  { id: 'g1', groupCode: 'GRP_COMMUNITY_PARTICIPATION', displayName: 'Community participation', supportCategory: 4, isActive: true, items: [hourly('a')] },
  { id: 'g2', groupCode: 'GRP_ART', displayName: 'Art therapy', supportCategory: 4, isActive: true, items: [hourly('b')] },
  { id: 'g3', groupCode: 'GRP_NURSING', displayName: 'Registered nurse clinical supervision and oversight for complex daily living', supportCategory: 4, isActive: true, items: [hourly('c')] },
  { id: 'g4', groupCode: 'GRP_TRANSPORT', displayName: 'Transport', supportCategory: 4, isActive: true, items: [{ ...hourly('d'), unit: 'EA' }] },
  { id: 'g5', groupCode: 'GRP_RESPITE', displayName: 'Respite', supportCategory: 4, isActive: true, items: [hourly('e', '2024-07-01', '2025-06-30')] },
]

const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000))
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
const MON = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))

const shift = (id, day, extra = {}) => ({
  id, participantId: 'p-0001', participantName: 'Liam Okafor', staffId: 's-0003', staffName: "Jack O'Sullivan", serviceDate: addDays(MON, day), startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false,
  durationHours: 6, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...extra,
})
const SHIFTS = [
  shift('sb-unset', 0),
  shift('sb-agreement', 1, { shiftPatternId: 'pat-a', fromAgreement: true, sourceDraftVersion: 2, supportGroupCode: 'GRP_COMMUNITY_PARTICIPATION' }),
  shift('sb-invalid', 2, { supportGroupCode: 'GRP_RESPITE' }),
  shift('sb-locked', 3, { supportGroupCode: 'GRP_ART', claimReference: 'CLM-20261101-0042' }),
]
const boardOf = (url) => {
  const asked = new URL(url).searchParams.get('weekStart')
  const mon = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : MON
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i))
  const shifts = mon === MON ? SHIFTS : []
  return envelope({ groupBy: 'Participant', weekStart: mon, weekStarted: true, days, exceptions: [], staffLeave: [],
    participantRows: [{ participantId: 'p-0001', fullName: 'Liam Okafor', supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, shifts, tripBars: [], scheduledHours: 24, daysWithoutCover: 3 }] })
}
const pattern = (id, day, extra = {}) => ({ id, participantId: 'p-0001', participantName: 'Liam Okafor', defaultStaffId: 's-0003', defaultStaffName: "Jack O'Sullivan", dayOfWeek: day, startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false,
  ratio: 'OneToOne', nightType: 'None', effectiveFrom: '2026-01-05', effectiveTo: null, isActive: true, notes: null, ...extra })
const PATTERNS = [
  pattern('pat-h', 'Monday'),
  pattern('pat-a', 'Tuesday', { sourceDraftId: 'draft-1', sourceBlockKey: 'weekdays', sourceDraftVersion: 2, supportGroupCode: 'GRP_COMMUNITY_PARTICIPATION' }),
]

async function session(browser, s, { role = 'Admin', username = 'dev.admin', catalogue = 'ok' } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: s.width, height: s.height }, hasTouch: s.touch, isMobile: s.touch, colorScheme: s.scheme })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('[pageerror]', String(e.message).slice(0, 200)))
  page.on('framenavigated', (f) => f === page.mainFrame() && console.log('[nav]', f.url()))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.route('**/api/v1/rostering/board*', (r) => r.fulfill({ json: boardOf(r.request().url()) }))
  await page.route('**/api/v1/rostering/shifts/check', (r) => r.fulfill({ json: envelope([]) }))
  await page.route(/\/api\/v1\/rostering\/patterns(\?.*)?$/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: envelope(PATTERNS) }) : r.fallback()))
  await page.route('**/api/v1/support-catalogue', (r) => {
    if (catalogue === 'loading') return   // never answers: the field stays loading
    if (catalogue === 'error') return r.fulfill({ status: 500, json: { success: false, data: null, message: 'boom', errors: [] } })
    return r.fulfill({ json: envelope(GROUPS) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}

// Everything the nine checks need, read in the page: boxes of the field, its neighbours and its helper, and the colours of the helper and its panel.
const measure = (page) => page.evaluate(() => {
  const dialog = [...document.querySelectorAll('[role=dialog]')].pop()
  const labelOf = (t) => [...dialog.querySelectorAll('label')].find((l) => l.textContent.replace('*', '').trim() === t)
  const wrap = labelOf('Support type').parentElement
  const combo = wrap.querySelector('input[role=combobox]')
  const ratioWrap = labelOf('Ratio').parentElement, nightWrap = labelOf('Night type').parentElement
  const ratioControl = ratioWrap.querySelector('button'), nightControl = nightWrap.querySelector('button')
  const grid = ratioWrap.parentElement
  const b = (el) => el.getBoundingClientRect()
  const ids = (combo.getAttribute('aria-describedby') || '').split(' ').filter(Boolean)
  const helpers = ids.map((id) => document.getElementById(id)).filter(Boolean)
  const lines = (el) => { const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight); return { h: b(el).height, lh: Number.isNaN(lh) ? parseFloat(cs.fontSize) * 1.5 : lh } }
  let scroller = combo.parentElement
  while (scroller && scroller !== document.body) { const o = getComputedStyle(scroller).overflowY; if (o === 'auto' || o === 'scroll') break; scroller = scroller.parentElement }
  const px = (css) => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true }); x.clearRect(0, 0, 1, 1); x.fillStyle = css; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const lum = ([r, g, bl]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl) }
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = px(getComputedStyle(n).backgroundColor); if (c[3] >= 0.99) return c } return [255, 255, 255, 1] }
  let contrast = null
  if (helpers[0]) {
    const bg = bgOf(helpers[0]); const fg = px(getComputedStyle(helpers[0]).color)
    const mix = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]))
    const [hi, lo] = [lum(mix), lum(bg)].sort((p, q) => q - p)
    contrast = +((hi + 0.05) / (lo + 0.05)).toFixed(2)
  }
  const grp = b(grid), cb = b(combo)
  return {
    coarse: matchMedia('(pointer: coarse)').matches, iw: innerWidth,
    combo: { top: cb.top, left: cb.left, width: cb.width, height: cb.height, disabled: combo.disabled, value: combo.value, placeholder: combo.placeholder },
    grid: { left: grp.left, width: grp.width }, ratio: { left: b(ratioControl).left }, night: { bottom: b(nightControl).bottom },
    helpers: helpers.map((el) => ({ text: el.textContent.trim(), role: el.getAttribute('role'), ...lines(el) })),
    scroller: scroller && scroller !== document.body ? { sw: scroller.scrollWidth, cw: scroller.clientWidth } : null,
    contrast,
  }
})

function judge(t, state, s, m) {
  const c = m.combo
  check(t('1 control height 32 (+-1) fine, >= 44 coarse'), s.touch ? m.coarse && c.height >= 44 : !m.coarse && Math.abs(c.height - 32) <= 1, { height: c.height, coarse: m.coarse })
  check(t('2 field width equals the grid content width (+-1)'), Math.abs(c.width - m.grid.width) <= 1 && Math.abs(c.left - m.grid.left) <= 1, { field: [c.left, c.width], grid: [m.grid.left, m.grid.width] })
  check(t('3 below Night type, left edge equals Ratio (+-1)'), c.top >= m.night.bottom && Math.abs(c.left - m.ratio.left) <= 1, { top: c.top, nightBottom: m.night.bottom, left: c.left, ratioLeft: m.ratio.left })
  check(t('4 each helper at most 3 lines'), m.helpers.length > 0 && m.helpers.every((h) => h.h <= 3 * h.lh + 1), m.helpers)
  if (s.width === 390) check(t('5 body scrollWidth equals clientWidth'), !!m.scroller && m.scroller.sw === m.scroller.cw, m.scroller)
  if (state === 'shift-locked-claimed') check(t('6 disabled and described by "On claim"'), c.disabled && m.helpers.some((h) => h.text.includes('On claim')), { disabled: c.disabled, helpers: m.helpers.map((h) => h.text) })
  if (state === 'shift-invalid-no-rate' || state === 'shift-catalogue-error') check(t('7 helper slot has role=alert'), m.helpers.some((h) => h.role === 'alert'), m.helpers)
  if (s.scheme === 'dark') check(t('9 dark helper contrast >= 4.5'), m.contrast !== null && m.contrast >= 4.5, m.contrast)
  else check(t('9 light helper contrast >= 4.5 (info)'), m.contrast !== null && m.contrast >= 4.5, m.contrast)
}

const SCENES = [
  { tag: '1280-light', width: 1280, height: 900, touch: false, scheme: 'light' },
  { tag: '1280-dark', width: 1280, height: 900, touch: false, scheme: 'dark' },
  { tag: '390-light', width: 390, height: 844, touch: true, scheme: 'light' },
  { tag: '390-dark', width: 390, height: 844, touch: true, scheme: 'dark' },
]

const dialogOf = (page) => page.getByRole('dialog').last()
const fieldLocator = (page) => dialogOf(page).locator('label', { hasText: /^Support type$/ }).locator('xpath=..')
const rowLocator = (page) => dialogOf(page).locator('label', { hasText: /^Ratio$/ }).locator('xpath=../..')

/** Waits until the field has settled: loaded (or failed) catalogue, or for the loading state the placeholder. */
async function ready(page, mode) {
  const dialog = dialogOf(page)
  await dialog.waitFor({ state: 'visible', timeout: 30_000 })
  const combo = fieldLocator(page).locator('input[role=combobox]')
  await combo.waitFor({ state: 'visible', timeout: 30_000 })
  if (mode === 'loading') await page.waitForFunction(() => [...document.querySelectorAll('input[role=combobox]')].some((i) => i.placeholder === 'Loading support types…'), null, { timeout: 30_000 })
  else if (mode === 'error') await fieldLocator(page).getByRole('alert').waitFor({ state: 'visible', timeout: 60_000 })
  else await page.waitForFunction(() => [...document.querySelectorAll('input[role=combobox]')].every((i) => i.placeholder !== 'Loading support types…'), null, { timeout: 30_000 })
  await combo.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
}

async function capture(page, s, state, mode, { full = false } = {}) {
  const t = (n) => `${s.tag} ${state}: ${n}`
  await ready(page, mode)
  // The loading spinner never stops; freeze it so the crop can settle.
  if (mode === 'loading') await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()))
  const nDialogs = await page.locator('[role=dialog]').count()
  if (!nDialogs) console.log(`[support-type] ${s.tag} ${state}: no dialog in the DOM at ${page.url()}`)
  const m = await measure(page)
  console.log(`[support-type] ${s.tag} ${state} ${JSON.stringify(m)}`)
  judge(t, state, s, m)
  const crop = await cropElement(page, fieldLocator(page), path.join(OUT_DIR, `${state}-${s.tag}.png`), { touch: s.touch, also: rowLocator(page) })
  checks.push(checkCropHolds({ ...crop, touch: s.touch }))
  if (full) checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${state}-${s.tag}.png`), { touch: s.touch })).checks)
  return m
}

async function closePanel(page) {
  await page.keyboard.press('Escape')
  await dialogOf(page).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {})
}

async function openShift(page, id) {
  // id null: the participant's week (the only place a ReadOnly user reaches a shift panel); else the roster board.
  await page.goto(id ? `${BASE_URL}/rostering` : `${BASE_URL}/participants/p-0001?tab=people&section=week`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const chip = page.locator(id ? `[data-shift-open="${id}"]` : '[data-shift-open]').first()
  await chip.waitFor({ state: 'visible', timeout: 30_000 }).catch(async () => {
    throw new Error(`no shift chip at ${page.url()}: ${(await page.locator('main').first().innerText().catch(() => '')).split(/\s+/).join(' ').slice(0, 160)}`)
  })
  await chip.scrollIntoViewIfNeeded()
  // The chip's centre can sit on the participant or staff name link, which navigates: click its top-left corner (the time) instead.
  await chip.click({ position: { x: 6, y: 6 } })
  await dialogOf(page).waitFor({ state: 'visible', timeout: 15_000 }).catch(async () => {
    throw new Error(`no dialog after the chip click (url ${page.url()}, chips ${await page.locator('[data-shift-open]').count()})`)
  })
}

const browser = await chromium.launch({ headless: true })
for (const s of SCENES) {
  const t = (n) => `${s.tag}: ${n}`
  // Catalogue loaded: the shift states, the listbox rows and the pattern states.
  let admin
  try {
    admin = await session(browser, s)
    const { page } = admin
    for (const [state, id] of [['shift-unset', 'sb-unset'], ['shift-from-agreement', 'sb-agreement'], ['shift-invalid-no-rate', 'sb-invalid'], ['shift-locked-claimed', 'sb-locked']]) {
      try {
        await openShift(page, id)
        await capture(page, s, state, 'ok', { full: state === 'shift-unset' })
        if (state === 'shift-unset' && s.touch) {
          await fieldLocator(page).locator('input[role=combobox]').click()
          await page.locator('[role=listbox] [role=option]').first().waitFor({ state: 'visible', timeout: 15_000 })
          const heights = await page.locator('[role=listbox] [role=option]').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.getBoundingClientRect().height))
          check(t('8 every listbox option >= 44px on coarse'), heights.length >= 4 && heights.every((h) => h >= 44), heights)
          await page.keyboard.press('Escape')
        }
        await closePanel(page)
      } catch (e) {
        check(`${s.tag} ${state}: ran`, false, String(e.message).split('\n')[0])
        await closePanel(page).catch(() => {})
      }
    }
    await page.goto(`${BASE_URL}/rostering/patterns`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const edit = (day) => page.getByRole('button', { name: new RegExp(`^Edit .*${day}.* pattern`) }).first()
    for (const [state, day] of [['pattern-unset', 'Monday'], ['pattern-agreement', 'Tuesday'], ['pattern-changed', 'Monday']]) {
      try {
        await edit(day).waitFor({ state: 'visible', timeout: 60_000 })
        await edit(day).click()
        if (state === 'pattern-changed') {
          await ready(page, 'ok')
          await fieldLocator(page).locator('input[role=combobox]').click()
          await page.getByRole('option', { name: 'Art therapy' }).click()
        }
        await capture(page, s, state, 'ok', { full: state === 'pattern-unset' })
        await closePanel(page)
        // A changed pattern asks before it closes; leave through Discard when it does.
        const discard = page.getByRole('button', { name: /^(Discard|Discard changes|Leave)$/ })
        if (await discard.first().isVisible().catch(() => false)) await discard.first().click()
      } catch (e) {
        check(`${s.tag} ${state}: ran`, false, String(e.message).split('\n')[0])
      }
    }
  } catch (e) {
    check(t('catalogue-loaded session ran'), false, String(e.message).split('\n')[0])
  } finally {
    await admin?.context.close()
  }

  // shift-read-only is not captured: ReadOnly is refused /rostering and its week section, so no ReadOnly user reaches this panel; the unit tests cover canWrite false.
  for (const [state, mode, opts] of [['shift-catalogue-loading', 'loading', {}], ['shift-catalogue-error', 'error', {}]]) {
    let sess
    try {
      sess = await session(browser, s, { ...opts, catalogue: mode === 'ok' ? 'ok' : mode })
      await openShift(sess.page, state === 'shift-read-only' ? null : 'sb-locked')
      const m = await capture(sess.page, s, state, mode)
      if (state === 'shift-read-only') check(t('read-only: disabled, value shown, no "A change here"'), m.combo.disabled && m.combo.value === 'Community access (default)' && !m.helpers.some((h) => h.text.includes('A change here')), { combo: m.combo, helpers: m.helpers.map((h) => h.text) })
      if (state === 'shift-catalogue-loading') check(t('loading: disabled with the loading placeholder'), m.combo.disabled && m.combo.placeholder === 'Loading support types…', m.combo)
    } catch (e) {
      check(`${s.tag} ${state}: ran`, false, String(e.message).split('\n')[0])
    } finally {
      await sess?.context.close()
    }
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
