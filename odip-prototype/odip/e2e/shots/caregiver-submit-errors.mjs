// PB68-D2: the public caregiver form's Submit answered 404 / 409 / 500. Numeric: the server's own sentence shows in a role=alert for 409, our own next-step sentence (PB69-F1) for 404, the plain fallback for 500, the alert is
// destructive coloured, no server internals show, no horizontal scroll, and at touch Submit is at least --tap-min (44). The API calls are answered in the script (no caregiver routes in the mock).
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
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    for (const st of STATES) {
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
      const page = await context.newPage()
      page.on('pageerror', (e) => check(`page error (${vp.name} ${st.name})`, false, e.message))
      await page.route('**/api/v1/public/caregiver/tok-1', (r) => r.fulfill({ json: envelope(form) }))
      await page.route('**/api/v1/public/caregiver/tok-1/draft', (r) => r.fulfill({ status: 204, body: '' }))
      await page.route('**/api/v1/public/caregiver/tok-1/submit', (r) => r.fulfill({ status: st.status, json: st.body }))
      await page.goto(`${BASE_URL}/caregiver/tok-1`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const name = page.getByLabel(/^your name/i)
      await name.waitFor({ state: 'visible', timeout: 60_000 })
      await name.fill('Jane Doe')
      const next = page.getByRole('button', { name: /^next$/i })
      for (let i = 0; i < 7; i++) { await next.click(); await page.waitForTimeout(250) }
      const submit = page.getByRole('button', { name: /submit for review/i })
      await submit.waitFor({ state: 'visible', timeout: 15_000 })
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
      const destructive = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--color-destructive)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c })
      check(`${vp.name} ${st.name}: alert text is --color-destructive`, (await alert.first().evaluate((el) => getComputedStyle(el).color)) === destructive)
      check(`${vp.name} ${st.name}: no horizontal scroll`, (await overflowX(page)) <= 0, await overflowX(page))
      const file = path.join(OUT_DIR, `${st.name}-${vp.name}.png`)
      const shot = await cropElement(page, alert.first(), file, { pad: 48, also: submit, natural: true, hideChrome: true, during: async (clip) => { await page.waitForTimeout(300); return overlapCheck(alert.first(), clip, path.basename(file)) } })
      checks.push(shot.measured, checkCropHolds(shot))
      // One full page per breakpoint. The closed step rail still reports its hidden buttons to the layout check, so open it first.
      if (st.name === 'submit-404') await page.locator('details > summary').first().click()
      if (st.name === 'submit-404') checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${st.name}-${vp.name}.png`), { touch: vp.touch })).checks)
      await context.close()
    }
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
