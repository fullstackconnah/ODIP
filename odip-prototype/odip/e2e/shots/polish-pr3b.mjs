// Polish PR 3b: coordinator first views. Numeric checks 7-9 from SHAPE-PR3 section 14 (exit 1 on any failure), measuring computed boxes and styles, never class names.
//   7 Roster, unstarted week: no inert grid layer, Start button near the fold, one solid primary, the start card above the fill chart.
//   8 Incidents, one overdue: the deadline banner is short and its rules are folded away.
//   9 Staff list: at most three chips, the flag first and the only tint, one line on a phone, the card height target.
// Profiles: 1280x800 light, 1280x800 dark, 390x844 light touch. Captures: section 15 "3b" crops (writer only), plus one full page per breakpoint under full/.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

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

const tenantName = 'Sample Support Co'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = (username, role) => envelope([{ username, role, tenantName }])
const devLogin = (username, role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName, tenantId: 'tenant-0001' })

const PROFILES = [
  { name: 'desktop-1280', width: 1280, height: 800, touch: false, dark: false },
  { name: 'desktop-1280-dark', width: 1280, height: 800, touch: false, dark: true },
  { name: 'touch-390', width: 390, height: 844, touch: true, dark: false },
]
// A week the mock has not started (it starts only the fixture week), with the fill chart showing.
const UNSTARTED_URL = '/rostering?date=2030-03-04'
const ALL_FIVE = { isDriverEligible: true, isFirstAidQualified: true, isMedicationCompetent: true, isManualHandlingCompetent: true, isOvernightEligible: true }
// Synthetic staff patches over the first six mock rows: the worst cases for the chip list, first (missing flag + 5 held), then valid screening + 5 held, expired, 1 held, none.
const STAFF_PATCHES = [
  { ...ALL_FIVE, workerScreeningExpiryDate: null, isActive: true },
  { ...ALL_FIVE, workerScreeningExpiryDate: '2099-01-01', isActive: true },
  { ...ALL_FIVE, workerScreeningExpiryDate: '2020-01-01', isActive: true },
  { isDriverEligible: true, isFirstAidQualified: false, isMedicationCompetent: false, isManualHandlingCompetent: false, isOvernightEligible: false, workerScreeningExpiryDate: '2099-01-01', isActive: true },
  { isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false, isManualHandlingCompetent: false, isOvernightEligible: false, workerScreeningExpiryDate: null, isActive: false },
  { ...ALL_FIVE, isOvernightEligible: false, workerScreeningExpiryDate: null, isActive: true },
]

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (tag, name, ok, detail = '') => { checks.push({ name: `${tag} ${name}`, pass: !!ok, detail }); console.log(`[polish-pr3b] ${ok ? 'PASS' : 'FAIL'} ${tag} ${name}${detail !== '' ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`) }
const safe = async (tag, name, fn) => { try { await fn() } catch (e) { check(tag, name, false, String(e.message).split('\n')[0]) } }

// In-page helpers, installed before every page script: colours normalised through a canvas, token probes, a visibility test, contrast.
function installHelpers() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const px = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]] }
  const tok = (name) => { const el = document.createElement('i'); el.style.backgroundColor = `var(--color-${name})`; document.body.appendChild(el); const out = getComputedStyle(el).backgroundColor; el.remove(); return out }
  const same = (a, b) => { const x = px(a), y = px(b); return x[3] === 255 && y[3] === 255 && x[0] === y[0] && x[1] === y[1] && x[2] === y[2] }
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  const lum = (c) => { const [r, g, b] = px(c).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  window.__h = { px, tok, same, shown, contrast }
}
const gotoReady = async (page, url) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('main, form').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
}
const setTheme = (page, dark) => page.evaluate((d) => { if (d) document.documentElement.dataset.theme = 'dark' }, dark)

async function signIn(page, username, role) {
  await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers(username, role) }))
  await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin(username, role) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const button = page.getByRole('button', { name: 'Sign in as selected user' })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}

// The staff list, with six rows patched to the chip worst cases (synthetic flags only; names and ids stay the mock's).
const patchStaff = (page) => page.route(/\/api\/v1\/staff(\?.*)?$/, async (route) => {
  const res = await route.fetch()
  const json = await res.json()
  if (Array.isArray(json.data)) json.data = json.data.map((s, i) => (i < STAFF_PATCHES.length ? { ...s, ...STAFF_PATCHES[i] } : s))
  await route.fulfill({ response: res, json })
})

// Check 7: the Start button and card against the fold, the ghost grid layer, solid primaries and the chart's place.
const measureRoster = (page) => page.evaluate(() => {
  const h = window.__h
  const primary = h.tok('primary')
  const card = document.querySelector('section[aria-labelledby="start-week-heading"]')
  const start = [...document.querySelectorAll('main button')].find((b) => /^Start rostering/.test((b.textContent || '').trim()))
  const chart = [...document.querySelectorAll('main h2, main h3')].find((e) => /How full the next weeks are/.test(e.textContent || ''))
  const solids = [...document.querySelectorAll('body *')].filter(h.shown).filter((el) => {
    const r = el.getBoundingClientRect()
    return r.height >= 28 && r.width >= 56 && h.same(getComputedStyle(el).backgroundColor, primary) && !el.closest('[role=dialog]')
  }).map((el) => (el.textContent || '').trim().slice(0, 40))
  const sb = start ? start.getBoundingClientRect() : null
  return {
    inert: document.querySelectorAll('[inert][aria-hidden=true]').length,
    cardTop: card ? card.getBoundingClientRect().top : null, chartTop: chart ? chart.getBoundingClientRect().top : null,
    startTop: sb ? sb.top : null, startBottom: sb ? sb.bottom : null, solids, cardText: card ? card.textContent.slice(0, 60) : null,
    overflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
  }
})

// Check 8: the banner's height, disclosure state, the rules sentence, target sizes and the headline contrast.
const measureBanner = (page) => page.evaluate(() => {
  const h = window.__h
  const banner = document.querySelector('main [role=alert]')
  if (!banner) return { error: 'no [role=alert] banner' }
  const details = banner.querySelector('details'), summary = details && details.querySelector('summary')
  const link = [...banner.querySelectorAll('a')].find((a) => /View overdue incidents/.test(a.textContent || ''))
  const headline = banner.querySelector('p')
  const rules = [...banner.querySelectorAll('p')].find((p) => /Most reportable incidents/.test(p.textContent || ''))
  const size = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 } }
  return {
    height: banner.getBoundingClientRect().height, open: !!(details && details.open), rulesShown: !!(rules && rules.checkVisibility()),
    summary: size(summary), link: size(link), summaryText: summary ? summary.textContent.trim() : null,
    contrast: headline ? h.contrast(getComputedStyle(headline).color, getComputedStyle(banner).backgroundColor) : null,
    overflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
  }
})

// Check 9: every Qualifications list.
const measureChips = (page) => page.evaluate(() => {
  const h = window.__h
  const neutral = h.tok('secondary-container')
  const lists = [...document.querySelectorAll('main ul[aria-label=Qualifications]')].filter(h.shown)
  const rows = [...document.querySelectorAll('main tbody tr')].filter(h.shown).map((r) => r.getBoundingClientRect().height)
  return {
    rows,
    lists: lists.map((ul) => {
      const lis = [...ul.querySelectorAll('li')]
      const flag = lis[0] && /^Screening (missing|expired)$/.test((lis[0].textContent || '').trim())
      const flagAt = lis.findIndex((li) => /^Screening (missing|expired)$/.test((li.textContent || '').trim()))
      const more = lis.find((li) => /^\+\d+$/.test((li.textContent || '').trim()))
      const others = lis.filter((li, i) => i !== flagAt)
      return {
        count: lis.length, height: ul.getBoundingClientRect().height, texts: lis.map((li) => (li.textContent || '').trim()),
        flagFirst: flagAt < 0 || flagAt === 0, hasFlag: flagAt >= 0 && flag,
        othersUntinted: others.every((li) => { const bg = getComputedStyle(li).backgroundColor; return bg === 'rgba(0, 0, 0, 0)' || h.same(bg, neutral) }),
        moreLabel: more ? more.getAttribute('aria-label') : null,
      }
    }),
  }
})

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

try {
  for (const profile of PROFILES) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, colorScheme: profile.dark ? 'dark' : 'light' })
    await context.addInitScript(installHelpers)
    const page = await context.newPage()
    await signIn(page, 'dev.admin', 'Admin')
    await patchStaff(page)
    const phone = profile.width < 768
    const full = (name) => path.join(OUT_DIR, 'full', `${profile.name}-${name}.png`)

    await safe(`${profile.name} /roster`, '7 roster checks', async () => {
      const tag = `${profile.name} /roster unstarted`
      await gotoReady(page, UNSTARTED_URL)
      await page.locator('section[aria-labelledby="start-week-heading"]').waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByRole('heading', { name: 'How full the next weeks are' }).waitFor({ state: 'visible', timeout: 30_000 })
      await setTheme(page, profile.dark)
      await page.waitForTimeout(300)
      const m = await measureRoster(page)
      check(tag, '7 no inert aria-hidden grid layer', m.inert === 0, m.inert)
      check(tag, phone ? '7 Start button bottom is at most 844' : '7 Start button top is at most 400', m.startTop !== null && (phone ? m.startBottom <= 844 : m.startTop <= 400), { top: m.startTop, bottom: m.startBottom })
      check(tag, '7 exactly one solid primary', m.solids.length === 1, m.solids)
      check(tag, '7 the start card is above the fill chart', m.cardTop !== null && m.chartTop !== null && m.cardTop < m.chartTop, { card: m.cardTop, chart: m.chartTop })
      check(tag, '7 no horizontal overflow', m.overflow <= 0, m.overflow)
      if (!profile.dark) {
        checks.push(checkCropHolds(await cropElement(page, page.locator('section[aria-labelledby="start-week-heading"]'), path.join(OUT_DIR, `${profile.name}-roster-unstarted-writer.png`), { touch: profile.touch, pad: 16 })))
        checks.push(...(await fullPage(page, full('roster-unstarted'), { touch: profile.touch })).checks)
      }
    })

    await safe(`${profile.name} /incidents`, '8 banner checks', async () => {
      const tag = `${profile.name} /incidents`
      await gotoReady(page, '/incidents')
      await page.locator('main [role=alert]').first().waitFor({ state: 'visible', timeout: 30_000 })
      await setTheme(page, profile.dark)
      await page.waitForTimeout(300)
      const m = await measureBanner(page)
      if (m.error) { check(tag, '8 banner', false, m.error); return }
      check(tag, phone ? '8 banner is at most 112px tall' : '8 banner is at most 56px tall', m.height <= (phone ? 112 : 56), Math.round(m.height))
      check(tag, '8 the disclosure is closed and the rules sentence is not visible', !m.open && !m.rulesShown && m.summaryText === 'About the deadlines', { open: m.open, rulesShown: m.rulesShown, summary: m.summaryText })
      if (profile.touch) check(tag, '8 summary and link are each at least 44x44', m.summary && m.link && m.summary.w >= 44 && m.summary.h >= 44 && m.link.w >= 44 && m.link.h >= 44, { summary: m.summary, link: m.link })
      check(tag, '8 headline contrast against the banner is at least 4.5', m.contrast >= 4.5, m.contrast && Math.round(m.contrast * 100) / 100)
      check(tag, '8 no horizontal overflow', m.overflow <= 0, m.overflow)
      if (!profile.dark) {
        const banner = page.locator('main [role=alert]').first()
        checks.push(checkCropHolds(await cropElement(page, banner, path.join(OUT_DIR, `${profile.name}-incidents-banner-closed.png`), { touch: profile.touch, pad: 12 })))
        checks.push(...(await fullPage(page, full('incidents'), { touch: profile.touch })).checks)
        if (profile.touch) {
          await banner.locator('summary').click()
          await page.waitForTimeout(300)
          const o = await measureBanner(page)
          check(tag, '8 opened: the rules sentence shows and the page does not overflow', o.open && o.rulesShown && o.overflow <= 0, { open: o.open, rulesShown: o.rulesShown, overflow: o.overflow })
          checks.push(checkCropHolds(await cropElement(page, banner, path.join(OUT_DIR, `${profile.name}-incidents-banner-open.png`), { touch: true, pad: 12 })))
        }
      }
    })

    await safe(`${profile.name} /staff`, '9 chip checks', async () => {
      const tag = `${profile.name} /staff`
      await gotoReady(page, '/staff')
      await page.locator('main ul[aria-label=Qualifications]').first().waitFor({ state: 'visible', timeout: 30_000 })
      await setTheme(page, profile.dark)
      await page.waitForTimeout(300)
      const m = await measureChips(page)
      check(tag, '9 there are lists to measure, including a flagged one', m.lists.length >= 4 && m.lists.some((l) => l.hasFlag), m.lists.length)
      check(tag, '9 each list holds at most 3 items', m.lists.every((l) => l.count <= 3), m.lists.map((l) => l.count))
      check(tag, '9 the flag is the first item', m.lists.every((l) => l.flagFirst), m.lists.filter((l) => !l.flagFirst).map((l) => l.texts))
      check(tag, '9 no other item is tinted', m.lists.every((l) => l.othersUntinted), m.lists.filter((l) => !l.othersUntinted).map((l) => l.texts))
      check(tag, '9 a +n chip names the rest, starting "Also:"', m.lists.filter((l) => l.texts.some((t) => /^\+\d+$/.test(t))).every((l) => (l.moreLabel || '').startsWith('Also:')) && m.lists.some((l) => l.moreLabel), m.lists.map((l) => l.moreLabel))
      if (phone) {
        check(tag, '9 each list is one chip line (at most 26px)', m.lists.every((l) => l.height <= 26), m.lists.map((l) => Math.round(l.height)))
        check(tag, '9 phone card height median <= 120, max <= 132', median(m.rows) <= 120 && Math.max(...m.rows) <= 132, { median: Math.round(median(m.rows)), max: Math.round(Math.max(...m.rows)), n: m.rows.length })
      }
      if (!profile.dark) {
        const row = page.locator('main tbody tr').first()
        checks.push(checkCropHolds(await cropElement(page, row, path.join(OUT_DIR, `${profile.name}-staff-chips.png`), { touch: profile.touch, pad: 12 })))
        checks.push(...(await fullPage(page, full('staff'), { touch: profile.touch })).checks)
      }
    })
    await context.close()
  }

  // A read-only user is redirected away from /rostering, so that state is covered by the unit test (RosterBoardPage.startweek), not captured.
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
