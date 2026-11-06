// Finish later PR2 shots: End shift takes the end at the tap, and the worker adds the details on one page (or later).
// States (file names carry the state and the breakpoint): b-online-incomplete, b-dose-due, b-travel-not-asked, b-all-complete, b-change-reason-required,
// b-offline-ended, b-save-error, c-detail-needs-details, e-home-needs-details, b-dark-incomplete, b-handover-limit. Numeric checks N1 to N7. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/finish-later-pr2.mjs <outdir>
// Sign-in is stubbed with page.route; the worker's shift is the mock API's, patched in flight. The clock is pinned (NOW) and the theme is pinned in the
// user prefs, so every run paints the same. The shift started 4 hours before NOW and is rostered to end at NOW: End shift taps on time.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const NOW = new Date('2026-11-04T23:00:00Z')
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000)
const SHIFT_ID = 'sh-next'
const ALL_MISSING = ['kilometres', 'tripTo', 'tripAfter', 'notes', 'handover', 'report']

const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }

// Provider-local date and "HH:mm:ss" of an instant.
function wall(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` }
}
const DOSE = {
  medicationId: 'med-1', medicationName: 'Paracetamol', strength: '500mg', doseDescription: '2 tablets', form: 'Tablet', route: 'Oral', directions: null, supportLevel: 'Administer',
  isHighRisk: false, scheduledAt: at(-120).toISOString(), scheduledTime: '08:00', state: 'Due', isOverdue: true, outcome: null,
  witness: { required: false, status: null, witnessName: null, requestedAt: null, respondedAt: null },
}

/** One shift's server state, as the routes below serve it. */
const world = (over = {}) => ({ status: 'InProgress', travelAsked: true, dose: false, missing: ALL_MISSING, saved: {}, saveFails: false, ...over })

async function open(browser, vp, { dark = false, draft = null, offline = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id, theme, key, d]) => {
    try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme })) } catch { /* storage blocked */ }
    try { if (d && !sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(d)) } catch { /* storage blocked */ }
  }, [USER_ID, dark ? 'dark' : 'light', `odip-shift-end-draft:${SHIFT_ID}`, draft])
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  const login = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.worker', fullName: 'Dev Worker', role: 'SupportWorker', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.worker', role: 'SupportWorker', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(NOW)
  return { context, page, offline }
}

/** Patches the mock API's shift in flight from `w`; the finish and finish-details calls change `w` the way the server would. */
async function route(page, w) {
  let last = null
  const detail = () => {
    const d = structuredClone(last.data)
    const tz = d.timeZoneId ?? 'Australia/Sydney'
    const s = wall(at(-240), tz), e = wall(at(0), tz)
    const ended = w.status === 'PendingReview'
    Object.assign(d, {
      id: SHIFT_ID, status: w.status, serviceDate: s.date, startTime: s.time, endTime: e.time, endsNextDay: e.date !== s.date, serviceLocation: null, travelAsked: w.travelAsked,
      breaks: [], prn: [], shiftRoutines: [], canRecordDoses: true, missingDetails: ended ? w.missing : [],
      medicationsDue: w.dose ? [DOSE] : [], finishBlockers: w.dose && !ended ? [{ code: 'DOSE_OUTCOME_MISSING', message: 'Paracetamol 500mg was due at 8:00 am.', medicationId: 'med-1', medicationName: 'Paracetamol', scheduledAt: DOSE.scheduledAt }] : [],
      completion: {
        ...(d.completion ?? {}), id: 'sc-1', shiftId: SHIFT_ID, actualStart: at(-240).toISOString(), actualEnd: ended ? NOW.toISOString() : null, originalActualStart: null, originalActualEnd: null,
        timeAdjustmentReason: null, startTimeReason: null, finishTimeReason: null, kilometres: null, anythingToReport: null, handoverText: null, nothingToHandOver: false,
        nothingToNoteConfirmed: false, preTravelNone: false, postTravelNone: false, breaks: [], breakMinutes: 0, netWorkedMinutes: 0, timesAdjusted: false, sentFromOffline: false,
        missingDetails: ended ? w.missing : [],
      },
    })
    return d
  }
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}`, async (r) => {
    const response = await r.fetch()
    last = await response.json()
    await r.fulfill({ response, json: envelope(detail()) })
  })
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}/notes`, (r) => r.fulfill({ json: envelope([]) }))
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}/finish`, (r) => { w.status = 'PendingReview'; r.fulfill({ json: envelope(detail()) }) })
  await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}/finish-details`, (r) => w.saveFails
    ? r.fulfill({ status: 500, json: { success: false, data: null, message: 'Server error', errors: [] } })
    : r.fulfill({ json: envelope(detail()) }))
}
const gotoShift = async (page, hash = '') => {
  await page.goto(`${BASE_URL}/portal/shifts/${SHIFT_ID}${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
}
const crop = async (page, locator, name, vp, pad = 8) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, `${name}-${vp.name}.png`), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
const px = (page, expr) => page.evaluate((e) => { const p = document.createElement('div'); p.style.height = `var(${e})`; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h }, expr)
const bar = (page) => page.getByRole('toolbar', { name: 'Shift actions' })
const noHScroll = async (page, ctx) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`${ctx}: no horizontal scroll`, o <= 0, o) }
const tapTargets = async (page, ctx) => {
  const small = await page.locator('#finish').evaluate((el) => [...el.querySelectorAll('button, input, select, textarea')].filter((e) => {
    const b = e.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0) || getComputedStyle(e).visibility === 'hidden') return false
    if (e.type === 'checkbox') return false   // the 44 high label row carries the hit area
    return Math.max(b.height, parseFloat(getComputedStyle(e, '::before').height) || 0) < 43.5
  }).map((e) => `${e.tagName} ${(e.id || e.textContent || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`))
  check(`${ctx} N1: tap targets at least --tap-min (44)`, small.length === 0, small.join('; '))
}

/** Taps End shift on the running shift and waits for the details page. */
async function endShift(page) {
  await gotoShift(page)
  const end = page.getByRole('button', { name: 'End shift' })
  await end.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(400)
  await end.click()
  await page.getByRole('heading', { level: 2, name: /^Ended / }).waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(400)
}

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VPS) {
    const t = (n) => `${vp.name}: ${n}`

    // b-online-incomplete: the page right after End shift, nothing answered, travel asked. N1 to N5 and N7.
    {
      const { context, page } = await open(browser, vp)
      await route(page, world())
      await endShift(page)
      await tapTargets(page, t('b-online-incomplete'))
      await noHScroll(page, t('b-online-incomplete'))
      const controlH = await px(page, '--control-h')
      const tb = bar(page)
      check(t('N2: one ActionBar'), (await tb.count()) === 1, await tb.count())
      const tbBox = await tb.boundingBox()
      const vh = vp.height
      if (vp.touch) {
        const navH = await px(page, '--mobile-nav-h')
        check(t('N2: ActionBar bottom = viewport - --mobile-nav-h'), Math.abs(tbBox.y + tbBox.height - (vh - navH)) <= 1.5, `${Math.round(tbBox.y + tbBox.height)} vs ${vh - navH}`)
      } else {
        check(t('N7: ActionBar sits at the column foot (lg:bottom-0)'), Math.abs(tbBox.y + tbBox.height - vh) <= 1.5, `${Math.round(tbBox.y + tbBox.height)} vs ${vh}`)
        const col = await page.locator('main').first().boundingBox()
        const card = await page.locator('#finish-travel').locator('xpath=ancestor::section[1]').boundingBox()
        check(t('N7: travel card no wider than the main column'), card.width <= col.width + 0.5, `${Math.round(card.width)} vs ${Math.round(col.width)}`)
      }
      const buttons = await tb.getByRole('button').all()
      const boxes = await Promise.all(buttons.map((b) => b.boundingBox()))
      check(t('N4: bar buttons on one row'), boxes.length === 2 && boxes.every((b) => Math.abs(b.y - boxes[0].y) <= 1.5), boxes.map((b) => Math.round(b.y)).join(','))
      check(t('N1: bar buttons are --control-h tall'), boxes.every((b) => b.height >= controlH - 0.5), `${boxes.map((b) => Math.round(b.height))} vs ${controlH}`)
      const pre = await page.locator('#finish-pre-min').boundingBox(), preKm = await page.locator('#finish-pre-km').boundingBox()
      check(t('N5: leg inputs side by side, each >= --control-h'), Math.abs(pre.y - preKm.y) <= 1.5 && pre.x + pre.width <= preKm.x + 1 && pre.height >= controlH - 0.5 && preKm.height >= controlH - 0.5, `${Math.round(pre.y)}/${Math.round(preKm.y)} h ${Math.round(pre.height)}/${Math.round(preKm.height)} vs ${controlH}`)
      if (vp.touch) {
        const travel = await page.locator('#finish-travel').boundingBox()
        check(t('N3: travel card top and first input bottom are above the ActionBar at scroll 0'), travel.y < tbBox.y && pre.y + pre.height < tbBox.y && (await page.evaluate(() => window.scrollY)) === 0, `card ${Math.round(travel.y)}, input bottom ${Math.round(pre.y + pre.height)}, bar ${Math.round(tbBox.y)}`)
      }
      await crop(page, page.locator('#finish'), 'b-online-incomplete', vp)
      if (!vp.touch) checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'b-online-incomplete-1280.png'), { touch: false })).checks)
      await context.close()
    }

    // b-dose-due: a dose with no outcome holds the end back; nothing is sent.
    {
      const { context, page } = await open(browser, vp)
      await route(page, world({ dose: true }))
      await gotoShift(page)
      await page.getByRole('button', { name: 'End shift' }).click()
      await page.getByRole('heading', { level: 2, name: /^Ended / }).waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByRole('button', { name: 'Submit shift' }).click()
      await page.getByText('Record an outcome for 1 dose before you end the shift.').first().waitFor({ state: 'visible', timeout: 15_000 })
      await page.waitForTimeout(400)
      check(t('b-dose-due: the first Record it has the focus'), await page.evaluate(() => document.activeElement?.id === 'dose-blocker-0'))
      await crop(page, page.locator('#finish'), 'b-dose-due', vp)
      await context.close()
    }

    // b-travel-not-asked: just the kilometres.
    {
      const { context, page } = await open(browser, vp)
      await route(page, world({ travelAsked: false, missing: ['kilometres', 'notes', 'handover', 'report'] }))
      await endShift(page)
      check(t('b-travel-not-asked: no trip legs'), (await page.locator('#finish-pre-min').count()) === 0)
      await crop(page, page.locator('#finish'), 'b-travel-not-asked', vp)
      await context.close()
    }

    // b-all-complete: everything answered, so only Submit shift is offered.
    {
      const draft = { open: true, touched: true, tappedAt: NOW.toISOString(), kilometres: '12.5', preTravelNone: true, postTravelNone: true, anythingToReport: 'no', handoverText: 'All settled. Bedtime at eight.', nothingToNote: true }
      const { context, page } = await open(browser, vp, { draft })
      await route(page, world({ status: 'PendingReview' }))
      await gotoShift(page)
      await page.getByRole('heading', { level: 2, name: /^Ended / }).waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(400)
      check(t('b-all-complete: Add details later is gone'), (await bar(page).getByRole('button', { name: 'Add details later' }).count()) === 0)
      await crop(page, page.locator('#finish'), 'b-all-complete', vp)
      await context.close()
    }

    // b-change-reason-required: the finish moved earlier with no reason; Submit says so.
    {
      const local = wall(at(-10), 'Australia/Sydney')
      const draft = { open: true, touched: true, tappedAt: NOW.toISOString(), endOverride: `${local.date}T${local.time.slice(0, 5)}`, kilometres: '0', preTravelNone: true, postTravelNone: true, anythingToReport: 'no', nothingToHandOver: true, nothingToNote: true }
      const { context, page } = await open(browser, vp, { draft })
      await route(page, world({ status: 'PendingReview' }))
      await gotoShift(page)
      await page.getByRole('heading', { level: 2, name: /^Ended / }).waitFor({ state: 'visible', timeout: 60_000 })
      await bar(page).getByRole('button', { name: 'Submit shift' }).click()
      await bar(page).getByRole('alert').waitFor({ state: 'visible', timeout: 15_000 })
      await page.waitForTimeout(400)
      check(t('b-change-reason-required: the bar says why the reason is needed'), /Say why your finish time changed/.test((await bar(page).getByRole('alert').textContent()) ?? ''))
      await crop(page, page.locator('#finish'), 'b-change-reason-required', vp)
      await context.close()
    }

    // b-offline-ended: no signal after End shift; the finish waits on the phone and the shift says so.
    {
      const { context, page } = await open(browser, vp)
      await route(page, world())
      await gotoShift(page)
      await page.getByRole('button', { name: 'End shift' }).waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(400)
      await context.setOffline(true)
      await page.getByRole('button', { name: 'End shift' }).click()
      await page.getByRole('heading', { level: 2, name: /^Ended / }).waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(600)
      await crop(page, page.locator('#finish'), 'b-offline-ended', vp)
      await context.close()
    }

    // b-save-error: the save is refused by the server; the entries stay and the page says so above the bar.
    {
      const draft = { open: true, touched: true, tappedAt: NOW.toISOString(), kilometres: '12.5', preTravelNone: true, postTravelNone: true, anythingToReport: 'no', nothingToHandOver: true, nothingToNote: true }
      const { context, page } = await open(browser, vp, { draft })
      await route(page, world({ status: 'PendingReview', saveFails: true }))
      await gotoShift(page)
      await page.getByRole('heading', { level: 2, name: /^Ended / }).waitFor({ state: 'visible', timeout: 60_000 })
      await bar(page).getByRole('button', { name: 'Submit shift' }).click()
      await page.getByText("This shift can't be saved yet").waitFor({ state: 'visible', timeout: 15_000 })
      await page.waitForTimeout(400)
      check(t('b-save-error: the typed kilometres are kept'), (await page.locator('#finish-km').inputValue()) === '12.5')
      await crop(page, page.locator('#finish'), 'b-save-error', vp)
      await context.close()
    }

    // c-detail-needs-details: a worker who left details for later opens the shift.
    {
      const { context, page } = await open(browser, vp)
      await route(page, world({ status: 'PendingReview', missing: ['kilometres', 'handover'] }))
      await gotoShift(page)
      await page.getByText('Add the rest of this shift').waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(400)
      await noHScroll(page, t('c-detail-needs-details'))
      await crop(page, page.getByText('Add the rest of this shift').locator('xpath=ancestor::div[@role="alert" or @role="status" or contains(@class,"rounded")][1]'), 'c-detail-needs-details', vp)
      await context.close()
    }

    // e-home-needs-details: the My shifts list leads with the shift that still needs details. N6.
    {
      const { context, page } = await open(browser, vp)
      await page.route((u) => u.pathname === '/api/v1/portal/my-shifts', async (r) => {
        const response = await r.fetch()
        const body = await response.json()
        const tz = body.data?.timeZoneId ?? 'Australia/Sydney'
        const s = wall(at(-240), tz), e = wall(at(0), tz)
        const row = { id: SHIFT_ID, participantId: 'participant-1', participantName: 'Alexandra Reid', serviceDate: s.date, startTime: s.time, endTime: e.time, endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'PendingReview', notes: null, returnCount: 0, missingDetails: ALL_MISSING }
        if (body.data) body.data.shifts = [row, ...body.data.shifts.filter((x) => x.id !== SHIFT_ID)]
        await r.fulfill({ response, json: body })
      })
      await page.goto(`${BASE_URL}/portal`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const section = page.getByRole('region', { name: 'Needs details' })
      await section.waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(600)
      const link = section.getByRole('link').first()
      const line = link.getByText(/^Still to add:/)
      const m = await line.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, overflow: getComputedStyle(el).textOverflow, ws: getComputedStyle(el).whiteSpace, right: el.getBoundingClientRect().right }))
      const badge = await link.locator('[data-status-badge]').boundingBox()
      const card = await link.boundingBox()
      check(t('N6: the Still to add line wraps, no ellipsis'), m.sw <= m.cw + 1 && m.overflow !== 'ellipsis' && m.ws !== 'nowrap', JSON.stringify(m))
      check(t('N6: the badge stays at the right of the card'), badge.x >= m.right - 1 && badge.x + badge.width <= card.x + card.width + 0.5, `${Math.round(badge.x)}-${Math.round(badge.x + badge.width)} text right ${Math.round(m.right)} card right ${Math.round(card.x + card.width)}`)
      await noHScroll(page, t('e-home-needs-details'))
      await crop(page, section, 'e-home-needs-details', vp)
      await context.close()
    }

    // b-dark-incomplete: the incomplete page in the dark theme.
    {
      const { context, page } = await open(browser, vp, { dark: true })
      await route(page, world())
      await endShift(page)
      await crop(page, page.locator('#finish'), 'b-dark-incomplete', vp)
      await context.close()
    }

    // b-handover-limit: the handover is full at 2000 characters; the counter says so and no more can be typed.
    {
      const draft = { open: true, touched: true, tappedAt: NOW.toISOString(), handoverText: 'a'.repeat(2000) }
      const { context, page } = await open(browser, vp, { draft })
      await route(page, world({ status: 'PendingReview' }))
      await gotoShift(page)
      await page.getByRole('heading', { level: 2, name: /^Ended / }).waitFor({ state: 'visible', timeout: 60_000 })
      const box = page.locator('#handover-text')
      await box.focus()
      await page.keyboard.type('b')
      check(t('b-handover-limit: the 2001st character is not accepted'), (await box.inputValue()).length === 2000)
      check(t('b-handover-limit: the counter reads 2000 of 2000'), (await page.getByText('2000 of 2000').count()) === 1)
      await box.scrollIntoViewIfNeeded()
      await crop(page, page.locator('#finish-handover-card'), 'b-handover-limit', vp)
      await context.close()
    }
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
