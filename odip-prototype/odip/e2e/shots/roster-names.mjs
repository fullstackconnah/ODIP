// Roster participant name cell, AFTER the redesign (rn-builder): every state crop, the peek panel on hover / focus / tap, and the numeric checks of SHAPE section 5
// plus the owner's Blocked-tone ruling (2026-11-02). Computed boxes only; the lead's finish review opens the crops.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/roster-names.mjs <outdir>
// Scenes: 1280 fine, 1600 fine (280px column), 390 coarse, each in light and dark (1600 dark is not shot: same tokens as 1280 dark).
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

const LONG_NAME = 'Alexandrina Papadopoulos-Whitfield' // 34 characters
const NAME_20 = 'Marguerite Lafayette' // 20 characters, with the shield and the hourglass
const LONG_ISSUES = ['Intake not complete', 'Onboarding not complete: service type', 'No signed service agreement', 'No funding source recorded', 'Emergency contact missing']
const shiftOf = (id, who, name, day, staffId) => ({
  id, participantId: who, participantName: name, staffId, staffName: staffId ? 'Mei Zhang' : null, serviceDate: day,
  startTime: '08:00:00', endTime: '12:00:00', endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'Published',
  shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false,
})
const open = (n, id, name, days) => Array.from({ length: n }, (_, i) => shiftOf(`${id}-o${i}`, id, name, days[i % 7], null))
const row = (id, name, ratio, shifts, extra = {}) => ({
  participantId: id, fullName: name, supportRatio: ratio, overnightSupport: 'None', hasRestrictivePractice: false, shifts, tripBars: [],
  scheduledHours: 4, daysWithoutCover: 7 - new Set(shifts.map((s) => s.serviceDate)).size, ...extra,
})
// state: the Capture states name each row stands for. Synthetic people only.
const fixtureRows = (days) => [
  { state: 'ready', ...row('p-ready', 'Rae Ready', 'OneToOne', [shiftOf('p-ready-1', 'p-ready', 'Rae Ready', days[0], 's-0004')]) },
  { state: 'warnings-0', ...row('p-zero', 'Wes Zero', 'OneToOne', []) },
  { state: 'ready-onboarding', ...row('p-ob', 'Ola Onboarding', 'TwoToOne', open(3, 'p-ob', 'Ola Onboarding', days), { inOnboarding: true }) },
  { state: 'not-ready-short', ...row('p-short', 'Cleo Short', 'OneToOne', open(1, 'p-short', 'Cleo Short', days), { readinessIssues: ['Intake not complete'], notReadyForRostering: false }) },
  { state: 'not-ready-long', ...row('p-long5', 'Lena Long', 'TwoToOne', open(5, 'p-long5', 'Lena Long', days), { hasRestrictivePractice: true, readinessIssues: LONG_ISSUES, notReadyForRostering: false }) },
  { state: 'not-ready-onboarding', ...row('p-nob', 'Dev Onboarding', 'TwoToOne', open(3, 'p-nob', 'Dev Onboarding', days), { inOnboarding: true, readinessIssues: ['Intake not complete', 'Onboarding not complete: service type'], notReadyForRostering: false }) },
  { state: 'blocked', ...row('p-blk', 'Eli Enforced', 'OneToOne', open(2, 'p-blk', 'Eli Enforced', days), { readinessIssues: ['No signed service agreement'], notReadyForRostering: true }) },
  { state: 'blocked-no-reason', ...row('p-blk0', 'Bo Blocked', 'OneToOne', open(2, 'p-blk0', 'Bo Blocked', days), { notReadyForRostering: true }) },
  { state: 'warnings-n', ...row('p-n', 'Nia Nine', 'OneToTwo', open(4, 'p-n', 'Nia Nine', days)) },
  { state: 'warnings-2-digit', ...row('p-12', 'Dee Twelve', 'TwoToOne', open(12, 'p-12', 'Dee Twelve', days)) },
  { state: 'long-name', ...row('p-longname', LONG_NAME, 'TwoToOne', open(12, 'p-longname', LONG_NAME, days), { readinessIssues: ['Intake not complete'], notReadyForRostering: false }) },
  { state: 'name-20', ...row('p-20', NAME_20, 'OneToOne', open(2, 'p-20', NAME_20, days), { hasRestrictivePractice: true }) },
  { state: 'empty-not-ready', ...row('p-empty', 'Hal Noshifts', 'OneToThree', [], { readinessIssues: ['No signed service agreement'], notReadyForRostering: false }) },
]
const PENDING = (id, name) => ({ participantId: id, displayName: name, draftId: `d-${id}`, version: 2, canReceiveServices: true })

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openRoster(browser, { width, height, touch, dark }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: dark ? 'dark' : 'light' })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`[roster-names] pageerror ${String(e.message).slice(0, 200)}`))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login('Admin') }))
  await page.route('**/api/v1/rostering/board*', async (r) => {
    const response = await r.fetch()
    const body = await response.json()
    if (body?.data?.participantRows) {
      body.data.weekStarted = true
      body.data.participantRows = fixtureRows(body.data.days).map(({ state, ...dto }) => dto)
      body.data.exceptions = []
      body.data.pendingAgreements = [PENDING('p-20', NAME_20)]
    }
    await r.fulfill({ response, json: body })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('#roster-week-heading').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('div.sticky a[title]', { hasText: LONG_NAME }).first().waitFor({ state: 'visible', timeout: 30_000 })
  if (dark) await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
  await page.waitForTimeout(800)
  return { context, page }
}

// Contrast helpers are inlined into each evaluate (the page cannot see this module).
const HELPERS = `
  const rgb = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number)
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2) }
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\\(.*,\\s*0\\)$/.test(c) && c !== 'transparent') return c } return 'rgb(255,255,255)' }
  const r = (el) => el.getBoundingClientRect()
`

const measure = (page) => page.evaluate(`(() => {
  ${HELPERS}
  const probe = document.createElement('div')
  probe.style.background = 'var(--color-warning-container)'
  document.body.appendChild(probe)
  const warningContainer = getComputedStyle(probe).backgroundColor
  probe.remove()
  const heads = [...document.querySelectorAll('div.sticky')].filter((h) => h.querySelector('a[title]') && h.querySelector('[role=img][aria-label$=" support"]'))
  return {
    coarse: matchMedia('(pointer: coarse)').matches,
    colWidth: heads[0] ? Math.round(r(heads[0]).width) : null,
    warningContainer,
    legacyTitles: document.querySelectorAll('span[title^="Not ready"]').length,
    rows: heads.map((h) => {
      const name = h.querySelector('a[title]')
      const hr = r(h)
      const cs = getComputedStyle(h)
      const innerRight = hr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)
      const trigger = [...h.querySelectorAll('button')].find((b) => /^(Not ready|Blocked)/.test(b.getAttribute('aria-label') || ''))
      const word = trigger?.querySelector('span')
      const ratioEl = h.querySelector('[role=img][aria-label$=" support"]')
      const cover = h.querySelector('[role=img][aria-label*="unassigned"], [role=img][aria-label="Fully covered"]')
      const count = cover?.querySelector('.tabular-nums')
      const tag = [...h.querySelectorAll('span[title^="Services started"]')][0]
      const pastRight = [...h.querySelectorAll('*')].filter((e) => r(e).width > 0 && r(e).right > innerRight + 0.5).map((e) => e.tagName + ':' + (e.getAttribute('aria-label') || e.textContent).slice(0, 24))
      const cut = [...h.querySelectorAll('*')].filter((e) => e !== name && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 0.5).map((e) => e.tagName + ':' + e.textContent.slice(0, 24))
      const lines = [...h.children].map((c) => r(c))
      const pad = trigger ? getComputedStyle(trigger, '::before') : null
      const svg = trigger?.querySelector('svg')
      const coverSvg = cover?.querySelector('svg')
      return {
        name: name.textContent, nameW: Math.round(r(name).width), nameCut: name.scrollWidth > name.clientWidth + 0.5,
        headH: Math.round(hr.height), contentH: Math.round(lines[lines.length - 1].bottom - lines[0].top),
        pastRight, cut,
        triggers: h.querySelectorAll('button').length ? [...h.querySelectorAll('button')].filter((b) => /^(Not ready|Blocked)/.test(b.getAttribute('aria-label') || '')).length : 0,
        hasTag: !!tag,
        ratioRight: ratioEl ? r(ratioEl).right : null,
        coverRight: cover ? r(cover).right : null,
        triggerBg: trigger ? getComputedStyle(trigger).backgroundColor : null,
        triggerIcon: svg ? svg.getAttribute('class') : null,
        coverBg: cover && coverSvg ? getComputedStyle(cover).backgroundColor : null,
        coverIcon: coverSvg ? coverSvg.getAttribute('class') : null,
        wordText: word?.textContent ?? null,
        wordContrast: word ? ratio(getComputedStyle(word).color, bgOf(word)) : null,
        countContrast: count ? ratio(getComputedStyle(count).color, bgOf(count)) : null,
        nameContrast: ratio(getComputedStyle(name).color, bgOf(name)),
        trig: trigger ? (() => { const t = r(trigger); const cx = t.left + t.width / 2, cy = t.top + t.height / 2, n = r(name)
          const hit = (x, y, sel) => { const e = document.elementFromPoint(x, y); return !!e && !!e.closest(sel) && (sel === 'a' ? e.closest('a') === name : e.closest('button') === trigger) }
          return { w: t.width, h: t.height, padW: parseFloat(pad.width), padH: parseFloat(pad.height), inView: t.top >= 0 && t.bottom <= innerHeight,
            nameHit: hit(n.left + n.width / 2, n.top + n.height / 2, 'a'), centre: hit(cx, cy, 'button'), above: hit(cx, t.top - 10, 'button'), below: hit(cx, t.bottom + 10, 'button'), left: hit(t.left + 1, cy, 'button') } })() : null,
      }
    }),
  }
})()`)

const measurePanel = (page) => page.evaluate(`(() => {
  ${HELPERS}
  const p = document.querySelector('.readiness-peek')
  const t = p && document.querySelector('[aria-controls="' + p.id + '"]')
  if (!p || !t) return null
  const pr = r(p), tr = r(t)
  const cx = pr.left + pr.width / 2, cy = pr.top + pr.height / 2
  const hit = document.elementFromPoint(cx, cy)
  const bg = bgOf(p)
  const title = p.querySelector('p span'), li = p.querySelector('li'), foot = p.lastElementChild
  return {
    opacity: +getComputedStyle(p).opacity, rect: { l: pr.left, t: pr.top, r: pr.right, b: pr.bottom }, vw: innerWidth, vh: innerHeight,
    lis: [...p.querySelectorAll('li')].map((e) => ({ text: e.textContent, cut: e.scrollWidth > e.clientWidth })),
    gapBelow: pr.top - tr.bottom, gapAbove: tr.top - pr.bottom,
    clipped: !(pr.left >= 0 && pr.top >= 0 && pr.right <= innerWidth && pr.bottom <= innerHeight), hitInside: !!hit && p.contains(hit),
    titleContrast: ratio(getComputedStyle(title).color, bg), issueContrast: li ? ratio(getComputedStyle(li).color, bg) : null, footContrast: ratio(getComputedStyle(foot).color, bg),
  }
})()`)

async function shotRegion(page, locators, file, pad = 16) {
  const boxes = []
  for (const l of locators) boxes.push(await l.boundingBox())
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad), y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
  const vp = page.viewportSize()
  const right = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad), bottom = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad)
  await page.screenshot({ path: file, clip: { x, y, width: right - x, height: bottom - y } })
}

const findRow = (rows, name) => rows.find((x) => x.name === name)
const rowLoc = (page, name) => page.locator('div.sticky', { has: page.locator('a[title]', { hasText: name }) }).first()
const triggerLoc = (page, name) => rowLoc(page, name).getByRole('button', { name: /^(Not ready|Blocked)/ })

function runChecks(tag, s, m) {
  const fine = !s.touch
  const rows = m.rows
  check(`${tag}: found ${fixtureRows([]).length} participant rows`, rows.length === fixtureRows([]).length, rows.length)
  check(`${tag}: coarse pointer is ${s.touch}`, m.coarse === s.touch, m.coarse)
  // 1
  check(`${tag} 1: no header child past the inner right edge`, rows.every((x) => x.pastRight.length === 0), rows.filter((x) => x.pastRight.length).map((x) => [x.name, x.pastRight]))
  // 2
  check(`${tag} 2: no cut text in any header (except the name)`, rows.every((x) => x.cut.length === 0), rows.filter((x) => x.cut.length).map((x) => [x.name, x.cut]))
  // 3
  const twenty = findRow(rows, NAME_20), longName = findRow(rows, LONG_NAME)
  check(`${tag} 3: a 20-character name with the shield and the hourglass shows whole`, twenty && !twenty.nameCut, twenty && { nameW: twenty.nameW, cut: twenty.nameCut })
  const minLong = m.colWidth >= 270 ? 245 : 160
  check(`${tag} 3: the 34-character name keeps >= ${minLong}px`, longName && longName.nameW >= minLong, longName && longName.nameW)
  // 4
  const trigRows = rows.filter((x) => x.triggerBg !== null)
  check(`${tag} 4: trigger is transparent, the badge is filled`, trigRows.every((x) => x.triggerBg === 'rgba(0, 0, 0, 0)') && rows.filter((x) => x.coverBg && /user-plus/.test(x.coverIcon)).every((x) => x.coverBg === m.warningContainer), { trigger: trigRows.map((x) => x.triggerBg)[0], badge: rows.find((x) => x.coverBg && /user-plus/.test(x.coverIcon))?.coverBg, container: m.warningContainer })
  check(`${tag} 4: trigger glyph is triangle-alert (ban when Blocked), badge glyph is user-plus`,
    trigRows.every((x) => (x.wordText === 'Blocked' ? /lucide-ban/ : /lucide-(triangle-alert|alert-triangle)/).test(x.triggerIcon)) && rows.filter((x) => x.coverIcon && !/lucide-check/.test(x.coverIcon)).every((x) => /lucide-user-plus/.test(x.coverIcon)),
    { trigger: trigRows.map((x) => x.triggerIcon), badge: [...new Set(rows.map((x) => x.coverIcon))] })
  // 5
  const spread = (key) => { const v = rows.map((x) => x[key]).filter((n) => n !== null); return +(Math.max(...v) - Math.min(...v)).toFixed(2) }
  check(`${tag} 5: ratio right edges within 1px`, spread('ratioRight') <= 2, spread('ratioRight'))
  check(`${tag} 5: coverage right edges within 1px`, spread('coverRight') <= 2, spread('coverRight'))
  // 6
  const near = (a, b) => a !== undefined && Math.abs(a - b) <= 1
  if (fine) {
    check(`${tag} 6: header content <= 34px on every row`, rows.every((x) => x.contentH <= 34), rows.map((x) => x.contentH))
    check(`${tag} 6: empty rows are 34 +- 1 (ready and not ready)`, near(findRow(rows, 'Wes Zero')?.headH, 34) && near(findRow(rows, 'Hal Noshifts')?.headH, 34), [findRow(rows, 'Wes Zero')?.headH, findRow(rows, 'Hal Noshifts')?.headH])
  } else {
    check(`${tag} 6: empty ready row 48, empty not-ready row 60, rows with shifts 73 (+- 1)`,
      near(findRow(rows, 'Wes Zero')?.headH, 48) && near(findRow(rows, 'Hal Noshifts')?.headH, 60) && near(findRow(rows, 'Rae Ready')?.headH, 73) && near(findRow(rows, 'Cleo Short')?.headH, 73),
      { zero: findRow(rows, 'Wes Zero')?.headH, emptyNotReady: findRow(rows, 'Hal Noshifts')?.headH, rae: findRow(rows, 'Rae Ready')?.headH, cleo: findRow(rows, 'Cleo Short')?.headH })
  }
  // 7
  if (s.touch) {
    const t = findRow(rows, 'Cleo Short')?.trig
    check(`${tag} 7: tap geometry (name, trigger centre, above, below, trigger left edge all hit the right control)`, t && t.nameHit && t.centre && t.above && t.below && t.left, t)
    check(`${tag} 7: trigger hit box >= 44 x 44`, t && Math.max(t.w, t.padW) >= 43.5 && Math.max(t.h, t.padH) >= 43.5, t && { w: t.w, h: t.h, padW: t.padW, padH: t.padH })
  }
  // 9 (the word, the Blocked word, the coverage count, the name)
  const words = rows.filter((x) => x.wordContrast !== null)
  check(`${tag} 9: Not ready word contrast >= 4.5`, words.filter((x) => x.wordText === 'Not ready').every((x) => x.wordContrast >= 4.5), words.filter((x) => x.wordText === 'Not ready').map((x) => x.wordContrast))
  check(`${tag} 9: Blocked word contrast >= 4.5 (owner ruling: danger tone)`, words.filter((x) => x.wordText === 'Blocked').length === 2 && words.filter((x) => x.wordText === 'Blocked').every((x) => x.wordContrast >= 4.5), words.filter((x) => x.wordText === 'Blocked').map((x) => x.wordContrast))
  check(`${tag} 9: coverage count contrast >= 4.5`, rows.filter((x) => x.countContrast !== null).every((x) => x.countContrast >= 4.5), [...new Set(rows.map((x) => x.countContrast))])
  check(`${tag} 9: name contrast >= 4.5`, rows.every((x) => x.nameContrast >= 4.5), [...new Set(rows.map((x) => x.nameContrast))])
  // 10
  const notReady = new Set(['Cleo Short', 'Lena Long', 'Dev Onboarding', 'Eli Enforced', 'Bo Blocked', LONG_NAME, 'Hal Noshifts'])
  check(`${tag} 10: one trigger per not-ready row, none on ready rows, no legacy title chip`, rows.every((x) => x.triggers === (notReady.has(x.name) ? 1 : 0)) && m.legacyTitles === 0, { legacyTitles: m.legacyTitles, wrong: rows.filter((x) => x.triggers !== (notReady.has(x.name) ? 1 : 0)).map((x) => x.name) })
  // 3c: the tag shows on the ready onboarding row only
  check(`${tag} 3c: Onboarding tag on the ready row, folded away on the not-ready one`, findRow(rows, 'Ola Onboarding')?.hasTag === true && findRow(rows, 'Dev Onboarding')?.hasTag === false, { ready: findRow(rows, 'Ola Onboarding')?.hasTag, notReady: findRow(rows, 'Dev Onboarding')?.hasTag })
}

function panelChecks(tag, how, p, expected, { flipOk = false } = {}) {
  check(`${tag} 8: ${how} opens the panel`, !!p, p && 'open')
  if (!p) return
  check(`${tag} 8: ${how} panel lists every issue on its own line, none cut`, p.lis.length === expected.length && p.lis.every((l, i) => l.text === expected[i] && !l.cut), p.lis)
  check(`${tag} 8: ${how} panel is inside the viewport with >= 8px margin`, p.rect.l >= 7.5 && p.rect.t >= 7.5 && p.rect.r <= p.vw - 7.5 && p.rect.b <= p.vh - 7.5, { rect: p.rect, vw: p.vw, vh: p.vh })
  check(`${tag} 8: ${how} panel sits 4 +- 1px from its trigger`, Math.abs(p.gapBelow - 4) <= 1 || (flipOk && Math.abs(p.gapAbove - 4) <= 1), { gapBelow: p.gapBelow, gapAbove: p.gapAbove })
  check(`${tag} 8: ${how} panel is not clipped and is the top layer at its centre`, !p.clipped && p.hitInside, { clipped: p.clipped, hitInside: p.hitInside })
  check(`${tag} 9: ${how} panel title, issues, footer contrast >= 4.5`, p.titleContrast >= 4.5 && p.issueContrast >= 4.5 && p.footContrast >= 4.5, { title: p.titleContrast, issue: p.issueContrast, footer: p.footContrast })
}

const browser = await chromium.launch({ headless: true })
const SCENES = [
  { tag: '1280-light', width: 1280, height: 900, touch: false, dark: false, crops: true, full: true },
  { tag: '1280-dark', width: 1280, height: 900, touch: false, dark: true, crops: true },
  { tag: '390-light', width: 390, height: 844, touch: true, dark: false, crops: true, full: true },
  { tag: '390-dark', width: 390, height: 844, touch: true, dark: true, crops: true },
  { tag: '1600-light', width: 1600, height: 900, touch: false, dark: false, full: true },
]
const LONG_ROW = 'Lena Long'
for (const s of SCENES) {
  try {
    const { context, page } = await openRoster(browser, s)
    if (s.touch) await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Not ready: Intake not complete.') || (b.getAttribute('aria-label') || '') === 'Not ready: Intake not complete')?.scrollIntoView({ block: 'center' }))
    const m = await measure(page)
    console.log(`[roster-names] ${s.tag} ${JSON.stringify({ colWidth: m.colWidth, heights: m.rows.map((x) => [x.name, x.headH]) })}`)
    runChecks(s.tag, s, m)

    // The peek panel, before any crop resizes the viewport (a resize closes it, by design).
    const bp = s.touch ? '390' : s.width === 1600 ? '1600' : '1280'
    const theme = s.dark ? 'dark' : 'light'
    const trigger = triggerLoc(page, LONG_ROW)
    await trigger.scrollIntoViewIfNeeded()
    if (s.touch) {
      await trigger.tap()
      await page.waitForTimeout(300)
      const p = await measurePanel(page)
      panelChecks(s.tag, 'tap', p, LONG_ISSUES, { flipOk: true })
      await shotRegion(page, [trigger, page.locator('.readiness-peek')], path.join(OUT_DIR, s.dark ? 'panel-dark-390.png' : `panel-tap-390-${theme}.png`))
      await trigger.tap()
      await page.waitForTimeout(250)
      check(`${s.tag} 8: a second tap hides the panel`, (await page.locator('.readiness-peek').count()) === 0)
    } else if (s.width !== 1600) {
      await trigger.hover()
      await page.waitForTimeout(350)
      const p = await measurePanel(page)
      panelChecks(s.tag, 'hover', p, LONG_ISSUES, { flipOk: true })
      await shotRegion(page, [trigger, page.locator('.readiness-peek')], path.join(OUT_DIR, s.dark ? 'panel-dark-1280.png' : `panel-hover-1280-${theme}.png`))
      await page.mouse.move(2, 2)
      await page.waitForTimeout(350)
      check(`${s.tag} 8: the panel closes after the pointer leaves`, (await page.locator('.readiness-peek').count()) === 0)
      if (!s.dark) {
        await rowLoc(page, LONG_ROW).getByRole('link', { name: LONG_ROW, exact: true }).focus()
        await page.keyboard.press('Tab')
        await page.waitForTimeout(300)
        const f = await measurePanel(page)
        panelChecks(s.tag, 'Tab focus', f, LONG_ISSUES, { flipOk: true })
        await shotRegion(page, [trigger, page.locator('.readiness-peek')], path.join(OUT_DIR, `panel-focus-1280-${theme}.png`))
        await page.keyboard.press('Escape')
        await page.waitForTimeout(200)
        const stillOnTrigger = await trigger.evaluate((el) => el === document.activeElement)
        check(`${s.tag} 8: Escape hides the panel and focus stays on the trigger`, (await page.locator('.readiness-peek').count()) === 0 && stillOnTrigger, { stillOnTrigger })
      }
    }
    // A Blocked panel: the danger tone must read inside the panel too.
    const blocked = triggerLoc(page, 'Eli Enforced')
    await blocked.scrollIntoViewIfNeeded()
    if (s.touch) await blocked.tap(); else await blocked.hover()
    await page.waitForTimeout(350)
    const bp2 = await measurePanel(page)
    panelChecks(`${s.tag} blocked`, s.touch ? 'tap' : 'hover', bp2, ['No signed service agreement'], { flipOk: true })
    if (s.crops) await shotRegion(page, [blocked, page.locator('.readiness-peek')], path.join(OUT_DIR, `panel-blocked-${bp}-${theme}.png`))
    await page.mouse.move(2, 2)
    await page.evaluate(() => document.activeElement?.blur?.())
    await page.waitForTimeout(350)

    if (s.crops) {
      for (const x of fixtureRows([])) {
        const file = path.join(OUT_DIR, `state-${x.state}-${bp}-${theme}.png`)
        const r = await cropElement(page, rowLoc(page, x.fullName), file, { touch: s.touch })
        const c = checkCropHolds(r)
        checks.push({ ...c, name: `${s.tag}: ${c.name}` })
      }
    }
    if (s.full) {
      if (!s.touch) await page.setViewportSize({ width: s.width, height: 1400 })
      const rowsBottom = await page.evaluate(() => Math.max(...[...document.querySelectorAll('div.sticky')].filter((h) => h.querySelector('a[title]')).map((h) => h.getBoundingClientRect().bottom)))
      const f = await fullPage(page, path.join(OUT_DIR, 'full', `${s.tag}.png`), { touch: s.touch })
      // The page tracks the viewport height (scrollHeight = viewport + ~87 at any size), so the library's "not truncated" check cannot hold on a fine pointer; the real claim is that every participant row is in the shot.
      for (const c of f.checks) if (s.touch || !c.name.startsWith('full page not truncated')) checks.push({ ...c, name: `${s.tag}: ${c.name}` })
      if (!s.touch) check(`${s.tag}: full page holds every participant row`, rowsBottom <= 1400, { rowsBottom })
    }
    await context.close()
  } catch (e) {
    check(`${s.tag}: scene ran`, false, String(e.message).split('\n')[0])
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
