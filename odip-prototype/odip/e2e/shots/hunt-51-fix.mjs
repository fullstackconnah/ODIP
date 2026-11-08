// Captures and numeric checks for the stale medication-chart and staff-profile saves (H51-2, H51-3): the edit page keeps the typed values and shows the server's 409 sentence in its error callout.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Medication m-0001 is served here (the mock has no medication detail); staff s-0001 comes from the mock with an updatedAt added. Each PUT is routed to a 409 with the server's exact message.
import path from 'node:path'
import { AU_CONTEXT, cropElement, fullPage, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const UPDATED_AT = '2026-11-01T03:04:05.123456Z'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator' })
const medication = {
  id: 'm-0001', participantId: 'p-0001', participantName: 'Liam Okafor', name: 'Levetiracetam', strength: '500mg',
  form: 'Tablet', route: 'Oral', doseDescription: '1 tablet', type: 'Regular',
  timesOfDay: '08:00', frequency: 'Daily', daysOfWeek: [], intervalDays: null,
  anchorDate: null, status: 'Active', isHighRisk: false, isPsychotropic: false,
  isChemicalRestraint: false, drugSchedule: 'Unscheduled', supportLevel: 'SelfAdministered',
  packaging: 'OriginalPackaging', startDate: '2026-01-01', endDate: null, nextReviewDue: null,
  complianceFlags: [], directions: null, prnIndication: null, prnMaxDosesPer24h: null,
  prnMinIntervalMinutes: null, purpose: null, bspInPlace: false,
  restrictivePracticeAuthorisationRef: null, isHighIntensitySupport: false, prescriberName: null,
  pharmacyName: null, pharmacyPhone: null, consentObtained: false,
  consentGivenBy: null, consentDate: null,
  storageRequirements: null, notes: null, prnDosesInLast24h: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: UPDATED_AT,
}
const FORMS = [
  {
    key: 'medication', url: '/medications/m-0001/edit', put: /\/api\/v1\/medications\/m-0001$/, nameField: /^Name/i,
    message: 'Someone else just changed this medicine. Reload the page to see their changes, then save again.',
    getRoute: (r) => r.fulfill({ json: envelope(medication) }),
  },
  {
    key: 'staff', url: '/staff/s-0001/edit', put: /\/api\/v1\/staff\/s-0001$/, nameField: /First Name/,
    message: 'Someone else just changed this staff member. Reload the page to see their changes, then save again.',
    getRoute: async (r) => {
      const res = await r.fetch()
      const body = await res.json()
      return r.fulfill({ response: res, json: { ...body, data: { ...body.data, updatedAt: UPDATED_AT } } })
    },
  },
]
const STATES = [{ name: '390', width: 390 }, { name: '1280', width: 1280 }]
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

const browser = await chromium.launch({ headless: true })
try {
  for (const f of FORMS) for (const st of STATES) {
    const tag = `${f.key} ${st.name}`
    const mobile = st.width === 390
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: mobile ? 844 : 800 }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
    page.on('pageerror', (e) => add(`page error [${tag}]`, e.message, false))
    let putBody = null
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.route(f.put, (r) => {
      if (r.request().method() === 'GET') return f.getRoute(r)
      if (r.request().method() !== 'PUT') return r.fallback()
      putBody = r.request().postDataJSON()
      return r.fulfill({ status: 409, json: { success: false, data: null, message: null, errors: [f.message] } })
    })
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    await page.goto(`${BASE_URL}${f.url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const form = page.locator('form').first()
    await form.waitFor({ timeout: 60_000 })
    const nameBox = form.getByLabel(f.nameField).first()
    const keep = await nameBox.inputValue()
    await nameBox.fill('Typed name')

    // The form's existing error text: a field error from an invalid submit (name cleared), measured before the 409 (the typed name is put back after).
    await nameBox.fill('')
    await form.getByRole('button', { name: /^Save$/ }).click()
    const fieldError = await page.evaluate(() => {
      const el = document.querySelector('[aria-invalid="true"]')
      const id = el?.getAttribute('aria-describedby')?.split(' ').find((i) => document.getElementById(i)?.textContent?.trim())
      const t = id && document.getElementById(id)
      return t ? { text: t.textContent.trim(), fontSize: getComputedStyle(t).fontSize } : null
    })
    await nameBox.fill('Typed name')

    const wrap = form.locator('xpath=..')
    const crop = async (file) => {
      const r = await cropElement(page, wrap, path.join(OUT_DIR, file), { hideChrome: true })
      add(r.overlap ? `crop holds the whole form area [${file}]` : `crop [${file}]`, { clip: r.clip, box: r.box }, r.overlap?.pass ?? true)
    }
    await crop(`${f.key}-normal-${st.name}.png`)

    await form.getByRole('button', { name: /^Save$/ }).click()
    const callout = wrap.locator('[role="alert"]', { hasText: f.message })
    await callout.waitFor({ timeout: 30_000 })
    add(`PUT carried expectedUpdatedAt [${tag}]`, putBody?.expectedUpdatedAt, putBody?.expectedUpdatedAt === UPDATED_AT)
    await callout.scrollIntoViewIfNeeded()
    const inView = await callout.evaluate((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth })
    add(`409 message visible inside the form area [${tag}]`, await callout.allTextContents(), (await callout.count()) === 1 && inView)
    add(`form keeps the typed value [${tag}]`, { was: keep, now: await nameBox.inputValue() }, (await nameBox.inputValue()) === 'Typed name')
    add(`Save button still enabled after the 409 [${tag}]`, null, await form.getByRole('button', { name: /^Save$/ }).isEnabled())
    const overflow = await form.evaluate((d) => ({ scrollWidth: d.scrollWidth, clientWidth: d.clientWidth }))
    add(`no horizontal overflow in the form [${tag}]`, overflow, overflow.scrollWidth <= overflow.clientWidth)
    const calloutFont = await callout.evaluate((e) => getComputedStyle(e.querySelector('p, span, div') ?? e).fontSize)
    add(`message font size equals the form's existing error text [${tag}]`, { calloutFont, fieldError }, !!fieldError && calloutFont === fieldError.fontSize)
    await crop(`${f.key}-stale-${st.name}.png`)
    const fp = await fullPage(page, path.join(OUT_DIR, 'full', `${f.key}-stale-${st.name}.png`))
    for (const c of fp.checks) add(c.name, c.detail, c.pass)
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
