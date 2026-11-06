// Finish-later PR1 shots: the coordinator completions queue with a shift waiting on the worker's details.
// States: needs-details-row, clean-row, approve-disabled-focus, batch-summary at 1280 and 390, plus one full page per breakpoint.
// The dashboard flag is pinned by useCompletionsGroup.test.tsx (the dashboard needs a dozen mocked endpoints); not captured here.
import path from 'node:path'
import { prepareOutDir, cropElement, fullPage, writeChecks } from '../shots/lib/capture.mjs'
let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const item = (shiftId, staffName, participantName, missingDetails) => ({
  shiftId, completionId: `c-${shiftId}`, participantName, staffName, serviceDate: '2026-10-14',
  rosteredStart: '2026-10-13T22:00:00Z', rosteredEnd: '2026-10-14T04:00:00Z', actualStart: '2026-10-13T22:02:00Z', actualEnd: '2026-10-14T04:04:00Z',
  varianceMinutesStart: 2, varianceMinutesEnd: 4, status: 'PendingReview', timeZoneId: 'Australia/Sydney', isOutlierVariance: false, varianceReviewMinutes: 15,
  returnCount: 0, dosesWithoutOutcome: 0, breakMinutes: 0, startWasManual: false, timesAdjusted: false, offRoster: false, incidentCount: 0, missingDetails,
})
const ITEMS = [
  item('s-held', 'Ben Turner', 'Amy Ng', ['kilometres', 'tripTo', 'tripAfter', 'notes', 'handover', 'report']),
  item('s-clean', 'Priya Shah', 'Liam Okafor', []),
]
const paged = { items: ITEMS, totalCount: 2, page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrevious: false }
const checks = []
const check = (name, value, ok) => { checks.push({ name, pass: !!ok, detail: String(value) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value}`) }
const browser = await chromium.launch({ headless: true })

async function open(width, height, touch) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'light', reducedMotion: 'reduce', locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: touch, isMobile: touch })
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch (e) {} }, [USER_ID])
  const page = await context.newPage()
  if (touch) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.on('pageerror', (e) => check(`page error (${width})`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role: 'Coordinator', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role: 'Coordinator', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }) }))
  await page.route((u) => u.pathname === '/api/v1/rostering/completions', (r) => r.fulfill({ json: envelope(paged) }))
  await page.route((u) => u.pathname === '/api/v1/rostering/completions/approve-batch', (r) => r.fulfill({ json: envelope([
    { shiftId: 's-clean', approved: true, code: null, message: null },
    { shiftId: 's-held', approved: false, code: 'SHIFT_DETAILS_MISSING', message: 'This shift is waiting on the worker to add its details.' },
  ]) }))
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' }); await signIn.waitFor({ state: 'visible', timeout: 60000 }); await signIn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  await page.goto(BASE_URL + '/rostering/completions', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByText('Amy Ng').first().waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  return page
}

async function run(width, height, touch) {
  const bp = String(width)
  const page = await open(width, height, touch)
  const rowOf = (name) => page.locator('tr, [role="row"], li').filter({ hasText: name }).last()
  const held = rowOf('Amy Ng'), clean = rowOf('Liam Okafor')

  const cls = await held.getByText('Needs details').getAttribute('class')
  check(`badge uses the warning tone (${bp})`, cls, /warning/.test(cls ?? '') || /amber|yellow|orange/.test(cls ?? ''))
  const approve = held.getByRole('button', { name: /^Approve/ })
  const describedBy = await approve.getAttribute('aria-describedby')
  const lineText = await page.locator(`[id="${describedBy}"]`).textContent().catch(() => '')
  check(`Approve is disabled and described by the missing line (${bp})`, `${await approve.isDisabled()} ${describedBy} "${lineText}"`, await approve.isDisabled() && /Waiting on Ben to add: kilometres/.test(lineText ?? ''))
  check(`clean row has no badge and an enabled Approve (${bp})`, '', (await clean.getByText('Needs details').count()) === 0 && await clean.getByRole('button', { name: /^Approve/ }).isEnabled())

  const over = await held.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  check(`row does not overflow sideways (${bp})`, JSON.stringify(over), over.sw <= over.cw + 1)
  const ret = await held.getByRole('button', { name: /^Return/ }).boundingBox()
  const tapMin = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')) || 0)
  // A size=sm Button is --control-h-sm tall (36 on coarse) and carries the --tap-min hit area (TAP_AREA), so its box is measured against the control token.
  const ctlSm = await page.evaluate(() => { const p = document.createElement('div'); p.style.height = 'var(--control-h-sm)'; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h })
  if (touch) check(`Return is --control-h-sm tall with a --tap-min hit area (${bp})`, `${Math.round(ret.height)} vs ${ctlSm}, tap-min ${tapMin}`, tapMin >= 44 && ctlSm > 0 && ret.height >= ctlSm - 0.5)

  await cropElement(page, held, path.join(OUT_DIR, `needs-details-row-${bp}.png`), { touch })
  await cropElement(page, clean, path.join(OUT_DIR, `clean-row-${bp}.png`), { touch })
  await approve.focus().catch(() => {})
  await cropElement(page, held, path.join(OUT_DIR, `approve-disabled-focus-${bp}.png`), { touch })

  await page.getByLabel('Select row s-held').check()
  await page.getByLabel('Select row s-clean').check()
  await page.getByRole('button', { name: /approve selected \(2\)/i }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: /approve all/i }).click()
  const summary = page.getByRole('status').filter({ hasText: 'approved' }).first()
  await summary.waitFor({ timeout: 15000 })
  const text = (await summary.textContent()) ?? ''
  check(`batch summary names the left-out row (${bp})`, text, /1 approved, 1 left out: details missing\./.test(text))
  await cropElement(page, summary, path.join(OUT_DIR, `batch-summary-${bp}.png`), { touch })
  const full = await fullPage(page, path.join(OUT_DIR, 'full', `completions-${bp}.png`), { touch })
  checks.push(...full.checks)
  await page.context().close()
}

try {
  await run(1280, 800, false)
  await run(390, 844, true)
} finally {
  writeChecks(OUT_DIR, checks)
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
process.exit(failed.length ? 1 : 0)
