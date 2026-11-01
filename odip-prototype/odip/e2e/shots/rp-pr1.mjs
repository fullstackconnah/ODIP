// Captures and numeric checks for RP register PR 1 (SHAPE.md "Numeric checks" 1-11, plus check 12 on the incident detail row). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/rp-pr1.mjs <outdir>
// The register entries come from page.route stubs over the mock API. Exits non-zero when a check fails; every measured value is
// printed as "CHECK ok|FAIL name = value", and measure.txt in OUT_DIR holds the same lines.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
// One file per name: drop the PNGs of any earlier run before writing.
for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.png')) rmSync(path.join(OUT_DIR, f))

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const loginAs = (role) => ({
  users: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]),
  login: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' }),
})

const PID = 'p-0001'
const NAME = 'Liam Okafor'
const entry = (o) => ({
  id: 'rp', participantId: PID, type: 'PhysicalRestraint', description: '', authorisedBy: 'Dr Chen', authorisationDate: '2026-08-01', reviewDate: null,
  relatedMedicationId: null, relatedMedicationName: null, requiresReporting: true, isActive: true, isAuthorised: true,
  authorisationEndDate: null, useKind: 'Routine', firstUsedOn: null, interimBspDate: null, comprehensiveBspDate: null, earliestRecordedUseDate: null,
  interimBspDueOn: null, comprehensiveBspDueOn: null, interimBspState: 'NotStarted', comprehensiveBspState: 'NotStarted',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o,
})
const ENTRIES = [
  entry({ id: 'rp-open', description: 'Open ended hold during transfers.', earliestRecordedUseDate: '2026-09-05' }),
  entry({ id: 'rp-future', description: 'Two-person hold with a future end.', authorisationEndDate: '2099-12-31', firstUsedOn: '2026-09-01', interimBspState: 'Due', interimBspDueOn: '2099-01-01', comprehensiveBspState: 'Due', comprehensiveBspDueOn: '2099-06-01' }),
  entry({ id: 'rp-soon', description: 'Hold whose interim plan is due soon.', firstUsedOn: '2026-10-05', interimBspState: 'DueSoon', interimBspDueOn: '2026-11-05', comprehensiveBspState: 'Due', comprehensiveBspDueOn: '2027-04-05' }),
  entry({ id: 'rp-over', description: 'Hold whose interim plan is overdue.', firstUsedOn: '2026-08-01', interimBspState: 'Overdue', interimBspDueOn: '2026-09-01', comprehensiveBspState: 'Due', comprehensiveBspDueOn: '2027-02-01' }),
  entry({ id: 'rp-interim', description: 'Hold with the interim plan in place.', firstUsedOn: '2026-08-01', interimBspDate: '2026-08-20', interimBspState: 'InPlace', interimBspDueOn: '2026-09-01', comprehensiveBspState: 'Due', comprehensiveBspDueOn: '2027-02-01' }),
  entry({ id: 'rp-comp', description: 'Hold with the comprehensive plan in place.', firstUsedOn: '2026-03-01', interimBspDate: '2026-03-20', comprehensiveBspDate: '2026-08-20', interimBspState: 'InPlace', comprehensiveBspState: 'InPlace', interimBspDueOn: '2026-04-01', comprehensiveBspDueOn: '2026-09-01' }),
  entry({ id: 'rp-ended', description: 'Hold whose authorisation has ended.', authorisationDate: '2019-08-01', authorisationEndDate: '2020-01-31', isAuthorised: false }),
  entry({ id: 'rp-prn', description: 'Risperidone given as needed.', type: 'ChemicalRestraint', relatedMedicationId: 'med-1', relatedMedicationName: 'Risperidone 1mg', relatedMedicationStatus: 'Active', useKind: 'Prn' }),
  entry({ id: 'rp-off', description: 'Old inactive hold.', isActive: false, firstUsedOn: '2026-01-01', interimBspState: 'Overdue', interimBspDueOn: '2026-02-01' }),
]
const EXPECTED_PILLS = {
  'rp-open': [],
  'rp-future': ['Interim plan due 01/01/2099', 'Comprehensive plan due 01/06/2099'],
  'rp-soon': ['Interim plan due 05/11/2026', 'Comprehensive plan due 05/04/2027'],
  'rp-over': ['Interim plan overdue 01/09/2026', 'Comprehensive plan due 01/02/2027'],
  'rp-interim': ['Interim plan in place 20/08/2026', 'Comprehensive plan due 01/02/2027'],
  'rp-comp': ['Comprehensive plan in place 20/08/2026'],
}

const lines = []
let failed = false
const check = (name, value, ok) => { if (!ok) failed = true; const l = `CHECK ${ok ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(value)}`; lines.push(l); console.log(l) }
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})

const browser = await chromium.launch({ headless: true })
async function session(vp, role = 'Admin') {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce', colorScheme: 'light' })
  const page = await context.newPage()
  const cdp = vp.mobile ? await context.newCDPSession(page) : null
  const pin = async () => {
    await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  await pin()
  page.on('pageerror', (e) => check(`${vp.name} page error`, e.message, false))
  const who = loginAs(role)
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: who.users }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: who.login }))
  await page.route(new RegExp(`/api/v1/participants/${PID}/restrictive-practices(\\?.*)?$`), (r) => r.fulfill({ json: envelope(ENTRIES) }))
  await page.route(new RegExp(`/api/v1/participants/${PID}/medications(\\?.*)?$`), (r) => r.fulfill({ json: envelope([]) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await pin()
  const noOverflow = async (state) => {
    const m = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: window.innerWidth }))
    check(`${vp.name} ${state}: no page overflow (${m.sw} <= ${m.iw})`, m, m.sw <= m.iw)
  }
  const shoot = async (loc, state) => {
    await settled(page)
    const b = await loc.boundingBox()
    const x = Math.max(0, b.x - 16); const y = Math.max(0, b.y - 16)
    await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-${state}.png`), clip: { x, y, width: Math.min(vp.width - x, b.width + 32), height: Math.min(vp.height - y, b.height + 32) } })
  }
  const openRegister = async () => {
    await page.goto(`${BASE_URL}/participants/${PID}?tab=restrictive-practices`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(ENTRIES[0].description).waitFor({ timeout: 60_000 })
    await settled(page)
    const more = page.getByRole('button', { name: /^Show all/ })
    if (await more.count()) await more.click()
    await settled(page)
  }
  const card = (text) => page.getByText(text).locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
  return { context, page, shoot, openRegister, noOverflow, card, pin }
}

// The index of each label in order inside a container's text: -1 means a label is missing or out of order.
const inOrder = (text, labels) => { let pos = 0; for (const l of labels) { const i = text.toLowerCase().indexOf(l.toLowerCase(), pos); if (i < 0) return l; pos = i + l.length } return null }

const radios = (group) => group.getByRole('radio')
async function toggleRow(group, vp, name) {
  const m = await radios(group).evaluateAll((els) => els.map((e) => ({ h: e.getBoundingClientRect().height, top: e.offsetTop, lh: parseFloat(getComputedStyle(e).lineHeight) || 20 })))
  check(`${vp.name} ${name}: one row`, m.map((x) => x.top), new Set(m.map((x) => x.top)).size === 1)
  check(`${vp.name} ${name}: one line each`, m.map((x) => x.h), m.every((x) => x.h <= x.lh * 2.5))
  if (vp.mobile) check(`${vp.name} ${name}: options >= 44`, m.map((x) => x.h), m.every((x) => x.h >= 44))
}

try {
  for (const vp of [{ name: '390', width: 390, height: 844, mobile: true }, { name: '1280', width: 1280, height: 800 }]) {
    const { context, page, shoot, openRegister, noOverflow, card } = await session(vp)
    await openRegister()

    // 1 card meta order, ended and open-ended text
    for (const id of ['rp-future', 'rp-ended', 'rp-open']) {
      const e = ENTRIES.find((x) => x.id === id)
      const text = await card(e.description).innerText()
      const labels = id === 'rp-ended' ? ['Routine', 'Authorised by Dr Chen', 'Authorised 01/08/2019 to 31/01/2020', 'Authorisation ended 31/01/2020'] : id === 'rp-future' ? ['Routine', 'Authorised by Dr Chen', 'Authorised 01/08/2026 to 31/12/2099'] : ['Routine', 'Authorised by Dr Chen', 'Authorised 01/08/2026, no end date']
      const bad = inOrder(text, labels)
      check(`${vp.name} 1 meta order ${id}`, bad, bad === null)
      if (id === 'rp-ended') check(`${vp.name} 1 ended reads "Authorisation ended", not "Not yet in force"`, text, /Authorisation ended/.test(text) && !/Not yet in force/.test(text))
      if (id === 'rp-open') check(`${vp.name} 1 open ended says "no end date"`, text, /no end date/.test(text))
    }

    // 2 pills
    for (const [id, expected] of Object.entries(EXPECTED_PILLS)) {
      const c = card(ENTRIES.find((x) => x.id === id).description)
      const pills = c.locator('span.rounded-full').filter({ hasText: /plan (due|overdue|in place)/ })
      const got = await pills.allInnerTexts()
      check(`${vp.name} 2 pill texts ${id}`, got.map((t) => t.trim()), JSON.stringify(got.map((t) => t.trim())) === JSON.stringify(expected))
      const m = await pills.evaluateAll((els) => els.map((e) => ({ rects: e.getClientRects().length, h: e.getBoundingClientRect().height, top: e.offsetTop })))
      check(`${vp.name} 2 pills one rect, <= ${vp.mobile ? 26 : 24}px ${id}`, m, m.every((x) => x.rects === 1 && x.h <= (vp.mobile ? 26 : 24)))
      if (!vp.mobile && expected.length) {
        const label = c.getByText('Behaviour support plan', { exact: true })
        const mid = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2 }
        const lt = await label.evaluate(mid)
        const pm = await pills.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2 }))
        check(`${vp.name} 2 label and pills share one line (centres within 2px) ${id}`, [lt, ...pm], pm.every((y) => Math.abs(y - lt) <= 2))
      }
    }
    const openText = await card(ENTRIES[0].description).innerText()
    check(`${vp.name} 2 open entry asks for the first use date`, openText, /Add the first use date to see when plans are due/.test(openText))

    // 3 card fits, button heights
    for (const e of ENTRIES.filter((x) => x.isActive)) {
      const b = await card(e.description).boundingBox()
      if (vp.mobile) check(`${vp.name} 3 card fits ${e.id} (right ${b.x + b.width} <= 374)`, b.x + b.width, b.x + b.width <= 374)
    }
    if (vp.mobile) {
      const hs = await card(ENTRIES[1].description).getByRole('button').evaluateAll((els) => els.filter((e) => /^(Edit|Delete)$/.test(e.textContent.trim())).map((e) => e.getBoundingClientRect().height))
      check('390 3 Edit and Delete >= 44', hs, hs.length === 2 && hs.every((h) => h >= 44))
    }
    await noOverflow('register tab')
    await shoot(page.locator('main'), 'register')
    if (vp.mobile) {
      // Scroll the ended card above the fixed bottom nav, then prove the crop holds it (text visible, not covered).
      const ended = card(ENTRIES[6].description)
      await ended.evaluate((e) => { const nav = document.querySelector('nav[aria-label="Mobile"]'); const top = nav ? nav.getBoundingClientRect().top : innerHeight; const r = e.getBoundingClientRect(); window.scrollBy(0, r.bottom - (top - 24)) })
      await settled(page)
      const em = await ended.evaluate((e, navSel) => {
        const r = e.getBoundingClientRect(); const nav = document.querySelector(navSel); const navTop = nav ? nav.getBoundingClientRect().top : innerHeight
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return { text: e.innerText, top: r.top, bottom: r.bottom, navTop, covered: !hit || !e.contains(hit) }
      }, 'nav[aria-label="Mobile"]')
      check('390 register-ended crop holds the ended card (Authorisation ended, clear of the bottom nav)', em, /Authorisation ended/.test(em.text) && em.top >= 16 && em.bottom + 16 <= em.navTop && !em.covered)
      await shoot(ended, 'register-ended')
    }

    // inactive entry has no plan line
    await page.getByRole('button', { name: /^Inactive/ }).click()
    const off = await card(ENTRIES[8].description).innerText()
    check(`${vp.name} 2 inactive entry has no plan line`, off, !/Behaviour support plan/.test(off))

    // 4, 5, 6 edit modal
    await openRegister()
    const dialog = page.getByRole('dialog', { name: 'Edit restrictive practice entry' })
    await card(ENTRIES[0].description).getByRole('button', { name: 'Edit' }).click()
    await dialog.waitFor()
    await settled(page)
    const order = ['Type', 'Description', 'How is it used?', 'This restrictive practice is authorised', 'Authorised by', 'Authorisation date', 'Authorisation end date', 'Review date', 'Behaviour support plan', 'First used on', 'Interim plan in place on', 'Comprehensive plan in place on', 'Active']
    const bad = inOrder(await dialog.innerText(), order)
    check(`${vp.name} 4 modal field order`, bad, bad === null)
    await noOverflow('edit modal')
    await toggleRow(dialog.getByRole('radiogroup', { name: 'How is it used?' }), vp, '5 use kind')
    const use = dialog.getByRole('button', { name: 'Use 05/09/2026' })
    const ub = await use.boundingBox()
    if (vp.mobile) check('390 6 Use button >= 44x44', ub, ub.height >= 44 && ub.width >= 44)
    await shoot(dialog, 'edit-modal')
    await use.scrollIntoViewIfNeeded()
    await shoot(dialog, 'edit-modal-bsp')
    await use.click()
    const filled = await dialog.getByLabel('First used on').inputValue()
    check(`${vp.name} 6 Use fills First used on`, filled, filled === '2026-09-05')

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await card(ENTRIES[7].description).getByRole('button', { name: 'Edit' }).click()
    await dialog.waitFor()
    await settled(page)
    const chem = inOrder(await dialog.innerText(), ['Description', 'Linked medication', 'How is it used?'])
    check(`${vp.name} 4 chemical: Linked medication sits between Description and How is it used?`, chem, chem === null)
    await shoot(dialog, 'edit-modal-linked')
    const g = dialog.getByRole('radiogroup', { name: 'How is it used?' })
    const dis = await g.getAttribute('aria-disabled')
    check(`${vp.name} 5 linked chemical use kind is aria-disabled`, dis, dis === 'true')
    await dialog.getByRole('button', { name: 'Cancel' }).click()

    // 7 bulk add
    await page.getByRole('button', { name: 'Add entries' }).first().click()
    const bulk = page.getByRole('dialog', { name: 'Add entries' })
    await bulk.waitFor()
    await toggleRow(bulk.getByRole('radiogroup', { name: 'How is it used?' }), vp, '5 setup use kind')
    await noOverflow('bulk setup')
    await shoot(bulk, 'bulk-setup')
    await bulk.getByRole('checkbox', { name: 'This restrictive practice is authorised' }).check()
    await bulk.getByRole('button', { name: 'Continue' }).click()
    const rows = page.getByRole('dialog', { name: /^Add entries — / })
    await rows.waitFor()
    await settled(page)
    await noOverflow('bulk rows')
    if (!vp.mobile) {
      const heads = (await rows.locator('thead th').allInnerTexts()).map((t) => t.trim()).filter(Boolean)
      check('1280 7 bulk header order', heads, JSON.stringify(heads.slice(0, 5)) === JSON.stringify(['Description', 'Authorised by', 'Authorisation date', 'Authorisation end date', 'Review date']))
      const sc = await rows.locator('table').first().evaluate((t) => { let e = t.parentElement; while (e && e.scrollWidth <= e.clientWidth + 1 && e.tagName !== 'BODY') e = e.parentElement; return { sw: t.parentElement.scrollWidth, cw: t.parentElement.clientWidth } })
      // The table's own overflow-x-auto wrapper may scroll (SHAPE check 7); the dialog around it must not.
      const dlg = await rows.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
      check('1280 7 bulk dialog has no horizontal overflow (table wrapper may scroll)', { dlg, sc }, dlg.sw <= dlg.cw + 1)
      const fit = await rows.evaluate((d) => { const w = d.querySelector('table').parentElement; const dr = d.getBoundingClientRect(); const br = d.querySelector('tbody button[aria-label*="Remove" i], tbody button:last-of-type').getBoundingClientRect(); return { sw: w.scrollWidth, cw: w.clientWidth, btnRight: br.right, dlgRight: dr.right } })
      check('1280 7 authorised batch fits with no inner scroll, Remove inside the dialog', fit, fit.sw <= fit.cw + 1 && fit.btnRight <= fit.dlgRight)
    }
    const descWidth = async (label) => {
      const w = (await rows.getByPlaceholder('What the practice involves').first().boundingBox()).width
      if (!vp.mobile) check(`1280 7 bulk description input >= 220 (${label})`, w, w >= 220)
      const pf = await rows.getByPlaceholder('What the practice involves').first().evaluate((i) => ({ sw: i.scrollWidth, cw: i.clientWidth }))
      if (!vp.mobile) check(`1280 7 bulk description placeholder reads whole (${label})`, pf, pf.sw <= pf.cw)
    }
    await descWidth('authorised batch')
    await shoot(rows, 'bulk-rows')
    await rows.getByRole('button', { name: 'Back' }).click()
    await bulk.getByLabel('Restrictive practice type').click()
    await page.getByRole('option', { name: /^Chemical restraint/ }).click()
    await bulk.getByRole('button', { name: 'Continue' }).click()
    await rows.waitFor()
    await settled(page)
    await descWidth('chemical batch')
    await noOverflow('bulk rows chemical')
    if (!vp.mobile) {
      const cf = await rows.evaluate((d) => { const w = d.querySelector('table').parentElement; const dr = d.getBoundingClientRect(); const inside = (el) => { const r = el.getBoundingClientRect(); return r.left >= dr.left && r.right <= dr.right }; return { sw: w.scrollWidth, cw: w.clientWidth, dlgSw: d.scrollWidth, dlgCw: d.clientWidth, remove: inside(d.querySelector('tbody button[aria-label*="Remove" i], tbody button:last-of-type')), med: inside(d.querySelector('tbody [aria-labelledby^="bulk-medication-label"]')), authBy: d.querySelector('tbody input[placeholder="e.g. Dr. Chen"]').getBoundingClientRect().width } })
      check('1280 7 chemical batch fits with no inner scroll, Remove and Linked medication inside the dialog', cf, cf.sw <= cf.cw + 1 && cf.remove && cf.med && cf.dlgSw <= cf.dlgCw + 1)
      check('1280 7 chemical Authorised by input >= 128', cf.authBy, cf.authBy >= 128)
    }
    await shoot(rows, 'bulk-rows-chemical')
    await rows.getByRole('button', { name: 'Back' }).click()
    await bulk.getByRole('checkbox', { name: 'This restrictive practice is authorised' }).uncheck()
    await bulk.getByRole('button', { name: 'Continue' }).click()
    await rows.waitFor()
    if (!vp.mobile) {
      const heads = await rows.locator('thead th').allInnerTexts()
      check('1280 7 unauthorised batch has no end date column', heads, !heads.some((t) => /Authorisation end date/.test(t)))
    }
    await context.close()
  }

  // 8, 9, 11 wizard as Admin, 10 as SupportWorker
  for (const [role, vp] of [['Admin', { name: '390', width: 390, height: 844, mobile: true }], ['Admin', { name: '1280', width: 1280, height: 800 }], ['SupportWorker', { name: '1280-worker', width: 1280, height: 800 }]]) {
    const { context, page, shoot, noOverflow } = await session(vp, role)
    await page.goto(`${BASE_URL}/incidents/new`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByPlaceholder('Brief incident summary').fill('Held at the kerb')
    await page.getByLabel('Involved Participant').click()
    await page.getByRole('option', { name: NAME }).click()
    await page.getByLabel('Incident Type *', { exact: true }).click()
    await page.getByRole('option', { name: /Restrictive Practice Use/i }).click()
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByLabel(/Restrictive Practice Type/).click()
    await page.getByRole('option', { name: /^Physical restraint/ }).click()
    await page.getByRole('radiogroup', { name: 'Which practice was used?' }).waitFor()
    await settled(page)
    const question = 'Was this used as set out in the behaviour support plan, or was it varied?'
    const group = () => page.getByRole('radiogroup', { name: question })
    const notAuth = () => page.getByRole('checkbox', { name: 'This use was not authorised' })

    await page.getByRole('radio', { name: /Two-person hold with a future end/ }).check()
    await settled(page)
    if (role === 'SupportWorker') {
      check('1280 10 SupportWorker sees the varied question', await group().count(), (await group().count()) === 1)
      await context.close()
      continue
    }
    const rowH = await page.getByRole('radio', { name: /Two-person hold with a future end/ }).locator("xpath=ancestor::label[1]").evaluate((e) => e.getBoundingClientRect().height)
    if (vp.mobile) check('390 11 radio row keeps >= 44', rowH, rowH >= 44)
    const checked = await radios(group()).evaluateAll((els) => els.map((e) => e.getAttribute('aria-checked')))
    check(`${vp.name} 8 no option chosen on first render`, checked, checked.length === 2 && checked.every((c) => c !== 'true'))
    const ys = await Promise.all([notAuth().boundingBox(), group().boundingBox()])
    check(`${vp.name} 8 question after the not-authorised checkbox`, ys.map((b) => b.y), ys[1].y > ys[0].y)
    check(`${vp.name} 8 no description before the answer`, await page.getByLabel(/Describe how the use was varied/).count(), (await page.getByLabel(/Describe how the use was varied/).count()) === 0)
    await toggleRow(group(), vp, '5 varied')
    await noOverflow('incident RP step')
    await page.getByRole('button', { name: 'Next' }).click()
    const err = page.getByText('Choose whether this use followed the plan or was varied')
    await err.waitFor()
    check(`${vp.name} 8 Next without an answer shows the error`, await err.count(), (await err.count()) === 1)
    await notAuth().check()
    check(`${vp.name} 8 ticking not authorised removes the question`, await group().count(), (await group().count()) === 0)
    await notAuth().uncheck()
    await group().getByRole('radio', { name: 'Varied' }).click()
    const hint = page.getByText('A varied use is flagged as a possible reportable incident for the NDIS Commission.')
    const area = page.getByLabel(/Describe how the use was varied/)
    check(`${vp.name} 8 Varied shows the hint and the description`, [await hint.count(), await area.count()], (await hint.count()) === 1 && (await area.count()) === 1)
    await settled(page)
    await shoot(page.locator('form').first(), 'wizard-varied')

    await page.getByRole('radio', { name: /Hold whose authorisation has ended/ }).check()
    await settled(page)
    const box = notAuth()
    const lock = [await box.isChecked(), await box.isDisabled(), await group().count(), await page.getByText(/^This practice's authorisation ended on/).count()]
    check(`${vp.name} 9 ended entry locks the box, hints, and asks nothing`, lock, lock[0] && lock[1] && lock[2] === 0 && lock[3] === 1)
    await shoot(page.locator('form').first(), 'wizard-ended')
    await context.close()
  }

  // 12 incident detail row, both answers
  {
    const { context, page } = await session({ name: '1280', width: 1280, height: 800 })
    for (const [varied, text] of [[false, 'Used as set out in the behaviour support plan'], [true, 'Varied from the behaviour support plan']]) {
      await page.route(/\/api\/v1\/incidents\/inc-0001(\?.*)?$/, async (r) => {
        if (r.request().method() !== 'GET') return r.continue()
        const res = await r.fetch()
        const body = await res.json()
        Object.assign(body.data, { incidentType: 'RestrictivePracticeUse', restrictivePracticeType: 'PhysicalRestraint', restrictivePracticeId: 'rp-future', restrictivePracticeDescription: 'Two-person hold with a future end.', isRestrictivePracticeAuthorised: true, restrictivePracticeUseVaried: varied })
        await r.fulfill({ response: res, json: body })
      })
      await page.goto(`${BASE_URL}/incidents/inc-0001`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const c = page.getByRole('heading', { name: 'Restrictive practice', exact: true }).locator('xpath=../..')
      await c.waitFor({ timeout: 60_000 })
      const t = await c.innerText()
      check(`12 detail row for varied=${varied}`, t, t.includes('Behaviour support plan') && t.includes(text))
    }
    await context.close()
  }
} finally {
  const pass = lines.filter((l) => l.startsWith('CHECK ok')).length
  lines.push(`TOTAL ${pass}/${lines.length} passed`)
  console.log(lines[lines.length - 1])
  writeFileSync(path.join(OUT_DIR, 'measure.txt'), lines.join('\n') + '\n')
  await browser.close()
}
process.exit(failed ? 1 : 0)
