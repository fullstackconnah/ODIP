// Portal started-activity shot: a Group activity started on Sunday night is still on the worker's list (with its Finish button) on Monday 1 am, when the page opens on the Monday week.
// Scene started-from-sunday at 390 and 1280. Checks: the card is present with a Finish button, Finish is at least --tap-min tall, no horizontal overflow. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/portal-started-activity.mjs <outdir>
// Everything the page calls is stubbed with page.route. The clock (Monday 1 am Sydney), the theme (light) and the zone are pinned.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const NOW = new Date('2026-11-15T14:00:00Z')   // 1:00 am Monday 16 Nov in Sydney (AEDT)
const checks = []
const check = (name, detail, pass) => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }
const px = (page, token) => page.evaluate((t) => { const p = document.createElement('div'); p.style.height = `var(${t})`; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h }, token)

const SUNDAY = {
  id: 'row-1', groupActivityId: 'ga-1', title: 'Overnight camp', serviceDate: '2026-11-15', startTime: '22:00:00', endTime: '06:00:00', endsNextDay: true,
  location: 'Lake Macquarie Camp', role: 'Support worker', state: 'Started', actualStart: '2026-11-15T11:05:00Z', actualEnd: null, breakStartedAt: null, breakEndedAt: null,
  participants: [{ shiftId: 'sh-1', participantId: 'p-1', name: 'Mia Chen' }],
}

async function scene(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch { /* storage blocked */ } }, [USER_ID])
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, e.message, false))
  const login = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role: 'SupportWorker', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role: 'SupportWorker', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route((u) => u.pathname === '/api/v1/portal/my-shifts', (r) => r.fulfill({ json: envelope({ shifts: [], tripAssignments: [], timeZoneId: 'Australia/Sydney', activityShifts: [SUNDAY] }) }))
  await page.route('**/api/v1/portal/shifts/*/notes', (r) => r.fulfill({ json: envelope([]) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(NOW)
  await page.goto(`${BASE_URL}/portal`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByText('Overnight camp').first().waitFor({ timeout: 30_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

  const card = page.getByTestId('activity-shift-card')
  const r = await cropElement(page, card, path.join(OUT_DIR, `started-from-sunday-${vp.name}.png`), { touch: vp.touch, natural: true, pad: 8 })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
  const finish = card.getByRole('button', { name: 'Finish' })
  check(`the Sunday card shows with a Finish button (${vp.name})`, `${await card.count()} card, ${await finish.count()} Finish`, (await card.count()) === 1 && (await finish.count()) === 1)
  const tapMin = await px(page, '--tap-min')
  const h = (await finish.boundingBox()).height
  check(`Finish is at least --tap-min tall (${vp.name})`, `${Math.round(h)} vs ${tapMin}`, h >= tapMin - 0.5)
  const o = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }))
  check(`no horizontal overflow (${vp.name})`, JSON.stringify(o), o.sw <= o.cw)
  await context.close()
}

const browser = await chromium.launch({ headless: true })
try {
  await scene(browser, { name: '390', width: 390, height: 844, touch: true })
  await scene(browser, { name: '1280', width: 1280, height: 800, touch: false })
} finally {
  writeChecks(OUT_DIR, checks)
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
process.exit(failed.length ? 1 : 0)
