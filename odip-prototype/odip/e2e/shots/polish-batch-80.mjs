// Polish batch 80: the open Deleted records detail reads in words with no bare id (PB76-F3), and a hovered disabled row action keeps its resting colour (PB78-O1).
// Numeric: no label in the open detail matches /[a-z][A-Z]/ and the labels are exactly Date, Start, End, Notes; no text in the detail matches a GUID; "Open participant" is present with an href ending in the participant id;
// the helper's layout checks pass on the full Settings page at both widths; on Patterns at 1280 the disabled "Generate shifts" icon colour is the same hovered as at rest and is not rgb(57, 98, 0), while the enabled "Edit" sibling hovered reads rgb(57, 98, 0).
// Sign-in, GET /audit/deleted and GET /rostering/patterns are answered in the script. Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-80.mjs <outdir>
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const NOW = new Date('2026-11-10T12:00:00+11:00')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])

// Deleted records: the Shift row holds a GUID participant and a GUID staff member beside its readable values.
const held = (o) => Object.entries(o).map(([field, old]) => ({ field, old, new: null }))
const PID = '00000000-0000-0000-0000-0000000000c1'
const SID = '3f2b8c1e-5a47-4d0e-9b6a-1c2d3e4f5a6b'
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const DELETED = [
  { id: 'd1', entityType: 'Shift', entityId: 'e-d1', deletedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(), deletedByName: 'Sam Lee', fields: held({ ServiceDate: '2026-11-10', StartTime: '09:00:00', EndTime: '15:00:00', ParticipantId: PID, StaffId: SID, Notes: 'Community access' }) },
  { id: 'd2', entityType: 'ParticipantRiskEntry', entityId: 'e-d2', deletedAt: new Date(NOW.getTime() - 90 * 60_000).toISOString(), deletedByName: 'Priya Nair', fields: held({ Description: 'Choking risk at mealtimes', Severity: 'High', ParticipantId: PID }) },
]
const CHROME_GREEN = 'rgb(57, 98, 0)'

const checks = []
const check = (name, pass, detail = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail)
  checks.push({ name, pass: !!pass, detail: d })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${d}`)
}

async function signIn(page, role, username) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}
async function newPage(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  return { context, page }
}
const crop = async (page, locator, name, vp, pad = 24) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}

// The labels in the open detail (FieldDiff: a flex row whose first child is the label) and its whole text.
const detailOf = (page) => page.evaluate(() => {
  const d = document.querySelector('[id^="deleted-detail-"]')
  const labels = [...d.querySelectorAll('[class~="@container"]')].map((c) => c.firstElementChild.children[0].textContent.trim())
  return { labels, text: d.textContent, hrefs: [...d.querySelectorAll('a')].map((a) => ({ name: a.textContent.trim(), href: a.getAttribute('href') })) }
})

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
try {
  // Deleted records: the Shift row's detail open
  for (const vp of VPS) {
    const t = (n) => `${vp.name}: ${n}`
    try {
      const { context, page } = await newPage(browser, vp)
      await page.route('**/api/v1/audit/deleted**', (r) => r.fulfill({ json: envelope({ items: DELETED, totalCount: DELETED.length, page: 1, pageSize: 25 }) }))
      await signIn(page, 'Admin', 'dev.admin')
      await page.goto(`${BASE_URL}/settings?section=deleted-records`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByText('Choking risk at mealtimes').first().waitFor({ state: 'visible', timeout: 60_000 })
      await page.getByRole('button', { name: /^Show details for/ }).first().click()
      const detail = page.locator('[id^="deleted-detail-"]').first()
      await detail.waitFor({ state: 'visible', timeout: 20_000 })
      await page.waitForTimeout(400)
      const m = await detailOf(page)
      check(t('deleted: the detail lists 4 fields'), m.labels.length === 4, m.labels)
      check(t('deleted: no label matches /[a-z][A-Z]/'), m.labels.length > 0 && !m.labels.some((l) => /[a-z][A-Z]/.test(l)), m.labels)
      check(t('deleted: the labels are Date, Start, End, Notes'), m.labels.join(',') === 'Date,Start,End,Notes', m.labels)
      check(t('deleted: no text in the detail matches a GUID'), !GUID.test(m.text), m.text.match(GUID))
      const link = m.hrefs.find((a) => a.name === 'Open participant')
      check(t('deleted: "Open participant" is present and goes to the participant'), link && link.href.endsWith(`/participants/${PID}`), m.hrefs)
      const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check(t('deleted: no horizontal scroll'), o <= 0, o)
      await crop(page, detail, `deleted-details-${vp.name}.png`, vp)
      // The shell grows with the viewport on desktop, so grow the viewport until the page fits it before fullPage measures.
      for (let i = 0; i < 4 && !vp.touch; i++) {
        const h = await page.evaluate(() => document.scrollingElement.scrollHeight)
        if (h <= page.viewportSize().height) break
        await page.setViewportSize({ width: vp.width, height: h })
        await page.waitForTimeout(300)
      }
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `deleted-page-${vp.name}.png`), { touch: vp.touch })).checks)
      await context.close()
    } catch (e) { check(t('deleted ran'), false, String(e.message).split('\n')[0]) }
  }

  // Patterns at 1280: the second pattern reads inactive, so its "Generate shifts" is disabled.
  const vp = VPS[0]
  try {
    const { context, page } = await newPage(browser, vp)
    await page.route('**/api/v1/rostering/patterns*', async (r) => {
      if (r.request().method() !== 'GET') return r.continue()
      const res = await r.fetch()
      const body = await res.json()
      if (Array.isArray(body?.data) && body.data.length > 1) body.data[1] = { ...body.data[1], isActive: false }
      return r.fulfill({ response: res, json: body })
    })
    await signIn(page, 'Coordinator', 'dev.coordinator')
    await page.goto(`${BASE_URL}/rostering/patterns`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const inactive = page.locator('tbody tr', { hasText: 'Grace Palmer-Hughes' }).first()
    await inactive.waitFor({ state: 'visible', timeout: 60_000 })
    const generate = inactive.getByRole('button', { name: /^Generate shifts for / })
    const edit = inactive.getByRole('button', { name: /^Edit / })
    const paint = (loc) => loc.evaluate((el) => ({ button: getComputedStyle(el).color, icon: getComputedStyle(el.querySelector(':scope > svg')).color, bg: getComputedStyle(el).backgroundColor }))
    await page.mouse.move(2, 2)
    await page.waitForTimeout(300)
    const rest = await paint(generate)
    check('1280: the "Generate shifts" button is aria-disabled', (await generate.getAttribute('aria-disabled')) === 'true', rest)
    let hovered
    const shot = await cropElement(page, inactive, path.join(OUT_DIR, 'rowmenu-disabled-hover-1280.png'), {
      touch: false, hideChrome: true, pad: 16,
      during: async () => { await generate.hover(); await page.waitForTimeout(300); hovered = await paint(generate) },
    })
    checks.push(checkCropHolds({ ...shot, touch: false }))
    check('1280: hovered, the disabled icon colour equals its resting colour', hovered.icon === rest.icon && hovered.button === rest.button, { rest, hovered })
    check(`1280: hovered, the disabled icon is not ${CHROME_GREEN}`, hovered.icon !== CHROME_GREEN && hovered.button !== CHROME_GREEN, hovered)
    check('1280: hovered, the disabled background stays clear', hovered.bg === 'rgba(0, 0, 0, 0)', hovered)
    await edit.hover()
    await page.waitForTimeout(300)
    const sibling = await paint(edit)
    check(`1280: control, the enabled "Edit" sibling hovered reads ${CHROME_GREEN}`, sibling.icon === CHROME_GREEN, sibling)
    await context.close()
  } catch (e) { check('1280: rowmenu ran', false, String(e.message).split('\n')[0]) }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
