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

/** Crop the group (plus the foot when `withFoot`) in its natural place and prove the frame shows what its name says: select value, dirty or not, foot text, and select/hint/foot inside the clip and not covered by the foot or bottom nav. */
const shoot = async (t, ctx, name, want, { withFoot = false, touch = false } = {}) => {
  const inClip = (b, c) => !!b && b.x >= c.x - 1 && b.y >= c.y - 1 && b.x + b.width <= c.x + c.width + 1 && b.y + b.height <= c.y + c.height + 1
  const uncovered = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!e && (el === e || el.contains(e) || e.contains(el)) })
  const r = await cropElement(t.page, t.group, path.join(OUT_DIR, name), {
    touch, natural: true, also: withFoot ? t.foot : undefined,
    during: async (clip) => {
      const hint = hintOf(t.group)
      const hasHint = (await hint.count()) === 1
      return {
        value: await t.select.inputValue(),
        footText: withFoot || want.dirty !== undefined ? ((await t.foot.count()) ? (await t.foot.innerText()).replace(/\s+/g, ' ').trim() : '') : null,
        selectIn: inClip(await t.select.boundingBox(), clip) && (await uncovered(t.select)),
        hintIn: hasHint ? inClip(await hint.boundingBox(), clip) && (await uncovered(hint)) : null,
        footIn: withFoot ? inClip(await t.foot.boundingBox(), clip) : null,
      }
    },
  })
  checks.push(checkCropHolds(r))
  const m = r.measured
  const pass = m.value === want.value && m.selectIn && (!want.hint || m.hintIn === true)
    && (want.dirty === undefined || (want.dirty ? /Unsaved changes/.test(m.footText ?? '') : !/Unsaved changes/.test(m.footText ?? '')))
    && (!want.foot || (m.footIn === true && (m.footText ?? '').includes(want.foot)))
  check(`content of ${name}`, ctx, { want, measured: m }, pass)
}

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
    check('4 hint lines (prefixed, after a 409) <= 3', ctx, prefixed, prefixed <= 3)
    await group.getByText(`Changed by someone else. ${HINT}`, { exact: true }).evaluate((el) => { el.textContent = el.dataset.was })
    const sel = await select.boundingBox()
    check(vp.touch ? '5 select height >= 44' : '5 select height == 32', ctx, sel.height, vp.touch ? sel.height >= 44 : near(sel.height, 32, 0.5))
    if (!vp.touch) {
      const name = await group.page().getByLabel('Organisation name').boundingBox()
      const tops = await group.evaluate((g) => {
        const top = (re) => { const el = [...g.querySelectorAll("*")].find((e) => [...e.childNodes].some((n) => n.nodeType === 3 && re.test(n.textContent.trim()))); return el ? el.getBoundingClientRect().y : null }
        return { state: top(/^State$/), zone: top(/^Time zone$/) }
      })
      check("5 zone row top equals State top", ctx, tops, tops.state !== null && tops.zone !== null && near(tops.zone, tops.state))
    }
    await shoot(t, ctx, `tz-default-${vp.name}${vp.touch ? '-touch' : ''}-light.png`, { value: 'Australia/Melbourne', dirty: false, hint: true }, { touch: !!vp.touch })
    // 3: auto-follow.
    await group.getByRole('radio', { name: 'WA' }).click()
    check('3 VIC to WA moves the zone to Perth', ctx, await select.inputValue(), (await select.inputValue()) === 'Australia/Perth')
    check('3 foot says Unsaved changes', ctx, await t.status(), (await t.status()) === 'Unsaved changes')
    await t.context.close()

    const b = await open({ role: 'Admin', ...vp, scheme: 'light', initial: { state: 'NSW', timeZoneId: 'Australia/Brisbane' } })
    await b.group.getByRole('radio', { name: 'VIC' }).click()
    check('3 a hand-set Brisbane stays when NSW becomes VIC', ctx, await b.select.inputValue(), (await b.select.inputValue()) === 'Australia/Brisbane')
    if (vp.name === '1280') await shoot(b, ctx, 'tz-filled-dirty-1280-light.png', { value: 'Australia/Brisbane', dirty: true, foot: 'Unsaved changes' }, { withFoot: true })
    const blank = await open({ role: 'Admin', ...vp, scheme: 'light', initial: { state: '', timeZoneId: null } })
    check('2 an empty State shows Sydney', ctx, await blank.select.inputValue(), (await blank.select.inputValue()) === 'Australia/Sydney')
    check('2 an empty State is not dirty', ctx, await blank.status(), (await blank.status()) === '')
    await blank.context.close()

    // 6: saving.
    b.state.putDelay = 800
    await b.select.selectOption('Australia/Perth')
    const save = b.page.getByRole('button', { name: /^(Save changes|Saving)/ })
    await save.click()
    await b.page.getByRole('button', { name: 'Saving…' }).waitFor({ timeout: 5000 })
    check('6 button reads Saving… with aria-busy', ctx, await save.getAttribute('aria-busy'), (await save.getAttribute('aria-busy')) === 'true')
    await b.foot.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 10_000 })
    check('6 foot reads Saved', ctx, await b.status(), (await b.status()) === 'Saved')
    check('6 only the changed zone and state went in the PUT', ctx, Object.keys(b.state.bodies[0]).filter((k) => ['timeZoneId', 'state'].includes(k)), b.state.bodies[0].timeZoneId === 'Australia/Perth')
    // 7: a server refusal.
    b.state.putDelay = 0
    b.state.putFail = 'Choose a time zone from the list.'
    await b.select.selectOption('Australia/Darwin')
    await save.click()
    const alert = b.foot.getByRole('alert')
    await alert.waitFor({ timeout: 10_000 })
    check('7 foot error text', ctx, await alert.innerText(), (await alert.innerText()).trim() === 'Not saved. Choose a time zone from the list.')
    if (vp.name === '1280') await shoot(b, ctx, 'tz-server-error-1280-light.png', { value: 'Australia/Darwin', foot: 'Not saved. Choose a time zone from the list.' }, { withFoot: true })
    await b.context.close()

    // Full page, once per breakpoint.
    const f = await open({ role: 'Admin', ...vp, scheme: 'light', initial: {} })
    checks.push(...(await fullPage(f.page, path.join(OUT_DIR, 'full', `org-profile-${vp.name}${vp.touch ? '-touch' : ''}-light.png`), { touch: !!vp.touch })).checks)
    await f.context.close()
  }

  // Dark at 1280 for the Admin.
  const dark = await open({ role: 'Admin', width: 1280, height: 900, scheme: 'dark', initial: {} })
  await shoot(dark, '1280 dark', 'tz-default-1280-dark.png', { value: 'Australia/Melbourne', dirty: false, hint: true })
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
    await shoot(r, ctx, `tz-readonly-390-touch-${scheme}.png`, { value: 'Australia/Melbourne', hint: true }, { touch: true })
    await r.context.close()
  }
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
