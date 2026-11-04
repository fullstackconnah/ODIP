// ROSTER-ACTIONBAR shots: the Publish bar as a floating pill inside the board scroller. Captures every state of the shape's `Capture states:` line plus its numeric checks (shape 5). Exit 1 on any failed check (an assertion failure blocks completion even when the script exits 0).
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/roster-action-bar.mjs <outdir>
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const OUT_DIR = process.env.OUT_DIR, BASE_URL = process.env.BASE_URL
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const WEEK = '2026-09-07'
const shift = (id, pid, staffId, staffName, date, status, findings = []) => ({
  id, participantId: pid, participantName: 'x', staffId, staffName, serviceDate: date, startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false,
  durationHours: 6, ratio: 'OneToOne', nightType: 'None', status, shiftPatternId: null, notes: null, overrideReason: null, findings, assigneeOnApprovedLeave: false,
})
const NAMES = ['Ava Nguyen', 'Noah Williams', 'Olivia Brown', 'Ethan Singh', 'Isla Roberts', 'Lucas Martin', 'Chloe Kelly', 'Jack Taylor']

// mode: drafts | blocked (drafts + one blocked) | allblocked (only a blocked draft) | published | short (3 rows, drafts)
function shape(board, mode) {
  const rows = board.participantRows
  if (mode === 'short') rows.splice(3)
  const n = mode === 'short' ? 0 : 28
  for (let i = 0; i < n; i++) {
    const pid = `p-busy-${i}`
    const draft = mode !== 'allblocked' && mode !== 'published' && i % 2
    const open = draft && i % 4 === 1 // unstaffed draft: a Needs staff chip with a plus
    rows.push({ participantId: pid, fullName: `${NAMES[i % 8]} ${i}`, supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, inOnboarding: false,
      shifts: [shift(`busy-r${i}`, pid, open ? null : 's-0003', open ? null : "Jack O'Sullivan", board.days[i % 7], draft ? 'Draft' : 'Published')],
      tripBars: [], scheduledHours: 6, daysWithoutCover: 6 })
  }
  if (mode === 'short') for (const r of rows) r.shifts = [shift(`sh-${r.participantId}`, r.participantId, 's-0003', "Jack O'Sullivan", board.days[1], 'Draft')]
  if (mode === 'blocked' || mode === 'allblocked') rows[0].shifts.push(shift('blk-1', rows[0].participantId, 's-0003', "Jack O'Sullivan", board.days[1], 'Draft', [{ code: 'QUALIFICATION_EXPIRED', severity: 'Blocking', message: 'First aid certificate expired.', requiresReason: false }]))
  board.pendingAgreements = mode === 'drafts' ? [{ participantId: 'p-0001', displayName: 'Liam Okafor', draftId: 'd-1', version: 2, canReceiveServices: true }] : []
  return board
}

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail }); if (!pass) console.log('[ab] FAIL', name, JSON.stringify(detail)) }
const rnd = (n) => Math.round(n * 10) / 10
async function open(width, height, { mode = 'drafts', theme = 'light', role = 'Coordinator', reduced = 'reduce', to = '/rostering?date=' + WEEK } = {}) {
  const touch = width < 700
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: reduced, locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: touch, isMobile: touch })
  await context.addInitScript(([id, t]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: t })) } catch (e) {} }, [USER_ID, theme])
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }) }))
  await page.route('**/api/v1/rostering/board*', async (route) => {
    const res = await route.fetch(); const body = await res.json()
    if (body && body.data && body.data.weekStart === WEEK) body.data = shape(body.data, mode)
    return route.fulfill({ response: res, json: body })
  })
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' }); await signIn.waitFor({ state: 'visible', timeout: 60000 }); await signIn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  await page.goto(BASE_URL + to, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  if (width >= 1024) await page.waitForFunction(() => { const m = document.querySelector('#main'), a = document.querySelector('aside'); return m && a && m.getBoundingClientRect().left >= a.getBoundingClientRect().right - 1 }, null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
  return { context, page }
}
const SCROLLER = '[data-fit-screen] [class~="lg:overflow-y-auto"]'
const crop = async (page, name) => {
  const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }))
  const hh = Math.min(h, 360)
  await page.screenshot({ path: path.join(OUT_DIR, name + '.png'), clip: { x: 0, y: h - hh, width: w, height: hh } })
}
const toEnd = async (page) => {
  await page.evaluate((sel) => { const b = document.querySelector(sel); if (b && b.scrollHeight > b.clientHeight) b.scrollTop = b.scrollHeight; scrollTo(0, document.scrollingElement.scrollHeight) }, SCROLLER)
  await page.waitForTimeout(300)
}
// Page-side numbers for the pill (the bar's firstElementChild), its wrapper, the scroller, the body frame, footer and nav.
const probe = (page) => page.evaluate((sel) => {
  const r = (el) => (el ? el.getBoundingClientRect() : null)
  const wrap = document.querySelector('[data-publish-bar]'), pill = wrap && wrap.firstElementChild, box = document.querySelector(sel), f = document.querySelector('footer'), nav = document.querySelector('nav[aria-label="Mobile"]')
  const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--section-gap'))
  const o = { gap, innerWidth, innerHeight, hScroll: document.documentElement.scrollWidth > innerWidth, hasBar: !!wrap }
  if (!pill) return o
  const p = r(pill), cs = getComputedStyle(pill)
  Object.assign(o, { pillTop: p.top, pillBottom: p.bottom, pillH: p.height, pillW: p.width, pillCx: p.left + p.width / 2, wrapBottom: r(wrap).bottom, wrapBg: getComputedStyle(wrap).backgroundColor })
  if (box) Object.assign(o, { boxBottom: r(box).bottom, boxCx: r(box).left + r(box).width / 2, bodyBottom: r(box.children[1]).bottom })
  if (f) o.footerTop = r(f).top
  if (nav && r(nav).height > 0) o.navTop = r(nav).top
  const mid = document.elementFromPoint(p.left + p.width / 2, p.top + p.height / 2)
  o.topmostIsPill = !!mid && pill.contains(mid)
  const probeEls = [...pill.querySelectorAll('p, span')].filter((e) => e.children.length === 0 || e.tagName === 'P')
  o.trunc = probeEls.filter((e) => e.scrollWidth > e.clientWidth + 0.5).length
  const title = pill.querySelector('p')
  o.titleH = title ? r(title).height : 0
  o.buttons = [...pill.querySelectorAll('button')].map((b) => ({ t: b.textContent.trim(), w: r(b).width, h: r(b).height }))
  o.anim = cs.animationName; o.bg = cs.backgroundColor; o.border = cs.borderTopColor; o.radius = cs.borderTopLeftRadius; o.shadow = cs.boxShadow; o.opacity = cs.opacity; o.pe = cs.pointerEvents
  return o
}, SCROLLER)
// The tokens' resolved colours, through a canvas so any colour syntax comes back as rgb.
const tokenAndContrast = (page) => page.evaluate(() => {
  const norm = (c) => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = '#000'; x.fillStyle = c; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]] }
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  const root = getComputedStyle(document.documentElement), tok = (n) => root.getPropertyValue(n).trim()
  const pill = document.querySelector('[data-publish-bar]').firstElementChild, cs = getComputedStyle(pill)
  const bg = norm(cs.backgroundColor), out = { popover: norm(tok('--color-popover')).join(), bg: bg.join(), border: norm(cs.borderTopColor).join(), borderTok: norm(tok('--color-border')).join() }
  const ps = [...pill.querySelectorAll('p')]
  out.ratios = ps.map((p) => rnd(ratio(norm(getComputedStyle(p).color), bg)))
  function rnd(n) { return Math.round(n * 10) / 10 }
  return out
})
const scrollerMid = (page) => page.evaluate((sel) => { const b = document.querySelector(sel); b.scrollTop = Math.min(400, b.scrollHeight - b.clientHeight); scrollTo(0, 0) }, SCROLLER).then(() => page.waitForTimeout(250))

// ---- 1280, light: placement, widths, tokens, motion, keyboard, menus, drag --------------------------------------------------
{
  const { context, page } = await open(1280, 800, { reduced: 'no-preference' })
  await crop(page, 'drafts-1280-top-light')
  const top = await probe(page)
  check('N15 motion: installIn', top.anim === 'installIn', top.anim)
  check('N8 no h-scroll 1280', !top.hScroll)
  check('N2 top: pill bottom = scroller bottom - gap', Math.abs(top.pillBottom - (top.boxBottom - top.gap)) <= 0.5 && top.pillBottom <= top.innerHeight - top.gap + 0.5, { pillBottom: rnd(top.pillBottom), boxBottom: rnd(top.boxBottom), gap: top.gap })
  check('N2 top: pill is topmost at its centre', top.topmostIsPill)
  check('N5 1280 width 720, centred on the scroller', Math.abs(top.pillW - 720) <= 1 && Math.abs(top.pillCx - top.boxCx) <= 1, { w: rnd(top.pillW), cx: rnd(top.pillCx), box: rnd(top.boxCx) })
  check('N6 rest <= 52 (1280)', top.pillH <= 52, rnd(top.pillH))
  check('N7 1280 buttons >= 32 tall', top.buttons.every((b) => b.h >= 32), top.buttons)
  check('N9 no truncation, title one line', top.trunc === 0 && top.titleH <= 20.5, { trunc: top.trunc, titleH: top.titleH })
  const tc = await tokenAndContrast(page)
  check('N11 tokens: bg popover, border, radius 12, shadow, wrapper transparent', tc.bg === tc.popover && tc.border === tc.borderTok && top.radius === '12px' && top.shadow !== 'none' && top.wrapBg === 'rgba(0, 0, 0, 0)', { tc, radius: top.radius, shadow: top.shadow.slice(0, 40), wrapBg: top.wrapBg })
  check('N10 contrast light >= 4.5', tc.ratios.every((r) => r >= 4.5), tc.ratios)
  // mid-scroll
  await scrollerMid(page)
  const mid = await probe(page)
  check('N2 mid-scroll: pill bottom = scroller bottom - gap, topmost', Math.abs(mid.pillBottom - (mid.boxBottom - mid.gap)) <= 0.5 && mid.topmostIsPill, { pillBottom: rnd(mid.pillBottom), boxBottom: rnd(mid.boxBottom) })
  // N12: a Needs staff picker opened on the lowest visible row stays above the pill
  const menu = await page.evaluate(async (sel) => {
    const pill = document.querySelector('[data-publish-bar]').firstElementChild.getBoundingClientRect(), box = document.querySelector(sel).getBoundingClientRect()
    const plus = [...document.querySelectorAll('[data-shift-plus]')].map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.bottom < pill.top && r.top > box.top).sort((a, b) => b.r.bottom - a.r.bottom)[0]
    if (!plus) return { found: false }
    plus.e.click(); await new Promise((r) => setTimeout(r, 500))
    const dlg = document.querySelector('[role="dialog"]:not([aria-modal="true"]), [role="menu"], [role="listbox"]')
    if (!dlg) return { found: true, dialog: false }
    const d = dlg.getBoundingClientRect(), hit = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2)
    return { found: true, dialog: true, onTop: !!hit && dlg.contains(hit) }
  }, SCROLLER)
  check('N12 picker panel is above the pill', menu.found && menu.dialog && menu.onTop, menu)
  await page.keyboard.press('Escape')
  // N14: focus a chip that starts under the pill; it ends above the pill
  await page.evaluate((sel) => { document.querySelector(sel).scrollTop = 0; scrollTo(0, 0) }, SCROLLER)
  const kb = await page.evaluate(async () => {
    const pillTop = document.querySelector('[data-publish-bar]').firstElementChild.getBoundingClientRect().top
    const el = [...document.querySelectorAll('[data-shift-plus], [data-shift-open]')].find((e) => e.getBoundingClientRect().top >= pillTop)
    if (!el) return { found: false }
    el.focus(); await new Promise((r) => setTimeout(r, 400))
    const pt = document.querySelector('[data-publish-bar]').firstElementChild.getBoundingClientRect().top
    return { found: true, chipBottom: el.getBoundingClientRect().bottom, pillTop: pt }
  })
  check('N14 keyboard 1280: focused chip ends above the pill', kb.found && kb.chipBottom <= kb.pillTop + 0.5, kb)
  // end of the board and page
  await toEnd(page)
  await crop(page, 'drafts-1280-end-footer')
  const end = await probe(page)
  check('N3 end: pill clear of last row, above footer', end.pillTop >= end.bodyBottom + end.gap - 0.5 && end.pillBottom <= end.footerTop - end.gap + 0.5, { pillTop: rnd(end.pillTop), bodyBottom: rnd(end.bodyBottom), pillBottom: rnd(end.pillBottom), footerTop: rnd(end.footerTop) })
  // focus ring on Publish week
  await page.evaluate((sel) => { document.querySelector(sel).scrollTop = 0; scrollTo(0, 0) }, SCROLLER)
  await page.keyboard.press('Tab')
  await page.getByRole('button', { name: 'Publish week' }).focus()
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab')
  await crop(page, 'focus-publish-1280')
  // N13 drag
  const grip = page.getByRole('button', { name: /drag to move/i }).first()
  if (await grip.count()) {
    const b = await grip.boundingBox()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + b.width / 2 + i * 8, b.y + b.height / 2 + i * 8)
    await page.waitForTimeout(400)
    const during = await probe(page)
    await crop(page, 'drag-carry-1280')
    await page.mouse.up(); await page.waitForTimeout(400)
    const after = await probe(page)
    check('N13 drag: pill opacity 0 and no pointer events, then back to 1', during.opacity === '0' && during.pe === 'none' && after.opacity === '1', { during: [during.opacity, during.pe], after: after.opacity })
  } else { check('N13 drag: a grip exists', false, 'no [drag to move] button (strip may need staff)'); await crop(page, 'drag-carry-1280') }
  // select mode 0 and 3
  await page.evaluate((sel) => { document.querySelector(sel).scrollTop = 0; scrollTo(0, 0) }, SCROLLER)
  await page.getByRole('button', { name: 'Select shifts' }).click(); await page.waitForTimeout(300)
  const s0 = await probe(page); await crop(page, 'selecting-0-1280')
  await page.getByRole('button', { name: 'Select all' }).click(); await page.waitForTimeout(200)
  const sAll = await probe(page)
  const chips = page.locator('[data-shift-chip][aria-checked], [data-shift-chip] [aria-checked]')
  await page.getByRole('button', { name: 'Clear' }).click()
  for (let i = 0; i < 3; i++) await chips.nth(i).click({ force: true })
  await page.waitForTimeout(250)
  const s3 = await probe(page); await crop(page, 'selecting-3-1280')
  check('N6 select 0 / 3 <= 52, one row', s0.pillH <= 52 && s3.pillH <= 52, [rnd(s0.pillH), rnd(s3.pillH)])
  check('N7 select buttons >= 32', [s0, s3, sAll].every((s) => s.buttons.every((b) => b.h >= 32)))
  check('N9 select title one line', s0.titleH <= 20.5 && s3.titleH <= 20.5 && s0.trunc === 0, [s0.titleH, s3.titleH])
  await context.close()
}
// ---- 1280, reduced motion + dark ---------------------------------------------------------------------------------------------
{
  const { context, page } = await open(1280, 800, { theme: 'dark', reduced: 'reduce' })
  await crop(page, 'drafts-1280-top-dark')
  const p = await probe(page), tc = await tokenAndContrast(page)
  check('N15 reduced motion: installFadeIn', p.anim === 'installFadeIn', p.anim)
  check('N10 contrast dark >= 4.5', tc.ratios.every((r) => r >= 4.5), tc.ratios)
  check('N11 dark tokens', tc.bg === tc.popover && tc.border === tc.borderTok, tc)
  await context.close()
}
// ---- 1280 states: blocked, all blocked, reader, short week, no drafts ------------------------------------------------------
for (const [mode, name, cap, role] of [['blocked', 'blocked-1280', 60], ['allblocked', 'all-blocked-1280', 60], ['drafts', 'reader-1280', 52, 'ReadOnly'], ['short', 'short-week-1280', 52], ['published', 'nodrafts-1280']]) {
  const { context, page } = await open(1280, 800, { mode, role })
  await crop(page, name)
  const p = await probe(page)
  if (mode === 'published') {
    check('N16 no bar when nothing to publish; board fills', !p.hasBar)
    const c6 = await page.evaluate((sel) => ({ boxBottom: document.querySelector(sel).getBoundingClientRect().bottom, innerHeight }), SCROLLER)
    check('N16 board fills to the viewport bottom', c6.innerHeight - c6.boxBottom <= 2, c6)
  } else {
    check(`N6 ${name} <= ${cap}`, p.pillH <= cap, rnd(p.pillH))
    check(`N9 ${name} no truncation`, p.trunc === 0 && p.titleH <= 20.5, { trunc: p.trunc, titleH: p.titleH })
    if (mode === 'allblocked' || role) check(`${name}: no Publish/Select buttons`, !p.buttons.some((b) => /Publish week|Select shifts/.test(b.t)), p.buttons.map((b) => b.t))
    if (mode === 'short') check('short week: pill rests below the last row, within the viewport', p.pillTop >= p.bodyBottom + p.gap - 0.5 && p.pillBottom <= p.innerHeight, { pillTop: rnd(p.pillTop), bodyBottom: rnd(p.bodyBottom) })
  }
  await context.close()
}
// ---- 768 ----------------------------------------------------------------------------------------------------------------------
{
  const { context, page } = await open(768, 1024)
  await crop(page, 'drafts-768')
  const p = await probe(page)
  const col = await page.evaluate(() => { const m = document.querySelector('#main'); return m ? m.getBoundingClientRect().width : innerWidth })
  check('N5 768 width <= 720 and <= column', p.pillW <= 720.5 && p.pillW <= col + 0.5, { w: rnd(p.pillW), col: rnd(col) })
  check('N8 no h-scroll 768', !p.hScroll)
  await context.close()
}
// ---- 390 coarse ---------------------------------------------------------------------------------------------------------------
for (const [mode, theme, topName, endName, cap] of [['drafts', 'light', 'drafts-390-top', 'drafts-390-end', 100], ['drafts', 'dark', 'drafts-390-dark', null, 100], ['blocked', 'light', 'worst-390', null, 120]]) {
  const { context, page } = await open(390, 844, { mode, theme })
  const p = await probe(page)
  await crop(page, topName)
  check(`N4 390 ${topName}: wrapper bottom = nav top, pill bottom <= nav top - gap`, Math.abs(p.wrapBottom - p.navTop) <= 1 && p.pillBottom <= p.navTop - p.gap + 0.5, { wrapBottom: rnd(p.wrapBottom), navTop: rnd(p.navTop), pillBottom: rnd(p.pillBottom) })
  check(`N5 390 ${topName}: width = viewport - 2 x 16`, Math.abs(p.pillW - (p.innerWidth - 32)) <= 1, rnd(p.pillW))
  check(`N6 390 ${topName} <= ${cap}`, p.pillH <= cap, rnd(p.pillH))
  check(`N7 390 ${topName}: buttons >= 44 x 44`, p.buttons.every((b) => b.h >= 44 && b.w >= 44), p.buttons)
  check(`N8 390 ${topName}: no h-scroll`, !p.hScroll)
  check(`N9 390 ${topName}: no truncation`, p.trunc === 0, p.trunc)
  if (mode === 'drafts' && theme === 'light') {
    const kb = await page.evaluate(async () => {
      const pillTop = () => document.querySelector('[data-publish-bar]').firstElementChild.getBoundingClientRect().top
      const el = [...document.querySelectorAll('[data-shift-plus], [data-shift-open]')].find((e) => e.getBoundingClientRect().top >= pillTop())
      if (!el) return { found: false }
      el.focus(); await new Promise((r) => setTimeout(r, 500))
      return { found: true, chipBottom: el.getBoundingClientRect().bottom, pillTop: pillTop() }
    })
    check('N14 keyboard 390: focused chip ends above the pill', kb.found && kb.chipBottom <= kb.pillTop + 0.5, kb)
    await page.getByRole('button', { name: 'Select shifts' }).click(); await page.waitForTimeout(300)
    await toEnd(page); await crop(page, 'selecting-390')
    const s = await probe(page)
    check('N6 390 selecting <= 100', s.pillH <= 100, rnd(s.pillH))
    check('N7 390 selecting buttons >= 44', s.buttons.every((b) => b.h >= 44 && b.w >= 44), s.buttons)
    await page.getByRole('button', { name: 'Cancel' }).click(); await page.waitForTimeout(300)
    await toEnd(page); await crop(page, endName)
    const e = await probe(page)
    check('N4 390 end: pill clear of last row, above footer', e.pillTop >= e.bodyBottom + e.gap - 0.5 && e.pillBottom <= e.footerTop, { pillTop: rnd(e.pillTop), bodyBottom: rnd(e.bodyBottom), pillBottom: rnd(e.pillBottom), footerTop: rnd(e.footerTop) })
  }
  await context.close()
}
const allPass = checks.every((c) => c.pass)
writeFileSync(path.join(OUT_DIR, 'checks.json'), JSON.stringify({ allPass, checks }, null, 1))
await browser.close()
console.log(`TOTAL ${checks.filter((c) => c.pass).length}/${checks.length} pass`)
if (!allPass) process.exitCode = 1
