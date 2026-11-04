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
      const items = [...root.querySelectorAll('li')].map((li) => ({ text: li.firstElementChild.textContent.trim(), count: li.querySelector('span.tabular-nums')?.textContent ?? null }))
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
    await card.scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${role}-overview-card.png`), fullPage: false })

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
      // A link lands on its section: the last link's section sits in the viewport and the URL carries the hash.
      await nav.getByRole('link').last().click()
      await page.waitForTimeout(1200)
      const land = await page.evaluate(() => {
        const id = decodeURIComponent(location.hash.slice(1)); const el = document.getElementById(id)
        return { id, top: el ? Math.round(el.getBoundingClientRect().top) : null, vh: window.innerHeight, of: document.documentElement.scrollWidth - window.innerWidth }
      })
      check(`${n} ${tab} last link lands in view`, land, land.top !== null && land.top >= -2 && land.top < land.vh && land.of <= 0)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(200)
      if (vp.name === '1280' || tab === 'about') await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${role}-${tab}-line.png`), fullPage: false })
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
