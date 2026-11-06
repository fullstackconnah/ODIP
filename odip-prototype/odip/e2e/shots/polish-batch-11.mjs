// Polish batch 11: CT-3/CT-4 compact staff-preferences board, LOC-1a/1c service locations (cards at 390, house select in the shift slide-over), PT-3 Records > History from the mock audit route.
// Numeric checks only from computed boxes. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-11.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev User', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const provider = {
  id: '00000000-0000-0000-0000-0000000000b1', registrationNumber: '4050012345', abn: '51824753556', organisationName: 'Sample Support Co', address: '1 Example Street, Melbourne VIC 3000',
  state: 'VIC', gstRegistered: true, isPaceProvider: false, bankAccountName: null, bsb: null, accountNumber: null, invoiceFooterNotes: null, managerName: null, managerPhone: null,
  tradingName: null, contactEmail: null, contactPhone: null, website: null, timeZoneId: null, participantReadinessMode: 'Warn', medicationCompetencyMode: 'Warn', updatedAt: '2026-10-30T01:00:00.0000000Z',
  invoiceNumberPrefix: 'INV-', creditNotePrefix: 'CN-', invoiceStartNumber: 1, paymentTermsDays: 14, nextInvoiceDisplayNumber: 'INV-0001', invoicesIssued: false,
}
const place = (id, name, over = {}) => ({ id, name, address: null, latitude: -27.4698, longitude: 153.0251, radiusMetres: 200, timeZoneId: null, isActive: true, ...over })
const PLACES = [
  place('loc-1', 'Southside community day centre', { address: '12 Riverside Parade, Southside Heights QLD 4101' }),
  place('loc-2', 'Perth office', { address: '1 Hay Street, Perth WA 6000', latitude: -31.9523, longitude: 115.8613, radiusMetres: 300, timeZoneId: 'Australia/Perth' }),
  place('loc-3', 'Old depot', { isActive: false }),
]
const crow = (n, name, level, rank, reason = null) => ({ staffId: `s${n}`, staffName: name, participantId: 'p-0001', participantName: 'Liam Okafor', level, rank, reason, updatedAt: '2026-10-01T00:00:00Z' })
const TIERS = [
  crow(1, 'Ava Hill', 'Preferred', 1, 'Knows the morning routine'), crow(2, 'Ben Cole', 'Preferred', 2),
  crow(3, 'Cara Dunn', 'Backup', 1), crow(4, 'Dev Rao', 'Emergency', 1), crow(5, 'Eli Fox', 'Excluded', 0, 'Past conflict'),
]

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} = ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}
const safe = async (name, fn) => { try { await fn() } catch (e) { check(`${name} (script error)`, false, String(e.message).split('\n')[0]) } }

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })

async function openPage(vp, { dark = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  if (vp.touch) {
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route('**/api/v1/provider-settings', (r) => r.fulfill({ json: envelope(provider) }))
  await page.route('**/api/v1/service-locations**', (r) => r.fulfill({ json: envelope(PLACES) }))
  await page.route((u) => u.pathname === '/api/v1/rostering/compatibility', (r) => r.fulfill({ json: envelope(TIERS) }))
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
// Crop with the real clip; `during` lists visible fixed or sticky elements (not the element's own ancestors or its content) overlapping the clip.
const crop = async (page, locator, name, vp, pad = 16, natural = true) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, `${name}.png`), {
    pad, touch: vp.touch, natural,
    during: (clip) => locator.evaluate((el, c) => [...document.body.querySelectorAll('*')].filter((e) => {
      const cs = getComputedStyle(e)
      return ['fixed', 'sticky'].includes(cs.position) && cs.opacity !== '0' && cs.visibility !== 'hidden' && !e.contains(el) && !el.contains(e)
    }).map((e) => ({ e, r: e.getBoundingClientRect() })).filter(({ r }) => r.width > 0 && r.height > 0 && r.left < c.x + c.width && r.right > c.x && r.top < c.y + c.height && r.bottom > c.y)
      .map(({ e, r }) => `${e.tagName}.${String(e.className).split(' ')[0]} ${Math.round(r.top)}-${Math.round(r.bottom)}`), clip),
  })
  checks.push(checkCropHolds(r))
  check(`${name}: no fixed or sticky element over the crop`, (r.measured ?? []).length === 0, r.measured)
}
const full = async (page, name, vp) => { checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${name}.png`), { touch: vp.touch })).checks) }

// CT-3 and CT-4: the compact board on the participant card.
async function ctCard(vp, dark) {
  const tag = `${vp.name}${dark ? '-dark' : ''}`
  const { context, page } = await openPage(vp, { dark })
  await page.goto(`${BASE_URL}/participants/p-0001?tab=rostering`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const link = page.getByRole('link', { name: 'Open on the Compatibility page' })
  await link.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  const card = page.locator('h3', { hasText: 'Staff preferences' }).locator('xpath=../..')
  const m = await card.evaluate((el) => {
    const title = [...el.querySelectorAll('h3')].find((h) => h.textContent.trim() === 'Staff preferences')
    const tc = getComputedStyle(title)
    const adds = [...el.querySelectorAll('section[aria-labelledby^="tier-"]')].map((s) => {
      const btn = [...s.querySelectorAll('button')].find((b) => b.textContent.trim() === '+ Add')
      if (!btn) return null
      const first = s.querySelector('li') ?? s.querySelector('p')
      const range = document.createRange(); range.selectNodeContents(btn)
      const t = range.getBoundingClientRect(), b = btn.getBoundingClientRect()
      const head = s.querySelector('h3 span[id^="tier-"]'), hc = getComputedStyle(head)
      return { tier: s.getAttribute('aria-labelledby'), btnLeft: b.left, btnRight: b.right, textLeft: t.left, textRight: t.right, firstLeft: first.getBoundingClientRect().left, headSize: parseFloat(hc.fontSize), headWeight: parseInt(hc.fontWeight, 10) }
    }).filter(Boolean)
    return { titleSize: parseFloat(tc.fontSize), titleWeight: parseInt(tc.fontWeight, 10), adds }
  })
  check(`${tag}: three + Add buttons found`, m.adds.length === 3, m.adds.length)
  if (vp.name === '1280') {
    for (const a of m.adds) {
      check(`${tag}: ${a.tier} + Add button left edge within 2px of the first chip or row`, Math.abs(a.btnLeft - a.firstLeft) <= 2, { btn: a.btnLeft, first: a.firstLeft })
      check(`${tag}: ${a.tier} + Add text is left-aligned (starts within 16px of the chip edge)`, a.textLeft - a.firstLeft >= 0 && a.textLeft - a.firstLeft <= 16, { text: a.textLeft, first: a.firstLeft })
    }
  } else {
    for (const a of m.adds) {
      const l = a.textLeft - a.btnLeft, r = a.btnRight - a.textRight
      check(`${tag}: ${a.tier} + Add text stays centred, as on main (left gap = right gap +-2px)`, Math.abs(l - r) <= 2, { l, r })
    }
  }
  for (const a of m.adds) check(`${tag}: ${a.tier} heading size x weight below the card title (${a.headSize}x${a.headWeight} < ${m.titleSize}x${m.titleWeight})`, a.headSize * a.headWeight < m.titleSize * m.titleWeight, a)
  await noHScroll(page, tag)
  await crop(page, card, `ct-compact${dark ? '-dark' : ''}-${vp.name}`, vp)
  if (!dark) await full(page, `ct-full-${vp.name}`, vp)
  await context.close()
}

// LOC-1a: the Service locations cards at 390 (table at 1280 for the full page).
async function locList(vp) {
  const { context, page } = await openPage(vp)
  await page.goto(`${BASE_URL}/settings?section=locations`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Add a place' }).waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(500)
  const main = page.locator('main').first()
  if (vp.touch) {
    const m = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.mobile-card-table tbody td')].find((td) => td.querySelector('button'))
      const first = cell.querySelector('button').getBoundingClientRect()
      const caption = getComputedStyle(cell, '::before').content
      const visibleActions = [...document.querySelectorAll('.mobile-card-table *')].filter((e) => e.children.length === 0 && e.textContent.trim().toUpperCase() === 'ACTIONS' && e.getBoundingClientRect().width > 1 && !e.classList.contains('sr-only'))
      return { captionContent: caption, firstLeft: first.left, cellLeft: cell.getBoundingClientRect().left, visibleActions: visibleActions.length }
    })
    check('390: no visible ACTIONS label in a card (caption empty, none rendered)', ['""', 'none', 'normal'].includes(m.captionContent) && m.visibleActions === 0, m)
    check('390: the first action button starts at the cell edge (within 2px)', Math.abs(m.firstLeft - m.cellLeft) <= 2, m)
  }
  await noHScroll(page, `${vp.name} locations`)
  if (vp.touch) await crop(page, main, 'loc-cards-390', vp)
  await full(page, `loc-full-${vp.name}`, vp)
  await context.close()
}

// LOC-1c: the shift slide-over's Service location field is the house SearchableSelect.
async function locSelect(vp) {
  const { context, page } = await openPage(vp)
  await page.route('**/api/v1/rostering/board*', (r) => {
    const mon = new URL(r.request().url()).searchParams.get('weekStart')
    const day = (n) => { const d = new Date(`${mon}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
    const days = [0, 1, 2, 3, 4, 5, 6].map(day)
    const shift = { id: 'sh1', participantId: 'p-0001', participantName: 'Liam Okafor', staffId: 's-0001', staffName: 'Callum Radford', serviceDate: days[2], startTime: '09:00:00', endTime: '13:00:00', endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false, serviceLocationId: 'loc-1' }
    const row = { staffId: 's-0001', fullName: 'Callum Radford', role: 'SupportWorker', compliance: 'Ok', complianceNotes: [], rosteredHours: 4, targetHours: 38, shifts: [shift], tripBars: [], leave: [] }
    return r.fulfill({ json: envelope({ groupBy: 'Staff', weekStart: mon, days, staffRows: [row], unfilled: [], exceptions: [] }) })
  })
  await page.goto(`${BASE_URL}/staff/s-0001?tab=week`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const chip = page.locator('[data-shift-open]').first()
  await chip.waitFor({ state: 'visible', timeout: 60_000 })
  await chip.click()
  const dialog = page.getByRole('dialog', { name: 'Shift details' })
  await dialog.waitFor({ state: 'visible', timeout: 30_000 })
  const picker = dialog.getByLabel('Service location')
  await picker.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  const m = await picker.evaluate((el) => {
    const d = el.closest('[role=dialog]'), r = el.getBoundingClientRect()
    return { role: el.getAttribute('role'), tag: el.tagName, h: r.height, nativeSelects: d.querySelectorAll('select').length, houseClass: el.className.includes('min-h-[var(--control-h)]'), value: el.value }
  })
  check(`${vp.name}: Service location is the house combobox (role=combobox, SearchableSelect class), value shows the place`, m.role === 'combobox' && m.houseClass && m.value === 'Southside community day centre', m)
  check(`${vp.name}: no native select element in the slide-over`, m.nativeSelects === 0, m.nativeSelects)
  if (vp.touch) check('390: the select is at least 44px high', m.h >= 43.5, m.h)
  await noHScroll(page, `${vp.name} slide-over`)
  await crop(page, dialog, `loc-select-slideover-${vp.name}`, vp, 0, false)
  await context.close()
}

// PT-3: Records > History from the mock API's audit route.
async function auditHistory(vp) {
  const { context, page } = await openPage(vp)
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE_URL}/participants/p-0001?tab=records`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const tab = page.getByRole('tab', { name: 'History', exact: true })
  await tab.waitFor({ state: 'visible', timeout: 60_000 })
  await tab.click()
  await page.getByText(/events? recorded/).waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
  await page.waitForTimeout(500)
  const m = await page.evaluate(() => {
    const t = document.querySelector('main')?.innerText ?? ''
    return { entries: (t.match(/\bby (Callum Radford|Dev Admin|System)\b/g) ?? []).length, boundary: /something went wrong|unexpected error|application error/i.test(t), recorded: (t.match(/\d+ events? recorded/) ?? [''])[0] }
  })
  check(`${vp.name}: Records > History renders at least one entry (${m.recorded})`, m.entries >= 1, m)
  check(`${vp.name}: no error boundary text, no page errors`, !m.boundary && errors.length === 0, { boundary: m.boundary, errors })
  await noHScroll(page, `${vp.name} history`)
  await crop(page, page.locator('main').first(), `audit-history-${vp.name}`, vp)
  await context.close()
}

for (const vp of VPS) {
  await safe(`ct ${vp.name}`, () => ctCard(vp, false))
  await safe(`loc list ${vp.name}`, () => locList(vp))
  await safe(`loc select ${vp.name}`, () => locSelect(vp))
}
await safe('ct dark 390', () => ctCard(VPS[1], true))
await safe('audit 390', () => auditHistory(VPS[1]))
await browser.close()
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
