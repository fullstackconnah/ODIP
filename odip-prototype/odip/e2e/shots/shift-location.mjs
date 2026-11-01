// Coordinator-typed shift location: portal shift cards, current-shift hero and the slide-over field. Captures plus the nine numeric checks. Computed boxes only. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/shift-location.mjs <outdir>
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
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const SHORT = 'Southside Library'
const LONG = 'Riverside Aquatic Centre, Lane 4 hydrotherapy pool, Gate 2 off the Eastern Carpark'
const HINT = 'The support worker sees this on their shift. Leave it empty for a shift at home.'

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

// Today in the provider's zone, so the current shift and the browsed week agree with the app.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney' }).format(new Date())
// Synthetic only. Cards A to D are the same chrome and differ in location alone: short, long, null and a key left out.
const base = (id, name, extra = {}) => ({ id, participantId: 'p-0001', participantName: name, serviceDate: today, startTime: '23:00:00', endTime: '23:30:00', endsNextDay: false, durationHours: 0.5,
  ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null, returnCount: 0, ...extra })
const cards = () => [
  base('sh-loc-a', 'Alex Card', { location: SHORT }),
  base('sh-loc-b', 'Blair Card', { location: LONG }),
  base('sh-loc-c', 'Casey Card', { location: null }),
  base('sh-loc-d', 'Drew Card'),
]
const hero = (location) => base('sh-hero', 'Hero Person', { startTime: '00:00:00', endTime: '23:59:00', durationHours: 8, status: 'InProgress', location })

async function signIn(page, role, username, dest) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}${dest}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
}

const SCENES = [
  { tag: '390-light', width: 390, height: 844, touch: true, scheme: 'light' },
  { tag: '390-dark', width: 390, height: 844, touch: true, scheme: 'dark' },
  { tag: '1280-light', width: 1280, height: 900, touch: false, scheme: 'light' },
]

const measureCards = (page) => page.evaluate(() => {
  const box = (el) => el.getBoundingClientRect()
  const one = (id) => {
    const a = document.querySelector(`a[href*="/portal/shifts/${id}"]`)
    const cb = box(a), inner = cb.right - 16 + 1
    const loc = [...a.querySelectorAll('span.truncate')].find((s) => s.textContent.includes('Location'))
    const pin = a.querySelector('svg.lucide-map-pin')
    const texts = [...a.querySelectorAll('p, p *')].filter((el) => !el.closest('.sr-only') && el.children.length === 0 && el.textContent.trim())
    const overflow = texts.filter((el) => box(el).right > inner).map((el) => el.textContent.trim().slice(0, 30))
    const pb = pin ? box(pin) : null, lb = loc ? box(loc) : null
    const right = a.querySelector('div.shrink-0')
    return {
      id, height: cb.height, overflow, mapPins: a.querySelectorAll('svg.lucide-map-pin').length, hasLocationText: /Location/.test(a.textContent),
      loc: loc ? { scrollWidth: loc.scrollWidth, clientWidth: loc.clientWidth, height: lb.height, title: loc.getAttribute('title') } : null,
      pin: pb ? { w: pb.width, h: pb.height, dy: Math.abs((pb.top + pb.height / 2) - (lb.top + lb.height / 2)) } : null,
      badgeRight: right ? box(right).right : 0, innerRight: inner,
    }
  }
  return { iw: innerWidth, scrollWidth: document.documentElement.scrollWidth, coarse: matchMedia('(pointer: coarse)').matches, cards: ['sh-loc-a', 'sh-loc-b', 'sh-loc-c', 'sh-loc-d'].map(one) }
})

const measureHero = (page) => page.evaluate(() => {
  const s = document.querySelector('section[aria-labelledby="current-shift-title"]')
  const rows = [...s.querySelectorAll(':scope > p')].filter((p) => p.querySelector('svg.lucide-map-pin'))
  return { rows: rows.length, rowHeight: rows[0] ? rows[0].getBoundingClientRect().height : null, height: s.getBoundingClientRect().height }
})

const browser = await chromium.launch({ headless: true })
for (const s of SCENES) {
  const t = (n) => `${s.tag}: ${n}`
  try {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: s.width, height: s.height }, hasTouch: s.touch, isMobile: s.touch, colorScheme: s.scheme })
    const page = await context.newPage()
    let heroLocation = SHORT
    await page.route('**/api/v1/portal/my-shifts*', (r) => r.fulfill({ json: envelope({ shifts: [hero(heroLocation), ...cards()], tripAssignments: [], timeZoneId: 'Australia/Sydney' }) }))
    await signIn(page, 'SupportWorker', 'dev.worker', '/portal')
    await page.locator('a[href*="/portal/shifts/sh-loc-a"]').waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(500)

    const heroSection = page.locator('section[aria-labelledby="current-shift-title"]')
    await heroSection.waitFor({ state: 'visible', timeout: 30_000 })
    const hWith = await measureHero(page)
    const heroCrop = await cropElement(page, heroSection, path.join(OUT_DIR, `hero-location-${s.tag}.png`), { touch: s.touch })
    checks.push(checkCropHolds({ ...heroCrop, touch: s.touch }))

    const m = await measureCards(page)
    console.log(`[shift-location] ${s.tag} ${JSON.stringify({ m, hWith })}`)
    const [a, b, c, d] = m.cards
    if (s.touch) check(t('pointer is coarse'), m.coarse)
    check(t('1 card A height = card C + 20 (+-2)'), Math.abs(a.height - (c.height + 20)) <= 2, { a: a.height, c: c.height })
    check(t('2 cards C and D have no pin and no Location text, same height (+-1)'), [c, d].every((x) => x.mapPins === 0 && !x.hasLocationText) && Math.abs(c.height - d.height) <= 1, { c: [c.mapPins, c.hasLocationText, c.height], d: [d.mapPins, d.hasLocationText, d.height] })
    check(t('3 long B truncates for real, one line, title is the full text'), !!b.loc && b.loc.scrollWidth > b.loc.clientWidth && b.loc.height <= 21 && b.loc.title === LONG, b.loc)
    check(t('4 map pin 12x12, centred on its line (+-2)'), [a, b].every((x) => x.pin && Math.round(x.pin.w) === 12 && Math.round(x.pin.h) === 12 && x.pin.dy <= 2), [a.pin, b.pin])
    check(t('5 no text past the card inner edge, no page scroll, badge inside'), m.cards.every((x) => x.overflow.length === 0 && x.badgeRight <= x.innerRight) && m.scrollWidth <= m.iw, { overflow: m.cards.map((x) => x.overflow), scrollWidth: m.scrollWidth, iw: m.iw })
    check(t('6a hero with a location has exactly one row, height <= 21'), hWith.rows === 1 && hWith.rowHeight <= 21, hWith)

    const listSection = page.locator('a[href*="/portal/shifts/sh-loc-a"]').locator('xpath=..')
    const crop = await cropElement(page, listSection, path.join(OUT_DIR, `shift-cards-${s.tag}.png`), { touch: s.touch })
    checks.push(checkCropHolds({ ...crop, touch: s.touch }))
    if (s.scheme === 'light' || s.tag === '390-dark') checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `portal-${s.tag}.png`), { touch: s.touch })).checks)

    heroLocation = null
    await page.reload({ waitUntil: 'domcontentloaded' })
    await heroSection.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(500)
    const hWithout = await measureHero(page)
    check(t('6b hero without a location has no row'), hWithout.rows === 0, hWithout)
    check(t('6c hero without a location is one row shorter'), hWith.height - hWithout.height > 0 && hWith.height - hWithout.height <= 21 + 8, { with: hWith.height, without: hWithout.height })
    const heroCrop2 = await cropElement(page, heroSection, path.join(OUT_DIR, `hero-no-location-${s.tag}.png`), { touch: s.touch })
    checks.push(checkCropHolds({ ...heroCrop2, touch: s.touch }))
    await context.close()
  } catch (e) {
    check(t('portal scene ran'), false, String(e.message).split('\n')[0])
  }
}

// Coordinator slide-over, create mode: the Location field among its neighbours.
for (const s of SCENES) {
  const t = (n) => `slide-over ${s.tag}: ${n}`
  try {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: s.width, height: s.height }, hasTouch: s.touch, isMobile: s.touch, colorScheme: s.scheme })
    const page = await context.newPage()
    await signIn(page, 'Admin', 'dev.admin', '/rostering')
    await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 60_000 })
    await page.getByRole('button', { name: /^New shift$/ }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 30_000 })
    const input = dialog.getByLabel('Location', { exact: true })
    await input.scrollIntoViewIfNeeded()
    await page.waitForTimeout(600)
    const m = await page.evaluate(() => {
      const d = document.querySelector('[role=dialog]')
      const byLabel = (sel, text) => [...d.querySelectorAll(sel)].find((i) => i.labels?.[0]?.textContent.replace('*', '').trim() === text)
      const inp = byLabel('input', 'Location'), notes = byLabel('textarea', 'Notes'), svc = byLabel('input, button', 'Service date')
      const b = (el) => el.getBoundingClientRect()
      const wrap = (el) => b(el.labels[0].parentElement)
      const hint = document.getElementById(inp.getAttribute('aria-describedby')?.split(' ')[0] ?? '')
      // Vertical gaps between consecutive stacked, same-column FormFields, in page order.
      const stack = [...d.querySelectorAll('label')].map((l) => l.parentElement).filter((w, i, all) => all.indexOf(w) === i).map((w) => b(w))
        .filter((r) => r.width > 0).sort((p, q) => p.top - q.top)
      const gaps = []
      for (let i = 1; i < stack.length; i++) {
        const g = stack[i].top - stack[i - 1].bottom
        if (g >= 0 && g < 60 && Math.abs(stack[i].left - stack[i - 1].left) < 2 && Math.abs(stack[i].width - stack[i - 1].width) < 2) gaps.push(g)
      }
      const locBox = b(inp), notesBox = b(notes)
      return {
        label: inp.labels[0].textContent.trim(), hint: hint?.textContent.trim() ?? null, maxlength: inp.getAttribute('maxlength'), autocomplete: inp.getAttribute('autocomplete'),
        loc: { left: locBox.left, width: locBox.width, height: locBox.height }, notes: { left: notesBox.left, width: notesBox.width }, svcHeight: svc ? b(svc).height : null,
        gapLocNotes: wrap(notes).top - wrap(inp).bottom, otherGaps: gaps,
      }
    })
    console.log(`[shift-location] slide-over ${s.tag} ${JSON.stringify(m)}`)
    check(t('7 Location input left and width equal Notes (+-1), height equals Service date (+-1)'),
      Math.abs(m.loc.left - m.notes.left) <= 1 && Math.abs(m.loc.width - m.notes.width) <= 1 && m.svcHeight != null && Math.abs(m.loc.height - m.svcHeight) <= 1, m)
    check(t('8 maxlength 200, autocomplete off, label "Location", D5 hint'), m.maxlength === '200' && m.autocomplete === 'off' && m.label === 'Location' && m.hint === HINT, { maxlength: m.maxlength, autocomplete: m.autocomplete, label: m.label, hint: m.hint })
    const ref = m.otherGaps.length ? m.otherGaps.slice().sort((p, q) => p - q)[Math.floor(m.otherGaps.length / 2)] : null
    check(t('9 gap Location to Notes equals the gap between other stacked fields (+-2)'), ref != null && Math.abs(m.gapLocNotes - ref) <= 2, { gap: m.gapLocNotes, median: ref, others: m.otherGaps })
    const target = input.locator('xpath=ancestor::div[1]')
    const crop = await cropElement(page, target, path.join(OUT_DIR, `slideover-location-${s.tag}.png`), { touch: s.touch })
    checks.push(checkCropHolds({ ...crop, touch: s.touch }))
    if (s.tag !== '390-dark') checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `slideover-${s.tag}.png`), { touch: s.touch })).checks)
    await context.close()
  } catch (e) {
    check(t('scene ran'), false, String(e.message).split('\n')[0])
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
