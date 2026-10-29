// Captures and numeric checks for restraint medicines on the restrictive practice register (M16 fix 2). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/rp-med-link.mjs <outdir>
// The register entries and the medicine come from page.route stubs. Exits non-zero when a check fails; every measured value is
// printed as "CHECK ok|FAIL name = value", and measure.txt in OUT_DIR holds the same lines.
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
const devLogin = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: '00000000-0000-0000-0000-0000000000b1' })

const PID = 'p-0001'
const entry = (o) => ({
  id: 'rp', participantId: PID, type: 'ChemicalRestraint', description: '', authorisedBy: null, authorisationDate: null, reviewDate: null,
  relatedMedicationId: 'med-1', relatedMedicationName: 'Risperidone 1mg', relatedMedicationStatus: 'Active', requiresReporting: true,
  isActive: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o,
})
const ENTRIES = [
  entry({ id: 'rp-a', description: 'Risperidone given when agitation is not settling.' }),
  entry({ id: 'rp-b', description: 'Quetiapine at night after escalation.', relatedMedicationId: 'med-2', relatedMedicationName: 'Quetiapine 25mg', isActive: false }),
  entry({ id: 'rp-c', description: 'Olanzapine, since stopped.', relatedMedicationId: 'med-3', relatedMedicationName: 'Olanzapine 5mg', relatedMedicationStatus: 'Ceased', isActive: false }),
]
const MEDICINE = {
  id: 'med-1', participantId: PID, name: 'Risperidone', strength: '1mg', form: 'Tablet', route: 'Oral', doseDescription: '1 tablet', type: 'Regular',
  timesOfDay: '08:00', frequency: 'Daily', daysOfWeek: [], intervalDays: null, anchorDate: null, status: 'Active', isHighRisk: false, isPsychotropic: true,
  isChemicalRestraint: true, drugSchedule: 'Unscheduled', supportLevel: 'SelfAdministered', packaging: 'OriginalPackaging', startDate: '2026-01-01', endDate: null,
  nextReviewDue: null, complianceFlags: [], directions: null, prnIndication: null, prnMaxDosesPer24h: null, prnMinIntervalMinutes: null, purpose: 'Agitation',
  bspInPlace: false, restrictivePracticeAuthorisationRef: null, isHighIntensitySupport: false, prescriberName: null, pharmacyName: null, pharmacyPhone: null,
  consentObtained: true, consentGivenBy: null, consentDate: null, storageRequirements: null, notes: null, prnDosesInLast24h: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  linkedRestrictivePractice: entry({ id: 'rp-a', requiresReporting: null }),
}

const lines = []
let failed = false
const check = (name, value, ok) => { if (!ok) failed = true; const l = `CHECK ${ok ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(value)}`; lines.push(l); console.log(l) }
const settled = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})

// WCAG contrast of every text leaf in `root`, against the backgrounds stacked behind it (alpha-blended, colour spaces normalised through a canvas).
const contrastOf = (root) => root.evaluate((panel) => {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const rgba = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) }
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const out = []
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!n.textContent.trim() || seen.has(el)) continue
    seen.add(el)
    const chain = []
    for (let e = el; e; e = e.parentElement) chain.unshift(rgba(getComputedStyle(e).backgroundColor))
    const bg = chain.reduce((under, c) => over(c, under), [255, 255, 255, 1])
    const fg = over(rgba(getComputedStyle(el).color), bg)
    const [a, b] = [lum(fg), lum(bg)]
    out.push({ text: n.textContent.trim().slice(0, 48), ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2) })
  }
  return out
})

const browser = await chromium.launch({ headless: true })
async function session(vp, colorScheme) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney', reducedMotion: 'reduce', colorScheme })
  const page = await context.newPage()
  // The touch emulation alone left `pointer: coarse` false on the first page of a run; pin it so the 44px density tokens apply.
  const cdp = vp.mobile ? await context.newCDPSession(page) : null
  await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  page.on('pageerror', (e) => check(`${vp.name} page error`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route(new RegExp(`/api/v1/participants/${PID}/restrictive-practices(\\?.*)?$`), (r) => r.fulfill({ json: envelope(ENTRIES) }))
  await page.route(new RegExp(`/api/v1/participants/${PID}/medications(\\?.*)?$`), (r) => r.fulfill({ json: envelope([]) }))
  await page.route(/\/api\/v1\/medications\/med-1(\?.*)?$/, (r) => r.fulfill({ json: envelope(MEDICINE) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  // A padded crop of a locator, kept inside the viewport.
  const shoot = async (loc, state) => {
    await settled(page)
    const b = await loc.boundingBox()
    const x = Math.max(0, b.x - 24); const y = Math.max(0, b.y - 24)
    await page.screenshot({ path: path.join(OUT_DIR, `${state}.png`), clip: { x, y, width: Math.min(vp.width - x, b.width + 48), height: Math.min(vp.height - y, b.height + 48) } })
  }
  const openRegister = async () => {
    await page.goto(`${BASE_URL}/participants/${PID}?tab=restrictive-practices`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(ENTRIES[0].description).waitFor({ timeout: 60_000 })
    await settled(page)
  }
  return { context, page, shoot, openRegister }
}

try {
  // Register card chip, then the modal states (phone only for the modal), light.
  for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844, mobile: true }]) {
    const { context, page, shoot, openRegister } = await session(vp, 'light')
    await openRegister()
    const chip = page.getByText('Report to NDIS Commission').first()
    const m = await chip.evaluate((el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight), svg: !!el.querySelector('svg') }))
    check(`${vp.name} chip on one line (height ${m.h} <= 1.5 x line-height ${m.lh})`, m, m.h <= 1.5 * m.lh)
    check(`${vp.name} chip carries the warning icon`, m.svg, m.svg)
    await shoot(chip.locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]"), `${vp.name}-register-card-report`)
    await page.screenshot({ path: path.join(OUT_DIR, `${vp.name}-register-full.png`), fullPage: true })

    if (vp.mobile) {
      const card = (text) => page.getByText(text).locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
      const dialog = page.getByRole('dialog', { name: 'Edit restrictive practice entry' })
      const active = () => dialog.getByRole('checkbox', { name: /^active/i })
      const above = async (state) => {
        await settled(page)
        const c = await dialog.locator('.scroll-mb-24').boundingBox()
        const f = await dialog.locator('div.sticky.bottom-0').boundingBox()
        check(`phone ${state} Callout bottom ${c.y + c.height} <= footer top ${f.y}`, { callout: c.y + c.height, footer: f.y }, c.y + c.height <= f.y + 0.5)
        await shoot(dialog, `phone-modal-${state}`)
      }
      await card(ENTRIES[0].description).getByRole('button', { name: 'Edit' }).click()
      await dialog.waitFor()
      await active().click()
      await above('deactivating')

      await openRegister()
      await page.getByRole('button', { name: /^Inactive/ }).click()
      await card(ENTRIES[1].description).getByRole('button', { name: 'Edit' }).click()
      await dialog.waitFor()
      await active().click()
      await above('reactivating')

      await openRegister()
      await page.getByRole('button', { name: /^Inactive/ }).click()
      await card(ENTRIES[2].description).getByRole('button', { name: 'Edit' }).click()
      await dialog.waitFor()
      const locked = await active().isDisabled()
      check('phone ceased entry: Active is locked', locked, locked)
      await shoot(dialog, 'phone-modal-ceased-locked')
    }
    await context.close()
  }

  // The medicine form's Chemical restraint panel at 390, both themes, with contrast.
  for (const scheme of ['light', 'dark']) {
    const { context, page, shoot } = await session({ name: 'phone', width: 390, height: 844, mobile: true }, scheme)
    await page.goto(`${BASE_URL}/medications/med-1/edit`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const panel = page.locator('[class*="bg-[var(--color-warning-container)]/40"]')
    await panel.waitFor({ timeout: 60_000 })
    await settled(page)
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    check(`${scheme} theme applied`, theme, theme === scheme)
    const ratios = await contrastOf(panel)
    for (const r of ratios) check(`${scheme} contrast ${r.text}`, r.ratio, r.ratio >= 4.5)
    await panel.scrollIntoViewIfNeeded()
    await shoot(panel, `phone-form-ticked-unauthorised-${scheme}`)
    if (scheme === 'light') await page.screenshot({ path: path.join(OUT_DIR, 'phone-form-full.png'), fullPage: true })
    await context.close()
  }
} finally {
  writeFileSync(path.join(OUT_DIR, 'measure.txt'), lines.join('\n') + '\n')
  await browser.close()
}
process.exit(failed ? 1 : 0)
