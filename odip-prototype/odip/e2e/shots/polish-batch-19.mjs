// Staff detail summary strip for a person with no upcoming shift: Next shift reads "None" on one line. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/polish-batch-19.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const worker = {
  id: 'st-worker', firstName: 'Sam', lastName: 'Lee', fullName: 'Sam Lee', username: 'st-worker', role: 'SupportWorker', position: 'SupportWorker',
  email: 'st-worker@example.com', mobile: null, region: 'North', isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
  isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null,
  manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null,
  hasExpiredQualifications: false, notes: null,
  employmentStartDate: null, hasSignedIn: false, signInInviteSentAt: null, signInAddressUnconfirmed: false,
}
const overview = envelope({ staff: worker, availability: [], upcomingShifts: [], upcomingTripAssignments: [], recentIncidents: [], recentCompletions: [] })

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

const browser = await chromium.launch({ headless: true })
for (const s of [{ tag: '1280', width: 1280, height: 900, touch: false }, { tag: '390', width: 390, height: 844, touch: true }]) {
  try {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: s.width, height: s.height }, hasTouch: s.touch, isMobile: s.touch })
    const page = await context.newPage()
    page.on('pageerror', (e) => console.log(`[polish-batch-19] pageerror ${String(e.message).slice(0, 200)}`))
    await page.route('**/api/v1/staff/*/overview*', (r) => r.fulfill({ json: overview }))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/staff/st-worker`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const label = page.getByText('Next shift', { exact: true })
    await label.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(600)
    const strip = label.locator('xpath=ancestor::div[contains(@class,"grid")][1]')
    const crop = await cropElement(page, strip, path.join(OUT_DIR, `strip-${s.tag}.png`), { touch: s.touch })
    checks.push(checkCropHolds({ ...crop, touch: s.touch }))
    const m = await strip.evaluate((el) => {
      const lh = (n) => parseFloat(getComputedStyle(n).lineHeight) || parseFloat(getComputedStyle(n).fontSize) * 1.2
      const value = [...el.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent.trim() === 'None')
      return { valueText: value?.textContent.trim() ?? null, valueH: value?.getBoundingClientRect().height ?? null, lineH: value ? lh(value) : null,
        scrollW: el.scrollWidth, clientW: el.clientWidth, pageScrollW: document.scrollingElement.scrollWidth, innerW: innerWidth }
    })
    check(`${s.tag}: Next shift value reads "None"`, m.valueText === 'None', m.valueText)
    check(`${s.tag}: Next shift value is one line`, m.valueH != null && m.valueH <= m.lineH + 1, { valueH: m.valueH, lineH: m.lineH })
    check(`${s.tag}: strip has no horizontal overflow`, m.scrollW <= m.clientW && m.pageScrollW <= m.innerW, m)
    await context.close()
  } catch (e) {
    check(`${s.tag}: scene ran`, false, String(e.message).split('\n')[0])
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
