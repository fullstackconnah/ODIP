// Several agreements per participant, PR B. Light theme, reduced motion, 390 touch and 1280. Data comes from the mock API: the script makes its own agreements through the
// save and approve routes (p-0004: Core approved + a revision draft + an approved Trip; p-0005: a Core draft + a Trip with an 80-character name; p-0001: one ended agreement;
// p-0003: one plain agreement; p-0006: none). Numeric checks C1-C9 of SHAPE-B section 12 run on the live DOM; exit 1 on any failure.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  ;({ chromium } = await import('@playwright/test'))
}

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role) => {
  const username = `dev.${role.toLowerCase()}`
  return {
    users: envelope([{ username, role, tenantName: 'Sample Support Co' }]),
    token: envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: `Dev ${role}`, role, tenantName: 'Sample Support Co' }),
  }
}
const VIEWPORTS = [
  { name: 'touch-390', width: 390, height: 844, touch: true },
  { name: 'desktop-1280', width: 1280, height: 900, touch: false },
]
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const block = (id, extra) => ({ id, intensity: 'Standard', workers: 1, participantsPresent: 1, headcountChanges: [], setting: 'Community', location: { state: 'NSW', zone: 'National' }, workerMaySleep: false, sleepoverActiveHours: 0, onPublicHoliday: 'Charge', supportType: 'CommunityAccess', days: ['Monday', 'Wednesday'], start: '09:00:00', end: '13:00:00', ...extra })
const requirements = { workerGender: 'NoPreference', driver: false, skills: [] }
const blocks = [{ block: block('b1'), requirements }, { block: block('b2', { supportType: 'PersonalCare', days: ['Tuesday', 'Thursday'], start: '07:00:00', end: '09:00:00', setting: 'AtHome' }), requirements }]
const LONG_NAME = 'Respite and community access over the school holidays with a second worker for the beach and the pool days, 2027'.slice(0, 80)

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (vp, name, ok, detail = '') => { checks.push({ name: `${vp} ${name}`, pass: !!ok, detail }); console.log(`[agreements-multiple] ${ok ? 'PASS' : 'FAIL'} ${vp} ${name}${detail ? ` (${detail})` : ''}`) }
const near = (a, b) => Math.abs(a - b) <= 0.6

/** A token's value in px, read through a probe element so rem and calc() resolve. */
const tokenPx = (page, name) => page.evaluate((token) => {
  const probe = document.createElement('div')
  probe.style.cssText = `position:absolute;visibility:hidden;width:var(${token})`
  document.body.append(probe)
  const px = probe.getBoundingClientRect().width
  probe.remove()
  return px
}, name)

async function signIn(context, role) {
  const page = await context.newPage()
  const { users, token } = login(role)
  await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: users }))
  await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: token }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const button = page.getByRole('button', { name: 'Sign in as selected user' })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  return page
}

let prepared = false
/** The agreements the states need, made once through the mock's own routes. */
async function prepare(page) {
  if (prepared) return
  prepared = true
  const call = async (method, route, data) => {
    const response = await page.request.fetch(`${BASE_URL}/api/v1/${route}`, { method, data, headers: { Authorization: 'Bearer mock-jwt-token' } })
    const text = await response.text()
    console.log(`[prepare] ${method} ${route} -> ${response.status()}${response.ok() ? '' : ` ${text.slice(0, 160)}`}`)
    return response.ok() ? JSON.parse(text).data ?? JSON.parse(text) : null
  }
  const body = (start, end, extra = {}) => ({ state: 'NSW', planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: start, agreementEndDate: end, blocks, ...extra })
  // p-0004: Core approved, a revision waiting, and an approved Trip that ends in 20 days (the Core ends later, so the warning picks it).
  await call('POST', 'participants/p-0004/service-agreement-drafts/draft-p-0004-v1/approve', { acknowledgeOverlaps: true })
  await call('POST', 'participants/p-0004/service-agreement-drafts', body('2026-10-01', '2027-06-30', { baseVersion: 1 }))
  const trip = await call('POST', 'participants/p-0004/service-agreement-drafts', body(day(-7), day(20), { newAgreement: true, agreementKind: 'Trip', agreementName: 'Trip to Cairns', baseVersion: 0 }))
  if (trip) await call('POST', `participants/p-0004/service-agreement-drafts/${trip.id}/approve`, { acknowledgeOverlaps: true })
  // p-0005: a Core draft and a Trip with the longest name the field takes.
  await call('POST', 'participants/p-0005/service-agreement-drafts', body(day(30), day(300), { newAgreement: true, agreementKind: 'Trip', agreementName: LONG_NAME, baseVersion: 0 }))
}

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
    const page = await signIn(context, 'Admin')
    await prepare(page)
    const opts = { touch: vp.touch }
    const rec = (name, ok, detail) => check(vp.name, name, ok, detail)
    const open = async (url) => { await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForTimeout(600) }
    const agreementsCard = () => page.locator('#agreements')
    const snap = async (state, locator, extra = {}) => {
      try {
        await locator.waitFor({ state: 'visible', timeout: 15_000 })
        const result = await cropElement(page, locator, path.join(OUT_DIR, `${vp.name}-${state}.png`), { ...opts, ...extra })
        checks.push(checkCropHolds(result))
      } catch (error) {
        rec(`${state}: capture`, false, String(error).slice(0, 160))
        await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${state}.png`) })
      }
    }
    const participantPage = async (id) => { await open(`/participants/${id}?tab=agreements`); await agreementsCard().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}) }

    // none, one plain agreement (C7), ended (C1/C2 on the lone New revision button).
    await participantPage('p-0006')
    await snap('none', agreementsCard())
    await participantPage('p-0003')
    rec('C7 one plain agreement: no h4 in the Agreements card', (await agreementsCard().locator('h4').count()) === 0)
    await snap('one-plain', agreementsCard())
    await participantPage('p-0001')
    await snap('ended', agreementsCard())
    const sm = await tokenPx(page, '--control-h-sm')
    const tap = await tokenPx(page, '--tap-min')
    const reviseSolo = agreementsCard().getByRole('link', { name: 'New revision' }).first()
    if (await reviseSolo.count()) rec('C1 New revision height = --control-h-sm', near((await reviseSolo.boundingBox()).height, sm), `${(await reviseSolo.boundingBox()).height} vs ${sm}`)
    // ended-early: the same agreement, told its end was moved in.
    await page.route('**/api/v1/participants/p-0001/service-agreement-drafts', async (route) => {
      const response = await route.fetch()
      const json = await response.json()
      const list = (json.data ?? json).map((d) => ({ ...d, originalAgreementEndDate: day(60) }))
      await route.fulfill({ response, json: json.data ? { ...json, data: list } : list })
    })
    await participantPage('p-0001')
    await snap('ended-early', agreementsCard())
    await page.unroute('**/api/v1/participants/p-0001/service-agreement-drafts')

    // waiting-revision and two agreements (p-0004): C1, C2, C3, C6, C8, combined-participant.
    await participantPage('p-0004')
    await page.getByText(/Together, these agreements plan more than/).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    await snap('waiting-revision', agreementsCard())
    await snap('two-agreements', agreementsCard())
    await snap('combined-participant', page.getByText(/Together, these agreements plan more than/).first().locator('xpath=ancestor::*[self::div or self::section][1]'))
    const add = agreementsCard().getByRole('link', { name: 'Add agreement' }).first()
    if (await add.count()) {
      const box = await add.boundingBox()
      rec('C1 Add agreement height = --control-h-sm', near(box.height, sm), `${box.height} vs ${sm}`)
      if (vp.touch) {
        const hit = await add.evaluate((el) => { const after = getComputedStyle(el, '::after'); return Math.max(el.getBoundingClientRect().height, parseFloat(after.height) || 0) })
        rec('C2 Add agreement hit area >= --tap-min', hit >= tap - 0.6, `${hit} vs ${tap}`)
      }
    } else rec('C1 Add agreement present', false)
    const sections = await agreementsCard().locator('section').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect()))
    const gap = await tokenPx(page, '--section-gap')
    rec('C3 gap between agreement blocks = --section-gap', sections.length >= 2 && near(sections[1].top - sections[0].bottom, gap), `${sections.length >= 2 ? sections[1].top - sections[0].bottom : 'n/a'} vs ${gap}`)
    if (vp.touch) {
      const h4 = (await agreementsCard().locator('h4').count()) ? await agreementsCard().locator('h4').first().boundingBox() : { y: 0, height: 0 }
      const revise = await agreementsCard().locator('section').first().getByRole('link', { name: 'New revision' }).count()
      rec('C6 stacked New revision sits below the heading', revise === 0 || (await agreementsCard().locator('section').first().getByRole('link', { name: 'New revision' }).first().boundingBox()).y >= h4.y + h4.height - 1)
    }
    rec('C8 no budget "fits" wording', !/within budget|fits|under budget/i.test(await page.locator('main').innerText()))

    // named-80-mobile (p-0005): C5.
    await participantPage('p-0005')
    const long = agreementsCard().locator('h4', { hasText: LONG_NAME.slice(0, 30) }).first()
    await snap('named-80-mobile', agreementsCard())
    if (await long.count()) {
      const lines = await long.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
      const cardBox = await agreementsCard().boundingBox()
      const h4Box = await long.boundingBox()
      const overflow = await agreementsCard().evaluate((el) => el.scrollWidth <= el.clientWidth)
      if (vp.touch) rec('C5 80-character name wraps to 2+ lines inside the Card', lines >= 2 && h4Box.x + h4Box.width <= cardBox.x + cardBox.width + 0.6 && overflow, `${lines} lines, scrollWidth ok ${overflow}`)
      else rec('C5 80-character name stays inside the Card', h4Box.x + h4Box.width <= cardBox.x + cardBox.width + 0.6 && overflow)
    } else rec('C5 long-named agreement present', false)

    // The wizard: ?agreement=new (add-new-step, add-errors, C4, C9), an unknown id, the combined warning in the draft, none.
    await open('/participants/p-0004/agreement-draft?agreement=new')
    const kind = page.getByLabel('Agreement type')
    await kind.waitFor({ state: 'visible', timeout: 30_000 })
    const control = await tokenPx(page, '--control-h')
    const nameBox = await page.getByLabel('Name (optional)').boundingBox()
    rec('C4 type select and Name input height = --control-h', near((await kind.boundingBox()).height, control) && near(nameBox.height, control), `${(await kind.boundingBox()).height} / ${nameBox.height} vs ${control}`)
    rec('C9 draft header does not overflow', await page.locator('header, h1').first().evaluate((el) => (el.closest('div') ?? el).scrollWidth <= document.documentElement.clientWidth))
    await snap('add-new-step', page.locator('main'))
    await page.getByRole('button', { name: 'Next', exact: true }).click().catch(() => {})
    await page.waitForTimeout(300)
    await snap('add-errors', page.locator('main'))
    await open('/participants/p-0004/agreement-draft?agreement=00000000-0000-0000-0000-00000000dead')
    await snap('unknown-id', page.locator('main'))
    await open('/participants/p-0004/agreement-draft?agreement=p-0004-ag2')
    const next = page.getByRole('button', { name: 'Next', exact: true })
    await next.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
    for (let i = 0; i < 3; i++) await next.click().catch(() => {})
    await page.waitForTimeout(800)
    await snap('combined-draft', page.locator('main'))
    await open('/participants/p-0003/agreement-draft')
    await next.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
    for (let i = 0; i < 3; i++) await next.click().catch(() => {})
    await page.waitForTimeout(600)
    await snap('combined-none', page.locator('main'))

    // Lists: the Agreements page (two agreements of one participant, bulk items), the roster notice, the alerts.
    await open('/agreements')
    await snap('agreements-list-two', page.locator('main'))
    const rowBoxes = page.getByRole('checkbox')
    if (await rowBoxes.count() > 1) { await rowBoxes.nth(1).check().catch(() => {}); await rowBoxes.nth(2).check().catch(() => {}) }
    await snap('bulk-items', page.locator('main'))
    await open('/rostering')
    const waiting = page.getByRole('button', { name: /waiting for approval|agreements? waiting/i }).first()
    if (await waiting.count()) await waiting.click().catch(() => {})
    await page.waitForTimeout(500)
    await snap('pending-two', page.getByText(/agreements? (is|are) waiting for approval/i).first().locator('xpath=ancestor::*[self::div or self::section][2]'))
    await open('/participants/p-0004')
    await snap('ending-two', page.getByText(/Agreement ends in/).first().locator('xpath=ancestor::*[self::ul or self::div][1]'))

    // preview-overlap: the approval dialog told another agreement's pattern overlaps.
    await page.route('**/api/v1/participants/p-0004/service-agreement-drafts/*/approval-preview', async (route) => {
      const response = await route.fetch()
      const json = await response.json()
      const data = json.data ?? json
      await route.fulfill({ response, json: { ...json, ...(json.data ? { data: { ...data, otherAgreementOverlaps: 2 } } : { ...data, otherAgreementOverlaps: 2 }) } })
    })
    await open('/participants/p-0004/agreement-draft?agreement=p-0004-ag2')
    for (let i = 0; i < 3; i++) await next.click().catch(() => {})
    await page.getByRole('button', { name: 'Mark approved for rostering', exact: true }).click().catch(() => {})
    await snap('preview-overlap', page.getByRole('dialog').first())
    await page.unroute('**/api/v1/participants/p-0004/service-agreement-drafts/*/approval-preview')

    // loading and error: the list answered late, then badly.
    await page.route('**/api/v1/participants/p-0003/service-agreement-drafts', () => {})
    await open('/participants/p-0003?tab=agreements')
    await snap('loading', agreementsCard())
    await page.unroute('**/api/v1/participants/p-0003/service-agreement-drafts')
    await page.route('**/api/v1/participants/p-0003/service-agreement-drafts', (route) => route.fulfill({ status: 500, json: { success: false, data: null, message: 'Server error', errors: ['Server error'] } }))
    await open('/participants/p-0003?tab=agreements')
    await snap('error', agreementsCard())
    await page.unroute('**/api/v1/participants/p-0003/service-agreement-drafts')
    await context.close()

    // no-draft-role: a role that cannot start or edit agreements sees no Add agreement.
    const readonly = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
    const ro = await signIn(readonly, 'ReadOnly')
    await ro.goto(`${BASE_URL}/participants/p-0004?tab=agreements`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await ro.waitForTimeout(1200)
    const roCard = ro.locator('#agreements')
    if (await roCard.count()) {
      check(vp.name, 'no-draft-role: no Add agreement or New revision', (await roCard.getByRole('link', { name: /Add agreement|New revision/ }).count()) === 0)
      checks.push(checkCropHolds(await cropElement(ro, roCard, path.join(OUT_DIR, `${vp.name}-no-draft-role.png`), opts)))
    } else {
      check(vp.name, 'no-draft-role: the Agreements tab is not offered, so no Add agreement', (await ro.getByRole('link', { name: /Add agreement|New revision/ }).count()) === 0)
      await ro.screenshot({ path: path.join(OUT_DIR, `${vp.name}-no-draft-role.png`) })
    }
    await readonly.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
