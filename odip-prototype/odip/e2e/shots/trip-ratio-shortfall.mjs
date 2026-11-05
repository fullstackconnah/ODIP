// Trip staffing shortfall warning: captures plus the numeric checks of SHAPE.md (roster trip bar pill, schedule header, trip page chip and Staff-tab pill).
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to this file> <outdir>
// The board is the mock-api board with its rows replaced; the schedule and the trip page come straight from mock-api (t-0002 and t-0003 are short, t-0001 is covered).
// Computed boxes only; exits non-zero when a check fails.
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
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }

const bar = (id, name, startIdx, endIdx, staffShort, days, isDriver = false) => ({ tripInstanceId: id, tripCode: id.toUpperCase(), tripName: name, startDate: days[startIdx], endDate: days[endIdx], isDriver, staffShort })
// Short by 1, short by 3 on a one-day bar with a long name, a driver bar short by 2, and a covered trip.
const barsFor = (days) => [
  bar('t-9001', 'Gold Coast Beach Break', 1, 3, 1, days),
  bar('t-9002', 'Sunshine Coast Adventure Weekend', 4, 4, 3, days),
  bar('t-9003', 'Byron Bay Weekend', 0, 2, 0, days),
  bar('t-9004', 'Blue Mountains Walk', 3, 5, 2, days, true),
]
const EXPECT_SHORT = 3
const participantRow = (id, name, tripBars) => ({ participantId: id, fullName: name, supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, shifts: [], tripBars, scheduledHours: 0, daysWithoutCover: 7 })
const staffRow = (id, name, tripBars) => ({ staffId: id, fullName: name, role: 'SupportWorker', compliance: 'Ok', complianceNotes: [], rosteredHours: 0, targetHours: 38, shifts: [], tripBars, leave: [] })

async function open(browser, { width, height, touch, dark, staff }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light' })
  if (staff) await context.addInitScript(() => { try { sessionStorage.setItem('odip.roster.boardView', 'staff') } catch { /* none */ } })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`pageerror ${String(e.message).slice(0, 120)}`, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route('**/api/v1/rostering/board*', async (r) => {
    const response = await r.fetch(); const body = await response.json()
    if (body?.data?.participantRows) {
      body.data.weekStarted = true; body.data.exceptions = []; body.data.pendingAgreements = []
      const bars = barsFor(body.data.days)
      body.data.participantRows = [participantRow('p-9001', 'Mia Chen', [bars[0]]), participantRow('p-9002', 'Noah Blake', [bars[1]]), participantRow('p-9003', 'Zara Covered', [bars[2]]), participantRow('p-9004', 'Zed Driver', [bars[3]])]
    }
    if (body?.data?.staffRows) {
      const sb = barsFor(body.data.days); body.data.staffRows = sb.map((b, i) => staffRow(`s-900${i}`, ['Alex Rivera', 'Bo Tran', 'Cy Okoro', 'Di Walsh'][i], [b]))
    }
    await r.fulfill({ response, json: body })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}

// Runs in the page: WCAG contrast of an element's text against the first opaque background up its ancestors.
const contrastFns = `
  const parse = (s) => {
    if (s.startsWith('color(srgb')) return s.match(/[\\d.]+/g).slice(0, 3).map((v) => Math.round(+v * 255))
    const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = s; const h = c.fillStyle
    return h.startsWith('#') ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : h.match(/[\\d.]+/g).slice(0, 3).map(Number)
  }
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return parse(b) } return [255, 255, 255] }
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const contrast = (el) => { const [x, y] = [lum(parse(getComputedStyle(el).color)), lum(bgOf(el))].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2) }
`
const measureBars = (page) => page.evaluate(`(() => { ${contrastFns}
  const bars = [...document.querySelectorAll('a[href^="/trips/"][title*="("]')]
  return { coarse: matchMedia('(pointer: coarse)').matches, scrollW: document.documentElement.scrollWidth, innerW: innerWidth,
    bars: bars.map((b) => { const br = b.getBoundingClientRect(); const p = b.querySelector('[data-staff-short]'); const pr = p?.getBoundingClientRect()
      return { name: b.title, h: br.height, right: br.right, left: br.left, fits: b.scrollWidth <= b.clientWidth + 1, pill: p ? { text: p.textContent.trim(), left: pr.left, right: pr.right, w: pr.width, contrast: contrast(p) } : null } }) } })()`)

async function boardRun(browser, tag, vp, shots) {
  const { context, page } = await open(browser, vp)
  const touch = !!vp.touch
  await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('a[href^="/trips/"][title*="("]').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
  const m = await measureBars(page)
  const pills = m.bars.filter((b) => b.pill)
  check(`${tag}: pointer is ${touch ? 'coarse' : 'fine'}`, m.coarse === touch)
  check(`${tag}: no page overflow`, m.scrollW <= m.innerW, [m.scrollW, m.innerW])
  check(`${tag}: pills equal the short bars (${EXPECT_SHORT} expected)`, pills.length === EXPECT_SHORT && m.bars.filter((b) => !b.pill).length === m.bars.length - EXPECT_SHORT, [m.bars.length, pills.length])
  check(`${tag}: the covered trip has no pill`, m.bars.filter((b) => b.name.startsWith('Byron Bay')).every((b) => !b.pill))
  check(`${tag}: pills never clipped`, m.bars.every((b) => !b.pill || (b.pill.right <= b.right + 0.5 && b.pill.left >= b.left && b.pill.w > 0 && b.fits)), pills.map((b) => [b.pill.left, b.pill.right, b.left, b.right, b.fits]))
  check(`${tag}: bar height ${touch ? '>= 44' : '24 +-1'}`, m.bars.every((b) => (touch ? b.h >= 43.5 : Math.abs(b.h - 24) <= 1)), m.bars.map((b) => b.h))
  check(`${tag}: pill contrast >= 4.5`, pills.every((b) => b.pill.contrast >= 4.5), pills.map((b) => b.pill.contrast))
  const link = (name) => page.locator(`a[href^="/trips/"][title^="${name}"]`).first()
  // The week grid scrolls sideways inside its own frame, so bring the bar into the viewport first.
  const crop = async (name, file, opts = {}) => {
    try {
      await link(name).evaluate((el) => el.scrollIntoView({ inline: 'center', block: 'nearest' }))
      const r = await cropElement(page, link(name), path.join(OUT_DIR, file), { touch, ...opts }); checks.push(checkCropHolds(r))
    } catch (e) { check(`${tag}: crop ${file}`, false, String(e.message).slice(0, 120)) }
  }
  for (const [name, file] of shots) await crop(name, file)
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `board-full-${vp.width}${vp.dark ? '-dark' : ''}${vp.staff ? '-staff' : ''}.png`), { touch })).checks)
  await context.close()
}

async function scheduleRun(browser, tag, vp, shots) {
  const { context, page } = await open(browser, vp)
  const touch = !!vp.touch
  const overview = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/api/v1/schedule'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/schedule`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const trips = (await (await overview).json()).data.trips
  await page.locator('th:has-text("staff")').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
  const m = await page.evaluate(`(() => { ${contrastFns}
    const heads = [...document.querySelectorAll('thead th')].filter((t) => /staff/.test(t.textContent))
    return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, heads: heads.map((t) => {
      const line = t.querySelector('div.flex-wrap'); const pieces = line ? [...line.children] : []
      const note = pieces.find((p) => /\\bshort\\b/.test(p.textContent))
      return { name: t.querySelector('div[title]')?.title ?? '', h: t.getBoundingClientRect().height, hasShort: /\\bshort\\b/.test(t.textContent), noteContrast: note ? contrast(note) : null,
        pieceFits: pieces.every((p) => p.scrollWidth <= p.clientWidth + 1) } }) } })()`)
  const byName = new Map(trips.map((t) => [t.tripName, t.staffShort]))
  const expectShort = m.heads.filter((h) => byName.get(h.name) > 0).length
  check(`${tag}: some trip is short and some covered in the fixture`, expectShort > 0 && expectShort < m.heads.length, [expectShort, m.heads.length])
  check(`${tag}: no page overflow`, m.scrollW <= m.innerW, [m.scrollW, m.innerW])
  check(`${tag}: "short" only in the short trips' headers`, m.heads.every((h) => h.hasShort === (byName.get(h.name) > 0)), m.heads.map((h) => [h.name, h.hasShort]))
  check(`${tag}: header pieces do not wrap inside`, m.heads.every((h) => h.pieceFits))
  check(`${tag}: "N short" contrast >= 4.5`, m.heads.filter((h) => h.hasShort).every((h) => h.noteContrast >= 4.5), m.heads.map((h) => h.noteContrast))
  const hs = m.heads.filter((h) => h.hasShort).map((h) => h.h); const hc = m.heads.filter((h) => !h.hasShort).map((h) => h.h)
  check(`${tag}: a short header grows at most one line (<= 22px) over a covered one`, !hs.length || !hc.length || Math.max(...hs) - Math.min(...hc) <= 22, [hs, hc])
  const th = (short) => page.locator('thead th').filter({ hasText: 'staff' }).filter({ hasText: short ? /\bshort\b/ : /^((?!\bshort\b)[\s\S])*$/ }).first()
  for (const [short, file] of shots) { await th(short).evaluate((el) => el.scrollIntoView({ inline: 'center', block: 'nearest' })); const r = await cropElement(page, th(short), path.join(OUT_DIR, file), { touch }); checks.push(checkCropHolds(r)) }
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `schedule-full-${vp.width}${vp.dark ? '-dark' : ''}.png`), { touch })).checks)
  await context.close()
}

// Option A: the trip page's "Staff assigned" chip and the Staff-tab pill are amber.
async function tripRun(browser, tag, vp) {
  const { context, page } = await open(browser, vp)
  await page.goto(`${BASE_URL}/trips/t-0002`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const cell = page.getByRole('button', { name: /Staff assigned/ })
  await cell.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
  const g = await cell.evaluate((el) => { const chip = [...el.querySelectorAll('*')].find((n) => /\bshort\b/.test(n.textContent) && n.children.length === 0)
    return { attention: el.dataset.attention, cls: el.className.includes('--color-warning-container'), chipText: chip?.textContent } })
  check(`${tag}: Staff assigned tile is warning`, g.attention === 'warning' && g.cls, g)
  const chip = cell.locator('span', { hasText: /short/ }).last()
  const cr = await chip.evaluate(`(el) => { ${contrastFns} return contrast(el) }`.replace('(el) =>', '(el) =>')).catch(() => null)
  check(`${tag}: chip text contrast >= 4.5`, cr === null || cr >= 4.5, cr)
  const r1 = await cropElement(page, cell, path.join(OUT_DIR, `trip-glance-short-${vp.width}${vp.dark ? '-dark' : ''}.png`), { touch: !!vp.touch }); checks.push(checkCropHolds(r1))
  await page.getByRole('tab', { name: /^Staff/ }).first().click().catch(async () => { await page.getByText('Staff', { exact: true }).first().click() })
  const pill = page.getByText(/\/ \d+ staff$/).first()
  await pill.waitFor({ state: 'visible', timeout: 30_000 })
  const p = await pill.evaluate(`(el) => { ${contrastFns} const box = el.parentElement; return { cls: box.className.includes('--color-warning-container'), contrast: contrast(box) } }`)
  check(`${tag}: Staff-tab pill carries the warning classes`, p.cls, p)
  check(`${tag}: Staff-tab pill text contrast >= 4.5`, p.contrast >= 4.5, p.contrast)
  const r2 = await cropElement(page, pill.locator('xpath=..'), path.join(OUT_DIR, `stafftab-short-${vp.width}${vp.dark ? '-dark' : ''}.png`), { touch: !!vp.touch }); checks.push(checkCropHolds(r2))
  await context.close()
}

const browser = await chromium.launch({ headless: true })
try {
  const D = { width: 1280, height: 800 }; const M = { width: 390, height: 844, touch: true }
  await boardRun(browser, 'board 1280', D, [['Gold Coast', 'board-short1-1280.png'], ['Sunshine', 'board-short3-1280.png'], ['Byron', 'board-enough-1280.png']])
  await boardRun(browser, 'board 1280 dark', { ...D, dark: true }, [['Gold Coast', 'board-dark-short-1280.png']])
  await boardRun(browser, 'board 390', M, [['Gold Coast', 'board-390-short.png']])
  await boardRun(browser, 'board 390 dark', { ...M, dark: true }, [['Sunshine', 'board-390-short3-dark.png']])
  await boardRun(browser, 'board staff view 1280', { ...D, staff: true }, [['Gold Coast', 'board-staff-filter-1280.png']])
  await scheduleRun(browser, 'schedule 1280', D, [[true, 'schedule-short-1280.png'], [false, 'schedule-enough-1280.png']])
  await scheduleRun(browser, 'schedule 1280 dark', { ...D, dark: true }, [[true, 'schedule-dark-short-1280.png']])
  await scheduleRun(browser, 'schedule 390', M, [[true, 'schedule-390-short.png']])
  await tripRun(browser, 'trip page 1280', D)
  await tripRun(browser, 'trip page 1280 dark', { ...D, dark: true })
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
