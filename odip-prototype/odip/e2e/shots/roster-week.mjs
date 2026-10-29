// Captures and numeric checks for each person's roster week as a time grid (spec 2026-10-29, SHAPE §11, PLAN-AMEND 5 and 8). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/roster-week.mjs <outdir>
// The board is served from page.route fixtures keyed on staffId / participantId. Exits non-zero when a check fails; every
// measured value is printed as "CHECK ok|FAIL name = value", and measure.txt in OUT_DIR holds the same lines.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '1280-dark', width: 1280, height: 800, dark: true },
  { name: '1024', width: 1024, height: 768 },
  { name: '768', width: 768, height: 1024, mobile: true },
  { name: '390', width: 390, height: 844, mobile: true },
]
// S1 rich, S2 empty week, S4 never answers; P1 the participant week.
const STATES = [
  { name: 'staff-week', url: '/staff/s-0001?tab=week', ready: '[data-shift-open]' },
  { name: 'participant-week', url: '/participants/p-0001?tab=people&section=week', ready: '[data-shift-open]' },
  { name: 'empty-week', url: '/staff/s-0002?tab=week', text: 'Nothing rostered this week. Choose a time on the grid to add a shift.' },
  { name: 'loading', url: '/staff/s-0004?tab=week', busy: true },
]

const lines = []
let failed = false
const check = (name, value, ok) => { if (!ok) failed = true; const l = `CHECK ${ok ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(value)}`; lines.push(l); console.log(l) }

const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const sydneyToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
const dow = (new Date(`${sydneyToday}T00:00:00Z`).getUTCDay() + 6) % 7
const THIS_MON = addDays(sydneyToday, -dow)
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`

const shift = (o) => ({ id: 'sh', participantId: 'p-0001', participantName: 'Liam Okafor', staffId: 's-0001', staffName: 'Callum Radford', serviceDate: '', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false, durationHours: 8, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...o })
// A shift by minutes; the id names what it seeds. `from` / `to` are minutes of the day; to <= from means it ends the next day.
const at = (id, date, from, to, o = {}) => shift({ id, serviceDate: date, startTime: hhmm(from), endTime: hhmm(to), endsNextDay: to <= from, durationHours: ((to - from + 1440) % 1440) / 60, ...o })
const trip = (start) => ({ tripInstanceId: 't1', tripCode: 'BMT-26', tripName: 'Blue Mountains weekend', startDate: start, endDate: addDays(start, 2), isDriver: true })
const leave = (o) => ({ availabilityType: 'Annual', notes: null, startTime: null, endTime: null, ...o })
const staffRow = (staffId, fullName, o = {}) => ({ staffId, fullName, role: 'SupportWorker', compliance: 'Ok', complianceNotes: [], rosteredHours: 0, targetHours: 38, shifts: [], tripBars: [], leave: [], ...o })
const finding = (severity, code) => ({ code, severity, message: `${code} message`, requiresReason: severity === 'Warning' })

// Start minute of each seeded block (check 1); a 'second' segment starts at 0. 'late' is the near-midnight case, pinned to the column bottom.
const EXP = { min15: 720, late: 1425, sun22: 1320, prevSun22: 1320, pairA: 540, pairB: 540, tri1: 600, tri2: 600, tri3: 630, draft: 360, cancel: 840, needs: 600, finds: 540, sleep: 1200, pA: 540, pB: 540 }

/** S1's week: the first shift starts at 06:00. */
function s1Shifts(d) {
  return [
    at('draft', d[0], 360, 600, { status: 'Draft' }),
    at('min15', d[0], 720, 735),
    at('late', d[1], 1425, 0),
    at('pairA', d[2], 540, 780, { participantName: 'Aaliyah Thompson-Whitcombe' }),
    at('pairB', d[2], 540, 780, { participantId: 'p-0002', participantName: 'Noah Bianchi', ratio: 'TwoToOne' }),
    at('tri1', d[3], 600, 840, { participantName: 'Mei Lin' }),
    at('tri2', d[3], 600, 840, { participantId: 'p-0003', participantName: 'Tom Hartley' }),
    at('tri3', d[3], 630, 870, { participantId: 'p-0004', participantName: 'Zara Ahmed' }),
    at('cancel', d[4], 840, 1080, { status: 'Cancelled' }),
    at('finds', d[5], 540, 720, { findings: [finding('Warning', 'STAFF_ON_LEAVE'), finding('Blocking', 'OVERLAP_BLOCKING')] }),
    at('sleep', d[5], 1200, 420, { nightType: 'Sleepover', durationHours: 11 }),
    at('sun22', d[6], 1320, 360),
  ]
}

/** The board the API would send for one person's week, or null to leave the request hanging, or a status to fail it. */
function board(url) {
  const q = new URL(url).searchParams
  const mon = q.get('weekStart'); const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i))
  const staffBoard = (rows) => envelope({ groupBy: 'Staff', weekStart: mon, days, staffRows: rows, unfilled: [], exceptions: [] })
  const sid = q.get('staffId'); const pid = q.get('participantId')
  if (pid) {
    const s = mon === THIS_MON ? [
      at('pA', days[2], 540, 780, { staffName: 'Callum Radford', ratio: 'TwoToOne' }),
      at('pB', days[2], 540, 780, { staffId: 's-0002', staffName: 'Priya Nadarajah', ratio: 'TwoToOne', assigneeOnApprovedLeave: true }),
      at('needs', days[3], 600, 840, { staffId: undefined, staffName: undefined }),
      at('draft', days[0], 360, 600, { status: 'Draft' }),
    ].map((x) => { if (!x.staffId) { delete x.staffId; delete x.staffName } return x }) : []
    return envelope({ groupBy: 'Participant', weekStart: mon, days, exceptions: [], participantRows: [{ participantId: pid, fullName: 'Liam Okafor', supportRatio: 'TwoToOne', overnightSupport: 'None', hasRestrictivePractice: false, shifts: s, tripBars: [], scheduledHours: 24, daysWithoutCover: 4 }] })
  }
  if (sid === 's-0001') {
    if (mon === THIS_MON) {
      return staffBoard([staffRow(sid, 'Callum Radford', {
        rosteredHours: 41, tripBars: [trip(days[2])],
        leave: [leave({ startDate: days[6], endDate: days[6], kind: 'ApprovedLeave' })],
        shifts: s1Shifts(days),
      })])
    }
    // The Monday tail: last week's Sunday 22:00-06:00 carries onto this Monday.
    if (mon === addDays(THIS_MON, -7)) return staffBoard([staffRow(sid, 'Callum Radford', { shifts: [at('prevSun22', days[6], 1320, 360)] })])
    return staffBoard([staffRow(sid, 'Callum Radford')])
  }
  if (sid === 's-0002') return staffBoard([staffRow(sid, 'Priya Nadarajah')])
  if (sid === 's-0004') return null
  return 500
}

/** Waits (at most 5 s) until no animation or transition is running, so a capture is not taken mid-fade. */
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})

// Runs in the page against the week's own section: raw geometry of the grid, asserted in node.
const gridMeasure = (sec, EXP) => {
  const vis = (el) => el.checkVisibility()
  const parse = (s) => {
    if (s.startsWith('color(srgb')) return s.match(/[\d.]+/g).slice(0, 3).map((v) => Math.round(+v * 255))
    const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = s; const h = c.fillStyle
    return h.startsWith('#') ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : h.match(/[\d.]+/g).slice(0, 3).map(Number)
  }
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return parse(b) } return [255, 255, 255] }
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2) }
  const rect = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, w: r.width })
  const sc = sec.querySelector('[role="region"][aria-label^="Shifts"]')
  const coarse = matchMedia('(pointer: coarse)').matches
  const head = sc.firstElementChild.classList.contains('sticky') ? sc.firstElementChild : null
  const cols = [...sc.querySelectorAll('[data-day]')].map((c) => ({ date: c.dataset.day, ...rect(c.getBoundingClientRect()) }))
  const colRect = (el) => rect(el.closest('[data-day]').getBoundingClientRect())
  const blocks = [...sc.querySelectorAll('[data-shift-open]')].map((el) => {
    const texts = [...el.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.trim() && vis(n))
    const contrast = texts.map((n) => ratio(parse(getComputedStyle(n).color), bgOf(n)))
    const clipped = texts.filter((n) => !n.classList.contains('truncate') && n.offsetTop < 16 && n.scrollWidth > n.clientWidth + 1).map((n) => `${n.textContent.trim().slice(0, 20)} ${n.scrollWidth}>${n.clientWidth}`)
    const icons = [...el.querySelectorAll('svg')].filter(vis).map((n) => ratio(parse(getComputedStyle(n).color), bgOf(n)))
    const cs = getComputedStyle(el)
    const outline = cs.borderTopStyle === 'dashed' || cs.borderLeftStyle === 'dashed' ? ratio(parse(cs.borderLeftColor), bgOf(el.parentElement)) : null
    return { id: el.dataset.shiftOpen, part: el.dataset.segment, date: el.closest('[data-day]').dataset.day, ...rect(el.getBoundingClientRect()), col: colRect(el), minContrast: contrast.length ? Math.min(...contrast) : null, clipped, minIcon: icons.length ? Math.min(...icons) : null, outline }
  })
  const tiles = [...sc.querySelectorAll('[data-day] button[aria-label*="more shifts"]')].map((el) => ({ date: el.closest('[data-day]').dataset.day, text: el.textContent.trim(), ...rect(el.getBoundingClientRect()) }))
  const bodyEl = sc.lastElementChild
  const labels = [...bodyEl.firstElementChild.querySelectorAll('span')].map((s) => { const r = s.getBoundingClientRect(); return { text: s.textContent.trim(), cy: r.top + r.height / 2 } })
  const dayHeads = head ? [...head.firstElementChild.children].slice(1).map((c) => rect(c.getBoundingClientRect())) : []
  const bars = head?.querySelector('ul[aria-label="Leave and trips"]')
  const barsRect = bars ? rect(bars.getBoundingClientRect()) : null
  const tabs = [...sec.querySelectorAll('[role="tab"]')].map((t) => rect(t.getBoundingClientRect()))
  return {
    coarse, floor: coarse ? 44 : 24, vw: document.documentElement.clientWidth,
    secW: Math.round(sec.getBoundingClientRect().width), scroll: { top: sc.scrollTop, clientW: sc.clientWidth, ...rect(sc.getBoundingClientRect()) },
    head: head ? rect(head.getBoundingClientRect()) : null, cols, blocks, tiles, labels, dayHeads, barsRect, tabs,
    pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }
}

const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5

/** Numeric checks 1-4, 8-13 on one measured grid. `name` prefixes each check. */
function gridChecks(name, m, { full }) {
  const bad = []
  for (const b of m.blocks) {
    const startMin = b.part === 'second' ? 0 : EXP[b.id]
    if (startMin === undefined) { bad.push(`${b.id} not in EXP`); continue }
    const want = b.col.top + startMin * 0.8
    if (want + b.h > b.col.top + 1152 + 0.5) { if (Math.abs(b.bottom - b.col.bottom) > 1) bad.push(`${b.id} bottom ${b.bottom - b.col.bottom}`) } else if (Math.abs(b.top - want) > 1) bad.push(`${b.id} top off by ${(b.top - want).toFixed(1)}`)
  }
  check(`${name} 1 block top = start x 0.8 (bottom-pinned near midnight)`, bad, bad.length === 0)
  const short = [...m.blocks, ...m.tiles].filter((b) => b.h < m.floor - 0.5).map((b) => `${b.id ?? b.text} ${b.h.toFixed(1)}`)
  check(`${name} 2 every block and tile >= ${m.floor}px tall`, short, short.length === 0)
  const hits = []
  for (const c of m.cols) {
    const items = [...m.blocks.filter((b) => b.date === c.date), ...m.tiles.filter((b) => b.date === c.date)]
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (overlap(items[i], items[j])) hits.push(`${c.date} ${items[i].id ?? items[i].text}/${items[j].id ?? items[j].text}`)
  }
  check(`${name} 3 no two blocks or tiles overlap in a column`, hits, hits.length === 0)
  const narrow = [...m.blocks, ...m.tiles].filter((b) => b.w < 39.5).map((b) => `${b.id ?? b.text} ${b.w.toFixed(1)}`)
  check(`${name} 4 every drawn lane >= 40px wide`, narrow, narrow.length === 0)
  const colW = m.cols.length ? m.cols[0].w : 0
  check(`${name} 9 columns: ${full ? 'seven' : 'one'}, each >= 88`, { n: m.cols.length, colW: Math.round(colW), secW: m.secW }, m.cols.length === (full ? 7 : 1) && (!full || m.cols.every((c) => c.w >= 88)))
  if (m.labels.length) {
    const off = m.labels.filter((l) => { const n = parseInt(l.text, 10); const h = (n % 12) + (/pm/.test(l.text) ? 12 : 0); return Math.abs(l.cy - (m.cols[0].top + h * 48)) > 1 }).map((l) => l.text)
    check(`${name} 8 hour labels sit on their hour line, no 12am`, off, off.length === 0 && !m.labels.some((l) => l.text === '12am'))
  }
  const clipped = m.blocks.flatMap((b) => b.clipped)
  check(`${name} 12 no block text clipped mid-glyph`, clipped, clipped.length === 0)
  const lowText = m.blocks.filter((b) => b.minContrast !== null && b.minContrast < 4.5).map((b) => `${b.id} ${b.minContrast}`)
  check(`${name} 13 block text >= 4.5:1`, lowText, lowText.length === 0)
  const lowGraphic = m.blocks.filter((b) => (b.minIcon !== null && b.minIcon < 3) || (b.outline !== null && b.outline < 3)).map((b) => `${b.id} icon ${b.minIcon} outline ${b.outline}`)
  check(`${name} 13 icons and dashed outlines >= 3:1`, lowGraphic, lowGraphic.length === 0)
  check(`${name} 10 no horizontal page scroll`, m.pageFits, m.pageFits)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    const tag = vp.name
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: vp.dark ? 'dark' : 'light' })
    const page = await context.newPage()
    // The touch emulation alone left `pointer: coarse` false on the first page of a run; pin it so the 44px density tokens apply.
    const cdp = vp.mobile ? await context.newCDPSession(page) : null
    const pinCoarse = async () => { await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }); await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }] }) }
    await pinCoarse()
    page.on('pageerror', (e) => check(`${tag} page error`, e.message, false))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route('**/api/v1/rostering/board*', (r) => {
      const b = board(r.request().url())
      if (b === null) return // S4: never answers, so the skeleton stays
      return typeof b === 'number' ? r.fulfill({ status: b, json: { success: false, data: null, message: 'boom', errors: [] } }) : r.fulfill({ json: b })
    })
    // The panel's save path; the participant and staff lists fall through to mock-api as before.
    await page.route('**/api/v1/rostering/shifts/check', (r) => r.fulfill({ json: envelope([]) }))
    await page.route(/\/api\/v1\/rostering\/shifts\/[^/]+$/, (r) => {
      if (r.request().method() !== 'PUT') return r.fallback()
      const id = new URL(r.request().url()).pathname.split('/').pop()
      return r.fulfill({ json: envelope(shift({ id, serviceDate: THIS_MON, ...JSON.parse(r.request().postData() ?? '{}') })) })
    })
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

    const secOf = () => page.locator('section').filter({ has: page.getByRole('link', { name: 'Open in roster' }) }).last()
    const open = async (st) => {
      await page.goto(`${BASE_URL}${st.url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const sec = secOf()
      await sec.waitFor({ timeout: 60_000 })
      if (st.ready) await sec.locator(st.ready).first().waitFor({ timeout: 30_000 })
      if (st.text) await sec.getByText(st.text, { exact: true }).first().waitFor({ timeout: 60_000 })
      if (st.busy) await sec.and(page.locator('[aria-busy="true"]')).waitFor({ timeout: 10_000 })
      await settled(page)
      return sec
    }
    const shoot = async (sec, file) => {
      const bb = await sec.boundingBox()
      const clip = { x: Math.max(0, bb.x - 24), y: Math.max(0, bb.y - 24), width: Math.min(vp.width - Math.max(0, bb.x - 24), bb.width + 48), height: bb.height + 48 }
      await page.screenshot({ path: path.join(OUT_DIR, `${file}-${tag}.png`), clip })
    }
    // The week view needs the section at 672px or more (spec §2); the owner's rule is the full week from 768.
    const full = vp.width >= 768

    for (const st of STATES) {
      if (vp.dark && st.name !== 'staff-week') continue
      const sec = await open(st)
      const name = `${st.name}-${tag}`

      if (st.name === 'staff-week' || st.name === 'participant-week') {
        // The opening scroll, measured before anything moves the scroller.
        const m = await sec.evaluate(gridMeasure, EXP)
        if (st.name === 'staff-week') {
          const first = m.blocks.filter((b) => b.part !== 'second').sort((a, b) => a.top - b.top)[0]
          const gap = first ? first.top - (m.head ? m.head.bottom : m.scroll.top) : 0
          if (first) check(`${name} 5 first shift (not the tail) visible, >= 40px below the header`, { gap: Math.round(gap), scrollTop: m.scroll.top }, gap >= 40 && first.bottom <= m.scroll.bottom)
          const tail = m.blocks.find((b) => b.id === 'prevSun22')
          if (full) check(`${name} Monday tail drawn from the previous week (top = column top)`, tail ? Math.round(tail.top - tail.col.top) : null, !!tail && Math.abs(tail.top - tail.col.top) <= 1)
        }
        gridChecks(name, m, { full })
        if (full && st.name === 'staff-week') {
          const three = m.blocks.filter((b) => b.date === addDays(THIS_MON, 3)); const more = m.tiles.filter((t) => t.date === addDays(THIS_MON, 3))
          if (m.cols[0].w <= 96) check(`${name} 4 three-way overlap at <=96px shows one block and a "+2" tile`, { blocks: three.length, tiles: more.map((t) => t.text) }, three.length === 1 && more.length === 1 && more[0].text === '+2')
          const pair = m.blocks.filter((b) => b.date === addDays(THIS_MON, 2)); const lefts = new Set(pair.map((b) => Math.round(b.left)))
          check(`${name} 4 the 2:1 pair draws both lanes`, { n: pair.length, lefts: [...lefts] }, pair.length === 2 && lefts.size === 2)
        }
        if (st.name === 'participant-week' && full) {
          const pair = m.blocks.filter((b) => b.id === 'pA' || b.id === 'pB')
          check(`${name} 4 participant week: the 2:1 pair draws both lanes`, pair.map((b) => Math.round(b.left)), pair.length === 2 && Math.abs(pair[0].left - pair[1].left) > 20)
        }
        if (!full) {
          const tabs = m.tabs
          check(`${name} 10 seven day tabs, all inside the viewport, each >= 44x52`, tabs.map((t) => [Math.round(t.w), Math.round(t.h)]), tabs.length === 7 && tabs.every((t) => t.left >= -0.5 && t.right <= m.vw + 0.5 && t.w >= 43.5 && t.h >= 51.5))
        }
        // Captured at the opening scroll, before the checks below move the scroller.
        await shoot(sec, st.name)
        if (st.name === 'staff-week') await page.screenshot({ path: path.join(OUT_DIR, `full-${tag}.png`), ...(vp.mobile ? {} : { fullPage: true }) })
        if (st.name === 'staff-week' && full) {
          // 7: sticky header after a 300px scroll, columns lined up with the header and the bars row.
          await sec.locator('[role="region"][aria-label^="Shifts"]').evaluate((el) => { el.scrollTop = 300 })
          await page.waitForTimeout(150)
          const s = await sec.evaluate(gridMeasure, EXP)
          const drift = s.cols.map((c, i) => Math.max(Math.abs(c.left - s.dayHeads[i].left), Math.abs(c.right - s.dayHeads[i].right)))
          check(`${name} 7 sticky header at the scroller top after scrolling 300px`, { head: s.head?.top, scroller: s.scroll.top }, !!s.head && Math.abs(s.head.top - s.scroll.top) <= 1)
          check(`${name} 7 header cells line up with their columns (and the bars row spans them)`, { drift, bars: s.barsRect && [Math.round(s.barsRect.left - s.cols[0].left), Math.round(s.barsRect.right - s.cols[6].right)] }, drift.every((d) => d <= 1) && !!s.barsRect && s.barsRect.right <= s.cols[6].right + 1 && s.barsRect.left >= s.dayHeads[0].left - 1)
          await sec.locator('[role="region"][aria-label^="Shifts"]').evaluate((el) => { el.scrollTop = 0 })
        }

        if (st.name === 'staff-week' && !vp.mobile && !vp.dark) {
          // 14: keyboard. Tab from the scroller past the bars row's links to the first block; it is Monday's, clear of the sticky header.
          const region = sec.locator('[role="region"][aria-label^="Shifts"]')
          await region.focus()
          let landed = null
          for (let i = 0; i < 12 && !landed; i++) {
            await page.keyboard.press('Tab')
            landed = await page.evaluate(() => { const a = document.activeElement; return a?.matches?.('[data-shift-open]') ? { id: a.dataset.shiftOpen, date: a.closest('[data-day]').dataset.day } : null })
          }
          check(`${name} 14 first focusable block in the grid body is Monday's`, landed, !!landed && landed.date === THIS_MON)
          const k = await sec.evaluate(gridMeasure, EXP)
          const cur = k.blocks.find((b) => b.id === landed?.id && b.date === landed?.date)
          check(`${name} 14 the focused block sits at or below the header bottom`, { top: cur && Math.round(cur.top), head: k.head && Math.round(k.head.bottom) }, !!cur && !!k.head && cur.top >= k.head.bottom - 0.5)
          await page.keyboard.press('Enter')
          const dlg = page.getByRole('dialog', { name: 'Shift details' })
          await dlg.waitFor({ timeout: 10_000 }).catch(() => {})
          check(`${name} 14 Enter opens the panel in place (URL still the Week tab)`, page.url(), (await dlg.isVisible()) && /tab=week/.test(page.url()))
          await page.keyboard.press('Escape'); await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
          const back = await page.evaluate(() => document.activeElement?.dataset?.shiftOpen ?? null)
          check(`${name} 14 Escape returns focus to the block`, back, back === landed?.id)
          // Slot create and cancel returns focus to the scroller.
          const slot = sec.locator(`[data-day="${addDays(THIS_MON, 1)}"] [data-minute="1080"]`).first()
          await slot.scrollIntoViewIfNeeded(); await slot.click({ position: { x: 10, y: 4 } })
          const creator = page.getByRole('dialog', { name: 'New shift' })
          await creator.waitFor({ timeout: 10_000 }).catch(() => {})
          const startOk = (await creator.getByLabel(/^Start time/).inputValue().catch(() => '')) === '18:00'
          check(`${name} 11 a slot click opens New shift with the hour's start (18:00)`, startOk, startOk)
          await settled(page); await page.screenshot({ path: path.join(OUT_DIR, `panel-create-${tag}.png`) })
          await page.keyboard.press('Escape'); await creator.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
          const scrollerFocused = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'region')
          check(`${name} 14 after a slot create and cancel the scroller has focus`, scrollerFocused, scrollerFocused)
          // 6: a save refetches the board; the scroll position must not move.
          await region.evaluate((el) => { el.scrollTop = 200 })
          const before = await region.evaluate((el) => el.scrollTop)
          await sec.locator('[data-shift-open="draft"]').first().scrollIntoViewIfNeeded()
          const mid = await region.evaluate((el) => el.scrollTop)
          await sec.locator('[data-shift-open="draft"]').first().click({ position: { x: 6, y: 6 } })
          await dlg.waitFor({ timeout: 10_000 }).catch(() => {})
          await settled(page); await page.screenshot({ path: path.join(OUT_DIR, `panel-edit-${tag}.png`) })
          await dlg.getByRole('button', { name: /^Save/ }).first().click().catch(() => {})
          await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {})
          await page.waitForTimeout(600)
          const after = await region.evaluate((el) => el.scrollTop)
          const closed = !(await dlg.isVisible())
          check(`${name} 6 no scroll jump after a save (the panel saved and closed)`, { before, mid, after, closed }, closed && Math.abs(after - mid) <= 1)
        }
      }

      if (st.name === 'empty-week') {
        const top = await sec.locator('[role="region"][aria-label^="Shifts"]').evaluate((el) => el.scrollTop)
        check(`${name} 5 empty week opens scrolled to 6am (288)`, top, Math.abs(top - 288) <= 1)
        const pf = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
        check(`${name} 10 no horizontal page scroll`, pf, pf)
        await shoot(sec, st.name)
      }
      if (st.name === 'loading') await shoot(sec, st.name)
    }

    // The "+2" dropdown, where the columns are narrow enough to need it.
    if (vp.width >= 768 && vp.width <= 1024) {
      const sec = await open(STATES[0])
      const tile = sec.locator('button[aria-label*="more shifts"]').first()
      await tile.scrollIntoViewIfNeeded(); await tile.click()
      await settled(page)
      const menu = await page.getByRole('option').first().isVisible().catch(() => false)
      check(`${tag} more-open: the "+n" tile opens its list`, menu, menu)
      await page.screenshot({ path: path.join(OUT_DIR, `more-open-${tag}.png`) })
      await page.keyboard.press('Escape')
    }

    if (vp.mobile) {
      // 11: touch. A tap on an empty hour opens New shift at that hour; a vertical swipe starting on an empty slot scrolls and opens nothing.
      const sec = await open(STATES[0])
      const region = sec.locator('[role="region"][aria-label^="Shifts"]')
      const col = sec.locator(`[data-day]`).first()
      const slot = col.locator('[data-minute="1080"]').first()
      await slot.scrollIntoViewIfNeeded()
      const pos = () => region.evaluate((el) => [el.scrollTop, el.scrollHeight - el.clientHeight, Math.round(scrollY)])
      await region.evaluate((el) => { el.scrollTop = 200 }); await page.waitForTimeout(100)
      const [before, maxTop, pageY0] = await pos()
      const slot2 = col.locator('[data-minute="600"]').first(); const bs = await slot2.boundingBox()
      const y = bs.y + 4; const x = bs.x + bs.width / 2
      const tp = (yy) => [{ x, y: yy, radiusX: 4, radiusY: 4, force: 1, id: 1 }]
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(y) })
      for (let i = 1; i <= 10; i++) { await page.waitForTimeout(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(y - i * 12) }) }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await page.waitForTimeout(400)
      const [after, , pageY1] = await pos()
      const opened = await page.getByRole('dialog').first().isVisible().catch(() => false)
      check(`${tag} 11 vertical swipe on an empty slot scrolls and opens nothing`, { before, after, maxTop, pageY0, pageY1, opened }, Math.abs(after - before) > 20 && !opened)
      await slot.scrollIntoViewIfNeeded(); const bb2 = await slot.boundingBox()
      await page.touchscreen.tap(bb2.x + bb2.width / 2, bb2.y + 4)
      const creator = page.getByRole('dialog', { name: 'New shift' })
      await creator.waitFor({ timeout: 10_000 }).catch(() => {})
      const start = await creator.getByLabel(/^Start time/).inputValue().catch(() => null)
      check(`${tag} 11 a tap on an empty hour opens New shift at that hour (18:00)`, start, start === '18:00')
      await settled(page); await page.screenshot({ path: path.join(OUT_DIR, `panel-create-${tag}.png`) })
      await page.keyboard.press('Escape')
    }
    await context.close()
  }
} finally {
  await browser.close()
}
lines.push(failed ? 'SHOTS FAILED' : 'SHOTS OK')
writeFileSync(path.join(OUT_DIR, 'measure.txt'), lines.join('\n') + '\n')
console.log(failed ? 'SHOTS FAILED' : 'SHOTS OK')
process.exit(failed ? 1 : 0)
