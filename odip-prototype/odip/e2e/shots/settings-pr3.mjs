// Captures and numeric checks for Settings PR 3: the Rostering rules section and the Participant plans window (PLAN numeric checks 1-8). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/settings-pr3.mjs <outdir>
// GET/PUT /api/v1/settings and the dev sign-in are stubbed with page.route (synthetic values), so no seeded data is needed.
// Prints "CHECK ok|FAIL name = value", writes checks.json through the capture helper, and exits non-zero when a check fails.
import path from 'node:path'
import { cropElement, fullPage, checkCropHolds, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const HINTS = {
  hours: 'Warn on the roster when a worker is rostered more than this many hours in a week. 38 unless you change it.',
  minutes: 'Send a finished shift to review when its start or finish is more than this many minutes from the roster. 15 unless you change it.',
  qualifications: 'Warn this many days before a qualification expires. Shown on Qualifications and the dashboard.',
  plans: "Warn this many days before a participant's plan ends. Shown on Participants and the dashboard.",
}
const MINUTES_ERROR = 'Enter a whole number from 1 to 240.'
const SERVER_ERROR = 'Not saved. Check your connection and try again.'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
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
const lines = (loc) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))

const browser = await chromium.launch({ headless: true })

/** One signed-in page on a section; the stub keeps the four settings and records every PUT body. */
const open = async ({ section, role = 'Admin', width, height, touch, scheme = 'light', putDelay = 0, putStatus = 200 }) => {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: !!touch, isMobile: !!touch, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: scheme, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const state = { settings: { qualificationWarningDays: 30, weeklyHoursWarning: 38, varianceReviewMinutes: 15, planExpiryWarningDays: 30 }, putDelay, putStatus, bodies: [] }
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role) }))
  await page.route('**/api/v1/settings', async (r) => {
    const req = r.request()
    if (req.method() === 'GET') return r.fulfill({ json: envelope(state.settings) })
    state.bodies.push(JSON.parse(req.postData() ?? '{}'))
    if (state.putDelay) await new Promise((res) => setTimeout(res, state.putDelay))
    if (state.putStatus !== 200) return r.fulfill({ status: state.putStatus, json: {} })
    state.settings = { ...state.settings, ...state.bodies.at(-1) }
    return r.fulfill({ json: envelope(state.settings) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/settings?section=${section}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const first = section === 'rostering' ? page.getByLabel('Weekly hours') : page.getByRole('button', { name: /Staff qualifications/ })
  await first.waitFor({ timeout: 60_000 })
  const foot = page.getByRole('button', { name: /^(Save changes|Saving)/ }).locator('xpath=..')
  return { context, page, state, main: page.locator('main'), foot, status: () => foot.getByRole('status').innerText().then((t) => t.trim()).catch(() => '') }
}

const rules = (t) => ({ hours: t.page.getByLabel('Weekly hours'), minutes: t.page.getByLabel('Shift review minutes') })
const windows = (t) => ({ quals: t.page.getByRole('button', { name: /Staff qualifications/ }), plans: t.page.getByRole('button', { name: /Participant plans/ }) })
const crop = async (t, name, touch, also) => { checks.push(checkCropHolds(await cropElement(t.page, t.main, path.join(OUT_DIR, name), { touch: !!touch, natural: true, also }))) }

try {
  const warm = await open({ section: 'rostering', width: 1280, height: 900 })
  await warm.context.close()

  for (const vp of [{ name: '1280', width: 1280, height: 900 }, { name: '390', width: 390, height: 844, touch: true }]) {
    const ctx = vp.name
    const min = vp.touch ? 44 : 32
    const t = await open({ section: 'rostering', ...vp })
    const { hours, minutes } = rules(t)
    const [hb, mb] = [await hours.boundingBox(), await minutes.boundingBox()]
    // 1 and 2: layout.
    if (vp.touch) {
      check('2 rules: one column, fields share left and width', ctx, { hb, mb }, near(hb.x, mb.x) && near(hb.width, mb.width) && mb.y > hb.y + hb.height)
    } else {
      check('1 rules: tops equal, widths equal', ctx, { hb, mb }, near(hb.y, mb.y) && near(hb.width, mb.width))
    }
    check(vp.touch ? '2 rules: inputs >= 44 tall' : '1 rules: inputs 32 tall', ctx, [hb.height, mb.height], vp.touch ? hb.height >= 44 && mb.height >= 44 : near(hb.height, 32, 0.5) && near(mb.height, 32, 0.5))
    check('1/2 rules: no horizontal overflow', ctx, await t.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), (await t.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)))
    // 3: hints.
    for (const key of ['hours', 'minutes']) {
      const hint = t.page.getByText(HINTS[key], { exact: true })
      const n = await lines(hint)
      check(`3 rules hint ${key}: exact text, lines <= ${vp.touch ? 4 : 3}`, ctx, { count: await hint.count(), lines: n }, (await hint.count()) === 1 && n <= (vp.touch ? 4 : 3))
    }
    await crop(t, `rules-default-${vp.name}${vp.touch ? '-touch' : ''}-light.png`, vp.touch)
    // 4: bounds on Shift review minutes.
    for (const [text, bad] of [['0', true], ['241', true], ['', true], ['1', false], ['240', false]]) {
      await minutes.fill(text)
      const error = t.page.getByText(MINUTES_ERROR, { exact: true })
      const shown = (await error.count()) === 1
      const invalid = (await minutes.getAttribute('aria-invalid')) === 'true'
      const foot = await t.status()
      const save = t.page.getByRole('button', { name: 'Save changes' })
      const ok = bad ? shown && invalid && foot === 'Fix 1 field to save.' && (await save.isDisabled()) : !shown && !invalid && (await save.isEnabled())
      check(`4 minutes ${JSON.stringify(text)} ${bad ? 'is refused with the exact error, aria-invalid, Fix 1 field, Save disabled' : 'is accepted and Save is enabled'}`, ctx, { shown, invalid, foot }, ok)
      if (bad && text === '241' && vp.name === '1280') await crop(t, 'rules-bound-error-1280-light.png', false, t.foot)
    }
    await t.context.close()

    // 5 and 6: saving, the bodies and the server error.
    const s = await open({ section: 'rostering', ...vp, putDelay: 800 })
    await rules(s).minutes.fill('20')
    const save = s.page.getByRole('button', { name: /^(Save changes|Saving)/ })
    await save.click()
    await s.page.getByRole('button', { name: 'Saving…' }).waitFor({ timeout: 5000 })
    check('6 button reads Saving… with aria-busy and is disabled', ctx, await save.getAttribute('aria-busy'), (await save.getAttribute('aria-busy')) === 'true' && (await save.isDisabled()))
    await s.foot.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 10_000 })
    check('6 foot reads Saved', ctx, await s.status(), (await s.status()) === 'Saved')
    check('5 rules PUT sends exactly weeklyHoursWarning and varianceReviewMinutes', ctx, s.state.bodies[0], JSON.stringify(Object.keys(s.state.bodies[0]).sort()) === JSON.stringify(['varianceReviewMinutes', 'weeklyHoursWarning']) && s.state.bodies[0].varianceReviewMinutes === 20)
    s.state.putDelay = 0
    s.state.putStatus = 500
    await rules(s).hours.fill('40')
    await save.click()
    await s.foot.getByRole('alert').waitFor({ timeout: 10_000 })
    check('6 server error text is exact, typed value kept', ctx, [await s.foot.getByRole('alert').innerText(), await rules(s).hours.inputValue()], (await s.foot.getByRole('alert').innerText()).trim() === SERVER_ERROR && (await rules(s).hours.inputValue()) === '40')
    await s.context.close()

    // Alert windows: layout, hints, body.
    const a = await open({ section: 'alerts', ...vp })
    const { quals, plans } = windows(a)
    const [qb, pb] = [await quals.boundingBox(), await plans.boundingBox()]
    if (vp.touch) check('2 alerts: one column, same left and width', ctx, { qb, pb }, near(qb.x, pb.x) && near(qb.width, pb.width) && pb.y > qb.y + qb.height)
    else check('1 alerts: tops equal, widths equal', ctx, { qb, pb }, near(qb.y, pb.y) && near(qb.width, pb.width))
    check(vp.touch ? '2 alerts: triggers >= 44 tall' : '1 alerts: triggers 32 tall', ctx, [qb.height, pb.height], vp.touch ? qb.height >= 44 && pb.height >= 44 : near(qb.height, 32, 0.5) && near(pb.height, 32, 0.5))
    check('1/2 alerts: no horizontal overflow', ctx, null, await a.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    for (const key of ['qualifications', 'plans']) {
      const hint = a.page.getByText(HINTS[key], { exact: true })
      const n = await lines(hint)
      check(`3 alerts hint ${key}: exact text, lines <= ${vp.touch ? 4 : 3}`, ctx, { count: await hint.count(), lines: n }, (await hint.count()) === 1 && n <= (vp.touch ? 4 : 3))
    }
    await crop(a, `alerts-default-${vp.name}${vp.touch ? '-touch' : ''}-light.png`, vp.touch)
    await plans.click()
    await a.page.getByRole('option', { name: '90 days' }).click()
    await a.page.getByRole('button', { name: 'Save changes' }).click()
    await a.foot.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor({ timeout: 10_000 })
    check('5 alerts PUT sends exactly qualificationWarningDays and planExpiryWarningDays', ctx, a.state.bodies[0], JSON.stringify(Object.keys(a.state.bodies[0]).sort()) === JSON.stringify(['planExpiryWarningDays', 'qualificationWarningDays']) && a.state.bodies[0].planExpiryWarningDays === 90)
    await a.context.close()

    // Full pages.
    const f = await open({ section: 'rostering', ...vp })
    checks.push(...(await fullPage(f.page, path.join(OUT_DIR, 'full', `rules-${vp.name}${vp.touch ? '-touch' : ''}-light.png`), { touch: !!vp.touch })).checks)
    await f.context.close()
  }

  // Dark: the rules section at 1280 and the 390 touch full page.
  const dark = await open({ section: 'rostering', width: 1280, height: 900, scheme: 'dark' })
  await crop(dark, 'rules-default-1280-dark.png', false)
  await dark.context.close()
  const dark390 = await open({ section: 'rostering', width: 390, height: 844, touch: true, scheme: 'dark' })
  checks.push(...(await fullPage(dark390.page, path.join(OUT_DIR, 'full', 'rules-390-touch-dark.png'), { touch: true })).checks)
  await dark390.context.close()

  // 7: the Coordinator's locked view, both sections, light and dark.
  for (const scheme of ['light', 'dark']) {
    for (const section of ['rostering', 'alerts']) {
      const ctx = `${section} 390 ${scheme}`
      const r = await open({ section, role: 'Coordinator', width: 390, height: 844, touch: true, scheme })
      const noSave = (await r.page.getByRole('button', { name: 'Save changes' }).count()) === 0
      check('7 no Save changes button', ctx, noSave, noSave)
      const lock = (await r.page.getByText('Only an Admin can change these.').count()) >= 1
      check('7 lock note present', ctx, lock, lock)
      const m = await r.page.evaluate(() => {
        const probe = document.createElement('span'); probe.style.color = 'var(--color-background)'; document.body.append(probe)
        const bg = getComputedStyle(probe).color; probe.remove()
        const inputs = [...document.querySelectorAll('main input[type=number]')]
        const triggers = [...document.querySelectorAll('main button[aria-haspopup]')]
        const text = (el) => getComputedStyle(el).color
        return { bg, inputs: inputs.map((e) => ({ readOnly: e.readOnly, color: text(e) })), triggers: triggers.map((e) => ({ disabled: e.disabled, opacity: getComputedStyle(e).opacity, color: text(e) })) }
      })
      const locked = section === 'rostering' ? m.inputs.length === 2 && m.inputs.every((i) => i.readOnly === true) : m.triggers.length >= 2 && m.triggers.every((x) => x.disabled === true && x.opacity === '1')
      check('7 inputs readOnly / dropdown triggers disabled at opacity 1', ctx, m, locked)
      const colours = [...m.inputs.map((i) => i.color), ...m.triggers.map((x) => x.color)]
      const worst = Math.min(...colours.map((c) => contrast(nums(c), nums(m.bg))))
      check('7 text contrast against the background >= 4.5', ctx, worst, worst >= 4.5)
      if (section === 'rostering' && scheme === 'light') await crop(r, 'rules-readonly-390-touch-light.png', true)
      await r.context.close()
    }
  }
  const ro = await open({ section: 'alerts', role: 'Coordinator', width: 1280, height: 900, scheme: 'dark' })
  await crop(ro, 'alerts-readonly-1280-dark.png', false)
  await ro.context.close()
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
