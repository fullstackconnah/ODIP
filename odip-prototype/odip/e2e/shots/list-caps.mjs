// Lists past 200 rows: the Plan- and self-managed tab's server paging, the New claim trip count and hint, and the complaint form's incident hint.
// Captures plus numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/list-caps.mjs <outdir>
// Sign-in is stubbed with page.route; the three lists are stubbed with synthetic rows (120 managed claims, 214 trips, 214 incidents).
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
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const NOW = new Date('2026-11-04T23:00:00Z')
const paged = (items, totalCount, page, pageSize) => envelope({ items, totalCount, page, pageSize, totalPages: Math.ceil(totalCount / pageSize), hasNext: page * pageSize < totalCount, hasPrevious: page > 1 })

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

const MANAGED_TOTAL = 120
const managedRow = (n) => ({
  claimId: `m-${n}`, claimReference: `TC-${String(n).padStart(3, '0')}`, participantId: `p-${n}`, participantName: `Participant ${n}`, fundingType: n % 2 ? 'plan' : 'self',
  claimStatus: 'Submitted', totalAmount: 100 + n, ageDays: n % 40, ageBand: 'none',
  invoices: n % 3 ? [{ invoiceId: `i-${n}`, number: `INV-${1000 + n}`, status: 'Issued', total: 100 + n, issueDate: '2026-10-20' }] : [],
})
const tripRow = (n) => ({
  id: `t-${n}`, tripName: `Group trip ${n}`, tripCode: null, destination: null, region: null, startDate: '2026-10-09', endDate: '2026-10-11', durationDays: 3, status: 'Completed',
  maxParticipants: null, currentParticipantCount: 4, waitlistCount: 0, leadCoordinatorName: null,
})
const incidentRow = (n) => ({ id: `inc-${n}`, title: `Incident ${n}`, incidentDateTime: '2026-10-02T09:00:00', involvedParticipantId: null })

async function openPage(browser, vp, { role = 'Admin', username = 'dev.admin' } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(NOW)
  return { context, page }
}

// Every list the three screens read, stubbed. `managed` decides the answer for /claim-hub/managed.
async function stub(page, { managed } = {}) {
  await page.route('**/api/v1/claim-hub/lines', (r) => r.fulfill({ json: envelope({ ready: [], rejected: [], registrationProblem: null }) }))
  await page.route('**/api/v1/claim-hub/managed*', (r) => {
    const u = new URL(r.request().url())
    const answer = managed ? managed(u.searchParams) : null
    if (answer === 'error') return r.fulfill({ status: 500, json: { success: false, data: null, message: 'boom', errors: ['boom'] } })
    const page_ = Number(u.searchParams.get('page') ?? '1'), size = Number(u.searchParams.get('pageSize') ?? '50')
    const funding = u.searchParams.get('funding')
    const all = Array.from({ length: answer === 'empty' ? 0 : MANAGED_TOTAL }, (_, i) => managedRow(i + 1))
    const rows = funding === 'self' ? [] : all
    return r.fulfill({ json: paged(rows.slice((page_ - 1) * size, page_ * size), rows.length, page_, size) })
  })
  await page.route((url) => url.pathname === '/api/v1/trips' && url.searchParams.get('unclaimed') === 'true', (r) =>
    r.fulfill({ json: paged(Array.from({ length: 200 }, (_, i) => tripRow(i + 1)), 214, 1, 200) }))
  await page.route((url) => url.pathname === '/api/v1/incidents', (r) =>
    r.fulfill({ json: paged(Array.from({ length: 200 }, (_, i) => incidentRow(i + 1)), 214, 1, 200) }))
}

const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.scrollingElement.scrollWidth - innerWidth)
  check(`${ctx}: no horizontal scroll`, o <= 0, o)
}
const crop = async (page, locator, name, vp) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad: 8 })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
// A hint stays inside its field, wraps, and reports its font size (compared across the two screens below).
const hintChecks = async (hint, ctx) => {
  const m = await hint.evaluate((el) => {
    const field = el.parentElement.getBoundingClientRect(), box = el.getBoundingClientRect(), cs = getComputedStyle(el)
    return { right: box.right, fieldRight: field.right, whiteSpace: cs.whiteSpace, fontSize: parseFloat(cs.fontSize) }
  })
  check(`${ctx}: hint inside its field`, m.right <= m.fieldRight + 0.5, `${m.right} <= ${m.fieldRight}`)
  check(`${ctx}: hint is not nowrap`, m.whiteSpace !== 'nowrap', m.whiteSpace)
  return m.fontSize
}
const stepOpen = async (page, label) => {
  const el = page.getByText(label).first()
  await el.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(400)
  return el
}

const VPS = [{ name: '1440', width: 1440, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const tag = vp.name

  // managed-*: the Plan- and self-managed tab
  try {
    const { context, page } = await openPage(browser, vp)
    await stub(page)
    await page.goto(`${BASE_URL}/claims?tab=other`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const panel = page.getByTestId('claims-panel-other')
    await panel.waitFor({ state: 'visible', timeout: 60_000 })
    await page.getByText(/Showing 1-50 of 120/).waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)
    check(t('managed-page1: the pager shows the total, 120'), await page.getByText('Showing 1-50 of 120').isVisible())
    await noHScroll(page, t('managed-page1'))
    if (vp.touch) {
      const heights = await panel.evaluate((el) => [...el.querySelectorAll('button[aria-label$=" page"]')].map((b) => Math.max(b.getBoundingClientRect().height, parseFloat(getComputedStyle(b, '::before').height) || 0)))
      check(t('managed-page1: pager buttons at least 44 high'), heights.length === 2 && heights.every((h) => h >= 43.5), heights)
    }
    await crop(page, panel, `managed-page1-${tag}.png`, vp)
    if (vp.touch) {
      await page.getByRole('button', { name: 'Next page' }).click()
      await page.getByText('Showing 51-100 of 120').waitFor({ state: 'visible', timeout: 20_000 })
      await page.getByRole('button', { name: 'Next page' }).click()
      await page.getByText('Showing 101-120 of 120').waitFor({ state: 'visible', timeout: 20_000 })
      await page.waitForTimeout(400)
      check(t('managed-page3: last page reads 101-120 of 120'), await page.getByText('Showing 101-120 of 120').isVisible())
      await noHScroll(page, t('managed-page3'))
      await crop(page, panel, `managed-page3-${tag}.png`, vp)

      await panel.getByRole('button', { name: /Both/ }).click()
      await page.getByRole('option', { name: 'Self-managed' }).click()
      const none = page.getByText('No claims match. Show both funding types.')
      await none.waitFor({ state: 'visible', timeout: 20_000 })
      await page.waitForTimeout(400)
      check(t('managed-selfnomatch: the filter message shows'), await none.isVisible())
      await noHScroll(page, t('managed-selfnomatch'))
      await crop(page, panel, `managed-selfnomatch-${tag}.png`, vp)
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `full-managed-${tag}.png`), { touch: vp.touch })).checks)
    await context.close()
  } catch (e) { check(t('managed ran'), false, String(e.message).split('\n')[0]) }

  {
    for (const [state, answer, ready] of [['managed-empty', 'empty', 'No plan- or self-managed claims'], ['managed-error', 'error', null]].filter(([s]) => vp.touch || s === 'managed-error')) {
      try {
        const { context, page } = await openPage(browser, vp)
        await stub(page, { managed: () => answer })
        await page.goto(`${BASE_URL}/claims?tab=other`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        const panel = page.getByTestId('claims-panel-other')
        await panel.waitFor({ state: 'visible', timeout: 60_000 })
        const marker = ready ? panel.getByText(ready) : panel.getByRole('button', { name: /Try again/ })
        await marker.waitFor({ state: 'visible', timeout: 60_000 })
        await page.waitForTimeout(400)
        check(t(`${state}: its message shows`), await marker.isVisible())
        if (answer === 'error') check(t('managed-error: reads the claim list sentence'), await panel.getByText("Couldn't load this claim list.").isVisible())
        await noHScroll(page, t(state))
        await crop(page, panel, `${state}-${tag}.png`, vp)
        await context.close()
      } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
    }
  }

  // newclaim-choose, newclaim-trip: the chooser's count and the trip step's hint
  const fonts = {}
  try {
    const { context, page } = await openPage(browser, vp)
    await stub(page)
    await page.goto(`${BASE_URL}/claims`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'New claim' }).click()
    const dialog = page.getByRole('dialog', { name: 'New claim' })
    const count = dialog.getByText('214 waiting', { exact: true })
    await count.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)
    check(t('newclaim-choose: the trip count reads exactly "214 waiting"'), await count.isVisible())
    await noHScroll(page, t('newclaim-choose'))
    await crop(page, dialog, `newclaim-choose-${tag}.png`, vp)
    await dialog.getByRole('button', { name: /^A trip/ }).click()
    const trip = page.getByRole('dialog', { name: 'Choose a trip' })
    const hint = trip.getByText("Showing the 200 most recent of 214 completed trips. Claim an older one from its trip's Claims tab.")
    await hint.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)
    fonts.trip = await hintChecks(hint, t('newclaim-trip'))
    await noHScroll(page, t('newclaim-trip'))
    await crop(page, trip, `newclaim-trip-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('newclaim ran'), false, String(e.message).split('\n')[0]) }

  // complaint-incident: the incident field's hint
  try {
    const { context, page } = await openPage(browser, vp)
    await stub(page)
    await page.goto(`${BASE_URL}/complaints/new`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const hint = page.getByText(/Showing the latest 200 of 214 incidents not yet closed\. Search looks through these only\./)
    await hint.waitFor({ state: 'visible', timeout: 60_000 })
    await hint.scrollIntoViewIfNeeded()
    await page.waitForTimeout(400)
    fonts.complaint = await hintChecks(hint, t('complaint-incident'))
    await noHScroll(page, t('complaint-incident'))
    await crop(page, hint.locator('xpath=ancestor::div[1]'), `complaint-incident-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('complaint ran'), false, String(e.message).split('\n')[0]) }
  check(t('both hints use the same font size'), fonts.trip && fonts.trip === fonts.complaint, JSON.stringify(fonts))
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
