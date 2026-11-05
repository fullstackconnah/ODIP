// Captures and numeric checks for Settings > Data export > Registers for auditors (B9). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/register-exports.mjs <outdir>
// Sign-in and every request the page makes are stubbed with page.route; the clock is pinned so the default range is stable.
// Prints "CHECK ok|FAIL name = value" and exits non-zero when a check fails.
import path from 'node:path'
import { cropElement, checkCropHolds, prepareOutDir, settle, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const NOW = '2026-11-05T02:00:00Z' // noon in Sydney
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const loginFor = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role, tenantName: 'Sample Support Co' })

const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(measured)}`)
}

const browser = await chromium.launch({ headless: true })
async function open(width, height, touch, role) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  try { await page.clock.setFixedTime(new Date(NOW)) } catch { /* older Playwright: the default-range check says so */ }
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: loginFor(role) }))
  await page.route('**/api/v1/data-export/last', (r) => r.fulfill({ json: envelope({ exportedAt: '2026-10-14T05:04:00Z', exportedByName: 'Jordan Lee' }) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/settings?section=export`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('heading', { name: 'Registers for auditors' }).waitFor({ timeout: 60_000 })
  return { context, page }
}

try {
  for (const [width, height, touch] of [[1280, 800, false], [390, 844, true]]) {
    const ctx = `${width}${touch ? ' touch' : ''}`
    const shot = async (page, state, locator) => {
      await settle(page)
      checks.push(checkCropHolds(await cropElement(page, locator, path.join(OUT_DIR, `${state}-${width}.png`), { touch, natural: true })))
    }

    // (1) Admin default, both sections.
    {
      const { context, page } = await open(width, height, touch, 'Admin')
      const card = page.locator('section[aria-labelledby="registers-heading"]')
      const full = page.locator('section[aria-labelledby="data-export-heading"]')
      check('the full export is there for an Admin', ctx, await full.count(), (await full.count()) === 1)
      const options = await page.getByLabel('Register', { exact: true }).locator('option').allTextContents()
      check('Admin picker lists Complaints in order', ctx, options, options.join('|') === 'Incidents|Complaints|Restrictive practices|Risks|Staff credentials')
      const from = await page.getByLabel('From', { exact: true }).inputValue(), to = await page.getByLabel('To', { exact: true }).inputValue()
      check('default range is the year to the pinned today', ctx, { from, to }, from === '2025-11-05' && to === '2026-11-05')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check('no horizontal page scroll', ctx, overflow, overflow <= 0)
      const [cb, fb] = await Promise.all([card.boundingBox(), full.boundingBox()])
      check('card is as wide as the full-export section', ctx, { card: cb?.width, full: fb?.width }, !!cb && !!fb && Math.abs(cb.width - fb.width) <= 1)
      const f = await page.getByLabel('From', { exact: true }).boundingBox(), t = await page.getByLabel('To', { exact: true }).boundingBox()
      check(touch ? 'From and To stack' : 'From and To sit side by side', ctx, { from: f, to: t }, touch ? t.y > f.y + f.height - 1 && Math.abs(t.x - f.x) <= 1 : Math.abs(t.y - f.y) <= 1 && t.x > f.x + f.width - 1)
      const b = await page.getByRole('button', { name: 'Download CSV' }).boundingBox()
      check(touch ? 'button is full width and at least 44 high' : 'button is not full width', ctx, { button: b?.width, card: cb?.width, height: b?.height }, touch ? b.width >= cb.width - 2 * 20 - 2 && b.height >= 44 : b.width < cb.width / 2)
      await shot(page, 'admin-default', page.locator('main'))
      await shot(page, 'picker-admin', page.getByLabel('Register', { exact: true }))

      // (4) Staff credentials: dates hidden, hint shown.
      await page.getByLabel('Register', { exact: true }).selectOption('staff-credentials')
      const gone = (await page.getByLabel('From', { exact: true }).count()) === 0 && (await page.getByText('Shows the register as it stands today, so there are no dates to choose.').count()) === 1
      check('dates are gone and the hint shows', ctx, gone, gone)
      await shot(page, 'staff-credentials', card)

      // (5) To before From.
      await page.getByLabel('Register', { exact: true }).selectOption('incidents')
      await page.getByLabel('From', { exact: true }).fill('2026-08-10')
      await page.getByLabel('To', { exact: true }).fill('2026-08-01')
      await page.getByRole('button', { name: 'Download CSV' }).click()
      const err = await page.getByText('The end date must be on or after the start date.').count()
      check('range error shows', ctx, err, err === 1)
      await shot(page, 'range-error', card)

      // (6) failed.
      await page.route('**/api/v1/registers/incidents**', (r) => r.fulfill({ status: 400, json: { success: false, errors: ['Choose an organisation to view as before exporting data.'] } }))
      await page.getByLabel('To', { exact: true }).fill('2026-08-20')
      await page.getByRole('button', { name: 'Download CSV' }).click()
      await page.getByText('Choose an organisation to view as before exporting data.').waitFor({ timeout: 20_000 })
      await shot(page, 'failed', card)

      // (7) busy: the request never answers.
      await page.unroute('**/api/v1/registers/incidents**')
      await page.route('**/api/v1/registers/incidents**', () => {})
      await page.getByRole('button', { name: 'Download CSV' }).click()
      const busy = page.getByRole('button', { name: 'Downloading…' })
      await busy.waitFor({ timeout: 10_000 })
      const state = await busy.evaluate((el) => ({ focus: document.activeElement === el, busy: el.getAttribute('aria-busy'), disabled: el.disabled }))
      check('busy button keeps focus, aria-busy, not disabled', ctx, state, state.focus && state.busy === 'true' && !state.disabled)
      await page.evaluate(() => document.getAnimations().forEach((x) => x.pause())) // the spinner never finishes; settle waits for it
      await shot(page, 'busy', card)
      await context.close()
    }

    // (2)(3) Coordinator: registers card only, no Complaints.
    {
      const { context, page } = await open(width, height, touch, 'Coordinator')
      const full = await page.getByRole('heading', { name: 'Export all your data' }).count()
      check('no full export for a Coordinator', ctx, full, full === 0)
      const options = await page.getByLabel('Register', { exact: true }).locator('option').allTextContents()
      check('Coordinator picker has no Complaints', ctx, options, options.join('|') === 'Incidents|Restrictive practices|Risks|Staff credentials')
      await shot(page, 'coordinator-default', page.locator('main'))
      await shot(page, 'picker-coordinator', page.getByLabel('Register', { exact: true }))
      await context.close()
    }
  }
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
