// Captures and text checks for the Admin-row guard: the Staff detail header and the held-address Callout for an Admin row, seen by a Coordinator and by an Admin.
// The staff overview is a page.route stub over the mock API. Exits non-zero when a check fails.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { prepareOutDir, cropElement, fullPage, checkCropHolds, overlapCheck, writeChecks, AU_CONTEXT } from '../shots/lib/capture.mjs'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  ;({ chromium } = await import('@playwright/test'))
}

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const SID = '00000000-0000-0000-0000-0000000000c1'
const NAME = 'Ada Min'
const EMAIL = 'ada@other.org'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const loginAs = (role) => ({
  users: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]),
  login: envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' }),
})
const overview = envelope({
  staff: {
    id: SID, firstName: 'Ada', lastName: 'Min', fullName: NAME, username: 'ada', role: 'Admin', position: 'Coordinator', email: EMAIL, mobile: null,
    region: 'North', isActive: true, hasExpiredQualifications: false, notes: null, hasSignedIn: false, signInInviteSentAt: null, signInAddressUnconfirmed: true,
  },
  availability: [], upcomingShifts: [], upcomingTripAssignments: [], recentIncidents: [], recentCompletions: [],
})
const CALLOUT_START = `${EMAIL} came from Employment Hero and isn't at your organisation's domain or a common email provider. Ada can't sign in until `
const STATES = [
  { name: 'coord-admin-held', role: 'Coordinator', tail: 'it is confirmed. An Admin can confirm this address.', confirm: false },
  { name: 'admin-admin-held', role: 'Admin', tail: 'you confirm it.', confirm: true },
]
const VIEWPORTS = [
  { name: 'touch-390', width: 390, height: 844, touch: true, scheme: 'light', states: ['coord-admin-held', 'admin-admin-held'] },
  { name: 'desktop-1280', width: 1280, height: 900, touch: false, scheme: 'light', states: ['coord-admin-held', 'admin-admin-held'] },
  { name: 'desktop-1280-dark', width: 1280, height: 900, touch: false, scheme: 'dark', states: ['coord-admin-held'] },
]

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, pass: !!ok, detail }); console.log(`[admin-row-guard] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }

try {
  for (const vp of VIEWPORTS) {
    for (const st of STATES.filter((s) => vp.states.includes(s.name))) {
      const tag = `${vp.name} ${st.name}`
      const who = loginAs(st.role)
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: vp.scheme, reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.on('pageerror', (e) => check(`${tag} page error`, false, e.message))
      await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: who.users }))
      await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: who.login }))
      await page.route(/\/api\/v1\/staff\/[^/]+\/overview(\?.*)?$/, (r) => r.fulfill({ json: overview }))
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
      await signIn.waitFor({ state: 'visible', timeout: 60_000 })
      await signIn.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
      await page.goto(`${BASE_URL}/staff/${SID}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const title = page.getByRole('heading', { name: NAME })
      await title.waitFor({ state: 'visible', timeout: 60_000 })
      const callout = page.getByText(CALLOUT_START, { exact: false })
      await callout.waitFor({ state: 'visible', timeout: 10_000 })

      const text = (await callout.innerText()).trim()
      check(`${tag}: Callout ends "${st.tail}"`, text === CALLOUT_START + st.tail, text)
      const confirmBtn = page.getByRole('button', { name: 'Confirm address' })
      const editLink = page.getByRole('link', { name: 'Edit', exact: true })
      const setPassword = page.getByRole('button', { name: 'Send set-password email' })
      check(`${tag}: Confirm address ${st.confirm ? 'shown' : 'absent'}`, (await confirmBtn.count()) === (st.confirm ? 1 : 0))
      check(`${tag}: Edit ${st.confirm ? 'shown' : 'absent'}`, (await editLink.count()) === (st.confirm ? 1 : 0))
      check(`${tag}: Send set-password absent`, (await setPassword.count()) === 0)
      check(`${tag}: no horizontal page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      if (vp.touch) check(`${tag}: pointer is coarse`, await page.evaluate(() => matchMedia('(pointer: coarse)').matches))

      // hideChrome drops the sticky bar and bottom nav (hence the wait); overlapCheck fails a crop they still cover.
      const shot = await cropElement(page, title, path.join(OUT_DIR, `${tag.replace(' ', '-')}.png`), {
        also: callout, hideChrome: true, touch: vp.touch,
        during: async (clip) => { await page.waitForTimeout(500); return overlapCheck(callout, clip, `${tag}.png`) },
      })
      checks.push(shot.measured, checkCropHolds(shot))
      if (st.name === 'coord-admin-held') {
        mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })
        checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${vp.name}.png`), { touch: vp.touch })).checks)
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
