// Captures and numeric checks for polish batch 47 (H60-1, H60-2): a participant list cut at 200 says so on Compatibility and the MAR filter, and Compatibility keeps a restriction for a participant who is not in the list.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Routed: participants return 200 items with totalCount 250; one compatibility No for a participant who is not among them.
import path from 'node:path'
import { AU_CONTEXT, cropElement, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin' })
const person = (i) => ({ id: `p-${i}`, firstName: 'Person', lastName: `N${String(i).padStart(3, '0')}`, preferredName: null, fullName: `Person N${String(i).padStart(3, '0')}`, maskedNdisNumber: null, planType: 'PlanManaged', region: null, isRepeatClient: false, isActive: true, mobilityAidWheelchair: false, mobilityAidWalker: false })
const PARTICIPANTS = Array.from({ length: 200 }, (_, i) => person(i + 1))
const STAFF = [{ id: 's-1', firstName: 'Sam', lastName: 'Taylor', fullName: 'Sam Taylor', username: 'sam', role: 'SupportWorker', position: 'SupportWorker', isActive: true }]
const UNLISTED = 'Unlisted Participant'
const ROWS = [
  { staffId: 's-1', staffName: 'Sam Taylor', participantId: 'p-1', participantName: PARTICIPANTS[0].fullName, level: 'Preferred', rank: 1, reason: null, updatedAt: '2026-11-01T00:00:00Z' },
  { staffId: 's-1', staffName: 'Sam Taylor', participantId: 'p-251', participantName: UNLISTED, level: 'Excluded', rank: 0, reason: 'Past conflict', updatedAt: '2026-11-01T00:00:00Z' },
]
const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

async function route(page) {
  await page.route('**/api/v1/**', (r) => {
    const u = new URL(r.request().url())
    const p = u.pathname.replace(/^\/api\/v1/, '')
    if (p === '/auth/dev-users') return r.fulfill({ json: devUsers })
    if (p === '/auth/dev-login') return r.fulfill({ json: devLogin })
    if (p === '/participants') return r.fulfill({ json: envelope({ items: PARTICIPANTS, totalCount: 250, page: 1, pageSize: 200 }) })
    if (p === '/staff') return r.fulfill({ json: envelope(STAFF) })
    if (p === '/rostering/compatibility') {
      const pid = u.searchParams.get('participantId')
      return r.fulfill({ json: envelope(pid ? ROWS.filter((x) => x.participantId === pid) : ROWS) })
    }
    if (p === '/medications/mar') return r.fulfill({ json: envelope({ date: '2026-11-09', entries: [], prnMedications: [] }) })
    return r.fallback()
  })
}

const overflow = (page) => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
    page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
    await route(page)
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const btn = page.getByRole('button', { name: 'Sign in as selected user' })
      await btn.waitFor({ state: 'visible', timeout: 60_000 })
      await btn.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

      // Compatibility, By participant
      await page.goto(`${BASE_URL}/rostering/compatibility`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const notice = page.getByText(/Showing the first 200 of 250 participants/)
      await notice.waitFor({ state: 'visible', timeout: 30_000 })
      add(`compatibility notice visible [${st.name}]`, await notice.textContent(), await notice.isVisible())
      const nav = page.getByRole('navigation', { name: 'Participants' })
      const nRows = await nav.getByText(UNLISTED).count()
      add(`compatibility keeps the unlisted participant's row [${st.name}]`, { rows: nRows }, nRows === 1)
      const fit = await overflow(page)
      add(`no horizontal overflow on compatibility [${st.name}]`, fit, fit.scrollWidth <= fit.clientWidth)
      const c1 = await cropElement(page, notice, path.join(OUT_DIR, `compatibility-truncated-${st.name}.png`), { touch: mobile, hideChrome: true, ...(mobile ? { pad: 48 } : { also: nav }) })
      add(`crop [compatibility-truncated-${st.name}]`, { clip: c1.clip, box: c1.box }, c1.overlap?.pass ?? true)

      // MAR filter
      await page.goto(`${BASE_URL}/medications`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const marNotice = page.getByText(/Showing the first 200 of 250 participants/)
      await marNotice.waitFor({ state: 'visible', timeout: 30_000 })
      add(`mar filter notice visible [${st.name}]`, await marNotice.textContent(), await marNotice.isVisible())
      const fit2 = await overflow(page)
      add(`no horizontal overflow on the MAR tab [${st.name}]`, fit2, fit2.scrollWidth <= fit2.clientWidth)
      const c2 = await cropElement(page, marNotice, path.join(OUT_DIR, `mar-filter-truncated-${st.name}.png`), { touch: mobile, hideChrome: true, pad: 48 })
      add(`crop [mar-filter-truncated-${st.name}]`, { clip: c2.clip, box: c2.box }, c2.overlap?.pass ?? true)
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
