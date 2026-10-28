// Captures and numeric checks for each person's roster week (SHAPE 2026-10-28 §8, PLAN §5). Run through the runner:
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
  { name: '1280', width: 1280, height: 800, grid: true },
  { name: '1280-rail', width: 1280, height: 800, grid: true, collapsed: true },
  { name: '1280-dark', width: 1280, height: 800, grid: true, dark: true },
  { name: '1024', width: 1024, height: 768 },
  { name: '390', width: 390, height: 844, mobile: true },
]
// S1 rich, S2 empty week, S3 not on the roster, S4 never answers, S5 answers 500; P1 the participant week.
const STATES = [
  { name: 'staff-full', url: '/staff/s-0001?tab=week', ready: '[data-shift-open]' },
  { name: 'participant', url: '/participants/p-0001?tab=people&section=week', ready: '[data-shift-open]' },
  { name: 'staff-empty', url: '/staff/s-0002?tab=week', text: 'Nothing rostered this week' },
  { name: 'not-on-roster', url: '/staff/s-0003?tab=week', text: 'Not on the roster' },
  { name: 'loading', url: '/staff/s-0004?tab=week', busy: true },
  { name: 'error', url: '/staff/s-0005?tab=week', text: 'Try again' },
]

const lines = []
let failed = false
const check = (name, value, ok) => { if (!ok) failed = true; const l = `CHECK ${ok ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(value)}`; lines.push(l); console.log(l) }

const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const shift = (o) => ({ id: 'sh', participantId: 'p-0001', participantName: 'Liam Okafor', staffId: 's-0001', staffName: 'Callum Radford', serviceDate: '', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false, durationHours: 8, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, ...o })
const trip = (start) => ({ tripInstanceId: 't1', tripCode: 'BMT-26', tripName: 'Blue Mountains weekend', startDate: start, endDate: addDays(start, 2), isDriver: true })
const leave = (o) => ({ availabilityType: 'Annual', notes: null, startTime: null, endTime: null, ...o })
const staffRow = (staffId, fullName, o = {}) => ({ staffId, fullName, role: 'SupportWorker', compliance: 'Ok', complianceNotes: [], rosteredHours: 0, targetHours: 38, shifts: [], tripBars: [], leave: [], ...o })

/** The board the API would send for one person's week (D11), or null to leave the request hanging, or a status to fail it. */
function board(url) {
  const q = new URL(url).searchParams
  const mon = q.get('weekStart'); const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i))
  const staffBoard = (rows) => envelope({ groupBy: 'Staff', weekStart: mon, days, staffRows: rows, unfilled: [], exceptions: [] })
  const sid = q.get('staffId'); const pid = q.get('participantId')
  if (pid) {
    const s = [
      shift({ id: 'p1', serviceDate: days[0], staffId: undefined, staffName: undefined, status: 'Draft' }),
      shift({ id: 'p2', serviceDate: days[1], startTime: '07:30:00', endTime: '15:30:00', staffName: 'Priya Nadarajah', staffId: 's-0002', assigneeOnApprovedLeave: true }),
      shift({ id: 'p3', serviceDate: days[3] }),
    ].map((x) => { if (!x.staffId) { delete x.staffId; delete x.staffName } return x })
    return envelope({ groupBy: 'Participant', weekStart: mon, days, exceptions: [], participantRows: [{ participantId: pid, fullName: 'Liam Okafor', supportRatio: 'OneToOne', overnightSupport: 'None', hasRestrictivePractice: false, shifts: s, tripBars: [trip(days[3])], scheduledHours: 24, daysWithoutCover: 4 }] })
  }
  if (sid === 's-0001') return staffBoard([staffRow(sid, 'Callum Radford', {
    rosteredHours: 41, targetHours: 38, tripBars: [trip(days[2])],
    leave: [leave({ startDate: days[6], endDate: days[6], kind: 'ApprovedLeave' }), leave({ startDate: days[0], endDate: days[0], kind: 'PendingRecurringRule', availabilityType: null, startTime: '06:00:00', endTime: '08:00:00' })],
    shifts: [
      shift({ id: 's1', serviceDate: days[0], status: 'Draft', startTime: '08:00:00', endTime: '14:00:00', durationHours: 6 }),
      shift({ id: 's2', serviceDate: days[1], startTime: '13:00:00', endTime: '17:00:00', durationHours: 4, participantName: 'Aaliyah Thompson-Whitcombe' }),
      shift({ id: 's3', serviceDate: days[1], startTime: '07:00:00', endTime: '11:00:00', durationHours: 4 }),
      shift({ id: 's4', serviceDate: days[2], status: 'InProgress' }),
      shift({ id: 's5', serviceDate: days[3], status: 'Completed' }),
      shift({ id: 's6', serviceDate: days[4], status: 'Cancelled' }),
      shift({ id: 's7', serviceDate: days[5], startTime: '22:00:00', endTime: '07:00:00', endsNextDay: true, durationHours: 9, nightType: 'ActiveNight' }),
    ],
  })])
  if (sid === 's-0002') return staffBoard([staffRow(sid, 'Priya Nadarajah')])
  if (sid === 's-0003') return staffBoard([])
  if (sid === 's-0004') return null
  return 500
}

/** Waits (at most 5 s) until no animation or transition is running, so a capture is not taken mid-fade. */
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})

// Everything below runs in the page against the week's own section (scoping keeps the sidebar's lists out).
const measure = (sec) => {
  const vis = (el) => el.checkVisibility()
  const parse = (s) => {
    if (s.startsWith('color(srgb')) return s.match(/[\d.]+/g).slice(0, 3).map((v) => Math.round(+v * 255))
    const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = s; const h = c.fillStyle
    return h.startsWith('#') ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : h.match(/[\d.]+/g).slice(0, 3).map(Number)
  }
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return parse(b) } return [255, 255, 255] }
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2) }
  const ol = sec.querySelector('ol')
  const days = ol ? [...ol.children].filter(vis) : []
  const overflow = [...sec.querySelectorAll('*')].filter((el) => vis(el) && !el.classList.contains('truncate') && !el.classList.contains('sr-only') && getComputedStyle(el).display !== 'inline' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
    .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')} ${el.scrollWidth}>${el.clientWidth}`)
  const times = [...sec.querySelectorAll('[data-shift-open] span.tabular-nums.shrink-0, li span.font-medium.tabular-nums.shrink-0')].filter(vis).filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent)
  const hit = (el) => { const r = el.getBoundingClientRect(); let w = r.width; let h = r.height
    for (const p of ['::before', '::after']) { const s = getComputedStyle(el, p); if (s.content === 'none' || s.position !== 'absolute') continue; w = Math.max(w, parseFloat(s.width) || 0, parseFloat(s.minWidth) || 0); h = Math.max(h, parseFloat(s.height) || 0, parseFloat(s.minHeight) || 0) }
    return [Math.round(w), Math.round(h)] }
  const small = [...sec.querySelectorAll('button, a, [data-shift-open]')].filter(vis).map((el) => [el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24), ...hit(el)]).filter(([, w, h]) => w < 43.5 || h < 43.5)
  const textContrast = (el) => el && vis(el) ? ratio(parse(getComputedStyle(el).color), bgOf(el)) : null
  const byText = (t) => [...sec.querySelectorAll('span, p')].find((el) => el.textContent.trim() === t && vis(el))
  const today = sec.querySelector('li[aria-current="date"]')
  const other = days.find((d) => d !== today)
  const fill = [...sec.querySelectorAll('[aria-hidden="true"] > div')].find((el) => el.style.width)
  return {
    width: Math.round(sec.getBoundingClientRect().width),
    tops: days.map((d) => d.offsetTop), widths: days.map((d) => Math.round(d.getBoundingClientRect().width)),
    olFits: ol ? ol.scrollWidth <= ol.clientWidth : true,
    pageFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    overflow, times, small,
    contrast: {
      span: textContrast(sec.querySelector('[id]:is(h2, h3, h4, h5, h6)')),
      weekdayToday: textContrast(today?.querySelector('span:not(.sr-only)')),
      dateToday: textContrast(today?.querySelectorAll('span:not(.sr-only)')[1]),
      weekday: textContrast(other?.querySelector('span:not(.sr-only)')),
      date: textContrast(other?.querySelectorAll('span:not(.sr-only)')[1]),
      noShifts: textContrast(byText('No shifts')), hours: textContrast(byText('Hours')), overTarget: textContrast(byText('Over target')),
      meter: fill ? ratio(parse(getComputedStyle(fill).backgroundColor), parse(getComputedStyle(fill.parentElement).backgroundColor)) : null,
    },
  }
}

const browser = await chromium.launch({ headless: true })
try {
  for (const vp of VIEWPORTS) {
    const tag = vp.name
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: vp.dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    if (vp.collapsed) await context.addInitScript((id) => localStorage.setItem(`odip_ui_prefs:${id}`, JSON.stringify({ sidebarCollapsed: true })), USER_ID)
    const page = await context.newPage()
    // The touch emulation alone left `pointer: coarse` false on the first page of a run; pin it so the 44px density tokens apply.
    const cdp = vp.mobile ? await context.newCDPSession(page) : null
    const pinCoarse = async () => { await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }); await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] }) }
    await pinCoarse()
    page.on('pageerror', (e) => check(`${tag} page error`, e.message, false))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route('**/api/v1/rostering/board*', (r) => {
      const b = board(r.request().url())
      if (b === null) return // S4: never answers, so the skeleton stays
      return typeof b === 'number' ? r.fulfill({ status: b, json: { success: false, data: null, message: 'boom', errors: [] } }) : r.fulfill({ json: b })
    })
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

    for (const st of STATES) {
      await page.goto(`${BASE_URL}${st.url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const sec = page.locator('section').filter({ has: page.getByRole('link', { name: 'Open in roster' }) }).last()
      await sec.waitFor({ timeout: 60_000 })
      if (st.ready) await sec.locator(st.ready).first().waitFor({ timeout: 30_000 })
      if (st.text) await sec.getByText(st.text, { exact: true }).first().waitFor({ timeout: 60_000 })
      if (st.busy) await sec.and(page.locator('[aria-busy="true"]')).waitFor({ timeout: 10_000 })
      await settled(page)
      const name = `${st.name}-${tag}`

      if (vp.mobile) {
        // A full-page screenshot drops the touch emulation, so the phone grows the viewport to the page, pins pointer: coarse again, proves it, then shoots without fullPage.
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, await page.evaluate(() => document.documentElement.scrollHeight)) })
        await pinCoarse(); await settled(page); await page.waitForTimeout(200)
        const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
        check(`${name} pointer coarse after resize`, coarse, coarse)
        const prev = await sec.getByRole('button', { name: 'Previous week' }).boundingBox()
        check(`${name} Previous week height>=44 after resize`, Math.round(prev.height), prev.height >= 43.5)
      }
      const m = await sec.evaluate(measure)
      const full = st.name === 'staff-full' || st.name === 'participant'
      if (full) {
        const grid = new Set(m.tops).size === 1 && m.tops.length === 7
        const list = m.tops.length === 7 && m.tops.every((t, i) => i === 0 || t > m.tops[i - 1])
        if (st.name === 'participant') check(`${name} participant container width (grid at >=928)`, m.width, m.width >= 928 ? grid : list)
        else if (vp.grid) {
          check(`${name} grid: 7 days on one row`, m.tops, grid)
          check(`${name} grid: day widths >=127`, m.widths, m.widths.every((w) => w >= 127))
          check(`${name} grid: ol does not scroll`, m.olFits, m.olFits)
        } else check(`${name} list: day tops strictly increase`, m.tops, list)
        check(`${name} times never clip`, m.times, m.times.length === 0)
      }
      check(`${name} no horizontal page scroll`, m.pageFits, m.pageFits)
      check(`${name} nothing in the section overflows`, m.overflow, m.overflow.length === 0)
      if (vp.mobile) check(`${name} hit boxes >=44x44`, m.small, m.small.length === 0)
      if (st.name === 'staff-full' && (tag === '1280' || tag === '1280-dark')) {
        for (const [k, v] of Object.entries(m.contrast)) {
          const min = k === 'meter' ? 3 : 4.5
          check(`${name} contrast ${k} >=${min}`, v, v !== null && v >= min)
        }
      }
      if (st.name === 'participant' && (tag === '1280' || tag === '1280-dark')) check(`${name} contrast No shifts >=4.5`, m.contrast.noShifts, m.contrast.noShifts !== null && m.contrast.noShifts >= 4.5)

      const bb = await sec.boundingBox()
      const clip = { x: Math.max(0, bb.x - 24), y: Math.max(0, bb.y - 24), width: Math.min(vp.width - Math.max(0, bb.x - 24), bb.width + 48), height: bb.height + 48 }
      await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), clip, ...(vp.mobile ? {} : { fullPage: true }) })
      if (st.name === 'staff-full') await page.screenshot({ path: path.join(OUT_DIR, `full-${tag}.png`), ...(vp.mobile ? {} : { fullPage: true }) })
      if (vp.mobile) { await page.setViewportSize({ width: vp.width, height: vp.height }); await pinCoarse() }
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
