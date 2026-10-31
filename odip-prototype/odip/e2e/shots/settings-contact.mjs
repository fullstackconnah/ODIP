// Captures and numeric checks for the organisation contact fields (Settings PR 2b, SHAPE checks 10-15 plus layout and no overflow). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/settings-contact.mjs <outdir>
// The provider-settings GET/PUT and the dev sign-in are stubbed with page.route (synthetic rows), so no seeded data is needed.
// Prints "CHECK ok|FAIL name = value", writes checks.json through the capture helper, and exits non-zero when a check fails.
import path from 'node:path'
import { cropElement, fullPage, checkCropHolds, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const EMAIL_ERROR = 'Enter a full email address, like office@example.com.au.'
const WEBSITE_ERROR = 'Enter the full web address, starting with https://.'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const row = (over) => ({
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Melbourne VIC 3000',
  state: 'VIC', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null,
  timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false, ...over,
})
const FILLED = { tradingName: 'Riverbend Holidays', contactEmail: 'office@example.com.au', contactPhone: '03 9123 4567', website: 'https://www.example.com.au' }
const login = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role, tenantName: 'Sample Support Co' })

const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(measured)}`)
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol

const browser = await chromium.launch({ headless: true })

const open = async ({ role, width, height, touch, scheme, initial }) => {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: !!touch, isMobile: !!touch, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: scheme, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const state = { row: row(initial), bodies: [] }
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role) }))
  await page.route('**/api/v1/provider-settings', async (r) => {
    const req = r.request()
    if (req.method() === 'GET') return r.fulfill({ json: envelope(state.row) })
    state.bodies.push(JSON.parse(req.postData() ?? '{}'))
    state.row = { ...state.row, ...state.bodies.at(-1), updatedAt: '2026-10-30T02:00:00.0000000Z' }
    return r.fulfill({ json: envelope(state.row) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/settings?section=organisation`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const group = page.getByRole('region', { name: 'Organisation contact' })
  await group.waitFor({ timeout: 60_000 })
  const names = page.getByRole('region', { name: 'Name and registration' })
  const email = group.getByLabel('Contact email')
  const phone = group.getByLabel('Contact phone')
  const site = group.getByLabel('Website')
  const foot = page.getByRole('button', { name: /^(Save changes|Saving)/ }).locator('xpath=..')
  return { context, page, state, group, names, email, phone, site, foot, save: page.getByRole('button', { name: 'Save changes' }), status: () => foot.getByRole('status').innerText().then((t) => t.trim()) }
}

/** Crop a region in its natural place and prove its frame holds (inputs in the clip, values as named). */
const shoot = async (t, ctx, region, name, { touch = false, withFoot = false, expect = {} } = {}) => {
  const r = await cropElement(t.page, region, path.join(OUT_DIR, name), {
    touch, natural: true, also: withFoot ? t.foot : undefined,
    during: async () => ({
      email: await t.email.inputValue(), website: await t.site.inputValue(),
      alerts: await t.group.getByRole('alert').allInnerTexts(),
      footText: (await t.foot.count()) ? (await t.foot.innerText()).replace(/\s+/g, ' ').trim() : '',
    }),
  })
  checks.push(checkCropHolds(r))
  const m = r.measured
  const pass = (expect.email === undefined || m.email === expect.email) && (expect.website === undefined || m.website === expect.website)
    && (expect.alerts === undefined || JSON.stringify(m.alerts) === JSON.stringify(expect.alerts))
    && (expect.foot === undefined || m.footText.includes(expect.foot))
  check(`content of ${name}`, ctx, { expect, measured: m }, pass)
}

const noOverflow = async (t, ctx) => {
  const o = await t.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check('no horizontal overflow', ctx, o, o <= 0)
}

try {
  const warm = await open({ role: 'Admin', width: 1280, height: 900, scheme: 'light', initial: {} })
  await warm.context.close()

  // 14: layout at 1280.
  const d = await open({ role: 'Admin', width: 1280, height: 900, scheme: 'light', initial: FILLED })
  {
    const ctx = '1280'
    const [e, p, w, abn, trading, legal] = await Promise.all([d.email, d.phone, d.site, d.names.getByLabel('ABN'), d.names.getByLabel('Trading name'), d.names.getByLabel('Legal name')].map((l) => l.boundingBox()))
    check('14 Contact email and Contact phone share one row', ctx, { e: e.y, p: p.y }, near(e.y, p.y, 1))
    check('14 Website sits on its own row below', ctx, { site: w.y, email: e.y + e.height }, w.y > e.y + e.height)
    check('14 phone width equals ABN width', ctx, { phone: p.width, abn: abn.width }, near(p.width, abn.width, 1))
    check('14 Trading name top equals Legal name top', ctx, { trading: trading.y, legal: legal.y }, near(trading.y, legal.y, 1))
    check('14 email is wider than phone (6 vs 3 columns)', ctx, { e: e.width, p: p.width }, e.width > p.width * 1.5)
    const labels = await d.group.evaluate((g) => [...g.querySelectorAll('label')].map((l) => { const r = l.getBoundingClientRect(); return [r.x, r.y, r.right, r.bottom] }))
    const overlap = labels.some((a, i) => labels.some((b, j) => j > i && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]))
    check('14 labels do not overlap', ctx, labels.length, labels.length >= 3 && !overlap)
    await noOverflow(d, ctx)
    await shoot(d, ctx, d.names, 'name-group-1280-light.png', { expect: {} })
    await shoot(d, ctx, d.group, 'contact-filled-1280-light.png', { expect: { email: 'office@example.com.au', website: 'https://www.example.com.au', alerts: [] } })
    // 13: clearing a stored email sends "", untouched fields echo the row's own.
    await d.email.fill('')
    check('13 clearing a stored email is dirty and valid', ctx, await d.status(), (await d.status()) === 'Unsaved changes')
    await d.save.click()
    await d.foot.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 10_000 })
    const body = d.state.bodies[0]
    check('13 PUT sends contactEmail "" for a cleared field', ctx, body.contactEmail, body.contactEmail === '')
    check('13 untouched contact fields go back as the row has them', ctx, { t: body.tradingName, p: body.contactPhone, w: body.website }, body.tradingName === FILLED.tradingName && body.contactPhone === FILLED.contactPhone && body.website === FILLED.website)
  }
  await d.context.close()
  const n = await open({ role: 'Admin', width: 1280, height: 900, scheme: 'light', initial: {} })
  await n.page.getByRole('textbox', { name: 'Address' }).fill('2 Example Street, Melbourne VIC 3000')
  await n.save.click()
  await n.foot.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 10_000 })
  const nb = n.state.bodies[0]
  check('13 an untouched null field echoes null', '1280', { t: nb.tradingName, e: nb.contactEmail, p: nb.contactPhone, w: nb.website }, nb.tradingName === null && nb.contactEmail === null && nb.contactPhone === null && nb.website === null)
  await n.context.close()

  // 10, 11, 12 at both widths.
  for (const vp of [{ name: '1280', width: 1280, height: 900 }, { name: '390', width: 390, height: 844, touch: true }]) {
    const ctx = vp.name
    const touchSuffix = vp.touch ? '-touch' : ''
    // 11: typing an invalid email shows no inline error but counts in the foot.
    const t = await open({ role: 'Admin', ...vp, scheme: 'light', initial: {} })
    await t.email.pressSequentially('office@example')
    check('11 no inline error while typing', ctx, await t.group.getByRole('alert').count(), (await t.group.getByRole('alert').count()) === 0)
    check('11 foot reads Fix 1 field to save.', ctx, await t.status(), /Fix 1 field to save\./.test(await t.foot.innerText()))
    check('11 Save is disabled', ctx, await t.save.isDisabled(), await t.save.isDisabled())
    // 10: after blur the exact sentence, role=alert and aria-invalid.
    await t.phone.focus()
    const a1 = t.group.getByRole('alert')
    check('10 email sentence after blur', ctx, await a1.allInnerTexts(), JSON.stringify((await a1.allInnerTexts()).map((s) => s.trim())) === JSON.stringify([EMAIL_ERROR]))
    check('10 email aria-invalid', ctx, await t.email.getAttribute('aria-invalid'), (await t.email.getAttribute('aria-invalid')) === 'true')
    check('10 foot reads Fix 1 field to save. (n=1)', ctx, await t.foot.innerText(), /Fix 1 field to save\./.test(await t.foot.innerText()))
    // website, bare domain.
    await t.site.fill('example.com.au')
    await t.page.keyboard.press('Tab')
    check('10 website sentence after blur', ctx, await t.group.getByRole('alert').allInnerTexts(), (await t.group.getByRole('alert').allInnerTexts()).map((s) => s.trim()).includes(WEBSITE_ERROR))
    check('10 foot reads Fix 2 fields to save. (n=2)', ctx, await t.foot.innerText(), /Fix 2 fields to save\./.test(await t.foot.innerText()))
    check('10 Save is disabled with two problems', ctx, await t.save.isDisabled(), await t.save.isDisabled())
    if (vp.touch) {
      const hs = await Promise.all([t.email, t.phone, t.site].map((l) => l.boundingBox()))
      check('14 one column at 390 with full-width fields', ctx, hs.map((b) => [Math.round(b.x), Math.round(b.width)]), hs.every((b) => near(b.x, hs[0].x, 1) && near(b.width, hs[0].width, 1)) && hs[0].width >= 390 - 2 * 16 - 2)
      check('14 controls are at least 44 high at 390', ctx, hs.map((b) => b.height), hs.every((b) => b.height >= 44))
    }
    await noOverflow(t, ctx)
    await shoot(t, ctx, t.group, `contact-invalid-${vp.name}${touchSuffix}-light.png`, { touch: !!vp.touch, withFoot: true, expect: { email: 'office@example', website: 'example.com.au', foot: 'Fix 2 fields to save.' } })
    // 10: the second fix state, n=1 again after correcting the email, still one bad field.
    await t.email.fill('office@example.com.au')
    check('10 live update clears the email sentence', ctx, await t.group.getByRole('alert').allInnerTexts(), (await t.group.getByRole('alert').count()) === 1)
    check('10 foot reads Fix 1 field to save. after the fix', ctx, await t.foot.innerText(), /Fix 1 field to save\./.test(await t.foot.innerText()))
    // 12: the website rule.
    const cases = [['example.com.au', false], ['http://example.com.au', true], ['https://www.example.com.au', true], ['', true]]
    for (const [value, valid] of cases) {
      await t.site.fill(value)
      await t.phone.focus()
      const showing = (await t.group.getByRole('alert').allInnerTexts()).some((s) => s.includes(WEBSITE_ERROR))
      check(`12 website "${value}" is ${valid ? 'valid' : 'invalid'}`, ctx, showing, showing === !valid)
    }
    await t.context.close()

    // Full page, once per breakpoint.
    const f = await open({ role: 'Admin', ...vp, scheme: 'light', initial: FILLED })
    checks.push(...(await fullPage(f.page, path.join(OUT_DIR, 'full', `org-profile-contact-${vp.name}${touchSuffix}-light.png`), { touch: !!vp.touch })).checks)
    await f.context.close()
  }

  // Dark invalid at 1280.
  const dark = await open({ role: 'Admin', width: 1280, height: 900, scheme: 'dark', initial: {} })
  await dark.email.fill('nope')
  await dark.site.fill('example.com.au')
  await dark.phone.focus()
  await dark.site.focus()
  await dark.phone.focus()
  await shoot(dark, '1280 dark', dark.group, 'contact-invalid-1280-dark.png', { withFoot: true, expect: { email: 'nope', website: 'example.com.au', foot: 'Fix 2 fields to save.' } })
  await dark.context.close()

  // 15 (R): the Coordinator's locked view.
  for (const scheme of ['light', 'dark']) {
    const r = await open({ role: 'Coordinator', width: 390, height: 844, touch: true, scheme, initial: FILLED })
    const ctx = `390 ${scheme}`
    const locked = await Promise.all([r.names.getByLabel('Trading name'), r.email, r.phone, r.site].map((l) => l.evaluate((e) => e.readOnly === true)))
    check('15 the four new inputs are readOnly', ctx, locked, locked.every(Boolean))
    check('15 no Save changes button', ctx, await r.save.count(), (await r.save.count()) === 0)
    check('15 lock note present', ctx, await r.page.getByText('Only an Admin can change these.').count(), (await r.page.getByText('Only an Admin can change these.').count()) >= 1)
    check('15 the stored email shows', ctx, await r.email.inputValue(), (await r.email.inputValue()) === FILLED.contactEmail)
    await noOverflow(r, ctx)
    if (scheme === 'light') await shoot(r, ctx, r.group, 'contact-readonly-390-touch-light.png', { touch: true, expect: { email: FILLED.contactEmail, website: FILLED.website } })
    await r.context.close()
  }
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
