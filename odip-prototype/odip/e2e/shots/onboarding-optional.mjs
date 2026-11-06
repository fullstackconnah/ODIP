// Captures and numeric checks for optional onboarding checklist items: Settings > Onboarding checklist and the onboarding detail page (SHAPE section 6). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/onboarding-optional.mjs <outdir>
// GET/PUT /api/v1/provider-settings, the onboarding checklist and the dev sign-in are stubbed with page.route (synthetic values). Theme is pinned per context (light / dark).
// Prints "CHECK ok|FAIL name = value", writes checks.json through the capture helper, and exits non-zero when a check fails.
import path from 'node:path'
import { cropElement, fullPage, checkCropHolds, prepareOutDir, writeChecks, AU_CONTEXT } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const ID = 'p-0103'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role, tenantName: 'Sample Support Co' })
const V1 = '2026-11-06T01:00:00.123456Z'
const settingsRow = (modes) => ({
  id: 'ps-1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sunrise Support Services', address: '12 Wattle St, Brisbane QLD 4000', state: 'QLD',
  gstRegistered: true, isPaceProvider: false, bankAccountName: 'Sunrise Support', bsb: '064-000', accountNumber: '12345678', invoiceFooterNotes: null, managerName: 'Priya Sharma', managerPhone: '0412 345 007',
  timeZoneId: null, tradingName: null, contactEmail: null, contactPhone: null, website: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', onboardingItemModes: modes,
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false, updatedAt: V1,
})
const DEFAULT_MODES = { complaints: 'Required', rights: 'Required', myProvider: 'Required', budget: 'Off' }

const item = (key, label, done, optional, missing) => ({ key, label, done, optional, missing: done ? null : missing })
const MISS = { serviceNeeds: 'No current agreement draft with dated, priced support lines.', complaints: 'Record the date you explained how to make a complaint.', rights: 'Record the date you explained their rights.', funding: 'No plan budget recorded.', budget: 'No current plan budget recorded.' }
const checklist = (kind) => {
  const all = kind === 'all-done'
  const none = kind === 'none-optional'
  const items = [
    item('profile', 'Profile details', true, false, ''),
    item('serviceNeeds', 'Service needs', all || none ? true : false, false, MISS.serviceNeeds),
    item('agreement', 'Signed agreement', true, false, ''),
    item('complaints', 'Told how to make a complaint', all, !none, MISS.complaints),
    item('rights', 'Rights explained', true, !none, ''),
    item('funding', 'Funding', all || none, false, MISS.funding),
    ...(none ? [] : [item('budget', 'Plan budget added', all, true, MISS.budget)]),
  ]
  return { participantId: ID, items, isReady: items.filter((i) => !i.optional).every((i) => i.done), servicesStartedAt: null, agreementSignedOn: '2026-10-01', noAgreementReason: null, complaintsExplainedOn: all ? '2026-10-02' : null, rightsExplainedOn: '2026-10-02' }
}

const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(measured)}`)
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
/** Any CSS colour to [r, g, b] by painting one pixel. */
const rgbOf = (page, css) => page.evaluate((c) => { const k = document.createElement('canvas'); k.width = k.height = 1; const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3) }, css)
/** A length token such as --card-pad or --tap-min, resolved to px. */
const cardBg = (page) => page.evaluate(() => { const p = document.createElement('div'); p.style.cssText = 'background:var(--color-card)'; document.body.append(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c })
const token = (page, name) => page.evaluate((n) => { const p = document.createElement('div'); p.style.cssText = `position:absolute;visibility:hidden;width:var(${n})`; document.body.append(p); const w = p.getBoundingClientRect().width; p.remove(); return w }, name)

const browser = await chromium.launch({ headless: true })

/** One signed-in page. `modes` is what the settings stub holds; `kind` the checklist the stub serves. */
const open = async ({ path: route, role = 'Admin', width, height, touch, scheme = 'light', modes = DEFAULT_MODES, kind = 'mixed', ready }) => {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: !!touch, isMobile: !!touch, colorScheme: scheme, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const state = { row: settingsRow(modes), bodies: [] }
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role) }))
  await page.route('**/api/v1/provider-settings', async (r) => {
    const req = r.request()
    if (req.method() === 'GET') return r.fulfill({ json: envelope(state.row) })
    const { expectedUpdatedAt, ...fields } = JSON.parse(req.postData() ?? '{}')
    state.bodies.push(fields)
    state.row = { ...state.row, ...fields }
    return r.fulfill({ json: envelope(state.row.updatedAt) })
  })
  await page.route(`**/api/v1/inquiries/${ID}/onboarding`, (r) => r.fulfill({ json: envelope(checklist(kind)) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await ready(page).waitFor({ timeout: 60_000 })
  return { context, page, state, main: page.locator('main') }
}

const settings = (o) => open({ path: '/settings?section=onboarding', ready: (p) => p.getByRole('radiogroup', { name: 'Told how to make a complaint' }), ...o })
const detail = (o) => open({ path: `/onboarding/${ID}`, ready: (p) => p.getByRole('heading', { name: /\d+ of \d+ done$/ }), ...o })
const crop = async (t, name, locator = t.main, also) => { checks.push(checkCropHolds(await cropElement(t.page, locator, path.join(OUT_DIR, name), { natural: true, also }))) }
const overflow = async (t, ctx) => { const w = await t.page.evaluate(() => document.documentElement.scrollWidth); check('no horizontal overflow at 390', ctx, { scrollWidth: w }, w <= 390) }
const optionHeight = (page, group) => page.getByRole('radiogroup', { name: group }).getByRole('radio').first().evaluate((el) => el.getBoundingClientRect().height)

try {
  const warm = await settings({ width: 1280, height: 900 })
  await warm.context.close()

  // Settings, 1280: default, then a pick; the toggle height is the Safety checks one.
  let t = await settings({ width: 1280, height: 900 })
  await crop(t, 'settings-default.png')
  const tapMin = await token(t.page, '--tap-min')
  const mine = await optionHeight(t.page, 'Told how to make a complaint')
  await t.page.getByRole('radiogroup', { name: 'Told how to make a complaint' }).getByRole('radio', { name: 'Optional' }).click()
  await t.page.getByRole('radiogroup', { name: 'Plan budget added' }).getByRole('radio', { name: 'Optional' }).click()
  await crop(t, 'settings-optional-picked.png', t.main, t.page.getByRole('button', { name: /^Save changes/ }).locator('xpath=..'))
  const hint = t.page.getByText('NDIS-registered providers must record this (Practice Standards).').first()
  const ink = await rgbOf(t.page, await hint.evaluate((el) => getComputedStyle(el).color))
  const card = await rgbOf(t.page, await cardBg(t.page))
  check('warning-ink hint contrast >= 4.5', 'settings light', { ratio: +contrast(ink, card).toFixed(2) }, contrast(ink, card) >= 4.5)
  await t.page.goto(`${BASE_URL}/settings?section=safety`, { waitUntil: 'domcontentloaded' })
  await t.page.getByRole('radiogroup', { name: 'Participant readiness check' }).waitFor({ timeout: 60_000 })
  const safety = await optionHeight(t.page, 'Participant readiness check')
  check('toggle option height equals Safety checks and is >= --tap-min', 'settings 1280', { mine, safety, tapMin }, near(mine, safety, 0.5) && mine >= tapMin - 0.5)
  await t.context.close()

  // Read-only Coordinator, dark, and the 390 touch settings page.
  t = await settings({ width: 1280, height: 900, role: 'Coordinator' })
  await crop(t, 'settings-readonly.png')
  check('toggles are disabled for a Coordinator', 'settings readonly', {}, await t.page.getByRole('radiogroup', { name: 'Rights explained' }).getByRole('radio').first().isDisabled())
  await t.context.close()

  t = await settings({ width: 1280, height: 900, scheme: 'dark', modes: { ...DEFAULT_MODES, complaints: 'Optional' } })
  await crop(t, 'settings-dark.png')
  const dInk = await rgbOf(t.page, await t.page.getByText('NDIS-registered providers must record this (Practice Standards).').first().evaluate((el) => getComputedStyle(el).color))
  const dCard = await rgbOf(t.page, await cardBg(t.page))
  check('warning-ink hint contrast >= 4.5', 'settings dark', { ratio: +contrast(dInk, dCard).toFixed(2) }, contrast(dInk, dCard) >= 4.5)
  await t.context.close()

  t = await settings({ width: 390, height: 844, touch: true })
  await crop(t, 'settings-390.png')
  const touchH = await optionHeight(t.page, 'Rights explained')
  check('toggle option height >= 44 on a coarse pointer', 'settings 390', { touchH }, touchH >= 44 - 0.5)
  const [gb, cb] = [await t.page.getByRole('radiogroup', { name: 'Rights explained' }).boundingBox(), await t.main.boundingBox()]
  check('toggle right edge inside the card', 'settings 390', { right: gb.x + gb.width, card: cb.x + cb.width }, gb.x + gb.width <= cb.x + cb.width)
  await overflow(t, 'settings 390')
  checks.push(...(await fullPage(t.page, path.join(OUT_DIR, 'settings-full-390.png'), { touch: true })).checks)
  await t.context.close()

  // Onboarding detail: mixed, all done, none optional, budget editor open, dark, 390.
  t = await detail({ width: 1280, height: 900 })
  await crop(t, 'onboarding-mixed.png')
  const cardPad = await token(t.page, '--card-pad')
  const gap = await token(t.page, '--section-gap')
  const geo = await t.page.evaluate(() => {
    const [req, opt] = [...document.querySelectorAll('main section')]
    const li = (s) => s.querySelector('li'), pad = (s) => parseFloat(getComputedStyle(li(s)).paddingLeft)
    const fix = (s) => s.querySelector('li a, li button')?.getBoundingClientRect().height
    const icon = (s) => { const r = s.querySelector('li svg')?.getBoundingClientRect(); return r && [r.width, r.height] }
    return { reqPad: pad(req), optPad: pad(opt), between: opt.getBoundingClientRect().top - req.getBoundingClientRect().bottom, reqFix: fix(req), optFix: fix(opt), reqIcon: icon(req), optIcon: icon(opt) }
  })
  check('Optional card padding equals the required card (--card-pad)', 'detail 1280', { ...geo, cardPad }, near(geo.optPad, geo.reqPad, 0.5) && near(geo.optPad, cardPad, 0.5))
  check('gap between the cards equals --section-gap', 'detail 1280', { between: geo.between, gap }, near(geo.between, gap, 1))
  check('Optional icons are 16x16, like the required ones', 'detail 1280', { opt: geo.optIcon, req: geo.reqIcon }, geo.optIcon?.[0] === 16 && geo.optIcon?.[1] === 16)
  check('Fix button height equals the required card Fix', 'detail 1280', { req: geo.reqFix, opt: geo.optFix }, near(geo.reqFix, geo.optFix, 0.5))
  checks.push(...(await fullPage(t.page, path.join(OUT_DIR, 'onboarding-full-1280.png'), { touch: false })).checks)
  await t.page.getByRole('button', { name: /Add plan budget/ }).click()
  const dialog = t.page.getByRole('dialog').first()
  await dialog.waitFor({ state: 'visible', timeout: 15_000 })
  await t.page.waitForTimeout(400)
  await crop(t, 'onboarding-budget-open.png', dialog)
  await t.context.close()

  for (const [kind, name] of [['all-done', 'onboarding-all-done.png'], ['none-optional', 'onboarding-none-optional.png']]) {
    t = await detail({ width: 1280, height: 900, kind })
    await crop(t, name)
    await t.context.close()
  }

  t = await detail({ width: 1280, height: 900, scheme: 'dark' })
  await crop(t, 'onboarding-dark.png')
  await t.context.close()

  t = await detail({ width: 390, height: 844, touch: true })
  await crop(t, 'onboarding-390.png')
  await overflow(t, 'detail 390')
  checks.push(...(await fullPage(t.page, path.join(OUT_DIR, 'onboarding-full-390.png'), { touch: true })).checks)
  await t.context.close()
} finally {
  await browser.close()
}
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
