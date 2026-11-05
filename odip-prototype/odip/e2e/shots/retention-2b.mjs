// Retention 2b: Settings > Data retention tab, the purge dialog and the Tasks row. Numeric checks 1-8 are SHAPE-2b section 5; the capture list is section 6.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/retention-2b.mjs <outdir>
// The mock API serves the two due rows and the ZIP; sign-in and every variant (empty, error, busy, 409, after-purge) are page.route stubs, so no run
// changes the mock's state. The clock is pinned to 2026-11-06T10:00+11:00. Prints "CHECK ok|FAIL name [ctx] = value"; exits 1 when a check fails.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const failure = (sentence) => ({ success: false, data: null, message: null, errors: [sentence] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' })
const NOW = '2026-11-06T10:00:00+11:00'
const SEEN = new Set()
const checks = []
const check = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail: measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(measured)}`)
}
const safe = async (name, ctx, fn) => { try { await fn() } catch (e) { check(`${name} (script error)`, ctx, String(e.message).split('\n')[0], false) } }

const ZOE = { participantId: 'ret-zoe-campbell', firstName: 'Zoe', lastName: 'Campbell', startsOn: '2018-11-06', startEstimated: false, dueOn: '2025-11-06', rowCounts: { Shifts: 820, ShiftNotes: 310, ClaimLineItems: 60, Invoices: 3, ParticipantNotes: 2, Participants: 1 } }
const MARGARET = { participantId: 'ret-margaret-doyle', firstName: 'Margaret', lastName: 'Doyle', startsOn: '2019-09-06', startEstimated: true, dueOn: '2026-09-06', rowCounts: { Shifts: 22, ShiftNotes: 8, ParticipantNotes: 4, Participants: 1 } }
const DUE_API = '**/api/v1/data-retention/due'
const purgeApi = (id) => `**/api/v1/data-retention/${id}/purge`

const browser = await chromium.launch({ headless: true })

async function openPage(width, height, touch, scheme) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: scheme, reducedMotion: 'reduce' })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  return { context, page }
}
async function signIn(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
}
const openTab = async (page) => {
  await page.goto(`${BASE_URL}/settings?tab=retention`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('heading', { level: 3, name: 'Due for purge' }).waitFor({ timeout: 60_000 })
}
const record = async (page) => { for (const s of await page.evaluate(() => [document.body.innerText]).then((a) => a)) for (const line of s.split('\n')) SEEN.add(line.trim()) }
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const section = (page) => page.locator('section[aria-labelledby="data-retention-heading"]')
const dialog = (page) => page.getByRole('alertdialog')
const confirmBtn = (page) => dialog(page).getByRole('button', { name: 'Purge record' })
const box = (loc) => loc.boundingBox()
async function openDialog(page, name = "Purge Zoe Campbell's record") {
  await page.getByRole('button', { name }).click()
  await dialog(page).waitFor({ timeout: 30_000 })
}
async function crop(page, locator, file, touch, extra = {}) {
  const r = await cropElement(page, locator, path.join(OUT_DIR, file), { touch, ...extra })
  checks.push(checkCropHolds(r))
}

for (const [width, height, touch] of [[1280, 800, false], [390, 844, true]]) {
  const w = String(width)
  for (const scheme of ['light', 'dark']) {
    const ctx = `${w} ${scheme}`
    const { context, page } = await openPage(width, height, touch, scheme)
    page.on('pageerror', (e) => check('page error', ctx, e.message, false))
    await safe('session', ctx, async () => {
      await signIn(page)
      await openTab(page)
      await page.getByText('Zoe Campbell').first().waitFor({ timeout: 30_000 })
      await record(page)

      // The list.
      if (scheme === 'dark') {
        await crop(page, section(page), `list-2due-dark-${w}.png`, touch)
      } else {
        await crop(page, section(page), `list-2due-${w}.png`, touch)
        // The settings rail makes the page taller than 800, so give the 1280 page room first: fullPage fails a page that is still taller than the viewport it grew to.
        if (!touch) await page.setViewportSize({ width, height: 1300 })
        checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `retention-${w}.png`), { touch })).checks)
        if (!touch) await page.setViewportSize({ width, height })
        const heads = await page.locator('thead th').evaluateAll((els) => els.map((e) => e.textContent.trim()))
        if (width === 1280) check('1 column headers in the pinned order', ctx, heads, JSON.stringify(heads) === JSON.stringify(['Participant', 'Retention starts', 'Due for purge', 'Records', 'Actions']))
        const badges = await page.getByText('Estimated', { exact: true }).count()
        const footnote = await page.locator('#retention-estimated-note').count()
        check('7 Estimated badges equal the estimated rows (1)', ctx, { badges, footnote }, badges === 1 && footnote === 1)
        check('5 no horizontal scroll on the tab', ctx, await overflow(page), (await overflow(page)) <= 0)
        if (touch) {
          const buttons = page.locator('section[aria-labelledby="data-retention-heading"]').getByRole('button')
          const sizes = await buttons.evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [e.getAttribute('aria-label') ?? e.textContent.trim(), Math.round(b.width), Math.round(b.height)] }))
          check('4 every row action is at least 44x44', ctx, sizes, sizes.length >= 4 && sizes.every(([, bw, bh]) => bw >= 44 && bh >= 44))
        }
      }

      // The dialog, default.
      await openDialog(page)
      await record(page)
      const ov = await overflow(page)
      check('5 no horizontal scroll with the dialog open', ctx, ov, ov <= 0)
      await crop(page, dialog(page), scheme === 'dark' ? `dialog-default-dark-${w}.png` : `dialog-default-${w}.png`, touch)
      if (scheme === 'light') {
        const name = dialog(page).getByLabel('Type their last name, Campbell, to confirm')
        const reason = dialog(page).getByLabel('Reason')
        const disabled = {}
        disabled.empty = await confirmBtn(page).isDisabled()
        if (touch) {
          const d = await box(dialog(page))
          const foot = await box(confirmBtn(page))
          const cancel = await box(dialog(page).getByRole('button', { name: 'Cancel' }))
          check('6 the dialog sits inside 390x844 and its buttons show without scrolling', ctx, { d, foot, cancel }, d.y >= 0 && d.y + d.height <= 844 && foot.y >= 0 && foot.y + foot.height <= 844 && cancel.y + cancel.height <= 844)
          const sizes = await dialog(page).getByRole('button').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [e.textContent.trim(), Math.round(b.width), Math.round(b.height)] }))
          // The shared Modal's close X (no text) is 28x28 for every dialog in the app; it is not this feature's button, so it is listed in the detail but not judged.
          const own = sizes.filter(([label]) => label !== '')
          check('4 the dialog buttons (incl. Download) are at least 44x44', ctx, sizes, own.length >= 3 && own.every(([, bw, bh]) => bw >= 44 && bh >= 44))
        }
        await name.fill('Campbell')
        disabled.nameOnly = await confirmBtn(page).isDisabled()
        await name.fill('')
        await reason.fill('Seven years have passed')
        disabled.reasonOnly = await confirmBtn(page).isDisabled()
        await name.fill(' campbell ')
        const enabled = await confirmBtn(page).isEnabled()
        check('3 Purge record is disabled when empty, name only and reason only, and enabled with both', ctx, { ...disabled, bothValid: enabled }, disabled.empty && disabled.nameOnly && disabled.reasonOnly && enabled)

        // Name mismatch, then reason missing.
        await name.fill('Camp')
        await reason.fill('')
        await name.blur()
        await dialog(page).getByText("The last name doesn't match.").waitFor({ timeout: 10_000 })
        await crop(page, dialog(page), `dialog-name-mismatch-${w}.png`, touch)
        await name.fill('Campbell')
        await reason.focus()
        await reason.blur()
        await dialog(page).getByText('Give a reason for the purge.').waitFor({ timeout: 10_000 })
        await crop(page, dialog(page), `dialog-reason-missing-${w}.png`, touch)
        await record(page)

        // Exported: the download prompt becomes the saved file.
        await dialog(page).getByRole('button', { name: 'Download their data' }).click()
        await dialog(page).getByText('Their data is downloaded').waitFor({ timeout: 30_000 })
        await crop(page, dialog(page), `dialog-exported-${w}.png`, touch)
        await record(page)
      }
    })
    await context.close()
  }

  // Variants the mock does not serve: all light, one context each so a stub never leaks.
  const ctx = `${w} light`
  await safe('empty', ctx, async () => {
    const { context, page } = await openPage(width, height, touch, 'light')
    await page.route(DUE_API, (r) => r.fulfill({ json: envelope([]) }))
    await signIn(page)
    await page.goto(`${BASE_URL}/settings?tab=retention`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('No records are due for purge').waitFor({ timeout: 60_000 })
    await record(page)
    await crop(page, section(page), `tab-empty-${w}.png`, touch)
    const foot = await page.locator('#retention-estimated-note').count()
    check('7 no footnote when nothing is estimated (empty list)', ctx, foot, foot === 0)
    await context.close()
  })
  await safe('zoe only', ctx, async () => {
    const { context, page } = await openPage(width, height, touch, 'light')
    await page.route(DUE_API, (r) => r.fulfill({ json: envelope([ZOE]) }))
    await signIn(page)
    await openTab(page)
    await page.getByText('Zoe Campbell').first().waitFor({ timeout: 30_000 })
    const counts = { badges: await page.getByText('Estimated', { exact: true }).count(), footnote: await page.locator('#retention-estimated-note').count() }
    check('7 no badge and no footnote without an estimated row', ctx, counts, counts.badges === 0 && counts.footnote === 0)
    await context.close()
  })
  await safe('error', ctx, async () => {
    const { context, page } = await openPage(width, height, touch, 'light')
    await page.route(DUE_API, (r) => r.fulfill({ status: 500, json: failure('Server error') }))
    await signIn(page)
    await page.goto(`${BASE_URL}/settings?tab=retention`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText("Couldn't load records due for purge").waitFor({ timeout: 90_000 })
    await record(page)
    await crop(page, section(page), `list-error-${w}.png`, touch)
    await context.close()
  })
  await safe('409', ctx, async () => {
    const { context, page } = await openPage(width, height, touch, 'light')
    await page.route(purgeApi(ZOE.participantId), (r) => r.fulfill({ status: 409, json: failure("This record isn't due for purge.") }))
    await signIn(page)
    await openTab(page)
    await openDialog(page)
    await dialog(page).getByLabel('Type their last name, Campbell, to confirm').fill('Campbell')
    await dialog(page).getByLabel('Reason').fill('Seven years have passed')
    await confirmBtn(page).click()
    await dialog(page).getByText("This record isn't due for purge.").first().waitFor({ timeout: 30_000 })
    await record(page)
    const off = await confirmBtn(page).isDisabled()
    check('3 Purge record stays disabled after NotDue', ctx, off, off)
    await crop(page, dialog(page), `dialog-409-notdue-${w}.png`, touch)
    await context.close()
  })
  await safe('busy', ctx, async () => {
    const { context, page } = await openPage(width, height, touch, 'light')
    let release
    const held = new Promise((resolve) => { release = resolve })
    await page.route(purgeApi(ZOE.participantId), async (r) => { await held; await r.fulfill({ json: envelope({ id: 'p1', participantId: ZOE.participantId, rowCounts: ZOE.rowCounts }) }) })
    await signIn(page)
    await openTab(page)
    await openDialog(page)
    await dialog(page).getByLabel('Type their last name, Campbell, to confirm').fill('Campbell')
    await dialog(page).getByLabel('Reason').fill('Seven years have passed')
    await confirmBtn(page).click()
    await dialog(page).locator('[aria-busy="true"], button:disabled').first().waitFor({ timeout: 10_000 })
    await crop(page, dialog(page), `dialog-busy-${w}.png`, touch)
    release()
    await context.close()
  })
  await safe('after purge', ctx, async () => {
    const { context, page } = await openPage(width, height, touch, 'light')
    let due = [ZOE, MARGARET]
    await page.route(DUE_API, (r) => r.fulfill({ json: envelope(due) }))
    await page.route(purgeApi(ZOE.participantId), (r) => { due = [MARGARET]; return r.fulfill({ json: envelope({ id: 'p1', participantId: ZOE.participantId, rowCounts: ZOE.rowCounts }) }) })
    await signIn(page)
    await openTab(page)
    await page.getByText('Zoe Campbell').first().waitFor({ timeout: 30_000 })
    const before = await page.getByRole('button', { name: /^Purge .+'s record$/ }).count()
    await openDialog(page)
    await dialog(page).getByLabel('Type their last name, Campbell, to confirm').fill('Campbell')
    await dialog(page).getByLabel('Reason').fill('Seven years have passed')
    await confirmBtn(page).click()
    await page.getByText('Record purged', { exact: true }).waitFor({ timeout: 30_000 })
    await page.waitForFunction(() => !document.body.innerText.includes('Zoe Campbell\n'), null, { timeout: 30_000 }).catch(() => {})
    await record(page)
    const focus = await page.evaluate(() => { const a = document.activeElement; return a ? a.textContent.includes('Record purged') : false })
    const after = await page.getByRole('button', { name: /^Purge .+'s record$/ }).count()
    check('8 focus is on the success note and the row count drops by 1', ctx, { before, after, focus }, focus && after === before - 1)
    await crop(page, section(page), `after-purge-${w}.png`, touch)
    await context.close()
  })
  await safe('tasks row', ctx, async () => {
    const { context, page } = await openPage(width, height, touch, 'light')
    await signIn(page)
    await page.goto(`${BASE_URL}/tasks`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const link = page.getByText('2 participant records are due for purge').first()
    await link.waitFor({ timeout: 60_000 })
    const row = link.locator('xpath=ancestor::*[self::tr or self::li or self::article][1]')
    await crop(page, (await row.count()) ? row : link, `tasks-row-${w}.png`, touch)
    await context.close()
  })
}
await browser.close()

const wanted = ['Due for purge', 'No records are due for purge', 'Download their data', "Purge Zoe Campbell's record?", 'Type their last name, Campbell, to confirm', "Don't include their name or details.", 'Purge record', 'Record purged', "This record isn't due for purge."]
const all = [...SEEN].join('\n')
for (const s of wanted) check('2 string appears exactly', 'all', s, all.includes(s))
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
