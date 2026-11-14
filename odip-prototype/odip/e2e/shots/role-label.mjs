// Role label on Settings > Profile: a SuperAdmin's Role fact reads "Super Admin" (the shared roleLabel), with no horizontal overflow in its row. A SupportWorker cannot open Settings, so SuperAdmin is the signed-in role.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/role-label.mjs <outdir>
// Sign-in, profile and settings are stubbed with page.route as in settings-my-account.mjs. Prints "CHECK ok|FAIL name = value", writes checks.json, exits non-zero on a failure.
import path from 'node:path'
import { cropElement, fullPage, checkCropHolds, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const EMAIL = 'jane.sample@example.com'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const PROFILE = { firstName: 'Jane', lastName: 'Sample', email: EMAIL, mobile: '0400 000 000', managedByEmploymentHero: false }
const login = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Jane Sample', role, tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' })


const browser = await chromium.launch({ headless: true })

/** One signed-in page on `section`; `state` holds the stubs' rows and knobs. */
const open = async ({ role = 'Coordinator', width, height, touch, scheme = 'light', section, profile = {}, sessionLengthMinutes = null, reset = 'ok' }) => {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: !!touch, isMobile: !!touch, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: scheme, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const state = { profile: { ...PROFILE, ...profile }, sessionLengthMinutes, reset, bodies: [], securityBodies: [] }
  await page.route(/\/src\/lib\/firebase\.ts(\?.*)?$/, async (r) => {
    const res = await r.fetch()
    const body = (await res.text()).replace(/missingEnvVars\.length\s*===\s*0/, () => 'true').replace(/import\.meta\.env\.VITE_FIREBASE_(\w+)/g, (_m, k) => `"stub-${k}"`)
    await r.fulfill({ response: res, body })
  })
  await page.route('**/identitytoolkit.googleapis.com/**', (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
    if (!r.request().url().includes('accounts:sendOobCode')) return r.fulfill({ json: {}, headers: CORS })
    if (state.reset === 'ok') return r.fulfill({ json: { email: EMAIL }, headers: CORS })
    const message = state.reset === 'too-many' ? 'TOO_MANY_ATTEMPTS_TRY_LATER' : 'INVALID_EMAIL'
    return r.fulfill({ status: 400, json: { error: { code: 400, message, errors: [{ message, domain: 'global', reason: 'invalid' }] } }, headers: CORS })
  })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role) }))
  await page.route(/\/api\/v1\/profile(\?.*)?$/, (r) => {
    const req = r.request()
    if (req.method() === 'GET') return r.fulfill({ json: envelope(state.profile) })
    state.bodies.push(JSON.parse(req.postData() ?? '{}'))
    const b = state.bodies.at(-1)
    state.profile = { ...state.profile, firstName: b.firstName, lastName: b.lastName, mobile: b.mobile }
    return r.fulfill({ json: envelope(state.profile) })
  })
  await page.route(/\/api\/v1\/settings(\?.*)?$/, (r) => r.fulfill({ json: envelope({ qualificationWarningDays: 30, weeklyHoursWarning: 38, sessionLengthMinutes: state.sessionLengthMinutes }) }))
  await page.route(/\/api\/v1\/settings\/security$/, (r) => {
    state.securityBodies.push(JSON.parse(r.request().postData() ?? '{}'))
    return r.fulfill({ json: envelope({ qualificationWarningDays: 30, weeklyHoursWarning: 38, sessionLengthMinutes: state.securityBodies.at(-1).sessionLengthMinutes }) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/settings?section=${section}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const region = page.getByRole('region', { name: section === 'security' ? 'Security' : 'Profile', exact: true })
  await region.waitFor({ timeout: 60_000 })
  const foot = page.getByRole('button', { name: /^(Save changes|Saving)/ }).locator('xpath=..')
  return { context, page, state, region, foot, touch: !!touch }
}

const ROLE_TEXT = 'Super Admin'
const checks = []
try {
  for (const vp of [{ width: 390, height: 844, touch: true, sfx: '390-touch' }, { width: 1280, height: 900, sfx: '1280' }]) {
    const p = await open({ role: 'SuperAdmin', width: vp.width, height: vp.height, touch: vp.touch, section: 'profile' })
    const dd = p.region.getByText('Role', { exact: true }).locator('xpath=following-sibling::dd[1]')
    await dd.waitFor({ timeout: 60_000 })
    const text = (await dd.textContent())?.trim()
    const row = await dd.evaluate((el) => { const dl = el.closest('dl'); return { scrollWidth: dl.scrollWidth, clientWidth: dl.clientWidth, ddScroll: el.scrollWidth, ddClient: el.clientWidth } })
    checks.push({ name: `Role fact reads "${ROLE_TEXT}" [${vp.sfx}]`, pass: text === ROLE_TEXT, detail: { text } })
    checks.push({ name: `Role row has no horizontal overflow [${vp.sfx}]`, pass: row.scrollWidth <= row.clientWidth && row.ddScroll <= row.ddClient, detail: row })
    const r = await cropElement(p.page, dd.locator('xpath=ancestor::dl[1]'), path.join(OUT_DIR, `profile-role-super-admin-${vp.sfx}.png`), { touch: p.touch, natural: true })
    checks.push(checkCropHolds(r))
    if (vp.touch) checks.push(...(await fullPage(p.page, path.join(OUT_DIR, 'full', 'profile-full-390-touch.png'), { touch: true })).checks)
    await p.context.close()
  }
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
