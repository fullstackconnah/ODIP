// Staff list row menu as a Coordinator: no change actions on an Admin row, the full set on a SupportWorker row. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/staff-admin-guards.mjs <outdir>
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
const login = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])

const person = (id, first, last, role) => ({
  id, firstName: first, lastName: last, fullName: `${first} ${last}`, username: id, role, position: role === 'Admin' ? 'Coordinator' : 'SupportWorker',
  email: `${id}@example.com`, mobile: null, region: 'North', isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
  isManualHandlingCompetent: false, isOvernightEligible: false, isActive: true, firstAidExpiryDate: null, driverLicenceExpiryDate: null,
  manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null, workerScreeningNumber: null, workerScreeningExpiryDate: null,
  hasExpiredQualifications: false, notes: null,
})
const STAFF = [person('st-admin', 'Ada', 'Admin', 'Admin'), person('st-worker', 'Sam', 'Lee', 'SupportWorker')]

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

const browser = await chromium.launch({ headless: true })
const SCENES = [
  { tag: '1280', width: 1280, height: 900, touch: false },
  { tag: '390', width: 390, height: 844, touch: true },
]
for (const s of SCENES) {
  try {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: s.width, height: s.height }, hasTouch: s.touch, isMobile: s.touch })
    const page = await context.newPage()
    page.on('pageerror', (e) => console.log(`[staff-admin-guards] pageerror ${String(e.message).slice(0, 200)}`))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login('Coordinator') }))
    await page.route(/\/api\/v1\/staff(\?.*)?$/, (r) => r.fulfill({ json: envelope(STAFF) }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/staff`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('link', { name: 'Ada Admin' }).first().waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(600)

    for (const [who, label, expectChange] of [['Ada Admin', 'admin', false], ['Sam Lee', 'worker', true]]) {
      const row = page.locator('tr, li, [role=row]', { has: page.getByRole('link', { name: who }) }).last()
      if (s.touch) {
        // Phone: the card's ⋯ menu, opened; Admin row has only the leave link (or no menu at all).
        const trigger = page.getByRole('button', { name: `More actions for ${who}` })
        const present = (await trigger.count()) > 0
        check(`${s.tag} ${label}: menu button ${expectChange ? 'present' : 'present with Leave only'}`, present, present)
        if (present) {
          await trigger.click()
          const options = page.getByRole('option')
          await options.first().waitFor({ state: 'visible', timeout: 10_000 })
          const labels = await options.allInnerTexts()
          const hasChange = labels.some((t) => /^(Edit|Deactivate|Archive)$/.test(t.trim()))
          check(`${s.tag} ${label}: change actions ${expectChange ? 'offered' : 'absent'}`, hasChange === expectChange, labels)
          const heights = await options.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
          const tapMin = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')))
          check(`${s.tag} ${label}: menu items >= --tap-min (${tapMin}px)`, tapMin > 0 && heights.every((h) => h >= tapMin - 0.5), heights)
          const crop = await cropElement(page, page.getByRole('listbox').first(), path.join(OUT_DIR, `menu-${label}-${s.tag}.png`), { touch: s.touch })
          checks.push(checkCropHolds({ ...crop, touch: s.touch }))
          await page.keyboard.press('Escape')
        }
      } else {
        await row.hover()
        const names = await row.locator('a[aria-label], button[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
        const hasChange = names.some((t) => /^(Edit|Deactivate|Archive)$/.test(t))
        check(`${s.tag} ${label}: change actions ${expectChange ? 'offered' : 'absent'}`, hasChange === expectChange, names)
        const crop = await cropElement(page, row, path.join(OUT_DIR, `row-${label}-${s.tag}.png`), { touch: s.touch })
        checks.push(checkCropHolds({ ...crop, touch: s.touch }))
      }
    }
    await context.close()
  } catch (e) {
    check(`${s.tag}: scene ran`, false, String(e.message).split('\n')[0])
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
