// Fewer "Not recorded" labels: No plan recorded, Not set, the Type dash, the portal Fact dash, To do. Captures plus numeric checks (checks.json). Exit 1 on any failure.
// States: plan-budget-empty, my-provider-unknown, incident-rp-type-empty, portal-shift-before-empty, setup-steps-todo, setup-steps-todo-dark.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/not-recorded-tidy.mjs <outdir>
// Sign-in and the few routes each state changes are stubbed with page.route (synthetic data); everything else is the mock API's.
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
const provider = {
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Melbourne VIC 3000',
  state: 'VIC', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null, timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}
const D1 = 'Someone else changed this incident after you opened it. Cancel, then edit it again to see their changes.'
const UPDATED_AT = '2026-10-05T01:02:03.4567890Z'
const STAFF = [{ id: 'staff-4', fullName: 'Mei Zhang' }, { id: 'staff-2', fullName: 'Sam Okafor' }, { id: 'staff-3', fullName: 'Lee Tran' }]
const PARTICIPANTS = [{ id: 'participant-4', firstName: 'Grace', lastName: 'Palmer-Hughes', fullName: 'Grace Palmer-Hughes' }]

const base = (over = {}) => ({
  id: 'inc-1', serviceType: 'None', tripInstanceId: null, tripName: null, incidentType: 'Injury', otherTypeSpecify: null,
  severity: 'Medium', status: 'Open', title: 'Fall in the garden', incidentDateTime: '2026-10-03T08:00:00', location: 'Home',
  reportedByName: 'Mei Zhang', involvedParticipantId: 'participant-4', involvedParticipantName: 'Grace Palmer-Hughes', qscReportingStatus: 'NotRequired', isOverdue24h: false,
  createdAt: '2026-10-03T09:00:00Z', medicationAdministrationId: null, shiftId: null, shiftNoteId: null,
  participantBookingId: null, involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 'staff-4',
  restrictivePracticeType: null, restrictivePracticeId: null, restrictivePracticeDescription: null, restrictivePracticeReviewDate: null,
  unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: null,
  description: 'Grace slipped on the wet path and landed on her left side.', immediateActionsTaken: 'Checked for injury, applied ice and sat her down.', wereEmergencyServicesCalled: false, emergencyServicesDetails: null, emergencyServices: 'None',
  policeOfficerName: null, policeReference: null, ambulanceOfficerName: null, ambulanceReference: null, fireOfficerName: null, fireReference: null,
  witnessNames: null, witnessStatements: null,
  injuries: [{ id: 'inj-1', region: 'Head', injuryType: 'Bruise', description: 'Left side of the forehead' }],
  witnesses: [
    { id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Sam Okafor', isStaffWitness: true, witnessStatus: 'Approved', witnessRequestedAt: '2026-10-03T10:00:00Z', witnessRespondedAt: '2026-10-03T11:00:00Z', statementText: 'I saw Grace slip near the gate and helped her up.' },
    { id: 'w-2', witnessUserId: 'staff-3', witnessName: 'Lee Tran', isStaffWitness: true, witnessStatus: 'Pending', witnessRequestedAt: '2026-10-03T10:00:00Z', witnessRespondedAt: null, statementText: null },
    { id: 'w-3', witnessUserId: null, witnessName: 'Pat Neighbour', isStaffWitness: false, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null, statementText: null },
  ],
  qscReportedAt: null, qscReferenceNumber: null, awareAt: '2026-10-03T09:05:00Z', reportableClass: 'None', reportableClassReason: null,
  notifyDueAt: null, detailedReportDueAt: null, dueCountedWithoutHolidays: false,
  commissionDetailedReportedAt: null, commissionFinalReportRequested: false, commissionFinalReportedAt: null, timeZoneId: 'Australia/Sydney',
  reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null, resolvedAt: null,
  familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false, supportCoordinatorNotifiedAt: null,
  updatedAt: UPDATED_AT, medicationContext: null, shiftContext: null, shiftNoteContext: null,
  ...over,
})
const RP_EMPTY = base({ incidentType: 'RestrictivePracticeUse', injuries: [], restrictivePracticeType: null, unapprovedRestrictivePracticeDetails: 'Held both arms for about a minute while she was calmed.', isRestrictivePracticeAuthorised: false })
const SHIFT_ID = 'sh-next'
const W = 390

const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }
/** One failing state is reported and the run carries on. */
const state = async (name, fn) => { try { await fn() } catch (e) { check(`${name}: state reached`, false, String(e.message).slice(0, 200)) } }

async function openPage(browser, { role = 'Admin', username = 'dev.admin', width = W, touch = true, dark = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height: touch ? 844 : 900 }, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id, theme]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme })) } catch { /* storage blocked */ } }, ['00000000-0000-0000-0000-0000000000a1', dark ? 'dark' : 'light'])
  const page = await context.newPage()
  page.on('pageerror', (e) => check('page error', false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}
const go = (page, url) => page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
const noHScroll = async (page, ctx) => { const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`${ctx}: no horizontal scroll at ${W}`, o <= 0, o) }
const crop = async (page, locator, name) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, `${name}.png`), { touch: true, natural: true, pad: 12 })
  checks.push(checkCropHolds({ ...r, touch: true }))
}
/** WCAG contrast of an element's text on its own (or nearest opaque) background; colours are normalised through a canvas so oklch and color-mix read as rgb. */
const contrast = (locator) => locator.evaluate((el) => {
  const px = (css) => { const c = document.createElement('canvas').getContext('2d', { willReadFrequently: true }); c.canvas.width = c.canvas.height = 1; c.fillStyle = '#000'; c.clearRect(0, 0, 1, 1); c.fillStyle = css; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data] }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  let bg = [255, 255, 255], layers = []
  for (let n = el; n; n = n.parentElement) { const c = px(getComputedStyle(n).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] === 255) break }
  for (const c of layers.reverse()) bg = bg.map((v, i) => i < 3 ? Math.round(c[i] * c[3] / 255 + v * (1 - c[3] / 255)) : v)
  const fg = px(getComputedStyle(el).color)
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x)
  return { ratio: (a + 0.05) / (b + 0.05), fg, bg }
})
const MIN_CONTRAST = 4.5   // WCAG AA for small text, the house minimum
const plainColor = (locator) => locator.evaluate((el) => { const p = document.createElement('span'); p.style.color = 'var(--color-muted-foreground)'; document.body.append(p); const want = getComputedStyle(p).color; p.remove(); return { got: getComputedStyle(el).color, want } })

const browser = await chromium.launch({ headless: true })
try {
  // plan-budget-empty: the Profile wizard's budget phase for a participant with no plan on record.
  await state('plan-budget-empty', async () => {
    const { context, page } = await openPage(browser)
    await page.route(/\/api\/v1\/participants\/p-0002\/funding\/plans$/, (r) => r.fulfill({ json: envelope({ plans: [] }) }))
    await go(page, '/participants/p-0002/profile')
    // The budget card is on the wizard's first step (Key identifiers), so there is nothing to click through.
    const empty = page.getByText('No plan recorded', { exact: true })
    try { await empty.waitFor({ state: 'visible', timeout: 90_000 }) } catch (e) { throw new Error(page.url() + ' :: ' + (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160)) }
    await page.waitForTimeout(400)
    check('plan-budget-empty: the old word is gone from the card', (await page.getByText('Not recorded', { exact: true }).count()) === 0)
    await noHScroll(page, 'plan-budget-empty')
    await crop(page, empty.locator('xpath=ancestor::*[contains(@class,"rounded")][1]'), 'plan-budget-empty')
    await context.close()
  })

  // my-provider-unknown: the Funding tab's current plan with no my-provider record.
  await state('my-provider-unknown', async () => {
    const { context, page } = await openPage(browser)
    await go(page, '/participants/p-0002?tab=funding')
    const badge = page.getByText('Not set', { exact: true }).first()
    await badge.waitFor({ state: 'visible', timeout: 90_000 })
    await page.waitForTimeout(500)
    const m = await badge.evaluate((el) => {
      const sizeOf = (e) => Math.round(e.getBoundingClientRect().height * 100) / 100
      const twin = el.cloneNode(true); twin.textContent = 'Recorded'; el.parentElement.append(twin)
      const h = sizeOf(el), twinH = sizeOf(twin); twin.remove()
      const others = [...document.querySelectorAll('main span')].filter((s) => s !== el && s.className === el.className && s.children.length === 0).map(sizeOf)
      return { h, twinH, others }
    })
    check('my-provider-unknown: Not set badge height equals the same pill with another label, and is the sm pill height (16px line + 2 x 2px py-0.5 = 20)', Math.abs(m.h - m.twinH) < 0.5 && Math.abs(m.h - 20) < 0.5, JSON.stringify(m))
    const toneNeutral = await badge.evaluate((el) => el.className)
    check('my-provider-unknown: badge carries the neutral tone (TONE.neutral.solid classes)', toneNeutral.includes('--color-input') && toneNeutral.includes('--color-muted-foreground'), toneNeutral)
    const c = await contrast(badge)
    check(`my-provider-unknown: Not set contrast >= ${MIN_CONTRAST} (light)`, c.ratio >= MIN_CONTRAST, c.ratio.toFixed(2))
    await noHScroll(page, 'my-provider-unknown')
    await crop(page, page.getByText('My provider', { exact: true }).first().locator('xpath=..'), 'my-provider-unknown')
    await context.close()
  })

  // incident-rp-type-empty: the Restrictive practice card with no type chosen.
  await state('incident-rp-type-empty', async () => {
    const { context, page } = await openPage(browser)
    for (const glob of ['**/api/v1/trips*', '**/api/v1/restrictive-practices*', '**/api/v1/incidents/inc-1/status-history', '**/api/v1/participants/*/medications*']) await page.route(glob, (r) => r.fulfill({ json: envelope([]) }))
    await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope(provider) }))
    await page.route('**/api/v1/staff*', (r) => r.fulfill({ json: envelope(STAFF) }))
    await page.route('**/api/v1/participants**', (r) => r.fulfill({ json: envelope(PARTICIPANTS) }))
    await page.route('**/api/v1/incidents/inc-1', (r) => r.fulfill({ json: envelope(RP_EMPTY) }))
    await go(page, '/incidents/inc-1')
    const heading = page.getByRole('heading', { level: 3, name: 'Restrictive practice details' })
    await heading.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(500)
    const card = heading.locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
    const typeValue = await card.locator('dt', { hasText: /^Type$/ }).first().evaluate((dt) => dt.nextElementSibling?.textContent?.trim())
    check('incident-rp-type-empty: the Type row shows the dash', typeValue === '—', JSON.stringify(typeValue))
    check('incident-rp-type-empty: no "Not recorded" in the card', !(await card.innerText()).includes('Not recorded'))
    await noHScroll(page, 'incident-rp-type-empty')
    await crop(page, card, 'incident-rp-type-empty')
    await context.close()
  })

  // portal-shift-before-empty: a worker's next shift whose participant facts are all unset, at 390 and at desktop.
  await state('portal-shift-before-empty', async () => {
    for (const vp of [{ name: '390', width: W, touch: true }, { name: '1280', width: 1280, touch: false }]) {
      const { context, page } = await openPage(browser, { role: 'SupportWorker', username: 'dev.worker', width: vp.width, touch: vp.touch })
      const blank = (v) => Array.isArray(v) ? [] : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, blank(x)])) : null
      await page.route(`**/api/v1/portal/shifts/${SHIFT_ID}`, async (r) => {
        const response = await r.fetch()
        const body = await response.json()
        body.data.status = 'Published'
        body.data.atAGlance = blank(body.data.atAGlance)
        await r.fulfill({ response, json: body })
      })
      await go(page, `/portal/shifts/${SHIFT_ID}`)
      const sr = page.locator('dd .sr-only', { hasText: 'Not recorded' })
      await sr.first().waitFor({ state: 'attached', timeout: 90_000 })
      if (vp.touch) await page.getByRole('tab', { name: /^About/ }).click()
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))
      await page.waitForTimeout(500)
      const dash = page.locator('dd', { has: page.locator('.sr-only', { hasText: 'Not recorded' }) }).first().locator('span[aria-hidden="true"]')
      const col = await plainColor(dash)
      check(`portal-shift-before-empty (${vp.name}): the dash uses --color-muted-foreground, the FactList dash colour`, col.got === col.want, JSON.stringify(col))
      check(`portal-shift-before-empty (${vp.name}): the dash text is a dash and the sr-only name is Not recorded`, (await dash.innerText()) === '—' && (await sr.first().innerText()) === 'Not recorded')
      check(`portal-shift-before-empty (${vp.name}): no visible "Not recorded" words`, (await page.locator('dd').evaluateAll((els) => els.filter((e) => { const c = e.cloneNode(true); c.querySelectorAll('.sr-only').forEach((s) => s.remove()); return c.textContent.includes('Not recorded') }).length)) === 0)
      await noHScroll(page, `portal-shift-before-empty (${vp.name})`)
      if (vp.touch) await crop(page, page.locator('dd', { has: page.locator('.sr-only', { hasText: 'Not recorded' }) }).first().locator('xpath=ancestor::dl[1]/..'), 'portal-shift-before-empty')
      mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })
      const full = await fullPage(page, path.join(OUT_DIR, 'full', `portal-shift-${vp.name}.png`), { touch: vp.touch })
      checks.push(...full.checks)
      await context.close()
    }
  })

  // setup-steps-todo (light) and setup-steps-todo-dark: Organisation setup with the details missing.
  for (const dark of [false, true]) {
    const name = dark ? 'setup-steps-todo-dark' : 'setup-steps-todo'
    await state(name, async () => {
      const { context, page } = await openPage(browser, { dark })
      await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope({ ...provider, address: '' }) }))
      await go(page, '/settings?section=setup')
      const badge = page.getByText('To do', { exact: true }).first()
      await badge.waitFor({ state: 'visible', timeout: 90_000 })
      await page.waitForTimeout(500)
      check(`${name}: the old word is gone from the setup rows`, (await page.getByText('Not recorded', { exact: true }).count()) === 0)
      check(`${name}: page is in the ${dark ? 'dark' : 'light'} scheme`, (await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)) === dark)
      const c = await contrast(badge)
      check(`${name}: To do contrast >= ${MIN_CONTRAST}`, c.ratio >= MIN_CONTRAST, `${c.ratio.toFixed(2)} fg ${c.fg} bg ${c.bg}`)
      await noHScroll(page, name)
      await crop(page, badge.locator('xpath=ancestor::li[1]'), name)
      await context.close()
    })
  }
} finally {
  await browser.close()
}
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
