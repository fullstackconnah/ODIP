// Captures and numeric checks (PLAN N1 to N9) for two-step verification: the sign-in steps (Verify it's you, set-up after a refusal), My account's "Two-step verification"
// group with its remove dialog, and Staff detail's "Reset two-step verification". Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/two-step.mjs <outdir>
// Firebase is stubbed at its module (the dev server's pre-bundled firebase/auth is replaced with page.route, so no Identity Toolkit wire format is needed) and
// /auth/exchange, the staff overview and the reset call are page.route stubs over the mock API. Prints "CHECK ok|FAIL name = value" and writes checks.json.
import path from 'node:path'
import { cropElement, fullPage, checkCropHolds, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const EMAIL = 'jane.sample@example.com'
const SID = '00000000-0000-0000-0000-0000000000c1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const session = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Jane Sample', role, tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' })
const PROFILE = { firstName: 'Jane', lastName: 'Sample', email: EMAIL, mobile: '0400 000 000', managedByEmploymentHero: false }
const STAFF = () => ({
  staff: {
    id: SID, firstName: 'Una', lastName: 'Odd', fullName: 'Una Odd', username: 'una', role: 'Coordinator', position: 'SupportWorker', email: 'una@other.org', mobile: null,
    region: 'North', isActive: true, hasExpiredQualifications: false, notes: null, hasSignedIn: true, signInInviteSentAt: null, signInAddressUnconfirmed: false,
  },
  availability: [], upcomingShifts: [], upcomingTripAssignments: [], recentIncidents: [], recentCompletions: [],
})

// The module the app gets for 'firebase/auth'. window.__fbOpts: { mode: 'mfa' | 'plain', signedIn, factors }. Codes: 000000 is wrong, 111111 is too many tries,
// 222222 is a timed-out sign-in; anything else works.
const FB_STUB = `
const opts = window.__fbOpts || {}
const listeners = []
const factors = (opts.factors || []).map((f) => ({ uid: f, displayName: 'Authenticator app', factorId: 'totp', enrollmentTime: new Date('2026-10-28T01:00:00Z').toUTCString() }))
const makeUser = () => ({ email: ${JSON.stringify(EMAIL)}, getIdToken: async () => 'tok' })
let user = opts.signedIn ? makeUser() : null
const auth = { name: 'stub', get currentUser() { return user }, onAuthStateChanged(cb) { listeners.push(cb); setTimeout(() => cb(user), 0); return () => {} } }
const fail = (code) => Object.assign(new Error(code), { code })
const byCode = (code) => { if (code === '000000') throw fail('auth/invalid-verification-code'); if (code === '111111') throw fail('auth/too-many-requests'); if (code === '222222') throw fail('auth/invalid-multi-factor-session') }
export const getAuth = () => auth
export const signOut = async () => { user = null; listeners.forEach((cb) => cb(null)) }
export const signInWithEmailAndPassword = async () => {
  if (opts.mode === 'mfa') throw fail('auth/multi-factor-auth-required')
  user = makeUser()
  return { user }
}
export const getMultiFactorResolver = () => ({
  hints: [{ factorId: 'totp', uid: 'h1' }],
  resolveSignIn: async (assertion) => { byCode(assertion.code); user = makeUser(); return { user } },
})
export const multiFactor = () => ({
  get enrolledFactors() { return factors },
  getSession: async () => 'session',
  enroll: async (assertion) => { byCode(assertion.code); factors.push({ uid: 'f1', displayName: 'Authenticator app', factorId: 'totp', enrollmentTime: new Date('2026-10-28T01:00:00Z').toUTCString() }) },
  unenroll: async () => { factors.length = 0 },
})
export const TotpMultiFactorGenerator = {
  FACTOR_ID: 'totp',
  generateSecret: async () => ({
    secretKey: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
    generateQrCodeUrl: (e, i) => 'otpauth://totp/' + encodeURIComponent(i) + ':' + e + '?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=' + encodeURIComponent(i),
    enrollmentCompletionDeadline: new Date(Date.now() + 600000).toISOString(),
  }),
  assertionForSignIn: (uid, code) => ({ code }),
  assertionForEnrollment: (secret, code) => ({ code }),
}
export const sendEmailVerification = async () => {}
export const sendPasswordResetEmail = async () => {}
`

const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(measured)}`)
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol

const browser = await chromium.launch({ headless: true })
let stubHits = 0

/** One page: Firebase stubbed (`fb`), the sign-in and data stubs in place. `exchange`: 'refuse-once' answers the first /auth/exchange with MfaEnrolmentRequired. */
async function open(vp, scheme, { role = 'Admin', fb = {}, exchange = 'ok', resetStatus = 200 } = {}) {
  const touch = !!vp.mobile
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: touch, isMobile: touch, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: scheme, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const tag = `${vp.name} ${scheme}`
  page.on('pageerror', (e) => check('page error', tag, e.message, false))
  await page.addInitScript((o) => { window.__fbOpts = o }, fb)
  await page.route(/firebase_auth\.js(\?.*)?$/, (r) => { stubHits++; return r.fulfill({ contentType: 'text/javascript', body: FB_STUB }) })
  await page.route(/\/src\/lib\/firebase\.ts(\?.*)?$/, async (r) => {
    const res = await r.fetch()
    const body = (await res.text()).replace(/missingEnvVars\.length\s*===\s*0/, () => 'true').replace(/import\.meta\.env\.VITE_FIREBASE_(\w+)/g, (_m, k) => `"stub-${k}"`)
    await r.fulfill({ response: res, body })
  })
  let exchanges = 0
  await page.route('**/api/v1/auth/exchange', (r) => {
    exchanges++
    if (exchange === 'refuse-once' && exchanges === 1) {
      return r.fulfill({ status: 401, json: { success: false, data: null, message: null, errors: ['Set up two-step verification to sign in to Bunya Support.'], code: 'MfaEnrolmentRequired' } })
    }
    return r.fulfill({ json: session(role) })
  })
  await page.route('**/api/v1/auth/config', (r) => r.fulfill({ json: envelope({ microsoft: false, microsoftStartUrl: null, mfaRequiredForAdmins: true }) }))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: session(role) }))
  await page.route(/\/api\/v1\/profile(\?.*)?$/, (r) => r.fulfill({ json: envelope(PROFILE) }))
  await page.route(/\/api\/v1\/settings(\?.*)?$/, (r) => r.fulfill({ json: envelope({ qualificationWarningDays: 30, weeklyHoursWarning: 38, sessionLengthMinutes: null }) }))
  await page.route(/\/api\/v1\/staff\/[^/]+\/overview(\?.*)?$/, (r) => r.fulfill({ json: envelope(STAFF()) }))
  await page.route(/\/api\/v1\/staff\/[^/]+\/two-step\/reset$/, (r) => {
    if (resetStatus === 200) return r.fulfill({ json: envelope(true) })
    return r.fulfill({ status: resetStatus, json: { success: false, data: null, message: null, errors: ['x'] } })
  })
  return { context, page, touch, tag, vp }
}

const shot = async (t, loc, name, also) => {
  const r = await cropElement(t.page, loc, path.join(OUT_DIR, `${name}-${t.vp.name}-${t.scheme}.png`), { touch: t.touch, also })
  checks.push({ ...checkCropHolds(r), name: `${name} crop holds [${t.tag}]` })
}
const box = async (loc) => loc.boundingBox()
const loginCard = (page) => page.getByRole('heading', { level: 2 }).first().locator('xpath=..')

async function typeCode(page, label, code) {
  const field = page.getByLabel(label ?? 'Code')
  await field.fill(code)
}

/** N3: the code field's size. */
async function checkCodeField(t, state, field) {
  const m = await field.evaluate((el) => {
    const cs = getComputedStyle(el)
    const probe = document.createElement('div')
    probe.style.cssText = `position:absolute;visibility:hidden;width:10ch;font:${cs.font}`
    document.body.append(probe)
    const tenCh = probe.getBoundingClientRect().width
    probe.remove()
    return { height: el.getBoundingClientRect().height, fontSize: parseFloat(cs.fontSize), width: el.getBoundingClientRect().width, tenCh }
  })
  // The house control is 44 px on touch and 32 px with a mouse (--control-h), so the 44 applies at 390.
  check(`N3 code input height >= ${t.vp.mobile ? 44 : 32} (${state})`, t.tag, m.height, m.height >= (t.vp.mobile ? 43.5 : 31.5))
  if (t.vp.mobile) check(`N3 code input font-size >= 16 (${state})`, t.tag, m.fontSize, m.fontSize >= 16)
  check(`N3 code input width >= 10ch (${state})`, t.tag, [m.width, m.tenCh], m.width >= m.tenCh - 0.5)
}

/** N9: the field says wrong, and exactly one alert is on the page. */
async function checkWrong(t, state, field) {
  check(`N9 aria-invalid on the code field (${state})`, t.tag, await field.getAttribute('aria-invalid'), (await field.getAttribute('aria-invalid')) === 'true')
  const alerts = await t.page.getByRole('alert').count()
  check(`N9 one alert (${state})`, t.tag, alerts, alerts === 1)
}

/** N5: primary then secondary, stacked full width at 390, inline and left-aligned at 1280. */
async function checkButtons(t, state, primary, secondary, container) {
  const [p, s, c] = [await box(primary), await box(secondary), await box(container)]
  if (t.vp.mobile) {
    check(`N5 buttons stacked, primary first (${state})`, t.tag, { p, s }, s.y >= p.y + p.height - 1 && near(p.x, s.x, 1))
    check(`N5 buttons full width (${state})`, t.tag, { p: p.width, s: s.width, c: c.width }, near(p.width, c.width, 2) && near(s.width, c.width, 2))
  } else {
    check(`N5 buttons inline (${state})`, t.tag, { p, s }, near(p.y, s.y, 2) && s.x > p.x + p.width - 1)
    check(`N5 buttons left-aligned (${state})`, t.tag, { p: p.x, c: c.x }, near(p.x, c.x, 1))
  }
}

async function noOverflow(t, state, loc) {
  const m = await loc.evaluate((el) => ({ card: [el.scrollWidth, el.clientWidth], page: [document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth] }))
  check(`no horizontal overflow (${state})`, t.tag, m, m.card[0] <= m.card[1] && m.page[0] <= m.page[1])
}

const VIEWS = [
  { vp: { name: '1280', width: 1280, height: 900 }, scheme: 'light' },
  { vp: { name: '390', width: 390, height: 844, mobile: true }, scheme: 'light' },
  { vp: { name: '390', width: 390, height: 844, mobile: true }, scheme: 'dark' },
]

// Warm-up: the dev server pre-bundles dependencies on its first page, and reloads the page once when it finishes.
{
  const w = await open(VIEWS[0].vp, 'light')
  await w.page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await w.page.waitForTimeout(8000)
  await w.context.close()
}

for (const view of VIEWS) {
  const { vp, scheme } = view
  const dark = scheme === 'dark'
  const widths = {}

  // ---- S1: the password, then Verify it's you (the account has an authenticator app) ----
  {
    const t = { ...(await open(vp, scheme, { fb: { mode: 'mfa' } })), scheme }
    const { page } = t
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill('pw-for-shots')
    widths.password = (await box(loginCard(page))).width
    await shot(t, loginCard(page), 'login-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('heading', { name: "Verify it's you" }).waitFor({ timeout: 30_000 })
    widths.verify = (await box(loginCard(page))).width
    const code = page.getByLabel('Code', { exact: true })
    check('Verify: Code has focus', t.tag, await code.evaluate((el) => document.activeElement === el), await code.evaluate((el) => document.activeElement === el))
    await checkCodeField(t, 'verify', code)
    await shot(t, loginCard(page), 'login-verify')
    await code.fill('000000')
    await page.getByRole('button', { name: 'Verify', exact: true }).click()
    await page.getByText("That code didn't work. Enter the newest code from your app.").waitFor()
    await checkWrong(t, 'verify', code)
    await shot(t, loginCard(page), 'login-verify-wrong')
    await code.fill('111111')
    await page.getByRole('button', { name: 'Verify', exact: true }).click()
    await page.getByText('Too many tries. Wait a few minutes, then sign in again.').waitFor()
    await shot(t, loginCard(page), 'login-verify-too-many')
    await page.getByRole('button', { name: 'Back' }).click()
    await page.getByLabel('Password', { exact: true }).waitFor()
    await page.getByLabel('Password', { exact: true }).fill('pw-for-shots')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByLabel('Code', { exact: true }).fill('222222')
    await page.getByRole('button', { name: 'Verify', exact: true }).click()
    await page.getByText('This sign-in timed out. Sign in again.').waitFor()
    await shot(t, loginCard(page), 'login-verify-timed-out')
    await t.context.close()
  }

  // ---- S1/S2: the exchange refuses (MfaEnrolmentRequired), so the set-up step shows ----
  {
    const t = { ...(await open(vp, scheme, { fb: { mode: 'plain' }, exchange: 'refuse-once' })), scheme }
    const { page } = t
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByLabel('Email').fill(EMAIL)
    await page.getByLabel('Password', { exact: true }).fill('pw-for-shots')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('heading', { name: 'Set up two-step verification' }).waitFor({ timeout: 30_000 })
    const qr = page.getByRole('img', { name: /QR code for setting up two-step verification/ })
    await qr.waitFor({ timeout: 30_000 })
    const card = loginCard(page)
    widths.enrol = (await box(card)).width
    // N1
    check('N1 card width equal on password, Verify and set-up', vp.name + ' ' + scheme, widths, near(widths.password, widths.verify, 0.5) && near(widths.password, widths.enrol, 0.5))
    // N2
    const q = await box(qr)
    const want = vp.mobile ? 176 : 192
    check(`N2 QR tile ${want} x ${want}`, vp.name + ' ' + scheme, q, near(q.width, want, 0.5) && near(q.height, want, 0.5))
    const bg = await qr.evaluate((el) => getComputedStyle(el).backgroundColor)
    check('N2 QR tile is white (also in dark)', vp.name + ' ' + scheme, bg, bg === 'rgb(255, 255, 255)')
    // N3
    await checkCodeField(t, 'set-up', page.getByLabel('Code', { exact: true }))
    // N4
    const key = card.locator('code')
    const groups = (await key.innerText()).trim().split(/\s+/)
    check('N4 key shows 8 groups of 4', vp.name + ' ' + scheme, groups, groups.length === 8 && groups.every((g) => g.length === 4))
    await noOverflow(t, 'set-up', card)
    // N5
    await checkButtons(t, 'set-up', page.getByRole('button', { name: 'Turn on and sign in' }), page.getByRole('button', { name: 'Cancel' }), card.locator('form'))
    // N7
    const link = page.getByRole('link', { name: 'Open in your authenticator app' })
    const visible = await link.isVisible()
    check(`N7 "Open in your authenticator app" ${vp.mobile ? 'visible' : 'hidden'}`, vp.name + ' ' + scheme, visible, visible === !!vp.mobile)
    await shot(t, card, 'login-setup')
    await page.getByLabel('Code', { exact: true }).fill('000000')
    await page.getByRole('button', { name: 'Turn on and sign in' }).click()
    await page.getByText("That code didn't work. Check the app lists Bunya Support, then enter the newest code.").waitFor()
    await checkWrong(t, 'set-up', page.getByLabel('Code', { exact: true }))
    await shot(t, card, 'login-setup-wrong')
    if (view === VIEWS[0] || view === VIEWS[1]) {
      const fp = await fullPage(page, path.join(OUT_DIR, 'full', `login-setup-${vp.name}-${scheme}.png`), { touch: t.touch })
      checks.push(...fp.checks.map((c) => ({ ...c, name: `${c.name} [login-setup ${t.tag}]` })))
    }
    await t.context.close()
  }

  // ---- S3: My account, Two-step verification ----
  const group = (page) => page.getByRole('region', { name: 'Two-step verification', exact: true })
  const toSettings = async (t) => {
    const { page } = t
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/settings?section=profile`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await group(page).waitFor({ timeout: 60_000 })
  }
  const settingsState = async (name, opts, after) => {
    const t = { ...(await open(vp, scheme, opts)), scheme }
    await toSettings(t)
    if (after) await after(t)
    else await shot(t, group(t.page), name)
    await t.context.close()
    return t
  }
  await settingsState('settings-off', { role: 'Coordinator', fb: { signedIn: true } }, async (t) => {
    const g = group(t.page)
    // N6
    const h = await box(g.getByRole('heading', { name: 'Two-step verification' }))
    const b = await box(g.getByText('Off', { exact: true }))
    check('N6 title and badge on one line, centred (+-2)', t.tag, { h, b }, near(h.y + h.height / 2, b.y + b.height / 2, 2))
    await shot(t, g, 'settings-off')
    // inline set-up
    await g.getByRole('button', { name: 'Set up two-step verification' }).click()
    const qr = g.getByRole('img', { name: /QR code for setting up two-step verification/ })
    await qr.waitFor({ timeout: 30_000 })
    const q = await box(qr)
    const want = vp.mobile ? 176 : 192
    check(`N2 QR tile ${want} x ${want} (settings)`, t.tag, q, near(q.width, want, 0.5) && near(q.height, want, 0.5))
    await checkCodeField(t, 'settings set-up', g.getByLabel('Code', { exact: true }))
    await checkButtons(t, 'settings set-up', g.getByRole('button', { name: 'Turn on', exact: true }), g.getByRole('button', { name: 'Cancel' }), g.locator('form'))
    await noOverflow(t, 'settings set-up', g)
    const link = g.getByRole('link', { name: 'Open in your authenticator app' })
    const visible = await link.isVisible()
    check(`N7 link ${vp.mobile ? 'visible' : 'hidden'} (settings)`, t.tag, visible, visible === !!vp.mobile)
    await shot(t, g, 'settings-setup')
    await g.getByLabel('Code', { exact: true }).fill('000000')
    await g.getByRole('button', { name: 'Turn on', exact: true }).click()
    await g.getByText("That code didn't work. Check the app lists Bunya Support, then enter the newest code.").waitFor()
    await checkWrong(t, 'settings set-up', g.getByLabel('Code', { exact: true }))
    await shot(t, g, 'settings-setup-wrong')
    await g.getByLabel('Code', { exact: true }).fill('123456')
    await g.getByRole('button', { name: 'Turn on', exact: true }).click()
    await g.getByText("Two-step verification is on. You'll enter a code from your app each time you sign in with your password.").waitFor()
    await shot(t, g, 'settings-just-on')
  })
  await settingsState('settings-required', { role: 'Admin', fb: { signedIn: true } })
  await settingsState('settings-required-on', { role: 'Admin', fb: { signedIn: true, factors: ['f1'] } })
  await settingsState('settings-on', { role: 'Coordinator', fb: { signedIn: true, factors: ['f1'] } }, async (t) => {
    const g = group(t.page)
    await shot(t, g, 'settings-on')
    await g.getByRole('button', { name: 'Remove two-step verification' }).click()
    const dialog = t.page.getByRole('alertdialog')
    await dialog.waitFor()
    // N8
    const [c, x] = [await box(dialog.getByRole('button', { name: 'Remove and sign out' })), await box(dialog.getByRole('button', { name: 'Cancel' }))]
    if (vp.mobile) check('N8 dialog buttons stacked (remove)', t.tag, { c, x }, Math.abs(c.y - x.y) > 8 && near(c.x, x.x, 1))
    await shot(t, dialog, 'settings-remove-dialog')
  })

  // ---- S4: Staff detail, Reset two-step verification ----
  for (const [name, status] of [['staff-reset-dialog', 200], ['staff-reset-error', 502]]) {
    const t = { ...(await open(vp, scheme, { role: 'Admin', resetStatus: status })), scheme }
    const { page } = t
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/staff/${SID}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const button = page.getByRole('button', { name: 'Reset two-step verification' })
    await button.waitFor({ timeout: 60_000 })
    if (status === 200) await shot(t, page.getByRole('heading', { name: 'Una Odd' }).first().locator('xpath=ancestor::*[self::header or self::div][2]'), 'staff-header')
    await button.click()
    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor()
    const resetButton = dialog.getByRole('button', { name: 'Reset', exact: true })
    const goBack = dialog.getByRole('button', { name: 'Go back' })
    if (vp.mobile) {
      const [c, x] = [await box(resetButton), await box(goBack)]
      check('N8 dialog buttons stacked (reset)', t.tag, { c, x }, Math.abs(c.y - x.y) > 8 && near(c.x, x.x, 1))
    }
    if (status === 200) {
      await shot(t, dialog, name)
      await resetButton.click()
      const notice = page.getByText("Una Odd's two-step verification is reset. They'll set it up again next time they sign in.")
      await notice.waitFor()
      await shot(t, notice, 'staff-reset-notice')
    } else {
      await resetButton.click()
      await dialog.getByText("We couldn't reach the sign-in service. Try again.").waitFor()
      await shot(t, dialog, name)
    }
    await t.context.close()
  }
}

check('the firebase/auth stub was served', 'all', stubHits, stubHits > 0)
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
