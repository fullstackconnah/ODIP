// CT2: the participant's Staff preferences card on the compatibility board (compact), through the runner's `shots` target.
// States: card with tiers, card empty, card with a No chip (read-only); each at 1280 and at 390 touch. Padded crops plus one full page per width, once.
// Numeric checks: no horizontal scroll at 390; tap targets >= 44 px on coarse pointers; the four columns stacked (equal left edge) at both widths; the link href.
import path from 'node:path'
import { prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' })

const row = (n, name, level, rank, reason = null) => ({ staffId: `s${n}`, staffName: name, participantId: 'p-0001', participantName: 'Liam Okafor', level, rank, reason, updatedAt: '2026-10-01T00:00:00Z' })
const TIERS = [
  row(1, 'Ava Hill', 'Preferred', 1, 'Knows the morning routine'), row(2, 'Ben Cole', 'Preferred', 2),
  row(3, 'Cara Dunn', 'Backup', 1), row(4, 'Dev Rao', 'Emergency', 1), row(5, 'Eli Fox', 'Excluded', 0, 'Past conflict'),
]
let rows = TIERS

const checks = []
const check = (name, value, ok) => { checks.push({ name, pass: !!ok, detail: String(value) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value}`) }

const browser = await chromium.launch({ headless: true })

async function session(touch) {
  const context = await browser.newContext(touch
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce' }
    : { viewport: { width: 1280, height: 900 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce' })
  const page = await context.newPage()
  if (touch) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.on('pageerror', (e) => check(`page error (${touch ? '390' : '1280'})`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route((u) => u.pathname === '/api/v1/rostering/compatibility', (r) => r.fulfill({ json: envelope(rows) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return page
}
const go = async (page) => {
  await page.goto(`${BASE_URL}/participants/p-0001?tab=rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.getByRole('link', { name: 'Open on the Compatibility page' }).waitFor({ timeout: 30_000 })
}
const cardOf = (page) => page.locator('h3', { hasText: 'Staff preferences' }).locator('xpath=../..')
const crop = async (page, loc, name, touch) => {
  const r = await cropElement(page, loc, path.join(OUT_DIR, `${name}.png`), { pad: 24, touch })
  const c = checkCropHolds(r)
  check(`crop holds ${name}`, JSON.stringify(c.detail), c.pass)
}

async function run(touch) {
  const bp = touch ? '390' : '1280'
  const page = await session(touch)
  rows = TIERS
  await go(page)
  const card = cardOf(page)

  const m = await card.evaluate((el, coarse) => {
    const lefts = [...el.querySelectorAll('section[aria-labelledby^="tier-"]')].map((s) => Math.round(s.getBoundingClientRect().left * 10) / 10)
    const targets = [...el.querySelectorAll('button, a')].map((b) => { const r = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label') || b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) } })
    return { lefts, targets, coarse, hScroll: document.documentElement.scrollWidth > innerWidth, link: el.querySelector('a[href*="/rostering/compatibility"]')?.getAttribute('href') }
  }, touch)
  check(`four columns (${bp})`, m.lefts.length, m.lefts.length === 4)
  check(`columns stacked, equal left edge (${bp})`, m.lefts.join(','), new Set(m.lefts).size === 1)
  check(`link href (${bp})`, m.link, m.link === '/rostering/compatibility?participant=p-0001')
  check(`no horizontal scroll (${bp})`, m.hScroll, !m.hScroll)
  if (touch) {
    const small = m.targets.filter((t) => t.h < 44 || t.w < 44)
    // The link is a text link: its floor is height (TAP_FLOOR), width follows the text.
    const real = small.filter((t) => !(t.label === 'Open on the Compatibility page' && t.h >= 44))
    check('pointer coarse (390)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches), true)
    check(`tap targets >= 44 px (${m.targets.length} checked)`, JSON.stringify(real), real.length === 0)
  }
  const noChip = await card.locator('section[aria-labelledby="tier-Excluded"] li').count()
  const noMenu = await card.locator('section[aria-labelledby="tier-Excluded"] button').count()
  check(`No chip is read-only (${bp})`, `${noChip} chip, ${noMenu} buttons`, noChip === 1 && noMenu === 0)

  await crop(page, card, `card-tiers-${bp}`, touch)
  await crop(page, card.locator('section[aria-labelledby="tier-Excluded"]'), `card-no-chip-${bp}`, touch)

  rows = []
  await go(page)
  await crop(page, cardOf(page), `card-empty-${bp}`, touch)

  rows = TIERS
  await go(page)
  const r = await fullPage(page, path.join(OUT_DIR, 'full', `participant-rostering-${bp}.png`), { touch })
  checks.push(...r.checks)
  for (const c of r.checks) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${JSON.stringify(c.detail)}`)
  await page.context().close()
}

try {
  await run(false)
  await run(true)
} finally {
  writeChecks(OUT_DIR, checks)
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
process.exit(failed.length ? 1 : 0)
