// Polish batch 20: (a) Agreement step Length error when Ongoing is chosen and the plan passes the 800-day cap, 390 and 1280 (and 1280 dark);
// (b) referral source duplicate marked on the name box, 390 and 1280; (c) History tab "Showing the latest 50 of 120 events" at 390.
// Numeric checks (exit 1 on any failure): error visible and inside its column, select aria-invalid, input border = --color-destructive,
// caption on one line, no horizontal page overflow. mock-api has no audit route, so GET /audit/** is fixtured here.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { prepareOutDir, cropElement, checkCropHolds, writeChecks, AU_CONTEXT } from '../shots/lib/capture.mjs'

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

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const entries = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, action: 'Updated', changedAt: '2026-11-06T01:00:00Z', changedByName: 'Pat Admin', changes: [{ field: 'Title', old: `Old ${i}`, new: `New ${i}` }] }))
const PAST_CAP = 'This NDIS plan runs longer than 800 days from the agreement start. Choose an end date instead of Ongoing.'

const VIEWPORTS = [
  { name: 'touch-390', width: 390, height: 844, touch: true, scheme: 'light' },
  { name: 'desktop-1280', width: 1280, height: 900, touch: false, scheme: 'light' },
  { name: 'desktop-1280-dark', width: 1280, height: 900, touch: false, scheme: 'dark' },
]

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (vp, name, ok, detail = '') => { checks.push({ name: `${vp} ${name}`, pass: !!ok, detail }); console.log(`[polish-batch-20] ${ok ? 'PASS' : 'FAIL'} ${vp} ${name}${detail ? ` (${detail})` : ''}`) }
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
const go = (page, url) => page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: vp.scheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route('**/api/v1/audit/**', (r) => r.fulfill({ json: { entries, total: 120, page: 1, pageSize: 50, totalPages: 3 } }))
    await go(page, '/login')
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    const opts = { touch: vp.touch }
    if (vp.touch) check(vp.name, 'pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))

    // (a) Agreement step: Ongoing chosen inside the cap, then the plan end moves past it.
    await go(page, '/participants/p-0004/agreement-draft')
    const starts = page.getByLabel('Agreement starts')
    await starts.waitFor({ state: 'visible', timeout: 60_000 })
    await page.getByLabel(/Agreement type/).selectOption('Everyday support')
    await starts.fill('2026-11-01')
    await page.getByText('Different NDIS plan dates?').click()
    await page.getByLabel('NDIS plan starts').fill('2026-10-01')
    await page.getByLabel('NDIS plan ends').fill('2027-09-30')
    await page.getByLabel('Length').selectOption('ongoing')
    await page.getByLabel('NDIS plan ends').fill('2029-09-30')
    await page.getByRole('button', { name: 'Next' }).click()
    const err = page.getByText(PAST_CAP, { exact: true })
    await err.waitFor({ state: 'visible', timeout: 10_000 })
    const column = page.getByLabel('Length').locator('xpath=..')
    check(vp.name, 'a: Length error visible', await err.isVisible())
    check(vp.name, 'a: Length select is aria-invalid', (await page.getByLabel('Length').getAttribute('aria-invalid')) === 'true')
    const fit = await err.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    const col = await column.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    check(vp.name, 'a: error does not overflow its box or the field column', fit.sw <= fit.cw && col.sw <= col.cw, JSON.stringify({ fit, col }))
    check(vp.name, 'a: no horizontal page overflow', await noHScroll(page))
    checks.push(checkCropHolds(await cropElement(page, column, path.join(OUT_DIR, `${vp.name}-a-length-error.png`), opts)))

    if (vp.scheme === 'dark') { await context.close(); continue }

    // (b) Referral sources: a duplicate name is marked on the box.
    await go(page, '/settings?section=referral-sources')
    await page.getByRole('button', { name: 'Add a source' }).click()
    const box = page.getByLabel('Source name')
    await box.fill('Hospital')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByText('That source is already on the list.').waitFor({ state: 'visible', timeout: 10_000 })
    check(vp.name, 'b: input aria-invalid', (await box.getAttribute('aria-invalid')) === 'true')
    const border = await box.evaluate((el) => getComputedStyle(el).borderTopColor)
    const token = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--color-destructive)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c })
    check(vp.name, 'b: border colour = --color-destructive', border === token, `${border} vs ${token}`)
    check(vp.name, 'b: no horizontal page overflow', await noHScroll(page))
    checks.push(checkCropHolds(await cropElement(page, box.locator('xpath=..'), path.join(OUT_DIR, `${vp.name}-b-referral-duplicate.png`), opts)))

    // (c) History caption, 390 only.
    if (vp.touch) {
      await go(page, '/participants/p-0004?tab=history')
      const caption = page.getByText('Showing the latest 50 of 120 events', { exact: true })
      await caption.waitFor({ state: 'visible', timeout: 30_000 })
      const lines = await caption.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
      check(vp.name, 'c: caption on one line', lines === 1, `lines=${lines}`)
      check(vp.name, 'c: no horizontal page overflow', await noHScroll(page))
      checks.push(checkCropHolds(await cropElement(page, caption, path.join(OUT_DIR, `${vp.name}-c-history-caption.png`), opts)))
    }
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
if (!ok) process.exitCode = 1
