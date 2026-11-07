// Hunt 17: the Notes field error on the staff edit form (2,001 characters, Save pressed, no PUT sent). Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path>/e2e/shots/hunt-17.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, overlapCheck, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const ERROR_TEXT = 'Notes can be up to 2,000 characters. Shorten them to save.'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const worker = {
  id: 'st-worker', firstName: 'Sam', lastName: 'Lee', fullName: 'Sam Lee', username: 'st-worker', role: 'SupportWorker', position: 'SupportWorker',
  email: 'st-worker@example.com', mobile: null, region: 'North', isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
  isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null,
  manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null,
  hasExpiredQualifications: false, notes: null,
  employmentStartDate: null, hasSignedIn: false, signInInviteSentAt: null, signInAddressUnconfirmed: false,
}

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

const browser = await chromium.launch({ headless: true })
const SCENES = [
  { tag: '390-light', width: 390, height: 844, touch: true, scheme: 'light' },
  { tag: '1280-light', width: 1280, height: 900, touch: false, scheme: 'light' },
  { tag: '1280-dark', width: 1280, height: 900, touch: false, scheme: 'dark' },
]
for (const s of SCENES) {
  try {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: s.width, height: s.height }, hasTouch: s.touch, isMobile: s.touch, colorScheme: s.scheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', (e) => console.log(`[hunt-17] pageerror ${String(e.message).slice(0, 200)}`))
    let puts = 0
    await page.route(/\/api\/v1\/staff\/st-worker(\?.*)?$/, (r) => {
      if (r.request().method() === 'PUT') { puts++; return r.fulfill({ json: envelope(worker) }) }
      return r.fulfill({ json: envelope(worker) })
    })
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/staff/st-worker/edit`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const notes = page.getByLabel('Notes')
    await notes.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForFunction(() => document.querySelector('input[name="firstName"]')?.value === 'Sam', null, { timeout: 30_000 }) // the loaded record resets the form; fill after it
    await notes.evaluate((el) => el.removeAttribute('maxlength')) // fill() honours maxLength; the schema error is the guard behind it
    await notes.fill('x'.repeat(2001))
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const err = page.getByText(ERROR_TEXT, { exact: true })
    await err.waitFor({ state: 'visible', timeout: 15_000 }).catch(async (e) => { console.log('[hunt-17] form text: ' + page.url() + ' ' + (await page.locator('body').innerText({ timeout: 5000 })).replace(/s+/g, ' ').slice(0, 600)); throw e })
    await page.waitForTimeout(600)
    const field = notes.locator('xpath=ancestor::*[.//*[normalize-space(text())="Notes"] and .//textarea and .//*[normalize-space(text())="' + ERROR_TEXT + '"]][1]')
    const target = (await field.count()) ? field.first() : notes
    const crop = await cropElement(page, target, path.join(OUT_DIR, `notes-error-${s.tag}.png`), {
      touch: s.touch, hideChrome: true,
      during: async (clip) => { await page.waitForTimeout(500); return overlapCheck(target, clip, `notes-error-${s.tag}.png`) },
    })
    checks.push(checkCropHolds({ ...crop, touch: s.touch }))
    checks.push(crop.measured)
    check(`${s.tag}: error text is exact`, (await err.count()) === 1 && (await err.textContent()) === ERROR_TEXT, await err.allTextContents())
    check(`${s.tag}: no PUT went out`, puts === 0, { puts })
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `edit-${s.tag}.png`), { touch: s.touch })).checks)
    await context.close()
  } catch (e) {
    check(`${s.tag}: scene ran`, false, String(e.message).split('\n')[0])
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
