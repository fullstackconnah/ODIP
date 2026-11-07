// Captures and numeric checks for the reservation form rules (hunt 35 fix 1): active-only property pickers, archived own property marked, check-out minimum.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Trip t-0001 (14 to 17 Aug 2026) comes from the mock API; the property list and the trip's reservations are routed here.
import path from 'node:path'
import { AU_CONTEXT, cropElement, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator' })

const prop = (id, propertyName, isActive) => ({ id, propertyName, location: 'Noosa', region: null, address: null, suburb: null, state: null, postcode: null,
  isFullyModified: false, isSemiModified: false, isWheelchairAccessible: false, bedroomCount: 4, bedCount: 8, maxCapacity: 10, isActive })
const properties = [prop('ap1', 'Sunshine Beach Retreat', true), prop('ap2', 'Old Lodge Archived', false), prop('ap3', 'Harbour View Cabins', true)]
const reservations = [{ id: 'r1', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape', accommodationPropertyId: 'ap2', propertyName: 'Old Lodge Archived',
  requestSentDate: null, dateBooked: null, dateConfirmed: null, checkInDate: '2026-08-14', checkOutDate: '2026-08-17', bedroomsReserved: null, bedsReserved: null,
  cost: null, confirmationReference: null, reservationStatus: 'Requested', comments: null, cancellationReason: null, hasOverlapConflict: false }]

const STATES = [
  { name: 'add-390', width: 390, form: 'add' },
  { name: 'add-1280', width: 1280, form: 'add' },
  { name: 'edit-archived-1280', width: 1280, form: 'edit' },
]

const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: mobile ? 844 : 800 }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    if (mobile) {
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
    }
    await page.clock.setFixedTime(new Date('2026-11-06T10:00:00+11:00'))
    page.on('pageerror', (e) => add(`page error ${st.name}`, e.message, false))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route(/\/api\/v1\/accommodation(\?.*)?$/, (r) => r.fulfill({ json: envelope(properties) }))
    await page.route(/\/api\/v1\/trips\/t-0001\/accommodation(\?.*)?$/, (r) => r.fulfill({ json: envelope(reservations) }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/trips/t-0001?tab=stay`, { waitUntil: 'domcontentloaded', timeout: 120_000 })

    if (st.form === 'add') await page.getByRole('button', { name: 'Add Accommodation' }).click({ timeout: 60_000 })
    else await page.getByRole('button', { name: 'Edit reservation' }).first().click({ timeout: 60_000 })
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 30_000 })
    await dialog.getByRole('combobox').first().click()
    const options = await page.getByRole('option').allTextContents()
    const checkOut = dialog.getByLabel('Check-out')
    const checkIn = await dialog.getByLabel('Check-in').inputValue()
    const min = await checkOut.getAttribute('min')
    const nextDay = new Date(Date.parse(`${checkIn}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
    add(`check-out min is the day after check-in [${st.name}]`, { checkIn, min }, min === nextDay)
    if (st.form === 'add') {
      add(`archived property is not an add option [${st.name}]`, options, !options.some((o) => o.includes('Old Lodge Archived')) && options.some((o) => o.includes('Sunshine Beach Retreat')))
    } else {
      const own = options.find((o) => o.includes('Old Lodge Archived'))
      add(`edit option for the archived own property ends with (archived) [${st.name}]`, options, !!own && own.endsWith('(archived)'))
      add(`edit picker lists active properties too [${st.name}]`, options, options.some((o) => o.includes('Harbour View Cabins')))
    }
    // The open listbox is part of the shot; crop the dialog (cropElement fails a crop that sticky or fixed chrome covers).
    const r = await cropElement(page, dialog, path.join(OUT_DIR, `${st.name}.png`), { hideChrome: true })
    add(r.overlap ? `crop holds the whole dialog [${st.name}]` : `crop [${st.name}]`, { clip: r.clip, box: r.box }, r.overlap?.pass ?? true)
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
