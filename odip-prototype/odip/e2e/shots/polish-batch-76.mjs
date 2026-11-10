// Polish batch 76: history values read as words (PSA-O3), the FieldDiff row stacks when it is narrow (PSA-F3), the caregiver Review titles its consents row "Consents" (PB73-F1).
// Numeric: no history value reads True/False/Warn; the mode and time-zone words show; the Onboarding checklist value has one line box per item; under 35rem a FieldDiff stacks (label above its values,
// each wrapped value box at least 12rem wide or the full width), from 35rem it is today's one row (values start at the same x, 140px label column); the old value stays struck through and dimmed;
// the Consents row title is exactly "Consents"; the helper's layout checks pass on the full Settings history page at both widths. Sign-in, the provider row, /audit/ProviderSettings, /audit/deleted
// and the caregiver form are answered in the script. Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-76.mjs <outdir>
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, overlapCheck, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const NOW = new Date('2026-11-10T12:00:00+11:00')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const provider = {
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Sydney NSW 2000',
  state: 'NSW', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null, timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}

const TITLE = 'Settings history'
const entry = (id, minutesAgo, changes) => ({ id, action: 'Updated', changedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(), changedByName: 'Sam Admin', changes })
const diff = (field, old, next) => ({ field, old, new: next })
const NOTE_OLD = 'Payment is due within 14 days of the invoice date. Please quote the invoice number on every transfer so we can match it to your account.'
const NOTE_NEW = 'Payment is due within 7 days of the invoice date. Please quote the invoice number on every transfer, and email the remittance advice to accounts so we can match it to your account.'
// The server writes OnboardingItemModes as key=Mode joined by ", " (OnboardingItemModeRules.Describe).
const LIST = [
  entry('h1', 20, [diff('BSB', null, 'changed'), diff('AccountNumber', null, 'changed')]),
  entry('h2', 300, [diff('ParticipantReadinessMode', 'Warn', 'Enforce'), diff('GSTRegistered', 'False', 'True')]),
  entry('h3', 1500, [diff('OnboardingItemModes', 'complaints=Required, rights=Optional, myProvider=Required, budget=Off', 'complaints=Required, rights=Required, myProvider=Optional, budget=Off')]),
  entry('h4', 2900, [diff('MedicationCompetencyMode', 'Warn', 'Enforce'), diff('TimeZoneId', 'Australia/Sydney', 'Australia/Melbourne'), diff('State', 'NSW', 'VIC')]),
  entry('h5', 4300, [diff('InvoiceFooterNotes', NOTE_OLD, NOTE_NEW), diff('InvoiceNumberPrefix', 'INV-', 'BUN-')]),
]
const page1 = (entries) => ({ entries, total: entries.length, page: 1, pageSize: 50, totalPages: 1 })

// Deleted records: the Shift row opens to a field list that holds values and no new ones.
const held = (o) => Object.entries(o).map(([field, old]) => ({ field, old, new: null }))
const PID = '00000000-0000-0000-0000-0000000000c1'
const DELETED = [
  { id: 'd1', entityType: 'Shift', entityId: 'e-d1', deletedAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(), deletedByName: 'Sam Lee', fields: held({ ServiceDate: '2026-11-10', StartTime: '09:00:00', EndTime: '15:00:00', ParticipantId: PID, Notes: 'Community access' }) },
  { id: 'd2', entityType: 'ParticipantRiskEntry', entityId: 'e-d2', deletedAt: new Date(NOW.getTime() - 90 * 60_000).toISOString(), deletedByName: 'Priya Nair', fields: held({ Description: 'Choking risk at mealtimes', Severity: 'High', ParticipantId: PID }) },
]

// Caregiver form: one consent Granted, one Declined, a normal diagnosis.
const form = {
  status: 'Draft', caregiverName: null, caregiverRelationship: null, expiresAt: '2099-01-01T00:00:00Z', rejectionNote: null, providerName: 'Ability Options', editable: [], draft: null,
  current: {
    firstName: 'Sophie', lastName: 'Rivers',
    consents: [{ consentType: 'PhotoVideo', granted: true }, { consentType: 'Privacy', granted: false }],
    primaryDiagnosis: 'Cerebral Palsy', primaryDiagnosisOther: null, hidpaSupportCategories: 'ComplexBowelCare',
  },
}

const checks = []
const check = (name, pass, detail = '') => {
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail)
  checks.push({ name, pass: !!pass, detail: d })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${d}`)
}

async function signIn(page, role, username) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}
async function openAdmin(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope(provider) }))
  await page.route('**/api/v1/audit/ProviderSettings/*', (r) => r.fulfill({ json: page1(LIST) }))
  await page.route('**/api/v1/audit/deleted**', (r) => r.fulfill({ json: envelope({ items: DELETED, totalCount: DELETED.length, page: 1, pageSize: 25 }) }))
  await signIn(page, 'Admin', 'dev.admin')
  return { context, page }
}
const open = async (page, url, text) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByText(text).first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(400)
}
const crop = async (page, locator, name, vp, pad = 24) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${ctx}: no horizontal scroll`, o <= 0, o)
}

// Every FieldDiff in the Settings history section or in the open deleted-record detail: where the label, the values and each value box sit.
const rowsOf = (page, kind) => page.evaluate((kind) => {
  const root = kind === 'history'
    ? [...document.querySelectorAll('main section')].find((s) => s.querySelector('h2')?.textContent === 'Settings history')
    : document.querySelector('[id^="deleted-detail-"]')
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const R = (e) => { const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height } }
  const box = (e) => {
    const cs = getComputedStyle(e), lh = parseFloat(cs.lineHeight) || 16, r = R(e)
    const lis = [...e.querySelectorAll('li')].map((li) => li.getBoundingClientRect().height)
    // A list is one line per item by design; its text only wraps when an item is taller than a line.
    return { ...r, text: e.textContent.trim(), wrapped: lis.length ? lis.some((h) => h > lh * 1.5) : r.h > lh * 1.5, lh, td: cs.textDecorationLine, op: cs.opacity, lis }
  }
  const rows = [...root.querySelectorAll('[class~="@container"]')].filter((r) => r.textContent.includes('→')).map((c) => {
    const flex = c.firstElementChild, label = flex.children[0], vals = flex.children[1]
    return { field: label.textContent.trim(), root: R(c), flex: R(flex), label: R(label), vals: R(vals), old: box(vals.children[0]), next: box(vals.children[2]) }
  })
  return { rem, rootRight: R(root).right, rows }
}, kind)

// narrow: the label on its own line, the values under it from the label's left edge; wide: one row, the values right of the label column, all starting at the same x.
function geometry(m, vp, ctx) {
  const wide = 35 * m.rem
  const widths = m.rows.map((r) => Math.round(r.flex.w))
  check(`${ctx}: ${m.rows.length} field rows were measured`, m.rows.length > 0, widths)
  check(`${ctx}: every row ends inside its frame`, m.rows.every((r) => r.root.right <= m.rootRight + 1), m.rows.map((r) => Math.round(r.root.right - m.rootRight)))
  if (vp.touch) {
    check(`${ctx}: every row is under 35rem (${wide}px), so it stacks`, widths.every((w) => w < wide), widths)
    const bad = m.rows.filter((r) => !(r.vals.top >= r.label.bottom - 1 && Math.abs(r.vals.left - r.label.left) <= 1))
    check(`${ctx}: the label sits on its own line, the values start under it at its left edge`, bad.length === 0, bad.map((r) => r.field))
    const boxes = m.rows.flatMap((r) => [r.old, r.next].map((b) => ({ f: r.field, w: b.w, wrapped: b.wrapped, full: r.vals.w })))
    const narrow = boxes.filter((b) => b.wrapped && b.w < 12 * m.rem - 0.5 && b.w < b.full - 1)
    check(`${ctx}: no wrapped value box is under 12rem unless it is the full width (${boxes.filter((b) => b.wrapped).length} wrapped)`, narrow.length === 0, { narrow, min: Math.min(...boxes.filter((b) => b.wrapped).map((b) => Math.round(b.w))) })
  } else {
    check(`${ctx}: every row is at least 35rem (${wide}px), so it is one row`, widths.every((w) => w >= wide), widths)
    const bad = m.rows.filter((r) => !(Math.abs(r.vals.top - r.label.top) <= 1.5 && r.vals.left - r.label.right >= 4))
    check(`${ctx}: the values sit in the label's row, 4px or more right of it`, bad.length === 0, bad.map((r) => r.field))
    const xs = m.rows.map((r) => r.vals.left), spread = Math.max(...xs) - Math.min(...xs)
    check(`${ctx}: every row's first value starts at the same x (+-1 px)`, spread <= 1, xs.map((x) => Math.round(x * 10) / 10))
    const col = m.rows.map((r) => Math.round((r.vals.left - r.flex.left) * 10) / 10)
    check(`${ctx}: the label column is 148px (140px + 8px gap) in every row`, col.every((c) => Math.abs(c - 148) <= 1), col)
  }
  const olds = m.rows.filter((r) => r.old.text !== '—')
  check(`${ctx}: every old value is struck through and dimmed`, olds.length > 0 && olds.every((r) => r.old.td.includes('line-through') && Math.abs(parseFloat(r.old.op) - 0.7) < 0.02), olds.map((r) => `${r.old.td}/${r.old.op}`).slice(0, 3))
}

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VPS) {
    const t = (n) => `${vp.name}: ${n}`

    // Settings history: the words, the Onboarding list, the row layout, the crops and one full page
    try {
      const { context, page } = await openAdmin(browser, vp)
      await open(page, '/settings?section=settings-history', 'Onboarding checklist')
      const m = await rowsOf(page, 'history')
      const texts = m.rows.flatMap((r) => [r.old.text, r.next.text])
      check(t('history: no value reads exactly True, False or Warn'), !texts.some((x) => ['True', 'False', 'Warn'].includes(x)), texts.filter((x) => ['True', 'False', 'Warn'].includes(x)))
      check(t('history: the true/false row reads No then Yes'), m.rows.some((r) => r.old.text === 'No' && r.next.text === 'Yes'), texts.slice(0, 6))
      check(t('history: the mode rows read Warn only then Enforce'), m.rows.filter((r) => r.old.text === 'Warn only' && r.next.text === 'Enforce').length === 2, texts.slice(0, 8))
      check(t('history: the time zone reads as its label'), m.rows.some((r) => r.old.text === 'Sydney (NSW, ACT)' && r.next.text === 'Melbourne (VIC)'), texts.filter((x) => x.includes('(')))
      check(t('history: a field with no option list stays as stored (State NSW then VIC)'), m.rows.some((r) => r.old.text === 'NSW' && r.next.text === 'VIC'))
      const onb = m.rows.find((r) => r.field === 'Onboarding checklist')
      check(t('history: the Onboarding checklist value has one line box per item (4 items)'), onb && onb.next.lis.length === 4 && onb.old.lis.length === 4 && [...onb.next.lis, ...onb.old.lis].every((h) => h < onb.next.lh * 1.5), onb && { old: onb.old.lis, new: onb.next.lis, lh: onb.next.lh })
      const lines = (await page.locator('main li').allTextContents()).map((x) => x.trim())
      const rawKeys = [...lines, ...texts].filter((x) => /^[a-z]+[A-Z]?[a-zA-Z]*=/.test(x))
      check(t('history: no value line is a raw key= line (0 found)'), rawKeys.length === 0, rawKeys)
      check(t('history: the Onboarding items read as the form labels them'), ['Told how to make a complaint: Required', 'Rights explained: Optional', 'Recorded as my provider: Required', 'Plan budget added: Off'].every((x) => lines.includes(x)), lines.filter((x) => x.includes(':')).slice(0, 8))
      geometry(m, vp, t('history'))
      await noHScroll(page, t('history'))
      if (vp.touch) await crop(page, page.locator('[class~="@container"]').filter({ hasText: 'Onboarding checklist' }).first(), 'history-onboarding-390.png', vp)
      else await crop(page, page.locator('main section').filter({ has: page.getByRole('heading', { name: TITLE, exact: true }) }).first(), 'history-list-1280.png', vp, 16)
      // The shell grows with the viewport on desktop, so grow the viewport until the page fits it before fullPage measures.
      for (let i = 0; i < 4 && !vp.touch; i++) {
        const h = await page.evaluate(() => document.scrollingElement.scrollHeight)
        if (h <= page.viewportSize().height) break
        await page.setViewportSize({ width: vp.width, height: h })
        await page.waitForTimeout(300)
      }
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `settings-${vp.name}.png`), { touch: vp.touch })).checks)
      await context.close()
    } catch (e) { check(t('history ran'), false, String(e.message).split('\n')[0]) }

    // Deleted records: the open details of the Shift row
    try {
      const { context, page } = await openAdmin(browser, vp)
      await open(page, '/settings?section=deleted-records', 'Choking risk at mealtimes')
      await page.getByRole('button', { name: /^Show details for/ }).first().click()
      const detail = page.locator('[id^="deleted-detail-"]').first()
      await detail.waitFor({ state: 'visible', timeout: 20_000 })
      await page.waitForTimeout(300)
      const m = await rowsOf(page, 'deleted')
      geometry(m, vp, t('deleted'))
      check(t('deleted: a missing value reads "—"'), m.rows.length > 0 && m.rows.every((r) => r.next.text === '—'), m.rows.map((r) => r.next.text).slice(0, 3))
      await noHScroll(page, t('deleted'))
      await crop(page, detail, `deleted-details-${vp.name}.png`, vp)
      await context.close()
    } catch (e) { check(t('deleted ran'), false, String(e.message).split('\n')[0]) }

    // Caregiver Review: the consents row title
    if (vp.touch) {
      try {
        const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: true, isMobile: true, colorScheme: 'light', reducedMotion: 'reduce' })
        const page = await context.newPage()
        page.on('pageerror', (e) => check(`page error (review ${vp.name})`, false, e.message))
        await page.route('**/api/v1/public/caregiver/tok-1', (r) => r.fulfill({ json: envelope(form) }))
        await page.route('**/api/v1/public/caregiver/tok-1/draft', (r) => r.fulfill({ status: 204, body: '' }))
        await page.goto(`${BASE_URL}/caregiver/tok-1`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
        const name = page.getByLabel(/^your name/i)
        await name.waitFor({ state: 'visible', timeout: 60_000 })
        await name.fill('Jane Doe')
        const next = page.getByRole('button', { name: /^next$/i })
        for (let i = 0; i < 7; i++) { await next.click(); await page.waitForTimeout(250) }
        await page.getByRole('button', { name: /submit for review/i }).waitFor({ state: 'visible', timeout: 15_000 })
        const titles = await page.evaluate(() => [...document.querySelectorAll('main dl > div')].map((row) => ({ dt: row.querySelector('dt').textContent, dd: row.querySelector('dd').textContent.trim() })))
        const consents = titles.filter((r) => r.dt === 'Consents')
        check(t('review: one row is titled exactly "Consents"'), consents.length === 1, titles.map((r) => r.dt))
        check(t('review: the value text is unchanged (granted once, declined once)'), consents.length === 1 && consents[0].dd.includes('Photo & Video (promotional use)') && consents[0].dd.includes('Privacy (collection & use of information) (declined)'), consents[0]?.dd)
        check(t('review: no row is still titled "Consent & Terms"'), !titles.some((r) => r.dt.startsWith('Consent & Terms')), titles.map((r) => r.dt))
        await noHScroll(page, t('review'))
        const card = page.getByRole('heading', { name: 'Cultural & Consents', exact: true }).locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " space-y-2 ")][1]')
        const shot = await cropElement(page, card, path.join(OUT_DIR, 'review-consents-390.png'), { pad: 24, natural: true, hideChrome: true, during: async (clip) => { await page.waitForTimeout(300); return overlapCheck(card, clip, 'review-consents-390.png') } })
        checks.push(shot.measured, checkCropHolds(shot))
        await context.close()
      } catch (e) { check(t('review ran'), false, String(e.message).split('\n')[0]) }
    }
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
