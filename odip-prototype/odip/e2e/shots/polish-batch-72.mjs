// Polish batch 72. Numeric checks, exit 1 on any failure.
// PSA-O2: ReadOnly no longer reads as allowed to edit organisation settings (canEditProviderSettings mirrors the server's SuperAdmin,Admin save gate). ReadOnly cannot open Settings at all
//   (READ_ONLY_REFUSED_PAGES has 'settings'), so `readonly-settings-*` capture the page it lands on after /settings?section=organisation: no organisation field and no enabled Save on it.
// PB70-F2: the Review step rows read "Health Conditions" and "ADL Ratings (Personal + Community/Domestic)", with no "structured grid" anywhere (`review-labels-390`).
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-72.mjs <outdir>
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }

const READ_ONLY = envelope({ id: '00000000-0000-0000-0000-0000000000a9', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.readonly', fullName: 'Dev ReadOnly', role: 'ReadOnly', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.readonly', role: 'ReadOnly', tenantName: 'Sample Support Co' }])

const form = { status: 'Draft', caregiverName: null, caregiverRelationship: null, expiresAt: '2099-01-01T00:00:00Z', rejectionNote: null, providerName: 'Ability Options', current: { firstName: 'Sophie', lastName: 'Rivers' }, editable: [], draft: null }
const reviewForm = { ...form, current: { ...form.current, healthConditions: [{ conditionType: 'Epilepsy', has: true }], adlAssessments: [{ adlType: 'Dressing', level: 'Independent' }, { adlType: 'Bathing', level: 'Supervision' }] } }
const HEALTH = 'Health Conditions'
const ADL = 'ADL Ratings (Personal + Community/Domestic)'
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const newContext = (browser, width, height, touch) => browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: 'light', reducedMotion: 'reduce' })

// The Review card a row label sits in (the same `space-y-2` card the caregiver script crops).
const cardOfRow = (page, label) => page.getByText(label, { exact: true }).locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " space-y-2 ")][1]')

const browser = await chromium.launch({ headless: true })
try {
  for (const [W, H, touch] of [[1280, 900, false], [390, 844, true]]) {
    const context = await newContext(browser, W, H, touch)
    const page = await context.newPage()
    page.on('pageerror', (e) => check(`page error (readonly ${W})`, false, e.message))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: READ_ONLY }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/settings?section=organisation`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.locator('main').first().waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(1000)
    const tag = `readonly-settings-${W}`
    const where = new URL(page.url()).pathname
    check(`${tag}: ReadOnly is sent away from /settings`, where === '/', where)
    check(`${tag}: no Organisation profile section on the page`, (await page.getByText(/organisation profile/i).count()) === 0)
    check(`${tag}: no organisation field (legal name, ABN, BSB) on the page`, (await page.getByLabel(/legal name|\bABN\b|\bBSB\b/i).count()) === 0)
    const enabledSave = await page.getByRole('button', { name: /^save/i }).evaluateAll((els) => els.filter((el) => !el.disabled).length)
    check(`${tag}: no enabled Save button`, enabledSave === 0, enabledSave)
    check(`${tag}: no horizontal scroll`, (await overflowX(page)) <= 0, await overflowX(page))
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${tag}.png`), { touch })).checks)
    await context.close()
  }

  // review-labels-390: the caregiver Review step, filled with one health condition and two ADL ratings.
  {
    const context = await newContext(browser, 390, 844, true)
    const page = await context.newPage()
    page.on('pageerror', (e) => check('page error (review-labels-390)', false, e.message))
    await page.route('**/api/v1/public/caregiver/tok-1', (r) => r.fulfill({ json: envelope(reviewForm) }))
    await page.route('**/api/v1/public/caregiver/tok-1/draft', (r) => r.fulfill({ status: 204, body: '' }))
    await page.goto(`${BASE_URL}/caregiver/tok-1`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const name = page.getByLabel(/^your name/i)
    await name.waitFor({ state: 'visible', timeout: 60_000 })
    await name.fill('Jane Doe')
    const next = page.getByRole('button', { name: /^next$/i })
    for (let i = 0; i < 7; i++) { await next.click(); await page.waitForTimeout(250) }
    await page.getByRole('button', { name: /submit for review/i }).waitFor({ state: 'visible', timeout: 15_000 })
    const tag = 'review-labels-390'
    const labels = await page.locator('main dl dt').allTextContents()
    check(`${tag}: a row reads exactly "${HEALTH}"`, labels.map((l) => l.trim()).includes(HEALTH))
    check(`${tag}: a row reads exactly "${ADL}"`, labels.map((l) => l.trim()).includes(ADL))
    check(`${tag}: no label contains "structured grid"`, !labels.some((l) => /structured grid/i.test(l)), labels.filter((l) => /structured grid/i.test(l)).join(', '))
    check(`${tag}: "structured grid" is nowhere on the page`, !/structured grid/i.test(await page.locator('body').innerText()))
    check(`${tag}: no horizontal scroll`, (await overflowX(page)) <= 0, await overflowX(page))
    for (const [label, file] of [[HEALTH, `${tag}.png`], [ADL, 'review-labels-adl-390.png']]) {
      const card = cardOfRow(page, label)
      const shot = await cropElement(page, card, path.join(OUT_DIR, file), { pad: 24, natural: true, hideChrome: true, during: async (clip) => { await page.waitForTimeout(300); return overlapCheck(card, clip, file) } })
      checks.push(shot.measured, checkCropHolds(shot))
    }
    await context.close()
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
