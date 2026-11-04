// Captures and numeric checks for the participant surfacing (PTABS2: the section line under the chip strip, and the Overview "In this profile" card). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/participant-surfacing.mjs <outdir>
// Served by the mock API (participant p-0001). Exits non-zero when a check fails; every value is printed as "CHECK ok|FAIL name = value" and kept in measure.txt.
// Records > History is never opened: it crashes in the mock (no audit route).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsersFor = (role) => envelope([{ username: 'dev.' + role.toLowerCase(), role, tenantName: 'Sample Support Co' }])
const devLoginFor = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.' + role.toLowerCase(), fullName: 'Dev ' + role, role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const VIEWPORTS = [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 844, mobile: true }]
// Chips whose line shows (3+ sections) for an Admin, and one chip that must not show it.
const LINE_CHIPS = [['about', undefined, 'Profile'], ['daily', undefined, 'Care & ADL'], ['health', undefined, 'Medical']]
const NO_LINE = [['health', 'medications'], ['about', 'ndis-plan']]

const lines = []
let failed = false
const check = (name, value, ok) => { if (!ok) failed = true; const l = `CHECK ${ok ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(value)}`; lines.push(l); console.log(l) }

const goto = async (page, url) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('[role="tablist"]').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(400)
}
// Runs in the page. rgb of any CSS colour via a canvas; contrast is WCAG against the page background.
function toneOf(links) {
  const ctx = document.createElement('canvas').getContext('2d')
  const rgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3) }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const bg = (() => { for (let e = links[0]; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return rgb(c) } return [255, 255, 255] })()
  const contrast = (c) => { const a = lum(rgb(c)), b = lum(bg); return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 }
  const q = links.find((a) => a.hasAttribute('data-quiet')), f = links.find((a) => !a.hasAttribute('data-quiet'))
  return { quiet: q ? getComputedStyle(q).color : null, filled: f ? getComputedStyle(f).color : null, quietContrast: q ? contrast(getComputedStyle(q).color) : null, filledContrast: f ? contrast(getComputedStyle(f).color) : null }
}
function measureCard() {
  const root = [...document.querySelectorAll('h3')].find((h) => h.textContent === 'In this profile').parentElement.parentElement
  const lis = [...root.querySelectorAll('li')]
  const rows = lis.map((li) => {
    const col2Left = li.lastElementChild.getBoundingClientRect().left
    const as = [...li.querySelectorAll('a')]
    return { name: li.firstElementChild.textContent.trim(), col2Left, minLeft: Math.min(...as.map((a) => a.getBoundingClientRect().left)) }
  })
  const links = [...root.querySelectorAll('li a')]
  return { rows, bg: links.map((a) => getComputedStyle(a).backgroundColor), tones: toneOf(links), minH: Math.min(...links.map((a) => Math.round(a.getBoundingClientRect().height))) }
}
function measureLine() {
  const links = [...document.querySelector('nav[aria-label="Sections on this page"]').querySelectorAll('a')]
  return { bg: links.map((a) => getComputedStyle(a).backgroundColor), tones: toneOf(links) }
}
const inPage = (page, fn) => page.evaluate(`(() => { const toneOf = ${toneOf}; return (${fn})() })()`)
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

const browser = await chromium.launch({ headless: true })
try {
  for (const role of ['Admin', 'SupportWorker']) for (const vp of VIEWPORTS) {
    const n = `${vp.name} ${role}`
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-AU', timezoneId: 'Australia/Sydney', isMobile: !!vp.mobile, hasTouch: !!vp.mobile })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsersFor(role) }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLoginFor(role) }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

    // The Overview card: one list item per tab the role sees, the count equal to the tab badge, links at the touch floor, no sideways scroll.
    await goto(page, '/participants/p-0001')
    const card = page.getByRole('heading', { name: 'In this profile' })
    await card.waitFor({ state: 'visible', timeout: 30_000 })
    const r = await page.evaluate(() => {
      const strip = document.querySelector('[role="tablist"][aria-label="Participant sections"]')
      const tabs = [...strip.querySelectorAll('[role="tab"]')].map((t) => ({ label: t.textContent.replace(/,\s.*$/, '').replace(/\d+$/, '').trim(), badge: t.querySelector('span[aria-hidden="true"]')?.textContent ?? null })).filter((t) => t.label !== 'Overview')
      const root = [...document.querySelectorAll('h3')].find((h) => h.textContent === 'In this profile').parentElement.parentElement
      const items = [...root.querySelectorAll('li')].map((li) => ({ text: li.firstElementChild.textContent.trim(), count: li.querySelector('span.tabular-nums')?.firstChild?.textContent ?? null }))
      return { tabs, items }
    })
    check(`${n} card lines = tabs this role sees`, r.items.map((i) => i.text), r.items.length === r.tabs.length && r.tabs.every((t, i) => r.items[i].text.startsWith(t.label)))
    const mism = r.tabs.filter((t, i) => (t.badge ?? null) !== (r.items[i]?.count ?? null))
    check(`${n} card counts equal the tab badges`, r.tabs.map((t) => [t.label, t.badge]), mism.length === 0)
    if (role === 'SupportWorker') check(`${n} no Funding or Agreements line`, r.items.map((i) => i.text), !r.items.some((i) => /Funding|Agreements/.test(i.text)))
    if (vp.mobile) {
      const hs = await page.evaluate(() => [...[...document.querySelectorAll('h3')].find((h) => h.textContent === 'In this profile').parentElement.parentElement.querySelectorAll('li a')].map((a) => Math.round(a.getBoundingClientRect().height)))
      check(`${n} card links min height`, Math.min(...hs), hs.length > 0 && Math.min(...hs) >= 44)
    }
    check(`${n} overview no horizontal scroll`, await overflow(page), (await overflow(page)) <= 0)
    // Rows: name in column 1, every link at or right of column 2's left edge; the Admin card names 7 rows. Links are unfilled, quiet and filled differ in colour, both read at 4.5:1.
    const rows = await inPage(page, measureCard)
    check(`${n} card links stay in column 2`, rows.rows.map((x) => [x.name, x.minLeft - x.col2Left]), rows.rows.every((x) => x.minLeft >= x.col2Left - 0.5))
    if (role === 'Admin') check(`${n} Admin card has 7 named rows`, rows.rows.map((x) => x.name), rows.rows.length === 7 && rows.rows.every((x) => x.name.length > 0))
    check(`${n} card link fill`, rows.bg, rows.bg.every((b) => b === 'rgba(0, 0, 0, 0)'))
    check(`${n} card link tones`, rows.tones, rows.tones.quiet === null || (rows.tones.quiet !== rows.tones.filled && rows.tones.quietContrast >= 4.5 && rows.tones.filledContrast >= 4.5))
    // Whole-card captures: instant scroll, fixed/sticky chrome hidden, document-space clips (boundingBox is viewport-space, so add the scroll offset).
    await card.scrollIntoViewIfNeeded()
    await page.mouse.move(0, 0)
    const pad = 16
    const geo2 = await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = 'auto'
      for (const el of document.querySelectorAll('body *')) { const p = getComputedStyle(el).position; if (p === 'fixed' || p === 'sticky') el.style.visibility = 'hidden' }
      const root = [...document.querySelectorAll('h3')].find((h) => h.textContent === 'In this profile').parentElement.parentElement
      const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } }
      const c = rect(root), col = rect(root.parentElement), next = root.nextElementSibling ? rect(root.nextElementSibling) : c
      const hit = [...document.querySelectorAll('body *')].filter((el) => ['fixed', 'sticky'].includes(getComputedStyle(el).position) && getComputedStyle(el).visibility !== 'hidden').length
      return { c, col, bottom: Math.max(c.y + c.h, next.y + next.h), hit }
    })
    await page.waitForTimeout(200)
    check(`${n} no fixed overlay over the card`, geo2.hit, geo2.hit === 0)
    const cw = Math.min(vp.width, geo2.c.w + 2 * pad), ch = geo2.c.h + 2 * pad
    await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${role}-overview-card.png`), fullPage: true, clip: { x: Math.max(0, geo2.c.x - pad), y: geo2.c.y - pad, width: cw, height: ch } })
    check(`${n} card image holds the whole card`, [ch, geo2.c.h], ch >= geo2.c.h)
    if (role === 'Admin' && !vp.mobile) {
      // The Overview column from its top: budget card, then "In this profile", then the next card.
      const y0 = Math.max(0, geo2.col.y - pad), h = geo2.bottom + pad - y0
      await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${role}-overview-column.png`), fullPage: true, clip: { x: Math.max(0, geo2.col.x - pad), y: y0, width: geo2.col.w + 2 * pad, height: h } })
      check(`${n} column clip spans top to next card`, [y0, geo2.c.y, geo2.bottom], y0 < geo2.c.y && geo2.bottom >= geo2.c.y + geo2.c.h)
    }

    // The section line: on a 3+ section chip only, links at the touch floor, at most 3 lines at 390, a click lands on its section.
    for (const [tab, section, chip] of LINE_CHIPS) {
      await goto(page, `/participants/p-0001?tab=${tab}${section ? `&section=${section}` : ''}`)
      const nav = page.getByRole('navigation', { name: 'Sections on this page' })
      check(`${n} ${tab}/${chip} line shown`, await nav.count(), (await nav.count()) === 1)
      if (await nav.count() !== 1) continue
      const geo = await page.evaluate(() => {
        const as = [...document.querySelector('nav[aria-label="Sections on this page"]').querySelectorAll('a')]
        return { rows: new Set(as.map((a) => Math.round(a.getBoundingClientRect().top))).size, hs: as.map((a) => Math.round(a.getBoundingClientRect().height)), links: as.map((a) => a.textContent.trim()), sw: document.documentElement.scrollWidth - window.innerWidth }
      })
      check(`${n} ${tab} line rows`, geo.rows, vp.mobile ? geo.rows <= 3 : geo.rows <= 2)
      if (vp.mobile) check(`${n} ${tab} line links min height`, Math.min(...geo.hs), Math.min(...geo.hs) >= 44)
      check(`${n} ${tab} line no horizontal scroll`, geo.sw, geo.sw <= 0)
      const tone = await inPage(page, measureLine)
      check(`${n} ${tab} line link fill`, tone.bg, tone.bg.every((b) => b === 'rgba(0, 0, 0, 0)'))
      check(`${n} ${tab} line link tones`, tone.tones, tone.tones.quiet === null || (tone.tones.quiet !== tone.tones.filled && tone.tones.quietContrast >= 4.5 && tone.tones.filledContrast >= 4.5))
      // A link lands on its section: the last link's section sits in the viewport and the URL carries the hash.
      await nav.getByRole('link').last().click()
      await page.waitForTimeout(1200)
      const land = await page.evaluate(() => {
        const id = decodeURIComponent(location.hash.slice(1)); const el = document.getElementById(id)
        return { id, top: el ? Math.round(el.getBoundingClientRect().top) : null, vh: window.innerHeight, of: document.documentElement.scrollWidth - window.innerWidth }
      })
      check(`${n} ${tab} last link lands in view`, land, land.top !== null && land.top >= -2 && land.top < land.vh && land.of <= 0)
      // The click leaves the pointer (hover) and focus on the last link, which showed as a pill in the shot: release both first.
      await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0) })
      await page.mouse.move(0, 0)
      await page.waitForTimeout(200)
      if (vp.name === '1280' || tab === 'about' || tab === 'daily') await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${role}-${tab}-line.png`), fullPage: false })
    }
    for (const [tab, section] of NO_LINE) {
      await goto(page, `/participants/p-0001?tab=${tab}&section=${section}`)
      check(`${n} ${tab}/${section} no line`, await page.getByRole('navigation', { name: 'Sections on this page' }).count(), (await page.getByRole('navigation', { name: 'Sections on this page' }).count()) === 0)
    }
    await context.close()
  }
} catch (err) {
  failed = true
  console.error(`[participant-surfacing] FAILED: ${err.message}`)
} finally {
  await browser.close()
}
writeFileSync(path.join(OUT_DIR, 'measure.txt'), lines.join('\n') + '\n')
process.exit(failed ? 1 : 0)
