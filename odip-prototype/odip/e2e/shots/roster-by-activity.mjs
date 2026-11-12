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

// Per option: the box, the label's text rects (one rect = one line) and whether the text sits inside the box.
const toggleProbe = (g) => [...g.querySelectorAll('[role=radio]')].map((b) => {
  const r = b.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(b)
  const rects = [...range.getClientRects()]; const t = range.getBoundingClientRect()
  return { text: b.textContent, h: r.height, top: Math.round(r.top), w: Math.round(r.width * 10) / 10, textW: Math.round(t.width * 10) / 10, lines: rects.length, inside: t.left >= r.left - 0.5 && t.right <= r.right + 0.5 && b.scrollWidth <= b.clientWidth }
})
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
    const toggle = await page.getByRole('radiogroup').first().evaluate(toggleProbe)
    if (touch) console.log('TOGGLE-390', JSON.stringify(toggle))
    const controlH = await cssPx(page, '--control-h')
    check(`${tag}: three view options`, toggle.length === 3 && toggle[2].text === 'By activity', JSON.stringify(toggle.map((t) => t.text)))
    check(`${tag}: toggle height equals --control-h (${controlH}px)`, toggle.every((t) => Math.abs(t.h - controlH) <= 1), JSON.stringify(toggle.map((t) => t.h)))
    check(`${tag}: toggle on one line, labels not clipped`, new Set(toggle.map((t) => t.top)).size === 1 && toggle.every((t) => t.lines === 1 && t.inside), JSON.stringify(toggle))

    // 3, 4, 8: lane first cell, lane height, day cell alignment with the header
    const geo = await page.evaluate(() => {
      const day = document.querySelector('[data-activity-day]')
      const lane = day?.parentElement?.previousElementSibling
      const body = document.querySelector('[data-activity-day]')?.parentElement
      const strip = [...document.querySelectorAll('div[style*="grid-column"]')].find((e) => !e.querySelector('[data-activity-day]') && e.children.length === 7)
      const header = [...(strip?.children ?? [])]
      const probe = document.createElement('div'); probe.style.width = 'var(--roster-sticky-col, 195px)'; lane?.appendChild(probe); const stickyCol = probe.getBoundingClientRect().width; probe.remove()
      return { stickyCol, laneW: lane?.getBoundingClientRect().width ?? 0, laneH: lane?.getBoundingClientRect().height ?? 0, cells: [...(body?.children ?? [])].map((c) => c.getBoundingClientRect().left), header: header.map((h) => h.getBoundingClientRect().left) }
    })
    const stickyCol = geo.stickyCol
    const rowH = await cssPx(page, '--row-h')
    check(`${tag}: lane first cell equals --roster-sticky-col, 195px below 1500 (${stickyCol}px)`, Math.abs(geo.laneW - stickyCol) <= 1, `lane ${geo.laneW}`)
    check(`${tag}: lane height at least --row-h (${rowH}px)`, geo.laneH >= rowH - 1, `lane ${geo.laneH}`)
    check(`${tag}: header day cells found (7)`, geo.header.length === 7 && geo.cells.length === 7, `${geo.header.length}/${geo.cells.length}`)
    if (geo.header.length === geo.cells.length) check(`${tag}: lane day cells line up with the header`, geo.cells.every((x, i) => Math.abs(x - geo.header[i]) <= 1), JSON.stringify({ cells: geo.cells.map(Math.round), header: geo.header.map(Math.round) }))

    // 5, 6: card open area and menu trigger
    const open1 = await bowling.evaluate((b) => parseFloat(getComputedStyle(b.parentElement).gridTemplateRows.split(' ')[1]))
    check(`${tag}: card open row (second grid row) equals --control-h`, Math.abs(open1 - controlH) <= 1, `card ${open1}`)
    const menu = page.getByRole('button', { name: /actions|menu|more/i }).first()
    if (await menu.count()) {
      const mb = await menu.boundingBox()
      const smH = await cssPx(page, '--control-h-sm')
      const tapMin = await cssPx(page, '--tap-min')
      check(`${tag}: card menu trigger is --control-h-sm (${smH}px) on a fine pointer, at least --tap-min (${tapMin}px) on a coarse one`, !!mb && (touch ? mb.height >= tapMin - 1 && mb.width >= tapMin - 1 : Math.abs(mb.height - smH) <= 1 && Math.abs(mb.width - smH) <= 1), JSON.stringify(mb))
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
      // no staff (Art group: needs 2, has 0, the server's ACTIVITY_STAFF_SHORT) and Draft (Swimming): the card is asserted, then captured whole and cropped
      const stateCard = (name) => page.getByRole('button', { name: new RegExp('^Group activity, ' + name) }).first().locator('xpath=..')
      const art = stateCard('Art group'); await art.scrollIntoViewIfNeeded()
      const pill = art.locator('[data-activity-count] .rounded-full')
      // The 1440 day column is under the card's 180px container breakpoint, so the pill shows "0/2" (the words stay in the DOM and the accessible name); the words and the short form are both asserted.
      check('activity-1440-no-staff: warning pill holds "0 of 2 staff" (shown as 0/2 in a narrow column)', (await pill.count()) === 1 && /0 of 2 staff/.test(await pill.textContent()) && /^0\/2$|^0 of 2 staff$/.test((await pill.innerText()).trim()), (await pill.count()) + ' pill; ' + (await art.first().innerText()).replace(/\s+/g, ' '))
      await page.screenshot({ path: path.join(OUT_DIR, 'full', 'activity-1440-no-staff.png') })
      await cropElement(page, art, path.join(OUT_DIR, 'crops', 'activity-1440-no-staff.png'), { pad: 16, touch: false })
      const swim = stateCard('Swimming'); await swim.scrollIntoViewIfNeeded()
      const title = await swim.locator('[data-activity-title]').innerText()
      check('activity-1440-draft: card title starts with the word Draft', /^Draft/.test(title), JSON.stringify(title))
      await page.screenshot({ path: path.join(OUT_DIR, 'full', 'activity-1440-draft.png') })
      await cropElement(page, swim, path.join(OUT_DIR, 'crops', 'activity-1440-draft.png'), { pad: 16, touch: false })
      // Item 1 (polish 97): in the narrow 1440 column the title drops under the times and Draft is never cut; widened, it sits on the times line again (Draft and plain cards alike).
      const rowOf = (c) => c.locator('[data-activity-title]').evaluate((t) => {
        const r = t.parentElement.firstElementChild.getBoundingClientRect(), tt = t.getBoundingClientRect(), d = t.firstElementChild
        return { under: tt.top >= r.bottom - 0.5, sameLine: Math.abs(tt.top + tt.height / 2 - (r.top + r.height / 2)) < r.height, draftWhole: d && d.textContent === 'Draft' ? d.scrollWidth <= d.clientWidth : null }
      })
      const narrow = await rowOf(swim)
      check('activity-1440-draft-narrow: title under the times, word Draft whole', narrow.under && narrow.draftWhole === true, JSON.stringify(narrow))
      const nextCard = swim.locator('xpath=following-sibling::*[1]')
      if (await nextCard.count()) { const a1 = await swim.boundingBox(), b1 = await nextCard.boundingBox(); check('activity-1440-draft-narrow: card clears the next sibling', !a1 || !b1 || a1.y + a1.height <= b1.y + 0.5, JSON.stringify({ a1, b1 })) }
      await cropElement(page, swim, path.join(OUT_DIR, 'crops', 'activity-1440-draft-narrow.png'), { pad: 16, touch: false })
      const bowl = stateCard('Bowling'); await bowl.scrollIntoViewIfNeeded()
      await swim.evaluate((el) => { el.style.width = '260px' }); await bowl.evaluate((el) => { el.style.width = '260px' })
      const wideDraft = await rowOf(swim), widePlain = await rowOf(bowl)
      check('activity-1440-draft-wide: title on the times line (Draft and plain card), Draft whole', wideDraft.sameLine && widePlain.sameLine && wideDraft.draftWhole === true, JSON.stringify({ wideDraft, widePlain }))
      await cropElement(page, swim, path.join(OUT_DIR, 'crops', 'activity-1440-draft-wide.png'), { pad: 16, touch: false })
      await swim.evaluate((el) => { el.style.width = '' }); await bowl.evaluate((el) => { el.style.width = '' })
      // 11 keyboard: Enter opens the panel, focus returns to the card on close
      await bowling.focus()
      await page.keyboard.press('Enter')
      const dlg = page.getByRole('dialog')
      await dlg.waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(400)
      await page.screenshot({ path: path.join(OUT_DIR, 'full', 'activity-1440-panel-open.png') })
      await page.keyboard.press('Escape')
      await dlg.waitFor({ state: 'hidden', timeout: 30_000 })
      await page.waitForTimeout(400)
      const active = await page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, label: a?.getAttribute('aria-label') ?? a?.textContent?.slice(0, 60) } })
      check('activity-1440: focus returns to the card on close', /Group activity, Bowling/.test(active.label ?? ''), JSON.stringify(active))
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
      const toggle = await page.getByRole('radiogroup').first().evaluate(toggleProbe)
      console.log('TOGGLE-390-EMPTY', JSON.stringify(toggle))
      check('toolbar-390-touch-three-options: one row, each label one line, no clip', toggle.length === 3 && new Set(toggle.map((t) => t.top)).size === 1 && toggle.every((t) => t.lines === 1 && t.inside), JSON.stringify(toggle))
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
