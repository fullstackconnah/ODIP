// Hunt 29 fixes. (a) caregiver-name-too-long: the public caregiver form after a save refused with the name message; (b) link-blocked-pending: the participant page's caregiver-link
// error after the 409. Each at desktop 1280 and touch 390. Numeric: both messages are on the page in a role=alert, the inputs carry maxlength 150 and 100, the alert is destructive
// coloured, no horizontal scroll, and at touch the Save button and the menu option are at least --tap-min (44). The API calls are answered in the script (no caregiver routes in the mock).
// Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/hunt-29-fix.mjs <outdir>
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const failure = (error) => ({ success: false, data: null, message: null, errors: [error] })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }

const NAME_MESSAGE = 'Your name can be up to 150 characters.'
const PENDING_MESSAGE = 'A caregiver form is waiting for review. Accept or decline it before sending a new link.'
const TAP_MIN = 44

const shoot = async (page, loc, file, opts = {}) => {
  const shot = await cropElement(page, loc, file, { pad: 24, hideChrome: true, ...opts, during: async (clip) => { await page.waitForTimeout(300); return overlapCheck(loc, clip, path.basename(file)) } })
  checks.push(shot.measured, checkCropHolds(shot))
}
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const destructiveOf = (page) => page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--color-destructive)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c })

async function newPage(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  return { context, page }
}
async function signIn(page) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' }) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}

const VIEWPORTS = [
  { name: 'desktop-1280', width: 1280, height: 900, touch: false },
  { name: 'touch-390', width: 390, height: 844, touch: true },
]
const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    // (a) the public caregiver form: no session, the token is the link.
    {
      const { context, page } = await newPage(browser, vp)
      const form = { status: 'Draft', caregiverName: null, caregiverRelationship: null, expiresAt: '2099-01-01T00:00:00Z', rejectionNote: null, providerName: 'Ability Options', current: { firstName: 'Sophie', lastName: 'Rivers' }, editable: [], draft: null }
      await page.route('**/api/v1/public/caregiver/tok-1', (r) => r.fulfill({ json: envelope(form) }))
      await page.route('**/api/v1/public/caregiver/tok-1/draft', (r) => r.fulfill({ status: 400, json: failure(NAME_MESSAGE) }))
      await page.goto(`${BASE_URL}/caregiver/tok-1`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const name = page.getByLabel(/^your name/i)
      await name.waitFor({ state: 'visible', timeout: 60_000 })
      check(`${vp.name} a: name input maxlength 150`, (await name.getAttribute('maxlength')) === '150', await name.getAttribute('maxlength'))
      const rel = page.getByLabel(/relationship to the participant/i)
      check(`${vp.name} a: relationship input maxlength 100`, (await rel.getAttribute('maxlength')) === '100', await rel.getAttribute('maxlength'))
      await name.fill('Jane Doe')
      const save = page.getByRole('button', { name: 'Save and continue later' })
      await save.click()
      const alert = page.getByRole('alert').filter({ hasText: NAME_MESSAGE })
      await alert.waitFor({ state: 'visible', timeout: 15_000 })
      check(`${vp.name} a: the server's name message is shown in a role=alert`, (await alert.count()) === 1, await alert.first().textContent())
      const destructive = await destructiveOf(page)
      check(`${vp.name} a: alert text is --color-destructive`, (await alert.first().evaluate((el) => getComputedStyle(el).color)) === destructive)
      if (vp.touch) {
        check('a: pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
        const h = (await save.boundingBox()).height
        check(`${vp.name} a: Save and continue later >= --tap-min (${TAP_MIN})`, h >= TAP_MIN - 0.6, h)
      }
      check(`${vp.name} a: no horizontal scroll`, (await overflowX(page)) <= 0, await overflowX(page))
      await shoot(page, page.locator('form'), path.join(OUT_DIR, `caregiver-name-too-long-${vp.name}.png`), { natural: true })
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `caregiver-name-too-long-${vp.name}.png`), { touch: vp.touch })).checks)
      await context.close()
    }
    // (b) the participant page: a Submitted form waits, Regenerate is refused with the 409.
    {
      const { context, page } = await newPage(browser, vp)
      await signIn(page)
      const waiting = { id: 'sub-1', participantId: 'p-0004', participantName: 'Participant', status: 'Submitted', caregiverName: 'Jane Smith', createdAt: '2026-11-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', submittedAt: '2026-11-02T00:00:00Z' }
      await page.route('**/api/v1/caregiver-submissions?status=Submitted*', (r) => r.fulfill({ json: envelope([waiting]) }))
      await page.route('**/api/v1/caregiver-submissions?status=Draft*', (r) => r.fulfill({ json: envelope([]) }))
      await page.route('**/api/v1/participants/p-0004/caregiver-link', (r) => r.request().method() === 'POST' ? r.fulfill({ status: 409, json: failure(PENDING_MESSAGE) }) : r.continue())
      await page.goto(`${BASE_URL}/participants/p-0004`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const docs = page.getByRole('button', { name: /^Documents$/ })
      await docs.waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(800)
      await docs.click()
      const opt = page.getByRole('option', { name: /regenerate caregiver link/i })
      await opt.waitFor({ state: 'visible', timeout: 15_000 })
      if (vp.touch) { const h = (await opt.boundingBox()).height; check(`${vp.name} b: menu option >= --tap-min (${TAP_MIN})`, h >= TAP_MIN - 0.6, h) }
      await opt.click()
      const control = page.getByTestId('caregiver-link-control')
      const alert = control.getByRole('alert')
      await alert.waitFor({ state: 'visible', timeout: 15_000 })
      check(`${vp.name} b: the pending-review message is shown in a role=alert`, (await alert.textContent()).trim() === PENDING_MESSAGE, await alert.textContent())
      const destructive = await destructiveOf(page)
      check(`${vp.name} b: alert text is --color-destructive`, (await alert.evaluate((el) => getComputedStyle(el).color)) === destructive)
      check(`${vp.name} b: no link was issued (no Copy link button)`, (await page.getByRole('button', { name: 'Copy link' }).count()) === 0)
      check(`${vp.name} b: no horizontal scroll`, (await overflowX(page)) <= 0, await overflowX(page))
      await shoot(page, alert, path.join(OUT_DIR, `link-blocked-pending-${vp.name}.png`), { pad: 48 })
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `link-blocked-pending-${vp.name}.png`), { touch: vp.touch })).checks)
      await context.close()
    }
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
