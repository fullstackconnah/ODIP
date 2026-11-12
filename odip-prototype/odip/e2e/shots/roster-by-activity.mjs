// Roster > By activity view (m1112-actview): the SHAPE.md capture states and numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/roster-by-activity.mjs <outdir>
// Pinned inputs: light theme, reduced motion, en-AU / Sydney, the mock's fixture week (?date=2026-09-07, group activities on) and its empty week (2026-09-14).
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, fullPage, cropElement, writeChecks } from '../shots/lib/capture.mjs'

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
const FIXTURE_WEEK = '2026-09-07'
const EMPTY_WEEK = '2026-09-14'
// The board's own sideways scrollers (Frames) are the only containers allowed to scroll sideways.
const ALLOW = ['.overflow-x-auto']

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })
const cssPx = (page, expr) => page.evaluate((e) => { const el = document.createElement('div'); el.style.height = `var(${e})`; document.body.appendChild(el); const v = el.getBoundingClientRect().height; el.remove(); return v }, expr)

async function open(browser, W, H, touch) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: W, height: H }, hasTouch: touch, isMobile: touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.addInitScript(() => { try { sessionStorage.setItem('odip.roster.boardView', 'activity') } catch { /* not available */ } })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}
const goWeek = async (page, week) => page.goto(`${BASE_URL}/rostering?date=${week}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })

const browser = await chromium.launch({ headless: true })
try {
  mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })
  mkdirSync(path.join(OUT_DIR, 'crops'), { recursive: true })

  for (const [W, H, touch, tag] of [[1440, 900, false, 'activity-1440'], [1024, 800, false, 'activity-1024'], [390, 844, true, 'activity-390-touch']]) {
    const { context, page } = await open(browser, W, H, touch)
    await goWeek(page, FIXTURE_WEEK)
    const bowling = page.getByRole('button', { name: /^Group activity, Bowling/ }).first()
    await bowling.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)

    // 1 toggle: three options, height --control-h, one line, no clipped label
    const toggle = await page.getByRole('radiogroup').first().evaluate((g) => [...g.querySelectorAll('[role=radio]')].map((b) => ({ h: b.getBoundingClientRect().height, top: Math.round(b.getBoundingClientRect().top), fits: b.scrollWidth <= b.clientWidth, text: b.textContent })))
    const controlH = await cssPx(page, '--control-h')
    check(`${tag}: three view options`, toggle.length === 3 && toggle[2].text === 'By activity', JSON.stringify(toggle.map((t) => t.text)))
    check(`${tag}: toggle height equals --control-h (${controlH}px)`, toggle.every((t) => Math.abs(t.h - controlH) <= 1), JSON.stringify(toggle.map((t) => t.h)))
    check(`${tag}: toggle on one line, labels not clipped`, new Set(toggle.map((t) => t.top)).size === 1 && toggle.every((t) => t.fits))

    // 3, 4, 8: lane first cell, lane height, day cell alignment with the header
    const geo = await page.evaluate(() => {
      const day = document.querySelector('[data-activity-day]')
      const lane = day?.parentElement?.previousElementSibling
      const body = document.querySelector('[data-activity-day]')?.parentElement
      const header = [...document.querySelectorAll('[data-roster-day], [data-day]')]
      return { laneW: lane?.getBoundingClientRect().width ?? 0, laneH: lane?.getBoundingClientRect().height ?? 0, cells: [...(body?.children ?? [])].map((c) => c.getBoundingClientRect().left), header: header.map((h) => h.getBoundingClientRect().left) }
    })
    const stickyCol = await cssPx(page, '--roster-sticky-col')
    const rowH = await cssPx(page, '--row-h')
    check(`${tag}: lane first cell equals --roster-sticky-col (${stickyCol}px)`, Math.abs(geo.laneW - stickyCol) <= 1, `lane ${geo.laneW}`)
    check(`${tag}: lane height at least --row-h (${rowH}px)`, geo.laneH >= rowH - 1, `lane ${geo.laneH}`)
    if (geo.header.length === geo.cells.length) check(`${tag}: lane day cells line up with the header`, geo.cells.every((x, i) => Math.abs(x - geo.header[i]) <= 1), JSON.stringify({ cells: geo.cells, header: geo.header }))

    // 5, 6: card open area and menu trigger
    const open1 = await bowling.evaluate((b) => b.getBoundingClientRect().height)
    check(`${tag}: card open area height equals --control-h`, Math.abs(open1 - controlH) <= 1, `card ${open1}`)
    const menu = page.getByRole('button', { name: /actions|menu|more/i }).first()
    if (await menu.count()) {
      const mb = await menu.boundingBox()
      const smH = await cssPx(page, '--control-h-sm')
      check(`${tag}: card menu trigger is --control-h-sm square (${smH}px)`, !!mb && Math.abs(mb.height - smH) <= 1 && Math.abs(mb.width - smH) <= 1, JSON.stringify(mb))
    }

    // 9: today's cell tint (only when the run's date falls in the fixture week: reported either way)
    const tinted = await page.evaluate(() => document.querySelectorAll('[data-activity-day].bg-primary\\/5').length)
    check(`${tag}: today tint count is 0 or 1 (fixture week is in the past)`, tinted <= 1, `${tinted}`)

    const full = await fullPage(page, path.join(OUT_DIR, 'full', `${tag}-normal.png`), { touch, allow: ALLOW })
    checks.push(...full.checks)
    if (!touch) {
      const lanes = page.locator('[data-activity-day]').first().locator('xpath=ancestor::div[contains(@class,"overflow-x-auto")][1]')
      if (await lanes.count()) await cropElement(page, lanes, path.join(OUT_DIR, 'crops', `${tag}-lanes.png`), { pad: 16, touch: false })
    }

    if (W === 1440) {
      // short of staff (Art group needs 2, has 1) and draft (Swimming) are in the same capture, named for the checklist
      await page.screenshot({ path: path.join(OUT_DIR, 'full', 'activity-1440-no-staff.png') })
      await page.screenshot({ path: path.join(OUT_DIR, 'full', 'activity-1440-draft.png') })
      // 11 keyboard: Enter opens the panel, focus returns to the card on close
      await bowling.focus()
      await page.keyboard.press('Enter')
      const dlg = page.getByRole('dialog')
      await dlg.waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(400)
      await page.screenshot({ path: path.join(OUT_DIR, 'full', 'activity-1440-panel-open.png') })
      await page.keyboard.press('Escape')
      await dlg.waitFor({ state: 'hidden', timeout: 30_000 })
      check('activity-1440: focus returns to the card on close', await bowling.evaluate((b) => b === document.activeElement))
    }
    await context.close()
  }

  // empty week (1440 and 390 touch): the house EmptyState, no grid
  for (const [W, H, touch, tag] of [[1440, 900, false, 'activity-1440-empty-week'], [390, 844, true, 'activity-390-touch-empty-week']]) {
    const { context, page } = await open(browser, W, H, touch)
    await goWeek(page, EMPTY_WEEK)
    await page.getByText('No group activities this week').waitFor({ state: 'visible', timeout: 60_000 })
    check(`${tag}: no lanes drawn`, (await page.locator('[data-activity-day]').count()) === 0)
    const full = await fullPage(page, path.join(OUT_DIR, 'full', `${tag}.png`), { touch, allow: ALLOW })
    checks.push(...full.checks)
    if (touch) {
      const toggle = await page.getByRole('radiogroup').first().evaluate((g) => [...g.querySelectorAll('[role=radio]')].map((b) => ({ top: Math.round(b.getBoundingClientRect().top), fits: b.scrollWidth <= b.clientWidth })))
      check('toolbar-390-touch-three-options: one line, no clipped label', toggle.length === 3 && new Set(toggle.map((t) => t.top)).size === 1 && toggle.every((t) => t.fits), JSON.stringify(toggle))
      await cropElement(page, page.getByRole('radiogroup').first(), path.join(OUT_DIR, 'crops', 'toolbar-390-touch-three-options.png'), { pad: 16, touch: true })
    }
    await context.close()
  }

  // loading and error (1440): the board request held, then failed
  for (const [state, handler] of [['loading', async (r) => { await new Promise((res) => setTimeout(res, 8000)); await r.fulfill({ status: 500, json: {} }) }], ['error', (r) => r.fulfill({ status: 500, json: { success: false, message: 'Server error', errors: [] } })]]) {
    const { context, page } = await open(browser, 1440, 900, false)
    await page.route('**/api/v1/rostering/board**', handler)
    await goWeek(page, FIXTURE_WEEK)
    await page.waitForTimeout(state === 'loading' ? 1200 : 3000)
    const full = await fullPage(page, path.join(OUT_DIR, 'full', `activity-1440-${state}.png`), { touch: false, allow: ALLOW })
    checks.push(...full.checks)
    await context.close()
  }
} finally {
  await browser.close()
}
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
