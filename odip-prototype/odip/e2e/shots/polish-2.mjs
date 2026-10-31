// Polish batch 2: numeric checks and padded crops (run through the runner's `shots` target).
// Items: 1 Incidents banner icon, 2 touch hit areas, 3 explained dialog focus, 4 handler picker, 5 disabled textarea.
import { mkdirSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const overdue = [{ id: 'inc-1', title: 'Slip in kitchen', tripName: null, incidentType: 'Injury', severity: 'Low', status: 'Draft', reportedByName: 'Alex Rivera', incidentDateTime: '2026-09-01T10:00:00Z', qscReportingStatus: 'Required', isOverdue24h: true }]
const complaint = {
  id: 'c-1', receivedOn: '2026-10-05', channel: 'Phone', complainantKind: 'FamilyOrCarer', participantId: null, participantName: null,
  complainantName: 'Sam Carer', summary: 'Worker was late', status: 'Open', acknowledgedOn: null, actionsTaken: 'Spoke to the worker', outcome: null,
  outcomeCommunicatedOn: null, toldAboutCommission: false, toldAboutCommissionOn: null, closedOn: null, handledByUserId: 'u-gone', handledByName: 'Gone Person',
  incidentReportId: null, incidentReportTitle: null, openDays: 26, isActive: true, createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z',
}
const staff = [{ id: 'u-other', fullName: 'Someone Else', email: 'else@example.com', role: 'Coordinator', isActive: true }]

const results = []
const check = (name, value, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${value}`) }

const browser = await chromium.launch({ headless: true })

async function session(mode) {
  const touch = mode === 'touch'
  const context = await browser.newContext(touch
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce' }
    : { viewport: { width: 1280, height: 900 }, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce' })
  const page = await context.newPage()
  if (touch) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.on('pageerror', (e) => check(`page error (${mode})`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/incidents/overdue-qsc', (r) => r.fulfill({ json: envelope(overdue) }))
  await page.route('**/api/v1/complaints/c-1', (r) => r.request().method() === 'GET' ? r.fulfill({ json: envelope(complaint) }) : r.continue())
  await page.route('**/api/v1/staff?*', (r) => r.fulfill({ json: envelope(staff) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
  check(`pointer coarse (${mode})`, coarse, coarse === touch)
  return page
}
const go = async (page, p) => {
  await page.goto(`${BASE_URL}${p}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
}
const shot = async (page, loc, name) => {
  await loc.scrollIntoViewIfNeeded()
  const bb = await loc.boundingBox()
  if (!bb) return console.log(`no box for ${name}`)
  const vp = page.viewportSize()
  const x = Math.max(0, bb.x - 24), y = Math.max(0, bb.y - 24)
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), clip: { x, y, width: Math.min(vp.width - x, bb.width + 48), height: Math.min(vp.height - y, bb.height + 48) } })
}
// ::before size of a TAP_AREA control (the transparent hit pad) and its drawn box.
const pad = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect(), b = getComputedStyle(el, '::before')
  return { w: r.width, h: r.height, padW: parseFloat(b.width), padH: parseFloat(b.height) }
})

try {
  for (const mode of ['touch', 'fine']) {
    const touch = mode === 'touch'
    const page = await session(mode)

    // Item 1: icon beside the first text line.
    await go(page, '/incidents')
    const banner = page.getByRole('alert').first()
    await banner.waitFor({ timeout: 30_000 })
    const m = await banner.evaluate((el) => {
      const p = el.querySelector('p'), svg = el.querySelector('svg')
      const pr = p.getBoundingClientRect(), sr = svg.getBoundingClientRect()
      const lh = parseFloat(getComputedStyle(p).lineHeight)
      return { lines: Math.round(pr.height / lh), iconCentre: sr.top + sr.height / 2, firstLineCentre: pr.top + lh / 2, bannerH: el.getBoundingClientRect().height }
    })
    const d = Math.abs(m.iconCentre - m.firstLineCentre)
    check(`item 1 icon vs first line (${mode}, ${m.lines} lines, banner ${Math.round(m.bannerH)}px)`, `${d.toFixed(1)}px`, d <= 2)
    if (!touch && m.lines === 1) check('item 1 single-line desktop banner height', `${m.bannerH}px`, Math.round(m.bannerH) === 40)
    await shot(page, banner, `item1-banner-${mode}`)
    await page.screenshot({ path: path.join(OUT_DIR, `incidents-full-${mode}.png`) })

    // Items 2 and 3: onboarding checklist (sm Buttons, then the dialog and its close button).
    await go(page, '/onboarding/p-0103')
    const records = page.getByRole('button', { name: 'Record it' })
    await records.first().waitFor({ timeout: 30_000 })
    const sm = await pad(records.nth(1))
    if (touch) {
      check('item 2 sm Button hit pad (touch)', `${sm.padW}x${sm.padH} drawn ${sm.w}x${sm.h}`, sm.padW >= 44 && sm.padH >= 44)
    } else {
      check('item 2 sm Button drawn size (fine)', `${sm.w}x${sm.h}, pad equals box`, Math.round(sm.h) === 24 && Math.abs(sm.padH - sm.h) < 1)
    }
    for (const [row, label] of [[1, 'Told how to make a complaint on'], [2, 'Rights explained on']]) {
      await records.nth(row).click()
      const dialog = page.getByRole('dialog', { name: 'Complaints and rights' })
      await dialog.waitFor()
      const focused = await page.evaluate(() => document.activeElement?.labels?.[0]?.textContent?.trim() ?? document.activeElement?.tagName)
      check(`item 3 focus from row ${row} (${mode})`, focused, focused === label)
      if (row === 2) {
        const close = await pad(dialog.getByRole('button', { name: 'Close dialog' }))
        if (touch) check('item 2 Modal close hit pad (touch)', `${close.padW}x${close.padH} drawn ${close.w}x${close.h}`, close.padW >= 44 && close.padH >= 44)
        else check('item 2 Modal close drawn size (fine)', `${close.w}x${close.h}`, Math.round(close.h) === 28 && Math.abs(close.padH - close.h) < 1)
        await shot(page, dialog, `item3-dialog-${mode}`)
      }
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await dialog.waitFor({ state: 'hidden' })
    }
    await shot(page, page.locator('#checklist-heading').locator('xpath=ancestor::section[1]'), `item2-checklist-${mode}`)

    // Items 4 and 5: the complaint form.
    await go(page, '/complaints/c-1')
    const handled = page.locator('label', { hasText: 'Handled by' }).locator('xpath=following::input[@role="combobox"][1]')
    await handled.waitFor({ timeout: 30_000 })
    const optionTexts = async () => { await handled.click(); const t = await page.getByRole('option').allTextContents(); await page.keyboard.press('Escape'); return t.map((s) => s.trim()) }
    let opts = await optionTexts()
    check(`item 4 saved inactive handler offered (${mode})`, JSON.stringify(opts), opts.includes('Gone Person (inactive)'))
    await handled.click()
    await page.getByRole('option', { name: 'Someone Else' }).click()
    opts = await optionTexts()
    check(`item 4 still offered after switching away (${mode})`, JSON.stringify(opts), opts.includes('Gone Person (inactive)') && opts.includes('Someone Else'))
    await shot(page, handled.locator('xpath=ancestor::div[1]'), `item4-picker-${mode}`)

    const ta = page.getByLabel('Actions taken')
    const style = () => ta.evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, color: s.color, cursor: s.cursor, opacity: s.opacity } })
    const enabled = await style()
    await ta.evaluate((el) => { el.disabled = true })
    const dis = await style()
    check(`item 5 disabled textarea differs (${mode} light)`, JSON.stringify({ enabled, dis }), dis.bg !== enabled.bg && dis.color !== enabled.color && dis.cursor === 'not-allowed' && parseFloat(dis.opacity) < 1)
    await shot(page, ta, `item5-textarea-${mode}-light`)
    if (!touch) {
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
      const dark = await style()
      check('item 5 disabled textarea (dark)', JSON.stringify(dark), dark.cursor === 'not-allowed' && dark.bg !== enabled.bg)
      await shot(page, ta, 'item5-textarea-fine-dark')
    }
    await page.context().close()
  }
} finally {
  await browser.close()
}
const failed = results.filter((ok) => !ok).length
console.log(`TOTAL ${results.length - failed}/${results.length} pass`)
if (failed) process.exitCode = 1
