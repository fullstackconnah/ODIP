// Deleted records (Settings > Data): the list, row detail, states and the SHAPE "Shots" numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/deleted-records.mjs <outdir>
// Sign-in, the provider row and /audit/deleted are stubbed with page.route (synthetic rows). The clock is pinned to 2026-11-10 12:00 Sydney.
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

const NOW = new Date('2026-11-10T12:00:00+11:00')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const provider = {
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Sydney NSW 2000',
  state: 'NSW', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null, timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}

const TITLE = 'Deleted records'
const INTRO = 'Records deleted in your organisation, newest first: who deleted each one, when, and what it held. Only deletions since this list was added to Bunya Support appear here.'
const LONG = 'Escalate to the on-call coordinator before any evening community outing starts'
const held = (o) => Object.entries(o).map(([field, old]) => ({ field, old, new: null }))
const row = (id, entityType, minutesAgo, by, fields) => ({ id, entityType, entityId: `e-${id}`, deletedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(), deletedByName: by, fields })
const PID = '00000000-0000-0000-0000-0000000000c1'
const ROWS = [
  row('d1', 'Shift', 20, 'Sam Lee', held({ ServiceDate: '2026-11-10', StartTime: '09:00:00', EndTime: '15:00:00', ParticipantId: PID, Notes: 'Community access' })),
  row('d2', 'ParticipantRiskEntry', 90, 'Priya Nair', held({ Description: 'Choking risk at mealtimes', Severity: 'High', ParticipantId: PID })),
  row('d3', 'StaffAvailability', 300, 'Sam Lee', held({ AvailabilityType: 'Unavailable', StartDateTime: '2026-11-11T04:00:00Z', EndDateTime: '2026-11-11T08:00:00Z' })),
  row('d4', 'ShiftPattern', 1500, null, held({ DayOfWeek: 'Monday', StartTime: '09:00:00', EndTime: '15:00:00' })),
  row('d5', 'ParticipantRoutine', 1600, 'Priya Nair', held({ Title: 'Morning routine', ParticipantId: PID })),
  row('d6', 'ComplianceItem', 2900, 'Sam Lee', held({ Label: 'Public liability insurance', Notes: 'Renewed elsewhere' })),
  row('d7', 'ParticipantContactRole', 4300, 'Priya Nair', held({ Notes: 'Plan nominee', ParticipantId: PID })),
  row('d8', 'Shift', 5800, 'Sam Lee', []), // sparse: no values kept
]
const LONG_ROW = row('d9', 'ParticipantRiskEntry', 10, 'Priya Nair', held({ Description: LONG }))
const MANY = Array.from({ length: 25 }, (_, i) => row(`m${i}`, 'Shift', 10 + i, 'Sam Lee', held({ ServiceDate: '2026-11-10', StartTime: '09:00:00', EndTime: '15:00:00' })))

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

// mode: list | many (pager) | long | empty | fail | hang
async function openPage(browser, vp, { mode = 'list', role = 'Admin', username = 'dev.admin' } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope(provider) }))
  await page.route('**/api/v1/audit/deleted**', async (r) => {
    if (mode === 'hang') return // never answered: the loading skeleton
    if (mode === 'fail') return r.fulfill({ status: 500, json: { success: false, data: null, message: 'Server error', errors: ['Server error'] } })
    const type = new URL(r.request().url()).searchParams.get('entityType')
    let items = mode === 'empty' ? [] : mode === 'many' ? MANY : mode === 'long' ? [LONG_ROW, ...ROWS] : ROWS
    if (type) items = items.filter((i) => i.entityType === type)
    return r.fulfill({ json: envelope({ items, totalCount: mode === 'many' ? 60 : items.length, page: 1, pageSize: 25 }) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}

const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${ctx}: no horizontal scroll`, o <= 0, o)
}
// The table, the card and the date, which the page-level check above cannot see (the table scrolls inside its pane; the card button can sit over the meta line).
const DATE_RE = /\d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2}\s?(am|pm)/
const tableChecks = async (page, vp, ctx) => {
  const m = await page.evaluate(() => {
    const table = document.querySelector("table")
    let box = table.parentElement
    while (box && box !== document.body && !/(auto|scroll|hidden)/.test(getComputedStyle(box).overflowX)) box = box.parentElement
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1
    const overlaps = []
    for (const tr of table.querySelectorAll("tbody tr:not([data-row-detail])")) {
      const btn = tr.querySelector("button[aria-expanded]")
      if (!btn) continue
      const b = btn.getBoundingClientRect()
      for (const td of tr.querySelectorAll("td[data-card=meta]")) {
        const range = document.createRange()
        range.selectNodeContents(td)
        if ([...range.getClientRects()].some((r) => r.width > 0 && hit(r, b))) overlaps.push(td.textContent.slice(0, 24))
      }
    }
    const dates = [...table.querySelectorAll("tbody td[data-label=Deleted]")].map((td) => { const el = td.querySelector("span") ?? td; return { text: el.textContent, over: Math.max(el.scrollWidth - el.clientWidth, td.scrollWidth - td.clientWidth) } })
    return { tableOver: box.scrollWidth - box.clientWidth, overlaps, dates }
  })
  if (!vp.touch) check(ctx + ": table fits its pane (no inner horizontal scroll)", m.tableOver <= 1, m.tableOver)
  if (vp.touch) check(ctx + ": no Show details button over a meta line", m.overlaps.length === 0, m.overlaps)
  const bad = m.dates.filter((d) => d.over > 1 || !DATE_RE.test(d.text))
  check(ctx + ": every Deleted date is whole (" + m.dates.length + " rows)", m.dates.length > 0 && bad.length === 0, bad.slice(0, 3))
}
const open = async (page, ready) => {
  await page.goto(`${BASE_URL}/settings?section=deleted-records`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  if (ready) await ready(page)
  await page.waitForTimeout(400)
}
const waitText = (text) => (page) => page.getByText(text).first().waitFor({ state: 'visible', timeout: 60_000 })
const waitRows = waitText('Choking risk at mealtimes')
const crop = async (page, locator, name, vp, pad = 16) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
const showButtons = (page) => page.getByRole('button', { name: /^Show details for/ })

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const main = (page) => page.locator('main').first()

  // list, detail-open-shift, sparse-row-detail, full page
  try {
    const { context, page } = await openPage(browser, vp)
    await open(page, waitRows)
    const text = await main(page).innerText()
    check(t('list: header text is the exact title and intro'), text.includes(TITLE) && text.includes(INTRO), text.slice(0, 120))
    check(t('list: no pager with 8 rows'), (await page.getByRole('button', { name: 'Next page' }).count()) === 0)
    check(t('list: a deleted-by-nobody row reads System'), text.includes('System'))
    await noHScroll(page, t('list'))
    await tableChecks(page, vp, t('list'))
    const filter = page.getByRole('button', { name: /All types/ }).first()
    const fh = await filter.evaluate((e) => ({ h: e.getBoundingClientRect().height, want: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--control-h')) || null }))
    const wantH = vp.touch ? 44 : 32
    check(t(`list: Type filter height is --control-h (${wantH})`), Math.abs(fh.h - wantH) <= 1, fh)
    if (vp.touch) {
      const small = await showButtons(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height).filter((h) => h < 43.5))
      check(t('list: Details buttons are at least 44 high'), small.length === 0, small)
    } else {
      const heights = await page.locator('tbody tr').evaluateAll((trs) => trs.map((r) => ({ t: r.textContent.slice(0, 20), h: r.getBoundingClientRect().height })))
      const single = heights.find((h) => h.t.startsWith('Tue 10 Nov 2026'))
      check(t('list: a single-line row is --row-h (34)'), single && Math.abs(single.h - 34) <= 1.5, heights.slice(0, 3))
    }
    await crop(page, main(page), `list-${vp.name}.png`, vp)

    // detail open (the Shift row)
    await showButtons(page).first().click()
    const detail = page.locator('[id^="deleted-detail-"]').first()
    await detail.waitFor({ state: 'visible', timeout: 20_000 })
    const geo = await detail.evaluate((el) => {
      const bar = el.firstElementChild, cs = getComputedStyle(bar)
      const rows = [...el.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1).length
      return { wrapperOver: el.scrollWidth - el.clientWidth, overflowing: rows, border: cs.borderLeftWidth, padLeft: cs.paddingLeft, link: !!el.querySelector('a[href^="/participants/"]') }
    })
    check(t('detail-open-shift: wrapper and rows do not overflow'), geo.wrapperOver <= 0 && geo.overflowing === 0, geo)
    check(t('detail-open-shift: 2px left border, 12px padding-left'), geo.border === '2px' && geo.padLeft === '12px', geo)
    check(t('detail-open-shift: Open participant link shows'), geo.link)
    await noHScroll(page, t('detail-open-shift'))
    await tableChecks(page, vp, t('detail-open-shift'))
    await crop(page, main(page), `detail-open-shift-${vp.name}.png`, vp)
    await showButtons(page).first().click().catch(() => {})

    if (vp.touch) {
      await page.getByRole('button', { name: /^(Show|Hide) details for Shift$/ }).first().click()
      await page.getByText('No details were kept for this record.').waitFor({ state: 'visible', timeout: 20_000 })
      await noHScroll(page, t('sparse-row-detail'))
    await tableChecks(page, vp, t('sparse-row-detail'))
      await crop(page, main(page), `sparse-row-detail-${vp.name}.png`, vp)
    }
    await fullPage(page, path.join(OUT_DIR, `full-page-${vp.name}.png`))
    await context.close()
  } catch (e) { check(t('list ran'), false, String(e.message).split('\n')[0]) }

  // long label wraps (390) / taller row (1280)
  try {
    const { context, page } = await openPage(browser, vp, { mode: 'long' })
    await open(page, waitText(LONG))
    const cell = page.getByText(LONG).first()
    const m = await cell.evaluate((e) => { const lh = parseFloat(getComputedStyle(e).lineHeight); return { title: e.getAttribute('title'), cut: e.scrollWidth - e.clientWidth, lines: Math.round(e.getBoundingClientRect().height / lh), h: e.closest('tr')?.getBoundingClientRect().height ?? null } })
    if (vp.touch) {
      check(t('long-label: title is not cut sideways'), m.cut <= 0, m)
      check(t('long-label: title wraps onto at least 2 lines'), m.lines >= 2, m)
    } else {
      // one line, ellipsis, full label in the tooltip, row stays --row-h
      check(t('long-label: title is one truncated line with the full label as its tooltip'), m.cut > 0 && m.lines === 1 && m.title === LONG, m)
      check(t('long-label: the long row is --row-h (34)'), Math.abs(m.h - 34) <= 1.5, m)
    }
    await noHScroll(page, t('long-label'))
    await tableChecks(page, vp, t('long-label'))
    if (vp.touch) await crop(page, main(page), `long-label-${vp.name}.png`, vp)
    await context.close()
  } catch (e) { check(t('long-label ran'), false, String(e.message).split('\n')[0]) }

  // pager: only past 25
  try {
    const { context, page } = await openPage(browser, vp, { mode: 'many' })
    await open(page, waitText('Showing 1-25 of 60'))
    const next = page.getByRole('button', { name: 'Next page' })
    check(t('pager: shows "Showing 1-25 of 60" with 25 rows'), (await next.count()) === 1)
    await tableChecks(page, vp, t('pager'))
    if (vp.touch) {
      const hs = await page.locator('button[aria-label="Next page"], button[aria-label="Previous page"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
      check(t('pager: buttons are at least 44 high'), hs.length === 2 && hs.every((h) => h >= 43.5), hs)
    }
    await context.close()
  } catch (e) { check(t('pager ran'), false, String(e.message).split('\n')[0]) }

  if (vp.touch) continue

  // filter-empty (a Type with no rows), nothing-deleted, error, loading, settings-rail (1280 only)
  try {
    const { context, page } = await openPage(browser, vp)
    await open(page, waitRows)
    await page.getByRole('button', { name: /All types/ }).first().click()
    await page.getByRole('option', { name: 'Claim line item' }).click() // no stub row of this type
    await page.getByText('Nothing of this type has been deleted.').waitFor({ state: 'visible', timeout: 20_000 })
    await noHScroll(page, t('filter-empty'))
    await crop(page, main(page), `filter-empty-${vp.name}.png`, vp)
    await context.close()
  } catch (e) { check(t('filter-empty ran'), false, String(e.message).split('\n')[0]) }

  for (const [state, mode, ready, text] of [
    ['nothing-deleted', 'empty', waitText('Nothing has been deleted since this list was added.'), null],
    ['error', 'fail', async (p) => { await p.getByRole('button', { name: /try again/i }).first().waitFor({ state: 'visible', timeout: 60_000 }) }, null],
    ['loading', 'hang', async (p) => { await p.getByText(TITLE).first().waitFor({ state: 'visible', timeout: 60_000 }) }, null],
  ]) {
    try {
      const { context, page } = await openPage(browser, vp, { mode })
      await open(page, ready)
      if (mode === 'hang') await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important }' }) // the skeleton pulse never settles
      await noHScroll(page, t(state))
      await crop(page, main(page), `${state}-${vp.name}.png`, vp)
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }

  // settings rail: Data group lists Deleted records right after Data retention
  try {
    const { context, page } = await openPage(browser, vp)
    await open(page, waitRows)
    const nav = page.getByRole('navigation').filter({ hasText: 'Data retention' }).first()
    const names = await nav.getByRole('link').allInnerTexts().catch(() => [])
    const labels = names.length ? names : await nav.locator('a, button').allInnerTexts()
    const i = labels.findIndex((l) => l.trim() === 'Data retention')
    check(t('settings-rail: Deleted records comes right after Data retention'), i >= 0 && labels[i + 1]?.trim() === 'Deleted records', labels)
    await crop(page, nav, `settings-rail-${vp.name}.png`, vp)
    await context.close()
  } catch (e) { check(t('settings-rail ran'), false, String(e.message).split('\n')[0]) }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
