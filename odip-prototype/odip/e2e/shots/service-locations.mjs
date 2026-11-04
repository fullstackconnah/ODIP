// Service locations PR1: the Settings list and form, the shift picker, the worker's place line. Captures plus numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/service-locations.mjs <outdir>
// Sign-in, the provider row and /service-locations are stubbed with page.route (synthetic rows); the roster board and the portal shift come from the mock API.
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
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const provider = {
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Melbourne VIC 3000',
  state: 'VIC', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null, timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}
const LONG_NAME = 'Southside community day centre and hydrotherapy pool, Eastern wing'
const LONG_ADDRESS = '12 Riverside Parade, Southside Heights, Queensland 4101, enter through the community hall'
const place = (id, name, over = {}) => ({ id, name, address: null, latitude: -27.4698, longitude: 153.0251, radiusMetres: 200, timeZoneId: null, isActive: true, ...over })
const PLACES = [
  place('loc-1', LONG_NAME, { address: LONG_ADDRESS }),
  place('loc-2', 'Perth office', { address: '1 Hay Street, Perth WA 6000', latitude: -31.9523, longitude: 115.8613, radiusMetres: 300, timeZoneId: 'Australia/Perth' }),
  place('loc-3', 'Old depot', { isActive: false }),
]
const CONFLICT = 'That place is already on the list.'

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openPage(browser, vp, { role = 'Admin', username = 'dev.admin', places = PLACES, conflict = false, insecure = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  if (insecure) await context.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true }))
  const page = await context.newPage()
  const posts = []
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope(provider) }))
  await page.route('**/api/v1/service-locations**', (r) => {
    const req = r.request()
    if (req.method() === 'GET') return r.fulfill({ json: envelope(places) })
    posts.push(JSON.parse(req.postData() ?? '{}'))
    if (conflict) return r.fulfill({ status: 409, json: { success: false, data: null, message: CONFLICT, errors: [CONFLICT] } })
    return r.fulfill({ json: envelope(place('loc-new', 'New place')) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page, posts }
}

const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${ctx}: no horizontal scroll`, o <= 0, o)
}
// Every visible button, input and select inside `root` has at least 44px of height to tap, its own box or its TAP_AREA pad.
const tapTargets = async (root, ctx) => {
  const small = await root.evaluate((el) => [...el.querySelectorAll('button, input, select')].filter((e) => {
    const b = e.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0) || getComputedStyle(e).visibility === 'hidden') return false
    const pad = parseFloat(getComputedStyle(e, '::before').height) || 0 // TAP_AREA's transparent hit area
    return Math.max(b.height, pad) < 43.5
  }).map((e) => `${e.tagName} ${(e.getAttribute('aria-label') || e.textContent || e.name || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`))
  check(`${ctx}: tap targets at least 44 high`, small.length === 0, small)
}
const crop = async (page, locator, name, vp, pad = 16) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
const openSettings = async (page) => {
  await page.goto(`${BASE_URL}/settings?section=locations`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Add a place' }).waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(400)
}

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const tag = vp.touch ? `${vp.name}-touch` : vp.name

  // settings-empty
  try {
    const { context, page } = await openPage(browser, vp, { places: [] })
    await openSettings(page)
    const main = page.locator('main').first()
    check(t('empty message shown'), await page.getByText(/No service locations yet/).isVisible())
    await noHScroll(page, t('settings-empty'))
    if (vp.touch) await tapTargets(main, t('settings-empty'))
    await crop(page, main, `settings-empty-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('settings-empty ran'), false, String(e.message).split('\n')[0]) }

  // settings-list
  try {
    const { context, page } = await openPage(browser, vp)
    await openSettings(page)
    const main = page.locator('main').first()
    await page.getByRole('heading', { name: 'Archived' }).waitFor({ state: 'visible', timeout: 30_000 })
    const rows = await page.evaluate(() => ({ edit: document.querySelectorAll('button[aria-label^="Edit: "]').length, archive: document.querySelectorAll('button[aria-label^="Archive: "]').length }))
    check(t('two active places have Edit and Archive, the archived one has none'), rows.edit === 2 && rows.archive === 2, rows)
    await noHScroll(page, t('settings-list'))
    if (vp.touch) await tapTargets(main, t('settings-list'))
    await crop(page, main, `settings-list-${tag}.png`, vp)
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `settings-list-${tag}.png`), { touch: vp.touch })).checks)
    await context.close()
  } catch (e) { check(t('settings-list ran'), false, String(e.message).split('\n')[0]) }

  // settings-form, then settings-error (409)
  try {
    const { context, page, posts } = await openPage(browser, vp, { conflict: true })
    await openSettings(page)
    await page.getByRole('button', { name: 'Add a place' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(400)
    const locBtn = dialog.getByRole('button', { name: 'Use my current location' })
    check(t('location button enabled on a secure page (localhost)'), await locBtn.isEnabled())
    await noHScroll(page, t('settings-form'))
    if (vp.touch) await tapTargets(dialog, t('settings-form'))
    await crop(page, dialog, `settings-form-${tag}.png`, vp, 0)
    await dialog.getByLabel(/^Name/).fill('Southside hub')
    await dialog.getByLabel(/^Map pin/).fill('-27.4698, 153.0251')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await dialog.getByText(CONFLICT).waitFor({ state: 'visible', timeout: 10_000 })
    check(t('409 sentence shown, form stays open, one POST sent'), (await dialog.isVisible()) && posts.length === 1, posts.length)
    check(t('POST carries the pin and the default distance'), posts[0]?.latitude === -27.4698 && posts[0]?.longitude === 153.0251 && posts[0]?.radiusMetres === 200, posts[0])
    await noHScroll(page, t('settings-error'))
    await crop(page, dialog, `settings-error-${tag}.png`, vp, 0)
    await context.close()
  } catch (e) { check(t('settings-form ran'), false, String(e.message).split('\n')[0]) }

  // settings-form-insecure: the live site is plain HTTP, so there is no location button to use
  try {
    const { context, page } = await openPage(browser, vp, { insecure: true })
    await openSettings(page)
    await page.getByRole('button', { name: 'Add a place' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(400)
    const hint = dialog.getByText('Your browser only shares location over a secure connection. Type the pin instead.')
    check(t('insecure hint is visible'), await hint.isVisible())
    check(t('location button disabled on the insecure page'), await dialog.getByRole('button', { name: 'Use my current location' }).isDisabled())
    await dialog.getByLabel(/^Map pin/).fill('-27.4698, 153.0251')
    check(t('the pin box still takes typing'), (await dialog.getByLabel(/^Map pin/).inputValue()) === '-27.4698, 153.0251')
    await noHScroll(page, t('settings-form-insecure'))
    await crop(page, dialog, `settings-form-insecure-${tag}.png`, vp, 0)
    await context.close()
  } catch (e) { check(t('settings-form-insecure ran'), false, String(e.message).split('\n')[0]) }

  // slideover-picker and slideover-picker-empty: an existing shift's panel. The board's shifts are stamped with the archived place for the first.
  for (const [state, places] of [['slideover-picker', PLACES], ['slideover-picker-empty', []]]) {
    try {
      const { context, page } = await openPage(browser, vp, { places })
      // One staff week with a single shift, as roster-week.mjs serves it; with places, it sits at the archived one.
      await page.route('**/api/v1/rostering/board*', (r) => {
        const mon = new URL(r.request().url()).searchParams.get('weekStart')
        const day = (n) => { const d = new Date(`${mon}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
        const days = [0, 1, 2, 3, 4, 5, 6].map(day)
        const shift = { id: 'sh1', participantId: 'p-0001', participantName: 'Liam Okafor', staffId: 's-0001', staffName: 'Callum Radford', serviceDate: days[2], startTime: '09:00:00', endTime: '13:00:00', endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, serviceLocationId: places.length ? 'loc-3' : null }
        const row = { staffId: 's-0001', fullName: 'Callum Radford', role: 'SupportWorker', compliance: 'Ok', complianceNotes: [], rosteredHours: 4, targetHours: 38, shifts: [shift], tripBars: [], leave: [] }
        return r.fulfill({ json: { success: true, data: { groupBy: 'Staff', weekStart: mon, days, staffRows: [row], unfilled: [], exceptions: [] }, message: null, errors: [] } })
      })
      await page.goto(`${BASE_URL}/staff/s-0001?tab=week`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const chip = page.locator('[data-shift-open]').first()
      await chip.waitFor({ state: 'visible', timeout: 30_000 })
      await chip.click()
      const dialog = page.getByRole('dialog', { name: 'Shift details' })
      await dialog.waitFor({ state: 'visible', timeout: 30_000 })
      const picker = dialog.getByLabel('Service location')
      await picker.scrollIntoViewIfNeeded()
      await page.waitForTimeout(600)
      const options = await picker.locator('option').allInnerTexts()
      const order = await page.evaluate(() => {
        const d = document.querySelector('[role=dialog]')
        const by = (t) => [...d.querySelectorAll('select, input, textarea')].find((i) => i.labels?.[0]?.textContent.replace('*', '').trim() === t)
        const p = by('Service location'), l = by('Location details'), n = by('Notes')
        return { picker: p.getBoundingClientRect().top, details: l.getBoundingClientRect().top, notes: n.getBoundingClientRect().top, pickerH: p.getBoundingClientRect().height, detailsH: l.getBoundingClientRect().height }
      })
      check(t(`${state}: picker sits above Location details, which sits above Notes`), order.picker < order.details && order.details < order.notes, order)
      check(t(`${state}: picker and details inputs are the same height (+-1)`), Math.abs(order.pickerH - order.detailsH) <= 1, order)
      if (places.length) {
        check(t(`${state}: the picker shows the archived label and keeps the shift's place selected`), JSON.stringify(options) === JSON.stringify(['None', LONG_NAME, 'Perth office', 'Old depot (archived)']) && (await picker.inputValue()) === 'loc-3', options)
      } else {
        check(t(`${state}: only None, and the Settings pointer shows`), options.length === 1 && options[0] === 'None' && (await dialog.getByText('Add places in Settings, Service locations.').isVisible()), options)
      }
      check(t(`${state}: Location details field is present`), await dialog.getByLabel('Location details').isVisible())
      await noHScroll(page, t(state))
      // Only the picker's own block: the panel's other controls (a 13px checkbox among them) are not this PR's.
      if (vp.touch) await tapTargets(picker.locator('xpath=ancestor::div[1]'), t(state))
      await crop(page, picker.locator('xpath=ancestor::div[1]'), `${state}-${tag}.png`, vp)
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }

  // portal-detail-location: the worker sees the place and its address above the office notes
  try {
    const { context, page } = await openPage(browser, vp, { role: 'SupportWorker', username: 'dev.worker' })
    await page.route('**/api/v1/portal/shifts/sh-next', async (r) => {
      const response = await r.fetch()
      const body = await response.json()
      if (body?.data) { body.data.serviceLocation = { name: LONG_NAME, address: LONG_ADDRESS }; body.data.notes ??= 'Bring the red bag.' }
      await r.fulfill({ response, json: body })
    })
    await page.goto(`${BASE_URL}/portal/shifts/sh-next`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const where = page.locator('#service-location')
    await where.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(500)
    const m = await page.evaluate(() => {
      const w = document.getElementById('service-location'), n = document.getElementById('roster-notes')
      const b = (e) => e.getBoundingClientRect()
      return { whereTop: b(w).top, notesTop: n ? b(n).top : null, right: b(w).right, iw: innerWidth, text: w.innerText.replace(/\s+/g, ' ').trim() }
    })
    check(t('portal: place name and address shown'), m.text.includes(LONG_NAME) && m.text.includes(LONG_ADDRESS), m.text)
    check(t('portal: place block sits above From the office'), m.notesTop !== null && m.whereTop < m.notesTop, m)
    check(t('portal: place block inside the viewport'), m.right <= m.iw, m)
    await noHScroll(page, t('portal-detail-location'))
    await crop(page, where, `portal-detail-location-${tag}.png`, vp)
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `portal-detail-location-${tag}.png`), { touch: vp.touch })).checks)
    await context.close()
  } catch (e) { check(t('portal-detail-location ran'), false, String(e.message).split('\n')[0]) }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
