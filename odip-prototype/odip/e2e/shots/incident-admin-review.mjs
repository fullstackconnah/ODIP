// Captures and numeric checks for the Admin incident review (IC7). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/incident-admin-review.mjs <outdir>
// The mock API serves the app. Admin sees the empty review (inc-0002) and saves it, Coordinator reads a saved one (inc-0001), a support worker gets no section.
// Prints "CHECK ok|FAIL name = value", writes checks.json, and exits non-zero when a check fails.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const VIEWPORTS = [{ name: '1280', width: 1280, height: 800 }, { name: '390', width: 390, height: 844, touch: true }]
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const loginAs = (role) => ({
  users: envelope([{ username: `dev.${role.toLowerCase()}`, role, tenantName: 'Sample Support Co' }]),
  login: envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: `dev.${role.toLowerCase()}`, fullName: `Dev ${role}`, role, tenantName: 'Sample Support Co' }),
})

const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${Object.values(ctx).join(' ')}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${Object.values(ctx).join(' ')}] = ${JSON.stringify(measured)}`)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    // The mock keeps a saved review, so each viewport reviews a different unreviewed incident.
    for (const [role, incidentId] of [['Admin', vp.touch ? 'inc-0003' : 'inc-0002'], ['Coordinator', 'inc-0001'], ['SupportWorker', 'inc-0001']]) {
      const ctx = { role, width: vp.name }
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, isMobile: !!vp.touch })
      const page = await context.newPage()
      const cdp = vp.touch ? await context.newCDPSession(page) : null
      const pinCoarse = async () => {
        await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
        await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
      }
      await pinCoarse()
      page.on('pageerror', (e) => check('page error', ctx, e.message, false))
      const acct = loginAs(role)
      await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: acct.users }))
      await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: acct.login }))
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: 'Sign in as selected user' }).click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
      await page.goto(`${BASE_URL}/incidents/${incidentId}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 30_000 })
      await pinCoarse()
      const review = page.locator('[data-testid="incident-review"]')
      // `natural` grows the viewport to the page height, so the fixed bottom tab bar sits below the card and the whole card, status history included, is in the crop.
      const crop = { touch: !!vp.touch, natural: !!vp.touch }
      const noOverflow = async (label) => {
        const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
        check(`no horizontal scroll (${label})`, ctx, o, o.sw <= o.iw)
      }

      if (role === 'SupportWorker') {
        await page.waitForTimeout(1500)
        const n = await review.count()
        check('support worker page has no review section', ctx, n, n === 0)
        checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${role}-${vp.name}.png`), { touch: !!vp.touch })).checks)
        await noOverflow('page')
        await context.close()
        continue
      }

      await review.waitFor({ timeout: 30_000 })
      await page.getByText(/Loading status history|No status changes yet|Reported as/).first().waitFor({ timeout: 30_000 })
      const tap = async (locator, name) => {
        const h = await locator.evaluate((e) => Math.round(e.getBoundingClientRect().height))
        if (vp.touch) check(`${name} is at least 44px tall`, ctx, h, h >= 44)
      }

      if (role === 'Admin') {
        check('Admin sees the empty review', ctx, await review.innerText(), (await review.innerText()).includes('Not reviewed yet.'))
        const record = review.getByRole('button', { name: 'Record review' })
        await tap(record, 'Record review button')
        checks.push(checkCropHolds(await cropElement(page, review, path.join(OUT_DIR, `admin-empty-${vp.name}.png`), crop)))
        await record.click()
        const notes = review.getByLabel(/Review notes/)
        await notes.waitFor({ timeout: 10_000 })
        await tap(review.getByLabel('Status', { exact: true }), 'Status select')
        await tap(review.getByRole('button', { name: 'Save review' }), 'Save review button')
        await tap(review.getByRole('button', { name: 'Cancel' }), 'Cancel button')
        // Blank notes are refused with a message beside the field.
        await review.getByRole('button', { name: 'Save review' }).click()
        check('blank notes show the field message', ctx, await review.innerText(), (await review.innerText()).includes('Add review notes.'))
        await notes.fill('Spoke with the team. Footwear check added to the pre-walk list.')
        await review.getByLabel('Actions taken').fill('Wet-weather route added.')
        await noOverflow('form open')
        checks.push(checkCropHolds(await cropElement(page, review, path.join(OUT_DIR, `admin-form-${vp.name}.png`), crop)))
        const save = review.getByRole('button', { name: 'Save review' })
        if (vp.touch) {
          // Error state: the save fails, then the notes are cleared so the field message and the failure Callout show together.
          const isReviewPut = (r) => r.request().method() === 'PUT' && r.request().url().endsWith('/review')
          await page.route('**/api/v1/incidents/**', (r) => isReviewPut(r) ? r.fulfill({ status: 500, json: { success: false, data: null, message: 'Server error', errors: [] } }) : r.fallback())
          await save.click()
          await review.getByText("Couldn't save the review. Try again.").waitFor({ timeout: 10_000 })
          await notes.fill('')
          const errText = await review.innerText()
          check('error state shows the field message and the failure Callout', ctx, errText, errText.includes('Add review notes.') && errText.includes("Couldn't save the review. Try again."))
          checks.push(checkCropHolds(await cropElement(page, review, path.join(OUT_DIR, `admin-form-error-${vp.name}.png`), crop)))
          await notes.fill('Spoke with the team. Footwear check added to the pre-walk list.')
          await page.unroute('**/api/v1/incidents/**')
          // Saving state: hold the response so the button reads "Saving..." for the capture.
          let release
          const held = new Promise((res) => { release = res })
          await page.route('**/api/v1/incidents/**', async (r) => { if (isReviewPut(r)) { await held; await r.continue() } else await r.fallback() })
          await save.click()
          await review.getByRole('button', { name: 'Saving...' }).waitFor({ timeout: 10_000 })
          checks.push(checkCropHolds(await cropElement(page, review, path.join(OUT_DIR, `admin-form-saving-${vp.name}.png`), crop)))
          release()
        } else {
          await save.click()
        }
        await review.getByText('Reviewed by').waitFor({ timeout: 15_000 })
        check('saved review shows the reviewer and notes', ctx, await review.innerText(), (await review.innerText()).includes('Footwear check added'))
        await tap(review.getByRole('button', { name: 'Update review' }), 'Update review button')
        checks.push(checkCropHolds(await cropElement(page, review, path.join(OUT_DIR, `admin-saved-${vp.name}.png`), crop)))
      } else {
        const text = await review.innerText()
        check('Coordinator reads the saved review', ctx, text, text.includes('Reviewed by') && text.includes('No further action'))
        const buttons = await review.getByRole('button').count()
        check('Coordinator has no edit button', ctx, buttons, buttons === 0)
        checks.push(checkCropHolds(await cropElement(page, review, path.join(OUT_DIR, `coordinator-read-${vp.name}.png`), crop)))
      }
      await noOverflow('page')
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${role}-${vp.name}.png`), { touch: !!vp.touch })).checks)
      await context.close()
    }
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
