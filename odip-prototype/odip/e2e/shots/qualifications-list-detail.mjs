// QL shots: Qualifications as a staff list (left) and one person's credentials (right), with Previous/Next and an in-place date editor.
// Fixture: 30 active staff mocked at the routes (names A-Z; Alex Aardvark first, Zed Zulu last). Dates are offsets from today, never today itself.
// At lg the page IS the viewport (data-fit-screen), so the 1280 states are viewport shots (cropElement would grow the viewport and undo the fit);
// the 390 states scroll, so they use fullPage (it re-applies touch emulation after the resize).
// Numeric checks 1-7 are the shape's (SHAPE.md, "Numeric checks"); each cites its token in the check name.
import path from 'node:path'
import { prepareOutDir, fullPage, writeChecks } from '../shots/lib/capture.mjs'
let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const iso = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10)
const FIRST = ['Ava', 'Noah', 'Olivia', 'Ethan', 'Isla', 'Lucas', 'Chloe', 'Jack', 'Mia', 'Leo']
const LAST = ['Nguyen', 'Williams', 'Brown', 'Singh', 'Roberts', 'Martin', 'Kelly', 'Taylor', 'Chen', 'Okafor', 'Hall', 'Wong']
const staffRow = (id, first, last, o = {}) => ({
  id, firstName: first, lastName: last, fullName: `${first} ${last}`, username: first.toLowerCase(), role: 'SupportWorker', position: 'SupportWorker', email: null, mobile: null, region: null,
  employmentType: 'Casual', isDriverEligible: false, isFirstAidQualified: false, isCprQualified: false, isMedicationCompetent: false, isManualHandlingCompetent: false, isOvernightEligible: true, isActive: true,
  firstAidExpiryDate: null, cprExpiryDate: null, driverLicenceExpiryDate: null, manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null,
  workerScreeningNumber: 'WWC-1', workerScreeningExpiryDate: iso(400), hasExpiredQualifications: false, notes: null, goalWeeklyHours: null, ...o,
})
const ALEX = staffRow('s-alex', 'Alex', 'Aardvark', { isFirstAidQualified: true, firstAidExpiryDate: iso(-20), isDriverEligible: true, driverLicenceExpiryDate: iso(10), isMedicationCompetent: true, medicationCompetencyExpiryDate: iso(300) })
const BEA = staffRow('s-bea', 'Bea', 'Blank', { isFirstAidQualified: true, firstAidExpiryDate: iso(200), workerScreeningExpiryDate: null })
const ZED = staffRow('s-zed', 'Zed', 'Zulu', { isFirstAidQualified: true, firstAidExpiryDate: iso(250) })
const GENERATED = Array.from({ length: 27 }, (_, i) => {
  const o = i % 4 === 0 ? { isFirstAidQualified: true, firstAidExpiryDate: iso(-5 - i) } : i % 4 === 1 ? { isDriverEligible: true, driverLicenceExpiryDate: iso(12) } : i % 4 === 2 ? { workerScreeningExpiryDate: null } : { isFirstAidQualified: true, firstAidExpiryDate: iso(200) }
  return staffRow(`s-${String(i).padStart(2, '0')}`, FIRST[i % 10], `${LAST[(i * 7 + 3) % 12]}${i}`, o)
})
const ALL_CURRENT = Array.from({ length: 4 }, (_, i) => staffRow(`c-${i}`, FIRST[i], `Current${i}`, { isFirstAidQualified: true, firstAidExpiryDate: iso(250) }))

const checks = []
const check = (name, value, ok) => { checks.push({ name, pass: !!ok, detail: String(value) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value}`) }
const browser = await chromium.launch({ headless: true })

async function open(width, height, { touch = false, role = 'Coordinator', dark = false, staff = [ALEX, BEA, ZED, ...GENERATED], to }) {
  const rows = staff.map((s) => ({ ...s })) // a PUT edits this copy
  const state = { failPut: false, puts: [] }
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce', locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: touch, isMobile: touch })
  await context.addInitScript(([id, theme]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme })) } catch (e) {} }, [USER_ID, dark ? 'dark' : 'light'])
  const page = await context.newPage()
  if (touch) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.on('pageerror', (e) => check(`page error (${width})`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }) }))
  await page.route((u) => u.pathname === '/api/v1/staff', (r) => r.fulfill({ json: envelope(rows) }))
  await page.route((u) => /^\/api\/v1\/staff\/[^/]+$/.test(u.pathname), async (r) => {
    const id = new URL(r.request().url()).pathname.split('/').pop()
    const row = rows.find((s) => s.id === id)
    if (r.request().method() === 'PUT') {
      state.puts.push(r.request().postDataJSON())
      if (state.failPut) return r.fulfill({ status: 500, json: { success: false, data: null, message: 'boom', errors: [] } })
      Object.assign(row, r.request().postDataJSON())
      return r.fulfill({ json: envelope(row) })
    }
    return r.fulfill({ json: envelope(row) })
  })
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' }); await signIn.waitFor({ state: 'visible', timeout: 60000 }); await signIn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  await page.goto(BASE_URL + to, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  if (width >= 1024) await page.waitForFunction(() => { const m = document.querySelector('#main'), a = document.querySelector('aside'); return m && a && m.getBoundingClientRect().left >= a.getBoundingClientRect().right - 1 }, null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(800)
  return { page, state }
}
const NAV = 'nav[aria-label="Staff"]'
const shot = (page, name) => page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) })
const q = (id) => `/qualifications?staff=${id}`

// Resolve a CSS colour variable to [r,g,b] in the page (a probe element, so hex and rgb() both come back as rgb()).
const colourOf = (page, v) => page.evaluate((name) => { const p = document.createElement('i'); p.style.color = `var(${name})`; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c }, v)
const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }

async function dotContrast(page, label) {
  const card = await colourOf(page, '--color-card')
  for (const v of ['--color-destructive', '--color-on-warning-container', '--color-muted-foreground']) {
    const c = contrast(await colourOf(page, v), card)
    check(`5. dot ink ${v} on --color-card >= 3:1 (${label})`, c.toFixed(2), c >= 3)
  }
}

async function desktop() {
  const { page, state } = await open(1280, 800, { to: q('s-alex') })
  await page.locator(NAV).waitFor({ timeout: 30000 })
  await shot(page, 'list-1280-all-with-editor-closed')
  await shot(page, 'detail-1280-not-held-line') // Alex holds no CPR or Manual Handling: the quiet line sits under his table
  const notHeld = await page.getByText(/^Not held:/).textContent()
  check('Not held line names CPR and Manual Handling', notHeld, /CPR/.test(notHeld) && /Manual Handling/.test(notHeld))
  await page.screenshot({ path: path.join(OUT_DIR, 'full', 'page-1280.png') })

  // 1. fits the screen, and the list scrolls inside itself
  const m0 = await page.evaluate(() => { const f = document.querySelector('footer'); return { over: document.scrollingElement.scrollHeight - innerHeight, foot: f ? Math.round(f.getBoundingClientRect().height) : 0, fit: !!document.querySelector('[data-fit-screen]') } })
  check('1. page fits the screen (AppLayout data-fit-screen): overflow <= footer + 1', JSON.stringify(m0), m0.fit && m0.over <= m0.foot + 1)
  const ul = page.locator(`${NAV} ul`)
  const l0 = await ul.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  check('1. list ul overflows its scroller', JSON.stringify(l0), l0.sh > l0.ch)
  await ul.evaluate((el) => { el.scrollTop = 9999 })
  const last = await page.evaluate((nav) => { const u = document.querySelector(`${nav} ul`).getBoundingClientRect(), a = [...document.querySelectorAll(`${nav} ul a`)].pop().getBoundingClientRect(); return { aBottom: Math.round(a.bottom), uBottom: Math.round(u.bottom) } }, NAV)
  check('1. after scrollTop = 9999 the last row is visible', JSON.stringify(last), last.aBottom <= last.uBottom + 1)
  await ul.evaluate((el) => { el.scrollTop = 0 })

  // 6. exactly one current row, painted --color-accent
  const cur = await page.evaluate((nav) => { const c = [...document.querySelectorAll(`${nav} a[aria-current="page"]`)]; return { n: c.length, bg: c[0] && getComputedStyle(c[0]).backgroundColor } }, NAV)
  const accent = await page.evaluate(() => { const p = document.createElement('i'); p.style.backgroundColor = 'var(--color-accent)'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c })
  check('6. exactly one aria-current row, background --color-accent', `${cur.n} ${cur.bg} vs ${accent}`, cur.n === 1 && cur.bg === accent)

  // 7. ArrowDown moves focus, not the URL
  const url0 = page.url()
  await page.locator(`${NAV} a[aria-current="page"]`).focus()
  await page.keyboard.press('ArrowDown')
  const focused = await page.evaluate(() => document.activeElement?.tagName + ' ' + (document.activeElement?.textContent || '').slice(0, 20))
  check('7. ArrowDown moves focus to the next link, URL unchanged', `${focused}; url same ${page.url() === url0}`, /^A /.test(focused) && page.url() === url0)

  // 3 + editing. The date input is --control-h tall (32 on a fine pointer).
  const headerXs = () => page.locator('table th').evaluateAll((ths) => ths.map((t) => Math.round(t.getBoundingClientRect().x)))
  const xsBefore = await headerXs()
  await page.getByRole('button', { name: /^Edit: First Aid, Alex Aardvark$/ }).click()
  const input = page.getByLabel('Expiry date')
  await input.waitFor({ timeout: 5000 })
  const h = await input.evaluate((el) => ({ h: el.offsetHeight, v: getComputedStyle(document.documentElement).getPropertyValue('--control-h').trim() }))
  check('3. open date input height equals --control-h (fine pointer)', JSON.stringify(h), h.h === parseInt(h.v, 10))
  const focusIn = await input.evaluate((el) => document.activeElement === el)
  check('date input takes focus on open', focusIn, focusIn)
  await shot(page, 'detail-1280-editing')
  await shot(page, 'qual-editor-open-1280')
  const xsAfter = await headerXs()
  check('N1. every table header x is the same before and after the editor opens (1 px)', `${xsBefore} -> ${xsAfter}`, xsBefore.length > 1 && xsBefore.length === xsAfter.length && xsBefore.every((x, i) => Math.abs(x - xsAfter[i]) <= 1))

  // save error: the editor stays open with the typed value and an alert
  await input.fill(iso(365))
  state.failPut = true
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('alert').filter({ hasText: 'Failed to save' }).waitFor({ timeout: 10000 })
  const kept = await input.inputValue()
  check('failed save keeps the typed value in the open editor', kept, kept === iso(365))
  await shot(page, 'detail-1280-save-error')
  state.failPut = false
  await page.getByRole('button', { name: 'Cancel' }).click()

  // Add date on a missing screening
  await page.goto(BASE_URL + q('s-bea'), { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /^Add date: Worker Screening, Bea Blank$/ }).click()
  await page.getByLabel('Expiry date').waitFor({ timeout: 5000 })
  await shot(page, 'detail-1280-add-date-missing')

  // Needs attention keeps the selected person; Flo-style: Zed has no issue and stays listed while selected
  await page.goto(BASE_URL + '/qualifications?show=attention&staff=s-zed', { waitUntil: 'domcontentloaded' })
  await page.locator(NAV).waitFor({ timeout: 30000 })
  const zedListed = await page.locator(`${NAV} a[aria-current="page"]`).textContent()
  check('Needs attention keeps the selected person listed', zedListed, /Zed Zulu/.test(zedListed))
  await shot(page, 'end-of-list-next-disabled-1280')
  const nextDisabled = await page.getByRole('button', { name: 'Next', exact: true }).isDisabled()
  check('at the last person Next is disabled', nextDisabled, nextDisabled)

  await page.goto(BASE_URL + '/qualifications?show=attention&staff=s-alex', { waitUntil: 'domcontentloaded' })
  await page.locator(NAV).waitFor({ timeout: 30000 })
  await shot(page, 'list-1280-needs-attention')

  // N3: a direct ?staff= load of the last person scrolls their row into the list's view
  await page.goto(BASE_URL + q('s-zed'), { waitUntil: 'domcontentloaded' })
  await page.locator(NAV + ' a[aria-current="page"]').waitFor({ timeout: 30000 })
  await page.waitForTimeout(300)
  const zedVis = await page.evaluate((nav) => { const a = document.querySelector(nav + ' a[aria-current="page"]').getBoundingClientRect(); const u = document.querySelector(nav + ' ul').getBoundingClientRect(); return { aTop: Math.round(a.top), aBottom: Math.round(a.bottom), uTop: Math.round(u.top), uBottom: Math.round(u.bottom) } }, NAV)
  check('N3. direct ?staff= load: the selected row is inside the list view', JSON.stringify(zedVis), zedVis.aTop >= zedVis.uTop - 1 && zedVis.aBottom <= zedVis.uBottom + 1)
  await shot(page, 'qual-direct-staff-1280')

  await page.goto(BASE_URL + q('s-alex'), { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Search staff').fill('zzzz')
  await page.getByText(/^No staff match/).waitFor({ timeout: 5000 })
  await shot(page, 'search-no-match-1280')
  await dotContrast(page, 'light')
  await page.context().close()
}

async function coarseSizes(page, label) {
  const tapMin = await page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tap-min'), 10))
  const sizes = await page.evaluate(() => {
    const hOf = (el) => Math.round(el.getBoundingClientRect().height)
    const btn = (re) => [...document.querySelectorAll('main button')].filter((b) => re.test(b.textContent.trim())).map(hOf)
    return { rows: [...document.querySelectorAll('nav[aria-label="Staff"] a')].map(hOf), prev: btn(/Previous/), next: btn(/^Next/), edit: btn(/^(Edit|Add date)$/) }
  })
  return { tapMin, sizes }
}

async function mobile() {
  const { page } = await open(390, 844, { touch: true, to: '/qualifications' })
  await page.locator(NAV).waitFor({ timeout: 30000 })
  const list = await coarseSizes(page, 'list')
  check('4. coarse: every list row >= --tap-min', `${list.tapMin}: min ${Math.min(...list.sizes.rows)}`, list.sizes.rows.length > 0 && Math.min(...list.sizes.rows) >= list.tapMin)
  const w0 = await page.evaluate(() => document.documentElement.scrollWidth)
  check('2. 390 list step: scrollWidth <= 390', w0, w0 <= 390)
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'list-390.png'), { touch: true })).checks)

  await page.goto(BASE_URL + q('s-alex'), { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Previous/ }).waitFor({ timeout: 30000 })
  const back = await page.getByRole('button', { name: /staff/i }).first().isVisible().catch(() => false)
  check('390 detail step shows the Back to staff control', back, back)
  const det = await coarseSizes(page, 'detail')
  const all = [...det.sizes.prev, ...det.sizes.next, ...det.sizes.edit]
  check('4. coarse: Previous, Next, Edit and Add date >= --tap-min', `${det.tapMin}: min ${Math.min(...all)} of ${all.length}`, all.length >= 3 && Math.min(...all) >= det.tapMin)
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'detail-390-with-back-and-prev-next.png'), { touch: true })).checks)

  await page.getByRole('button', { name: /^Edit: First Aid, Alex Aardvark$/ }).click()
  const input = page.getByLabel('Expiry date')
  await input.waitFor({ timeout: 5000 })
  const h = await input.evaluate((el) => ({ h: el.offsetHeight, v: getComputedStyle(document.documentElement).getPropertyValue('--control-h').trim() }))
  check('3. open date input height equals --control-h (coarse: 44)', JSON.stringify(h), h.h === parseInt(h.v, 10) && h.h === 44)
  const w1 = await page.evaluate(() => document.documentElement.scrollWidth)
  check('2. 390 detail step with the editor open: scrollWidth <= 390', w1, w1 <= 390)
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'detail-390-editing.png'), { touch: true })).checks)
  await page.context().close()
}

try {
  await desktop()
  { // nobody needs attention
    const { page } = await open(1280, 800, { staff: ALL_CURRENT, to: '/qualifications?show=attention' })
    await page.getByText('All qualifications are current').waitFor({ timeout: 30000 })
    await shot(page, 'needs-attention-empty-1280')
    await page.context().close()
  }
  { // ReadOnly: the same list and detail, no edit controls
    const { page } = await open(1280, 800, { role: 'ReadOnly', to: q('s-alex') })
    await page.locator(NAV).waitFor({ timeout: 30000 })
    const writes = await page.getByRole('button', { name: /^(Edit|Add date)/ }).count()
    check('reader sees no Edit or Add date', writes, writes === 0)
    await shot(page, 'reader-1280')
    await page.context().close()
  }
  { // dark
    const { page } = await open(1280, 800, { dark: true, to: q('s-alex') })
    await page.locator(NAV).waitFor({ timeout: 30000 })
    await shot(page, 'dark-1280')
    await dotContrast(page, 'dark')
    await page.context().close()
  }
  await mobile()
} finally {
  writeChecks(OUT_DIR, checks)
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
process.exit(failed.length ? 1 : 0)
