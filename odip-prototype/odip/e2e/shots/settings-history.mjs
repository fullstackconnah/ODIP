// Settings history (Settings > Organisation): the list, masked bank rows, states and the SHAPE "Shots" numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/settings-history.mjs <outdir>
// Billing details > Agreement wording is checked in the same file (numeric checks 1 to 11, SHAPE section 4). Sign-in, the provider row (GET and PUT) and /audit/ProviderSettings/{id} are stubbed with page.route (synthetic rows). The clock is pinned to 2026-11-10 12:00 Sydney.
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

const NOW = new Date('2026-11-10T12:00:00+11:00')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const PS_ID = '00000000-0000-0000-0000-0000000000b1'
const provider = {
  id: PS_ID, registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Sydney NSW 2000',
  state: 'NSW', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null, timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}

const TITLE = 'Settings history'
const DESCRIPTION = "Who changed your organisation profile, billing details, safety checks and onboarding checklist, when, and from what to what. Bank details only show that they were set, changed or cleared. Some older changes weren't recorded, so they don't appear here."
// Digits that must never reach the page: the server writes only set, changed or cleared for a bank field.
const BANK_DIGITS = ['062-000', '062000', '87654321', '12345678']
const LONG_MODES = 'Complaints: Required; Rights: Required; My provider: Optional; Budget: Off, and a long note so the value wraps rather than runs on past the edge of the section'
const entry = (id, minutesAgo, changes) => ({ id, action: 'Updated', changedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(), changedByName: 'Sam Admin', changes })
const diff = (field, old, next) => ({ field, old, new: next })
const LIST = [
  entry('h1', 20, [diff('BSB', null, 'changed'), diff('AccountNumber', null, 'changed')]),
  entry('h2', 300, [diff('ParticipantReadinessMode', 'Warn', 'Enforce'), diff('GSTRegistered', 'False', 'True')]),
  entry('h3', 1500, [diff('OnboardingItemModes', 'Complaints: Required; Rights: Required; My provider: Required; Budget: Off', LONG_MODES)]),
  entry('h4', 2900, [diff('MedicationCompetencyMode', 'Warn', 'Enforce'), diff('InvoiceNumberPrefix', 'INV-', 'BUN-')]),
]
const MANY = Array.from({ length: 50 }, (_, i) => entry(`m${i}`, 10 + i, [diff('PaymentTermsDays', '14', '30')]))
const page1 = (entries, total = entries.length) => ({ entries, total, page: 1, pageSize: 50, totalPages: Math.ceil(total / 50) || 1 })

// Agreement wording fixtures (synthetic). The stored value is what the stubbed row holds; the history entries carry the same kind of text.
const WORDING_OVER = 'Enter 2,000 characters or fewer.'
const CHANGED = 'Settings were changed by someone else. Reload and try again.'
const OTHER_ADMIN = 'Cancel or change a support by telling us at least 72 hours before it starts.' // the other Admin's wording the 409 stub then serves
const RESP = ['Cancel or change a support by telling us at least 48 hours before it starts.', 'If you cancel with less notice we may charge up to the agreed amount for that support, as the NDIS price guide allows.', 'We will tell you in writing before any change to our services, our prices or how we deliver your supports, and give you time to decide.', 'You can end this agreement at any time. We ask for 14 days written notice so your supports can move smoothly to another provider.'].join('\n\n')
const COMP = ['If you have a concern or want to make a complaint, tell any of our staff or contact our manager. You will not be treated differently for raising it.', 'We acknowledge a complaint within 2 business days and aim to resolve it within 21 days, and we will keep you updated.', 'If you are not happy with the outcome you can contact the NDIS Quality and Safeguards Commission on 1800 035 544.'].join('\n\n')
const LONGER = [RESP, RESP, RESP].join('\n\n')
const MULTI = Array.from({ length: 8 }, (_, i) => `Line ${i + 1}: a short sentence on its own line.`).join('\n')
const FILLED_ROW = { ...provider, agreementResponsibilitiesTerms: RESP, agreementComplaintsTerms: COMP }
const RESP_LABEL = 'Responsibilities and cancellation', COMP_LABEL = 'Concerns and complaints'
const HIST_LABELS = ['Agreement wording: responsibilities and cancellation', 'Agreement wording: concerns and complaints']

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

// mode: list | many (51 events) | empty | fail
async function openPage(browser, vp, { mode = 'list', role = 'Admin', username = 'dev.admin', row = provider, scheme = 'light', put = 'ok', entries = LIST } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: scheme, reducedMotion: 'reduce' })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  let refused = false
  await page.route('**/api/v1/provider-settings', (r) => {
    if (r.request().method() !== 'PUT') return r.fulfill({ json: envelope(refused ? { ...row, agreementResponsibilitiesTerms: OTHER_ADMIN, updatedAt: '2026-11-10T01:10:00.0000000Z' } : row) })
    if (put === '400') return r.fulfill({ status: 400, json: { success: false, data: null, message: WORDING_OVER, errors: [WORDING_OVER] } })
    if (put === '409') { refused = true; return r.fulfill({ status: 409, json: { success: false, data: null, message: CHANGED, errors: [CHANGED] } }) }
    return r.fulfill({ json: envelope('2026-11-10T01:05:00.0000000Z') })
  })
  await page.route('**/api/v1/audit/ProviderSettings/*', (r) => {
    if (mode === 'fail') return r.fulfill({ status: 500, json: { success: false, data: null, message: 'Server error', errors: ['Server error'] } })
    return r.fulfill({ json: mode === 'empty' ? page1([]) : mode === 'many' ? page1(MANY, 51) : page1(entries) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}

const open = async (page, url, ready) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await ready(page)
  await page.waitForTimeout(400)
}
const waitText = (text) => (page) => page.getByText(text).first().waitFor({ state: 'visible', timeout: 60_000 })
const HISTORY_URL = '/settings?section=settings-history'
const tapMin = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')) || 44)
const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${ctx}: no horizontal scroll`, o <= 0, o)
}
const frame = (page, title) => page.locator('main section').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).first()
const crop = async (page, locator, name, vp, pad = 16) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
// The shell grows with the viewport (a sticky foot and min-heights), so grow the viewport until the page fits it before fullPage measures (as budget-settings-copy.mjs does).
const full = async (page, name, vp) => {
  for (let i = 0; i < 4 && !vp.touch; i++) {
    const h = await page.evaluate(() => document.scrollingElement.scrollHeight)
    if (h <= page.viewportSize().height) break
    await page.setViewportSize({ width: vp.width, height: h })
    await page.waitForTimeout(300)
  }
  checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', name), { touch: vp.touch })).checks)
}
// Every FieldDiff row (the flex line holding an arrow) must end inside the section's frame; the 140 px label column is the component's own.
const rowsInFrame = async (page, vp, ctx) => {
  const m = await page.evaluate(() => {
    const section = [...document.querySelectorAll('main section')].find((s) => s.querySelector('h2')?.textContent === 'Settings history')
    const right = section.getBoundingClientRect().right
    const rows = [...section.querySelectorAll('div.\\@container > div')].filter((d) => d.textContent.includes('→'))
    return { n: rows.length, over: rows.map((r) => r.getBoundingClientRect().right - right).filter((o) => o > 1) }
  })
  check(`${ctx}: every field row ends inside the section (${m.n} rows)`, m.n > 0 && m.over.length === 0, m)
}

// Every row (FieldDiff) starts its first value at the same x (+-1 px), and that value sits at least 4 px right of its label (or, under the 35rem container width where FieldDiff stacks the label above its values, below it), so a long label wraps inside its 140 px column instead of pushing the values out of line.
const valuesAligned = async (page, ctx) => {
  const m = await page.evaluate(() => {
    const section = [...document.querySelectorAll('main section')].find((s) => s.querySelector('h2')?.textContent === 'Settings history')
    const rows = [...section.querySelectorAll('div.\\@container > div')].filter((d) => d.textContent.includes('→'))
    const cells = rows.map((r) => { const l = r.children[0].getBoundingClientRect(), v = r.children[1].getBoundingClientRect(); return { label: l.right, value: v.left, stacked: v.top >= l.bottom } })
    return { n: cells.length, xs: cells.map((c) => Math.round(c.value * 10) / 10), gaps: cells.map((c) => (c.stacked ? 'stacked' : Math.round((c.value - c.label) * 10) / 10)) }
  })
  const spread = Math.max(...m.xs) - Math.min(...m.xs)
  check(`${ctx}: every row's first value starts at the same x (+-1 px, ${m.n} rows)`, m.n > 0 && spread <= 1, m.xs)
  check(`${ctx}: every value starts at least 4 px right of its label`, m.n > 0 && m.gaps.every((g) => g === 'stacked' || g >= 4), m.gaps)
}

// Numeric checks 1 to 6 (SHAPE section 4), measured on the live page against the invoice note field and the house tokens.
const wordingMetrics = (page) => page.evaluate(() => {
  const label = (t) => [...document.querySelectorAll('label')].find((x) => x.textContent.trim() === t)
  const field = (t) => document.getElementById(label(t).htmlFor)
  const R = (e) => e.getBoundingClientRect()
  const token = (v) => { const d = document.createElement('div'); d.style.cssText = `position:absolute;visibility:hidden;height:var(${v})`; document.body.append(d); const h = R(d).height; d.remove(); return h }
  const group = (t) => [...document.querySelectorAll('main section[aria-labelledby]')].find((s) => s.querySelector('h3')?.textContent === t)
  const hint = (t) => label(t).parentElement.querySelector('p.text-xs')
  const type = (e) => ({ size: getComputedStyle(e).fontSize, weight: getComputedStyle(e).fontWeight })
  const a = field('Responsibilities and cancellation'), b = field('Concerns and complaints'), note = field('Note at the foot of every invoice')
  const wa = a.closest('section').children[1], wb = a.closest('section').children[2]
  const countEl = document.getElementById('agreement-responsibilities-count')
  const save = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Save changes')
  return {
    width: { a: R(a).width, b: R(b).width, note: R(note).width },
    height: { a: R(a).height, b: R(b).height, control: token('--control-h'), tap: token('--tap-min') },
    gap: { before: R(group('Agreement wording')).top - R(group('Invoice note')).bottom, between: R(group('Invoice note')).top - R(group('Tax')).bottom, token: token('--section-gap') },
    field: { gap: R(wb).top - R(wa).bottom, token: token('--field-gap-y') },
    count: { text: countEl.textContent, gap: countEl.textContent ? R(countEl).top - R(hint('Responsibilities and cancellation')).bottom : null, margin: parseFloat(getComputedStyle(hint('Responsibilities and cancellation')).marginTop), size: countEl.textContent ? type(countEl).size : null, mt: getComputedStyle(countEl).marginTop, cls: countEl.className, top: R(countEl).top, hintBottom: R(hint('Responsibilities and cancellation')).bottom },
    type: { label: ['Responsibilities and cancellation', 'Concerns and complaints', 'Note at the foot of every invoice'].map((t) => type(label(t))), hint: ['Responsibilities and cancellation', 'Concerns and complaints', 'Note at the foot of every invoice'].map((t) => (hint(t) ? type(hint(t)) : null)).filter(Boolean) },
    save: save ? { height: R(save).height, disabled: save.disabled } : null,
    invalid: [a.getAttribute('aria-invalid'), b.getAttribute('aria-invalid')],
    errors: [...document.querySelectorAll('p[role="alert"]')].map((e) => e.textContent.trim()),
  }
})
const near = (x, y) => Math.abs(x - y) <= 0.5
const same = (list) => list.every((x) => x.size === list[0].size && x.weight === list[0].weight)
const layoutChecks = (m, vp, ctx) => {
  check(`${ctx}: 1 both new textareas are as wide as the invoice note's`, near(m.width.a, m.width.note) && near(m.width.b, m.width.note), m.width)
  const minH = vp.touch ? Math.max(m.height.control, m.height.tap) : m.height.control
  check(`${ctx}: 2 the two textareas are equally tall, and at least ${vp.touch ? '--tap-min' : '--control-h'} (${minH})`, near(m.height.a, m.height.b) && m.height.a >= minH, m.height)
  check(`${ctx}: 3 group gaps are equal and equal --section-gap (${m.gap.token})`, near(m.gap.before, m.gap.between) && near(m.gap.before, m.gap.token), m.gap)
  check(`${ctx}: 4 field gap equals --field-gap-y (${m.field.token})`, near(m.field.gap, m.field.token), m.field)
  check(`${ctx}: 6 label and hint type match the invoice note's`, same(m.type.label) && m.type.hint.every((h) => h.size === m.type.hint[0].size && h.size === '12px'), m.type)
}

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`

  // list with masked bank rows, the rail, the page, and (1280) the frame width against Appearance
  try {
    const { context, page } = await openPage(browser, vp)
    await open(page, HISTORY_URL, waitText('Bank account number'))
    const text = await page.locator('main').first().innerText()
    check(t('list: title and description are exact'), text.includes(TITLE) && text.includes(DESCRIPTION), text.slice(0, 120))
    check(t('list: masked rows show "changed" and no bank digits'), text.includes('changed') && !BANK_DIGITS.some((d) => text.includes(d)), BANK_DIGITS.filter((d) => text.includes(d)))
    check(t('list: the worst-case labels show'), text.includes('Participant readiness check') && text.includes('Onboarding checklist'))
    check(t('list: count line reads "4 events recorded"'), text.includes('4 events recorded'))
    await noHScroll(page, t('list'))
    await rowsInFrame(page, vp, t('list'))
    await valuesAligned(page, t('list'))
    await crop(page, frame(page, TITLE), `list-masked-${vp.name}.png`, vp)
    await full(page, `full-page-${vp.name}.png`, vp)
    if (!vp.touch) {
      const w = await frame(page, TITLE).evaluate((e) => e.getBoundingClientRect().width)
      await open(page, '/settings?section=appearance', waitText('Appearance'))
      const wa = await frame(page, 'Appearance').evaluate((e) => e.getBoundingClientRect().width)
      check(t('list: the frame is the same width as Appearance (+-1 px)'), Math.abs(w - wa) <= 1, { history: w, appearance: wa })
      await open(page, HISTORY_URL, waitText('Bank account number'))
      const nav = page.getByRole('navigation', { name: 'Settings' })
      const labels = (await nav.getByRole('link').allInnerTexts()).map((l) => l.trim())
      check(t('rail: Settings history is last in Organisation (right before Plan pricing)'), labels.indexOf(TITLE) >= 0 && labels[labels.indexOf(TITLE) + 1] === 'Plan pricing', labels)
      await crop(page, nav, 'rail-1280.png', vp)
    } else {
      // the phone list: nothing is open, every section is a row
      await open(page, '/settings', waitText(TITLE))
      const h = await page.getByRole('link', { name: TITLE }).first().evaluate((e) => e.getBoundingClientRect().height)
      const min = await tapMin(page)
      check(t(`rail: the Settings history item is at least --tap-min (${min}) tall`), h >= min - 0.5, h)
    }
    await context.close()
  } catch (e) { check(t('list ran'), false, String(e.message).split('\n')[0]) }

  // 51 events at 1280; empty and error at 390
  if (!vp.touch) {
    try {
      const { context, page } = await openPage(browser, vp, { mode: 'many' })
      await open(page, HISTORY_URL, waitText('Showing the latest 50 of 51 events'))
      const count = await page.getByText(/^Showing the latest/).first().innerText()
      check(t('over-50: the count line reads exactly "Showing the latest 50 of 51 events"'), count.trim() === 'Showing the latest 50 of 51 events', count)
      await rowsInFrame(page, vp, t('over-50'))
      await crop(page, page.getByText(/^Showing the latest/).first().locator('xpath=..'), 'over-50-1280.png', vp)
      await context.close()
    } catch (e) { check(t('over-50 ran'), false, String(e.message).split('\n')[0]) }
  } else {
    try {
      const { context, page } = await openPage(browser, vp, { mode: 'empty' })
      await open(page, HISTORY_URL, waitText('No history recorded yet.'))
      await noHScroll(page, t('empty'))
      await crop(page, frame(page, TITLE), 'empty-390.png', vp)
      await context.close()
    } catch (e) { check(t('empty ran'), false, String(e.message).split('\n')[0]) }
    try {
      const { context, page } = await openPage(browser, vp, { mode: 'fail' })
      await open(page, HISTORY_URL, async (p) => { await p.getByRole('button', { name: /try again/i }).first().waitFor({ state: 'visible', timeout: 60_000 }) })
      const h = await page.getByRole('button', { name: /try again/i }).first().evaluate((e) => e.getBoundingClientRect().height)
      const min = await tapMin(page)
      check(t(`error: Try again is at least --tap-min (${min}) tall`), h >= min - 0.5, h)
      await noHScroll(page, t('error'))
      await crop(page, frame(page, TITLE), 'error-390.png', vp)
      await context.close()
    } catch (e) { check(t('error ran'), false, String(e.message).split('\n')[0]) }
  }

  // Billing details > Agreement wording (numeric checks 1 to 11). The file name carries every token of the plan's capture state.
  const BILLING_URL = '/settings?section=billing'
  const png = (state, scheme) => `${state}-${vp.name}${vp.touch ? '-touch' : ''}-${scheme}.png`
  const sized = (n) => { let s = ''; while (s.length < n) s += 'Cancel at least 48 hours ahead. '; return `${s.slice(0, n - 1)}.` }
  const resp = (page) => page.getByLabel(RESP_LABEL, { exact: true })
  const comp = (page) => page.getByLabel(COMP_LABEL, { exact: true })
  const groupLoc = (page) => page.locator('main section[aria-labelledby]').filter({ has: page.getByRole('heading', { name: 'Agreement wording', exact: true }) }).last()
  const groupShot = (page, name) => crop(page, groupLoc(page), name, vp)
  // A foot state crops the whole frame; the 1280 viewport grows until the page fits, as full() does.
  const frameShot = async (page, name) => {
    if (!vp.touch) await page.setViewportSize({ width: vp.width, height: Math.max(900, await page.evaluate(() => document.scrollingElement.scrollHeight)) })
    await page.waitForTimeout(300)
    await crop(page, frame(page, 'Billing details'), name, vp)
  }
  const wording = async (name, opts, run) => {
    try {
      const { context, page } = await openPage(browser, vp, opts)
      await open(page, BILLING_URL, async (p) => { await resp(p).waitFor({ state: 'visible', timeout: 60_000 }) })
      await run(page)
      await context.close()
    } catch (e) { check(t(`${name} ran`), false, String(e.message).split('\n')[0]) }
  }
  const overLimit = async (page, scheme) => {
    await resp(page).fill(sized(2001))
    const m = await wordingMetrics(page)
    check(t('over limit: 9 aria-invalid, the error text, Save disabled'), m.invalid[0] === 'true' && m.errors.includes(WORDING_OVER) && m.save?.disabled === true, { invalid: m.invalid, errors: m.errors, save: m.save })
    await noHScroll(page, t('over limit'))
    await groupShot(page, png('over-limit', scheme))
  }
  const saveAnd = async (page, wait) => {
    await resp(page).fill(RESP)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await wait(page)
  }
  const waitSaved = (page) => page.getByText('Saved', { exact: true }).first().waitFor({ state: 'visible', timeout: 30_000 })

  if (!vp.touch) {
    await wording('blank', {}, async (p) => { await noHScroll(p, t('blank')); await groupShot(p, png('blank', 'light')) })
    await wording('filled light', { row: FILLED_ROW }, async (p) => {
      layoutChecks(await wordingMetrics(p), vp, t('filled'))
      await noHScroll(p, t('filled'))
      await full(p, png('filled', 'light'), vp)
    })
    await wording('filled dark', { row: FILLED_ROW, scheme: 'dark' }, async (p) => { await noHScroll(p, t('filled dark')); await groupShot(p, png('filled', 'dark')) })
    await wording('multiline', {}, async (p) => { await resp(p).fill(MULTI); await noHScroll(p, t('multiline')); await groupShot(p, png('multiline', 'light')) })
    await wording('over limit', {}, (p) => overLimit(p, 'light'))
    await wording('locked incomplete', { row: { ...provider, organisationName: '' } }, async (p) => {
      check(t('locked: both wording fields read-only'), (await resp(p).getAttribute('readonly')) !== null && (await comp(p).getAttribute('readonly')) !== null)
      await noHScroll(p, t('locked')); await groupShot(p, png('locked-incomplete', 'light'))
    })
    await wording('server 400', { put: '400' }, async (p) => {
      await saveAnd(p, (pg) => pg.getByText(WORDING_OVER).first().waitFor({ state: 'visible', timeout: 30_000 }))
      await noHScroll(p, t('server 400')); await frameShot(p, png('server-400', 'light'))
    })
    await wording('changed elsewhere', { put: '409' }, async (p) => {
      await saveAnd(p, (pg) => pg.getByText(/Someone else changed these settings/).first().waitFor({ state: 'visible', timeout: 30_000 }))
      await p.getByText(/^Changed by someone else/).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {})
      const hint = await resp(p).evaluate((el) => el.getAttribute('aria-describedby').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim())
      check(t('409: the Responsibilities hint leads with "Changed by someone else."'), hint.startsWith('Changed by someone else.'), hint)
      await noHScroll(p, t('409')); await frameShot(p, png('changed-elsewhere-409', 'light'))
    })
    try {
      const { context, page } = await openPage(browser, vp, { entries: [entry('w1', 30, [diff('AgreementResponsibilitiesTerms', RESP, LONGER), diff('AgreementComplaintsTerms', null, COMP)])] })
      await open(page, HISTORY_URL, waitText(HIST_LABELS[0]))
      for (const label of HIST_LABELS) check(t(`history: 11 label "${label}" shows exactly once`), (await page.getByText(label, { exact: true }).count()) === 1)
      await rowsInFrame(page, vp, t('history labels')); await noHScroll(page, t('history labels'))
      await crop(page, frame(page, TITLE), png('history-labels', 'light'), vp)
      await context.close()
    } catch (e) { check(t('history labels ran'), false, String(e.message).split('\n')[0]) }
  } else {
    await wording('blank dark', { scheme: 'dark' }, async (p) => { await noHScroll(p, t('blank')); await groupShot(p, png('blank', 'dark')) })
    await wording('filled', { row: FILLED_ROW }, async (p) => {
      layoutChecks(await wordingMetrics(p), vp, t('filled'))
      await noHScroll(p, t('filled')); await groupShot(p, png('filled', 'light'))
      await full(p, png('filled', 'light'), vp)
    })
    await wording('near limit', {}, async (p) => {
      await resp(p).fill(sized(1799))
      check(t('count: 10 at 1,799 trimmed characters it is empty'), (await wordingMetrics(p)).count.text === '')
      await resp(p).fill(sized(1834))
      const m = await wordingMetrics(p)
      check(t('count: 10 at 1,834 trimmed characters it reads exactly "1,834 / 2,000"'), m.count.text === '1,834 / 2,000', m.count.text)
      let rules = ''
      if (!near(m.count.gap, m.count.margin)) {
        const cdp = await p.context().newCDPSession(p)
        await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
        const { root } = await cdp.send('DOM.getDocument')
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#agreement-responsibilities-count' })
        const { matchedCSSRules } = await cdp.send('CSS.getMatchedStylesForNode', { nodeId })
        rules = matchedCSSRules.filter((r) => r.rule.style.cssProperties.some((c) => /^margin/.test(c.name))).map((r) => `${r.rule.selectorList.text} {${r.rule.style.cssText}}`).join(' | ')
      }
      check(t('count: 5 sits one hint margin below the hint, in the hint size'), near(m.count.gap, m.count.margin) && m.count.size === m.type.hint[0].size, { ...m.count, rules })
      const tap = m.height.tap
      check(t(`save: 7 Save is at least --tap-min (${tap}) tall`), m.save && m.save.height >= tap - 0.5, m.save)
      await noHScroll(p, t('near limit')); await groupShot(p, png('near-limit', 'light'))
    })
    await wording('over limit', { scheme: 'dark' }, (p) => overLimit(p, 'dark'))
    await wording('coordinator', { role: 'Coordinator', username: 'dev.coord', row: FILLED_ROW }, async (p) => {
      check(t('coordinator: both fields read-only and no Save'), (await resp(p).getAttribute('readonly')) !== null && (await comp(p).getAttribute('readonly')) !== null && (await p.getByRole('button', { name: 'Save changes' }).count()) === 0)
      await noHScroll(p, t('coordinator')); await groupShot(p, png('readonly-coordinator', 'light'))
    })
    await wording('saved', {}, async (p) => {
      await saveAnd(p, waitSaved)
      await noHScroll(p, t('saved'))
      // The group crop widened to the save foot (cropElement `also`); the foot's box is read inside the crop, so it is checked against the real clip.
      const foot = p.getByText('Saved', { exact: true }).first()
      const r = await cropElement(p, groupLoc(p), path.join(OUT_DIR, png('saved', 'light')), { touch: vp.touch, natural: true, pad: 16, also: foot, during: async () => ({ text: await foot.textContent(), box: await foot.boundingBox() }) })
      checks.push(checkCropHolds({ ...r, touch: vp.touch }))
      const { text, box: fb } = r.measured, c = r.clip
      check(t('saved: foot reads exactly "Saved" and lies inside the crop'), text?.trim() === 'Saved' && !!fb && fb.x >= c.x && fb.y >= c.y && fb.x + fb.width <= c.x + c.width + 0.5 && fb.y + fb.height <= c.y + c.height + 0.5, { text, fb, clip: c })
    })
    try {
      const { context, page } = await openPage(browser, vp, { entries: [entry('w2', 30, [diff('AgreementResponsibilitiesTerms', RESP, 'W'.repeat(2000))])] })
      await open(page, HISTORY_URL, waitText(HIST_LABELS[0]))
      const over = await page.evaluate(() => [...document.querySelectorAll('main section div[class~="@container"] > div')].filter((d) => d.textContent.includes('→')).map((d) => d.scrollWidth - d.clientWidth))
      check(t('history: 11 a 2,000-character word keeps the row inside (scrollWidth <= clientWidth)'), over.length > 0 && over.every((o) => o <= 0), over)
      await rowsInFrame(page, vp, t('history long word')); await noHScroll(page, t('history long word'))
      await crop(page, frame(page, TITLE), png('history-long-word', 'light'), vp)
      await context.close()
    } catch (e) { check(t('history long word ran'), false, String(e.message).split('\n')[0]) }
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
