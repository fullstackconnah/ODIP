// Polish batch 5: RetryCallout button position (R7), no Try again on an unconfirmed auto-roster apply (AR1), Cancel disabled while an incident review saves (INC1),
// Checks column min width (CK1). Numeric checks come from polish-batch-5/PICK.md; computed boxes only. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/polish-batch-5.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, fullPage, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const failEnvelope = (message) => ({ success: false, data: null, message, errors: [message] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' })

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} = ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}
let lastPage
const safe = async (name, fn) => {
  try { await fn() } catch (e) {
    let seen = ''
    try { seen = `${lastPage.url()} :: bad ${JSON.stringify(lastPage.bad ?? [])} :: ${(await lastPage.locator('main').first().innerText({ timeout: 3000 })).replace(/\s+/g, ' ').slice(0, 400)}` } catch {}
    check(`${name} (script error)`, false, `${String(e.message).split('\n')[0]} | ${seen}`)
  }
}
const within = (a, b, tol) => Math.abs(a - b) <= tol

const browser = await chromium.launch({ headless: true })

async function openPage(context, touchCdp) {
  const page = await context.newPage()
  const pinCoarse = async () => {
    if (!touchCdp) return
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.pinCoarse = pinCoarse
  await pinCoarse()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  return page
}
const gotoReady = async (page, url, dark) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  lastPage = page
  if (!page.bad) { page.bad = []; page.on('response', (r) => { if (r.status() >= 400 && page.bad.length < 6) page.bad.push(`${r.status()} ${r.url().replace(BASE_URL, '')}`) }) }
  await page.locator('main, form').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  if (dark) await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.pinCoarse()
  await page.waitForTimeout(800)
}
const noOverflow = async (page, label) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  check(`no horizontal scroll (${label})`, o.sw <= o.iw, o)
}
const crop = async (page, vp, name, locator, pad = 16) => {
  const touch = !!vp.touch
  checks.push(checkCropHolds(await cropElement(page, locator, path.join(OUT_DIR, `${name}.png`), { pad, touch, natural: false })))
}

// R7: the page error banner on the incidents page (the trend card's RetryCallout, warning tone); the trend request fails, is held while pending, then fails again.
async function retryCallout(page, vp, scheme) {
  const tag = `R7 ${vp.name}${scheme === 'dark' ? ' dark' : ''}`
  let mode = 'fail'
  let release
  const held = new Promise((res) => { release = res })
  await page.route('**/api/v1/incidents/trend*', async (r) => {
    if (mode === 'hold') await held
    await r.fulfill({ status: 500, json: failEnvelope('The chart could not be worked out.') })
  })
  await gotoReady(page, '/incidents', scheme === 'dark')
  const button = page.getByRole('button', { name: 'Try again' }).first()
  await button.waitFor({ state: 'visible', timeout: 90_000 })
  const callout = button.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
  const measure = () => callout.evaluate((el) => {
    const b = el.querySelector('button')
    const cs = getComputedStyle(el)
    const text = [...el.children].find((c) => c.tagName === 'DIV' && !c.contains(b) && c.textContent.trim())
    const br = b.getBoundingClientRect(), cr = el.getBoundingClientRect()
    return { btnLeft: br.left, btnRight: br.right, innerRight: cr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight), textLeft: text.getBoundingClientRect().left, height: cr.height }
  })
  const idle = await measure()
  await noOverflow(page, `${tag} idle`)
  await crop(page, vp, scheme === 'dark' ? 'retry-callout-dark-1280' : `retry-callout-idle-${vp.name}`, callout)
  if (scheme === 'dark') return
  if (vp.name === '1280') check(`${tag} idle: button right edge within 1px of the callout inner right edge`, within(idle.btnRight, idle.innerRight, 1), idle)
  else check(`${tag} idle: button left edge equals the text left edge (1px)`, within(idle.btnLeft, idle.textLeft, 1), idle)
  mode = 'hold'
  await button.click()
  await page.getByText('Trying again…').first().waitFor({ state: 'visible', timeout: 10_000 })
  const pending = await measure()
  await noOverflow(page, `${tag} pending`)
  if (vp.name === '1280') {
    await crop(page, vp, 'retry-callout-pending-1280', callout)
    check(`${tag} pending: button right edge within 1px of the inner right edge`, within(pending.btnRight, pending.innerRight, 1), pending)
  }
  mode = 'fail'
  release()
  await page.getByText("Couldn't load it again.").first().waitFor({ state: 'visible', timeout: 90_000 })
  const failed = await measure()
  await noOverflow(page, `${tag} failed`)
  await crop(page, vp, `retry-callout-failed-${vp.name}`, callout)
  if (vp.name === '1280') check(`${tag} failed: button right edge within 1px of the inner right edge`, within(failed.btnRight, failed.innerRight, 1), failed)
  else check(`${tag} failed: button left edge equals the text left edge (1px)`, within(failed.btnLeft, failed.textLeft, 1), failed)
  check(`${tag}: button x identical across idle, pending, failed (1px)`, within(idle.btnLeft, pending.btnLeft, 1) && within(idle.btnLeft, failed.btnLeft, 1), { idle: idle.btnLeft, pending: pending.btnLeft, failed: failed.btnLeft })
  check(`${tag}: banner height unchanged across states (1px)`, within(idle.height, pending.height, 1) && within(idle.height, failed.height, 1), { idle: idle.height, pending: pending.height, failed: failed.height })
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `incidents-full-${vp.name}.png`), { touch: vp.touch })).checks)
}

// F1 (R7 follow-up): RetryCallout in the roster side panel, a callout under 35rem on a wide viewport. The actions wrap under the text, so the button must start
// at the text edge in idle, pending and failed alike (the order swap keys off the callout's width, not the viewport's).
async function rosterFillPanel(page, vp) {
  const tag = 'F1 roster panel 1280'
  let mode = 'fail'
  let release
  const held = new Promise((res) => { release = res })
  await page.route('**/api/v1/rostering/fill*', async (r) => {
    if (mode === 'hold') await held
    await r.fulfill({ status: 500, json: failEnvelope('The fill chart could not be worked out.') })
  })
  await gotoReady(page, '/rostering', false)
  await page.getByRole('button', { name: 'Next 8 weeks' }).first().click()
  const panel = page.getByRole('dialog').first()
  const button = panel.getByRole('button', { name: 'Try again' })
  await button.waitFor({ state: 'visible', timeout: 90_000 })
  const callout = button.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]')
  const measure = () => callout.evaluate((el) => {
    const b = el.querySelector('button')
    const text = [...el.children].find((c) => c.tagName === 'DIV' && !c.contains(b) && c.textContent.trim())
    const cr = el.getBoundingClientRect()
    return { btnLeft: b.getBoundingClientRect().left, textLeft: text.getBoundingClientRect().left, width: cr.width }
  })
  const idle = await measure()
  check(`${tag}: the callout is under 35rem (560px), so the actions wrap`, idle.width < 560, idle)
  check(`${tag} idle: button left edge equals the text left edge (2px)`, within(idle.btnLeft, idle.textLeft, 2), idle)
  await crop(page, vp, 'roster-fill-panel-error-1280', callout)
  mode = 'hold'
  await button.click()
  await page.getByText('Trying again…').first().waitFor({ state: 'visible', timeout: 10_000 })
  const pending = await measure()
  check(`${tag} pending: button left edge equals the text left edge (2px)`, within(pending.btnLeft, pending.textLeft, 2), pending)
  mode = 'fail'
  release()
  await page.getByText("Couldn't load it again.").first().waitFor({ state: 'visible', timeout: 90_000 })
  const failed = await measure()
  check(`${tag} failed: button left edge equals the text left edge (2px)`, within(failed.btnLeft, failed.textLeft, 2), failed)
  check(`${tag}: button x identical across idle, pending, failed (1px)`, within(idle.btnLeft, pending.btnLeft, 1) && within(idle.btnLeft, failed.btnLeft, 1), { idle: idle.btnLeft, pending: pending.btnLeft, failed: failed.btnLeft })
  await noOverflow(page, tag)
}

// AR1: the auto-roster panel after an apply the app could not confirm (the request is dropped), then after a 500.
async function autoRoster(page, vp) {
  const tag = `AR1 ${vp.name}`
  // The mock's current week has no shifts: start it and add one unfilled draft shift, so the board offers Auto-roster.
  await page.route('**/api/v1/rostering/board*', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    if (body?.data?.participantRows) {
      const d = body.data
      d.weekStarted = true
      const open = { id: 'pb5-open', participantId: 'p-pb5', participantName: 'Jo Park', staffId: null, staffName: null, serviceDate: d.days[2], startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false, durationHours: 6, ratio: 'OneToOne', nightType: 'None', status: 'Draft', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false }
      d.participantRows.push({ participantId: 'p-pb5', fullName: 'Jo Park', supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, inOnboarding: false, shifts: [open], tripBars: [], scheduledHours: 6, daysWithoutCover: 6 })
    }
    return route.fulfill({ response: res, json: body })
  })
  await gotoReady(page, '/rostering', false)
  await page.getByRole('button', { name: 'Auto-roster' }).first().click({ timeout: 90_000 })
  const apply = page.getByRole('button', { name: /^Apply/ })
  await apply.waitFor({ state: 'visible', timeout: 90_000 })
  await page.route('**/auto-roster/apply', (r) => r.abort('failed'))
  await apply.click()
  const unconfirmed = page.getByRole('alert').filter({ hasText: 'We couldn’t confirm the apply' })
  await unconfirmed.waitFor({ state: 'visible', timeout: 30_000 })
  check(`${tag}: unconfirmed callout has no Try again button`, (await unconfirmed.getByRole('button', { name: 'Try again' }).count()) === 0)
  await noOverflow(page, `${tag} unconfirmed`)
  await crop(page, vp, 'autoroster-unconfirmed-1280', unconfirmed, 24)
  await page.unroute('**/auto-roster/apply')
  await page.route('**/auto-roster/apply', (r) => r.fulfill({ status: 500, json: failEnvelope('The server could not apply the draft.') }))
  await apply.click()
  const failed = page.getByRole('alert').filter({ hasText: 'Couldn’t apply the draft' })
  await failed.waitFor({ state: 'visible', timeout: 30_000 })
  check(`${tag}: failed callout keeps Try again`, (await failed.getByRole('button', { name: 'Try again' }).count()) === 1)
  await crop(page, vp, 'autoroster-failed-1280', failed, 24)
}

// INC1: Cancel while the review save is held. The incident is a full fixture (the mock's inc-0002 lacks fields the detail page reads).
const incidentFixture = {
  id: 'inc-1', serviceType: 'None', tripInstanceId: null, tripName: null, incidentType: 'Injury', otherTypeSpecify: null,
  severity: 'Medium', status: 'UnderReview', title: 'Fall in the garden', incidentDateTime: '2026-10-03T08:00:00', location: 'Home',
  reportedByName: 'Mei Zhang', involvedParticipantId: 'participant-4', involvedParticipantName: 'Grace Palmer-Hughes', qscReportingStatus: 'NotRequired', isOverdue24h: false,
  createdAt: '2026-10-03T09:00:00Z', medicationAdministrationId: null, shiftId: null, shiftNoteId: null, participantBookingId: null, involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 'staff-4',
  restrictivePracticeType: null, restrictivePracticeId: null, restrictivePracticeDescription: null, restrictivePracticeReviewDate: null, unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: null,
  description: 'Grace slipped on the wet path.', immediateActionsTaken: 'Checked for injury and sat her down.', wereEmergencyServicesCalled: false, emergencyServicesDetails: null, emergencyServices: 'None',
  policeOfficerName: null, policeReference: null, ambulanceOfficerName: null, ambulanceReference: null, fireOfficerName: null, fireReference: null, witnessNames: null, witnessStatements: null,
  injuries: [], witnesses: [], qscReportedAt: null, qscReferenceNumber: null, awareAt: '2026-10-03T09:05:00Z', reportableClass: 'None', reportableClassReason: null,
  notifyDueAt: null, detailedReportDueAt: null, dueCountedWithoutHolidays: false, commissionDetailedReportedAt: null, commissionFinalReportRequested: false, commissionFinalReportedAt: null, timeZoneId: 'Australia/Sydney',
  reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null, resolvedAt: null,
  familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false, supportCoordinatorNotifiedAt: null,
  updatedAt: '2026-10-05T01:02:03.4567890Z', medicationContext: null, shiftContext: null, shiftNoteContext: null,
}
async function incidentReview(page, vp) {
  const tag = `INC1 ${vp.name}`
  await page.route('**/api/v1/incidents/inc-1', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: envelope(incidentFixture) }) : r.fallback()))
  await page.route('**/api/v1/incidents/inc-1/status-history', (r) => r.fulfill({ json: envelope([]) }))
  await gotoReady(page, '/incidents/inc-1', false)
  const review = page.locator('[data-testid="incident-review"]')
  await review.waitFor({ timeout: 90_000 })
  await review.getByRole('button', { name: 'Record review' }).click({ timeout: 60_000 })
  await review.getByLabel(/Review notes/).fill('Spoke with the team. Footwear check added.')
  let release
  const held = new Promise((res) => { release = res })
  await page.route('**/api/v1/incidents/inc-1/review', async (r) => { if (r.request().method() === 'PUT') { await held; await r.fulfill({ json: envelope(incidentFixture) }) } else await r.fallback() })
  await review.getByRole('button', { name: 'Save review' }).click()
  await review.getByRole('button', { name: 'Saving...' }).waitFor({ timeout: 10_000 })
  const cancel = review.getByRole('button', { name: 'Cancel' })
  check(`${tag}: Cancel is disabled while saving`, await cancel.isDisabled())
  const m = await review.evaluate((el) => [...el.querySelectorAll('form button')].map((b) => ({ t: b.textContent.trim(), w: b.getBoundingClientRect().width, top: b.getBoundingClientRect().top })))
  if (vp.touch) {
    const c = m.find((b) => b.t === 'Cancel'), s = m.find((b) => b.t.startsWith('Saving'))
    check(`${tag}: buttons full width and Cancel below Save (reversed column)`, c.w > 300 && within(c.w, s.w, 1) && c.top > s.top, m)
  }
  await noOverflow(page, `${tag} saving`)
  await crop(page, vp, `incident-review-saving-${vp.name}`, review, 16)
  release()
}

// CK1: the Checks column on the Ready tab, and the phone card. The Ready list is a fixture with one blocked claim.
const hubLine = (i, over = {}) => ({
  lineId: `l${i}`, claimId: `c${i}`, claimReference: `CLM-000${i}`, claimKind: 'shift', participantId: `p${i}`, participantName: ['Jo Park', 'Sam Lee', 'Alex Rivera', 'Mina Okafor'][i % 4],
  supportNumber: '04_104_0125_6_1', supportName: 'Short-notice cancellation', from: '2026-10-18', to: '2026-10-18', hours: 3, quantity: 3, unitPrice: 67.56, totalAmount: 202.68,
  gstCode: 'P2', claimType: 'Standard', fundingType: 'agency', ageDays: 5, ageBand: 'none', nextAttempt: 1, problems: [], ...over,
})
const blockMsg = "04_104_0125_6_1 can't be claimed as a short-notice cancellation. Check the short-notice setting for this item in the price guide."
const hubLines = { ready: [hubLine(0, { problems: [{ rule: 'CancellationNotAllowed', severity: 'block', message: blockMsg }] }), hubLine(1), hubLine(2), hubLine(3)], rejected: [], managed: [] }
async function claimsReady(page, vp) {
  const tag = `CK1 ${vp.name}`
  await page.route('**/api/v1/claim-hub/lines', (r) => r.fulfill({ json: envelope(hubLines) }))
  await gotoReady(page, '/claims', false)
  const panel = page.locator('main')
  await panel.getByText("can't be claimed as a short-notice").first().waitFor({ state: 'attached', timeout: 90_000 })
  if (vp.width >= 768) {
    const th = page.locator('th').filter({ hasText: /^Checks$/ }).first()
    await th.waitFor({ state: 'visible', timeout: 90_000 })
    const m = await th.evaluate((el) => {
      const idx = [...el.parentElement.children].indexOf(el)
      const cells = [...el.closest('table').querySelectorAll('tbody tr')].map((tr) => tr.children[idx]).filter(Boolean)
      return { thWidth: el.getBoundingClientRect().width, cellWidths: cells.map((c) => +c.getBoundingClientRect().width.toFixed(1)), cellHeights: cells.map((c) => +c.getBoundingClientRect().height.toFixed(1)) }
    })
    check(`${tag}: Checks cell width >= 256px`, m.thWidth >= 255.5 && m.cellWidths.every((w) => w >= 255.5), m)
    // CK1 was dropped (the min width gained 6-8px only); the squeeze-with-and-without-the-class check went with it.
    await noOverflow(page, tag)
    if (vp.name === '1280') await crop(page, vp, 'claims-ready-checks-1280', page.locator('main table').filter({ has: page.locator('th', { hasText: /^Checks$/ }) }).first(), 8)
  } else {
    await noOverflow(page, tag)
    await crop(page, vp, 'claims-ready-card-390', panel.getByText("can't be claimed as a short-notice").first().locator('xpath=ancestor::*[self::li or self::article or (self::div and contains(@class,"rounded"))][1]'), 8)
  }
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `claims-full-${vp.name}.png`), { touch: vp.touch })).checks)
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 842, touch: false },
  { name: '1536', width: 1536, height: 900, touch: false },
  { name: '390', width: 390, height: 844, touch: true },
]
try {
  for (const vp of VIEWPORTS) {
    const open = async (scheme = 'light') => {
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: scheme, reducedMotion: 'reduce' })
      return { context, page: await openPage(context, vp.touch) }
    }
    let s = await open()
    if (vp.name !== '1536') await safe(`R7 ${vp.name}`, () => retryCallout(s.page, vp, 'light'))
    await s.context.close()
    if (vp.name === '1280') {
      s = await open('dark')
      await safe('R7 1280 dark', () => retryCallout(s.page, vp, 'dark'))
      await s.context.close()
      s = await open()
      await safe('AR1', () => autoRoster(s.page, vp))
      await s.context.close()
      s = await open()
      await safe('F1 roster panel', () => rosterFillPanel(s.page, vp))
      await s.context.close()
    }
    if (vp.name !== '1536') {
      s = await open()
      await safe(`INC1 ${vp.name}`, () => incidentReview(s.page, vp))
      await s.context.close()
    }
    s = await open()
    await safe(`CK1 ${vp.name}`, () => claimsReady(s.page, vp))
    await s.context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
