// Polish batch 9: RF-1 roster Publish bar under the view-as banner, incident time + am/pm on one line (witness line, page foot), injury Remove button at 390,
// auto-roster unconfirmed callout. Numeric checks only from computed boxes. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-9.mjs <outdir>
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

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' })

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} = ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}
const safe = async (name, fn) => {
  try { await fn() } catch (e) { check(`${name} (script error)`, false, String(e.message).split('\n')[0]) }
}

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
const gotoReady = async (page, url) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('main, form').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
  await page.pinCoarse()
  await page.waitForTimeout(800)
}
const noOverflow = async (page, label) => {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  check(`no horizontal scroll (${label})`, o.sw <= o.iw, o)
}
const crop = async (page, vp, name, locator, pad = 16) => {
  checks.push(checkCropHolds(await cropElement(page, locator, path.join(OUT_DIR, `${name}.png`), { pad, touch: !!vp.touch, natural: false })))
}

// Crop an element where it sits in the live viewport (centred, so the fixed bottom nav is not over it), clip = box + pad,
// and check no visible fixed or sticky element's box overlaps the clip (the closed drawer scrim is a full-screen opacity-0 layer).
const viewCrop = async (page, name, locator, pad = 16) => {
  await locator.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
  await page.waitForTimeout(300)
  const box = await locator.boundingBox()
  const vp = page.viewportSize()
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad)
  const clip = { x, y, width: Math.min(box.x + box.width + pad, vp.width) - x, height: Math.min(box.y + box.height + pad, vp.height) - y }
  const covers = await page.evaluate((c) => [...document.body.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return ['fixed', 'sticky'].includes(cs.position) && cs.opacity !== '0' && cs.visibility !== 'hidden' }).map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.height > 0 && r.left < c.x + c.width && r.right > c.x && r.top < c.y + c.height && r.bottom > c.y).map(({ e, r }) => e.tagName + '.' + String(e.className).split(' ')[0] + ' ' + Math.round(r.top) + '-' + Math.round(r.bottom)), clip)
  check(`crop is clear of fixed or sticky chrome: ${name}.png`, covers.length === 0 && clip.height >= box.height + 2 * pad - 1, { clip, box, covers })
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), clip })
}

// RF-1: a roster week with enough rows to fill the screen, viewed as another user. Board data comes from the mock, shaped like roster-footer.mjs.
const WEEK = '2026-09-07'
const shift = (id, pid, staffId, staffName, date, status) => ({
  id, participantId: pid, participantName: 'x', staffId, staffName, serviceDate: date, startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false,
  durationHours: 6, ratio: 'OneToOne', nightType: 'None', status, shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false,
})
async function rosterViewAs(page, vp) {
  const tag = `RF1 ${vp.name}`
  await page.route('**/api/v1/rostering/board*', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    if (body?.data?.weekStart === WEEK) {
      const d = body.data
      for (let i = 0; i < 28; i++) {
        const pid = `p-busy-${i}`
        d.participantRows.push({ participantId: pid, fullName: `Person ${i}`, supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, inOnboarding: false,
          shifts: [shift(`busy-r${i}`, pid, 's-0003', 'Jack Staff', d.days[i % 7], i % 2 ? 'Draft' : 'Published')], tripBars: [], scheduledHours: 6, daysWithoutCover: 6 })
      }
    }
    return route.fulfill({ response: res, json: body })
  })
  // The tab views as a user: the same keys the switcher writes (lib/viewAs.ts). The profile is the signed-in blob.
  await page.evaluate(() => {
    sessionStorage.setItem('odip_viewing_user', 'user-viewed-1')
    sessionStorage.setItem('odip_viewing_profile', localStorage.getItem('odip_user') ?? '{}')
  })
  await gotoReady(page, `/rostering?date=${WEEK}`)
  const banner = page.getByText('Viewing as', { exact: true })
  await banner.waitFor({ state: 'visible', timeout: 30_000 })
  const bar = page.locator('[data-publish-bar]')
  await bar.waitFor({ state: 'visible', timeout: 60_000 })
  const m = await page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect()
    const b = document.querySelector('[data-publish-bar]'), ban = [...document.querySelectorAll('div')].find((d) => d.textContent?.startsWith('Viewing as') && d.className.includes('h-10'))
    return { barBottom: r(b).bottom, innerHeight, bannerHeight: ban ? r(ban).height : null, scrollTop: document.scrollingElement.scrollTop }
  })
  check(`${tag}: the Publish bar bottom is at or above the viewport bottom`, m.barBottom <= m.innerHeight + 0.5, m)
  check(`${tag}: the banner is 40px`, m.bannerHeight !== null && Math.abs(m.bannerHeight - 40) <= 1, m)
  await noOverflow(page, tag)
  await crop(page, vp, 'roster-viewas-1280', page.locator('[data-fit-screen]').first(), 0)
  // fit-screen pages put the PlatformFooter below the fold by design, and a Playwright fullPage capture does not resize the layout viewport, so skip the truncation check here
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `roster-viewas-full-${vp.name}.png`), { touch: vp.touch })).checks.filter((c) => !c.name.startsWith('full page not truncated')))
}

// Incident detail: a fixture with an injury and a staff witness whose times fall in the evening in Sydney (pm).
const incidentFixture = {
  id: 'inc-1', serviceType: 'None', tripInstanceId: null, tripName: null, incidentType: 'Injury', otherTypeSpecify: null,
  severity: 'Medium', status: 'Open', title: 'Fall in the garden', incidentDateTime: '2026-10-03T08:00:00', location: 'Home',
  reportedByName: 'Mei Zhang', involvedParticipantId: 'participant-4', involvedParticipantName: 'Grace Palmer-Hughes', qscReportingStatus: 'NotRequired', isOverdue24h: false,
  createdAt: '2026-10-03T09:00:00Z', medicationAdministrationId: null, shiftId: null, shiftNoteId: null, participantBookingId: null, involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 'staff-4',
  restrictivePracticeType: null, restrictivePracticeId: null, restrictivePracticeDescription: null, restrictivePracticeReviewDate: null, unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: null,
  description: 'Grace slipped on the wet path.', immediateActionsTaken: 'Checked for injury and sat her down.', wereEmergencyServicesCalled: false, emergencyServicesDetails: null, emergencyServices: 'None',
  policeOfficerName: null, policeReference: null, ambulanceOfficerName: null, ambulanceReference: null, fireOfficerName: null, fireReference: null, witnessNames: null, witnessStatements: null,
  injuries: [{ id: 'inj-1', region: 'Head', injuryType: 'Bruise', description: 'Left side of the forehead' }],
  witnesses: [{ id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Sam Okafor', isStaffWitness: true, witnessStatus: 'Approved', witnessRequestedAt: '2026-10-03T10:00:00Z', witnessRespondedAt: '2026-10-03T11:00:00Z', statementText: 'I saw her slip.' }],
  qscReportedAt: null, qscReferenceNumber: null, awareAt: '2026-10-03T09:05:00Z', reportableClass: 'None', reportableClassReason: null,
  notifyDueAt: null, detailedReportDueAt: null, dueCountedWithoutHolidays: false, commissionDetailedReportedAt: null, commissionFinalReportRequested: false, commissionFinalReportedAt: null, timeZoneId: 'Australia/Sydney',
  reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null, resolvedAt: null,
  familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false, supportCoordinatorNotifiedAt: null,
  updatedAt: '2026-10-05T01:02:03.4567890Z', medicationContext: null, shiftContext: null, shiftNoteContext: null,
}
async function openIncident(page) {
  await page.route('**/api/v1/incidents/inc-1', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: envelope(incidentFixture) }) : r.fallback()))
  await page.route('**/api/v1/incidents/inc-1/status-history', (r) => r.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/staff*', (r) => r.fulfill({ json: envelope([{ id: 'staff-4', fullName: 'Mei Zhang' }, { id: 'staff-2', fullName: 'Sam Okafor' }]) }))
  await gotoReady(page, '/incidents/inc-1')
  await page.getByRole('heading', { level: 3 }).first().waitFor({ state: 'visible', timeout: 60_000 })
}

// Every "h:mm am/pm" in the element's text, as the range boxes the browser lays out: a broken pair would be two lines tall.
const timeBoxes = (locator) => locator.evaluate((el) => {
  const out = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    for (const m of n.textContent.matchAll(/\d{1,2}:\d\d[\s\u00a0\u202f][ap]m/gi)) {
      const range = document.createRange()
      range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length)
      out.push({ text: m[0].replace(/\u00a0/g, '<nbsp>'), height: range.getBoundingClientRect().height, lineHeight: lh, lines: range.getClientRects().length })
    }
  }
  return out
})

async function incidentTimes(page, vp) {
  const tag = `INC ${vp.name}`
  await openIncident(page)
  const witness = page.getByTestId('witness-row').first()
  const wLine = witness.locator('p', { hasText: 'Asked' })
  const foot = page.getByText(/^Reported \d/).first()
  for (const [label, loc] of [['witness line', wLine], ['page foot', foot]]) {
    const boxes = await timeBoxes(loc)
    check(`${tag}: ${label} has times and each stays on one line (height under 1.5 line-heights)`, boxes.length >= 1 && boxes.every((b) => b.height < b.lineHeight * 1.5 && b.lines === 1), boxes)
  }
  await noOverflow(page, tag)
  if (vp.name === '390') {
    await viewCrop(page, 'incident-witness-390', witness)
    await viewCrop(page, 'incident-foot-390', foot)
  }
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `incident-full-${vp.name}.png`), { touch: vp.touch })).checks)
}

async function injuryRemove(page, vp) {
  const tag = `INJ ${vp.name}`
  await openIncident(page)
  await page.getByRole('button', { name: 'Edit injuries', exact: true }).click({ timeout: 30_000 })
  const remove = page.getByRole('button', { name: /^Remove: / }).first()
  await remove.waitFor({ state: 'visible', timeout: 30_000 })
  const m = await remove.evaluate((el) => {
    const probe = document.createElement('div'); probe.style.height = 'var(--control-h-sm)'; document.body.appendChild(probe)
    const small = probe.getBoundingClientRect().height; probe.remove()
    const b = el.getBoundingClientRect()
    return { w: b.width, h: b.height, controlHSm: small, coarse: matchMedia('(pointer: coarse)').matches }
  })
  if (vp.touch) check(`${tag}: Remove is at least 44px tall`, m.h >= 43.5 && m.coarse, m)
  else check(`${tag}: Remove keeps its desktop height (control-h-sm, 1px)`, Math.abs(m.h - m.controlHSm) <= 1, m)
  await noOverflow(page, tag)
  await crop(page, vp, `injury-remove-${vp.name}`, page.locator('[data-editing]').first(), 16)
}

// AR1: the auto-roster panel after an apply the app could not confirm (the request is dropped).
async function autoRoster(page, vp) {
  const tag = `AR ${vp.name}`
  await page.route('**/api/v1/rostering/board*', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    if (body?.data?.participantRows) {
      const d = body.data
      d.weekStarted = true
      const open = { id: 'pb9-open', participantId: 'p-pb9', participantName: 'Jo Park', staffId: null, staffName: null, serviceDate: d.days[2], startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false, durationHours: 6, ratio: 'OneToOne', nightType: 'None', status: 'Draft', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false }
      d.participantRows.push({ participantId: 'p-pb9', fullName: 'Jo Park', supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, inOnboarding: false, shifts: [open], tripBars: [], scheduledHours: 6, daysWithoutCover: 6 })
    }
    return route.fulfill({ response: res, json: body })
  })
  await gotoReady(page, '/rostering')
  await page.getByRole('button', { name: 'Auto-roster' }).first().click({ timeout: 90_000 })
  const apply = page.getByRole('button', { name: /^Apply/ })
  await apply.waitFor({ state: 'visible', timeout: 90_000 })
  await page.route('**/auto-roster/apply', (r) => r.abort('failed'))
  await apply.click()
  const unconfirmed = page.getByRole('alert').filter({ hasText: 'We couldn’t confirm the apply' })
  await unconfirmed.waitFor({ state: 'visible', timeout: 30_000 })
  check(`${tag}: the unconfirmed callout has no button and says to check the board`, (await unconfirmed.getByRole('button').count()) === 0 && (await unconfirmed.getByText('Check the board to see what was applied.').count()) === 1)
  await noOverflow(page, `${tag} unconfirmed`)
  await crop(page, vp, 'autoroster-unconfirmed-1280', unconfirmed, 24)
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800, touch: false },
  { name: '390', width: 390, height: 844, touch: true },
]
try {
  for (const vp of VIEWPORTS) {
    const open = async () => {
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
      return { context, page: await openPage(context, vp.touch) }
    }
    let s
    if (vp.name === '1280') {
      s = await open(); await safe(`RF1 ${vp.name}`, () => rosterViewAs(s.page, vp)); await s.context.close()
      s = await open(); await safe(`AR ${vp.name}`, () => autoRoster(s.page, vp)); await s.context.close()
    }
    s = await open(); await safe(`INC ${vp.name}`, () => incidentTimes(s.page, vp)); await s.context.close()
    s = await open(); await safe(`INJ ${vp.name}`, () => injuryRemove(s.page, vp)); await s.context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
