// F3 Tasks list bound: the capped line and subtitle, light theme, 390 touch and 1280, normal and Archived views.
// GET /tasks is routed to a few rows with totalCount 1234. Numeric checks (exit 1 on any failure): the line is present only when
// totalCount > items.length, the subtitle shows the total, the line wraps to at most 2 lines, no horizontal scroll, 390 stays touch.
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

const row = (i) => ({ id: `t${i}`, title: `Confirm accommodation ${i}`, tripInstanceId: null, tripName: null, taskType: 'AccommodationRequest', ownerName: 'Sam', dueDate: `2026-11-0${i}`, priority: 'Medium', status: 'NotStarted' })
const items = [1, 2, 3].map(row)
const reply = (totalCount) => envelope({ items, totalCount, page: 1, pageSize: 500, totalPages: 1, hasNext: false, hasPrevious: false })

const VIEWPORTS = [
  { name: 'touch-390', width: 390, height: 844, touch: true },
  { name: 'desktop-1280', width: 1280, height: 900, touch: false },
]

const browser = await chromium.launch({ headless: true })
const results = []
const check = (vp, name, ok, detail = '') => { results.push(ok); console.log(`[tasks-cap] ${ok ? 'PASS' : 'FAIL'} ${vp} ${name}${detail ? ` (${detail})` : ''}`) }

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light' })
    const page = await context.newPage()
    let total = 1234
    await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
    await page.route((url) => url.pathname === '/api/v1/tasks', (route) => route.fulfill({ json: reply(total) }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/tasks`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.locator('#main').waitFor({ state: 'attached', timeout: 60_000 })
    await page.getByText('Confirm accommodation 1').first().waitFor({ state: 'attached', timeout: 30_000 })
    await page.waitForTimeout(500)

    if (vp.touch) check(vp.name, 'pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
    const line = page.getByText(/^Showing the first 3 of 1234/)
    const lineCount = () => line.count()
    const measure = async () => line.first().evaluate((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight)
      return { lines: Math.round(el.getBoundingClientRect().height / lh), text: el.textContent }
    })
    const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

    // Normal view, no status: capped line with the hint, subtitle shows the total.
    check(vp.name, 'normal: capped line present (total 1234 > 3 rows)', (await lineCount()) === 1)
    const normal = await measure()
    check(vp.name, 'normal: ends with the status hint', normal.text.endsWith('soonest due first. Choose a status to narrow the list.'), normal.text)
    check(vp.name, 'normal: wraps to at most 2 lines', normal.lines <= 2, `lines=${normal.lines}`)
    check(vp.name, 'subtitle shows the total', (await page.getByText('1234 tasks', { exact: true }).count()) === 1)
    check(vp.name, 'normal: no horizontal scroll', await noHScroll())
    await line.first().screenshot({ path: path.join(OUT_DIR, `${vp.name}-capped-line.png`) })
    await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-tasks-page.png`) })

    // Archived view: archived wording, no hint.
    await page.getByRole('radio', { name: 'Archived' }).click()
    await page.getByText(/archived tasks, soonest due first\.$/).waitFor({ state: 'visible', timeout: 10_000 })
    const archivedLine = page.getByText(/^Showing the first 3 of 1234 archived tasks/)
    const archivedText = (await archivedLine.first().textContent()) ?? ''
    check(vp.name, 'archived: line names archived tasks and no action', archivedText === 'Showing the first 3 of 1234 archived tasks, soonest due first.', archivedText)
    check(vp.name, 'archived: wraps to at most 2 lines', (await archivedLine.first().evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))) <= 2)
    check(vp.name, 'archived: no horizontal scroll', await noHScroll())
    await archivedLine.first().screenshot({ path: path.join(OUT_DIR, `${vp.name}-capped-line-archived.png`) })

    // Not capped: total equals the rows, so the line is gone.
    total = 3
    await page.goto(`${BASE_URL}/tasks`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('Confirm accommodation 1').first().waitFor({ state: 'attached', timeout: 30_000 })
    await page.waitForTimeout(500)
    check(vp.name, 'not capped: no capped line (total == rows)', (await page.getByText(/^Showing the first/).count()) === 0)
    await context.close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((ok) => !ok).length
console.log(`[tasks-cap] ${results.length - failed}/${results.length} checks passed`)
if (failed) process.exit(1)
