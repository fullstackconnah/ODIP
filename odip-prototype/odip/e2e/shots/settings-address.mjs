// Captures and numeric checks for the Settings address field, relabelled "Registered business address" (S12). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/settings-address.mjs <outdir>
// The provider-settings GET and the dev sign-in are stubbed with page.route (a synthetic row). Prints "CHECK ok|FAIL name = value" and exits non-zero when a check fails.
import path from 'node:path'
import { cropElement, checkCropHolds, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const row = {
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Melbourne VIC 3000',
  state: 'VIC', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null,
  timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role: 'Admin', tenantName: 'Sample Support Co' })

const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(measured)}`)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const [width, height, touch] of [[1280, 800, false], [390, 844, true]]) {
    const ctx = `${width} light`
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: 'light', reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.user', role: 'Admin', tenantName: 'Sample Support Co' }]) }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
    await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope(row) }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/settings?section=organisation`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const input = page.getByRole('textbox', { name: 'Registered business address' })
    await input.waitFor({ timeout: 60_000 })

    const label = page.locator('label', { hasText: 'Registered business address' })
    const m = await label.evaluate((el) => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height }))
    check('label fits on one line', ctx, m, m.height <= m.line + 1)
    const hint = await input.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.innerText ?? '')
    check('hint reads "Printed on invoices and agreements."', ctx, hint, hint.trim() === 'Printed on invoices and agreements.')
    check('the old plain "Address" label is gone', ctx, await page.getByRole('textbox', { name: 'Address', exact: true }).count(), (await page.getByRole('textbox', { name: 'Address', exact: true }).count()) === 0)
    check('the stored address shows', ctx, await input.inputValue(), (await input.inputValue()) === row.address)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check('no horizontal page scroll', ctx, overflow, overflow <= 0)

    const group = input.locator('xpath=ancestor::*[@role="region" or self::section or self::fieldset][1]')
    const r = await cropElement(page, (await group.count()) ? group : input, path.join(OUT_DIR, `address-${width}-light.png`), { touch, natural: true })
    checks.push(checkCropHolds(r))
    await context.close()
  }
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
