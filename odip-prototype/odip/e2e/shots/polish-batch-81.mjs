// Polish batch 81. The participant page's caregiver link: Regenerate once (the issued-link panel shows), then Regenerate again and the API answers 409 (the link on screen is dead).
// Numeric: after the 409 the caregiver-link-control holds no `code` element, no "Copy this link now" and no Copy link button; its role="alert" line shows the fixture's message; layout checks from the helper.
// The API calls the pages make are answered in the script (no caregiver routes in the mock). Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-81.mjs <outdir>
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const MESSAGE = "This participant's link just changed. Reload and try again."
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }

const draft = { id: 'sub-1', participantId: 'p-0004', participantName: 'Participant', status: 'Draft', caregiverName: null, createdAt: '2026-11-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', submittedAt: null }

const shoot = async (page, loc, file, opts = {}) => {
  const shot = await cropElement(page, loc, file, { pad: 24, hideChrome: true, ...opts, during: async (clip) => { await page.waitForTimeout(300); return overlapCheck(loc, clip, path.basename(file)) } })
  checks.push(shot.measured, checkCropHolds(shot))
}
// The participant tabs strip scrolls sideways below md by design (Tabs.tsx), so its inner scroll is no layout fault.
const TAB_STRIP = ['[role="tablist"]']
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

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
const chooseFromDocuments = async (page, name) => {
  await page.getByRole('button', { name: /^Documents$/ }).click()
  const opt = page.getByRole('option', { name })
  await opt.waitFor({ state: 'visible', timeout: 15_000 })
  await opt.click()
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900, touch: false },
  { name: '390', width: 390, height: 844, touch: true },
]
const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    // A Draft link is active, so the menu offers Regenerate. The first Regenerate succeeds; the second is refused with a 409.
    const { context, page } = await newPage(browser, vp)
    await signIn(page)
    let posts = 0
    await page.route(/\/api\/v1\/caregiver-submissions\?.*status=Draft/, (r) => r.fulfill({ json: envelope([draft]) }))
    await page.route(/\/api\/v1\/caregiver-submissions\?.*status=Submitted/, (r) => r.fulfill({ json: envelope([]) }))
    await page.route('**/api/v1/participants/p-0004/caregiver-link', (r) => {
      if (r.request().method() !== 'POST') return r.fulfill({ status: 204, body: '' })
      posts += 1
      if (posts === 1) return r.fulfill({ json: envelope({ token: 'tok-shot-0123456789abcdef0123456789abcdef', expiresAt: '2026-11-24T00:00:00Z' }) })
      return r.fulfill({ status: 409, json: { success: false, data: null, message: null, errors: [MESSAGE] } })
    })
    await page.goto(`${BASE_URL}/participants/p-0004`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: /^Documents$/ }).waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(800)

    await chooseFromDocuments(page, /regenerate caregiver link/i)
    const control = page.getByTestId('caregiver-link-control')
    await control.getByRole('button', { name: 'Copy link' }).waitFor({ state: 'visible', timeout: 15_000 })
    check(`${vp.name} 409: before the refusal the panel shows its link`, (await control.locator('code').count()) === 1, await control.locator('code').count())

    await chooseFromDocuments(page, /regenerate caregiver link/i)
    const alert = control.getByRole('alert')
    await alert.waitFor({ state: 'visible', timeout: 15_000 })
    await page.waitForTimeout(500)
    check(`${vp.name} 409: Regenerate was asked twice`, posts === 2, posts)
    check(`${vp.name} 409: the control holds no code element`, (await control.locator('code').count()) === 0, await control.locator('code').count())
    check(`${vp.name} 409: no "Copy this link now" in the control`, (await control.getByText('Copy this link now').count()) === 0, await control.getByText('Copy this link now').count())
    check(`${vp.name} 409: no Copy link button`, (await control.getByRole('button', { name: 'Copy link' }).count()) === 0, await control.getByRole('button', { name: 'Copy link' }).count())
    check(`${vp.name} 409: the alert line shows the fixture's message`, (await alert.innerText()).trim() === MESSAGE, await alert.innerText())
    check(`${vp.name} 409: no horizontal scroll`, (await overflowX(page)) <= 0, await overflowX(page))

    // The nearest ancestor of the control that holds the h1 is the PageHeader.
    const header = control.locator('xpath=ancestor::*[.//h1][1]')
    await shoot(page, header, path.join(OUT_DIR, `caregiver-regenerate-409-${vp.name}.png`), { pad: 16 })
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `participant-page-${vp.name}.png`), { touch: vp.touch, allow: TAB_STRIP })).checks)
    await context.close()
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
