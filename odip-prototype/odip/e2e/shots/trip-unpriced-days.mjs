// Captures and numeric checks for the unpriced-days note in the trip Generate claim preview (PR 648). Run through the runner:
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// The mock API picks the state by trip (mock-api/server.js tripClaimPreview): t-0001 no note, t-0002 note only, t-0003 note plus left-out participants.
// Prints "CHECK ok|FAIL name = value", writes checks.json, and exits non-zero when a check fails.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
for (const f of readdirSync(OUT_DIR)) if (f.endsWith('.png')) rmSync(path.join(OUT_DIR, f))
rmSync(path.join(OUT_DIR, 'full'), { recursive: true, force: true })
mkdirSync(path.join(OUT_DIR, 'full'), { recursive: true })

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' })
const NOTE = "Not claimed: this trip's Weekday days (29/06/2026 to 02/07/2026) have no catalogue rate. Import the catalogue for that period, then claim those days."

// name = capture state; full = also one full page (the modal is fixed, so the page behind it is what the shot adds).
const STATES = [
  { name: 'no-note-1280', trip: 't-0001', width: 1280 },
  { name: 'note-1280', trip: 't-0002', width: 1280, full: true },
  { name: 'note-leftout-1280', trip: 't-0003', width: 1280 },
  { name: 'note-leftout-390', trip: 't-0003', width: 390 },
  { name: 'note-dark-1280', trip: 't-0002', width: 1280, dark: true },
  { name: 'note-390', trip: 't-0002', width: 390, full: true },
]

const results = []
let failed = false
const check = (name, ctx, measured, pass) => {
  if (!pass) failed = true
  results.push({ check: name, ...ctx, pass: !!pass, measured })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} [${Object.values(ctx).join(' ')}] = ${JSON.stringify(measured)}`)
}
const settle = async (p) => {
  await p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 5000 }).catch(() => {})
  await p.evaluate(() => document.fonts.ready)
  await p.waitForTimeout(300)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const height = mobile ? 844 : 800
    const ctx = { state: st.name }
    const context = await browser.newContext({ viewport: { width: st.width, height }, hasTouch: mobile, isMobile: mobile, locale: 'en-AU', timezoneId: 'Australia/Sydney', colorScheme: st.dark ? 'dark' : 'light' })
    const page = await context.newPage()
    const cdp = mobile ? await context.newCDPSession(page) : null
    const pinCoarse = async () => {
      await cdp?.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
      await cdp?.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'any-pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
    }
    await pinCoarse()
    await page.clock.setFixedTime(new Date('2026-11-06T10:00:00+11:00'))
    page.on('pageerror', (e) => check('page error', ctx, e.message, false))
    await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

    await page.goto(`${BASE_URL}/trips/${st.trip}?tab=claims`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: /Generate Claim/ }).click({ timeout: 60_000 })
    await page.getByRole('button', { name: /Preview Claim/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: 'Claim Preview' }).waitFor({ timeout: 30_000 })
    await pinCoarse()
    await settle(page)

    // Grow the viewport so the whole dialog fits (at 390 touch a fullPage clip drops the emulation), then re-pin.
    const need = await dialog.evaluate((d) => Math.ceil(d.scrollHeight + 120))
    if (need > height) { await page.setViewportSize({ width: st.width, height: need }); await pinCoarse(); await settle(page) }
    await page.mouse.move(st.width - 4, 4)

    const m = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')
      const dr = d.getBoundingClientRect(), cs = getComputedStyle(d)
      const box = { l: dr.left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth), r: dr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth) }
      const wrap = (re) => [...d.querySelectorAll('div')].find((w) => /section-gap/.test(w.className) && w.firstElementChild && re.test(w.firstElementChild.textContent || ''))
      const note = wrap(/^Not claimed:/)?.firstElementChild ?? null
      const left = wrap(/left out of this claim/)?.firstElementChild ?? null
      const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom } }
      let clipped = null
      if (note) clipped = [note, ...note.querySelectorAll('*')].filter((e) => e.clientWidth > 0).filter((e) => e.scrollWidth > e.clientWidth + 0.5).map((e) => e.tagName)
      return {
        docSw: document.documentElement.scrollWidth, docCw: document.documentElement.clientWidth, dialogSw: d.scrollWidth, dialogCw: d.clientWidth, box,
        note: note && rect(note), noteText: note?.textContent ?? null, left: left && rect(left), clipped,
        anyNotClaimed: /Not claimed:/.test(d.textContent || ''), coarse: matchMedia('(pointer: coarse)').matches,
      }
    })

    check('no horizontal scroll', ctx, { docSw: m.docSw, docCw: m.docCw, dialogSw: m.dialogSw, dialogCw: m.dialogCw }, m.docSw <= m.docCw && m.dialogSw <= m.dialogCw)
    if (mobile) check('touch emulation holds', ctx, m.coarse, m.coarse)
    if (st.trip === 't-0001') {
      check('default shows no note', ctx, m.anyNotClaimed, !m.anyNotClaimed)
    } else {
      check('note shown, copy exact', ctx, m.noteText, m.noteText === NOTE)
      check('note callout inside the modal content box', ctx, { note: m.note, box: m.box }, !!m.note && m.note.l >= m.box.l - 0.5 && m.note.r <= m.box.r + 0.5)
      check('note text wraps, no clipping (scrollWidth equals clientWidth)', ctx, m.clipped, Array.isArray(m.clipped) && m.clipped.length === 0)
    }
    if (st.trip === 't-0003') check('note sits below the left-out list', ctx, { left: m.left, note: m.note }, !!m.left && !!m.note && m.note.t >= m.left.b - 0.5)

    // Padded crop of the dialog; the fixed bottom nav is hidden for the shot only.
    await page.addStyleTag({ content: 'nav[aria-label="Mobile"]{visibility:hidden !important}' })
    const bb = await dialog.boundingBox()
    const x = Math.max(0, bb.x - 16), y = Math.max(0, bb.y - 16)
    const vh = page.viewportSize().height
    const clip = { x, y, width: Math.min(st.width - x, bb.width + 32), height: Math.min(vh - y, bb.height + 32) }
    check('crop holds the whole dialog', ctx, { dialog: bb.height, crop: clip.height, viewport: vh }, clip.height >= bb.height)
    await page.screenshot({ path: path.join(OUT_DIR, `${st.name}.png`), clip })
    if (st.full) await page.screenshot({ path: path.join(OUT_DIR, 'full', `${st.name}-fullpage.png`) })
    await context.close()
  }
} finally {
  writeFileSync(path.join(OUT_DIR, 'checks.json'), JSON.stringify(results, null, 2))
  await browser.close()
}
console.log(`${results.filter((r) => r.pass).length}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
