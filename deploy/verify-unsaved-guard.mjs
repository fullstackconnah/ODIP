// Proves the unsaved-changes guard actually works — including that it does NOT
// block when the form is clean.
//
//   node deploy/verify-unsaved-guard.mjs http://192.168.4.70:8475
//
// Why this rewrite exists: the original assertion ("filled a field, clicked nav,
// still on the form") passes for a guard that blocks EVERY navigation, and it
// also passed by accident because `page.locator('input').first()` was grabbing
// the header search box, not a form field. Both bugs made a green result
// meaningless. Every check below is scoped to the form and paired with its
// negative case.
import { chromium } from 'playwright'

const BASE = process.argv[2] || process.env.ODIP_BASE_URL || 'http://localhost:5173'
const FORM = '/participants/new'
const AWAY = 'Participants'   // sidebar link to click

const results = []
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const dialog = () => page.locator('[role="alertdialog"]')
const navLink = () => page.locator('aside a').filter({ hasText: AWAY }).first()
// Scope to the form and skip checkboxes/radios — the header search input is
// outside <form>, and a checkbox can't hold the sentinel text.
const firstTextField = () =>
  page.locator('form').locator('input:not([type=checkbox]):not([type=radio]):not([type=hidden])').first()

// ── Sign in ──────────────────────────────────────────────────────────────
await page.goto(BASE + FORM, { waitUntil: 'networkidle' })
if (page.url().includes('/login')) {
  await page.getByRole('button', { name: /sign in as selected user/i }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 })
  await page.goto(BASE + FORM, { waitUntil: 'networkidle' })
}
await page.locator('form').first().waitFor({ state: 'visible', timeout: 15000 })

// ── 1. CLEAN form must navigate freely ───────────────────────────────────
// This is the check that distinguishes a working guard from one that blocks
// everything. Without it, a permanently-stuck form scores a perfect result.
await navLink().click()
await page.waitForTimeout(1200)
check('clean form navigates away without prompting',
  !page.url().includes('/new') && await dialog().count() === 0, page.url())

// ── 2. DIRTY form must block ─────────────────────────────────────────────
await page.goto(BASE + FORM, { waitUntil: 'networkidle' })
await page.locator('form').first().waitFor({ state: 'visible', timeout: 15000 })
const field = firstTextField()
const fieldName = await field.getAttribute('name')
await field.fill('GuardSentinel')
await page.waitForTimeout(400)
check('typed into a real form field (not the header search)',
  (await field.inputValue()) === 'GuardSentinel', `name=${fieldName}`)

await navLink().click()
await page.waitForTimeout(1000)
const blockedOpen = await dialog().count() > 0
check('dirty form opens the guard dialog', blockedOpen)
check('dirty form did not navigate', page.url().includes('/new'), page.url())
check('dialog is an accessible alertdialog',
  blockedOpen && await dialog().getAttribute('aria-modal') === 'true'
    && !!(await dialog().getAttribute('aria-labelledby')),
  blockedOpen ? await dialog().locator('h2').innerText() : 'no dialog')

// ── 3. "Keep editing" cancels and preserves the edit ─────────────────────
await page.getByRole('button', { name: /keep editing/i }).click()
await page.waitForTimeout(600)
check('"Keep editing" closes the dialog and stays put',
  await dialog().count() === 0 && page.url().includes('/new'))
check('"Keep editing" preserves the typed value',
  (await firstTextField().inputValue()) === 'GuardSentinel')

// ── 4. Escape also cancels ───────────────────────────────────────────────
await navLink().click()
await page.waitForTimeout(800)
await page.keyboard.press('Escape')
await page.waitForTimeout(600)
check('Escape cancels the guard dialog',
  await dialog().count() === 0 && page.url().includes('/new'))

// ── 5. "Leave page" actually leaves ──────────────────────────────────────
// A guard you can't get past is a bug, not a safety feature.
await navLink().click()
await page.waitForTimeout(800)
await page.getByRole('button', { name: /leave page/i }).click()
await page.waitForTimeout(1500)
check('"Leave page" completes the navigation',
  !page.url().includes('/new') && await dialog().count() === 0, page.url())

await browser.close()

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) { console.log('FAILURES:'); failed.forEach(f => console.log(`  - ${f.name}${f.detail ? ': ' + f.detail : ''}`)) }
process.exit(failed.length ? 1 : 0)
