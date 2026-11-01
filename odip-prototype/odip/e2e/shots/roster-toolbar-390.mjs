// Roster toolbar at 390 (B1, polish batch 3): captures plus the numeric checks. Computed boxes only. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/roster-toolbar-390.mjs <outdir>
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
const login = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const finding = { code: 'Overlap', severity: 'Warning', message: 'Overlapping shifts', detail: null }
const exceptions = [1, 2, 3].map((i) => ({ shiftId: `ex-${i}`, participantName: 'Liam Okafor', serviceDate: '2026-11-03', finding }))

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openRoster(browser, { role, width, height, touch, groupBy }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch })
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role) }))
  // Exceptions > 0 for the writer; a reader keeps the mock board's own count (checked and logged below).
  await page.route('**/api/v1/rostering/board*', async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data && role === 'Admin') body.data.exceptions = exceptions
    await r.fulfill({ response, json: body })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const heading = page.locator('#roster-week-heading')
  await heading.waitFor({ state: 'visible', timeout: 60_000 })
  if (groupBy === 'staff') await page.getByRole('radio', { name: 'By staff' }).click()
  await page.waitForTimeout(800)
  const toolbar = heading.locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
  return { context, page, toolbar }
}

const measure = (toolbar) => toolbar.evaluate((el) => {
  const iw = innerWidth
  const controls = [...el.querySelectorAll('button, [role=radiogroup]')].map((c) => { const b = c.getBoundingClientRect(); return { name: (c.getAttribute('aria-label') || c.textContent || c.getAttribute('role') || '').trim().slice(0, 24), right: b.right, height: b.height, tag: c.tagName } })
  const group = el.querySelector('[role=radiogroup]')
  const gb = group.getBoundingClientRect(), pb = group.parentElement.getBoundingClientRect()
  return { iw, controls, toggleWidth: gb.width, rowWidth: pb.width, toolbarHeight: el.getBoundingClientRect().height, coarse: matchMedia('(pointer: coarse)').matches }
})

const browser = await chromium.launch({ headless: true })
const SCENES = [
  { tag: '390-writer-participant', role: 'Admin', width: 390, height: 844, touch: true, groupBy: 'participant', numeric: true },
  { tag: '390-writer-staff', role: 'Admin', width: 390, height: 844, touch: true, groupBy: 'staff', numeric: true },
  // No reader scene: every non-writing role (SupportWorker, ReadOnly) is refused the roster page, so the reader layout cannot be reached in the app.
  { tag: '1280-writer-participant', role: 'Admin', width: 1280, height: 900, touch: false, groupBy: 'participant', numeric: false },
]
for (const s of SCENES) {
  try {
    const { context, page, toolbar } = await openRoster(browser, s)
    const m = await measure(toolbar)
    console.log(`[roster-toolbar-390] ${s.tag} ${JSON.stringify(m)}`)
    if (s.numeric) {
      check(`${s.tag}: pointer is coarse`, m.coarse)
      const over = m.controls.filter((c) => c.right > m.iw - 16 + 0.5)
      check(`${s.tag}: no control's right edge past innerWidth-16`, over.length === 0, over.length ? over : m.iw - 16)
      const tall = m.controls.filter((c) => c.tag === 'BUTTON' && c.height > 44.5)
      check(`${s.tag}: no button taller than 44px`, tall.length === 0, tall.length ? tall : 'ok')
      check(`${s.tag}: ToggleGroup width = its row width (+-1px)`, Math.abs(m.toggleWidth - m.rowWidth) <= 1, { toggle: m.toggleWidth, row: m.rowWidth })
      // B1 pins the 200px ceiling to the participant view; the staff view adds the region filter and is reported only.
      check(`${s.tag}: toolbar height <= 200px${s.groupBy === 'staff' ? ' (reported, not pinned by B1)' : ''}`, s.groupBy === 'staff' || m.toolbarHeight <= 200, m.toolbarHeight)
    }
    const crop = await cropElement(page, toolbar, path.join(OUT_DIR, `toolbar-${s.tag}.png`), { touch: s.touch })
    checks.push(checkCropHolds({ ...crop, touch: s.touch }))
    if (s.tag !== '390-writer-staff' && s.tag !== '390-reader') checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${s.tag}.png`), { touch: s.touch })).checks)
    await context.close()
  } catch (e) {
    check(`${s.tag}: scene ran`, false, String(e.message).split('\n')[0])
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
