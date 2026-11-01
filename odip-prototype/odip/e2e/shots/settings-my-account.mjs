// Captures and numeric checks for Settings PR 4 (My account Profile form, Security section, SessionLengthReached on the login page). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/settings-my-account.mjs <outdir>
// The profile, settings and dev sign-in are stubbed with page.route (synthetic rows), and lib/firebase.ts is served with placeholder settings so the Password group shows;
// the password-reset call to identitytoolkit is stubbed too. Prints "CHECK ok|FAIL name = value", writes checks.json through the capture helper, exits non-zero on a failure.
import path from 'node:path'
import { cropElement, fullPage, checkCropHolds, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const EMAIL = 'jane.sample@example.com'
const EH_NOTE = "Employment Hero keeps your name and mobile up to date. Change them in Employment Hero and they'll update here after the next sync."
const RESET_HINT = "We'll email you a link to choose a new password. Your current password keeps working until you do."
const SECURITY_HINT = 'Counted from when someone signs in. When it ends, they sign in again. Microsoft sign-ins end after 12 hours at most.'
const SHORTER = 'People signed in for longer than this will be asked to sign in again within 30 minutes.'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const PROFILE = { firstName: 'Jane', lastName: 'Sample', email: EMAIL, mobile: '0400 000 000', managedByEmploymentHero: false }
const login = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Jane Sample', role, tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' })

const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(measured)}`)
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol

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

const lines = (loc) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
const sentence = (t, text) => t.page.getByText(text, { exact: true }).first()

/** Crop the section (with the foot when `withFoot`) in its natural place. `want` strings must be visible in the crop, else the frame does not show its name. */
const shoot = async (t, ctx, name, want = [], { withFoot = false } = {}) => {
  const r = await cropElement(t.page, t.region, path.join(OUT_DIR, name), { touch: t.touch, natural: true, also: withFoot ? t.foot : undefined })
  checks.push(checkCropHolds(r))
  for (const text of want) {
    const n = await t.page.getByText(text, { exact: false }).count()
    check(`content of ${name}: "${text}" present`, ctx, n, n >= 1)
  }
}

const noOverflow = async (t, ctx) => {
  const w = await t.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
  check('no horizontal scroll', ctx, w, w.sw <= w.cw)
}

const profileChecks = async (t, ctx, vp) => {
  const inputs = t.region.locator('input:not([type=hidden])')
  const n = await inputs.count()
  const box = await t.region.boundingBox()
  const boxes = []
  for (let i = 0; i < n; i++) boxes.push(await inputs.nth(i).boundingBox())
  check('three inputs', ctx, n, n === 3)
  if (vp.touch) {
    check('every input is full width (>= section width - 1)', ctx, boxes.map((b) => b.width), boxes.every((b) => b.width >= box.width - 1))
    check('every input height >= 44', ctx, boxes.map((b) => b.height), boxes.every((b) => b.height >= 44))
  } else {
    check('section <= 960px wide', ctx, box.width, box.width <= 960 + 1)
  }
}

try {
  // Warm-up: the dev server pre-bundles on the first visit.
  const warm = await open({ width: 1280, height: 900, section: 'profile' })
  await warm.context.close()

  const VPS = [{ name: '1280', width: 1280, height: 900 }, { name: '390', width: 390, height: 844, touch: true }]
  for (const vp of VPS) {
    const ctx = vp.name
    const sfx = `${vp.name}${vp.touch ? '-touch' : ''}-light`

    // Profile: default.
    const p = await open({ ...vp, section: 'profile' })
    await profileChecks(p, ctx, vp)
    await noOverflow(p, ctx)
    if (vp.touch) {
      const reset = p.page.getByRole('button', { name: 'Send me a password reset email' })
      const rb = await reset.boundingBox()
      const rbox = await p.region.boundingBox()
      check('reset button height >= 44', ctx, rb.height, rb.height >= 44)
      check('reset button is full width below sm', ctx, { button: rb.width, section: rbox.width }, rb.width >= rbox.width - 1)
      const hint = await lines(sentence(p, RESET_HINT))
      check('password hint wraps to <= 3 lines', ctx, hint, hint <= 3)
    } else {
      // Each field is span.medium: the same width as the Alert windows fields, +-1px.
      const mine = (await p.region.getByLabel(/First name/).boundingBox()).width
      await p.page.goto(`${BASE_URL}/settings?section=alerts`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const hours = p.page.getByRole('region', { name: 'Alert windows', exact: true }).locator('input[type=number]')
      await hours.waitFor({ timeout: 60_000 })
      const theirs = (await hours.boundingBox()).width
      check('profile field width equals the Alert windows field width (+-1px)', ctx, { mine, theirs }, near(mine, theirs, 1))
      await p.page.goto(`${BASE_URL}/settings?section=profile`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await p.region.waitFor({ timeout: 60_000 })
    }
    await shoot(p, ctx, `profile-default-${sfx}.png`, [RESET_HINT])

    // Profile: dirty with one error.
    await p.region.getByLabel(/First name/).fill('')
    await p.region.getByLabel(/Last name/).fill('Sample-Smith')
    await sentence(p, 'Enter your first name.').waitFor()
    const saveBtn = p.page.getByRole('button', { name: 'Save changes' })
    check('Save is disabled while a field has a problem', ctx, await saveBtn.isDisabled(), await saveBtn.isDisabled())
    const footText = (await p.foot.innerText()).replace(/\s+/g, ' ').trim()
    check('foot counts the problem', ctx, footText, footText.includes('Fix 1 field to save.'))
    if (vp.touch) {
      const fb = await p.foot.boundingBox()
      const ih = await p.page.evaluate(() => window.innerHeight)
      check('Save foot is in the viewport while dirty', ctx, { top: fb.y, bottom: fb.y + fb.height, ih }, fb.y >= 0 && fb.y + fb.height <= ih + 1)
      const sb = await saveBtn.boundingBox()
      check('Save height >= 44', ctx, sb.height, sb.height >= 44)
    }
    await shoot(p, ctx, `profile-dirty-error-${sfx}.png`, ['Enter your first name.'], { withFoot: true })

    // Profile: saved.
    await p.region.getByLabel(/First name/).fill('Janet')
    await saveBtn.click()
    await p.foot.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 10_000 })
    check('PUT carried exactly firstName, lastName, mobile', ctx, p.state.bodies.at(-1), JSON.stringify(Object.keys(p.state.bodies.at(-1)).sort()) === JSON.stringify(['firstName', 'lastName', 'mobile']))
    await shoot(p, ctx, `profile-saved-${sfx}.png`, [], { withFoot: true })

    // Profile: reset sent, then failed (too many).
    await p.page.getByRole('button', { name: 'Send me a password reset email' }).click()
    await sentence(p, `Check your email. We've sent a link to ${EMAIL}.`).waitFor({ timeout: 10_000 })
    check('button now reads Send it again', ctx, await p.page.getByRole('button', { name: 'Send it again' }).count(), (await p.page.getByRole('button', { name: 'Send it again' }).count()) === 1)
    await shoot(p, ctx, `profile-reset-sent-${sfx}.png`)
    p.state.reset = 'too-many'
    await p.page.getByRole('button', { name: 'Send it again' }).click()
    await sentence(p, 'Too many emails were sent. Wait a few minutes, then try again.').waitFor({ timeout: 10_000 })
    await shoot(p, ctx, `profile-reset-failed-${sfx}.png`)
    checks.push(...(await fullPage(p.page, path.join(OUT_DIR, 'full', `profile-${sfx}.png`), { touch: !!vp.touch })).checks)
    await p.context.close()

    // Profile: Employment Hero locked.
    const eh = await open({ ...vp, section: 'profile', profile: { managedByEmploymentHero: true } })
    const ro = await eh.region.locator('input[readonly]').count()
    check('all three inputs are readOnly', ctx, ro, ro === 3)
    check('no Save changes button', ctx, await eh.page.getByRole('button', { name: 'Save changes' }).count(), (await eh.page.getByRole('button', { name: 'Save changes' }).count()) === 0)
    const note = await lines(sentence(eh, EH_NOTE))
    check('EH Callout wraps to <= 3 lines', ctx, note, note <= 3)
    await profileChecks(eh, ctx, vp)
    await shoot(eh, ctx, `profile-eh-locked-${sfx}.png`, [EH_NOTE])
    await eh.context.close()

    // Security: Admin, dirty with the shorter-limit line.
    const s = await open({ ...vp, role: 'Admin', section: 'security', sessionLengthMinutes: 480 })
    const field = s.region.getByRole('button', { name: /Session length/ })
    const fb = await field.boundingBox()
    const sbox = await s.region.boundingBox()
    if (vp.touch) {
      check('select is full width', ctx, { select: fb.width, section: sbox.width }, fb.width >= sbox.width - 1)
      check('select height >= 44', ctx, fb.height, fb.height >= 44)
    } else {
      check('section <= 960px wide', ctx, sbox.width, sbox.width <= 960 + 1)
    }
    const hl = await lines(sentence(s, SECURITY_HINT))
    // PLAN: one or two lines at 1280 (height <= 2 line-heights), <= 3 at 390.
    check(vp.touch ? 'Security hint wraps to <= 3 lines' : 'Security hint is one or two lines', ctx, hl, hl <= (vp.touch ? 3 : 2))
    await noOverflow(s, ctx)
    await field.click()
    await s.page.getByRole('option', { name: '1 hour' }).click()
    await sentence(s, SHORTER).waitFor()
    if (vp.touch) {
      const f2 = await s.foot.boundingBox()
      const ih = await s.page.evaluate(() => window.innerHeight)
      check('Save foot is in the viewport while dirty', ctx, { top: f2.y, bottom: f2.y + f2.height, ih }, f2.y >= 0 && f2.y + f2.height <= ih + 1)
    }
    const sl = await lines(sentence(s, SHORTER))
    check('shorter-limit line wraps to <= 3 lines', ctx, sl, sl <= 3)
    await shoot(s, ctx, `security-admin-dirty-${sfx}.png`, [SHORTER], { withFoot: true })
    await s.page.getByRole('button', { name: 'Save changes' }).click()
    await s.foot.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 10_000 })
    check('PUT carried sessionLengthMinutes 60', ctx, s.state.securityBodies.at(-1), s.state.securityBodies.at(-1)?.sessionLengthMinutes === 60)
    checks.push(...(await fullPage(s.page, path.join(OUT_DIR, 'full', `security-${sfx}.png`), { touch: !!vp.touch })).checks)
    await s.context.close()

    // Security: Coordinator, locked.
    const c = await open({ ...vp, role: 'Coordinator', section: 'security', sessionLengthMinutes: 480 })
    check('Coordinator select is disabled', ctx, await c.region.getByRole('button', { name: /Session length/ }).isDisabled(), await c.region.getByRole('button', { name: /Session length/ }).isDisabled())
    check('Coordinator has no Save changes button', ctx, await c.page.getByRole('button', { name: 'Save changes' }).count(), (await c.page.getByRole('button', { name: 'Save changes' }).count()) === 0)
    await shoot(c, ctx, `security-coordinator-locked-${sfx}.png`, ['Only an Admin can change these'])
    await c.context.close()

    // Login: forced end.
    const lc = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: 'light', reducedMotion: 'reduce' })
    const lp = await lc.newPage()
    await lp.goto(`${BASE_URL}/login?microsoft=SessionLengthReached`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const said = lp.getByText("You've been signed out.", { exact: true })
    await said.waitFor({ timeout: 20_000 })
    const next = lp.getByText('Your organisation asks everyone to sign in again after a set time. Sign in to carry on.', { exact: true })
    check('login next step shown', ctx, await next.count(), (await next.count()) === 1)
    const words = `${await said.innerText()} ${await next.innerText()}`
    check('login words promise no password', ctx, words, !/password/i.test(words))
    const nl = await lines(next)
    check('login next step wraps to <= 3 lines', ctx, nl, nl <= 3)
    const lr = await cropElement(lp, said.locator('xpath=ancestor::*[self::div or self::form][3]'), path.join(OUT_DIR, `login-session-length-${sfx}.png`), { touch: !!vp.touch })
    checks.push(checkCropHolds(lr))
    await lc.close()
  }

  // Dark at 390: Profile (default) and Security (Admin, dirty), plus one full page each.
  const dvp = { width: 390, height: 844, touch: true }
  const dp = await open({ ...dvp, scheme: 'dark', section: 'profile' })
  await shoot(dp, '390 dark', 'profile-default-390-touch-dark.png', [RESET_HINT])
  checks.push(...(await fullPage(dp.page, path.join(OUT_DIR, 'full', 'profile-390-touch-dark.png'), { touch: true })).checks)
  await dp.context.close()
  const ds = await open({ ...dvp, role: 'Admin', scheme: 'dark', section: 'security', sessionLengthMinutes: 480 })
  await ds.region.getByRole('button', { name: /Session length/ }).click()
  await ds.page.getByRole('option', { name: '1 hour' }).click()
  await sentence(ds, SHORTER).waitFor()
  await shoot(ds, '390 dark', 'security-admin-dirty-390-touch-dark.png', [SHORTER], { withFoot: true })
  await ds.context.close()
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
