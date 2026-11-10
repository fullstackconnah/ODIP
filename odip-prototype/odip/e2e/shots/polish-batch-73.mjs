// PB73 (hunt 85): the caregiver Review step reads like the steps. Numeric: the Consents value names the declined consent once with "(declined)" and the granted one once, leaves out the not-recorded
// consent and the Holiday/STA consent the carer form never shows; no element says "Specify Primary Diagnosis" for a normal diagnosis; the HIDPA categories read as the Medical step's labels;
// the helper's layout checks pass on the full page at both widths. The API calls are answered in the script (no caregiver routes in the mock).
// Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-73.mjs <outdir>
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900, touch: false },
  { name: '390', width: 390, height: 844, touch: true },
]
// One consent Granted, one Declined, one Not recorded and one Holiday/STA consent; a normal diagnosis with a stale "Other" text; two HIDPA codes. Gender Self-Description stays unanswered.
const form = {
  status: 'Draft', caregiverName: null, caregiverRelationship: null, expiresAt: '2099-01-01T00:00:00Z', rejectionNote: null, providerName: 'Ability Options', editable: [], draft: null,
  current: {
    firstName: 'Sophie', lastName: 'Rivers',
    consents: [{ consentType: 'PhotoVideo', granted: true }, { consentType: 'Privacy', granted: false }, { consentType: 'EmergencyMedical', granted: null }, { consentType: 'Alcohol', granted: true }],
    primaryDiagnosis: 'Cerebral Palsy', primaryDiagnosisOther: 'left over from an earlier choice',
    hidpaSupportCategories: 'ComplexBowelCare, EnteralFeeding',
  },
}
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const count = (text, part) => text.split(part).length - 1

async function reachReview(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  await page.route('**/api/v1/public/caregiver/tok-1', (r) => r.fulfill({ json: envelope(form) }))
  await page.route('**/api/v1/public/caregiver/tok-1/draft', (r) => r.fulfill({ status: 204, body: '' }))
  await page.goto(`${BASE_URL}/caregiver/tok-1`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const name = page.getByLabel(/^your name/i)
  await name.waitFor({ state: 'visible', timeout: 60_000 })
  await name.fill('Jane Doe')
  const next = page.getByRole('button', { name: /^next$/i })
  for (let i = 0; i < 7; i++) { await next.click(); await page.waitForTimeout(250) }
  await page.getByRole('button', { name: /submit for review/i }).waitFor({ state: 'visible', timeout: 15_000 })
  return { context, page }
}

const reviewValues = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('main dl > div')].map((row) => ({ dt: row.querySelector('dt').textContent.trim(), dd: row.querySelector('dd').textContent.trim() }))
  const valueOf = (label) => rows.find((r) => r.dt.startsWith(label))?.dd ?? null
  return { rows: rows.length, consents: valueOf('Consent & Terms'), hidpa: valueOf('HIDPA Support Categories'), diagnosis: valueOf('Primary Diagnosis'), specifyAnywhere: document.querySelector('main').innerText.includes('Specify Primary Diagnosis') }
})

const cardOf = (page, title) => page.getByRole('heading', { name: title, exact: true }).locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " space-y-2 ")][1]')

async function cropWith(page, locator, file) {
  const shot = await cropElement(page, locator, file, { pad: 24, natural: true, hideChrome: true, during: async (clip) => { await page.waitForTimeout(300); return overlapCheck(locator, clip, path.basename(file)) } })
  checks.push(shot.measured, checkCropHolds(shot))
  return shot
}

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    const { context, page } = await reachReview(browser, vp)
    const r = await reviewValues(page)
    const tag = `${vp.name} review`
    check(`${tag}: rows were scanned`, r.rows > 0, r.rows)
    check(`${tag}: the Consents value contains "(declined)" exactly once`, r.consents && count(r.consents, '(declined)') === 1, r.consents)
    check(`${tag}: the Consents value names the granted consent once`, r.consents && count(r.consents, 'Photo & Video (promotional use)') === 1, r.consents)
    check(`${tag}: the declined consent is Privacy`, r.consents && r.consents.includes('Privacy (collection & use of information) (declined)'), r.consents)
    check(`${tag}: the not-recorded consent is off the line`, r.consents && !r.consents.includes('Emergency Medical'), r.consents)
    check(`${tag}: the Holiday/STA consent the carer never sees is off the line`, r.consents && !r.consents.includes('Alcohol'), r.consents)
    check(`${tag}: no element says "Specify Primary Diagnosis" for a normal diagnosis`, r.specifyAnywhere === false && r.diagnosis === 'Cerebral Palsy', `${r.specifyAnywhere} / ${r.diagnosis}`)
    check(`${tag}: the HIDPA categories read as the Medical step's labels`, r.hidpa === 'Complex Bowel Care, Enteral Feeding Support', r.hidpa)
    check(`${tag}: no horizontal scroll`, (await overflowX(page)) <= 0, await overflowX(page))
    if (vp.touch) {
      check('pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
      await cropWith(page, cardOf(page, 'Cultural & Consents'), path.join(OUT_DIR, 'review-consents-390.png'))
      await cropWith(page, cardOf(page, 'Medical'), path.join(OUT_DIR, 'review-medical-390.png'))
    }
    // One full page per breakpoint. The closed step rail still reports its hidden buttons to the layout check, so open it first.
    await page.locator('details > summary').first().click()
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `review-${vp.name}.png`), { touch: vp.touch })).checks)
    await context.close()
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
