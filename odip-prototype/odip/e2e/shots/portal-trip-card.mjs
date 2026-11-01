// Portal trip assignment cards: location and role rows. Captures plus the numeric checks. Computed boxes only. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/portal-trip-card.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.worker', fullName: 'Dev Worker', role: 'SupportWorker', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.worker', role: 'SupportWorker', tenantName: 'Sample Support Co' }])
const LONG = 'Tangalooma Island Resort, Moreton Island, via the Holt Street Wharf ferry terminal'

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

const SCENES = [
  { tag: '390-light', width: 390, height: 844, touch: true, scheme: 'light' },
  { tag: '390-dark', width: 390, height: 844, touch: true, scheme: 'dark' },
  { tag: '1280-light', width: 1280, height: 900, touch: false, scheme: 'light' },
]

// Everything the checks need, measured in one pass over the three trip cards and the plain shift card.
const measure = (page) => page.evaluate(() => {
  const h2 = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Trip assignments')
  const cards = [...h2.parentElement.querySelectorAll(':scope > div > div')]
  const box = (el) => el.getBoundingClientRect()
  const trip = cards.map((card) => {
    const cb = box(card), inner = cb.right - 16 + 1
    const row = card.firstElementChild
    const column = row.firstElementChild
    const texts = [...card.querySelectorAll('p, p *')].filter((el) => !el.closest('.sr-only') && el.children.length === 0 && el.textContent.trim())
    const overflow = texts.filter((el) => box(el).right > inner).map((el) => el.textContent.trim().slice(0, 30))
    const loc = [...card.querySelectorAll('span.truncate')].find((s) => s.textContent.includes('Location'))
    const pin = card.querySelector('svg.lucide-map-pin')
    const pinBox = pin ? box(pin) : null
    const locBox = loc ? box(loc) : null
    return {
      name: column.querySelector('p').textContent.trim(), height: cb.height, rows: column.querySelectorAll(':scope > p').length,
      overflow, badgeRight: box(row.lastElementChild).right, innerRight: inner,
      drivers: (card.innerText.match(/driver/gi) || []).length,
      loc: loc ? { scrollWidth: loc.scrollWidth, clientWidth: loc.clientWidth, height: locBox.height, title: loc.getAttribute('title') } : null,
      pin: pinBox ? { w: pinBox.width, h: pinBox.height, dy: Math.abs((pinBox.top + pinBox.height / 2) - (locBox.top + locBox.height / 2)) } : null,
    }
  })
  const shiftLink = document.querySelector('a[href*="/portal/shifts/sh-next"]')
  return { iw: innerWidth, scrollWidth: document.documentElement.scrollWidth, coarse: matchMedia('(pointer: coarse)').matches, trip, shiftHeight: shiftLink ? box(shiftLink).height : null }
})

const browser = await chromium.launch({ headless: true })
for (const s of SCENES) {
  try {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: s.width, height: s.height }, hasTouch: s.touch, isMobile: s.touch, colorScheme: s.scheme })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}/portal`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    // The mock holds the trips in the week after the intake day; page forward until they show (at most 3 weeks).
    const heading = page.getByRole('heading', { name: 'Trip assignments' })
    await page.getByRole('button', { name: 'Next week' }).waitFor({ state: 'visible', timeout: 60_000 })
    for (let i = 0; i < 3 && !(await heading.isVisible().catch(() => false)); i++) {
      await page.getByRole('button', { name: 'Next week' }).click()
      await page.waitForTimeout(700)
    }
    await heading.waitFor({ state: 'visible', timeout: 30_000 })
    const section = heading.locator('xpath=..')
    await page.waitForTimeout(500)
    const m = await measure(page)
    console.log(`[portal-trip-card] ${s.tag} ${JSON.stringify(m)}`)
    const [a, b, c] = m.trip
    const t = (n) => `${s.tag}: ${n}`
    if (s.touch) check(t('pointer is coarse'), m.coarse)
    check(t('three trip cards'), m.trip.length === 3, m.trip.length)
    check(t('1 no text past the card inner edge, no horizontal scroll'), m.trip.every((x) => x.overflow.length === 0) && m.scrollWidth <= m.iw, { overflow: m.trip.map((x) => x.overflow), scrollWidth: m.scrollWidth, iw: m.iw })
    check(t('2 truncation is real on B'), !!b.loc && b.loc.scrollWidth > b.loc.clientWidth && b.loc.height <= 21 && b.loc.title === LONG, b.loc)
    check(t('3 row counts A=4 B=4 C=2'), a.rows === 4 && b.rows === 4 && c.rows === 2, [a.rows, b.rows, c.rows])
    check(t('4 C height equals the plain shift card (+-1)'), m.shiftHeight != null && Math.abs(c.height - m.shiftHeight) <= 1, { c: c.height, shift: m.shiftHeight })
    check(t('5 A and B are C + 40 (+-2)'), Math.abs(a.height - (c.height + 40)) <= 2 && Math.abs(b.height - (c.height + 40)) <= 2, { a: a.height, b: b.height, c: c.height })
    check(t('6 driver once on A and on C'), a.drivers === 1 && c.drivers === 1, [a.drivers, c.drivers])
    check(t('7 map pin 12x12, centred on its line (+-2)'), [a, b].every((x) => x.pin && Math.round(x.pin.w) === 12 && Math.round(x.pin.h) === 12 && x.pin.dy <= 2), [a.pin, b.pin])
    check(t('8 badge inside the card inner edge'), m.trip.every((x) => x.badgeRight <= x.innerRight), m.trip.map((x) => [x.badgeRight, x.innerRight]))
    const crop = await cropElement(page, section, path.join(OUT_DIR, `trip-cards-${s.tag}.png`), { touch: s.touch })
    checks.push(checkCropHolds({ ...crop, touch: s.touch }))
    if (s.scheme === 'light') checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${s.tag}.png`), { touch: s.touch })).checks)
    await context.close()
  } catch (e) {
    check(`${s.tag}: scene ran`, false, String(e.message).split('\n')[0])
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
