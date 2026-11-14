// Claim detail at phone width: the Line Items card fills its container, the breadcrumb stays within two lines, 1280 is measured for the before/after.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/claim-detail-390.mjs <outdir>
// Prints `CHECK <name> pass|fail <measured>` lines; exit 1 on any failed check. States: normal-390 (claim-0003, a shift claim), long-name-390
// (the same claim as a Trip claim carrying the longest trip name the mock has, patched on the response only), normal-1280.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { prepareOutDir, cropElement, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const out = (f) => path.join(OUT_DIR, f)
const LONGEST_TRIP = 'Toowoomba Carnival of Flowers' // the longest tripName in mock-api/server.js

function check(name, pass, measured) {
  console.log(`CHECK ${name} ${pass ? 'pass' : 'fail'} ${JSON.stringify(measured)}`)
  checks.push({ name, pass, detail: measured })
}

async function openPage(browser, vp, longName) {
  const context = await browser.newContext({ locale: 'en-AU', timezoneId: 'Australia/Sydney', viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }) }))
  if (longName) {
    await page.route('**/api/v1/claims/claim-0003', async (r) => {
      if (r.request().method() !== 'GET') return r.fallback()
      const res = await r.fetch()
      const j = await res.json()
      j.data = { ...j.data, kind: 'Trip', tripInstanceId: 't-0003', tripName: LONGEST_TRIP }
      return r.fulfill({ response: res, json: j })
    })
  }
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/claims/claim-0003`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('heading', { name: 'Line Items' }).waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(500)
  return { context, page }
}

// Everything numeric, read in the page.
const measure = (page) => page.evaluate(() => {
  const card = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Line Items').parentElement.parentElement
  const parent = card.parentElement, ps = getComputedStyle(parent)
  const crumb = document.querySelector('main a[href="/trips"]').parentElement, cs = getComputedStyle(crumb)
  const probe = Object.assign(document.createElement('div'), { style: 'height:var(--tap-min);position:absolute;visibility:hidden' })
  document.body.append(probe)
  const tapMin = probe.getBoundingClientRect().height
  probe.remove()
  // a link's hit area: its box, or the taller transparent ::before the coarse-pointer utility adds
  const hit = (a) => Math.max(a.getBoundingClientRect().height, parseFloat(getComputedStyle(a, '::before').height) || 0)
  // the phone card list: the first row card against the table's scroll wrapper (the defect left it at 280 of 358)
  const row = card.querySelector('tbody tr'), wrap = row?.closest('table').parentElement
  const d = document.documentElement
  return {
    cardWidth: card.getBoundingClientRect().width,
    parentContent: parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight),
    rowWidth: row?.getBoundingClientRect().width ?? null, rowParent: wrap?.clientWidth ?? null,
    scrollWidth: d.scrollWidth, clientWidth: d.clientWidth,
    crumbHeight: crumb.getBoundingClientRect().height, crumbLineHeight: parseFloat(cs.lineHeight),
    tapMin, linkHits: [...crumb.querySelectorAll('a')].map((a) => ({ text: a.textContent.trim(), hit: hit(a) })),
  }
})

const widthChecks = (label, m) => {
  check(`${label} line-items-card-fills-container`, Math.abs(m.cardWidth - m.parentContent) <= 1, { cardWidth: m.cardWidth, parentContent: m.parentContent })
  check(`${label} line-item-row-card-fills-its-container`, m.rowWidth != null && Math.abs(m.rowWidth - m.rowParent) <= 1, { rowWidth: m.rowWidth, container: m.rowParent })
  check(`${label} no-sideways-page-scroll`, m.scrollWidth <= m.clientWidth, { scrollWidth: m.scrollWidth, clientWidth: m.clientWidth })
  check(`${label} breadcrumb-at-most-two-lines`, m.crumbHeight <= 2 * m.crumbLineHeight + 1, { height: m.crumbHeight, lineHeight: m.crumbLineHeight })
  check(`${label} touched-tap-targets-at-least-tap-min`, m.linkHits.every((l) => l.hit >= m.tapMin), { tapMin: m.tapMin, links: m.linkHits })
}
const crop = async (page, loc, file) => { const r = await cropElement(page, loc, out(file), { pad: 16, natural: true }); checks.push({ name: `crop holds: ${file}`, pass: r.overlap.pass, detail: r.overlap.detail }) }
const crops = async (page, label) => {
  await crop(page, page.locator('main a[href="/trips"]').first().locator('xpath=..'), `breadcrumb-${label}.png`)
  await crop(page, page.getByRole('heading', { name: 'Line Items' }).locator('xpath=../..'), `line-items-${label}.png`)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const [label, longName] of [['normal-390', false], ['long-name-390', true]]) {
    const { context, page } = await openPage(browser, { width: 390, height: 844, touch: true }, longName)
    widthChecks(label, await measure(page))
    await crops(page, label)
    if (!longName) { const f = await fullPage(page, out('full/claim-detail-390.png'), { touch: true }); checks.push(...f.checks) }
    await context.close()
  }
  const { context, page } = await openPage(browser, { width: 1280, height: 900 }, false)
  const m = await measure(page)
  // the before/after pair: compare this line with the run on the base commit
  check('normal-1280 numbers (compare with base)', true, { rowWidth: m.rowWidth, rowParent: m.rowParent, cardWidth: m.cardWidth, parentContent: m.parentContent, breadcrumbHeight: m.crumbHeight })
  check('normal-1280 breadcrumb-one-line', m.crumbHeight <= 2 * m.crumbLineHeight + 1, { height: m.crumbHeight, lineHeight: m.crumbLineHeight })
  await crops(page, 'normal-1280')
  const f = await fullPage(page, out('full/claim-detail-1280.png'), { touch: false })
  checks.push(...f.checks)
  await context.close()
} catch (e) {
  checks.push({ name: 'script ran to the end', pass: false, detail: String(e.stack ?? e).split('\n').slice(0, 4).join(' | ') })
  console.log('SCRIPT-ERROR', String(e.message).split('\n')[0])
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
