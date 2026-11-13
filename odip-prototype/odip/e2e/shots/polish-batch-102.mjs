// Polish batch 102 (H99-2): a draft participant's Back link names Participants, not Enquiries, for a role without the Enquiries tab.
// The draft state is patched onto the participant response (isDraft true, intake not completed); the link's text and href are the numeric checks.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
import path from 'node:path'
import { AU_CONTEXT, cropElement, fullPage, writeChecks, prepareOutDir, checkCropHolds } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role) => ({
  users: envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }]),
  login: envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }),
})
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

const STATES = [
  { name: 'support-worker-draft-390', role: 'SupportWorker', width: 390, height: 844, touch: true, text: 'Back to participants', href: '/participants', full: true },
  { name: 'support-worker-draft-1440', role: 'SupportWorker', width: 1440, height: 900, touch: false, text: 'Back to participants', href: '/participants', full: true },
  { name: 'coordinator-draft-390', role: 'Coordinator', width: 390, height: 844, touch: true, text: 'Back to enquiries', href: '/participants?tab=enquiries', full: false },
]

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: st.touch, isMobile: st.touch })
    const page = await context.newPage()
    page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
    try {
      const who = login(st.role)
      await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: who.users }))
      await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: who.login }))
      await page.route(/\/api\/v1\/participants\/[^/?]+$/, async (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        const res = await route.fetch()
        const body = await res.json()
        if (body?.data) { body.data.isDraft = true; body.data.isActive = false; body.data.intakeCompletedAt = null }
        await route.fulfill({ response: res, json: body })
      })
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const btn = page.getByRole('button', { name: 'Sign in as selected user' })
      await btn.waitFor({ state: 'visible', timeout: 60_000 })
      await btn.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
      await page.goto(`${BASE_URL}/participants/participant-1`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const link = page.getByRole('link', { name: /^Back to / })
      await link.waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForLoadState('networkidle').catch(() => {})
      add(`${st.name}: back link name`, await link.getAttribute('aria-label') ?? await link.innerText(), (await link.getAttribute('aria-label') ?? await link.innerText()) === st.text)
      const href = await link.getAttribute('href')
      add(`${st.name}: back link href`, href, href === st.href)
      const h = (await link.boundingBox())?.height ?? 0
      const tap = await page.evaluate(() => { const probe = document.createElement('div'); probe.style.height = 'var(--tap-min)'; document.body.appendChild(probe); const v = probe.getBoundingClientRect().height; probe.remove(); return v })
      // The Tabs primitive's tablist scrolls sideways by design (flex-nowrap + overflow-x-auto), so it is the one allowed container.
      // The link is unchanged by this batch, so a short link is reported (Found, not changed), never failed.
      add(`${st.name}: back link height vs --tap-min (info)`, { height: h, tapMin: tap, meets: h >= tap }, true)
      const row = link.locator('xpath=..')
      const c = await cropElement(page, row, path.join(OUT_DIR, `${st.name}-header.png`), { touch: st.touch })
      checks.push(checkCropHolds({ ...c, touch: st.touch }))
      if (st.full) checks.push(...(await fullPage(page, path.join(OUT_DIR, `${st.name}-page.png`), { touch: st.touch, allow: ['[role="tablist"]'] })).checks)
    } catch (e) {
      add(`${st.name}: scene ran`, String(e.message).split('\n')[0], false)
    }
    await context.close()
  }
} finally { await browser.close() }
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
