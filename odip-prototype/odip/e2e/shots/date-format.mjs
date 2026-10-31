// N4 house date format: the Completions approve and return dialogs, light theme, 390 touch and 1280.
// Numeric checks (exit 1 on any failure): the long date is in the row's aria-labels and in the dialog sentence, the numeric form is not,
// the date renders on ONE line (a single client rect), the table cell stays numeric, and at 390 the viewport is touch (pointer: coarse).
import { mkdirSync } from 'node:fs'
import path from 'node:path'

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

const ROLE = 'Admin'
const username = `dev.${ROLE.toLowerCase()}`
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username, role: ROLE, tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: `Dev ${ROLE}`, role: ROLE, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

const LONG = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/
const NUMERIC = /\b\d{2}\/\d{2}\/\d{4}\b/
const VIEWPORTS = [
  { name: 'touch-390', width: 390, height: 844, touch: true },
  { name: 'desktop-1280', width: 1280, height: 900, touch: false },
]

const browser = await chromium.launch({ headless: true })
const results = []
const check = (vp, name, ok, detail = '') => { results.push(ok); console.log(`[date-format] ${ok ? 'PASS' : 'FAIL'} ${vp} ${name}${detail ? ` (${detail})` : ''}`) }

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light' })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/rostering/completions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.locator('#main').waitFor({ state: 'attached', timeout: 60_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(500)

    if (vp.touch) check(vp.name, 'pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
    const approve = page.getByRole('button', { name: /^Approve .* on / }).first()
    await approve.waitFor({ state: 'visible', timeout: 30_000 })
    const label = (await approve.getAttribute('aria-label')) ?? ''
    check(vp.name, 'approve aria-label has the long date, not the numeric', LONG.test(label) && !NUMERIC.test(label), label)
    const returnLabel = (await page.getByRole('button', { name: /^Return .* on / }).first().getAttribute('aria-label')) ?? ''
    check(vp.name, 'return aria-label has the long date, not the numeric', LONG.test(returnLabel) && !NUMERIC.test(returnLabel), returnLabel)

    if (!vp.touch) {
      const cells = await page.locator('table td').allTextContents()
      check(vp.name, 'table Date column stays numeric', cells.some((t) => NUMERIC.test(t)))
    }
    await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-completions-page.png`) })

    for (const [kind, button] of [['approve', approve], ['return', page.getByRole('button', { name: /^Return .* on / }).first()]]) {
      await button.click()
      const dialog = page.getByRole('alertdialog')
      await dialog.waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForTimeout(400) // the dialog's enter animation
      const text = (await dialog.innerText()).replace(/ /g, ' ')
      check(vp.name, `${kind} dialog sentence has the long date, not the numeric`, LONG.test(text) && !NUMERIC.test(text), `long=${LONG.test(text)} numeric=${NUMERIC.test(text)}`)
      // the date is one text run: its Range has a single client rect, so it did not wrap inside itself
      const measure = await dialog.evaluate((root, source) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        const re = new RegExp(source)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const m = re.exec(n.nodeValue ?? '')
          if (!m) continue
          const range = document.createRange()
          range.setStart(n, m.index)
          range.setEnd(n, m.index + m[0].length)
          const rects = [...range.getClientRects()]
          const lineHeight = parseFloat(getComputedStyle(n.parentElement).lineHeight)
          return { rects: rects.length, height: Math.max(...rects.map((r) => r.height)), lineHeight }
        }
        return null
      }, LONG.source.replace(/ /g, '[ \u00a0]'))
      check(vp.name, `${kind} dialog date renders on one line`, !!measure && measure.rects === 1 && measure.height <= measure.lineHeight + 1, JSON.stringify(measure))
      await dialog.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${kind}-dialog.png`) })
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 })
    }
    await context.close()
  }
} catch (err) {
  console.error(`[date-format] FAILED: ${err.message}`)
  results.push(false)
} finally {
  await browser.close()
}
console.log(`[date-format] ${results.filter(Boolean).length}/${results.length} checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
