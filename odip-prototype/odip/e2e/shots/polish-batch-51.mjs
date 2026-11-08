// Captures and numeric checks for polish batch 51: the cut-participants note in the shift panel (roster board and a person's Week tab) and the catalogue import's 10 MB refusal.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Routed: sign-in as a Coordinator (board, staff Week) and a SuperAdmin (catalogue); GET participants is rewritten to say the server cut the list (totalCount above the items).
import path from 'node:path'
import { AU_CONTEXT, cropElement, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const NOTE = /^Showing the first \d+ of \d+ participants\.$/
const TOO_BIG = 'This file is over 10 MB. Choose the NDIS support catalogue .xlsx file.'
const OVER = Buffer.alloc(10 * 1024 * 1024 + 1, 'a')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

async function route(page, role, seen) {
  const devUsers = envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }])
  const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route((u) => u.pathname.endsWith('/api/v1/participants'), async (r) => {
    if (r.request().method() !== 'GET') return r.fallback()
    const res = await r.fetch()
    const body = await res.json()
    const d = body.data ?? body
    if (d && Array.isArray(d.items)) d.totalCount = d.items.length + 50
    return r.fulfill({ response: res, json: body })
  })
  await page.route('**/api/v1/support-catalogue/import/preview', (r) => { seen.preview++; return r.fulfill({ status: 413, contentType: 'text/html', body: '413' }) })
}

async function signIn(page, base) {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}

// Crops `block`, then checks the message sits inside the crop and inside the panel (not wider than it).
async function shoot(page, st, name, message, block, panel) {
  await message.waitFor({ state: 'visible', timeout: 30_000 })
  const c = await cropElement(page, block, path.join(OUT_DIR, `${name}-${st.name}.png`), { touch: st.width === 390, hideChrome: true, pad: 24 })
  const mb = await message.boundingBox()
  const pb = await panel.boundingBox()
  const inside = !!mb && mb.x >= c.clip.x - 1 && mb.y >= c.clip.y - 1 && mb.x + mb.width <= c.clip.x + c.clip.width + 1 && mb.y + mb.height <= c.clip.y + c.clip.height + 1
  const withinPanel = !!mb && !!pb && mb.x >= pb.x - 1 && mb.x + mb.width <= pb.x + pb.width + 1
  const clipped = await message.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
  add(`${name} message visible inside the crop [${st.name}]`, { clip: c.clip, message: mb }, inside && c.overlap?.pass !== false)
  add(`${name} message wraps inside its panel [${st.name}]`, { panel: pb, message: mb }, withinPanel && !clipped)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const open = async (role) => {
      const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
      const page = await context.newPage()
      await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
      page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
      const seen = { preview: 0 }
      await route(page, role, seen)
      await signIn(page, BASE_URL)
      return { context, page, seen }
    }
    try {
      // The board's new-shift panel with a cut participant list.
      let s = await open('Coordinator')
      await s.page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await s.page.getByRole('button', { name: 'New', exact: true }).click({ timeout: 60_000 })
      await s.page.getByRole('menuitem', { name: 'Shift', exact: true }).or(s.page.getByRole('option', { name: 'Shift', exact: true })).first().click({ timeout: 30_000 })
      let dialog = s.page.getByRole('dialog').first()
      await shoot(s.page, st, 'shift-panel-notice', dialog.getByText(NOTE), dialog.locator('[data-shift-field="participant"]'), dialog)
      await s.context.close()

      // A person's Week tab: the same panel, with its own participant list.
      s = await open('Coordinator')
      await s.page.goto(`${BASE_URL}/staff`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await s.page.locator('a[href^="/staff/"]:not([href$="/new"]):not([href$="/edit"])').first().click({ timeout: 60_000 })
      await s.page.getByRole('button', { name: 'Add shift' }).click({ timeout: 60_000 })
      dialog = s.page.getByRole('dialog').first()
      await shoot(s.page, st, 'person-week-notice', dialog.getByText(NOTE), dialog.locator('[data-shift-field="participant"]'), dialog)
      await s.context.close()

      // The catalogue import: over 10 MB is refused at choosing, nothing sent, the input is empty again.
      s = await open('SuperAdmin')
      await s.page.goto(`${BASE_URL}/settings?section=catalogue`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await s.page.getByRole('button', { name: 'Import catalogue' }).click({ timeout: 60_000 })
      const input = s.page.locator('input[type=file]')
      await input.setInputFiles({ name: 'catalogue.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: OVER })
      const modal = s.page.getByRole('dialog').first()
      await shoot(s.page, st, 'catalogue-too-big', modal.getByText(TOO_BIG), modal, modal)
      add(`over-limit catalogue file sent no request [${st.name}]`, s.seen, s.seen.preview === 0)
      add(`catalogue input reset after the refusal [${st.name}]`, null, (await input.evaluate((el) => el.files.length)) === 0)
      await s.context.close()
    } catch (e) {
      add(`scenes ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false)
    }
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
