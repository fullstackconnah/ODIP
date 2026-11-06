// Several agreements per participant, PR B. Light theme, reduced motion, 390 touch and 1280. Data comes from the mock API: the script makes its own agreements through the
// save and approve routes (p-0004: Core approved + a revision draft + an approved Trip; p-0005: a Core draft + a Trip with an 80-character name; p-0001: one ended agreement;
// p-0003: one plain agreement; p-0006: none). Numeric checks C1-C9 of SHAPE-B section 12 run on the live DOM; exit 1 on any failure.
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { prepareOutDir, cropElement, checkCropHolds, overlapCheck, writeChecks } from '../shots/lib/capture.mjs'

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
// F6 (SHAPE-B 4, C8): no budget verdict anywhere in the feature, so every capture state scans the whole body.
const VERDICT = /within budget|\bfits\b|under budget/i
const ids = { trip: '', long: '' }

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
  const tripOf = async (id, kind) => (await call('GET', `participants/${id}/service-agreement-drafts`))?.find((d) => d.agreementKind === kind)?.agreementId ?? ''
  ids.trip = await tripOf('p-0004', 'Trip')
  ids.long = await tripOf('p-0005', 'Trip')
  console.log(`[prepare] trip agreement ${ids.trip}, long-named agreement ${ids.long}`)
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
        const file = path.join(OUT_DIR, `${vp.name}-${state}.png`)
        const result = await cropElement(page, locator, file, { ...opts, during: (clip) => overlapCheck(locator, clip, `${vp.name}-${state}.png`), ...extra })
        checks.push(checkCropHolds(result))
        if (result.measured) checks.push(result.measured)
        rec(`C8 ${state}: no budget verdict wording on the page`, !VERDICT.test(await page.locator('body').innerText()))
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

    // The mock's budgets are healthy, so the check answers over budget for these states (the wording is the vitest's; the shot shows the layout).
    const overBudget = async (route) => {
      const response = await route.fetch()
      const json = await response.json()
      const data = json.data ?? json
      const pools = (data.pools ?? []).map((pool, i) => (i === 0 ? { ...pool, combinedCost: (pool.combinedCost ?? 0) + 1234.5, combinedOverBy: 1234.5 } : pool))
      const others = data.otherAgreements?.length ? data.otherAgreements : [{ agreementId: 'x', agreementKind: 'Trip', agreementName: 'Trip to Cairns', version: 1 }]
      const patched = { ...data, combinedOver: true, pools, otherAgreements: others }
      await route.fulfill({ response, json: json.data ? { ...json, data: patched } : patched })
    }
    await page.route('**/funding/agreement-check', overBudget)
    // waiting-revision and two agreements (p-0004): C1, C2, C3, C6, C8, combined-participant.
    await participantPage('p-0004')
    await page.getByText(/Together, these agreements plan more than/).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
    await snap('two-agreements', agreementsCard())
    await snap('combined-participant', page.getByRole('status').filter({ hasText: /Together, these agreements plan more than/ }).first())
    const add = agreementsCard().getByRole('link', { name: 'Add agreement' }).first()
    if (await add.count()) {
      const box = await add.boundingBox()
      rec('C1 Add agreement height = --control-h-sm', near(box.height, sm), `${box.height} vs ${sm}`)
      if (vp.touch) {
        const hit = await add.evaluate((el) => { const after = getComputedStyle(el, '::before'); return Math.max(el.getBoundingClientRect().height, parseFloat(after.height) || 0) })
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

    // waiting-revision: p-0004's Core has a newer revision waiting, and its Trip is approved and read only. The Trip's page is the one that locks.
    await open(`/participants/p-0004/agreement-draft?agreement=${ids.trip}`)
    await page.getByText('Approved for rostering').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
    rec('waiting-revision: the lock callout reads Approved for rostering, read only', (await page.getByText(/This agreement is read only/).count()) > 0)
    await snap('waiting-revision', page.locator('main'))

    // named-80-mobile (p-0005): C5.
    await participantPage('p-0005')
    const long = agreementsCard().locator('h4', { hasText: LONG_NAME.slice(0, 30) }).first()
    await snap('named-80-mobile', agreementsCard(), { natural: true, hideChrome: true })
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
    // add-errors: an unsaved agreement of p-0005 saved with an 81-character name and no type; the server names both fields (state 9), then answers 409 (no agreement named).
    const saveRoute = (status, errors) => async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await route.fulfill({ status, json: { success: false, data: null, message: null, errors } })
    }
    const draftUrl = '**/api/v1/participants/p-0005/service-agreement-drafts'
    const toSave = async () => {
      for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next', exact: true }).click().catch(() => {})
      await page.waitForTimeout(400)
      await page.getByRole('button', { name: 'Save agreement', exact: true }).click().catch(() => {})
    }
    await open(`/participants/p-0005/agreement-draft?agreement=${ids.long}`)
    await page.getByLabel('Name (optional)').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByLabel('Name (optional)').fill('N'.repeat(81))
    await page.route(draftUrl, saveRoute(400, ['Choose the agreement type.', 'Keep the agreement name to 80 characters.']))
    await toSave()
    await page.getByText('Keep the agreement name to 80 characters.').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
    rec('add-errors: both inline messages are on screen', (await page.getByText('Choose the agreement type.').count()) > 0 && (await page.getByText('Keep the agreement name to 80 characters.').count()) > 0)
    await snap('add-errors', page.locator('main'))
    await page.unroute(draftUrl)
    await page.route(draftUrl, saveRoute(409, []))
    await toSave()
    await page.getByText('Reload to choose which agreement to edit.').first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
    rec('add-errors: the 409 says Reload to choose which agreement to edit.', (await page.getByText('Reload to choose which agreement to edit.').count()) > 0)
    await snap('add-errors-409', page.locator('main'))
    await page.unroute(draftUrl)
    await open('/participants/p-0004/agreement-draft?agreement=00000000-0000-0000-0000-00000000dead')
    await snap('unknown-id', page.locator('main'))
    await open('/participants/p-0004/agreement-draft?agreement=p-0004')
    const next = page.getByRole('button', { name: 'Next', exact: true })
    await next.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
    for (let i = 0; i < 2; i++) await next.click().catch(() => {})
    await page.getByText(/Together with the other agreements/).first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    rec('combined-draft: the Callout is on step 3 Check, under the budget', (await page.getByText('Against the participant').count()) > 0 && (await page.getByText(/Together with the other agreements, this plans more than/).count()) > 0)
    await snap('combined-draft', page.locator('main'))
    await page.unroute('**/funding/agreement-check', overBudget)
    await open('/participants/p-0003/agreement-draft')
    await next.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
    for (let i = 0; i < 3; i++) await next.click().catch(() => {})
    await page.waitForTimeout(600)
    await snap('combined-none', page.locator('main'))

    // Lists: the Agreements page (two agreements of one participant, bulk items), the roster notice, the alerts.
    await open('/agreements')
    await snap('agreements-list-two', page.locator('main'))
    // bulk-items: Amy Ng's two agreements (no draft waiting, so skipped) with Cal Ng and Dee Ng (a draft waiting each), then Approve.
    const tick = async (name, nth) => page.getByText(name, { exact: true }).nth(nth).locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]').locator('input[type="checkbox"]').first().check().catch(() => {})
    await tick('Amy Ng', 0); await tick('Amy Ng', 1); await tick('Cal Ng', 0); await tick('Dee Ng', 0)
    const approveButton = page.getByRole('button', { name: /^Approve [0-9]/ }).first()
    if (!(await approveButton.count())) { await page.getByRole('button', { name: 'Actions' }).first().click().catch(() => {}); await page.getByRole('option', { name: /^Approve/ }).first().click().catch(() => {}) } else await approveButton.click().catch(() => {})
    await snap('bulk-items', page.getByRole('dialog').first())
    // approve-skipped: the skipped sentence follows the first one with a space (no "it.2 ticked rows").
    rec('approve-skipped: a space between the two sentences', /made from it. d+ ticked rows? ha(s|ve) no draft/.test(await page.getByRole('dialog').first().innerText()))
    await snap('approve-skipped', page.getByRole('dialog').first())
    await page.keyboard.press('Escape')
    // The mock's board has no waiting agreements, so the board answer carries two of one participant's.
    const boardUrl = '**/api/v1/rostering/board*'
    await page.route(boardUrl, async (route) => {
      const response = await route.fetch()
      const json = await response.json()
      const data = json.data ?? json
      const waits = [
        { participantId: 'p-0004', displayName: 'Amy Ng', draftId: 'draft-p-0004-v2', version: 2, canReceiveServices: true, agreementId: 'p-0004', agreementKind: 'Core', agreementName: null },
        { participantId: 'p-0004', displayName: 'Amy Ng', draftId: 'draft-p-0004-t-v1', version: 1, canReceiveServices: true, agreementId: ids.trip || 'trip', agreementKind: 'Trip', agreementName: 'Trip to Cairns' },
      ]
      const patched = { ...data, pendingAgreements: waits }
      await route.fulfill({ response, json: json.data ? { ...json, data: patched } : patched })
    })
    await open('/rostering')
    await page.getByRole('button', { name: /2 agreements waiting/ }).first().click().catch(() => {})
    const waitingPanel = page.getByRole('dialog', { name: 'Agreements waiting for approval' })
    await waitingPanel.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
    rec('pending-two: names the two agreements and links each to ?agreement=', (await waitingPanel.getByText(/2 agreements are waiting for approval:/).count()) === 1 && (await waitingPanel.locator('a[href*="?agreement="]').count()) === 2)
    await snap('pending-two', waitingPanel, { pad: 0 })
    await page.unroute(boardUrl)
    await open('/participants/p-0004')
    const endingText = page.getByText(/Trip to Cairns: Agreement ends in/).first()
    await endingText.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
    rec('ending-two: the alert names its agreement', (await endingText.count()) > 0, await endingText.textContent().catch(() => 'missing'))
    await snap('ending-two', endingText.locator('xpath=ancestor::*[self::ul or self::div][1]'))

    // preview-overlap: the approval dialog told another agreement's pattern overlaps.
    await page.route('**/api/v1/participants/p-0004/service-agreement-drafts/*/approval-preview', async (route) => {
      const response = await route.fetch()
      const json = await response.json()
      const data = json.data ?? json
      await route.fulfill({ response, json: { ...json, ...(json.data ? { data: { ...data, otherAgreementOverlaps: 2 } } : { ...data, otherAgreementOverlaps: 2 }) } })
    })
    await open('/participants/p-0004/agreement-draft?agreement=p-0004')
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
    await agreementsCard().getByText(/Couldn.t load this agreement list/).waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
    rec('error: the error copy is on screen', (await agreementsCard().getByText(/Couldn.t load this agreement list/).count()) > 0)
    await snap('error', agreementsCard())
    await page.unroute('**/api/v1/participants/p-0003/service-agreement-drafts')
    await context.close()

    // no-draft-role: a role that cannot start or edit agreements sees no Add agreement.
    const readonly = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
    const ro = await signIn(readonly, 'SupportWorker')
    await ro.goto(`${BASE_URL}/participants/p-0004?tab=agreements`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await ro.locator('#agreements').getByText(/Trip to Cairns/).first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
    const roCard = ro.locator('#agreements')
    if (await roCard.count()) {
      check(vp.name, 'no-draft-role: the card lists the agreements and offers no Add agreement or New revision', (await roCard.getByText(/Trip to Cairns/).count()) > 0 && (await roCard.getByRole('link', { name: /Add agreement|New revision/ }).count()) === 0)
      checks.push(checkCropHolds(await cropElement(ro, roCard, path.join(OUT_DIR, `${vp.name}-no-draft-role.png`), opts)))
    } else {
      check(vp.name, 'no-draft-role: the Agreements tab is not offered, so no Add agreement', (await ro.getByRole('link', { name: /Add agreement|New revision/ }).count()) === 0)
      await ro.screenshot({ path: path.join(OUT_DIR, `${vp.name}-no-draft-role.png`) })
    }
    await readonly.close()
  }
  const byHash = new Map()
  for (const name of readdirSync(OUT_DIR).filter((n) => n.endsWith('.png'))) {
    const hash = createHash('md5').update(readFileSync(path.join(OUT_DIR, name))).digest('hex')
    byHash.set(hash, [...(byHash.get(hash) ?? []), name])
  }
  const same = [...byHash.values()].filter((names) => names.length > 1)
  check('all', 'no two capture states share an md5', same.length === 0, same.map((n) => n.join(' = ')).join('; '))
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
