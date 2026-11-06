// Incident form "Common incident" picker: captures plus the numeric checks of SHAPE.md section 6 (picker moved to the top of Basics, above the Who card, by lead ruling D-4).
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to this file> <outdir>
// Computed boxes only; exits non-zero when a check fails. Runs at 390 (touch, coarse pointer) and 1280 (fine pointer), light theme.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, overlapCheck, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }) }

// The MAR hand-off the Medication page passes in router state; a reload keeps it, because the data router reads history.state.usr.
const MAR_STATE = {
  source: 'mar-administration', outcome: 'WrongMedication', participantId: 'participant-1', participantName: 'Sophie Brown',
  medicationName: 'Insulin', strength: '18 units', doseDescription: null, scheduledAt: '2026-08-01T00:30:00Z',
  administeredAt: '2026-08-01T01:00:00Z', administeredAtTimeZone: 'Australia/Brisbane', recordedByName: 'Alex Rivera',
  recordedByUserId: 'staff-1', reason: 'Grabbed the wrong blister pack', notes: 'Gave Paracetamol 500mg instead',
  tripInstanceId: null, medicationAdministrationId: 'admin-1',
}

async function open(browser, { width, height, touch }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`pageerror ${String(e.message).slice(0, 120)}`, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}

async function openForm(page) {
  await page.goto(`${BASE_URL}/incidents/new`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByLabel('Common incident').waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(600)
}

// A token value resolved to pixels (or a colour) through a probe element, so the check reads the live token under this pointer.
const token = (page, prop, value) => page.evaluate(([p, v]) => {
  const d = document.createElement('div'); d.style.position = 'absolute'; d.style[p] = v; document.body.appendChild(d)
  const out = p === 'color' ? getComputedStyle(d).color : parseFloat(getComputedStyle(d)[p]); d.remove(); return out
}, [prop, value])

const trigger = (page) => page.getByLabel('Common incident')
// The cell holding the FormField and its status line: the ancestor div that has the status paragraph as a direct child.
const cell = (page) => trigger(page).locator('xpath=ancestor::div[p[@role="status"]][1]')
const overflowOk = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)

async function pickOption(page, name) {
  await trigger(page).click()
  await page.getByRole('option', { name }).click()
  await page.waitForTimeout(300)
}

async function crop(page, tag, locator, name, opts = {}) {
  const file = path.join(OUT_DIR, `${name}.png`)
  try {
    const r = await cropElement(page, locator, file, { ...opts, during: (clip) => overlapCheck(locator, clip, `${name}.png`) })
    checks.push(checkCropHolds(r))
    if (r.measured) checks.push(r.measured)
  } catch (e) { check(`${tag}: crop ${name}`, false, String(e.message).slice(0, 160)) }
}

// Next from Basics: an Admin may need the Reporter picked, and the severity is the worker's own choice.
async function toDetails(page) {
  await page.getByRole('radio', { name: '2 Medium' }).click()
  const next = page.getByRole('button', { name: 'Next' })
  await next.click()
  if (!(await page.getByPlaceholder('Detailed description of the incident...').isVisible().catch(() => false))) {
    await page.getByLabel('Reported By *').click()
    await page.getByRole('option').first().click()
    await next.click()
  }
  await page.getByPlaceholder('Detailed description of the incident...').waitFor({ state: 'visible', timeout: 15_000 })
}

async function measureLayout(page, tag, touch, wide) {
  const m = await page.evaluate(() => {
    const trig = [...document.querySelectorAll('[aria-haspopup="listbox"]')].find((b) => document.getElementById(b.getAttribute('aria-labelledby'))?.textContent === 'Common incident')
    const c = trig.closest('div:has(> p[role=status])') // the cell
    const status = c.querySelector('p[role=status]')
    const grid = c.parentElement
    const next = grid.nextElementSibling // the Who card
    const form = trig.closest('form')
    const svc = [...document.querySelectorAll('[aria-haspopup="listbox"]')].find((b) => document.getElementById(b.getAttribute('aria-labelledby'))?.textContent === 'Service Type *')
    const r = (el) => el.getBoundingClientRect()
    const gridCs = getComputedStyle(grid)
    return {
      trig: { w: r(trig).width, h: r(trig).height }, cell: { w: r(c).width, bottom: r(c).bottom }, grid: { w: r(grid).width, bottom: r(grid).bottom, gap: parseFloat(gridCs.columnGap) || 0 },
      formW: r(form).width, nextTop: r(next).top, statusColor: getComputedStyle(status).color, statusOverflow: status.scrollWidth > status.clientWidth + 1,
      svcTop: r(svc).top, svcH: r(svc).height,
    }
  })
  const controlH = await token(page, 'height', 'var(--control-h)')
  const sectionGap = await token(page, 'height', 'var(--section-gap)')
  const muted = await token(page, 'color', 'var(--color-muted-foreground)')
  check(`${tag}: pointer is ${touch ? 'coarse' : 'fine'}`, await page.evaluate(() => matchMedia('(pointer: coarse)').matches) === touch)
  check(`${tag}: trigger height equals --control-h (${controlH})`, Math.abs(m.trig.h - controlH) <= 1, [m.trig.h, controlH])
  if (touch) check(`${tag}: trigger is the full form width`, Math.abs(m.trig.w - m.formW) <= 1, [m.trig.w, m.formW])
  else {
    const expected = m.grid.w / 2 - m.grid.gap / 2 // span.medium: 6 of 12 columns
    check(`${tag}: picker is span.medium (6 of 12 columns)`, Math.abs(m.cell.w - expected) <= 1, [m.cell.w, expected])
    check(`${tag}: Service Type starts below the picker`, m.svcTop > m.cell.bottom, [m.svcTop, m.cell.bottom])
  }
  check(`${tag}: gap from the picker cell to the Who card equals --section-gap (${sectionGap})`, Math.abs(m.nextTop - m.grid.bottom - sectionGap) <= 1, [m.nextTop - m.grid.bottom, sectionGap])
  check(`${tag}: status colour equals --color-muted-foreground`, m.statusColor === muted, [m.statusColor, muted])
  check(`${tag}: status line does not overflow its cell`, !m.statusOverflow)
  check(`${tag}: picker is focused on load`, await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup') === 'listbox' && document.getElementById(document.activeElement.getAttribute('aria-labelledby'))?.textContent === 'Common incident'))
}

const browser = await chromium.launch({ headless: true })
try {
  // ── 390, touch ───────────────────────────────────────────────────────────
  {
    const tag = '390'
    const { context, page } = await open(browser, { width: 390, height: 844, touch: true })
    await openForm(page)
    await measureLayout(page, tag, true, false)
    check(`${tag}: no page overflow (empty)`, await overflowOk(page))
    await crop(page, tag, cell(page), 'basics-empty-390', { touch: true })

    await trigger(page).click()
    await page.locator('[role=listbox]').waitFor({ state: 'visible' })
    const tapMin = await token(page, 'height', 'var(--tap-min)')
    const heights = await page.locator('[role=listbox] [role=option]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
    check(`${tag}: every option is at least --tap-min (${tapMin})`, heights.length === 12 && heights.every((h) => h >= tapMin - 0.5), heights)
    const nav = page.locator('nav[aria-label="Mobile"]')
    if (await nav.count()) {
      const pb = await page.locator('[role=listbox]').evaluate((e) => e.getBoundingClientRect().bottom)
      const nt = await nav.first().evaluate((e) => e.getBoundingClientRect().top)
      check(`${tag}: open panel ends above the mobile nav`, pb <= nt + 0.5, [pb, nt])
    } else check(`${tag}: mobile nav present`, false, 'nav[aria-label="Mobile"] not found')
    check(`${tag}: no page overflow (open)`, await overflowOk(page))
    await crop(page, tag, page.locator('[role=listbox]'), 'picker-open-390', { touch: true, also: trigger(page), pad: 12 })

    await page.getByRole('option', { name: /Fell and was hurt/ }).click()
    await page.waitForTimeout(300)
    check(`${tag}: no page overflow (chosen)`, await overflowOk(page))
    check(`${tag}: status says what filled`, (await cell(page).locator('p[role=status]').textContent()) === 'Filled in the title, type and description prompts.')
    await crop(page, tag, cell(page), 'picked-fall-390', { touch: true })

    await toDetails(page)
    const desc = page.getByPlaceholder('Detailed description of the incident...')
    const descField = desc.locator('xpath=ancestor::div[label][1]')
    check(`${tag}: Description holds the prompts and the hint shows`, (await desc.inputValue()).startsWith('Where they fell') && (await descField.textContent()).includes("Write under each prompt. Delete any that don't fit."))
    await crop(page, tag, descField, 'details-prompts-390', { touch: true })
    await page.getByRole('button', { name: 'Next' }).click()
    await page.getByText('Write what happened under the prompts.').waitFor({ state: 'visible', timeout: 10_000 })
    await crop(page, tag, descField, 'details-untouched-error-390', { touch: true })
    await context.close()
  }

  // ── 1280, fine pointer ───────────────────────────────────────────────────
  {
    const tag = '1280'
    const { context, page } = await open(browser, { width: 1280, height: 900, touch: false })
    await openForm(page)
    await measureLayout(page, tag, false, true)
    check(`${tag}: no page overflow (empty)`, await overflowOk(page))

    // A title typed first survives the pick.
    await page.getByPlaceholder('Brief incident summary').fill('Kitchen fall this morning')
    await pickOption(page, /Fell and was hurt/)
    check(`${tag}: typed title kept`, (await page.getByPlaceholder('Brief incident summary').inputValue()) === 'Kitchen fall this morning')
    check(`${tag}: status says what was kept`, (await cell(page).locator('p[role=status]').textContent()) === 'Filled in the type and description prompts. Kept what was already there.')
    await crop(page, tag, page.locator('form'), 'picked-kept-title-1280', { touch: false, pad: 16 })

    // A fresh form, picked: all three filled.
    await openForm(page)
    await pickOption(page, /Fell and was hurt/)
    check(`${tag}: title filled`, (await page.getByPlaceholder('Brief incident summary').inputValue()) === 'Fell and was hurt')
    check(`${tag}: no page overflow (chosen)`, await overflowOk(page))
    await measureLayout(page, `${tag} chosen`, false, true)
    await crop(page, tag, page.locator('form'), 'basics-picked-1280', { touch: false, pad: 16 })

    // The MAR hand-off keeps what it brought.
    await page.evaluate((usr) => history.replaceState({ usr, key: 'default', idx: 0 }, '', '/incidents/new'), MAR_STATE)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await trigger(page).waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(600)
    const marTitle = await page.getByPlaceholder('Brief incident summary').inputValue()
    await pickOption(page, /Had a seizure/)
    check(`${tag}: MAR title kept`, marTitle.includes('Insulin') && (await page.getByPlaceholder('Brief incident summary').inputValue()) === marTitle, marTitle)
    check(`${tag}: MAR status says nothing changed`, (await cell(page).locator('p[role=status]').textContent()) === 'Nothing changed. Kept what was already there.')
    await crop(page, tag, page.locator('form'), 'mar-prefill-picked-1280', { touch: false, pad: 16 })
    await context.close()
  }
} finally {
  await browser.close()
}

const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
