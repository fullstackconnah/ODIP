// PB68-D2: the public caregiver form's Submit answered 404 / 409 / 500. Numeric: the server's own sentence shows in a role=alert for 409, our own next-step sentence (PB69-F1) for 404, the plain fallback for 500, the alert is
// destructive coloured, no server internals show, no horizontal scroll, and at touch Submit is at least --tap-min (44). The API calls are answered in the script (no caregiver routes in the mock).
// PB70-F4: the Review step reads yes/no answers as Yes or No, every row label is a human label, and no value is wider than its row or has a word split across lines (`review-step`).
// PB70-D1: a 409 on Submit reloads the form; when the reload says Submitted the page shows its submitted view, not the form and the alert (`submit-409-moved`).
// Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/caregiver-submit-errors.mjs <outdir>
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const failure = (error) => ({ success: false, data: null, message: null, errors: [error] })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }
const TAP_MIN = 44

const STATES = [
  { name: 'submit-404', status: 404, body: failure('This link is not valid.'), shown: 'This link is no longer valid. Please contact the person who sent it to you.' },
  { name: 'submit-409', status: 409, body: failure('This form has already been submitted and is awaiting review.'), shown: 'This form has already been submitted and is awaiting review.' },
  { name: 'submit-500', status: 500, body: failure('boom: NullReferenceException at Odip.Api'), shown: "We couldn't submit the form. Please try again." },
]
const VIEWPORTS = [
  { name: 'desktop-1280', width: 1280, height: 900, touch: false },
  { name: 'touch-390', width: 390, height: 844, touch: true },
]
const form = { status: 'Draft', caregiverName: null, caregiverRelationship: null, expiresAt: '2099-01-01T00:00:00Z', rejectionNote: null, providerName: 'Ability Options', current: { firstName: 'Sophie', lastName: 'Rivers' }, editable: [], draft: null }
// A boolean false (DSOA), a tri-state true (anaphylaxis) and an "Other" diagnosis with its typed text: the three rows that used to show `false`, `true` and a raw key.
const reviewForm = { ...form, current: { ...form.current, isDsoa: false, isAnaphylaxisRisk: true, primaryDiagnosis: 'Other — specify', primaryDiagnosisOther: 'Rare condition' } }
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const destructiveColour = (page) => page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--color-destructive)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c })

// reply is what the submit call answers with; onSubmit runs when it is made.
async function newPage(browser, vp, getForm, reply, onSubmit) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  await page.route('**/api/v1/public/caregiver/tok-1', (r) => r.fulfill({ json: envelope(getForm()) }))
  await page.route('**/api/v1/public/caregiver/tok-1/draft', (r) => r.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/public/caregiver/tok-1/submit', (r) => { onSubmit?.(); return r.fulfill(reply) })
  return { context, page }
}

async function reachReview(page) {
  await page.goto(`${BASE_URL}/caregiver/tok-1`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const name = page.getByLabel(/^your name/i)
  await name.waitFor({ state: 'visible', timeout: 60_000 })
  await name.fill('Jane Doe')
  const next = page.getByRole('button', { name: /^next$/i })
  for (let i = 0; i < 7; i++) { await next.click(); await page.waitForTimeout(250) }
  const submit = page.getByRole('button', { name: /submit for review/i })
  await submit.waitFor({ state: 'visible', timeout: 15_000 })
  return submit
}

// Every review row: the value fits its row, no word of the label or the value is split across lines (a Range over one word has more than one client rect only when the word broke), the label is not a camelCase key and the value is not a bare true/false.
const reviewRows = (page) => page.evaluate(() => {
  const split = (el) => {
    const out = []
    for (const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); w.nextNode();) {
      for (const m of w.currentNode.data.matchAll(/\S+/g)) {
        const r = document.createRange()
        r.setStart(w.currentNode, m.index); r.setEnd(w.currentNode, m.index + m[0].length)
        if (r.getClientRects().length > 1) out.push(m[0])
      }
    }
    return out
  }
  const rows = [...document.querySelectorAll('main dl > div')].map((row) => ({ row, dt: row.querySelector('dt'), dd: row.querySelector('dd') }))
  const valueOf = (label) => rows.find((r) => r.dt.textContent.trim() === label)?.dd.textContent.trim() ?? null
  const dsoa = rows.find((r) => r.dt.textContent.includes('(DSOA)'))
  return {
    rows: rows.length,
    wide: rows.filter(({ row, dt, dd }) => dd.getBoundingClientRect().width > row.getBoundingClientRect().width + 0.5 || dd.scrollWidth > dd.clientWidth + 1 || dt.scrollWidth > dt.clientWidth + 1).map((r) => r.dt.textContent),
    splitWords: rows.flatMap(({ dt, dd }) => [...split(dt), ...split(dd)]),
    camelLabels: rows.filter((r) => /^[a-z]+[A-Z]/.test(r.dt.textContent.trim())).map((r) => r.dt.textContent),
    rawBooleans: rows.filter((r) => /^(true|false)$/i.test(r.dd.textContent.trim())).map((r) => r.dt.textContent),
    dsoa: valueOf('Disability Support for Older Australians (DSOA)'),
    anaphylaxis: valueOf('Anaphylaxis Risk'),
    other: valueOf('Specify Primary Diagnosis'),
    dsoaWrapped: dsoa ? dsoa.dd.getBoundingClientRect().top > dsoa.dt.getBoundingClientRect().top + 1 : null,
  }
})

const cardOf = (page, title) => page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " space-y-2 ")][1]')

async function cropWith(page, locator, file, extra = {}) {
  const shot = await cropElement(page, locator, file, { pad: 24, natural: true, hideChrome: true, ...extra, during: async (clip) => { await page.waitForTimeout(300); return overlapCheck(locator, clip, path.basename(file)) } })
  checks.push(shot.measured, checkCropHolds(shot))
  return shot
}

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    for (const st of STATES) {
      const { context, page } = await newPage(browser, vp, () => form, { status: st.status, json: st.body })
      const submit = await reachReview(page)
      if (vp.touch) {
        check('pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
        const h = (await submit.boundingBox()).height
        check(`${vp.name} ${st.name}: Submit >= --tap-min (${TAP_MIN})`, h >= TAP_MIN - 0.6, h)
      }
      await submit.click()
      const alert = page.getByRole('alert').filter({ hasText: st.shown })
      await alert.waitFor({ state: 'visible', timeout: 15_000 })
      const text = await alert.first().textContent()
      check(`${vp.name} ${st.name}: the sentence shows in one role=alert`, (await alert.count()) === 1, text)
      check(`${vp.name} ${st.name}: no server internals shown`, !/NullReference|boom/.test(text))
      check(`${vp.name} ${st.name}: alert text is --color-destructive`, (await alert.first().evaluate((el) => getComputedStyle(el).color)) === (await destructiveColour(page)))
      check(`${vp.name} ${st.name}: no horizontal scroll`, (await overflowX(page)) <= 0, await overflowX(page))
      const file = path.join(OUT_DIR, `${st.name}-${vp.name}.png`)
      const shot = await cropElement(page, alert.first(), file, { pad: 48, also: submit, natural: true, hideChrome: true, during: async (clip) => { await page.waitForTimeout(300); return overlapCheck(alert.first(), clip, path.basename(file)) } })
      checks.push(shot.measured, checkCropHolds(shot))
      // One full page per breakpoint. The closed step rail still reports its hidden buttons to the layout check, so open it first.
      if (st.name === 'submit-404') await page.locator('details > summary').first().click()
      if (st.name === 'submit-404') checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${st.name}-${vp.name}.png`), { touch: vp.touch })).checks)
      await context.close()
    }

    // review-step: the filled fixture, crops of the two cards that held the raw values, and one full page for the layout check.
    {
      const { context, page } = await newPage(browser, vp, () => reviewForm, { status: 500, json: failure('not used') })
      await reachReview(page)
      const r = await reviewRows(page)
      const tag = `${vp.name} review-step`
      check(`${tag}: rows were scanned`, r.rows > 0, r.rows)
      check(`${tag}: DSOA reads No (was false)`, r.dsoa === 'No', r.dsoa)
      check(`${tag}: anaphylaxis reads Yes (was true)`, r.anaphylaxis === 'Yes', r.anaphylaxis)
      check(`${tag}: the Other diagnosis has a human label and its text`, r.other === 'Rare condition', r.other)
      check(`${tag}: no row label is a camelCase key`, r.camelLabels.length === 0, r.camelLabels.join(', '))
      check(`${tag}: no value reads true or false`, r.rawBooleans.length === 0, r.rawBooleans.join(', '))
      check(`${tag}: no value or label is wider than its row`, r.wide.length === 0, r.wide.join(', '))
      check(`${tag}: no word is split across lines`, r.splitWords.length === 0, r.splitWords.join(', '))
      console.log(`INFO ${tag}: DSOA value wrapped under its label = ${r.dsoaWrapped}`)
      check(`${tag}: no horizontal scroll`, (await overflowX(page)) <= 0, await overflowX(page))
      await cropWith(page, cardOf(page, 'Key Identifiers'), path.join(OUT_DIR, `review-step-${vp.name}.png`))
      await cropWith(page, cardOf(page, 'Medical'), path.join(OUT_DIR, `review-step-medical-${vp.name}.png`))
      await page.locator('details > summary').first().click()
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `review-step-${vp.name}.png`), { touch: vp.touch })).checks)
      await context.close()
    }

    // submit-409-moved: the form was sent from another tab, so the reload says Submitted and the page shows the thank-you view.
    {
      let sent = false
      const { context, page } = await newPage(browser, vp, () => (sent ? { ...form, status: 'Submitted', caregiverName: 'Jane Doe' } : form),
        { status: 409, json: failure('This form has already been submitted and is awaiting review.') }, () => { sent = true })
      const submit = await reachReview(page)
      await submit.click()
      const tag = `${vp.name} submit-409-moved`
      const thanks = page.getByRole('status').filter({ hasText: /your form has been submitted/i })
      await thanks.waitFor({ state: 'visible', timeout: 15_000 })
      check(`${tag}: the submitted view shows once, naming the caregiver`, (await thanks.count()) === 1 && /Jane Doe/.test(await thanks.first().textContent()), await thanks.first().textContent())
      check(`${tag}: no Submit button and no refusal alert remain`, (await page.getByRole('button', { name: /submit for review/i }).count()) === 0 && (await page.getByRole('alert').count()) === 0)
      check(`${tag}: no horizontal scroll`, (await overflowX(page)) <= 0, await overflowX(page))
      await cropWith(page, thanks.first(), path.join(OUT_DIR, `submit-409-moved-${vp.name}.png`), { pad: 48 })
      await context.close()
    }
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
