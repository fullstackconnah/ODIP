// Polish batch 75. (a) the participant page's caregiver link: Generate shows the issued-link panel, Revoke removes it; (b) a Settings section description keeps `text-wrap: pretty`.
// Numeric: after Revoke no element holds "Copy this link now" and no alert shows; the description's computed text-wrap is pretty and its last line has two words or more; layout checks from the helper.
// The API calls the pages make are answered in the script (no caregiver routes in the mock). Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-75.mjs <outdir>
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const PS_ID = '00000000-0000-0000-0000-0000000000b1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }

const provider = {
  id: PS_ID, registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Sydney NSW 2000',
  state: 'NSW', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null, timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}
const draft = { id: 'sub-1', participantId: 'p-0004', participantName: 'Participant', status: 'Draft', caregiverName: null, createdAt: '2026-11-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z', submittedAt: null }

const shoot = async (page, loc, file, opts = {}) => {
  const shot = await cropElement(page, loc, file, { pad: 24, hideChrome: true, ...opts, during: async (clip) => { await page.waitForTimeout(300); return overlapCheck(loc, clip, path.basename(file)) } })
  checks.push(shot.measured, checkCropHolds(shot))
}
// The participant tabs strip scrolls sideways below md by design (Tabs.tsx), so its inner scroll is no layout fault.
const TAB_STRIP = ['[role="tablist"]']
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

async function newPage(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  return { context, page }
}
async function signIn(page) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' }) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}
const chooseFromDocuments = async (page, name) => {
  await page.getByRole('button', { name: /^Documents$/ }).click()
  const opt = page.getByRole('option', { name })
  await opt.waitFor({ state: 'visible', timeout: 15_000 })
  await opt.click()
}

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900, touch: false },
  { name: '390', width: 390, height: 844, touch: true },
]
const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    // (a) the participant page: a Draft link is active, so the menu offers Regenerate and Revoke.
    {
      const { context, page } = await newPage(browser, vp)
      await signIn(page)
      let revoked = false
      await page.route(/\/api\/v1\/caregiver-submissions\?.*status=Draft/, (r) => r.fulfill({ json: envelope(revoked ? [] : [draft]) }))
      await page.route(/\/api\/v1\/caregiver-submissions\?.*status=Submitted/, (r) => r.fulfill({ json: envelope([]) }))
      await page.route('**/api/v1/participants/p-0004/caregiver-link', (r) => {
        if (r.request().method() === 'POST') return r.fulfill({ json: envelope({ token: 'tok-shot-0123456789abcdef0123456789abcdef', expiresAt: '2026-11-24T00:00:00Z' }) })
        revoked = true
        return r.fulfill({ status: 204, body: '' })
      })
      await page.goto(`${BASE_URL}/participants/p-0004`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: /^Documents$/ }).waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(800)

      await chooseFromDocuments(page, /regenerate caregiver link/i)
      const control = page.getByTestId('caregiver-link-control')
      const copy = control.getByRole('button', { name: 'Copy link' })
      await copy.waitFor({ state: 'visible', timeout: 15_000 })
      // The nearest ancestor of the control that holds the h1 is the PageHeader, so the issued and revoked crops cover the same area.
      const header = control.locator('xpath=ancestor::*[.//h1][1]')
      check(`${vp.name} link: the issued panel shows its Copy link button`, await copy.isVisible())
      check(`${vp.name} link: no horizontal scroll with the link issued`, (await overflowX(page)) <= 0, await overflowX(page))
      if (vp.touch) await shoot(page, header, path.join(OUT_DIR, 'link-issued-390.png'), { pad: 16 })
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `participant-${vp.name}.png`), { touch: vp.touch, allow: TAB_STRIP })).checks)

      await chooseFromDocuments(page, /revoke caregiver link/i)
      const dialog = page.getByRole('alertdialog')
      await dialog.waitFor({ state: 'visible', timeout: 15_000 })
      await dialog.getByRole('button', { name: /^revoke$/i }).click()
      await dialog.waitFor({ state: 'hidden', timeout: 15_000 })
      await page.waitForTimeout(500)
      check(`${vp.name} link: after Revoke no element holds "Copy this link now"`, (await page.getByText('Copy this link now').count()) === 0, await page.getByText('Copy this link now').count())
      check(`${vp.name} link: after Revoke no Copy link button`, (await copy.count()) === 0, await copy.count())
      check(`${vp.name} link: after Revoke no alert in the control`, (await control.getByRole('alert').count()) === 0, await control.getByRole('alert').count())
      check(`${vp.name} link: no horizontal scroll after Revoke`, (await overflowX(page)) <= 0, await overflowX(page))
      if (vp.touch) await shoot(page, header, path.join(OUT_DIR, 'link-revoked-390.png'), { pad: 16 })
      await context.close()
    }
  }

  // (b) a Settings section description: text-wrap pretty, and a last line of two words or more.
  {
    const vp = VIEWPORTS[0]
    const { context, page } = await newPage(browser, vp)
    await signIn(page)
    await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope(provider) }))
    await page.route('**/api/v1/audit/ProviderSettings/*', (r) => r.fulfill({ json: { entries: [], total: 0, page: 1, pageSize: 50, totalPages: 1 } }))
    await page.goto(`${BASE_URL}/settings?section=settings-history`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const section = page.locator('main section').filter({ has: page.getByRole('heading', { name: 'Settings history', exact: true }) }).first()
    await section.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)
    const title = section.locator('h2').first()
    const desc = section.locator('h2 + p').first()
    const wrap = await desc.evaluate((p) => { const cs = getComputedStyle(p); return { textWrapStyle: cs.textWrapStyle, textWrap: cs.textWrap } })
    check('1280 description: computed text-wrap is pretty', wrap.textWrapStyle === 'pretty' || /pretty/.test(wrap.textWrap), JSON.stringify(wrap))
    const lines = await desc.evaluate((p) => {
      const t = p.firstChild, r = document.createRange()
      const tops = [...t.textContent.matchAll(/\S+/g)].map((m) => { r.setStart(t, m.index); r.setEnd(t, m.index + m[0].length); return Math.round(r.getBoundingClientRect().top) })
      const last = Math.max(...tops)
      return { lines: new Set(tops).size, lastLineWords: tops.filter((x) => x === last).length }
    })
    check('1280 description: wraps and its last line has two words or more', lines.lines >= 2 && lines.lastLineWords >= 2, JSON.stringify(lines))
    await shoot(page, title, path.join(OUT_DIR, 'settings-description-1280.png'), { pad: 16, also: desc })
    await context.close()
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
