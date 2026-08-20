// Playwright verification of the Billing UI.
// Runs against a local Vite dev server proxied to the live API on the homelab.
//   ODIP_API_TARGET=http://192.168.4.70:8475 VITE_DEV_AUTH=true npm run dev
//   node deploy/verify-billing-ui.mjs
import { chromium } from 'playwright'
import fs from 'fs'

const BASE = 'http://localhost:5173'
const OUT = 'F:/Projects/personal/ODIP/.playwright'
fs.mkdirSync(OUT, { recursive: true })

const results = []
const consoleErrors = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message))

// ── Dev login ────────────────────────────────────────────────────────────
await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: /sign in as selected user/i }).click()
await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 })
check('dev login lands in the app', true, page.url())

// ── Nav entry exists and is positioned after Trips ───────────────────────
// Wait for the sidebar to actually paint — querying straight after waitForURL
// returns an empty list because the shell has not rendered yet.
await page.locator('aside').first().waitFor({ state: 'visible', timeout: 15000 })
await page.waitForTimeout(800)
const navLabels = await page.locator('aside a, aside button').allInnerTexts()
const flat = navLabels.map(t => t.trim().split('\n').pop().trim()).filter(Boolean)
check('Billing nav entry present', flat.includes('Billing'), flat.join(' | '))
check('Billing sits after Trips', flat.indexOf('Billing') > flat.indexOf('Trips'))

// ── Billing page loads with three tabs ───────────────────────────────────
await page.goto(BASE + '/billing', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const bodyText = await page.locator('body').innerText()
for (const tab of ['Funding Sources', 'Service Bookings', 'Billable Events']) {
  check(`tab "${tab}" rendered`, new RegExp(tab, 'i').test(bodyText))
}
await page.screenshot({ path: `${OUT}/01-billing-desktop.png`, fullPage: true })

// ── Claim batch builder ──────────────────────────────────────────────────
await page.goto(BASE + '/billing/claim-batches/new', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${OUT}/02-claim-builder.png`, fullPage: true })

const validateBtn = page.getByRole('button', { name: /validate selection/i })
check('Validate button present', await validateBtn.count() > 0)

// The safety property must be COMMUNICATED, not just enforced.
const builderText = await page.locator('body').innerText()
check('validate is labelled read-only', /never creates or changes anything/i.test(builderText))

// Create must be disabled before any validation has run.
const createBtn = page.getByRole('button', { name: /create claim batch/i }).first()
if (await createBtn.count() > 0) {
  check('Create batch disabled before validation', await createBtn.isDisabled())
} else {
  check('Create batch control present', false, 'button not found')
}

// Validate must be disabled with an empty selection (nothing to validate).
check('Validate disabled with empty selection', await validateBtn.isDisabled())

// ── Empty-state wording distinguishes the two cases ──────────────────────
check(
  'empty state is specific (not "no data")',
  /no unclaimed events|no events match/i.test(builderText),
  (builderText.match(/No [a-z ]+/i) || [''])[0]
)

// ── Focus visibility on the primary control ──────────────────────────────
await validateBtn.focus().catch(() => {})
const ring = await validateBtn.evaluate(el => {
  const s = getComputedStyle(el)
  return { outline: s.outlineWidth, shadow: s.boxShadow !== 'none' }
}).catch(() => null)
check('primary control has a focus affordance', !!ring && (parseFloat(ring.outline) > 0 || ring.shadow),
  ring ? JSON.stringify(ring) : 'n/a')

// ── Responsive: no horizontal page overflow at mobile width ──────────────
for (const [w, h, tag] of [[390, 844, 'mobile'], [820, 1180, 'tablet']]) {
  await page.setViewportSize({ width: w, height: h })
  await page.goto(BASE + '/billing', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`no mobile overflow regression at ${tag} (${w}px)`, overflow <= 17, `overflow=${overflow}px (app-shell baseline is 17px on every page)`)
  await page.screenshot({ path: `${OUT}/03-billing-${tag}.png`, fullPage: true })
}

// ── Console cleanliness ──────────────────────────────────────────────────
// frame-ancestors-via-meta is a pre-existing app-wide warning from index.html, not billing.
const realErrors = consoleErrors.filter(e => !/favicon|manifest|Download the React DevTools|frame-ancestors/i.test(e))
check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' || '))

await browser.close()

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILURES:')
  failed.forEach(f => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`))
}
console.log(`screenshots: ${OUT}`)
process.exit(failed.length ? 1 : 0)
