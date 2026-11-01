// Polish PR 2b: the page header pattern and the mobile top bar.
// Numeric checks 1-3 (re-run), 7, 7b, 8, 10, 11 and 12 from SHAPE-PR2 section 6 (exit 1 on any failure), measuring computed boxes and styles, never class names.
// Routes: section 6. Profiles: 1280 light, 1280 dark, 390 light touch.
// Captures: the six pinned headers at 1280 and 390 (light), the top bar at 1280 and at 390 (drawer closed), the 390 bar with the drawer open, and /incidents as one full page per breakpoint.
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

const username = 'dev.admin'
const tenantName = 'Sample Support Co'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username, role: 'Admin', tenantName }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev Admin', role: 'Admin', tenantName, tenantId: 'tenant-0001' })

const PROFILES = [
  { name: 'desktop-1280', width: 1280, height: 900, touch: false, dark: false },
  { name: 'desktop-1280-dark', width: 1280, height: 900, touch: false, dark: true },
  { name: 'touch-390', width: 390, height: 844, touch: true, dark: false },
]
// `header` routes are the pinned PageHeader pages (check 7); `count` ones carry a count beside the title.
const ROUTES = [
  { key: 'trips', url: '/trips', header: true, count: true }, { key: 'tasks', url: '/tasks', header: true, count: true },
  { key: 'incidents', url: '/incidents', header: true, count: true }, { key: 'incident-new', url: '/incidents/new', header: true, back: true },
  { key: 'reports', url: '/reports', header: true, description: true }, { key: 'staff-detail', url: null, detail: true, back: true },
  { key: 'participants', url: '/participants', header: true }, { key: 'settings-profile', url: '/settings?section=profile' }, { key: 'roster', url: '/rostering' },
]
const CAPTURED = ['trips', 'tasks', 'incidents', 'reports', 'staff-detail', 'participants']

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (tag, name, ok, detail = '') => { checks.push({ name: `${tag} ${name}`, pass: !!ok, detail }); console.log(`[polish-pr2b] ${ok ? 'PASS' : 'FAIL'} ${tag} ${name}${detail !== '' ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`) }
const safe = async (tag, name, fn) => { try { await fn() } catch (e) { check(tag, name, false, String(e.message).split('\n')[0]) } }

// In-page helpers, installed before every page script: colours normalised through a canvas, token probes, a visibility test.
function installHelpers() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const px = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]] }
  const tok = (name) => { const el = document.createElement('i'); el.style.backgroundColor = `var(--color-${name})`; document.body.appendChild(el); const out = getComputedStyle(el).backgroundColor; el.remove(); return out }
  const same = (a, b) => { const x = px(a), y = px(b); return x[3] === 255 && y[3] === 255 && x[0] === y[0] && x[1] === y[1] && x[2] === y[2] }
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  // The text baseline of an element: a zero-size inline-block probe at the end of its first line sits on the baseline.
  const baseline = (el) => { const p = document.createElement('span'); p.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'; el.appendChild(p); const y = p.getBoundingClientRect().bottom; p.remove(); return y }
  window.__h = { px, tok, same, shown, baseline }
}
const gotoReady = async (page, url) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('main, form').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
}
const setTheme = (page, dark) => page.evaluate((d) => { if (d) document.documentElement.dataset.theme = 'dark' }, dark)

async function signIn(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const button = page.getByRole('button', { name: 'Sign in as selected user' })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}

// Checks 1-3 (as in 2a): solid primaries, the selected treatment and lime.
const measureColours = (page) => page.evaluate(() => {
  const h = window.__h
  const primary = h.tok('primary'), lime = h.tok('primary-fixed')
  const all = [...document.querySelectorAll('body *')].filter(h.shown)
  const solids = all.filter((el) => {
    const r = el.getBoundingClientRect()
    return r.height >= 28 && r.width >= 56 && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' && h.same(getComputedStyle(el).backgroundColor, primary) && !el.closest('table tbody, [role=dialog]')
  }).map((el) => (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40))
  const limes = all.filter((el) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' && h.same(getComputedStyle(el).backgroundColor, lime) && !(r.width <= 48 && r.height <= 48) })
    .map((el) => (el.textContent || '').trim().slice(0, 30))
  const selected = [...document.querySelectorAll('main [role=radio][aria-checked=true], main [role=tab][aria-selected=true], main nav [aria-current=page]')].filter(h.shown).map((el) => {
    const cs = getComputedStyle(el)
    const hasBar = (s) => s.includes(primary.replace(/\s+/g, ' ')) && /(^|[\s-])2px(\s|$)/.test(s)
    return { label: (el.textContent || '').trim().slice(0, 24), notSolid: !h.same(cs.backgroundColor, primary) && !h.same(cs.backgroundColor, lime), bar: hasBar(cs.boxShadow) || (parseFloat(cs.borderBottomWidth) >= 2 && h.same(cs.borderBottomColor, primary)) }
  })
  return { solids, limes, selected }
})

// Check 7: the h1, its count, the description. Check 7b: the back icon against the h1's first line box.
const measureHeader = (page) => page.evaluate(() => {
  const h = window.__h
  const h1 = [...document.querySelectorAll('main h1')].find(h.shown)
  if (!h1) return { error: 'no visible h1 in main' }
  const cs = getComputedStyle(h1), hr = h1.getBoundingClientRect()
  const lineHeight = parseFloat(cs.lineHeight)
  const out = { fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontWeight: cs.fontWeight, h1Bottom: hr.bottom }
  const count = h1.nextElementSibling
  if (count && h.shown(count)) out.baselineDelta = Math.abs(h.baseline(count) - h.baseline(h1))
  // The first visible paragraph after the h1, by position (not by a class).
  const desc = [...document.querySelectorAll('main p')].find((p) => h.shown(p) && (h1.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING))
  if (desc) out.descTop = desc.getBoundingClientRect().top
  const back = [...document.querySelectorAll('main a[aria-label^="Back"], main button[aria-label^="Back"]')].find(h.shown)
  if (back) { const br = back.getBoundingClientRect(); out.iconCentre = br.top + br.height / 2; out.lineCentre = hr.top + lineHeight / 2; out.iconOffset = Math.abs(out.iconCentre - out.lineCentre) }
  return out
})

// Check 8: the tab strip sits under the title, and Report incident is not in the tab strip's row.
const measureTabs = (page) => page.evaluate(() => {
  const h = window.__h
  const h1 = [...document.querySelectorAll('main h1')].find(h.shown)
  const tablist = [...document.querySelectorAll('main [role=tablist]')].find(h.shown)
  const report = [...document.querySelectorAll('main a')].find((a) => h.shown(a) && /report incident/i.test(a.textContent || ''))
  if (!h1 || !tablist) return { error: `h1 ${!!h1}, tablist ${!!tablist}` }
  const tr = tablist.getBoundingClientRect()
  const out = { tablistTop: tr.top, h1Bottom: h1.getBoundingClientRect().bottom }
  if (report) { const rr = report.getBoundingClientRect(); out.reportInTabRow = rr.bottom > tr.top && rr.top < tr.bottom; out.reportInside = tablist.contains(report) }
  return out
})

// Check 10 (390 touch): the bar's targets, the organisation chip, overflow and fit inside the 358px content width.
const measureBar = (page, name) => page.evaluate((chipTitle) => {
  const h = window.__h
  const header = document.querySelector('header')
  const targets = [...header.querySelectorAll('button, a')].filter(h.shown).map((el) => { const r = el.getBoundingClientRect(); return { label: el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 20), left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height } }).sort((a, b) => a.left - b.left)
  const chip = [...header.querySelectorAll('span')].find((el) => el.getAttribute('title') === chipTitle)
  const overlap = targets.some((t, i) => i > 0 && t.left < targets[i - 1].right - 0.5)
  const overflowing = [...header.querySelectorAll('*')].filter(h.shown).filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5).map((el) => el.tagName)
  return { targets, chipDisplay: chip ? getComputedStyle(chip).display : 'absent', headerScroll: header.scrollWidth - header.clientWidth, overlap, overflowing, innerWidth }
}, name)

// Check 11: the bar icons share one colour (the glyph element of each bar button), unread dots excluded (they hold no glyph).
const measureBarIcons = (page) => page.evaluate(() => {
  const h = window.__h
  const muted = h.tok('muted-foreground')
  const icons = [...document.querySelectorAll('header button, header a')].filter(h.shown).map((b) => ({ label: b.getAttribute('aria-label') || b.getAttribute('title') || '?', glyph: b.querySelector('svg, .material-symbols-outlined') })).filter((i) => i.glyph && h.shown(i.glyph))
  return icons.map((i) => ({ label: i.label, color: getComputedStyle(i.glyph).color, ok: h.same(getComputedStyle(i.glyph).color, muted) }))
})

// Check 12 (390 touch): the primary action comes first in reading order among the page's action buttons.
const measurePrimaryFirst = (page, primaryName) => page.evaluate((name) => {
  const h = window.__h
  const h1 = [...document.querySelectorAll('main h1')].find(h.shown)
  const links = [...document.querySelectorAll('main a, main button')].filter((el) => h.shown(el) && !el.closest('[role=tablist], [role=radiogroup], table, nav'))
  const primary = links.find((el) => (el.textContent || '').trim() === name)
  if (!h1 || !primary) return { error: `h1 ${!!h1}, primary ${!!primary}` }
  const box = (el) => el.getBoundingClientRect()
  const p = box(primary)
  // Secondary actions: the other shown children of the primary's own cluster (the Trips view toggle counts) (its parent row).
  const rest = [...primary.parentElement.children].filter((el) => el !== primary && h.shown(el))
  const before = (a, b) => a.top < b.top - 0.5 || (Math.abs(a.top - b.top) <= 0.5 && a.left < b.left)
  return { rest: rest.length, first: rest.every((el) => before(p, box(el))), primary: { top: p.top, left: p.left }, others: rest.map((el) => ({ label: (el.textContent || '').trim().slice(0, 20), top: box(el).top, left: box(el).left })) }
}, primaryName)

const staffHref = async (page) => {
  await gotoReady(page, '/staff')
  const href = await page.locator('a[href^="/staff/"]:not([href="/staff/new"])').first().getAttribute('href')
  return href ?? '/staff'
}

try {
  for (const profile of PROFILES) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, colorScheme: profile.dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    await context.addInitScript(installHelpers)
    await context.addInitScript(() => { try { localStorage.setItem('odip.trips.view', 'table') } catch { /* ignore */ } })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
    await signIn(page)
    const staffUrl = await staffHref(page)
    for (const route of ROUTES) {
      const url = route.url ?? staffUrl
      const tag = `${profile.name} ${route.key === 'staff-detail' ? '/staff/:id' : url}`
      await safe(tag, 'route checks', async () => {
        await gotoReady(page, url)
        await setTheme(page, profile.dark)
        await page.waitForTimeout(300)
        const phone = profile.width < 768
        const c = await measureColours(page)
        check(tag, '1 at most one solid primary', c.solids.length <= 1, c.solids)
        check(tag, '2 selected is not primary or lime, with a 2px primary bar', c.selected.every((s) => s.notSolid && s.bar), c.selected.filter((s) => !(s.notSolid && s.bar)).map((s) => s.label))
        check(tag, '3 lime appears at most once', c.limes.length <= 1, c.limes)

        if (route.header || route.detail) {
          const m = await measureHeader(page)
          if (m.error) check(tag, '7 header', false, m.error)
          else {
            if (route.detail) {
              if (!phone) check(tag, '7 detail h1 is 28px, weight 800', m.fontSize === '28px' && m.fontWeight === '800', { fs: m.fontSize, fw: m.fontWeight })
            } else {
              const [fs, lh] = phone ? ['20px', '26px'] : ['24px', '30px']
              check(tag, `7 h1 is ${fs}/${lh}`, m.fontSize === fs && m.lineHeight === lh, { fs: m.fontSize, lh: m.lineHeight })
            }
            if (route.count) check(tag, '7 count baseline within 1px of the h1 baseline', m.baselineDelta !== undefined && m.baselineDelta <= 1, m.baselineDelta ?? 'no count')
            if (route.description) check(tag, '7 description starts below the h1', m.descTop !== undefined && m.descTop > m.h1Bottom, { descTop: m.descTop, h1Bottom: m.h1Bottom })
            if (route.back) check(tag, '7b back icon centre within 2px of the h1 first-line centre', m.iconOffset !== undefined && m.iconOffset <= 2, m.iconOffset === undefined ? 'no back icon' : { iconCentre: +m.iconCentre.toFixed(2), lineCentre: +m.lineCentre.toFixed(2), offset: +m.iconOffset.toFixed(2) })
          }
        }
        if (route.key === 'incidents') {
          const t = await measureTabs(page)
          if (t.error) check(tag, '8 tab strip', false, t.error)
          else check(tag, '8 tablist is below the h1, and Report incident is not in its row', t.tablistTop > t.h1Bottom && t.reportInTabRow !== true && t.reportInside !== true, t)
        }
        if (!profile.dark) {
          const icons = await measureBarIcons(page)
          check(tag, '11 every bar icon has the muted-foreground colour', icons.length >= 2 && icons.every((i) => i.ok), icons.filter((i) => !i.ok).length ? icons : `${icons.length} icons`)
        }
        if (profile.touch && (route.key === 'trips' || route.key === 'participants')) {
          const f = await measurePrimaryFirst(page, route.key === 'trips' ? 'New trip' : 'New enquiry')
          if (f.error) check(tag, '12 primary first', false, f.error)
          else check(tag, '12 primary button comes before every secondary action', f.first && f.rest > 0, f)
        }
        if (profile.touch) {
          const b = await measureBar(page, tenantName)
          check(tag, '10 four header targets, each 44x44 or more', b.targets.length === 4 && b.targets.every((t) => t.w >= 43.5 && t.h >= 43.5), b.targets.map((t) => `${t.label} ${t.w.toFixed(0)}x${t.h.toFixed(0)}`))
          check(tag, '10 organisation chip is not displayed', b.chipDisplay === 'none', b.chipDisplay)
          check(tag, '10 no header element overflows', b.headerScroll <= 0 && b.overflowing.length === 0, { scroll: b.headerScroll, overflowing: b.overflowing })
          check(tag, '10 the four targets fit in the 358px content width without overlap', !b.overlap && b.targets.length > 0 && b.targets[0].left >= 16 - 0.5 && b.targets[b.targets.length - 1].right <= b.innerWidth - 16 + 0.5, { first: b.targets[0]?.left, last: b.targets[b.targets.length - 1]?.right, overlap: b.overlap })
        }

        // Captures (light only): the pinned headers, and the 390 bar with the drawer open.
        if (!profile.dark && CAPTURED.includes(route.key)) {
          const title = page.locator('main h1:visible').first().locator('xpath=../..')
          const below = page.locator('main [role=tablist]:visible, main [role=radiogroup]:visible, main p[class*="72ch"]:visible').first()
          const also = (await below.count()) ? below : undefined
          checks.push(checkCropHolds(await cropElement(page, title, path.join(OUT_DIR, `${profile.name}-${route.key}-header.png`), { touch: profile.touch, also, pad: 12 })))
        }
        if (!profile.dark && route.key === 'trips') {
          checks.push(checkCropHolds(await cropElement(page, page.locator('header').first(), path.join(OUT_DIR, `${profile.name}-topbar.png`), { touch: profile.touch, pad: 0 })))
        }
        if (!profile.dark && route.key === 'incidents') checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${profile.name}-incidents.png`), { touch: profile.touch })).checks)
        if (profile.touch && route.key === 'trips') {
          await page.getByRole('button', { name: 'Open menu' }).click()
          await page.waitForTimeout(500)
          const line = await page.evaluate((t) => { const el = [...document.querySelectorAll('aside p')].find((p) => p.textContent === t); if (!el) return null; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { fs: cs.fontSize, overflow: el.scrollWidth - el.clientWidth, width: r.width } }, tenantName)
          check(tag, '10 drawer shows the organisation as one 13px line, not truncated', !!line && line.fs === '13px' && line.overflow <= 0, line ?? 'absent')
          checks.push(checkCropHolds(await cropElement(page, page.locator('header').first(), path.join(OUT_DIR, `${profile.name}-topbar-drawer.png`), { touch: true, also: page.locator('aside').first(), pad: 0 })))
        }
      })
    }
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
