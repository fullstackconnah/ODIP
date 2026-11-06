// CRO shots: the Compatibility "No" reason is optional. States: dialog-blank-390 (touch), dialog-typed-1280, card-no-reason-1280, table-no-reason-1280, plus a full page at 390 touch and at 1280.
// Fixture: 2 participants x 3 staff mocked at the route; the Excluded pair Sam/Alex has no reason. Numeric checks: the primary is enabled with a blank reason, the label carries "(optional)", the No card shows no "Reason" element.
import path from 'node:path'
import { prepareOutDir, cropElement, fullPage, writeChecks } from '../shots/lib/capture.mjs'
let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const PARTICIPANTS = [{ id: 'p-1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera' }, { id: 'p-2', firstName: 'Jamie', lastName: 'Chen', fullName: 'Jamie Chen' }]
const STAFF = [['s-1', 'Sam', 'Taylor'], ['s-2', 'Morgan', 'Lee'], ['s-3', 'Casey', 'Wong']].map(([id, f, l]) => ({ id, firstName: f, lastName: l, fullName: `${f} ${l}`, username: id, role: 'SupportWorker', position: 'SupportWorker', isActive: true }))
const mkRow = (p, s, level, rank, reason) => ({ staffId: s.id, staffName: s.fullName, participantId: p.id, participantName: p.fullName, level, rank, reason, updatedAt: '2026-10-01T00:00:00Z' })
const ROWS = [mkRow(PARTICIPANTS[0], STAFF[0], 'Excluded', 0, null), mkRow(PARTICIPANTS[0], STAFF[1], 'Preferred', 1, 'Knows the routine'), mkRow(PARTICIPANTS[1], STAFF[2], 'Backup', 1, null)]

const checks = []
const check = (name, value, ok) => { checks.push({ name, pass: !!ok, detail: String(value) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value}`) }
const browser = await chromium.launch({ headless: true })

async function open(width, height, touch, to) {
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
  await page.route((u) => u.pathname === '/api/v1/participants', (r) => r.fulfill({ json: envelope({ items: PARTICIPANTS, totalCount: 2, page: 1, pageSize: 500, totalPages: 1, hasNext: false, hasPrevious: false }) }))
  await page.route((u) => u.pathname === '/api/v1/rostering/compatibility', (r) => r.fulfill({ json: envelope(ROWS) }))
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' }); await signIn.waitFor({ state: 'visible', timeout: 60000 }); await signIn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  await page.goto(BASE_URL + to, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1000)
  return page
}

// Opens the Mark as No dialog with the pair chosen and the reason blank.
async function openDialog(page) {
  await page.getByRole('button', { name: 'Mark as No' }).first().click()
  const dialog = page.getByRole('alertdialog')
  await dialog.waitFor({ timeout: 15000 })
  await dialog.getByLabel(/^Staff/).click()
  await page.getByRole('option', { name: 'Morgan Lee' }).click()
  await dialog.getByLabel(/^Participant/).click()
  await page.getByRole('option', { name: 'Jamie Chen' }).click()
  return dialog
}

async function dialogState(width, height, touch, typed) {
  const bp = String(width)
  // Below md the table falls back to the board, so the 390 state opens the board.
  const page = await open(width, height, touch, touch ? '/rostering/compatibility?participant=p-1' : '/rostering/compatibility?view=table')
  await (touch ? page.locator('h2', { hasText: 'Alex Rivera' }) : page.getByRole('grid')).waitFor({ timeout: 30000 })
  const dialog = await openDialog(page)
  const reason = dialog.getByLabel('Reason (optional)')
  check(`Reason label carries the optional marker (${bp})`, await reason.count(), (await reason.count()) === 1)
  if (typed) await reason.fill('Asked to be rostered apart')
  else check(`primary is enabled with a blank reason (${bp})`, await dialog.getByRole('button', { name: 'Mark as No' }).isDisabled(), !(await dialog.getByRole('button', { name: 'Mark as No' }).isDisabled()))
  const r = await cropElement(page, dialog, path.join(OUT_DIR, `dialog-${typed ? 'typed' : 'blank'}-${bp}.png`), { pad: 16, touch })
  check(`dialog crop holds (${bp})`, JSON.stringify(r.clip), r.clip.width > 100)
  await page.context().close()
}

async function boardAndTable() {
  const page = await open(1280, 900, false, '/rostering/compatibility?participant=p-1')
  const card = page.locator('h2', { hasText: 'Alex Rivera' }).locator('xpath=..')
  await card.waitFor({ timeout: 30000 })
  await page.getByText('Sam Taylor').first().waitFor({ timeout: 15000 })
  const bad = await card.evaluate((el) => [...el.querySelectorAll('*')].filter((e) => /^Reason:?$/.test((e.textContent || '').trim())).length)
  check('No card with no reason has no "Reason" element', bad, bad === 0)
  const r = await cropElement(page, card, path.join(OUT_DIR, 'card-no-reason-1280.png'), { pad: 16, touch: false })
  check('card crop holds', JSON.stringify(r.clip), r.clip.width > 100)
  await fullPage(page, path.join(OUT_DIR, 'full', 'page-1280.png'), { touch: false })
  await page.goto(BASE_URL + '/rostering/compatibility?view=table', { waitUntil: 'domcontentloaded' })
  const grid = page.getByRole('grid')
  await grid.waitFor({ timeout: 30000 })
  const gridBad = await grid.evaluate((el) => [...el.querySelectorAll('*')].filter((e) => /^Reason:?$/.test((e.textContent || '').trim())).length)
  check('table with a No and no reason has no "Reason" element', gridBad, gridBad === 0)
  await cropElement(page, grid, path.join(OUT_DIR, 'table-no-reason-1280.png'), { pad: 16, touch: false })
  await page.context().close()
}

async function mobileFull() {
  const page = await open(390, 844, true, '/rostering/compatibility?participant=p-1')
  await page.locator('h2', { hasText: 'Alex Rivera' }).waitFor({ timeout: 30000 })
  const r = await fullPage(page, path.join(OUT_DIR, 'full', 'page-390.png'), { touch: true })
  checks.push(...r.checks)
  await page.context().close()
}

try {
  await dialogState(390, 844, true, false)
  await dialogState(1280, 900, false, true)
  await boardAndTable()
  await mobileFull()
} finally {
  writeChecks(OUT_DIR, checks)
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
process.exit(failed.length ? 1 : 0)
