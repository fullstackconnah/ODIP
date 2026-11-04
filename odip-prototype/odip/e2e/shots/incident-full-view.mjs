// Incident full view PR2: the detail page's cards, per-section edit, the witness confirm and the discard confirm. Captures plus SHAPE section 8 checks 1-14 and plan checks 15-16. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/incident-full-view.mjs <outdir>
// Sign-in, the provider row and every /api/v1 route the page reads are stubbed with page.route (synthetic data); the PUT is held or refused by the script.
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

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const provider = {
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Melbourne VIC 3000',
  state: 'VIC', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null, timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}
const D1 = 'Someone else changed this incident after you opened it. Cancel, then edit it again to see their changes.'
const UPDATED_AT = '2026-10-05T01:02:03.4567890Z'
const STAFF = [{ id: 'staff-4', fullName: 'Mei Zhang' }, { id: 'staff-2', fullName: 'Sam Okafor' }, { id: 'staff-3', fullName: 'Lee Tran' }]
const PARTICIPANTS = [{ id: 'participant-4', firstName: 'Grace', lastName: 'Palmer-Hughes', fullName: 'Grace Palmer-Hughes' }]

const base = (over = {}) => ({
  id: 'inc-1', serviceType: 'None', tripInstanceId: null, tripName: null, incidentType: 'Injury', otherTypeSpecify: null,
  severity: 'Medium', status: 'Open', title: 'Fall in the garden', incidentDateTime: '2026-10-03T08:00:00', location: 'Home',
  reportedByName: 'Mei Zhang', involvedParticipantId: 'participant-4', involvedParticipantName: 'Grace Palmer-Hughes', qscReportingStatus: 'NotRequired', isOverdue24h: false,
  createdAt: '2026-10-03T09:00:00Z', medicationAdministrationId: null, shiftId: null, shiftNoteId: null,
  participantBookingId: null, involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 'staff-4',
  restrictivePracticeType: null, restrictivePracticeId: null, restrictivePracticeDescription: null, restrictivePracticeReviewDate: null,
  unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: null,
  description: 'Grace slipped on the wet path and landed on her left side.', immediateActionsTaken: 'Checked for injury, applied ice and sat her down.', wereEmergencyServicesCalled: false, emergencyServicesDetails: null, emergencyServices: 'None',
  policeOfficerName: null, policeReference: null, ambulanceOfficerName: null, ambulanceReference: null, fireOfficerName: null, fireReference: null,
  witnessNames: null, witnessStatements: null,
  injuries: [{ id: 'inj-1', region: 'Head', injuryType: 'Bruise', description: 'Left side of the forehead' }],
  witnesses: [
    { id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Sam Okafor', isStaffWitness: true, witnessStatus: 'Approved', witnessRequestedAt: '2026-10-03T10:00:00Z', witnessRespondedAt: '2026-10-03T11:00:00Z', statementText: 'I saw Grace slip near the gate and helped her up.' },
    { id: 'w-2', witnessUserId: 'staff-3', witnessName: 'Lee Tran', isStaffWitness: true, witnessStatus: 'Pending', witnessRequestedAt: '2026-10-03T10:00:00Z', witnessRespondedAt: null, statementText: null },
    { id: 'w-3', witnessUserId: null, witnessName: 'Pat Neighbour', isStaffWitness: false, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null, statementText: null },
  ],
  qscReportedAt: null, qscReferenceNumber: null, awareAt: '2026-10-03T09:05:00Z', reportableClass: 'None', reportableClassReason: null,
  notifyDueAt: null, detailedReportDueAt: null, dueCountedWithoutHolidays: false,
  commissionDetailedReportedAt: null, commissionFinalReportRequested: false, commissionFinalReportedAt: null, timeZoneId: 'Australia/Sydney',
  reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null, resolvedAt: null,
  familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false, supportCoordinatorNotifiedAt: null,
  updatedAt: UPDATED_AT, medicationContext: null, shiftContext: null, shiftNoteContext: null,
  ...over,
})
const FULL = base()
const RP = base({ incidentType: 'RestrictivePracticeUse', injuries: [], restrictivePracticeType: 'PhysicalRestraint', unapprovedRestrictivePracticeDetails: 'Held both arms for about a minute while she was calmed.', isRestrictivePracticeAuthorised: false, title: 'Physical hold in the lounge' })
const BARE = base({ incidentType: 'Other', injuries: [], witnesses: [], description: 'A short note.', immediateActionsTaken: 'None needed.' })
const LONG_NAME = 'W'.repeat(60)
const LONG_STATEMENT = `${'The gate was wet and I saw it all happen quickly. '.repeat(30)}${'x'.repeat(80)} ${'More detail followed. '.repeat(10)}`.slice(0, 1500)
const LONG = base({
  witnesses: [{ id: 'w-1', witnessUserId: 'staff-2', witnessName: LONG_NAME, isStaffWitness: true, witnessStatus: 'Approved', witnessRequestedAt: '2026-10-03T10:00:00Z', witnessRespondedAt: '2026-10-03T11:00:00Z', statementText: LONG_STATEMENT }],
  description: `${'Long description words '.repeat(20)}${'y'.repeat(80)}`,
})

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openPage(browser, vp, { role = 'Admin', username = 'dev.admin', inc = FULL, put = 'ok' } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const puts = []
  let release
  const held = new Promise((res) => { release = res })
  // Anything not listed here goes to the mock API, which answers sign-in and the shell.
  for (const glob of ['**/api/v1/trips*', '**/api/v1/restrictive-practices*', '**/api/v1/incidents/inc-1/status-history', '**/api/v1/participants/*/medications*']) await page.route(glob, (r) => r.fulfill({ json: envelope([]) }))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope(provider) }))
  await page.route('**/api/v1/staff*', (r) => r.fulfill({ json: envelope(STAFF) }))
  await page.route('**/api/v1/participants**', (r) => r.fulfill({ json: envelope(PARTICIPANTS) }))
  await page.route('**/api/v1/incidents/inc-1', async (r) => {
    const req = r.request()
    if (req.method() === 'GET') return r.fulfill({ json: envelope(inc) })
    puts.push(JSON.parse(req.postData() ?? '{}'))
    if (put === 'conflict') return r.fulfill({ status: 409, json: { success: false, data: null, message: D1, errors: [D1] } })
    if (put === 'hold') await held
    return r.fulfill({ json: envelope(inc) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/incidents/inc-1`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  try { await page.getByRole('heading', { level: 3 }).first().waitFor({ state: 'visible', timeout: 30_000 }) } catch (e) {
    throw new Error(`no card heading at ${page.url()}: ${(await page.locator('body').innerText()).replace(/s+/g, ' ').slice(0, 160)}`)
  }
  await page.waitForTimeout(400)
  return { context, page, puts, release }
}

const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${ctx}: no horizontal scroll`, o <= 0, o)
}
// A button's hit box is the larger of its own box and its TAP_AREA pseudo-element, in both directions.
const hitBoxes = (page, selector, filterText) => page.evaluate(({ selector, filterText }) => [...document.querySelectorAll(selector)].filter((e) => {
  const b = e.getBoundingClientRect()
  if (!(b.width > 0 && b.height > 0) || getComputedStyle(e).visibility === 'hidden') return false
  return filterText ? new RegExp(filterText).test((e.getAttribute('aria-label') || e.textContent || '').trim()) : true
}).map((e) => {
  const b = e.getBoundingClientRect(), s = getComputedStyle(e, '::before')
  return { name: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), w: Math.max(b.width, parseFloat(s.width) || 0), h: Math.max(b.height, parseFloat(s.height) || 0) }
}), { selector, filterText })
const crop = async (page, locator, name, vp, pad = 16) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
const edit = (page, name) => page.getByRole('button', { name: `Edit ${name}`, exact: true })
const h3s = (page) => page.evaluate(() => [...document.querySelectorAll('main h3')].map((h) => h.textContent.trim()))
const PINNED = ['Incident details', 'Injuries', 'Who', 'What', 'Restrictive practice details', 'Witnesses', 'Compliance', 'Review', 'Linked records']
const inOrder = (got) => { let i = -1; return got.every((t) => { const j = PINNED.indexOf(t); const ok = j > i; i = j; return ok }) }

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const tag = vp.name
  const phone = vp.touch

  // view-admin
  try {
    const { context, page } = await openPage(browser, vp)
    const main = page.locator('main').first()
    const titles = await h3s(page)
    check(t('card titles follow the pinned order (Injury fixture)'), JSON.stringify(titles) === JSON.stringify(PINNED.filter((x) => x !== 'Restrictive practice details')), titles)
    await noHScroll(page, t('view-admin'))
    if (phone) {
      const edits = await hitBoxes(page, 'button', '^Edit ')
      check(t('every Edit button hit box is at least 44x44'), edits.length > 0 && edits.every((b) => b.w >= 43.5 && b.h >= 43.5), edits)
    }
    await crop(page, main, `view-admin-${tag}.png`, vp)
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `view-admin-${tag}.png`), { touch: phone })).checks)
    await context.close()
  } catch (e) { check(t('view-admin ran'), false, String(e.message).split('\n')[0]) }

  // RP fixture: order check only
  try {
    const { context, page } = await openPage(browser, vp, { inc: RP })
    const titles = await h3s(page)
    check(t('card titles follow the pinned order (RP fixture)'), titles.includes('Restrictive practice details') && !titles.includes('Injuries') && inOrder(titles), titles)
    await context.close()
  } catch (e) { check(t('rp order ran'), false, String(e.message).split('\n')[0]) }

  if (phone) {
    // view-readonly (check 9)
    try {
      const { context, page } = await openPage(browser, vp, { role: 'SupportWorker', username: 'dev.worker' })
      const edits = await page.getByRole('button', { name: /^Edit / }).count()
      check(t('SupportWorker sees 0 Edit buttons and the Witnesses card'), edits === 0 && (await h3s(page)).includes('Witnesses'), edits)
      await noHScroll(page, t('view-readonly'))
      await crop(page, page.locator('main').first(), `view-readonly-${tag}.png`, vp)
      await context.close()
    } catch (e) { check(t('view-readonly ran'), false, String(e.message).split('\n')[0]) }

    // view-bare (check 14)
    try {
      const { context, page } = await openPage(browser, vp, { inc: BARE })
      check(t('bare incident: No witnesses recorded. and Not linked to a medication, shift or shift note.'),
        (await page.getByText('No witnesses recorded.').isVisible()) && (await page.getByText('Not linked to a medication, shift or shift note.').isVisible()))
      await noHScroll(page, t('view-bare'))
      await crop(page, page.locator('main').first(), `view-bare-${tag}.png`, vp)
      await context.close()
    } catch (e) { check(t('view-bare ran'), false, String(e.message).split('\n')[0]) }

    // long-content (checks 10, 11, 1, 12)
    try {
      const { context, page } = await openPage(browser, vp, { inc: LONG })
      await noHScroll(page, t('long-content'))
      const m = await page.evaluate((name) => {
        const row = document.querySelector('[data-testid="witness-row"]')
        const nameEl = [...row.querySelectorAll('span')].find((s) => s.textContent === name)
        const quote = row.querySelector('blockquote')
        return { nameRight: nameEl.getBoundingClientRect().right, rowRight: row.getBoundingClientRect().right, sw: quote.scrollWidth, cw: quote.clientWidth, h: quote.getBoundingClientRect().height }
      }, LONG_NAME)
      check(t('60-character witness name stays inside its row'), m.nameRight <= m.rowRight + 0.5, m)
      check(t('1,500-character statement does not overflow and is over 200 high'), m.sw <= m.cw && m.h > 200, m)
      await crop(page, page.locator('main').first(), `long-content-${tag}.png`, vp)
      await context.close()
    } catch (e) { check(t('long-content ran'), false, String(e.message).split('\n')[0]) }
  }

  // check 12 on the default fixture
  try {
    const { context, page } = await openPage(browser, vp)
    const line2 = await page.locator('[data-testid="witness-row"]').first().locator('p').first().textContent()
    check(t('responded staff witness line 2 reads Asked ... · Responded ...'), /^Asked \d{1,2} \w{3} \d{4}, .+ · Responded /.test(line2 ?? ''), line2)
    await context.close()
  } catch (e) { check(t('witness line ran'), false, String(e.message).split('\n')[0]) }

  // edit-details: checks 13, 4/5, 1, then check 8 and 7 and the discard confirm
  try {
    const { context, page } = await openPage(browser, vp)
    const opener = edit(page, 'incident details')
    await opener.click()
    const form = page.locator('[data-editing]')
    await form.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(400)
    check(t('focus is inside the open group after Edit'), await page.evaluate(() => !!document.activeElement?.closest('[data-editing]')))
    await noHScroll(page, t('edit-details'))
    const geo = await page.evaluate(() => {
      const f = document.querySelector('[data-editing]'), r = (e) => e.getBoundingClientRect()
      const save = [...f.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save'), cancel = [...f.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel')
      const row = save.parentElement
      return { save: r(save).toJSON(), cancel: r(cancel).toJSON(), row: r(row).toJSON(), form: r(f).toJSON() }
    })
    if (phone) {
      check(t('Save and Cancel are at least 44 high, full row width, Save above Cancel'),
        geo.save.height >= 43.5 && geo.cancel.height >= 43.5 && Math.abs(geo.save.width - geo.row.width) <= 1 && Math.abs(geo.cancel.width - geo.row.width) <= 1 && geo.save.top < geo.cancel.top, geo)
    } else {
      check(t('Save right edge is the group right edge, Cancel sits left of Save'), Math.abs(geo.save.right - geo.form.right) <= 1 && geo.cancel.right < geo.save.left, geo)
    }
    await crop(page, form, `edit-details-${tag}.png`, vp)

    if (!phone) {
      // check 7: nothing changed, so Edit witnesses switches straight away
      await edit(page, 'witnesses').click()
      await page.waitForTimeout(300)
      const sw = await page.evaluate(() => ({ n: document.querySelectorAll('[data-editing]').length, g: document.querySelector('[data-editing]')?.getAttribute('data-group') }))
      check(t('Edit details then Edit witnesses, no changes: one group open and it is witnesses'), sw.n === 1 && sw.g === 'witnesses', sw)
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.waitForTimeout(300)
      const back = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
      check(t('after Cancel, focus is on the Edit that opened the group'), back === 'Edit witnesses', back)
    } else {
      // check 8: a change, then Edit witnesses asks first
      await form.locator('textarea').first().fill('Changed text so the part has unsaved changes.')
      await edit(page, 'witnesses').click()
      const dlg = page.getByRole('alertdialog')
      await dlg.waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForTimeout(300)
      const title = await dlg.getByRole('heading').first().textContent()
      const still = await page.locator('[data-editing][data-group="details"]').count()
      check(t('dirty switch opens "Discard your changes?" and details stays open'), title?.trim() === 'Discard your changes?' && still === 1, { title, still })
      await crop(page, dlg, `switch-discard-confirm-${tag}.png`, vp, 8)
      await dlg.getByRole('button', { name: 'Keep editing' }).click()
      await form.waitFor({ state: 'visible' })
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page.waitForTimeout(300)
      const back = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
      check(t('after Cancel, focus is on the Edit that opened the group'), back === 'Edit incident details', back)
    }
    await context.close()
  } catch (e) { check(t('edit-details ran'), false, String(e.message).split('\n')[0]) }

  // edit-witnesses and the remove confirm (check 3 at 390)
  try {
    const { context, page } = await openPage(browser, vp)
    await edit(page, 'witnesses').click()
    const form = page.locator('[data-editing]')
    await form.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(400)
    await noHScroll(page, t('edit-witnesses'))
    if (phone) {
      const rm = await hitBoxes(page, 'button', '^Remove witness$')
      check(t('every Remove witness button is at least 44x44'), rm.length > 0 && rm.every((b) => b.w >= 43.5 && b.h >= 43.5), rm)
      await crop(page, form, `edit-witnesses-${tag}.png`, vp)
      await page.getByRole('button', { name: 'Remove witness' }).first().click()
      const dlg = page.getByRole('alertdialog')
      await dlg.waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForTimeout(300)
      await crop(page, dlg, `witness-remove-confirm-${tag}.png`, vp, 8)
    }
    await context.close()
  } catch (e) { check(t('edit-witnesses ran'), false, String(e.message).split('\n')[0]) }

  // every other group at this width: no horizontal scroll (check 1); plan check 15 on the Who group
  for (const [name, inc] of [['who', FULL], ['restrictive practice details', RP], ['compliance', FULL]]) {
    try {
      const { context, page } = await openPage(browser, vp, { inc })
      await edit(page, name).click()
      await page.locator('[data-editing]').waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(300)
      await noHScroll(page, t(`edit-${name}`))
      if (name === 'who' && !phone) {
        await page.getByLabel('Incident Type *', { exact: true }).click()
        await page.getByRole('option', { name: /^Other/ }).click()
        const note = page.getByText('Changing the type from Injury removes the recorded injuries when you save.')
        check(t('type change Injury to Other shows the removal warning'), await note.isVisible(), await note.count())
      }
      await context.close()
    } catch (e) { check(t(`edit-${name} ran`), false, String(e.message).split('\n')[0]) }
  }

  // saving (held PUT) at 1280, then a 409 at 1280 (check 16)
  if (!phone) {
    try {
      const { context, page, puts, release } = await openPage(browser, vp, { put: 'hold' })
      await edit(page, 'incident details').click()
      const form = page.locator('[data-editing]')
      await form.waitFor({ state: 'visible', timeout: 30_000 })
      await form.locator('textarea').first().fill('A changed description.')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await page.getByRole('button', { name: 'Saving…' }).waitFor({ state: 'visible', timeout: 10_000 })
      check(t('saving: Edit buttons are disabled while the save runs'), await page.evaluate(() => [...document.querySelectorAll('button[data-edit-card]')].every((b) => b.disabled)))
      await crop(page, form, `saving-${tag}.png`, vp)
      release()
      await context.close()
      check(t('saving: the PUT carried expectedUpdatedAt'), puts[0]?.expectedUpdatedAt === UPDATED_AT, puts[0]?.expectedUpdatedAt)
    } catch (e) { check(t('saving ran'), false, String(e.message).split('\n')[0]) }

    try {
      const { context, page } = await openPage(browser, vp, { put: 'conflict' })
      await edit(page, 'incident details').click()
      const form = page.locator('[data-editing]')
      await form.waitFor({ state: 'visible', timeout: 30_000 })
      await form.locator('textarea').first().fill('Typed before the conflict.')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      const msg = page.getByText(D1, { exact: true })
      await msg.waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForTimeout(400)
      const text = (await msg.first().textContent())?.trim()
      const open = await page.locator('[data-editing]').count()
      const kept = await form.locator('textarea').first().inputValue()
      check(t('409: Callout text equals the D1 message, one group still open, typed text kept'), text === D1 && open === 1 && kept === 'Typed before the conflict.', { text, open, kept })
      await crop(page, form, `save-error-${tag}.png`, vp)
      await context.close()
    } catch (e) { check(t('save-error ran'), false, String(e.message).split('\n')[0]) }
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
