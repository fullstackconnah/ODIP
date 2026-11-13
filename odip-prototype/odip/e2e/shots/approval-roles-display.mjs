// Agreement approval roles line on the Save step. Light theme, reduced motion, 390 touch and 1280.
// States: approved-with-roles (the mock records roles on approval, so p-0004 is approved through the dialog first), approved-older (the same page with both role fields
// removed from the answers, as an approval made before they were recorded). Numeric checks (exit 1 on any failure): the new line does not overflow sideways at 390,
// its font size and colour equal the muted 13px text beside it (the Populate roster hint), and the older approval has no such line.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

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

const ROLE = 'Admin'
const username = `dev.${ROLE.toLowerCase()}`
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username, role: ROLE, tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: `Dev ${ROLE}`, role: ROLE, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const LINE = 'Roles that could approve at the time: Admin, Coordinator. Approved as: Coordinator.'

const VIEWPORTS = [
  { name: 'touch-390', width: 390, height: 844, touch: true },
  { name: 'desktop-1280', width: 1280, height: 900, touch: false },
]

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (vp, name, ok, detail = '') => { checks.push({ name: `${vp} ${name}`, pass: !!ok, detail }); console.log(`[approval-roles] ${ok ? 'PASS' : 'FAIL'} ${vp} ${name}${detail ? ` (${detail})` : ''}`) }

// Removes both role fields wherever an approval carries them.
const stripRoles = (value) => {
  if (Array.isArray(value)) return value.map(stripRoles)
  if (value && typeof value === 'object') {
    const { approverRolesInForce, approvedByRoles, ...rest } = value
    return Object.fromEntries(Object.entries(rest).map(([key, inner]) => [key, stripRoles(inner)]))
  }
  return value
}

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
    const page = await context.newPage()
    const opts = { touch: vp.touch }
    const shot = async (locator, name) => {
      // natural: the viewport grows to the page height, so the sticky budget bar and bottom nav sit in their natural place, not over the section (cropElement scrolls to the top itself, so scrollIntoView would be undone).
      // during: at capture time, no visible fixed or sticky element may intersect the cropped element.
      const during = () => locator.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const hit = [...document.body.querySelectorAll('*')].map((e) => ({ e, s: getComputedStyle(e), b: e.getBoundingClientRect() })).find(({ e, s, b }) =>
          (s.position === 'fixed' || s.position === 'sticky') && b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0 &&
          !e.contains(el) && !el.contains(e) && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top)
        return hit ? `${hit.e.tagName} .${String(hit.e.className).slice(0, 60)} rect ${Math.round(hit.b.left)},${Math.round(hit.b.top)} ${Math.round(hit.b.width)}x${Math.round(hit.b.height)}` : ''
      })
      const result = await cropElement(page, locator, path.join(OUT_DIR, `${vp.name}-${name}.png`), { ...opts, hideChrome: true, natural: vp.touch, during })
      checks.push(checkCropHolds(result))
      check(vp.name, `${name}-clear-of-chrome`, result.measured === '', result.measured)
      return result
    }
    await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })

    const openSaveStep = async () => {
      await page.goto(`${BASE_URL}/participants/p-0004/agreement-draft`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const next = page.getByRole('button', { name: 'Next', exact: true })
      await next.waitFor({ state: 'visible', timeout: 60_000 })
      for (let i = 0; i < 3; i++) await next.click()
      await page.evaluate(() => document.fonts.ready)
    }
    const section = () => page.locator('section[aria-labelledby="save-populate"]')

    // The mock keeps the approval between viewports: only the first one approves.
    await openSaveStep()
    const approve = page.getByRole('button', { name: 'Mark approved for rostering', exact: true })
    if (await approve.isVisible().catch(() => false)) {
      await approve.click()
      const dialog = page.getByRole('dialog', { name: 'Approve this agreement for rostering?', exact: true })
      const confirm = dialog.getByRole('button', { name: 'Approve', exact: true })
      await confirm.waitFor({ state: 'visible', timeout: 30_000 })
      // Hand-made patterns that overlap need their acknowledgement before Approve is enabled.
      const acknowledge = dialog.getByRole('checkbox')
      if (await acknowledge.count()) await acknowledge.first().check()
      await confirm.click()
    }
    const rolesLine = page.getByText(LINE, { exact: true })
    await rolesLine.waitFor({ state: 'visible', timeout: 30_000 })
    // Reload so the shot is of the settled page, not of the moment after the approval (its notice is still up).
    await openSaveStep()
    await rolesLine.waitFor({ state: 'visible', timeout: 30_000 })
    if (vp.touch) check(vp.name, 'pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))

    const m = await rolesLine.evaluate((line) => {
      const hint = [...document.querySelectorAll('section[aria-labelledby="save-populate"] p')].find((p) => p.textContent.startsWith('Adds the open shifts'))
      const a = getComputedStyle(line), b = getComputedStyle(hint)
      const approved = line.previousElementSibling
      return { scrollWidth: line.scrollWidth, clientWidth: line.clientWidth, size: a.fontSize, color: a.color, hintSize: b.fontSize, hintColor: b.color, afterApproved: !!approved && /^Approved for rostering by /.test(approved.textContent), top: line.getBoundingClientRect().top - approved.getBoundingClientRect().bottom }
    })
    check(vp.name, 'roles line: no sideways overflow', m.scrollWidth <= m.clientWidth, `${m.scrollWidth} <= ${m.clientWidth}`)
    check(vp.name, 'roles line: same size and colour as the muted 13px hint beside it', m.size === '13px' && m.size === m.hintSize && m.color === m.hintColor, `${m.size} ${m.color} vs ${m.hintSize} ${m.hintColor}`)
    check(vp.name, 'roles line: sits directly under the approved line', m.afterApproved, `gap ${Math.round(m.top)} px`)
    check(vp.name, 'roles line: no horizontal scroll', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    await page.evaluate(() => document.fonts.ready)
    await shot(section(), 'approved-with-roles')
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${vp.name}-approved-with-roles.png`), opts)).checks)

    // The same revision as an approval made before the roles were recorded.
    await page.route('**/api/v1/participants/p-0004/service-agreement-drafts**', async (route) => {
      const response = await route.fetch()
      if (!(response.headers()['content-type'] || '').includes('json')) return route.fulfill({ response })
      await route.fulfill({ response, json: stripRoles(await response.json()) })
    })
    await openSaveStep()
    await section().waitFor({ state: 'visible', timeout: 30_000 })
    check(vp.name, 'older approval: no roles line', (await page.getByText(/Roles that could approve|Approved as:/).count()) === 0)
    await shot(section(), 'approved-older')
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${vp.name}-approved-older.png`), opts)).checks)
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
