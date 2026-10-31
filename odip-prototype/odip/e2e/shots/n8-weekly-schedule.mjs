// N8: the participant Weekly Schedule PDF menu item and the print rules (run through the runner's `shots` target).
// Numeric checks 15-19 (SHAPE) plus the 794x1123 print state (PLAN-AMEND S1/S2); padded crops and one full page per breakpoint, once, at the end.
import { mkdirSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' })

// Fixture "seven": synthetic, week of Mon 2026-09-07, with a Draft day and an empty day.
const DAYS = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']
const shift = (i, day, startTime, endTime, status, staffName, extra = {}) => ({
  id: `s${i}`, participantId: 'p-0001', participantName: 'Liam Okafor', serviceDate: DAYS[day], startTime, endTime, endsNextDay: false, status,
  staffId: staffName ? `u${i}` : undefined, staffName, notes: 'SECRET-NOTE', overrideReason: 'SECRET-OVERRIDE', findings: [], ...extra,
})
const board = {
  groupBy: 'Participant', weekStart: DAYS[0], days: DAYS, exceptions: [],
  participantRows: [{ participantId: 'p-0001', fullName: 'Liam Okafor', shifts: [
    shift(1, 0, '08:00:00', '17:00:00', 'Published', "Jack O'Sullivan"), shift(2, 1, '09:00:00', '15:00:00', 'InProgress', 'Priya Nair'),
    shift(3, 2, '06:00:00', '06:30:00', 'Draft', 'Draft Person'), shift(4, 4, '10:00:00', '14:00:00', 'PendingReview', 'Mary Jane Smith'),
    shift(5, 5, '11:00:00', '15:00:00', 'Completed', null, { staffName: 'Ghost Worker' }), shift(6, 6, '22:00:00', '07:00:00', 'Published', 'Tomas Reyes', { endsNextDay: true }),
  ] }],
}

const results = []
const check = (name, value, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value}`) }

const browser = await chromium.launch({ headless: true })

async function session(mode, delayMs = 0) {
  const touch = mode === 'touch'
  const context = await browser.newContext(touch
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce', acceptDownloads: true }
    : { viewport: { width: mode === 'a4' ? 794 : 1280, height: mode === 'a4' ? 1123 : 900 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce', acceptDownloads: true })
  const page = await context.newPage()
  const cdp = touch ? await context.newCDPSession(page) : null
  page.pinCoarse = async () => {
    await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  await page.pinCoarse()
  page.on('pageerror', (e) => check(`page error (${mode})`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/rostering/board*', async (r) => { if (delayMs) await new Promise((res) => setTimeout(res, delayMs)); await r.fulfill({ json: envelope(board) }) })
  await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope({ organisationName: 'Synthetic Support' }) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  check(`pointer coarse (${mode})`, coarse, coarse === touch)
  return page
}
const go = async (page, p) => {
  await page.goto(`${BASE_URL}${p}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
}
const crop = async (page, loc, name) => {
  const bb = await loc.boundingBox()
  if (!bb) return console.log(`no box for ${name}`)
  const vp = page.viewportSize()
  const x = Math.max(0, bb.x - 24), y = Math.max(0, bb.y - 24)
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), clip: { x, y, width: Math.min(vp.width - x, bb.width + 48), height: Math.min(vp.height - y, bb.height + 48) } })
}
const OPTION = (page) => page.getByRole('option', { name: 'Weekly Schedule PDF' })
const trigger = (page) => page.getByRole('button', { name: /^(Documents|Preparing)/ })
// Computed styles of the app shell, read in whatever media the page is emulating.
const shell = (page) => page.evaluate(() => {
  const main = document.getElementById('main'), wrap = main.parentElement
  const display = (el) => (el ? getComputedStyle(el).display : 'absent')
  return {
    aside: display(document.getElementById('app-menu')), header: display(wrap.querySelector(':scope > header')), mobileNav: display(document.querySelector('nav[aria-label="Mobile"]')),
    scrim: display(document.querySelector('[class*="bg-black/40"]')), spacer: display(document.querySelector('[data-install-spacer]')), card: display(document.querySelector('.install-card')),
    wrapMargin: getComputedStyle(wrap).marginLeft, mainPad: getComputedStyle(main).paddingLeft, mainLeft: main.getBoundingClientRect().left,
  }
})
const hidden = (v) => v === 'none' || v === 'absent'

try {
  // 390 touch: the menu item is a 44px target; then the loading state while the board is slow.
  {
    const page = await session('touch', 1500)
    await go(page, '/participants/p-0001')
    const h = await page.evaluate(() => document.documentElement.scrollHeight)
    await page.setViewportSize({ width: 390, height: h }) // the resize drops touch emulation: pin it again and prove it held
    await page.pinCoarse()
    const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    const tb = await trigger(page).boundingBox()
    check('390 pointer coarse after resize, Documents trigger >= 44', `${coarse}, ${tb?.height}px`, coarse && (tb?.height ?? 0) >= 44)
    await trigger(page).click()
    await OPTION(page).waitFor({ timeout: 30_000 })
    const ob = await OPTION(page).boundingBox()
    check('15 Weekly Schedule PDF option height (390 touch)', `${ob?.height}px`, (ob?.height ?? 0) >= 44)
    await crop(page, page.getByRole('listbox').first(), 'menu-390-crop')
    await page.screenshot({ path: path.join(OUT_DIR, 'menu-390-full.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.pinCoarse()
    const download = page.waitForEvent('download', { timeout: 90_000 })
    await OPTION(page).click()
    await page.getByRole('button', { name: /^Preparing/ }).waitFor({ timeout: 5_000 }).catch(() => {})
    await crop(page, page.locator('header, [role="banner"]').last().locator('button').first().or(trigger(page)).first(), 'loading-390-crop')
    const file = (await download).suggestedFilename()
    check('download file name (390)', file, /^.+ - Weekly Schedule 2026-09-07\.pdf$/.test(file))
    await page.context().close()
  }

  // 1280 fine pointer: the menu, the loading label, then print media.
  {
    const page = await session('fine', 1500)
    await go(page, '/participants/p-0001')
    await trigger(page).click()
    await OPTION(page).waitFor({ timeout: 30_000 })
    await crop(page, page.getByRole('listbox').first(), 'menu-1280-crop')
    await page.screenshot({ path: path.join(OUT_DIR, 'menu-1280-full.png'), fullPage: true })
    const download = page.waitForEvent('download', { timeout: 90_000 })
    await OPTION(page).click()
    const preparing = page.getByRole('button', { name: 'Preparing…' })
    await preparing.waitFor({ timeout: 5_000 }).catch(() => {})
    check('loading label (1280)', await preparing.count() ? 'Preparing…' : 'none', (await preparing.count()) === 1)
    await crop(page, preparing.or(trigger(page)).first(), 'loading-1280-crop')
    const file = (await download).suggestedFilename()
    check('download file name (1280)', file, /^.+ - Weekly Schedule 2026-09-07\.pdf$/.test(file))
    await trigger(page).filter({ hasText: 'Documents' }).waitFor({ timeout: 30_000 })

    // 18: the portalled menu is chrome; open it in screen media, then print.
    await trigger(page).click()
    await OPTION(page).waitFor()
    await page.emulateMedia({ media: 'print' })
    const portal = await OPTION(page).evaluate((el) => { let n = el; while (n.parentElement && n.parentElement !== document.body) n = n.parentElement; return getComputedStyle(n).display })
    check('18 portalled menu panel display (print)', portal, portal === 'none')
    await page.emulateMedia({ media: 'screen' })
    await page.keyboard.press('Escape')

    // 16, 17, 19: the shell in print media, rail expanded then collapsed.
    for (const rail of ['expanded', 'collapsed']) {
      if (rail === 'collapsed') await page.getByRole('button', { name: 'Collapse sidebar' }).click()
      await page.emulateMedia({ media: 'print' })
      const s = await shell(page)
      check(`16 aside / top header / Mobile nav display (print, ${rail})`, `${s.aside} / ${s.header} / ${s.mobileNav}`, [s.aside, s.header, s.mobileNav].every(hidden))
      check(`17 main column margin-left, main left edge (print, ${rail})`, `${s.wrapMargin}, ${s.mainLeft}px`, s.wrapMargin === '0px' && s.mainLeft === 0)
      const cluster = await trigger(page).evaluate((el) => { const c = el.closest('.print\\:hidden'); return c ? getComputedStyle(c).display : 'no print:hidden ancestor' })
      check(`19 header action cluster display (print, ${rail})`, cluster, cluster === 'none')
      await page.emulateMedia({ media: 'screen' })
    }
    await page.emulateMedia({ media: 'print' })
    await page.screenshot({ path: path.join(OUT_DIR, 'print-participant-1280-full.png'), fullPage: true })
    await go(page, '/budgets')
    await page.screenshot({ path: path.join(OUT_DIR, 'print-budgets-1280-full.png'), fullPage: true })
    await page.context().close()
  }

  // A4 width in print media (PLAN-AMEND S1/S2): scrim, Mobile nav, install card and spacer, top header all gone; no left margin.
  {
    const page = await session('a4')
    await go(page, '/participants/p-0001')
    await page.emulateMedia({ media: 'print' })
    const s = await shell(page)
    check('S1 794 print: scrim / Mobile nav / install spacer / install card / top header', `${s.scrim} / ${s.mobileNav} / ${s.spacer} / ${s.card} / ${s.header}`, [s.scrim, s.mobileNav, s.spacer, s.card, s.header].every(hidden))
    check('S1 794 print: main column margin-left, main padding-left', `${s.wrapMargin}, ${s.mainPad}`, s.wrapMargin === '0px' && s.mainPad === '0px')
    await page.context().close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((ok) => !ok).length
console.log(`TOTAL ${results.length - failed}/${results.length} pass`)
if (failed) process.exitCode = 1
