// Trip forms polish: numeric checks and padded crops at 390 with touch (run through the runner's `shots` target).
import { mkdirSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const day = { id: 'd1', tripInstanceId: 't-0001', dayNumber: 1, date: '2026-08-14', dayTitle: 'Arrival', dayNotes: null, scheduledActivities: [] }

const results = []
const check = (name, value, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value}`) }

// The scrollable ancestor of the dialog's Cancel button is the modal's scroll container.
const scrollModal = (page, where) => page.evaluate((w) => {
  const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel')
  let el = cancel
  while (el && el.scrollHeight <= el.clientHeight + 1) el = el.parentElement
  if (el) el.scrollTop = w === 'top' ? 0 : (el.scrollHeight - el.clientHeight) / 2
}, where)

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  page.on('pageerror', (e) => check('page error', e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/trips/*/schedule', (r) => r.fulfill({ json: envelope([day]) }))

  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  check('pointer coarse', coarse, coarse)

  const open = async (tab) => {
    await page.goto(`${BASE_URL}/trips/t-0001?tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  }
  const shot = async (loc, name) => {
    await loc.scrollIntoViewIfNeeded()
    const bb = await loc.boundingBox()
    if (!bb) return console.log(`no box for ${name}`)
    const x = Math.max(0, bb.x - 24)
    const y = Math.max(0, bb.y - 24)
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), clip: { x, y, width: Math.min(390 - x, bb.width + 48), height: Math.min(844 - y, bb.height + 48) } })
  }
  const heights = async (names, prefix) => {
    for (const n of names) {
      const row = page.getByLabel(n, { exact: true }).locator('xpath=ancestor::label[1]')
      const h = (await row.boundingBox())?.height ?? 0
      check(`${prefix} checkbox row "${n}" height`, `${h}px`, h >= 44)
    }
  }

  // 1. + Create new
  await open('accommodation')
  await page.getByRole('button', { name: 'Add Accommodation' }).click()
  const create = page.getByRole('button', { name: '+ Create new' })
  await create.waitFor()
  const padH = await create.evaluate((el) => parseFloat(getComputedStyle(el, '::before').height))
  check('"+ Create new" hit box height (::before)', `${padH}px`, padH >= 44)
  await shot(page.getByRole('dialog').first(), 'accommodation-create-new')

  // 2. Add Activity: end before start, body scrolled
  await open('activities')
  await page.getByRole('button', { name: 'Add Activity' }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel(/^Title/).fill('Beach walk')
  await dlg.getByLabel('Start Time').fill('10:00')
  await dlg.getByLabel('End Time').fill('09:00')
  await dlg.getByRole('button', { name: 'Add Activity' }).click()
  await scrollModal(page, 'middle')
  const footerBottom = await dlg.getByRole('button', { name: 'Add Activity' }).evaluate((b) => b.getBoundingClientRect().bottom)
  check('Add Activity footer bottom vs viewport (844), body scrolled', `${Math.round(footerBottom)}px`, footerBottom > 0 && footerBottom <= 844)
  const inField = await dlg.getByText('End time must be after start time').evaluate((e) => [...document.querySelectorAll('input[type=time]')][1].parentElement.contains(e))
  check('end-time error is inside the End Time field', inField, inField)
  await scrollModal(page, 'top')
  await shot(dlg, 'add-activity-scrolled-error')

  // 3. Bookings checkboxes
  await open('bookings')
  await page.getByRole('button', { name: 'Add Participant' }).first().click()
  const names = ['Wheelchair', 'High Support', 'Night Support', 'Restrictive Practice']
  await heights(names, 'add')
  await shot(page.getByText('Support Requirements').locator('xpath=..'), 'add-booking-checkboxes')
  await page.getByRole('button', { name: 'Cancel' }).click()
  const edit = page.getByTitle('Edit booking').first()
  if (await edit.count()) {
    await edit.click()
    await page.getByLabel('Wheelchair', { exact: true }).waitFor({ timeout: 15_000 })
    await heights(names, 'edit')
    await shot(page.getByText('Support Requirements').locator('xpath=..'), 'edit-booking-checkboxes')
  } else console.log('NOTE no booking in the mock for t-0001: edit booking not captured')

  // 4. Edit trip headings
  await open('overview')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const heading = page.getByText('Basic info', { exact: true })
  await heading.waitFor()
  const transform = await heading.evaluate((e) => getComputedStyle(e).textTransform)
  check('Edit trip heading text-transform', transform, transform === 'none')
  await shot(page.getByRole('dialog'), 'edit-trip-headings')
} finally {
  await browser.close()
}
console.log(results.every(Boolean) ? 'ALL CHECKS PASS' : 'SOME CHECKS FAILED')
