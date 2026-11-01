// Captures and numeric checks for the claim run modal on the Claims hub (shift billing PR1, PLAN "Numeric checks" 1-11). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/shift-claim-run.mjs <outdir>
// The mock API serves the fixture (mock-api/server.js, shiftClaimRun): a From in 2020 is the empty answer, a From in 2021 is "everything left out". Other states
// (loading, running, error, budget warning) are made by page.route. Prints "CHECK ok|FAIL name [ctx] = value", writes checks.json, exits non-zero when a check fails.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const BUDGET = { participants: [{ participantId: 'p-sam', participantName: 'Sam Lee', rows: [{ placement: 'Pool', poolName: 'Core supports', periodStart: '2026-07-01', periodEnd: '2027-06-30', available: 5000, usedBefore: 4800, thisClaim: 612.4, usedAfter: 5412.4, leftAfter: -412.4, statusAfter: 'Over' }] }] }
const LONG = 'Wolfeschlegelsteinhausenbergerdorff Alexandra'

const checks = []
const record = (name, ctx, measured, pass) => {
  checks.push({ name: `${name} [${ctx}]`, pass: !!pass, detail: JSON.stringify(measured) })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${ctx}] = ${JSON.stringify(measured)}`)
}

const VIEWPORTS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })

try {
  for (const vp of VIEWPORTS) for (const scheme of ['light', 'dark']) {
    const ctx = `${vp.name} ${scheme}`
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: scheme, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', r => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', r => r.fulfill({ json: devLogin }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 60_000 })
    // An empty hub behind the modal: the mock's long Ready list would make the 390 full page taller than the capture helper can hold, and the hub is not what is under test.
    await page.route('**/api/v1/claim-hub/lines', r => r.fulfill({ json: envelope({ ready: [], rejected: [], managed: [] }) }))
    await page.goto(`${BASE_URL}/claims`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Claim shifts' }).waitFor({ timeout: 60_000 })
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

    const dialog = page.getByRole('dialog')
    const tag = (state) => path.join(OUT_DIR, `${state}-${vp.name}-${scheme}.png`)
    const shoot = async (state) => checks.push(checkCropHolds(await cropElement(page, dialog, tag(state), { touch: vp.touch })))
    const noOverflow = async (state) => {
      const sw = await page.evaluate(() => document.documentElement.scrollWidth)
      record('1 no horizontal scroll', `${ctx} ${state}`, sw, sw <= vp.width)
    }
    const height = async (locator, name, state) => {
      const box = await locator.boundingBox()
      record(`2 ${name} tap height >= 44`, `${ctx} ${state}`, box?.height, vp.touch ? (box?.height ?? 0) >= 44 : true)
    }
    const openRun = async () => { await page.getByRole('button', { name: 'Claim shifts' }).click(); await dialog.waitFor() }
    const close = async () => { await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }) }
    const setDates = async (from) => { await dialog.getByLabel('From').fill(from); await dialog.getByRole('button', { name: 'Update preview' }).click() }
    const make = dialog.getByRole('button', { name: /^Make \d+ claims?$/ })

    // The hub itself: the button beside "How claiming works".
    await noOverflow('hub')
    await height(page.getByRole('button', { name: 'Claim shifts' }), 'Claim shifts', 'hub')
    await height(page.getByRole('button', { name: 'How claiming works' }), 'How claiming works', 'hub')
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `hub-${vp.name}-${scheme}.png`), { touch: vp.touch })).checks)

    // Loading: hold the first preview.
    let release
    const held = new Promise(res => { release = res })
    await page.route('**/api/v1/claims/from-shifts/preview', async route => { await held; await route.continue() }, { times: 1 })
    await page.getByRole('button', { name: 'Claim shifts' }).click()
    await dialog.getByRole('status').filter({ hasText: 'Finding completed shifts' }).waitFor()
    await shoot('loading')
    release()
    await make.waitFor()
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})

    // Preview
    await shoot('preview')
    await noOverflow('preview')
    await height(make, 'Make', 'preview')
    await height(dialog.getByRole('button', { name: 'Close' }).last(), 'Close', 'preview')
    const from = dialog.getByLabel('From'), to = dialog.getByLabel('To')
    const [fb, tb] = [await from.boundingBox(), await to.boundingBox()]
    if (vp.touch) record('3 To is stacked under From, both >= 44 tall', ctx, { fromBottom: fb.y + fb.height, toTop: tb.y, fromH: fb.height, toH: tb.height }, tb.y >= fb.y + fb.height && fb.height >= 44 && tb.height >= 44)
    else record('3 From and To side by side', ctx, { fromTop: fb.y, toTop: tb.y }, Math.abs(fb.y - tb.y) < 1)
    const total = await dialog.locator('span.text-xl').first().evaluate(el => el.getClientRects().length)
    record('4 summary total on one line', `${ctx} preview`, total, total === 1)
    const makeLines = await make.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length })
    record('5 "Make 2 claims" on one line', ctx, makeLines, makeLines === 1)
    if (!vp.touch) {
      const heads = await dialog.getByRole('columnheader').allInnerTexts()
      record('6 preview table headers', ctx, heads, JSON.stringify(heads.map(h => h.trim())) === JSON.stringify(['Participant', 'Shifts', 'Hours', 'Total']))
      const cells = dialog.getByRole('row').nth(1).getByRole('cell')
      const styles = []
      for (const i of [1, 2, 3]) styles.push(await cells.nth(i).evaluate(el => { const s = getComputedStyle(el); return { align: s.textAlign, nums: s.fontVariantNumeric } }))
      record('7 numeric cells right-aligned and tabular', ctx, styles, styles.every(s => ['right', 'end'].includes(s.align) && s.nums.includes('tabular-nums')))
    }
    if (vp.touch) {
      const nameBox = await dialog.getByText(LONG).first().evaluate(el => ({ over: getComputedStyle(el).textOverflow, fits: el.scrollWidth <= el.clientWidth + 1, panelFits: el.closest('[role="dialog"]').scrollWidth <= el.closest('[role="dialog"]').clientWidth + 1 }))
      record('9 long name wraps inside its card, no ellipsis', ctx, nameBox, nameBox.over !== 'ellipsis' && nameBox.fits && nameBox.panelFits)
    }
    if (scheme === 'dark') {
      const band = await dialog.locator('span.text-xl').first().evaluate(el => {
        const bg = (node) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = getComputedStyle(node).backgroundColor; c.fillRect(0, 0, 1, 1); return Array.from(c.getImageData(0, 0, 1, 1).data) }
        const px = (css) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = css; c.fillRect(0, 0, 1, 1); return Array.from(c.getImageData(0, 0, 1, 1).data) }
        const style = getComputedStyle(el.parentElement)
        return { band: bg(el.parentElement), panel: bg(el.closest('[role="dialog"]')), border: style.borderTopWidth === '0px' ? null : px(style.borderTopColor) }
      })
      // The band is set apart by its fill or, where the fill matches the panel in dark, by its border.
      record('10 dark: summary band is set apart from the panel', ctx, band, band.band.join() !== band.panel.join() || (band.border != null && band.border.join() !== band.panel.join()))
    }
    await close()

    // Dates edited, then updating is covered by the unit tests; the edited-hint state is shot here.
    await openRun(); await make.waitFor()
    await dialog.getByLabel('From').fill('2026-10-10')
    await dialog.getByRole('button', { name: 'Update preview' }).waitFor()
    await shoot('dates-edited')
    await close()

    // Empty (From in 2020) and nothing claimable (From in 2021)
    await openRun(); await make.waitFor(); await setDates('2020-01-01')
    await dialog.getByText('Completed shifts show here until they\'re claimed.').waitFor()
    await shoot('empty'); await close()
    await openRun(); await make.waitFor(); await setDates('2021-01-01')
    await dialog.getByText('Nothing in this period can be claimed yet.').waitFor()
    await shoot('nothing-claimable'); await close()

    // Budget warning: the same preview with a budget block
    await page.route('**/api/v1/claims/from-shifts/preview', async route => {
      const res = await route.fetch(); const body = await res.json()
      await route.fulfill({ response: res, json: { ...body, data: { ...body.data, budget: BUDGET } } })
    }, { times: 1 })
    await openRun(); await dialog.getByRole('region', { name: 'Budget' }).waitFor()
    await shoot('budget-warning'); await close()

    // Error: the run request fails
    await openRun(); await make.waitFor()
    await page.route('**/api/v1/claims/from-shifts', r => r.fulfill({ status: 500, json: { success: false, data: null, message: null, errors: [] } }), { times: 1 })
    await make.click()
    await dialog.getByRole('button', { name: 'Try again' }).waitFor()
    await shoot('error')
    // Running: hold the retry, shoot, release into the partial-failure result
    let releaseRun
    const heldRun = new Promise(res => { releaseRun = res })
    await page.route('**/api/v1/claims/from-shifts', async route => { await heldRun; await route.continue() }, { times: 1 })
    await dialog.getByRole('button', { name: 'Try again' }).click()
    await dialog.getByRole('status').filter({ hasText: 'Making 2 claims' }).waitFor()
    await shoot('running')
    releaseRun()

    // Done, with a failed participant (the fixture's run always fails Jo Park)
    await dialog.getByRole('button', { name: 'Done' }).waitFor()
    await shoot('partial-failure')
    await noOverflow('partial failure')
    await height(dialog.getByRole('button', { name: 'Done' }), 'Done', 'done')
    const geo = await dialog.evaluate(el => {
      const callout = Array.from(el.querySelectorAll('[role="alert"]')).find(n => n.textContent.includes("couldn't be made"))
      const table = el.querySelector('table, [role="table"]')
      return { calloutBottom: callout?.getBoundingClientRect().bottom, tableTop: table?.getBoundingClientRect().top }
    })
    record('11 failed callout above the table', ctx, geo, geo.calloutBottom != null && geo.tableTop != null && geo.calloutBottom <= geo.tableTop)
    const total2 = await dialog.locator('span.text-xl').first().evaluate(el => el.getClientRects().length)
    record('4 summary total on one line', `${ctx} done`, total2, total2 === 1)
    if (!vp.touch) {
      const heads = (await dialog.getByRole('columnheader').allInnerTexts()).map(h => h.trim())
      record('6 done table headers', ctx, heads, JSON.stringify(heads) === JSON.stringify(['Participant', 'Shifts', 'Hours', 'Total', 'Claim']))
    } else {
      const links = dialog.getByRole('link', { name: /^TC-RUN-/ })
      for (let i = 0; i < await links.count(); i++) await height(links.nth(i), `Claim link ${i + 1}`, 'done')
      const hit = await links.first().boundingBox()
      record('8 Claim link hit height >= 44', ctx, hit?.height, (hit?.height ?? 0) >= 44)
    }
    if (scheme === 'dark') {
      const ratio = await dialog.evaluate(el => {
        const callout = Array.from(el.querySelectorAll('[role="alert"]')).find(n => n.textContent.includes("couldn't be made"))
        const px = (css) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = css; c.fillRect(0, 0, 1, 1); return Array.from(c.getImageData(0, 0, 1, 1).data) }
        const over = (top, base) => { const a = top[3] / 255; return [0, 1, 2].map(i => top[i] * a + base[i] * (1 - a)) }
        const lum = (rgb) => { const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
        const fill = over(px(getComputedStyle(callout).backgroundColor), over(px(getComputedStyle(el).backgroundColor), [0, 0, 0]))
        const text = px(getComputedStyle(callout.querySelector('p')).color).slice(0, 3)
        const [hi, lo] = [lum(text), lum(fill)].sort((a, b) => b - a)
        return (hi + 0.05) / (lo + 0.05)
      })
      record('10 dark: danger callout contrast >= 4.5', ctx, Math.round(ratio * 100) / 100, ratio >= 4.5)
    }
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `done-${vp.name}-${scheme}.png`), { touch: vp.touch })).checks)
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
