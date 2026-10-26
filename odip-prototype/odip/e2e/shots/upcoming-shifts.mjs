// Captures and numeric checks for the Upcoming shifts import (SHAPE-P3). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/upcoming-shifts.mjs <outdir>
// Exits non-zero when a check fails; every measured value is printed as "CHECK ok|FAIL name = value".
import { mkdirSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })

const VIEWPORTS = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 900 },
]
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

let failed = false
const check = (name, value, ok) => { if (!ok) failed = true; console.log(`CHECK ${ok ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(value)}`) }
const csv = { name: 'roster.csv', mimeType: 'text/csv', buffer: Buffer.from('Client Name,NDIS #,Day,From,To,Worker Email,Internal ref\r\nLiam Okafor,430123456,Monday,09:00,15:00,jack@example.com,x\r\n') }

const lines = (loc) => loc.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map((c) => Math.round(c.top))).size })
const box = (loc) => loc.boundingBox()
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const colours = (loc, prop) => loc.evaluate((el, prop) => {
  const parse = (s) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = s; const h = c.fillStyle; return h.startsWith('#') ? [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) : h.match(/\d+/g).slice(0, 3).map(Number) }
  let node = el; let back = [255, 255, 255]
  while (node) { const b = getComputedStyle(node).backgroundColor; if (b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') { back = parse(b); break } node = node.parentElement }
  return { fg: parse(getComputedStyle(el)[prop]), bg: back }
}, prop)

const browser = await chromium.launch({ headless: true })
try {
  // Warm-up: the dev server builds its CSS and pre-bundles dependencies on the first visit, so the measured passes start from a settled page.
  const warm = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage()
  await warm.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await warm.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await warm.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await warm.getByRole('button', { name: 'Sign in as selected user' }).click()
  await warm.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await warm.goto(`${BASE_URL}/settings/import/upcoming-shifts`, { waitUntil: 'networkidle', timeout: 120_000 })
  await warm.waitForTimeout(3000)
  await warm.context().close()
  for (const scheme of ['dark', 'light']) {
    for (const vp of VIEWPORTS) {
      if (scheme === 'dark' && vp.name === '768') continue
      const tag = `${vp.name}-${scheme}`
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.mobile, isMobile: !!vp.mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: scheme === 'dark' ? 'dark' : undefined, reducedMotion: 'reduce' })
      const page = await context.newPage()
      // The touch emulation alone left `pointer: coarse` false on the first page of a run; pin it so the 44px density tokens apply.
      const cdp = vp.mobile ? await context.newCDPSession(page) : null
      // A full-page screenshot resets the touch emulation, so the phone checks pin it again just before measuring.
      const pinCoarse = async () => { await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }); await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] }) }
      await pinCoarse()
      page.on('pageerror', (e) => check(`${tag} page error`, e.message, false))
      await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
      await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
      let delayPreview = 0
      await page.route('**/imports/upcoming-shifts/preview', async (r) => { if (delayPreview) await new Promise((res) => setTimeout(res, delayPreview)); await r.continue() })

      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: 'Sign in as selected user' }).click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
      await page.goto(`${BASE_URL}/settings/import/upcoming-shifts`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const h1 = page.getByRole('heading', { level: 1, name: 'Import upcoming shifts' })
      await h1.waitFor()
      const main = page.locator('main')
      const shot = async (name, loc) => {
        const file = path.join(OUT_DIR, `${name}-${tag}.png`)
        if (!loc) return page.screenshot({ path: file, fullPage: true })
        const b = await loc.boundingBox(); if (!b) return
        await page.screenshot({ path: file, fullPage: true, clip: { x: Math.max(0, b.x - 24), y: Math.max(0, b.y - 24), width: Math.min(vp.width, b.width + 48), height: b.height + 48 } })
      }
      const noScroll = async (what) => { const w = await page.evaluate(() => document.documentElement.scrollWidth); check(`${tag} no horizontal scroll (${what}) scrollWidth<=${vp.width}`, w, w <= vp.width) }

      // Upload: nothing chosen, then the pattern shape
      const legend = page.getByText("What's in your file?")
      const legendTop = (await box(legend)).y; const h1Top = (await box(h1)).y
      await noScroll('upload')
      await page.getByRole('radio', { name: /weekly pattern/i }).check()
      const dLegend = Math.abs((await box(legend)).y - legendTop); const dH1 = Math.abs((await box(h1)).y - h1Top)
      check(`${tag} legend top shift on choosing a shape (px)`, dLegend, dLegend === 0)
      check(`${tag} heading top shift (px)`, dH1, dH1 === 0)
      const hint = page.getByText(/One row per regular shift/)
      const labelLines = await lines(page.getByText('A weekly pattern', { exact: true })); const hintLines = await lines(hint); const spanLines = await lines(page.getByText(/^Makes shifts from/))
      check(`${tag} card label lines`, labelLines, labelLines === 1)
      check(`${tag} card hint lines (<=3 at 390)`, hintLines, hintLines <= 3)
      check(`${tag} span line lines`, spanLines, vp.mobile ? spanLines <= 2 : spanLines === 1)
      await pinCoarse(); await page.waitForTimeout(200)
      if (vp.mobile) {
        for (const [what, loc] of [['pattern radio card', page.locator('label:has(input[value="pattern"])')], ['dated radio card', page.locator('label:has(input[value="dated"])')], ['Starts from', page.getByLabel('Starts from')], ['Download the template', page.getByRole('button', { name: 'Download the template' })], ['Next', page.getByRole('button', { name: 'Next' })]]) {
          const b = await box(loc); check(`${tag} touch target ${what} height>=44`, Math.round(b.height), b.height >= 43.5)
        }
      }
      if (scheme === 'light') await shot('upload-pattern', main)
      if (scheme === 'dark') {
        const c = await colours(hint, 'color'); check(`${tag} hint contrast>=4.5`, +contrast(c.fg, c.bg).toFixed(2), contrast(c.fg, c.bg) >= 4.5)
        const cb = await colours(page.locator('label:has(input[value="pattern"])'), 'borderTopColor')
        check(`${tag} checked card border contrast>=3`, +contrast(cb.fg, cb.bg).toFixed(2), contrast(cb.fg, cb.bg) >= 3)
      }

      // Upload error: Next without a file
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('alert').first().waitFor()
      if (scheme === 'light') await shot('upload-error', main)

      // Preview, slowed so the pending line can be measured
      await page.getByLabel('File (.csv or .xlsx)').setInputFiles(csv)
      await page.getByRole('button', { name: 'Next' }).click()
      await page.getByRole('heading', { name: 'Match columns' }).waitFor()
      delayPreview = 1200
      const nextBtn = page.getByRole('button', { name: 'Next' })
      const before = await box(nextBtn)
      await nextBtn.click()
      await page.getByText(/Checking every shift against the roster rules/).waitFor()
      const during = await box(nextBtn)
      check(`${tag} Next box shift while the pending line shows (dx,dy)`, [during.x - before.x, during.y - before.y], Math.abs(during.y - before.y) <= 0.5 && Math.abs(during.x - before.x) <= 0.5)
      await page.getByRole('heading', { name: 'Preview' }).waitFor()
      const enforce = await page.getByText('Participants must be fully ready to be rostered').count()
      check(`${tag} Enforce callout in the DOM on first Preview paint`, enforce, enforce === 1)
      const sl = await lines(page.getByText(/They are added as drafts: nobody is told/)); check(`${tag} Preview summary lines`, sl, vp.mobile ? sl <= 3 : sl <= 2)
      await noScroll('preview')
      if (scheme === 'dark') {
        const c = await colours(page.getByText(/worker screening expired/).first(), 'color')
        check(`${tag} Check text contrast>=4.5`, +contrast(c.fg, c.bg).toFixed(2), contrast(c.fg, c.bg) >= 4.5)
      }
      if (scheme === 'light') await shot('preview-mixed-enforce', main)

      // Review
      await nextBtn.click()
      const importBtn = page.getByRole('button', { name: /^Import \d+ shifts?/ })
      await importBtn.waitFor()
      await noScroll('review')
      if (scheme === 'light') await shot('review', main)

      // Result
      await importBtn.click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Import' }).click()
      const open = page.getByRole('link', { name: 'Open the first week' })
      await open.waitFor(); await page.waitForTimeout(500)
      const tl = await lines(page.getByText(/^Imported \d+ shifts?/).first()); check(`${tag} result title lines`, tl, !vp.mobile || tl === 1)
      const ol = await lines(open); check(`${tag} Open the first week lines`, ol, ol === 1)
      const ws = await open.evaluate((e) => getComputedStyle(e).whiteSpace); check(`${tag} Open the first week white-space`, ws, ws === 'nowrap')
      await pinCoarse(); await page.waitForTimeout(200)
      if (vp.mobile) { const b = await box(open);  check(`${tag} touch target Open the first week height>=44`, Math.round(b.height), b.height >= 43.5) }
      await noScroll('result')
      const href = await open.getAttribute('href')
      if (scheme === 'light') await shot('result', main)

      // Undo is partial
      await page.getByRole('button', { name: 'Undo import' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Undo import' }).click()
      await page.getByText('Import partly undone').waitFor()
      if (scheme === 'light') { await shot('result-partly-undone', main); await shot('full', null) }

      // Hand-off, once
      if (scheme === 'light' && vp.name === '1280') {
        await page.goto(`${BASE_URL}${href}`)
        await page.waitForURL(/\/rostering\?date=\d{4}-\d{2}-\d{2}/)
        const date = new URL(page.url()).searchParams.get('date')
        check(`${tag} hand-off date is a Monday`, date, new Date(`${date}T00:00:00Z`).getUTCDay() === 1)
        const publish = await page.getByRole('button', { name: /Publish week/ }).waitFor({ timeout: 30_000 }).then(() => true, () => false)
        check(`${tag} Publish week button visible`, publish, publish)
        const start = await page.getByText(/Start (this|the) week/i).count(); check(`${tag} no Start card`, start, start === 0)
      }
      await context.close()
    }
  }
} finally {
  await browser.close()
}
console.log(failed ? 'SHOTS FAILED' : 'SHOTS OK')
process.exit(failed ? 1 : 0)
