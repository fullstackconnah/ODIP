// Captures and numeric checks for the incident form's restrictive practice list (every register entry, with its kind). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to this script> <outdir>
// The register comes from page.route stubs over the mock API (synthetic names). Crops go through cropElement (chrome-aware); exits non-zero when a check fails.
import path from 'node:path'
import { AU_CONTEXT, cropElement, checkCropHolds, fullPage, prepareOutDir, writeChecks } from './lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const who = {
  users: envelope([{ username: 'dev.user', role: 'Admin', tenantName: 'Sample Support Co' }]),
  login: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role: 'Admin', tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' }),
}

const PID = 'p-0001'
const NAME = 'Liam Okafor'
const entry = (o) => ({
  id: 'rp', participantId: PID, type: 'PhysicalRestraint', description: '', authorisedBy: 'Dr Chen', authorisationDate: '2026-08-01', reviewDate: null,
  relatedMedicationId: null, relatedMedicationName: null, requiresReporting: true, isActive: true, isAuthorised: true,
  authorisationEndDate: null, useKind: 'Routine', firstUsedOn: null, interimBspDate: null, comprehensiveBspDate: null, earliestRecordedUseDate: null,
  interimBspDueOn: null, comprehensiveBspDueOn: null, interimBspState: 'NotStarted', comprehensiveBspState: 'NotStarted',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o,
})
const ACTIVE = [
  entry({ id: 'rp-hold', type: 'PhysicalRestraint', description: 'Two-person hold during transfers.', reviewDate: '2027-02-01' }),
  entry({ id: 'rp-guide', type: 'PhysicalRestraint', description: 'Arm guide at the kerb, used only when the road is close and the participant has stopped responding to prompts.', isAuthorised: false, authorisedBy: null, authorisationDate: null }),
  entry({ id: 'rp-room', type: 'Seclusion', description: 'Quiet room during acute crisis.' }),
]
const INACTIVE = entry({ id: 'rp-old', type: 'ChemicalRestraint', description: 'Old as-needed plan, retired.', isActive: false })
const KIND = { 'rp-hold': 'Physical restraint', 'rp-guide': 'Physical restraint', 'rp-room': 'Seclusion' }
const TYPE_FIELD = /Restrictive Practice Type/

const checks = []
const add = (name, pass, detail) => checks.push({ name, pass, detail })

const browser = await chromium.launch({ headless: true })
// One signed-in session; `register` is read by the stub on every request, so a state with an empty register is a fresh session.
async function session(vp, { register = [...ACTIVE], scheme = 'light' } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, reducedMotion: 'reduce', colorScheme: scheme })
  const page = await context.newPage()
  const cdp = vp.mobile ? await context.newCDPSession(page) : null
  const pin = async () => {
    await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  await pin()
  page.on('pageerror', (e) => add(`${vp.name} page error`, false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: who.users }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: who.login }))
  await page.route(new RegExp(`/api/v1/participants/${PID}/restrictive-practices(\\?.*)?$`), (r) => {
    const all = /includeInactive=true/i.test(r.request().url())
    return r.fulfill({ json: envelope(all ? [...register, INACTIVE] : register) })
  })
  await page.route(new RegExp(`/api/v1/participants/${PID}/medications(\\?.*)?$`), (r) => r.fulfill({ json: envelope([]) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await pin()
  await page.goto(`${BASE_URL}/incidents/new`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByPlaceholder('Brief incident summary').fill('Held at the kerb')
  await page.getByLabel('Involved Participant').click()
  await page.getByRole('option', { name: NAME }).click()
  await page.getByLabel('Incident Type *', { exact: true }).click()
  await page.getByRole('option', { name: /Restrictive Practice Use/i }).click()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('radiogroup', { name: 'Which practice was used?' }).waitFor({ timeout: 60_000 })
  return { context, page }
}

const fieldset = (page) => page.locator('fieldset', { has: page.getByRole('radiogroup', { name: 'Which practice was used?' }) })
async function crop(page, state) {
  const r = await cropElement(page, fieldset(page), path.join(OUT_DIR, `${state}.png`), { pad: 16, hideChrome: true })
  checks.push(checkCropHolds(r))
}
const noOverflow = async (page, state) => {
  const m = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }))
  add(`${state}: no horizontal overflow (${m.sw} <= ${m.iw})`, m.sw <= m.iw, m)
}
const typeCount = (page) => page.getByLabel(TYPE_FIELD).count()
// Each row's leading kind label matches its type; every row is at least --tap-min high (44 on touch, 0 with a mouse).
async function rowChecks(page, state) {
  const rows = await page.locator('[role="radiogroup"] label').evaluateAll((els) => els.map((l) => ({
    text: l.innerText, h: l.getBoundingClientRect().height, kind: l.querySelector('span span')?.textContent ?? '',
  })))
  const tapMin = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')) || 0)
  const entries = ACTIVE.map((e) => ({ id: e.id, desc: e.description, kind: KIND[e.id] }))
  const wrong = entries.filter((e) => !rows.some((r) => r.text.includes(e.desc.slice(0, 20)) && r.kind === e.kind))
  add(`${state}: every row leads with its kind`, rows.length === ACTIVE.length + 1 && wrong.length === 0, { rows: rows.map((r) => r.kind || r.text.slice(0, 12)), wrong: wrong.map((w) => w.id) })
  const order = rows.slice(0, -1).map((r) => r.kind)
  add(`${state}: sorted by kind`, JSON.stringify(order) === JSON.stringify([...order].sort((a, b) => a.localeCompare(b))), order)
  const short = rows.filter((r) => r.h < tapMin - 0.5)
  add(`${state}: rows >= --tap-min (${tapMin})`, short.length === 0, rows.map((r) => Math.round(r.h)))
}

// 1280
{
  const { context, page } = await session({ name: '1280', width: 1280, height: 800 })
  await rowChecks(page, '1280 list')
  add('1280 list: no type dropdown before a pick', (await typeCount(page)) === 0, await typeCount(page))
  await crop(page, 'list-several-1280')

  await page.getByRole('radio', { name: /Quiet room during acute crisis/ }).check()
  add('1280 practice picked: no type dropdown', (await typeCount(page)) === 0, await typeCount(page))
  await crop(page, 'practice-picked-1280')

  await page.getByRole('radio', { name: /None of these/ }).check()
  const dd = await typeCount(page)
  const ta = await page.getByLabel(/Describe the restrictive practice that was used/).count()
  add('1280 none picked: type dropdown and details box both present', dd === 1 && ta === 1, { dd, ta })
  add('1280 none picked: the type kept from the pick', (await page.getByLabel(TYPE_FIELD).innerText()).includes('Seclusion'), await page.getByLabel(TYPE_FIELD).innerText())
  await crop(page, 'none-picked-1280')

  await page.getByRole('radio', { name: /Quiet room during acute crisis/ }).check()
  await page.getByRole('button', { name: /Show inactive\/retired practices/ }).click()
  await page.getByText('Old as-needed plan, retired.').waitFor()
  const retired = await page.getByText('Old as-needed plan, retired.').locator('..').innerText()
  add('1280 inactive shown: lists the retired entry with its kind', /Chemical restraint/.test(retired), retired)
  await crop(page, 'inactive-shown-1280')
  const full = await fullPage(page, path.join(OUT_DIR, 'full-page-1280.png'), { touch: false })
  checks.push(...full.checks)
  await context.close()
}
{
  const { context, page } = await session({ name: '1280', width: 1280, height: 800 }, { register: [] })
  add('1280 none on register: only "None of these", already picked', (await page.getByRole('radio').count()) === 1 && await page.getByRole('radio', { name: /None of these/ }).isChecked(), await page.getByRole('radio').count())
  const dd = await typeCount(page)
  const ta = await page.getByLabel(/Describe the restrictive practice that was used/).count()
  add('1280 none on register: type dropdown and details box both present', dd === 1 && ta === 1, { dd, ta })
  await crop(page, 'none-on-register-1280')
  await context.close()
}
{
  const { context, page } = await session({ name: '1280-dark', width: 1280, height: 800 }, { scheme: 'dark' })
  await page.getByRole('radio', { name: /Two-person hold/ }).check()
  await crop(page, 'dark-1280')
  await context.close()
}
// 390 touch
{
  const { context, page } = await session({ name: '390', width: 390, height: 844, mobile: true })
  await rowChecks(page, '390 list')
  await noOverflow(page, '390 list')
  await crop(page, 'list-several-390')
  await page.getByRole('radio', { name: /None of these/ }).check()
  const dd = await typeCount(page)
  const ta = await page.getByLabel(/Describe the restrictive practice that was used/).count()
  add('390 none picked: type dropdown and details box both present', dd === 1 && ta === 1, { dd, ta })
  await noOverflow(page, '390 none picked')
  await crop(page, 'none-picked-390')
  const full = await fullPage(page, path.join(OUT_DIR, 'full-page-390-touch.png'), { touch: true })
  checks.push(...full.checks)
  await context.close()
}

await browser.close()
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
