// Completions tidy shots (m1112-shiftreview): approve dialog times, variance pills, empty copy, batch Callout, phone cards, reason field, StatusBadge pills.
// Capture states: queue-many, queue-empty-default, queue-empty-filtered, approve-dialog, approve-dialog-loading, return-dialog-blank, batch-result-failed, read-only
// Plus one full page per breakpoint (390 touch, 1440) and one dark crop of the approve dialog. Date and theme are pinned in the context (en-AU, Sydney, light).
import path from 'node:path'
import { prepareOutDir, cropElement, fullPage, writeChecks } from '../shots/lib/capture.mjs'
let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const item = (shiftId, staffName, participantName, o = {}) => ({
  shiftId, completionId: `c-${shiftId}`, participantName, staffName, serviceDate: '2026-10-14',
  rosteredStart: '2026-10-13T22:00:00Z', rosteredEnd: '2026-10-14T04:00:00Z', actualStart: '2026-10-13T22:02:00Z', actualEnd: '2026-10-14T04:04:00Z',
  varianceMinutesStart: 2, varianceMinutesEnd: 4, status: 'PendingReview', timeZoneId: 'Australia/Sydney', isOutlierVariance: false, varianceReviewMinutes: 15,
  returnCount: 0, dosesWithoutOutcome: 0, breakMinutes: 0, startWasManual: false, timesAdjusted: false, offRoster: false, incidentCount: 0, missingDetails: [], ...o,
})
const ITEMS = [
  item('s-a', 'Ben Turner', 'Amy Ng', { varianceMinutesStart: 0, varianceMinutesEnd: 0, actualStart: '2026-10-13T22:00:00Z', actualEnd: '2026-10-14T04:00:00Z' }),
  item('s-b', 'Priya Shah', 'Liam Okafor'),
  item('s-c', 'Dana Cole', 'Noah Reid', { varianceMinutesStart: -20, varianceMinutesEnd: 35, isOutlierVariance: true, offRoster: true, timesAdjusted: true, returnCount: 2, actualStart: '2026-10-13T21:40:00Z', actualEnd: '2026-10-14T04:35:00Z' }),
  item('s-d', 'Sam Lee', 'Maya Quinn', { varianceMinutesStart: 0, varianceMinutesEnd: 6, actualEnd: '2026-10-14T04:06:00Z' }),
  item('s-e', 'Kim Ho', 'Omar Said', { missingDetails: ['kilometres', 'notes'] }),
  item('s-f', 'Lou Park', 'Zoe Hart'),
]
const detailFor = (shiftId) => {
  const it = ITEMS.find((i) => i.shiftId === shiftId) ?? ITEMS[0]
  return {
    id: `sc-${shiftId}`, shiftId, actualStart: it.actualStart, actualEnd: it.actualEnd, timeZoneId: 'Australia/Sydney', geolocationDeclined: false, startWasManual: false,
    submittedByUserId: 'staff-1', submittedByName: it.staffName, startedAt: it.actualStart, submittedAt: it.actualEnd, reviewedByUserId: null, reviewedByName: null, reviewedAt: null,
    reviewOutcome: null, returnReason: null, varianceMinutesStart: it.varianceMinutesStart, varianceMinutesEnd: it.varianceMinutesEnd, isOutlierVariance: it.isOutlierVariance,
    varianceReviewMinutes: 15, shiftReturnCount: it.returnCount, incidents: [], breaks: [], breakMinutes: 0, netWorkedMinutes: 360, handoverText: 'Quiet shift.', nothingToHandOver: false,
    nothingToNoteConfirmed: false, timesAdjusted: false, originalActualStart: null, originalActualEnd: null, timeAdjustmentReason: null, kilometres: null, anythingToReport: null,
    sentFromOffline: false, missingDetails: [], preTravelNone: true, postTravelNone: true,
  }
}
const paged = (items) => ({ items, totalCount: items.length, page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrevious: false })
const checks = []
const check = (name, value, ok) => { checks.push({ name, pass: !!ok, detail: String(value) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value}`) }
const browser = await chromium.launch({ headless: true })

async function open(width, height, touch, { role = 'Coordinator', theme = 'light', skipRows = false } = {}) {
  const state = { items: ITEMS, detail: 'ok', gate: null }
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce', locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: touch, isMobile: touch })
  await context.addInitScript(([id, th]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: th })) } catch (e) {} }, [USER_ID, theme])
  const page = await context.newPage()
  if (touch) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.on('pageerror', (e) => check(`page error (${width})`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }) }))
  await page.route((u) => u.pathname === '/api/v1/rostering/completions', (r) => r.fulfill({ json: envelope(paged(state.items)) }))
  await page.route((u) => /^\/api\/v1\/rostering\/shifts\/[^/]+\/completion$/.test(u.pathname), async (r) => {
    if (state.gate) await state.gate
    if (state.detail === 'fail') return r.fulfill({ status: 500, json: { success: false, data: null, message: 'Server error', errors: [] } })
    const id = r.request().url().split('/shifts/')[1].split('/')[0]
    return r.fulfill({ json: envelope(detailFor(id)) })
  })
  await page.route((u) => u.pathname === '/api/v1/rostering/completions/approve-batch', (r) => r.fulfill({ json: envelope([
    { shiftId: 's-b', approved: true, code: null, message: null },
    { shiftId: 's-d', approved: false, code: 'SHIFT_NEEDS_REVIEW', message: 'This shift needs a closer look before it can be approved.' },
  ]) }))
  await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 120000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' }); await signIn.waitFor({ state: 'visible', timeout: 60000 }); await signIn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 })
  await page.goto(BASE_URL + '/rostering/completions', { waitUntil: 'domcontentloaded', timeout: 120000 })
  if (!skipRows) await page.getByText('Amy Ng').first().waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  return { page, state, context }
}

const tokenColor = (page, name) => page.evaluate((n) => { const p = document.createElement('span'); p.style.color = `var(${n})`; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c }, name)
const colorOf = (loc) => loc.evaluate((el) => getComputedStyle(el).color)
const bgOf = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor)
const clear = (loc) => loc.evaluate((el) => el.scrollIntoView({ block: 'center' }))
const dialogOf = (page) => page.locator('[role="alertdialog"], [role="dialog"]').last()

async function run(width, height, touch) {
  const bp = String(width)
  const { page, state, context } = await open(width, height, touch)
  const rowOf = (name) => page.locator('tr, [role="row"], li').filter({ hasText: name }).last()
  const rowA = rowOf('Amy Ng'), rowB = rowOf('Liam Okafor'), rowC = rowOf('Noah Reid')
  const out = (f) => path.join(OUT_DIR, f)

  // queue-many: pills, phone card, guard
  const badges = await page.locator('main [data-status-badge]').evaluateAll((els) => els.map((e) => ({ text: e.textContent.trim(), bg: getComputedStyle(e).backgroundColor, h: e.getBoundingClientRect().height })))
  const variance = badges.filter((b) => /^(On time|Start )/.test(b.text))
  check(`variance pill text matches the pattern (${bp})`, variance.map((b) => b.text).join(' | '), variance.length >= 4 && variance.every((b) => /^(On time|Start (on time|[+-]\d+ min) · Finish (on time|[+-]\d+ min))$/.test(b.text)))
  const neutralBg = badges.find((b) => /^Returned \d+ time/.test(b.text))?.bg, warnBg = badges.find((b) => /^(Off roster|Needs details)$/.test(b.text))?.bg
  const plain = variance.find((b) => b.text === 'On time'), outlier = variance.find((b) => /-20 min/.test(b.text))
  check(`non-outlier pill background is the neutral StatusBadge (${bp})`, `${plain?.bg} vs ${neutralBg}`, plain && neutralBg && plain.bg === neutralBg)
  check(`outlier pill background is the warning StatusBadge (${bp})`, `${outlier?.bg} vs ${warnBg}`, outlier && warnBg && outlier.bg === warnBg)
  const strays = await page.evaluate(() => document.querySelectorAll('main span.rounded-full:not([data-status-badge])').length)
  check(`no hand-built rounded-full pills in the table (${bp})`, strays, strays === 0)
  check(`every pill is as tall as a StatusBadge sm (${bp})`, [...new Set(badges.map((b) => Math.round(b.h)))].join(','), new Set(badges.map((b) => Math.round(b.h))).size === 1)
  const uuid = await page.evaluate(() => /[0-9a-f]{8}-[0-9a-f]{4}-/.test(document.body.innerText))
  check(`no id text on the page (${bp})`, uuid, !uuid)
  const tapMin = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')) || 0)
  const ctlSm = await page.evaluate(() => { const p = document.createElement('div'); p.style.height = 'var(--control-h-sm)'; document.body.append(p); const h = p.getBoundingClientRect().height; p.remove(); return h })
  if (touch) {
    const bx = await rowB.getByRole('button', { name: /^Approve/ }).boundingBox()
    check(`row actions are --control-h-sm tall with a --tap-min hit area (${bp})`, `${Math.round(bx.height)} vs ${ctlSm}, tap-min ${tapMin}`, tapMin >= 44 && bx.height >= ctlSm - 0.5)
    const card = await rowB.evaluate((el) => {
      const q = (s) => [...el.querySelectorAll(s)].map((n) => ({ t: n.textContent.trim(), fs: getComputedStyle(n).fontSize, c: getComputedStyle(n).color, o: getComputedStyle(n).order }))
      return { primary: q('[class*="max-md:-order-2"]'), meta: q('[class*="max-md:-order-1"]') }
    })
    const muted = await tokenColor(page, '--color-muted-foreground')
    check(`card first line is the participant (${bp})`, JSON.stringify(card.primary), card.primary.length >= 1 && card.primary[0].t.includes('Liam Okafor') && card.primary[0].o === '-2')
    check(`staff and date are muted 13px meta (${bp})`, JSON.stringify(card.meta), card.meta.length === 2 && card.meta.every((m) => m.fs === '13px' && m.c === muted && m.o === '-1') && card.meta.some((m) => m.t.includes('Priya')))
  } else {
    const heads = await page.locator('thead th').allTextContents()
    check(`1440 column order starts Participant, Staff, Date (${bp})`, heads.join(' | '), /^Participant/.test(heads[heads.length ? 0 : 0] ?? '') || heads.slice(0, 4).join('|').includes('Participant'))
  }
  await clear(rowB)
  const list = rowB.locator('xpath=ancestor::*[self::table or self::ul or @role="table" or @role="list"][1]')
  await cropElement(page, (await list.count()) ? list : rowB, out(`queue-many-${bp}.png`), { touch })
  const full = await fullPage(page, path.join(OUT_DIR, 'full', `completions-${bp}.png`), { touch })
  checks.push(...full.checks)

  // approve-dialog
  await clear(rowB)
  await rowB.getByRole('button', { name: /^Approve/ }).click()
  const dlg = dialogOf(page)
  await dlg.getByText('Rostered:').first().waitFor({ timeout: 15000 })
  await dlg.getByText(/Loading what the worker entered/).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const dtext = (await dlg.textContent()) ?? ''
  check(`approve dialog shows Rostered then Actual (${bp})`, dtext.slice(0, 160), /Rostered:.*Actual:/s.test(dtext))
  check(`approve dialog has the consequence line (${bp})`, '', /Approving sends this shift's hours to Employment Hero and makes it ready to bill\./.test(dtext))
  const sw = await dlg.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  check(`approve dialog does not overflow sideways (${bp})`, JSON.stringify(sw), sw.sw <= sw.cw + 1)
  const muted = await tokenColor(page, '--color-muted-foreground'), fg = await tokenColor(page, '--color-foreground')
  const rosteredC = await colorOf(dlg.locator('div, p').filter({ hasText: /^Rostered:/ }).last())
  const actualRow = dlg.locator('div, p').filter({ hasText: /^Actual:/ }).last()
  const actualC = await colorOf(actualRow.locator('span.font-medium').first())
  check(`Rostered is --color-muted-foreground (${bp})`, `${rosteredC} vs ${muted}`, rosteredC === muted)
  check(`Actual value is --color-foreground (${bp})`, `${actualC} vs ${fg}`, actualC === fg)
  await cropElement(page, dlg, out(`approve-dialog-${bp}.png`), { touch })
  await page.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})

  // approve-dialog-loading
  let release; state.gate = new Promise((res) => { release = res })
  await clear(rowC)
  await rowC.getByRole('button', { name: /^Approve/ }).click()
  const dlg2 = dialogOf(page)
  await dlg2.getByText(/Loading what the worker entered/).waitFor({ timeout: 15000 })
  check(`loading line shows with Approve enabled (${bp})`, '', await dlg2.getByRole('button', { name: /^Approve/ }).isEnabled())
  await cropElement(page, dlg2, out(`approve-dialog-loading-${bp}.png`), { touch })
  release(); state.gate = null
  await page.keyboard.press('Escape'); await dlg2.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})

  // return-dialog-blank
  await clear(rowB)
  await rowB.getByRole('button', { name: /^Return/ }).click()
  const dlg3 = dialogOf(page)
  const ta = dlg3.locator('textarea')
  await ta.waitFor({ timeout: 15000 })
  await dlg3.getByRole('button', { name: /^Return/ }).last().click()
  await dlg3.getByRole('alert').filter({ hasText: /required/i }).waitFor({ timeout: 10000 })
  const f = await ta.evaluate((t) => {
    const lab = t.id ? document.querySelector(`label[for="${t.id}"]`) : null
    const dlgEl = t.closest('[role="alertdialog"], [role="dialog"]'); const cs = getComputedStyle(dlgEl)
    return { labelled: !!lab, invalid: t.getAttribute('aria-invalid'), w: t.getBoundingClientRect().width, pw: t.parentElement.clientWidth, dw: dlgEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }
  })
  check(`reason label is linked by for/id (${bp})`, JSON.stringify(f), f.labelled)
  check(`blank submit sets aria-invalid (${bp})`, f.invalid, f.invalid === 'true')
  check(`reason field fills the dialog content width (${bp})`, `${f.w} in ${f.pw}, dialog content ${f.dw}`, Math.abs(f.w - f.pw) <= 1 && f.pw >= f.dw - 48)
  await cropElement(page, dlg3, out(`return-dialog-blank-${bp}.png`), { touch })
  await dlg3.getByRole('button', { name: /^Cancel/ }).click(); await dlg3.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})

  // batch-result-failed
  await clear(rowB)
  await page.getByLabel('Select row s-b').check()
  await page.getByLabel('Select row s-d').check()
  await page.getByRole('button', { name: /approve selected \(2\)/i }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: /approve all/i }).click()
  const summary = page.getByRole('status').filter({ hasText: 'approved' }).first()
  await summary.waitFor({ timeout: 15000 })
  const stext = (await summary.textContent()) ?? ''
  check(`batch result is a role=status Callout naming the failed shift (${bp})`, stext, /Maya Quinn with Sam Lee on /.test(stext) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(stext))
  const calloutCls = await summary.evaluate((el) => (el.closest('[data-callout], [class*="callout"], [class*="Callout"]') ?? el).className)
  check(`batch result carries the warning tone (${bp})`, calloutCls, /warning/.test(calloutCls) || /amber|yellow/.test(calloutCls))
  await clear(summary)
  await cropElement(page, summary, out(`batch-result-failed-${bp}.png`), { touch })

  // queue-empty-default, then filtered
  state.items = []
  await page.goto(BASE_URL + '/rostering/completions', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.getByText('Nothing waiting for review').waitFor({ timeout: 30000 })
  check(`default empty copy (${bp})`, '', true)
  await cropElement(page, page.locator('main').first(), out(`queue-empty-default-${bp}.png`), { touch })
  await page.getByLabel('From').fill('2026-10-01')
  await page.getByText('No completions match these filters').waitFor({ timeout: 15000 })
  check(`filtered empty copy (${bp})`, '', true)
  await cropElement(page, page.locator('main').first(), out(`queue-empty-filtered-${bp}.png`), { touch })
  await context.close()

  // read-only: PermissionS lists 'rostering' in READ_ONLY_REFUSED_PAGES, so a ReadOnly user never reaches this page (the vitest ReadOnly test covers the note). Check the refusal; no page exists to capture.
  const ro = await open(width, height, touch, { role: 'ReadOnly', skipRows: true })
  await ro.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  const roUrl = new URL(ro.page.url()).pathname
  const roRows = await ro.page.getByText('Liam Okafor').count()
  check(`ReadOnly is refused the Completions page, so no read-only capture exists (${bp})`, `${roUrl}, rows ${roRows}`, roUrl !== '/rostering/completions' && roRows === 0)
  await ro.context.close()
}

async function dark() {
  const { page, context } = await open(1440, 900, false, { theme: 'dark' })
  const row = page.locator('tr, [role="row"], li').filter({ hasText: 'Liam Okafor' }).last()
  await clear(row)
  await row.getByRole('button', { name: /^Approve/ }).click()
  const dlg = dialogOf(page)
  await dlg.getByText('Rostered:').first().waitFor({ timeout: 15000 })
  await cropElement(page, dlg, path.join(OUT_DIR, 'approve-dialog-dark-1440.png'), { touch: false })
  await context.close()
}

try {
  await run(1440, 900, false)
  await run(390, 844, true)
  await dark()
} finally {
  writeChecks(OUT_DIR, checks)
  await browser.close()
}
const failed = checks.filter((c) => !c.pass)
console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS')
process.exit(failed.length ? 1 : 0)
