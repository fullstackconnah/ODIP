// Captures and numeric checks for polish batch 50: the claim results file refusals (over 5 MB at choosing, and a server 413) and the import wizard's over 5 MB refusal.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Routed: sign-in as an Admin (the claims hub and the import wizard both open for one); POST claim-batches/b-uploaded/results answers 413 for the second scene; everything else goes to the mock API.
import path from 'node:path'
import { AU_CONTEXT, cropElement, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const RESULTS_MSG = 'This file is over 5 MB. Choose a smaller results file.'
const WIZARD_MSG = 'The file is over 5 MB. Split it into smaller files and import each one.'
const OVER = Buffer.alloc(5 * 1024 * 1024 + 1, 'a')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin' })
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

async function route(page, seen) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/claim-batches/b-uploaded/results', (r) => { seen.results++; return r.fulfill({ status: 413, contentType: 'text/html', body: '<html>413 Request Entity Too Large</html>' }) })
  await page.route('**/api/v1/imports/**', (r) => { if (r.request().method() === 'POST') seen.imports++; return r.fallback() })
}

// Crops the refusal's surrounding block (the callout with its control) and checks the callout sits inside the crop.
async function shoot(page, st, name, text) {
  const callout = page.getByText(text).first()
  await callout.waitFor({ state: 'visible', timeout: 30_000 })
  const c = await cropElement(page, callout.locator('xpath=ancestor::*[self::section or self::div][2]'), path.join(OUT_DIR, `${name}-${st.name}.png`), { touch: st.width === 390, hideChrome: true, pad: 24 })
  const nb = await callout.boundingBox()
  const inside = !!nb && nb.x >= c.clip.x - 1 && nb.y >= c.clip.y - 1 && nb.x + nb.width <= c.clip.x + c.clip.width + 1 && nb.y + nb.height <= c.clip.y + c.clip.height + 1
  add(`${name} message visible inside the crop [${st.name}]`, { clip: c.clip, callout: nb }, inside && c.overlap?.pass !== false)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
    page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
    const seen = { results: 0, imports: 0 }
    await route(page, seen)
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const btn = page.getByRole('button', { name: 'Sign in as selected user' })
      await btn.waitFor({ state: 'visible', timeout: 60_000 })
      await btn.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

      // Claim results, over 5 MB: refused at choosing, nothing sent, the input is empty again.
      await page.goto(`${BASE_URL}/claims?file=b-uploaded`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const input = page.getByLabel('Results file (.csv)')
      await input.waitFor({ state: 'attached', timeout: 60_000 })
      await input.setInputFiles({ name: 'big.csv', mimeType: 'text/csv', buffer: OVER })
      await shoot(page, st, 'results-too-big', RESULTS_MSG)
      add(`over-limit results file sent no request [${st.name}]`, seen, seen.results === 0)
      add(`results input reset after the refusal [${st.name}]`, null, (await input.evaluate((el) => el.files.length)) === 0)

      // Claim results, a small file that the server refuses with 413: the same message, not the connection one.
      await input.setInputFiles({ name: 'r.csv', mimeType: 'text/csv', buffer: Buffer.from('a') })
      await page.getByTestId('file-next-action').click()
      await shoot(page, st, 'results-413', RESULTS_MSG)
      add(`413 sent one request and shows no connection message [${st.name}]`, seen, seen.results === 1 && (await page.getByText(/Check your connection/).count()) === 0)

      // Import wizard, over 5 MB: refused at Next with the server's own words, nothing uploaded.
      await page.goto(`${BASE_URL}/settings/import/participants`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.locator('#import-file').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: OVER })
      await page.getByRole('button', { name: /^next/i }).click()
      await shoot(page, st, 'wizard-too-big', WIZARD_MSG)
      add(`wizard over-limit file uploaded nothing [${st.name}]`, seen, seen.imports === 0)
    } catch (e) {
      add(`scenes ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
