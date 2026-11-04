// R3: pick several drafts on the roster board and publish only those. Captures (shape section 9, states 1-7 at 1280 and 390 touch) plus its numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/roster-publish-several.mjs <outdir>
// Sign-in, the week's board and the publish POST are stubbed with page.route (synthetic rows, the week pinned to Mon 2026-08-17 through ?date=).
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
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const BUSY = 'The roster is being changed right now. Please try again.'

const shift = (id, date, over = {}) => ({
  id, participantId: 'p-1', participantName: 'Mia Chen', staffId: 'staff-9', staffName: 'Alex Ng', serviceDate: date, startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false,
  durationHours: 6, ratio: 'OneToOne', nightType: 'None', status: 'Draft', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...over,
})
const SHIFTS = [
  shift('alex-mon', '2026-08-17', { status: 'Published' }),
  shift('open-tue', '2026-08-18', { staffId: undefined, staffName: undefined }),
  shift('sam-wed', '2026-08-19', { staffId: 'staff-2', staffName: 'Sam Wilson' }),
  shift('alex-fri', '2026-08-21'),
  shift('sam-sat', '2026-08-22', { staffId: 'staff-2', staffName: 'Sam Wilson' }),
]
const board = {
  groupBy: 'Participant', weekStart: '2026-08-17', weekStarted: true, exceptions: [],
  days: ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'],
  participantRows: [{ participantId: 'p-1', fullName: 'Mia Chen', supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, shifts: SHIFTS, tripBars: [], scheduledHours: 24, daysWithoutCover: 3 }],
}
const VIEWPORTS = [{ name: '1280', width: 1280, height: 800, touch: false }, { name: '390', width: 390, height: 844, touch: true }]

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openBoard(browser, vp, publish) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`${vp.name}: page error`, false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/rostering/board*', (r) => r.fulfill({ json: envelope(board) }))
  await page.route('**/api/v1/rostering/weeks/*/publish', (r) => publish(r))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/rostering?date=2026-08-17`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('[data-publish-bar]').waitFor({ timeout: 60_000 })
  return { context, page }
}

const crop = async (page, locator, name, vp, pad = 16) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
const boxOf = (locator) => locator.evaluate((e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 } })
const chipOf = (page, id) => page.locator(`[data-shift-open="${id}"]`)
const bar = (page) => page.locator('[data-publish-bar]')
const barText = (page) => bar(page).locator('[aria-live="polite"]').innerText()
// A control's hit size: its own box or its TAP_AREA ::before pad, whichever is larger.
const hit = (locator) => locator.evaluate((e) => {
  const b = e.getBoundingClientRect(); const s = getComputedStyle(e, '::before')
  return { w: Math.max(b.width, parseFloat(s.width) || 0), h: Math.max(b.height, parseFloat(s.height) || 0) }
})

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    const tag = vp.name
    let mode = 'ok'
    const posts = []
    const { context, page } = await openBoard(browser, vp, (r) => {
      posts.push(JSON.parse(r.request().postData() ?? '{}'))
      if (mode === 'busy') return r.fulfill({ status: 409, json: { success: false, data: null, message: BUSY, errors: [BUSY] } })
      return r.fulfill({ json: envelope({ published: 1, notified: 1, unfilled: 0, skipped: 0 }) })
    })
    const sel = page.getByRole('button', { name: 'Select shifts' })

    // 1. The bar in normal mode.
    check(`${tag} 1: Select shifts sits beside Publish week`, await sel.isVisible() && await bar(page).getByRole('button', { name: 'Publish week' }).isVisible())
    const normalBar = await boxOf(bar(page))
    check(`${tag}: bar at most 56px in normal mode (1280)`, vp.touch || normalBar.h <= 56, normalBar.h)
    await crop(page, bar(page), `1-bar-normal-${tag}.png`, vp)

    // 2. Select mode, nothing ticked.
    await sel.click()
    await page.waitForFunction(() => document.querySelector('[data-publish-bar] [aria-live="polite"]') !== null)
    await page.waitForTimeout(250)
    check(`${tag} 2: zero-selected copy`, (await barText(page)) === 'Select the shifts to publish', await barText(page))
    check(`${tag} 2: Publish disabled at zero`, await bar(page).getByRole('button', { name: 'Publish', exact: true }).isDisabled())
    const selBar = await boxOf(bar(page))
    check(`${tag}: bar height in select mode (<=56 at 1280, <=112 at 390)`, selBar.h <= (vp.touch ? 112 : 56), selBar.h)
    await crop(page, bar(page), `2-select-empty-${tag}.png`, vp)

    // 3. Tick one (count text), then three.
    await chipOf(page, 'sam-wed').click()
    check(`${tag}: count text with one ticked`, (await barText(page)) === '1 shift selected', await barText(page))
    await chipOf(page, 'alex-fri').click()
    await chipOf(page, 'sam-sat').click()
    await page.mouse.move(0, 0)
    await page.waitForTimeout(250)
    check(`${tag} 3: count text with three ticked`, (await barText(page)) === '3 shifts selected', await barText(page))

    // Numeric checks on the three-ticked board.
    const ticked = await chipOf(page, 'sam-wed').evaluate((e) => {
      const wrap = e.closest('.group'); const box = wrap.querySelector('[data-select-box] > span').getBoundingClientRect()
      return { ring: getComputedStyle(wrap).boxShadow, box: Math.round(box.width * 10) / 10 }
    })
    check(`${tag}: selected ring is 2px`, /\b2px\b/.test(ticked.ring) && /inset/.test(ticked.ring), ticked.ring)
    check(`${tag}: tick box is 16px`, ticked.box === 16, ticked.box)
    const inert = await page.evaluate(() => ['open-tue', 'alex-mon'].map((id) => { const e = document.querySelector(`[data-shift-open="${id}"]`); return { id, checked: e.hasAttribute('aria-checked'), disabled: e.getAttribute('aria-disabled') } }))
    check(`${tag}: no aria-checked on non-selectable chips`, inert.every((i) => !i.checked && i.disabled === 'true'), inert)
    if (vp.touch) {
      const small = []
      for (const id of ['sam-wed', 'alex-fri', 'sam-sat']) { const h = await hit(chipOf(page, id)); if (h.h < 43.5 || h.w < 43.5) small.push({ id, ...h }) }
      check(`${tag}: chip controls at least 44x44 on coarse pointer`, small.length === 0, small)
      const btns = await bar(page).locator('button').evaluateAll((els) => els.map((e) => {
        const b = e.getBoundingClientRect(); const s = getComputedStyle(e, '::before')
        return { name: (e.textContent || '').trim(), w: Math.max(b.width, parseFloat(s.width) || 0), h: Math.max(b.height, parseFloat(s.height) || 0) }
      }))
      check(`${tag}: bar buttons at least 44x44 on coarse pointer`, btns.length > 0 && btns.every((b) => b.w >= 43.5 && b.h >= 43.5), btns)
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    check(`${tag}: no horizontal scroll`, overflow === 0, overflow)
    await crop(page, page.locator('[data-fit-screen]').first(), `3-three-ticked-${tag}.png`, vp)
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `3-three-ticked-${tag}.png`), { touch: vp.touch })).checks)

    // 4. Keyboard focus ring on a chip (1280 only).
    if (!vp.touch) {
      await chipOf(page, 'sam-wed').focus()
      await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
      await crop(page, chipOf(page, 'sam-wed').locator('xpath=ancestor::div[contains(concat(" ",@class," ")," group ")][1]'), `4-focus-ring-${tag}.png`, vp, 12)
    }

    // 5. The confirm dialog.
    await bar(page).getByRole('button', { name: 'Publish 3 shifts' }).click()
    const dialog = page.getByRole('alertdialog')
    await dialog.waitFor()
    check(`${tag} 5: confirm names three shifts`, (await dialog.innerText()).includes('Publish 3 shifts?'))
    await crop(page, dialog, `5-confirm-${tag}.png`, vp, 24)

    // 6. A 409 busy answer keeps the selection.
    mode = 'busy'
    await dialog.getByRole('button', { name: 'Publish 3 shifts' }).click()
    await page.getByText(/roster is being changed/i).first().waitFor()
    await page.waitForTimeout(250)
    check(`${tag} 6: selection kept after 409`, (await chipOf(page, 'sam-wed').getAttribute('aria-checked')) === 'true' && (await barText(page)) === '3 shifts selected')
    check(`${tag} 6: the request carried the three ids`, JSON.stringify(posts[0]?.shiftIds) === JSON.stringify(['sam-wed', 'alex-fri', 'sam-sat']), posts[0])
    await crop(page, page.locator('[data-fit-screen]').first(), `6-busy-${tag}.png`, vp)

    // 7. A short result: one of three published, the rest changed since.
    mode = 'ok'
    await bar(page).getByRole('button', { name: 'Publish 3 shifts' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publish 3 shifts' }).click()
    const done = page.getByText(/had changed since you selected/).first()
    await done.waitFor()
    await page.waitForTimeout(250)
    check(`${tag} 7: short-result sentence`, (await done.innerText()).includes('Published 1 shift. 1 person notified. 2 shifts had changed since you selected them and were left alone.'), await done.innerText())
    check(`${tag} 7: select mode closed`, await page.locator('[role="checkbox"], [aria-checked]').count() === 0)
    await crop(page, page.locator('[data-fit-screen]').first(), `7-success-${tag}.png`, vp)
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
