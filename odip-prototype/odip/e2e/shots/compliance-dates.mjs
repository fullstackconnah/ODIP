// Compliance dates: the Settings list, add/edit panel, delete confirm and the Tasks page row. Captures plus the SHAPE section 5 numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/compliance-dates.mjs <outdir>
// Sign-in, the provider row, /compliance-items and /tasks are stubbed with page.route (synthetic rows). The clock is pinned to 2026-11-06 10:00 Sydney, so the stub rows' daysLeft are exact.
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

const NOW = new Date('2026-11-06T10:00:00+11:00')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const provider = {
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Sydney NSW 2000',
  state: 'NSW', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null, timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}
const item = (id, kind, label, expiresOn, daysLeft, over = {}) => ({ id, kind, label, expiresOn, reference: null, notes: null, daysLeft, ...over })
const LONG = 'Public liability and professional indemnity insurance, all sites and vehicles'
// Days from 6 Nov 2026: -3, 0, 21, 75, 400.
const ITEMS = [
  item('c1', 'Insurance', LONG, '2026-11-03', -3, { reference: 'POL-77120-AU' }),
  item('c2', 'Audit', 'Certification audit', '2026-11-06', 0),
  item('c3', 'KeyPersonnel', 'Sam Lee, Chief executive', '2026-11-27', 21, { reference: 'WWCC-1234567' }),
  item('c4', 'MidTermAudit', 'Mid-term audit', '2027-01-20', 75),
  item('c5', 'Registration', 'NDIS registration', '2027-12-11', 400, { reference: 'REG-000123', notes: 'Renew online.' }),
]
const task = (id, title, dueDate) => ({ id, taskType: 'ComplianceDue', title, ownerId: null, ownerName: null, priority: 'Medium', dueDate, status: 'NotStarted', completedDate: null, notes: null, linkTo: '/settings?tab=compliance', sourceKey: `compliance:${id}`, participantBookingId: null, accommodationReservationId: null, vehicleAssignmentId: null, staffAssignmentId: null })
const TASKS = [
  task('t1', 'Public liability insurance expired on 3 Nov 2026', '2026-11-03'),
  task('t2', 'Sam Lee, Chief executive expires within 30 days, on 27 Nov 2026', '2026-11-27'),
  task('t3', 'Mid-term audit is due on 20 Jan 2027', '2027-01-20'),
]
const SERVER_ERROR = 'Could not save the date. Try again.'
const EMPTY_ADMIN = "No compliance dates yet. Start with your registration: add the date it expires, and we'll remind your Admins 90 days before."
const EMPTY_COORD = 'No compliance dates yet. An Admin can add them here.'

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openPage(browser, vp, { role = 'Admin', username = 'dev.admin', items = ITEMS, fail = false, dark = false, hang = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  const sent = []
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope(provider) }))
  await page.route('**/api/v1/compliance-items**', async (r) => {
    const req = r.request()
    if (req.method() === 'GET') {
      if (hang) return // never answered: the loading skeleton
      if (fail) return r.fulfill({ status: 500, json: { success: false, data: null, message: 'Server error', errors: ['Server error'] } })
      return r.fulfill({ json: envelope(items) })
    }
    sent.push({ method: req.method(), body: JSON.parse(req.postData() ?? '{}') })
    return r.fulfill({ status: 400, json: { success: false, data: null, message: SERVER_ERROR, errors: [SERVER_ERROR] } })
  })
  await page.route('**/api/v1/tasks**', (r) => r.request().method() === 'GET'
    ? r.fulfill({ json: envelope({ items: TASKS, totalCount: TASKS.length, page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrevious: false }) })
    : r.fallback())
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page, sent }
}

const setDark = (page, dark) => dark ? page.evaluate(() => { document.documentElement.dataset.theme = 'dark' }) : Promise.resolve()
const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${ctx}: no horizontal scroll`, o <= 0, o)
}
// Every visible button, input and select inside `root` has at least 44px of height to tap, its own box or its TAP_AREA pad.
const tapTargets = async (root, ctx) => {
  const small = await root.evaluate((el) => [...el.querySelectorAll('button, select')].filter((e) => {
    const b = e.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0) || getComputedStyle(e).visibility === 'hidden') return false
    const pad = parseFloat(getComputedStyle(e, '::before').height) || 0
    return Math.max(b.height, pad) < 43.5
  }).map((e) => `${e.tagName} ${(e.getAttribute('aria-label') || e.textContent || e.name || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`))
  check(`${ctx}: tap targets at least 44 high`, small.length === 0, small)
}
const crop = async (page, locator, name, vp, pad = 16) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
const openSettings = async (page, dark, ready = 'Add a date') => {
  await page.goto(`${BASE_URL}/settings?tab=compliance`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  if (ready) await page.getByRole('button', { name: ready }).waitFor({ state: 'visible', timeout: 60_000 })
  await setDark(page, dark)
  await page.waitForTimeout(400)
}

// Relative luminance contrast of a badge's text against its own background (alpha over the page), read from computed styles.
const chipContrast = (page) => page.evaluate(() => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 } }
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
  const under = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.99) return c } return { r: 255, g: 255, b: 255, a: 1 } }
  return [...document.querySelectorAll('tbody span, tbody div')].filter((e) => /^(Overdue|Due soon|Current)$/.test(e.textContent.trim()) && e.children.length === 0).map((e) => {
    const fg = parse(getComputedStyle(e).color); let bg = parse(getComputedStyle(e).backgroundColor); const base = under(e.parentElement)
    if (!bg || bg.a === 0) bg = base
    else if (bg.a < 1) bg = { r: bg.r * bg.a + base.r * (1 - bg.a), g: bg.g * bg.a + base.g * (1 - bg.a), b: bg.b * bg.a + base.b * (1 - bg.a), a: 1 }
    const [a, b] = [lum(fg), lum(bg)]
    return { text: e.textContent.trim(), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
  })
})

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const tag = vp.touch ? `${vp.name}-touch` : vp.name
  const geometry = async (page, ctx) => {
    await noHScroll(page, ctx)
    if (!vp.touch) {
      const inner = await page.evaluate(() => { const w = document.querySelector('table')?.parentElement; return w ? w.scrollWidth - w.clientWidth : 0 })
      check(`${ctx}: the table has no inner scroll`, inner <= 0, inner)
    }
  }

  // list-admin (light and dark)
  for (const dark of [false, true]) {
    const state = dark ? 'list-admin-dark' : 'list-admin'
    try {
      const { context, page } = await openPage(browser, vp, { dark })
      await openSettings(page, dark)
      const main = page.locator('main').first()
      if (!vp.touch) {
        const headers = await page.locator('thead th').allInnerTexts()
        check(t(`${state}: headers are Kind, Name, Expires on, Status, Reference, Actions`), JSON.stringify(headers.map((h) => h.trim())) === JSON.stringify(['Kind', 'Name', 'Expires on', 'Status', 'Reference', 'Actions']), headers)
      }
      const chips = await chipContrast(page)
      check(t(`${state}: chips read Overdue, Due soon, Due soon, Due soon, Current`), JSON.stringify(chips.map((c) => c.text)) === JSON.stringify(['Overdue', 'Due soon', 'Due soon', 'Due soon', 'Current']), chips)
      check(t(`${state}: chip text contrast at least 4.5:1`), chips.length === 5 && chips.every((c) => c.ratio >= 4.5), chips.map((c) => `${c.text} ${c.ratio.toFixed(2)}`))
      check(t(`${state}: rows are soonest first`), (await page.locator('tbody tr').first().innerText()).includes('Public liability'))
      await geometry(page, t(state))
      if (vp.touch) await tapTargets(main, t(state))
      await crop(page, main, `${state}-${tag}.png`, vp)
      if (!dark) checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${state}-${tag}.png`), { touch: vp.touch })).checks)
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }

  // list-coordinator: read only
  try {
    const { context, page } = await openPage(browser, vp, { role: 'Coordinator', username: 'dev.coord' })
    await openSettings(page, false, null)
    await page.getByText('NDIS registration').first().waitFor({ state: 'visible', timeout: 60_000 })
    const main = page.locator('main').first()
    if (!vp.touch) {
      const headers = (await page.locator('thead th').allInnerTexts()).map((h) => h.trim())
      check(t('list-coordinator: headers are the first five'), JSON.stringify(headers) === JSON.stringify(['Kind', 'Name', 'Expires on', 'Status', 'Reference']), headers)
    }
    const buttons = await page.locator('section button, [role=tabpanel] button, main button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()))
    const section = await page.evaluate(() => { const h = [...document.querySelectorAll('main *')].find((e) => e.children.length === 0 && /Only Admins can change this list/.test(e.textContent)); return !!h })
    check(t('list-coordinator: the lock callout shows'), section)
    check(t('list-coordinator: no Add, Edit or Delete button in the section'), !buttons.some((b) => /^(Add a date|Edit|Delete)/.test(b)), buttons)
    await geometry(page, t('list-coordinator'))
    await crop(page, main, `list-coordinator-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('list-coordinator ran'), false, String(e.message).split('\n')[0]) }

  // empty-admin, empty-coordinator
  for (const [state, role, username, text] of [['empty-admin', 'Admin', 'dev.admin', EMPTY_ADMIN], ['empty-coordinator', 'Coordinator', 'dev.coord', EMPTY_COORD]]) {
    try {
      const { context, page } = await openPage(browser, vp, { role, username, items: [] })
      await openSettings(page, false, role === 'Admin' ? 'Add a date' : null)
      await page.getByText(text).waitFor({ state: 'visible', timeout: 60_000 })
      check(t(`${state}: empty sentence matches`), true)
      await geometry(page, t(state))
      await crop(page, page.locator('main').first(), `${state}-${tag}.png`, vp)
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }

  // loading, error
  try {
    const { context, page } = await openPage(browser, vp, { hang: true })
    await openSettings(page, false)
    check(t('loading: Add stays visible while the list loads'), await page.getByRole('button', { name: 'Add a date' }).isVisible())
    await page.evaluate(() => document.getAnimations().forEach((a) => a.pause())) // the skeleton pulses; hold it still for the frame
    await crop(page, page.locator('main').first(), `loading-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('loading ran'), false, String(e.message).split('\n')[0]) }
  try {
    const { context, page } = await openPage(browser, vp, { fail: true })
    await openSettings(page, false)
    await page.getByRole('button', { name: /Try again/ }).first().waitFor({ state: 'visible', timeout: 60_000 })
    check(t('error: the house retry button shows'), true)
    await noHScroll(page, t('error'))
    await crop(page, page.locator('main').first(), `error-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('error ran'), false, String(e.message).split('\n')[0]) }

  // add-panel (light, dark), add-panel-errors, edit-panel-server-error
  for (const dark of [false, true]) {
    const state = dark ? 'add-panel-dark' : 'add-panel'
    try {
      const { context, page } = await openPage(browser, vp, { dark })
      await openSettings(page, dark)
      await page.getByRole('button', { name: 'Add a date' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(400)
      if (!dark) {
        check(t('add-panel: title and description match'), (await dialog.getByText('Add a compliance date').isVisible()) && (await dialog.getByText("We'll remind your Admins on the Tasks page 90 days before this date.").isVisible()))
        const kinds = await dialog.getByLabel(/^Kind/).locator('option').allInnerTexts()
        check(t('add-panel: Kind lists the five kinds, Registration first'), JSON.stringify(kinds) === JSON.stringify(['Registration', 'Audit', 'Mid-term audit', 'Insurance', 'Key personnel']), kinds)
        check(t('add-panel: Registration is the default and the Name placeholder follows it'), (await dialog.getByLabel(/^Kind/).inputValue()) === 'Registration' && (await dialog.getByLabel(/^Name/).getAttribute('placeholder')) === 'e.g. NDIS registration')
        await dialog.getByLabel(/^Kind/).selectOption('KeyPersonnel')
        check(t('add-panel: Key personnel shows its hint and placeholder'), (await dialog.getByText("The person's name and role.").isVisible()) && (await dialog.getByLabel(/^Name/).getAttribute('placeholder')) === 'e.g. Sam Lee, Chief executive')
        await dialog.getByLabel(/^Kind/).selectOption('Registration')
        check(t('add-panel: date and reference hints match'), (await dialog.getByText("The last day it's valid. For an audit, the day it's due.").isVisible()) && (await dialog.getByText('A registration, policy or certificate number.').isVisible()))
      }
      await geometry(page, t(state))
      if (vp.touch) await tapTargets(dialog, t(state))
      await crop(page, dialog, `${state}-${tag}.png`, vp, 0)
      if (!dark) {
        // validation: blank name and date
        await dialog.getByRole('button', { name: 'Save' }).click()
        await dialog.getByText('Enter a name.').waitFor({ state: 'visible', timeout: 10_000 })
        check(t('add-panel-errors: both sentences show'), (await dialog.getByText('Enter a name.').isVisible()) && (await dialog.getByText('Enter the date it expires.').isVisible()))
        const save = await dialog.getByRole('button', { name: 'Save' }).boundingBox()
        const vh = page.viewportSize().height
        check(t('add-panel-errors: Save fully inside the viewport'), !!save && save.y >= 0 && save.y + save.height <= vh, save)
        await crop(page, dialog, `add-panel-errors-${tag}.png`, vp, 0)
        await dialog.getByLabel(/^Name/).fill('Old policy')
        await dialog.getByLabel(/^Expires on/).fill('1999-12-31')
        await dialog.getByRole('button', { name: 'Save' }).click()
        await dialog.getByText('Use a date between 2000 and 2100.').waitFor({ state: 'visible', timeout: 10_000 })
        check(t('add-panel-errors: the 2000-2100 sentence shows'), true)
      }
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }
  try {
    const { context, page, sent } = await openPage(browser, vp)
    await openSettings(page, false)
    await page.getByRole('button', { name: 'Edit: NDIS registration' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible', timeout: 30_000 })
    check(t('edit-panel: title and the saved values show'), (await dialog.getByText('Edit compliance date').isVisible()) && (await dialog.getByLabel(/^Name/).inputValue()) === 'NDIS registration' && (await dialog.getByLabel('Notes').inputValue()) === 'Renew online.')
    await dialog.getByLabel(/^Reference/).fill('REG-000124')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await dialog.getByText(SERVER_ERROR).waitFor({ state: 'visible', timeout: 10_000 })
    check(t('edit-panel-server-error: the sentence shows, the panel stays open, one PUT sent'), (await dialog.isVisible()) && sent.length === 1 && sent[0].method === 'PUT' && sent[0].body.reference === 'REG-000124', sent)
    await noHScroll(page, t('edit-panel-server-error'))
    await crop(page, dialog, `edit-panel-server-error-${tag}.png`, vp, 0)
    await context.close()
  } catch (e) { check(t('edit-panel-server-error ran'), false, String(e.message).split('\n')[0]) }

  // delete-confirm
  try {
    const { context, page } = await openPage(browser, vp)
    await openSettings(page, false)
    await page.getByRole('button', { name: 'Delete: Mid-term audit' }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await dialog.first().waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(400)
    check(t('delete-confirm: title and message match'), (await dialog.getByText('Delete this date?').isVisible()) && (await dialog.getByText("Delete Mid-term audit? Its reminder on the Tasks page closes too. This can't be undone.").isVisible()))
    if (vp.touch) await tapTargets(dialog.first(), t('delete-confirm'))
    await noHScroll(page, t('delete-confirm'))
    await crop(page, dialog.first(), `delete-confirm-${tag}.png`, vp, 0)
    await context.close()
  } catch (e) { check(t('delete-confirm ran'), false, String(e.message).split('\n')[0]) }

  // tasks-page-compliance
  try {
    const { context, page } = await openPage(browser, vp)
    await page.goto(`${BASE_URL}/tasks`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('Public liability insurance expired on 3 Nov 2026').first().waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)
    const text = await page.locator('main').first().innerText()
    check(t('tasks-page-compliance: band-1, band-2 and expired titles show'), text.includes('Mid-term audit is due on 20 Jan 2027') && text.includes('Sam Lee, Chief executive expires within 30 days, on 27 Nov 2026') && text.includes('Public liability insurance expired on 3 Nov 2026'))
    if (!vp.touch) check(t('tasks-page-compliance: the Type column reads Compliance date'), text.includes('Compliance date'))
    await noHScroll(page, t('tasks-page-compliance'))
    await crop(page, page.locator('main').first(), `tasks-page-compliance-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('tasks-page-compliance ran'), false, String(e.message).split('\n')[0]) }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
