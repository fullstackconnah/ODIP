// Captures and numeric checks for PR #528 (Employment Hero invite confirm): the held callout and Confirm address button on the staff page, the confirm dialog, the
// success and error notices, a non-manager's view, the Integrations "Confirm email address" group and the login refusal. Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/eh-confirm.mjs <outdir>
// The staff overview, the confirm POST, the Employment Hero status and the sign-in calls are page.route stubs over the mock API. Exits non-zero when a check fails;
// every measured value is printed as "CHECK ok|FAIL name = value", and measure.txt in OUT_DIR holds the same lines.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.png')) rmSync(path.join(OUT_DIR, f))

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const SID = '00000000-0000-0000-0000-0000000000c1'
const NAME = 'Una Odd'
const EMAIL = 'una@other.org'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const loginAs = (role) => ({
  users: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]),
  login: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' }),
})

const CALLOUT = `${EMAIL} came from Employment Hero and isn't at your organisation's domain or a common email provider. Una can't sign in until you confirm it.`
const CONFIRMED = `${NAME}'s address is confirmed. You can send their sign-in invite now.`
const CONFIRM_ERROR = "That address couldn't be confirmed right now. Try again in a moment."
const REFUSAL = `Your organisation needs to confirm ${EMAIL} before you can sign in to Bunya Support.`
const NEXT_STEP = 'Ask your administrator to confirm it.'

// What the stubs answer with: the hold lasts until a confirm succeeds; `confirmMode` picks the answer to the next confirm.
let held = true
let confirmMode = 'ok'
const overview = () => ({
  staff: {
    id: SID, firstName: 'Una', lastName: 'Odd', fullName: NAME, username: 'una', role: 'SupportWorker', position: 'SupportWorker', email: EMAIL, mobile: null,
    region: 'North', isActive: true, hasExpiredQualifications: false, notes: null, hasSignedIn: false, signInInviteSentAt: null, signInAddressUnconfirmed: held,
  },
  availability: [], upcomingShifts: [], upcomingTripAssignments: [], recentIncidents: [], recentCompletions: [],
})
const ehStatus = () => ({
  configured: true, connected: true, businessId: '777', businessName: 'Acme Care', connectedAt: '2026-10-13T01:00:00Z', connectedByName: 'Ada Admin',
  lastSyncAt: '2026-10-14T01:00:00Z', lastSyncError: null, staffLinked: 12, staffNotLinked: 0, timesheetsSent: 0, timesheetsWaiting: 0,
  workTypes: { standard: null, activeNight: null, passiveNight: null, sleepover: null }, leaveSent: 0, leaveWaiting: 0,
  leaveCategories: { annual: null, sick: null, personal: null, other: null }, leaveProblems: [],
  attention: [{ id: 'i1', kind: 'ConfirmAddress', userId: SID, employeeId: null, name: NAME, reason: `Their email (${EMAIL}) came from Employment Hero.` }],
})

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const now = Math.floor(Date.now() / 1000)
const FAKE_JWT = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u1', user_id: 'u1', email: EMAIL, iat: now, exp: now + 3600, auth_time: now })}.sig`
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

const lines = []
let failed = false
const check = (name, value, ok) => { if (!ok) failed = true; const l = `CHECK ${ok ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(value)}`; lines.push(l); console.log(l) }
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})

const browser = await chromium.launch({ headless: true })
async function session(vp, scheme, role, { signIn = true } = {}) {
  const tag = `${vp.name} ${scheme}`
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce', colorScheme: scheme })
  const page = await context.newPage()
  const cdp = vp.mobile ? await context.newCDPSession(page) : null
  const pin = async () => {
    await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  await pin()
  page.on('pageerror', (e) => check(`${tag} page error`, e.message, false))
  const who = loginAs(role)
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: who.users }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: who.login }))
  // The runner has no Firebase settings, so lib/firebase.ts leaves `auth` null (and Send set-password email would never show). Serve it with placeholder settings instead:
  // the SDK then builds a real Auth object whose network calls the stubs below answer.
  let patched = 0
  await page.route(/\/src\/lib\/firebase\.ts(\?.*)?$/, async (r) => {
    const res = await r.fetch()
    const body = (await res.text()).replace(/missingEnvVars\.length\s*===\s*0/, () => { patched++; return 'true' }).replace(/import\.meta\.env\.VITE_FIREBASE_(\w+)/g, (_m, k) => { patched++; return `"stub-${k}"` })
    await r.fulfill({ response: res, body })
  })
  await page.route(/\/api\/v1\/staff\/[^/]+\/overview(\?.*)?$/, (r) => r.fulfill({ json: envelope(overview()) }))
  await page.route(/\/api\/v1\/staff\/[^/]+\/confirm-address$/, (r) => {
    if (confirmMode === 'fail') return r.fulfill({ status: 400, json: { success: false, data: null, message: CONFIRM_ERROR, errors: [CONFIRM_ERROR] } })
    held = false
    return r.fulfill({ json: envelope(true) })
  })
  await page.route(/\/api\/v1\/integrations\/employment-hero(\?.*)?$/, (r) => r.fulfill({ json: envelope(ehStatus()) }))
  await page.route(/\/api\/v1\/integrations\/employment-hero\/(employees|work-types|leave-categories)(\?.*)?$/, (r) => r.fulfill({ json: envelope([]) }))
  if (signIn) {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await pin()
  }

  const noOverflow = async (state) => {
    const m = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }))
    check(`${tag} ${state}: no page overflow (${m.sw} <= ${m.iw})`, m, m.sw <= m.iw)
  }
  const unclipped = async (state, loc) => {
    const m = await loc.evaluate((el) => [el, el.parentElement].map((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight })))
    check(`${tag} ${state}: text not clipped`, m, m.every((x) => x.sw <= x.cw && x.sh <= x.ch))
  }
  const inViewport = async (state, name, loc) => {
    const b = await loc.boundingBox()
    check(`${tag} ${state}: ${name} inside viewport`, b, !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height)
  }
  const tap = async (state, name, loc) => {
    const b = await loc.boundingBox()
    check(`${tag} ${state}: ${name} tap target >= 44 (${b?.height})`, b, !!b && b.height >= 44 - 0.5)
  }
  // Crop the union of the locators with 16 px of padding. The fixed bottom nav is hidden for the shot only; focus is dropped first.
  const shoot = async (state, locs) => {
    await settled(page)
    await locs[0].scrollIntoViewIfNeeded()
    const style = await page.addStyleTag({ content: 'nav[aria-label="Mobile"]{display:none !important}' })
    await page.evaluate(() => document.activeElement?.blur())
    const boxes = []
    for (const l of locs) boxes.push(await l.boundingBox())
    const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 16); const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 16)
    const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + 16); const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + 16)
    await page.screenshot({ path: path.join(OUT_DIR, `${tag.replace(' ', '-')}-${state}.png`), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } })
    await style.evaluate((e) => e.remove())
  }
  // One full page: at 390 touch the viewport is resized to the page height first (a fullPage shot drops the touch emulation), then touch is re-pinned and re-checked.
  const fullPage = async (state, probe) => {
    await settled(page)
    await page.evaluate(() => document.activeElement?.blur())
    const h = await page.evaluate(() => Math.ceil(document.scrollingElement.scrollHeight))
    if (vp.mobile) {
      await page.setViewportSize({ width: vp.width, height: Math.max(h, vp.height) })
      await pin()
      await settled(page)
      const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
      const b = await probe.boundingBox()
      check(`${tag} full page: touch survived the resize (coarse, control ${b?.height}px >= 44)`, { coarse, h: b?.height }, coarse && !!b && b.height >= 44 - 0.5)
    }
    await page.screenshot({ path: path.join(OUT_DIR, `${tag.replace(' ', '-')}-full.png`) })
    if (vp.mobile) { await page.setViewportSize({ width: vp.width, height: vp.height }); await pin() }
  }
  const openStaff = async () => {
    await page.goto(`${BASE_URL}/staff/${SID}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(NAME, { exact: true }).first().waitFor({ timeout: 60_000 })
    await settled(page)
  }
  return { context, page, tag, patchedCount: () => patched, noOverflow, unclipped, inViewport, tap, shoot, fullPage, openStaff, pin }
}

try {
  for (const scheme of ['light', 'dark']) {
    for (const vp of [{ name: '390', width: 390, height: 844, mobile: true }, { name: '1280', width: 1280, height: 800 }]) {
      held = true
      confirmMode = 'ok'
      const s = await session(vp, scheme, 'Admin')
      const { page, tag } = s
      const callout = page.getByText(CALLOUT, { exact: true })
      const confirmBtn = page.locator('[data-confirm-address]')
      const sendBtn = page.getByRole('button', { name: /Send set-password email|Send sign-in invite|Resend/ })
      const heading = page.getByText(NAME, { exact: true }).first()

      // (a) held and active: callout and Confirm address; no Send set-password email
      await s.openStaff()
      await callout.waitFor({ timeout: 60_000 })
      check(`${tag} a: Confirm address button present`, await confirmBtn.count(), (await confirmBtn.count()) === 1)
      check(`${tag} a: Send set-password email absent`, await sendBtn.count(), (await sendBtn.count()) === 0)
      await s.unclipped('a callout', callout)
      await s.noOverflow('a')
      if (vp.mobile) { await s.inViewport('a', 'Confirm address button', confirmBtn); await s.tap('a', 'Confirm address button', confirmBtn) }
      await s.shoot('a-held', [heading, confirmBtn, callout])
      await s.fullPage('a', confirmBtn)

      // (b) the confirm dialog
      await confirmBtn.click()
      const dialog = page.getByRole('alertdialog')
      await dialog.waitFor({ timeout: 10_000 })
      await settled(page)
      const use = dialog.getByRole('button', { name: 'Use this address' })
      const back = dialog.getByRole('button', { name: 'Go back' })
      check(`${tag} b: dialog copy`, await dialog.innerText(), (await dialog.innerText()).includes(EMAIL) && (await dialog.innerText()).includes('Check this address'))
      await s.noOverflow('b')
      if (vp.mobile) {
        await s.inViewport('b', 'dialog', dialog); await s.inViewport('b', 'Use this address', use); await s.inViewport('b', 'Go back', back)
        await s.tap('b', 'Use this address', use); await s.tap('b', 'Go back', back)
      }
      await s.shoot('b-dialog', [dialog])

      // (d) a confirm error: danger notice, callout stays
      confirmMode = 'fail'
      await use.click()
      const errorNotice = page.getByText(CONFIRM_ERROR, { exact: true })
      await errorNotice.waitFor({ timeout: 10_000 })
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
      await settled(page)
      check(`${tag} d: callout still there`, await callout.count(), (await callout.count()) === 1)
      check(`${tag} d: Confirm address still there`, await confirmBtn.count(), (await confirmBtn.count()) === 1)
      await s.noOverflow('d')
      await s.unclipped('d notice', errorNotice)
      await s.shoot('d-error', [heading, errorNotice, confirmBtn, callout])

      // (c) a confirm that works: success notice; callout and button gone
      confirmMode = 'ok'
      await confirmBtn.click()
      await dialog.waitFor({ timeout: 10_000 })
      await settled(page)
      await use.click()
      const okNotice = page.getByText(CONFIRMED, { exact: true })
      await okNotice.waitFor({ timeout: 10_000 })
      await sendBtn.first().waitFor({ timeout: 10_000 })
      await settled(page)
      check(`${tag} c: callout gone`, await callout.count(), (await callout.count()) === 0)
      check(`${tag} c: Confirm address gone`, await confirmBtn.count(), (await confirmBtn.count()) === 0)
      check(`${tag} c: Send set-password email back`, await sendBtn.count(), (await sendBtn.count()) >= 1)
      await s.noOverflow('c')
      await s.unclipped('c notice', okNotice)
      if (vp.mobile) await s.inViewport('c', 'Send button', sendBtn.first())
      await s.shoot('c-confirmed', [heading, okNotice, sendBtn.first()])
      check(`${tag}: firebase.ts stub applied`, s.patchedCount(), s.patchedCount() > 0)
      await s.context.close()

      // (e) the same page for a non-manager (the flag is served true on purpose: the page must still hide it)
      held = true
      const e = await session(vp, scheme, 'ReadOnly')
      await e.openStaff()
      check(`${tag} e: callout absent`, await e.page.getByText(CALLOUT, { exact: true }).count(), (await e.page.getByText(CALLOUT, { exact: true }).count()) === 0)
      check(`${tag} e: Confirm address absent`, await e.page.locator('[data-confirm-address]').count(), (await e.page.locator('[data-confirm-address]').count()) === 0)
      await e.noOverflow('e')
      await e.shoot('e-readonly', [e.page.getByText(NAME, { exact: true }).first()])
      await e.context.close()

      // (f) Settings > Integrations > Needs attention
      held = true
      const f = await session(vp, scheme, 'Admin')
      await f.page.goto(`${BASE_URL}/settings?section=integrations`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const group = f.page.locator('#eh-group-ConfirmAddress')
      await group.waitFor({ timeout: 60_000 })
      await settled(f.page)
      const section = group.locator('xpath=..')
      const open = section.getByRole('link', { name: `Open staff page: ${NAME}` }).or(section.getByRole('button', { name: `Open staff page: ${NAME}` }))
      check(`${tag} f: group title`, await group.innerText(), (await group.innerText()) === 'Confirm email address (1)')
      check(`${tag} f: Open staff page goes to the staff page`, await open.getAttribute('href'), (await open.getAttribute('href')) === `/staff/${SID}`)
      check(`${tag} f: no Dismiss in the group`, await section.getByRole('button', { name: /Dismiss/ }).count(), (await section.getByRole('button', { name: /Dismiss/ }).count()) === 0)
      await f.noOverflow('f')
      if (vp.mobile) { await open.scrollIntoViewIfNeeded(); await f.inViewport('f', 'Open staff page', open); await f.tap('f', 'Open staff page', open) }
      await f.shoot('f-integrations', [f.page.locator('#eh-attention'), section])
      await f.context.close()

      // (g) the login page, refused at the exchange
      const g = await session(vp, scheme, 'Admin', { signIn: false })
      await g.page.route('**/identitytoolkit.googleapis.com/**', (r) => {
        if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS })
        const url = r.request().url()
        const json = url.includes('accounts:lookup')
          ? { kind: 'identitytoolkit#GetAccountInfoResponse', users: [{ localId: 'u1', email: EMAIL, emailVerified: true, providerUserInfo: [{ providerId: 'password', federatedId: EMAIL, email: EMAIL, rawId: EMAIL }], lastLoginAt: '1', createdAt: '1' }] }
          : { kind: 'identitytoolkit#VerifyPasswordResponse', localId: 'u1', email: EMAIL, idToken: FAKE_JWT, refreshToken: 'refresh', expiresIn: '3600', registered: true }
        return r.fulfill({ json, headers: CORS })
      })
      await g.page.route('**/api/v1/auth/exchange', (r) => r.fulfill({ status: 401, json: { success: false, data: null, message: 'Unauthorized', errors: ['Unauthorized'], code: 'AddressUnconfirmed' } }))
      await g.page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await g.page.locator('#login-email').fill(EMAIL)
      await g.page.locator('#login-password').fill('not-a-real-password')
      await g.page.locator('form button[type="submit"]').first().click()
      const sentence = g.page.getByText(REFUSAL, { exact: true })
      await sentence.waitFor({ timeout: 20_000 })
      const next = g.page.getByText(NEXT_STEP, { exact: true })
      await settled(g.page)
      check(`${tag} g: next step shown`, await next.count(), (await next.count()) === 1)
      await g.unclipped('g sentence', sentence)
      await g.unclipped('g next step', next)
      await g.noOverflow('g')
      await g.shoot('g-login-refusal', [sentence, next])
      await g.context.close()
    }
  }
} finally {
  const pass = lines.filter((l) => l.startsWith('CHECK ok')).length
  lines.push(`TOTAL ${pass}/${lines.length} passed`)
  console.log(lines[lines.length - 1])
  writeFileSync(path.join(OUT_DIR, 'measure.txt'), lines.join('\n') + '\n')
  writeFileSync(path.join(OUT_DIR, 'checks.json'), JSON.stringify(lines.filter((l) => l.startsWith('CHECK')).map((l) => ({ ok: l.startsWith('CHECK ok'), line: l })), null, 1))
  await browser.close()
}
process.exit(failed ? 1 : 0)
