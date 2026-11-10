// Settings history (Settings > Organisation): the list, masked bank rows, states and the SHAPE "Shots" numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/settings-history.mjs <outdir>
// Sign-in, the provider row and /audit/ProviderSettings/{id} are stubbed with page.route (synthetic rows). The clock is pinned to 2026-11-10 12:00 Sydney.
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

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

// mode: list | many (51 events) | empty | fail
async function openPage(browser, vp, { mode = 'list', role = 'Admin', username = 'dev.admin' } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope(provider) }))
  await page.route('**/api/v1/audit/ProviderSettings/*', (r) => {
    if (mode === 'fail') return r.fulfill({ status: 500, json: { success: false, data: null, message: 'Server error', errors: ['Server error'] } })
    return r.fulfill({ json: mode === 'empty' ? page1([]) : mode === 'many' ? page1(MANY, 51) : page1(LIST) })
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
    const rows = [...section.querySelectorAll('div.flex.items-start')].filter((d) => d.textContent.includes('→'))
    return { n: rows.length, over: rows.map((r) => r.getBoundingClientRect().right - right).filter((o) => o > 1) }
  })
  check(`${ctx}: every field row ends inside the section (${m.n} rows)`, m.n > 0 && m.over.length === 0, m)
}

// Every row (FieldDiff) starts its first value at the same x (+-1 px), and that value sits at least 4 px right of its label, so a long label wraps inside its 140 px column instead of pushing the values out of line.
const valuesAligned = async (page, ctx) => {
  const m = await page.evaluate(() => {
    const section = [...document.querySelectorAll('main section')].find((s) => s.querySelector('h2')?.textContent === 'Settings history')
    const rows = [...section.querySelectorAll('div.flex.items-start')].filter((d) => d.textContent.includes('→'))
    const cells = rows.map((r) => ({ label: r.children[0].getBoundingClientRect().right, value: r.children[1].getBoundingClientRect().left }))
    return { n: cells.length, xs: cells.map((c) => Math.round(c.value * 10) / 10), gaps: cells.map((c) => Math.round((c.value - c.label) * 10) / 10) }
  })
  const spread = Math.max(...m.xs) - Math.min(...m.xs)
  check(`${ctx}: every row's first value starts at the same x (+-1 px, ${m.n} rows)`, m.n > 0 && spread <= 1, m.xs)
  check(`${ctx}: every value starts at least 4 px right of its label`, m.n > 0 && m.gaps.every((g) => g >= 4), m.gaps)
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
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
