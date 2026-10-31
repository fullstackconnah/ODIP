// Captures and numeric checks for the organisation time zone picker (Settings PR 2a, SHAPE checks 1-9 incl. R). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/settings-time-zone.mjs <outdir>
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

const HINT = 'Changing this moves what counts as today for rosters, the portal and reminders. Times already saved stay the same.'
const ZONES = [
  ['Sydney (NSW, ACT)', 'Australia/Sydney'], ['Melbourne (VIC)', 'Australia/Melbourne'], ['Hobart (TAS)', 'Australia/Hobart'], ['Brisbane (QLD)', 'Australia/Brisbane'],
  ['Adelaide (SA)', 'Australia/Adelaide'], ['Perth (WA)', 'Australia/Perth'], ['Darwin (NT)', 'Australia/Darwin'],
]
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const row = (over) => ({
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Melbourne VIC 3000',
  state: 'VIC', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false, ...over,
})
const login = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role, tenantName: 'Sample Support Co' })

const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(measured)}`)
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const nums = (css) => { const n = css.match(/[\d.]+/g).map(Number); return css.startsWith('color(') ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3) }

const browser = await chromium.launch({ headless: true })

/** One signed-in page on the organisation section; `state` is the stub's row and knobs. */
const open = async ({ role, width, height, touch, scheme, initial, putDelay = 0, putFail = null }) => {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: !!touch, isMobile: !!touch, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: scheme, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const state = { row: row(initial), putFail, putDelay, bodies: [] }
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role) }))
  await page.route('**/api/v1/provider-settings', async (r) => {
    const req = r.request()
    if (req.method() === 'GET') return r.fulfill({ json: envelope(state.row) })
    state.bodies.push(JSON.parse(req.postData() ?? '{}'))
    if (state.putDelay) await new Promise((res) => setTimeout(res, state.putDelay))
    if (state.putFail) return r.fulfill({ status: 400, json: { success: false, data: null, message: state.putFail, errors: [state.putFail] } })
    state.row = { ...state.row, ...state.bodies.at(-1), updatedAt: '2026-10-30T02:00:00.0000000Z' }
    return r.fulfill({ json: envelope(state.row) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/settings?section=organisation`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const group = page.getByRole('region', { name: 'Address and time zone' })
  await group.waitFor({ timeout: 60_000 })
  const select = group.getByLabel('Time zone')
  await select.waitFor()
  const foot = page.getByRole('button', { name: /^(Save changes|Saving)/ }).locator('xpath=..')
  return { context, page, state, group, select, foot, status: () => foot.getByRole('status').innerText().then((t) => t.trim()) }
}

const lines = (loc) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
const hintOf = (group) => group.getByText(HINT, { exact: true })

try {
  // Warm-up: the dev server pre-bundles on the first visit.
  const warm = await open({ role: 'Admin', width: 1280, height: 900, scheme: 'light', initial: {} })
  await warm.context.close()

  const VPS = [{ name: '1280', width: 1280, height: 900 }, { name: '390', width: 390, height: 844, touch: true }]
  for (const vp of VPS) {
    const ctx = vp.name
    const t = await open({ role: 'Admin', ...vp, scheme: 'light', initial: {} })
    const { page, select, group } = t
    // 1: the option list.
    const opts = await select.evaluate((s) => [...s.options].map((o) => [o.textContent.trim(), o.value]))
    check('1 option list equals the 7 labels and values in order', ctx, opts, JSON.stringify(opts) === JSON.stringify(ZONES) && opts.every(([, v]) => v !== ''))
    // 2: the default for a null zone, not dirty.
    check('2 VIC with a null zone shows Melbourne', ctx, await select.inputValue(), (await select.inputValue()) === 'Australia/Melbourne')
    check('2 not dirty: the foot status is empty', ctx, await t.status(), (await t.status()) === '')
    // 4, 5: the hint and sizes.
    const hint = hintOf(group)
    check('4 hint text is the pinned string', ctx, await hint.count(), (await hint.count()) === 1)
    const bare = await lines(hint)
    check(`4 hint lines (bare) <= ${vp.touch ? 3 : 2}`, ctx, bare, bare <= (vp.touch ? 3 : 2))
    await hint.evaluate((el, h) => { el.dataset.was = el.textContent; el.textContent = `Changed by someone else. ${h}` }, HINT)
    const prefixed = await lines(group.getByText(`Changed by someone else. ${HINT}`, { exact: true }))
    check(`4 hint lines (prefixed) <= ${vp.touch ? 3 : 2}`, ctx, prefixed, prefixed <= (vp.touch ? 3 : 2))
    await group.getByText(`Changed by someone else. ${HINT}`, { exact: true }).evaluate((el) => { el.textContent = el.dataset.was })
    const sel = await select.boundingBox()
    check(vp.touch ? '5 select height >= 44' : '5 select height == 32', ctx, sel.height, vp.touch ? sel.height >= 44 : near(sel.height, 32, 0.5))
    if (!vp.touch) {
      const name = await group.page().getByLabel('Organisation name').boundingBox()
      const stateLabel = await group.getByText("State", { exact: true }).first().boundingBox()
      const zoneLabel = await group.getByText("Time zone", { exact: true }).first().boundingBox()
      check("5 zone row top equals State top", ctx, [zoneLabel.y, stateLabel.y], near(zoneLabel.y, stateLabel.y))
    }
    // 3: auto-follow.
    await group.getByRole('radio', { name: 'WA' }).click()
    check('3 VIC to WA moves the zone to Perth', ctx, await select.inputValue(), (await select.inputValue()) === 'Australia/Perth')
    check('3 foot says Unsaved changes', ctx, await t.status(), (await t.status()) === 'Unsaved changes')
    await cropElement(page, group, path.join(OUT_DIR, `tz-default-${vp.name}${vp.touch ? '-touch' : ''}-light.png`), { touch: !!vp.touch }).then((r) => checks.push(checkCropHolds(r)))
    await t.context.close()

    const b = await open({ role: 'Admin', ...vp, scheme: 'light', initial: { state: 'NSW', timeZoneId: 'Australia/Brisbane' } })
    await b.group.getByRole('radio', { name: 'VIC' }).click()
    check('3 a hand-set Brisbane stays when NSW becomes VIC', ctx, await b.select.inputValue(), (await b.select.inputValue()) === 'Australia/Brisbane')
    const blank = await open({ role: 'Admin', ...vp, scheme: 'light', initial: { state: '', timeZoneId: null } })
    check('2 an empty State shows Sydney', ctx, await blank.select.inputValue(), (await blank.select.inputValue()) === 'Australia/Sydney')
    check('2 an empty State is not dirty', ctx, await blank.status(), (await blank.status()) === '')
    await blank.context.close()

    // 6: saving.
    b.state.putDelay = 800
    await b.select.selectOption('Australia/Perth')
    if (vp.name === '1280') await cropElement(b.page, b.group, path.join(OUT_DIR, 'tz-filled-dirty-1280-light.png'), { touch: false }).then((r) => checks.push(checkCropHolds(r)))
    const save = b.page.getByRole('button', { name: /^(Save changes|Saving)/ })
    await save.click()
    await b.page.getByRole('button', { name: 'Saving…' }).waitFor({ timeout: 5000 })
    check('6 button reads Saving… with aria-busy', ctx, await save.getAttribute('aria-busy'), (await save.getAttribute('aria-busy')) === 'true')
    await b.foot.getByRole('status').filter({ hasText: 'Saved' }).waitFor({ timeout: 10_000 })
    check('6 foot reads Saved', ctx, await b.status(), (await b.status()).includes('Saved'))
    check('6 only the changed zone and state went in the PUT', ctx, Object.keys(b.state.bodies[0]).filter((k) => ['timeZoneId', 'state'].includes(k)), b.state.bodies[0].timeZoneId === 'Australia/Perth')
    // 7: a server refusal.
    b.state.putDelay = 0
    b.state.putFail = 'Choose a time zone from the list.'
    await b.select.selectOption('Australia/Darwin')
    await save.click()
    const alert = b.foot.getByRole('alert')
    await alert.waitFor({ timeout: 10_000 })
    check('7 foot error text', ctx, await alert.innerText(), (await alert.innerText()).trim() === 'Not saved. Choose a time zone from the list.')
    if (vp.name === '1280') await cropElement(b.page, b.group, path.join(OUT_DIR, 'tz-server-error-1280-light.png'), { touch: false }).then((r) => checks.push(checkCropHolds(r)))
    await b.context.close()

    // Full page, once per breakpoint.
    const f = await open({ role: 'Admin', ...vp, scheme: 'light', initial: {} })
    checks.push(...(await fullPage(f.page, path.join(OUT_DIR, 'full', `org-profile-${vp.name}${vp.touch ? '-touch' : ''}-light.png`), { touch: !!vp.touch })).checks)
    await f.context.close()
  }

  // Dark at 1280 for the Admin.
  const dark = await open({ role: 'Admin', width: 1280, height: 900, scheme: 'dark', initial: {} })
  await cropElement(dark.page, dark.group, path.join(OUT_DIR, 'tz-default-1280-dark.png'), { touch: false }).then((r) => checks.push(checkCropHolds(r)))
  await dark.context.close()

  // 6 (390 default crop for the hint wrap is taken above). R: the Coordinator's locked view, light and dark.
  for (const scheme of ['light', 'dark']) {
    const r = await open({ role: 'Coordinator', width: 390, height: 844, touch: true, scheme, initial: {} })
    const ctx = `390 ${scheme}`
    check('R no Save changes button', ctx, await r.page.getByRole('button', { name: 'Save changes' }).count(), (await r.page.getByRole('button', { name: 'Save changes' }).count()) === 0)
    check('R lock note present', ctx, await r.page.getByText('Only an Admin can change these.').count(), (await r.page.getByText('Only an Admin can change these.').count()) >= 1)
    const inputsLocked = await r.group.locator('input[type=text], input:not([type])').evaluateAll((els) => els.every((e) => e.readOnly === true))
    check('R every text input is readOnly', ctx, inputsLocked, inputsLocked)
    const m = await r.select.evaluate((s) => {
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-background)'
      document.body.append(probe)
      const bg = getComputedStyle(probe).color
      probe.remove()
      const input = document.querySelector('input[readonly]')
      return { disabled: s.disabled, color: getComputedStyle(s).color, opacity: getComputedStyle(s).opacity, inputColor: input ? getComputedStyle(input).color : null, bg }
    })
    check('R select disabled, input colour, opacity 1', ctx, m, m.disabled && m.color === m.inputColor && m.opacity === '1')
    const ratio = contrast(nums(m.color), nums(m.bg))
    check('R select text contrast >= 4.5', ctx, ratio.toFixed(2), ratio >= 4.5)
    await cropElement(r.page, r.group, path.join(OUT_DIR, `tz-readonly-390-touch-${scheme}.png`), { touch: true }).then((c) => checks.push(checkCropHolds(c)))
    await r.context.close()
  }
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
