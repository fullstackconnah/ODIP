// Captures and numeric checks for the participant page regroup (PTABS1: 34 sub-tab chips become 16). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/participant-tabs.mjs <outdir>
// Served by the mock API (participant p-0001), signed in as Admin. Exits non-zero when a check fails; every measured value is
// printed as "CHECK ok|FAIL name = value", and measure.txt in OUT_DIR holds the same lines.
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
const TABS = ['overview', 'about', 'health', 'daily', 'people', 'funding', 'agreements', 'records']

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '390', width: 390, height: 844, mobile: true },
]
// Chips per main tab for an Admin once the regroup is in: 2 + 4 + 2 + 3 + 2 + 3 = 16 (Overview has no sub-strip).
const CHIPS = {
  about: ['Profile', 'NDIS & services'],
  health: ['Medical', 'Medications', 'Risks & practices', 'Behaviour'],
  daily: ['Care & ADL', 'Routines & meals'],
  people: ['Contacts', 'Roster & staff match', 'Bookings'],
  funding: ['Plan budget', 'Claims'],
  records: ['Notes', 'Consents', 'History'],
}

const lines = []
let failed = false
const check = (name, value, ok) => { if (!ok) failed = true; const l = `CHECK ${ok ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(value)}`; lines.push(l); console.log(l) }

const goto = async (page, url) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('[role="tablist"]').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await page.waitForTimeout(400)
}
const chipLabels = (page) => page.evaluate(() => {
  const strip = [...document.querySelectorAll('[role="tablist"]')].find((l) => l.getAttribute('aria-label') !== 'Participant sections')
  if (!strip) return null
  return [...strip.querySelectorAll('[role="tab"]')].map((t) => t.textContent.replace(/,\s.*$/, '').replace(/\d+$/, '').trim())
})

const browser = await chromium.launch({ headless: true })
const problems = []
try {
  for (const role of ['Admin', 'SupportWorker']) for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-AU', timezoneId: 'Australia/Sydney', isMobile: !!vp.mobile, hasTouch: !!vp.mobile })
    const page = await context.newPage()
    page.on('pageerror', (err) => problems.push(`[${vp.name}] page error: ${err.message}`))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsersFor(role) }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLoginFor(role) }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

    // Captures: every tab for this role (the numeric checks below run for the Admin only).
    for (const tab of TABS) {
      await goto(page, `/participants/p-0001?tab=${tab}`)
      await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${role}-${tab}.png`), fullPage: vp.name === '1280' })
    }
    if (role !== 'Admin') { await context.close(); continue }

    // 1. The chips on every tab, in order, and the total.
    let total = 0
    for (const [tab, expected] of Object.entries(CHIPS)) {
      await goto(page, `/participants/p-0001?tab=${tab}`)
      const labels = await chipLabels(page)
      total += labels?.length ?? 0
      check(`${vp.name} 1 ${tab} chips`, labels, JSON.stringify(labels) === JSON.stringify(expected))
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      check(`${vp.name} 1 ${tab} no horizontal page scroll`, overflow, overflow <= 0)
    }
    check(`${vp.name} 1 total chips`, total, total === 16)
    await goto(page, '/participants/p-0001?tab=agreements')
    check(`${vp.name} 1 agreements has no sub-strip`, await chipLabels(page), (await chipLabels(page)) === null)

    // 5. Health and Daily (1280; a column ending short above a full-width list is a ragged end, so only same-width cards count): on every chip no card is followed by more than 32px of empty space in its column, and no bare "Not recorded:" text.
    if (vp.name === '1280') for (const tab of ['health', 'daily']) {
      await goto(page, `/participants/p-0001?tab=${tab}`)
      const n = (await chipLabels(page)).length
      for (let i = 0; i < n; i++) {
        await page.evaluate((i) => {
          const strip = [...document.querySelectorAll('[role="tablist"]')].find((l) => l.getAttribute('aria-label') !== 'Participant sections')
          strip.querySelectorAll('[role="tab"]')[i].click()
        }, i)
        await page.waitForTimeout(400)
        const r = await page.evaluate(() => {
          const panel = document.querySelector('[role="tabpanel"]')
          const secs = [...panel.querySelectorAll('section[id]')].filter((s) => !s.parentElement.closest('section[id]')).map((s) => s.getBoundingClientRect())
          let worst = 0
          for (const a of secs) {
            const below = secs.filter((b) => b !== a && Math.abs(b.left - a.left) < 4 && b.top >= a.bottom - 1).sort((x, y) => x.top - y.top)[0]
            if (below && Math.abs(below.width - a.width) < 4) worst = Math.max(worst, Math.round(below.top - a.bottom))
          }
          const w = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT)
          let bare = 0
          for (let t = w.nextNode(); t; t = w.nextNode()) if (/Not recorded:/.test(t.textContent) && !t.parentElement.closest('.rounded-md')) bare++
          return { worst, bare }
        })
        check(`${vp.name} 5 ${tab} chip ${i} gap under a card`, r.worst, r.worst <= 32)
        check(`${vp.name} 5 ${tab} chip ${i} bare Not recorded`, r.bare, r.bare === 0)
      }
    }

    // 2. A nested section= selects the merged chip, keeps the URL as written, and brings the card into view.
    const nested = [
      ['about', 'about-me', 'Profile'],
      ['health', 'restrictive-practices', 'Risks & practices'],
      ['daily', 'transport-and-travel', 'Care & ADL'],
    ]
    for (const [tab, id, chip] of nested) {
      await goto(page, `/participants/p-0001?tab=${tab}&section=${id}`)
      await page.waitForTimeout(800)
      const r = await page.evaluate((id) => {
        const el = document.getElementById(id)
        const sel = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((t) => t.textContent.replace(/,\s.*$/, '').replace(/\d+$/, '').trim())
        return { url: location.search, sel, top: el ? Math.round(el.getBoundingClientRect().top) : null, vh: window.innerHeight }
      }, id)
      check(`${vp.name} 2 ${id} URL kept`, r.url, r.url === `?tab=${tab}&section=${id}`)
      check(`${vp.name} 2 ${id} chip selected`, r.sel, r.sel.includes(chip))
      check(`${vp.name} 2 ${id} card in view`, r.top, r.top !== null && r.top >= 0 && r.top < r.vh)
      if (id === 'restrictive-practices') await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-section-target.png`) })
    }

    // 3. Choosing a chip by hand does not scroll the page.
    await goto(page, '/participants/p-0001?tab=health')
    const before = await page.evaluate(() => Math.round(window.scrollY))
    await page.getByRole('tab', { name: /^Medications/ }).click()
    await page.waitForTimeout(500)
    const after = await page.evaluate(() => Math.round(window.scrollY))
    check(`${vp.name} 3 chip click keeps scroll`, { before, after }, Math.abs(after - before) <= 2)

    // 4. An old key lands on the merged chip.
    await goto(page, '/participants/p-0001?tab=rostering')
    check(`${vp.name} 4 ?tab=rostering lands on People > Roster`, page.url().includes('tab=people'), page.url().includes('tab=people'))
    await context.close()
  }
} catch (err) {
  failed = true
  console.error(`[participant-tabs] FAILED: ${err.message}`)
} finally {
  await browser.close()
}
for (const p of problems) { console.log(`[participant-tabs] WARNING ${p}`); lines.push(`WARNING ${p}`) }
writeFileSync(path.join(OUT_DIR, 'measure.txt'), lines.join('\n') + '\n')
process.exit(failed ? 1 : 0)
