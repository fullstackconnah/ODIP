// Provider-zone dates: with the device in Los Angeles, every date the app shows must be the PROVIDER's day. Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/provider-zone-dates.mjs <outdir>
// The mock API serves no provider zone (timeZoneId is absent), and the app then keeps the viewer's zone by design, so provider-settings is wrapped
// to add timeZoneId (below) and nothing else. Instants are read from the responses the page itself loaded; no record is created or seeded.
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

const DEVICE_ZONE = 'America/Los_Angeles'
const PROVIDER_ZONE = 'Australia/Sydney' // added to the mock's provider-settings below
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const out = (f) => path.join(OUT_DIR, f)
let differNo = 0, differYes = 0
const skipped = []

// day parts of an instant in a zone, in the app's en-AU forms: 10/08/2026 or 10 Aug (the claims hub writes "10 Aug 2026" and may drop the year)
const parts = (iso, tz) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  const num = new Intl.DateTimeFormat('en-AU', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso))
  return { num, d: String(Number(p.day)), mon: p.month.slice(0, 3) }
}
const shows = (text, pt) => text.includes(pt.num) || new RegExp(`\\b0?${pt.d}\\s+${pt.mon}[a-z]*\\b`, 'i').test(text)

function record(screen, iso, shown) {
  const pd = parts(iso, PROVIDER_ZONE), dd = parts(iso, DEVICE_ZONE)
  const differ = pd.num !== dd.num
  const pass = shows(shown, pd) && (!differ || !shows(shown, dd))
  if (differ) differYes++; else differNo++
  const line = `CHECK ${screen} instant=${iso} shown="${shown.replace(/\s+/g, ' ').trim()}" providerDay=${pd.num} deviceDay=${dd.num} differ=${differ ? 'yes' : 'no'} ${pass ? 'PASS' : 'FAIL'}`
  console.log(line)
  checks.push({ name: line, pass, detail: '' })
}

async function openPage(browser, vp) {
  const context = await browser.newContext({ locale: 'en-AU', timezoneId: DEVICE_ZONE, viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const seen = new Map() // pathname -> { status, body } of the latest /api/v1 response the page loaded
  page.on('response', async (r) => {
    const u = new URL(r.url())
    if (!u.pathname.startsWith('/api/v1/') || r.request().method() !== 'GET') return
    const body = await r.json().catch(() => null)
    seen.set(u.pathname, { status: r.status(), body })
  })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }) }))
  await page.route('**/api/v1/provider-settings', async (r) => {
    if (r.request().method() !== 'GET') return r.fallback()
    const res = await r.fetch()
    const j = await res.json()
    j.data = { ...j.data, timeZoneId: PROVIDER_ZONE }
    return r.fulfill({ response: res, json: j })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page, seen }
}
const go = async (page, url, ready) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await ready.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(400)
}
const crop = async (page, loc, file) => { const r = await cropElement(page, loc, out(file), { pad: 16 }); checks.push({ name: `crop holds: ${file}`, pass: r.overlap.pass, detail: r.overlap.detail }) }
const bodyOf = (seen, p) => { const b = seen.get(p)?.body; return b?.data ?? b }

const browser = await chromium.launch({ headless: true })
try {
  const { context, page, seen } = await openPage(browser, { width: 1280, height: 900 })
  // 1. Claim detail: Created / Submitted / Rejected (claim-0003 is rejected, so all three show)
  {
    const id = 'claim-0003'
    await go(page, `/claims/${id}`, page.getByText('Rejected').first())
    const zoneServed = bodyOf(seen, '/api/v1/provider-settings')?.timeZoneId // read once a page that uses it has loaded
    console.log(`PROVIDER-ZONE ${zoneServed ?? 'none'} (device ${await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)})`)
    checks.push({ name: 'page loaded provider-settings with the provider zone', pass: zoneServed === PROVIDER_ZONE, detail: zoneServed })
    const claim = bodyOf(seen, `/api/v1/claims/${id}`)
    for (const [label, key] of [['Created', 'createdAt'], ['Submitted', 'submittedDate'], ['Rejected', 'rejectedDate']]) {
      const loc = page.locator('div, li, dd, span').filter({ hasText: new RegExp(`^${label}\\s*\\d`) }).last()
      await crop(page, loc, `claim-detail-${label.toLowerCase()}.png`)
      record(`claim-detail.${label}`, claim[key], await loc.innerText())
    }
    const f = await fullPage(page, out('full/claim-detail-1280.png'), { touch: false })
    checks.push(...f.checks)
  }

  // 2. Claims hub, Files panel: the Built date of every file row the page shows
  {
    await go(page, '/claims?tab=files', page.locator('td[data-label="Built"]').first())
    const batches = bodyOf(seen, '/api/v1/claim-batches') ?? []
    let first = true
    for (const b of batches) {
      const row = page.locator('tbody tr').filter({ hasText: b.fileName }).first()
      if (!(await row.count())) { skipped.push(`files row ${b.fileName} not on the page`); continue }
      if (first) { await crop(page, row, 'claims-files-built.png'); first = false }
      record(`claims-files.Built(${b.fileName})`, b.createdAt, await row.locator('td[data-label="Built"]').innerText())
    }
  }

  // 3. Audit History tab (trip t-0004, admin only): the day is in each time's title, the visible text is relative
  {
    await go(page, '/trips/t-0004?tab=history', page.locator('span.cursor-help').first())
    const audit = bodyOf(seen, '/api/v1/audit/TripInstance/t-0004')
    const entries = audit.entries ?? []
    const stamps = page.locator('span.cursor-help')
    await crop(page, stamps.first().locator('xpath=..'), 'audit-history-row.png')
    for (let i = 0; i < entries.length; i++) record(`audit-history.row${i + 1}`, entries[i].changedAt, (await stamps.nth(i).getAttribute('title')) ?? '')
  }

  // 4. Settings, Deleted records: only when the mock serves rows (it has no /audit/deleted route, so this normally skips)
  {
    await page.goto(`${BASE_URL}/settings?section=deleted-records`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForTimeout(2500)
    const del = seen.get('/api/v1/audit/deleted')
    const items = del?.body?.data?.items ?? []
    if (!items.length) skipped.push(`deleted-records: no seeded row (audit/deleted status ${del?.status ?? 'not requested'})`)
    else for (let i = 0; i < items.length; i++) record(`deleted-records.row${i + 1}`, items[i].deletedAt, await page.locator('tbody tr:not([data-row-detail])').nth(i).locator('td[data-label="Deleted"]').innerText())
  }
  skipped.push('settings integrations / data export: the mock has no route for the connection or the last export, so no seeded date')

  // 390 touch: one full page of the first screen, touch kept
  await context.close()
  const m = await openPage(browser, { width: 390, height: 844, touch: true })
  await go(m.page, '/claims/claim-0003', m.page.getByText('Rejected').first())
  const fm = await fullPage(m.page, out('full/claim-detail-390.png'), { touch: true })
  checks.push(...fm.checks)
  await m.context.close()
} catch (e) {
  checks.push({ name: 'script ran to the end', pass: false, detail: String(e.stack ?? e).split('\n').slice(0, 4).join(' | ') })
  console.log('SCRIPT-ERROR', String(e.message).split('\n')[0])
}
await browser.close()
checks.push({ name: 'at least one element where provider day and device day differ', pass: differYes > 0, detail: { differYes, differNo } })
const fails = checks.filter((c) => !c.pass).length
console.log(`COUNTS dateChecks=${differYes + differNo} differ_yes=${differYes} differ_no=${differNo} failedChecks=${fails} skipped=${skipped.length}`)
for (const s of skipped) console.log(`SKIPPED ${s}`)
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
