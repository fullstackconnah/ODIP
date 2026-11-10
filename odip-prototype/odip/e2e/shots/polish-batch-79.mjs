// PB79 shots: a pattern's Regular picker respects a worker marked No (R8 N2). States: pattern-regular-open-1280, pattern-regular-open-390 (touch),
// patterns-edit-1280 and patterns-edit-390 (one full page each, the slide-over open on a pattern whose saved Regular is now marked No).
// Fixture: Alex Rivera with four workers mocked at the routes; Sam is Excluded, Morgan Preferred #1, Dana Backup #1, Casey unlisted. The compatibility route is a page.route, mock-api is untouched.
// Numeric checks: Unassigned first; Sam is the last option, aria-disabled="true" (the house SearchableSelect's marker) and says "marked No for this participant"; the others are not disabled;
// an edited pattern whose saved Regular is Sam shows "Sam Taylor" in the closed field and Sam's option is not disabled; every option row is at least --tap-min tall at 390; the helper's layout checks pass.
import path from 'node:path'
import { prepareOutDir, cropElement, checkCropHolds, fullPage, writeChecks } from '../shots/lib/capture.mjs'
let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const PARTICIPANT = { id: 'p-1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera' }
const STAFF = [['s-1', 'Sam', 'Taylor'], ['s-2', 'Morgan', 'Lee'], ['s-3', 'Casey', 'Wong'], ['s-4', 'Dana', 'Fox']]
  .map(([id, f, l]) => ({ id, firstName: f, lastName: l, fullName: `${f} ${l}`, username: id, role: 'SupportWorker', position: 'SupportWorker', isActive: true }))
const row = (s, level, rank) => ({ staffId: s.id, staffName: s.fullName, participantId: PARTICIPANT.id, participantName: PARTICIPANT.fullName, level, rank, reason: null, updatedAt: '2026-10-01T00:00:00Z' })
const COMPAT = [row(STAFF[0], 'Excluded', 0), row(STAFF[1], 'Preferred', 1), row(STAFF[3], 'Backup', 1)]
const pattern = (id, day, staff) => ({ id, participantId: PARTICIPANT.id, participantName: PARTICIPANT.fullName, defaultStaffId: staff.id, defaultStaffName: staff.fullName, dayOfWeek: day, startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false,
  ratio: 'OneToOne', nightType: 'None', effectiveFrom: '2026-01-05', effectiveTo: null, isActive: true, notes: null })
const PATTERNS = [pattern('pat-open', 'Monday', STAFF[2]), pattern('pat-no', 'Tuesday', STAFF[0])]
const NO_TEXT = 'marked No for this participant'

const checks = []
const check = (name, value, ok) => { checks.push({ name, pass: !!ok, detail: String(value) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value}`) }
const browser = await chromium.launch({ headless: true })

async function open(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: touch, isMobile: touch })
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch (e) {} }, [USER_ID])
  const page = await context.newPage()
  if (touch) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.on('pageerror', (e) => check(`page error (${width})`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role: 'Coordinator', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role: 'Coordinator', tenantName: 'Sample Support Co' }) }))
  await page.route((u) => u.pathname === '/api/v1/staff', (r) => r.fulfill({ json: envelope(STAFF) }))
  await page.route((u) => u.pathname === '/api/v1/participants', (r) => r.fulfill({ json: envelope({ items: [PARTICIPANT], totalCount: 1, page: 1, pageSize: 500, totalPages: 1, hasNext: false, hasPrevious: false }) }))
  await page.route((u) => u.pathname === '/api/v1/rostering/compatibility', (r) => r.fulfill({ json: envelope(new URL(r.request().url()).searchParams.get('participantId') === PARTICIPANT.id ? COMPAT : []) }))
  await page.route(/\/api\/v1\/rostering\/patterns(\?.*)?$/, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: envelope(PATTERNS) }) : r.fallback()))
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' }); await signIn.waitFor({ state: 'visible', timeout: 60000 }); await signIn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  await page.goto(BASE_URL + '/rostering/patterns', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  return page
}

// From md up the row actions are icon buttons; on a phone they are one More actions menu (RowMenu in DataTable).
async function editPattern(page, day, touch) {
  if (touch) {
    const more = page.getByRole('button', { name: new RegExp(`^More actions for .*${day}`) }).first()
    await more.waitFor({ state: 'visible', timeout: 60000 })
    await more.click()
    await page.getByText('Edit pattern', { exact: true }).click()
  } else {
    const edit = page.getByRole('button', { name: new RegExp(`^Edit .*${day}.* pattern`) }).first()
    await edit.waitFor({ state: 'visible', timeout: 60000 })
    await edit.click()
  }
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 30000 })
  const field = dialog.getByRole('combobox', { name: 'Regular' })
  await field.waitFor({ timeout: 30000 })
  return { dialog, field }
}

// The Regular list, read in the page: option texts in order and each option's aria-disabled marker and height.
const readOptions = (page) => page.getByRole('option').evaluateAll((els) => els.map((el) => ({ text: el.textContent.trim(), disabled: el.getAttribute('aria-disabled'), height: el.getBoundingClientRect().height })))

async function listState(width, height, touch) {
  const bp = String(width)
  const page = await open(width, height, touch)
  const { field } = await editPattern(page, 'Monday', touch)
  check(`closed field shows Casey Wong (${bp})`, await field.inputValue(), (await field.inputValue()) === 'Casey Wong')
  await field.click()
  const listbox = page.getByRole('listbox')
  await listbox.waitFor({ timeout: 30000 })
  await page.getByRole('option', { name: /Sam Taylor/ }).waitFor({ timeout: 30000 })
  const options = await readOptions(page)
  const texts = options.map((o) => o.text)
  check(`Unassigned first (${bp})`, texts[0], texts[0] === 'Unassigned')
  const no = options[options.length - 1]
  check(`No worker is the last option (${bp})`, texts.join(' | '), /^Sam Taylor/.test(no.text))
  check(`No worker's option has aria-disabled="true" (${bp})`, no.disabled, no.disabled === 'true')
  check(`No worker's option says "${NO_TEXT}" (${bp})`, no.text, no.text.includes(NO_TEXT))
  check(`the other options are not disabled (${bp})`, options.slice(0, -1).map((o) => o.disabled).join(','), options.slice(0, -1).every((o) => o.disabled === null))
  check(`ranked workers say where they stand (${bp})`, texts.join(' | '), texts.some((t) => t.includes('Preferred #1 for this participant')) && texts.some((t) => t.includes('Backup #1 for this participant')))
  if (touch) {
    // --tap-min is 0px on a fine pointer and the touch floor on a coarse one: read what it resolves to here.
    const tapMin = await page.evaluate(() => { const p = document.createElement('div'); p.style.minHeight = 'var(--tap-min)'; document.body.appendChild(p); const h = parseFloat(getComputedStyle(p).minHeight); p.remove(); return h })
    check(`--tap-min resolves to a touch floor (${bp})`, tapMin, tapMin >= 40)
    check(`every option row is at least --tap-min tall (${bp})`, options.map((o) => Math.round(o.height)).join(','), options.every((o) => o.height >= tapMin - 0.5))
  }
  const r = await cropElement(page, listbox, path.join(OUT_DIR, `pattern-regular-open-${bp}.png`), { pad: 16, touch, also: field })
  checks.push(checkCropHolds(r))
  await page.context().close()
}

async function editState(width, height, touch) {
  const bp = String(width)
  const page = await open(width, height, touch)
  const { field } = await editPattern(page, 'Tuesday', touch)
  check(`edited pattern shows its saved Regular, now marked No (${bp})`, await field.inputValue(), (await field.inputValue()) === 'Sam Taylor')
  await field.click()
  await page.getByRole('listbox').waitFor({ timeout: 30000 })
  const sam = (await readOptions(page)).find((o) => o.text.startsWith('Sam Taylor'))
  check(`the saved Regular's option is not disabled, and still says why (${bp})`, JSON.stringify(sam), !!sam && sam.disabled === null && sam.text.includes(NO_TEXT))
  await page.keyboard.press('Escape')   // closes the list; the panel stays
  await page.getByRole('listbox').waitFor({ state: 'detached', timeout: 10000 })
  await page.getByRole('dialog').waitFor({ timeout: 10000 })
  // The panel scrolls inside and its footer sits over the last field on a short phone; shoot it tall so the whole form shows and nothing sits under the footer.
  if (touch) await page.setViewportSize({ width, height: 1700 })
  const r = await fullPage(page, path.join(OUT_DIR, 'full', `patterns-edit-${bp}.png`), { touch })
  checks.push(...r.checks)
  await page.context().close()
}

try {
  await listState(1280, 900, false)
  await listState(390, 844, true)
  await editState(1280, 900, false)
  await editState(390, 844, true)
} finally {
  writeChecks(OUT_DIR, checks)
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
process.exit(failed.length ? 1 : 0)
