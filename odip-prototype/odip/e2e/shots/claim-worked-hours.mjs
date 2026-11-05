// Claim worked hours (W2 PR3): what a claim leaves out when approved extra time cannot be claimed, and the later-decision dialog's Already claimed line.
// Captures plus numeric checks. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/claim-worked-hours.mjs <outdir>
// Sign-in is stubbed with page.route; the claim run preview and the extra-time decision are patched in flight. The clock is pinned (NOW).
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])
const NOW = new Date('2026-11-04T23:00:00Z')

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openPage(browser, vp, { role, username, now = NOW }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(now)
  return { context, page }
}

const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${ctx}: no horizontal scroll`, o <= 0, o)
}
// Every visible button, input, select and textarea inside `root` has at least 44px of height to tap, its own box or its TAP_AREA pad.
const tapTargets = async (root, ctx) => {
  const small = await root.evaluate((el) => [...el.querySelectorAll('button, input, select, textarea')].filter((e) => {
    const b = e.getBoundingClientRect(); if (!(b.width > 0 && b.height > 0) || getComputedStyle(e).visibility === 'hidden') return false
    const pad = parseFloat(getComputedStyle(e, '::before').height) || 0
    return Math.max(b.height, pad) < 43.5
  }).map((e) => `${e.tagName} ${(e.getAttribute('aria-label') || e.textContent || e.name || '').trim().slice(0, 24)} ${Math.round(e.getBoundingClientRect().height)}`))
  check(`${ctx}: tap targets at least 44 high`, small.length === 0, small)
}
// An element wraps to at most `max` lines (its height over its line height).
const maxLines = async (locator, max, ctx) => {
  const lines = await locator.evaluate((el) => { const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2; return Math.round(el.getBoundingClientRect().height / lh * 10) / 10 })
  check(`${ctx}: at most ${max} lines`, lines <= max + 0.1, lines)
}
const fontAtLeast = async (locator, px, ctx) => {
  const size = await locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  check(`${ctx}: text at least ${px}px`, size >= px, size)
}
const crop = async (page, locator, name, vp, pad = 0) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}


const reason = 'Sam Lee: the extra time would take Core for 1 Jul 2026–30 Jun 2027 over its budget (hard limit). The shift is claimed without it; add the extra time as a manual claim if the budget allows.'
const extraOnly = { participantId: 'p1', participantName: 'Sam Lee', shiftId: 's11', serviceDate: '2026-11-03', description: 'Extra time 08:40–09:00, 17:00–17:20 · 40 min', reason, extraTimeOnly: true }
const wholeShift = { participantId: 'p1', participantName: 'Sam Lee', shiftId: 's9', serviceDate: '2026-11-02', description: 'Shift 22:00–06:00 · 8 h', reason: 'Sam Lee: it is a sleepover.' }
const run = (leftOut) => ({ from: '2026-10-26', to: '2026-11-08', claimsMade: 0, shiftCount: 2, hours: 17.33, totalAmount: 866, participants: [{ participantId: 'p1', participantName: 'Sam Lee', shiftCount: 2, hours: 17.33, totalAmount: 866 }], leftOut, flagged: [], skipped: [] })

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const tag = vp.touch ? `${vp.name}-touch` : vp.name

  // run-extra-only, run-mixed: the shift claim run's preview with only extra time left out, then beside a whole shift
  for (const [state, leftOut, heading, footer] of [
    ['run-extra-only', [extraOnly], 'Extra time left out', /The shifts are claimed at their held hours\./],
    ['run-mixed', [wholeShift, extraOnly], '1 shift will be left out', /A shift whose extra time is left out is claimed at its held hours\./],
  ]) {
    try {
      const { context, page } = await openPage(browser, vp, { role: 'Admin', username: 'dev.admin' })
      await page.route('**/api/v1/claims/from-shifts/preview', (r) => r.fulfill({ json: envelope(run(leftOut)) }))
      await page.goto(`${BASE_URL}/claims?run=shifts`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const dialog = page.getByRole('dialog', { name: 'Claim completed shifts' })
      await dialog.waitFor({ state: 'visible', timeout: 60_000 })
      const head = dialog.getByText(heading, { exact: true })
      await head.waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(400)
      check(t(`${state}: heading reads "${heading}"`), await head.isVisible())
      check(t(`${state}: footer says the shift is claimed at held hours`), await dialog.getByText(footer).isVisible())
      check(t(`${state}: the extra time line names the minutes`), await dialog.getByText('Extra time 08:40–09:00, 17:00–17:20 · 40 min').isVisible())
      await fontAtLeast(dialog.getByText(footer), 13, t(`${state} footer`))
      await noHScroll(page, t(state))
      if (vp.touch) await tapTargets(dialog, t(state))
      await crop(page, dialog, `${state}-${tag}.png`, vp)
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }

  // decide-already-claimed: a Completed row with extra time Pending; Pay actual time saves and the reply names the claim that holds the shift
  try {
    const { context, page } = await openPage(browser, vp, { role: 'Admin', username: 'dev.admin' })
    await page.route('**/api/v1/rostering/completions*', async (r) => {
      const response = await r.fetch()
      const body = await response.json()
      const list = Array.isArray(body?.data) ? body.data : body?.data?.items
      if (Array.isArray(list) && list[0]) Object.assign(list[0], { status: 'Completed', extraTime: 'Pending', offRoster: true, varianceMinutesStart: -20, varianceMinutesEnd: 20,
        actualStart: new Date(Date.parse(list[0].rosteredStart) - 20 * 60_000).toISOString(), actualEnd: new Date(Date.parse(list[0].rosteredEnd) + 20 * 60_000).toISOString() })
      await r.fulfill({ response, json: body })
    })
    await page.route('**/api/v1/rostering/shifts/*/completion/extra-time', (r) => r.fulfill({ json: envelope({ extraTime: 'Approved', claimReference: 'TC-12' }) }))
    await page.goto(`${BASE_URL}/rostering/completions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const open = page.getByRole('button', { name: /^Extra time for / }).first()
    await open.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)
    await open.click()
    const dialog = page.getByRole('dialog', { name: 'Extra time' })
    await dialog.waitFor({ state: 'visible', timeout: 10_000 })
    check(t('decide-already-claimed: no claimed line before a decision'), (await dialog.getByText(/Already claimed/).count()) === 0)
    await dialog.getByRole('radio', { name: /^Pay actual time/ }).click()
    const line = dialog.getByText(/Already claimed at rostered hours on/)
    await line.waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForTimeout(400)
    const text = (await line.innerText()).replace(/\s+/g, ' ').trim()
    check(t('decide-already-claimed: the line names the claim and the way through'), /^Already claimed at rostered hours on TC.12\. To claim the extra time, delete that draft claim and claim again, or add a manual claim\.$/.test(text), text)
    await fontAtLeast(line, 12, t('decide-already-claimed line'))
    await noHScroll(page, t('decide-already-claimed'))
    if (vp.touch) await tapTargets(dialog, t('decide-already-claimed'))
    await crop(page, dialog, `decide-already-claimed-${tag}.png`, vp)
    await context.close()
  } catch (e) { check(t('decide-already-claimed ran'), false, String(e.message).split('\n')[0]) }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
