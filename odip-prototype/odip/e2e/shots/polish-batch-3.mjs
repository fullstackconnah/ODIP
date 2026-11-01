// Polish batch 3, PR A: the deadlines chevron (A1), phone placeholders (A3), settings rail bar (A4), leave-card spacer (A5).
// Numeric checks come from SHAPE.md (polish-batch-3); computed boxes and styles only, never class names. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots e2e/shots/polish-batch-3.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const VIEWER = '00000000-0000-0000-0000-0000000000a1'
const username = 'dev.admin'
const tenantName = 'Sample Support Co'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username, role: 'Admin', tenantName }])
const devLogin = envelope({ id: VIEWER, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev Admin', role: 'Admin', tenantName, tenantId: 'tenant-0001' })
const overdue = envelope([{ id: 'inc-1', title: 'Slip in kitchen', tripName: null, incidentType: 'Injury', severity: 'Low', status: 'Draft', reportedByName: 'Alex Rivera', incidentDateTime: '2026-09-01T10:00:00Z', qscReportingStatus: 'Required', isOverdue24h: true }])
const ownLeave = { id: 'leave-own', userId: VIEWER, userFullName: 'Dev Admin', leaveType: 'Annual', startDate: '2026-12-01', endDate: '2026-12-02', status: 'Pending', reason: null, requestedByUserId: VIEWER, requestedAt: '2026-11-01T09:00:00Z', decidedByUserId: null, decidedAt: null, decisionNote: null }

const PROFILES = [
  { name: 'desktop-1280', width: 1280, height: 900, touch: false, dark: false },
  { name: 'desktop-1280-dark', width: 1280, height: 900, touch: false, dark: true },
  { name: 'touch-390', width: 390, height: 844, touch: true, dark: false },
  { name: 'touch-390-dark', width: 390, height: 844, touch: true, dark: true },
]

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (tag, name, ok, detail = '') => { checks.push({ name: `${tag} ${name}`, pass: !!ok, detail }); console.log(`[polish-batch-3] ${ok ? 'PASS' : 'FAIL'} ${tag} ${name}${detail !== '' ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`) }
const safe = async (tag, name, fn) => { try { await fn() } catch (e) { check(tag, name, false, String(e.message).split('\n')[0]) } }
const close = (a, b, tol) => Math.abs(a - b) <= tol

async function openPage(context) {
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/incidents/overdue-qsc*', (r) => r.fulfill({ json: overdue }))
  // The leave group gets one request of the signed-in viewer, so it mixes rows with and without a checkbox.
  await page.route(/\/api\/v1\/leave(\?.*)?$/, async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ response: res, json: { ...body, data: [...body.data, ownLeave] } })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const button = page.getByRole('button', { name: 'Sign in as selected user' })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  return page
}
const gotoReady = async (page, url, dark) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('main, form').first().waitFor({ state: 'visible', timeout: 60_000 })
  if (dark) await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForTimeout(800)
}

// A1: the banner on /incidents.
async function a1(page, profile) {
  const tag = `${profile.name} A1`
  await gotoReady(page, '/incidents', profile.dark)
  const banner = page.getByRole('alert').filter({ hasText: 'About the deadlines' })
  await banner.waitFor({ state: 'visible', timeout: 60_000 })
  const measure = () => banner.evaluate((el) => {
    const summary = el.querySelector('details > summary')
    const link = el.querySelector('a')
    const svgs = summary.querySelectorAll('svg')
    return {
      svgs: svgs.length, svgWidth: svgs[0] ? svgs[0].getBoundingClientRect().width : 0,
      summaryLine: getComputedStyle(summary).textDecorationLine, linkLine: getComputedStyle(link).textDecorationLine,
      transform: svgs[0] ? getComputedStyle(svgs[0]).rotate : null, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
    }
  })
  const closed = await measure()
  check(tag, 'summary has exactly 1 svg, 14px wide', closed.svgs === 1 && close(closed.svgWidth, 14, 1), { svgs: closed.svgs, w: closed.svgWidth })
  check(tag, 'summary not underlined, link underlined', closed.summaryLine === 'none' && closed.linkLine.includes('underline'), { summary: closed.summaryLine, link: closed.linkLine })
  check(tag, 'closed chevron rotation is none', closed.transform === 'none', closed.transform)
  check(tag, 'closed banner does not overflow', closed.scrollWidth <= closed.clientWidth, { sw: closed.scrollWidth, cw: closed.clientWidth })
  checks.push(checkCropHolds(await cropElement(page, banner, path.join(OUT_DIR, `${profile.name}-a1-closed.png`), { touch: profile.touch, pad: 12 })))
  await banner.locator('summary').click()
  await page.waitForTimeout(500)
  const open = await measure()
  // Tailwind 4 rotate-90 sets the `rotate` property (not transform), so that is what is read; closed reads none.
  check(tag, 'open chevron is rotated 90deg', open.transform === '90deg', open.transform)
  check(tag, 'open banner does not overflow', open.scrollWidth <= open.clientWidth, { sw: open.scrollWidth, cw: open.clientWidth })
  checks.push(checkCropHolds(await cropElement(page, banner, path.join(OUT_DIR, `${profile.name}-a1-open.png`), { touch: profile.touch, pad: 12 })))
  if (!profile.dark) checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${profile.name}-incidents.png`), { touch: profile.touch })).checks)
}

// A3: every phone placeholder fits its input (text width in the input's own font against the content box).
async function a3(page, profile) {
  for (const [url, labels] of [['/settings?section=organisation', ['Contact phone', 'Manager phone']], ['/settings?section=safety', ['Manager phone']]]) {
    const section = url.split('=')[1]
    const tag = `${profile.name} A3 ${section}`
    await gotoReady(page, url, false)
    for (const label of labels) {
      const input = page.getByLabel(label, { exact: true })
      await input.waitFor({ state: 'visible', timeout: 60_000 })
      const r = await input.evaluate((el) => {
        const cs = getComputedStyle(el)
        const probe = document.createElement('span')
        probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing}`
        probe.textContent = el.placeholder
        document.body.appendChild(probe)
        const text = probe.getBoundingClientRect().width
        probe.remove()
        return { placeholder: el.placeholder, text, room: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) }
      })
      check(tag, `${label} placeholder "${r.placeholder}" fits`, r.text <= r.room, { text: +r.text.toFixed(1), room: +r.room.toFixed(1) })
    }
    if (!profile.touch) checks.push(checkCropHolds(await cropElement(page, page.locator('main').first(), path.join(OUT_DIR, `${profile.name}-a3-${section}.png`), { touch: false, pad: 8 })))
  }
}

// A4: the settings rail's active bar is square on the left.
async function a4(page, profile) {
  const tag = `${profile.name} A4`
  await gotoReady(page, '/settings?section=organisation', profile.dark)
  const nav = page.getByRole('navigation', { name: 'Settings' })
  await nav.waitFor({ state: 'visible', timeout: 60_000 })
  const r = await nav.evaluate((el) => {
    const radii = (a) => { const cs = getComputedStyle(a); return { tl: cs.borderTopLeftRadius, bl: cs.borderBottomLeftRadius, tr: cs.borderTopRightRadius } }
    const active = el.querySelector('a[aria-current="page"]')
    const inactive = [...el.querySelectorAll('a')].find((a) => a !== active)
    return { active: radii(active), inactive: radii(inactive) }
  })
  check(tag, 'active left corners are 0px', r.active.tl === '0px' && r.active.bl === '0px', r.active)
  check(tag, 'active right corner keeps its radius', r.active.tr !== '0px', r.active.tr)
  check(tag, 'inactive left corner keeps its radius', r.inactive.tl !== '0px', r.inactive.tl)
  checks.push(checkCropHolds(await cropElement(page, nav, path.join(OUT_DIR, `${profile.name}-a4-rail.png`), { touch: false, pad: 12 })))
}

// A5: names start at one x down a group that mixes actionable and own-request rows; the spacer is the checkbox's box.
async function a5(page, profile) {
  const tag = `${profile.name} A5`
  await gotoReady(page, '/', false)
  await page.locator('#decisions-tab-leave').click()
  const panel = page.locator('#decisions-panel-leave')
  await panel.waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
  const r = await panel.evaluate((el) => {
    const subjects = [...el.querySelectorAll('[data-quick-subject]')].filter((s) => s.getBoundingClientRect().width > 0)
    const lefts = subjects.map((s) => s.getBoundingClientRect().left)
    const boxes = [...el.querySelectorAll('label')].filter((l) => l.querySelector('input[type=checkbox]') && !/^Select all/.test(l.querySelector('input').getAttribute('aria-label') || '') && l.getBoundingClientRect().width > 0)
    const spacers = [...el.querySelectorAll('span[aria-hidden="true"]')].filter((s) => s.getBoundingClientRect().height <= 2 && s.getBoundingClientRect().width > 0)
    return { lefts, boxW: boxes[0] ? boxes[0].getBoundingClientRect().width : null, spacerW: spacers[0] ? spacers[0].getBoundingClientRect().width : null, boxes: boxes.length, spacers: spacers.length, coarse: matchMedia('(pointer: coarse)').matches }
  })
  check(tag, 'group mixes checkbox rows and own-request rows', r.boxes > 0 && r.spacers > 0, { boxes: r.boxes, spacers: r.spacers })
  check(tag, 'every name starts at one x (+-1px)', r.lefts.length > 1 && Math.max(...r.lefts) - Math.min(...r.lefts) <= 1, r.lefts.map((x) => +x.toFixed(1)))
  // A fine pointer's label fills the column (which holds the width), so only the coarse label has its own box to match.
  if (profile.touch) check(tag, 'spacer width equals the CheckboxField box', r.boxW !== null && r.spacerW !== null && close(r.boxW, r.spacerW, 0.5), { box: r.boxW, spacer: r.spacerW })
  if (profile.touch) check(tag, 'pointer is coarse', r.coarse)
  console.log(`[polish-batch-3] ${tag} MEASURED CheckboxField box ${r.boxW}px, spacer ${r.spacerW}px`)
  checks.push(checkCropHolds(await cropElement(page, panel, path.join(OUT_DIR, `${profile.name}-a5-leave.png`), { touch: profile.touch, pad: 8 })))
}

try {
  for (const profile of PROFILES) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, colorScheme: profile.dark ? 'dark' : 'light' })
    const page = await openPage(context)
    await safe(`${profile.name} A1`, 'banner', () => a1(page, profile))
    if (!profile.dark) await safe(`${profile.name} A3`, 'placeholders', () => a3(page, profile))
    if (!profile.touch) await safe(`${profile.name} A4`, 'rail', () => a4(page, profile))
    if (!profile.dark) await safe(`${profile.name} A5`, 'leave group', () => a5(page, profile))
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
