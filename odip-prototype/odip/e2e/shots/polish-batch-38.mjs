// Polish batch 38: a failed staff or participant list says so instead of showing an empty picker (H46-3).
// Capture states: personweek-failed, tierboard-failed, identity-failed, personweek-normal
// notes-at-limit is not captured: PB34-N2 was already on main (#741), so PatternSlideOver is unchanged.
// Run through the runner: odip-test.sh <worktree> shots e2e/shots/polish-batch-38.mjs <outdir>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
const MON = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))
const shift = { id: 'sh1', participantId: 'p-0001', participantName: 'Liam Okafor', staffId: 's-0001', staffName: 'Callum Radford', serviceDate: MON, startTime: '09:00:00', endTime: '13:00:00', endsNextDay: false, durationHours: 4, ratio: 'OneToOne', nightType: 'None', status: 'Published', shiftPatternId: null, notes: null, overrideReason: null, findings: [], assigneeOnApprovedLeave: false }
const board = (mon) => envelope({
  groupBy: 'Staff', weekStart: mon, days: [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(mon, i)), unfilled: [], exceptions: [],
  staffRows: [{ staffId: 's-0001', fullName: 'Callum Radford', role: 'SupportWorker', compliance: 'Ok', complianceNotes: [], rosteredHours: mon === MON ? 4 : 0, targetHours: 38, shifts: mon === MON ? [shift] : [], tripBars: [], leave: [] }],
})
const compat = envelope([
  { staffId: 's-0001', staffName: 'Callum Radford', participantId: 'p-0001', participantName: 'Liam Okafor', level: 'Preferred', rank: 1, reason: null, updatedAt: '2026-10-01T00:00:00Z' },
])

const checks = []
const check = (name, detail, pass) => { checks.push({ name, pass, detail }) }
const browser = await chromium.launch({ headless: true })

async function session(vp, failed) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce', ...(vp.touch ? { hasTouch: true, isMobile: true } : {}) })
  const page = await context.newPage()
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('/staff?')) console.log(`HTTP ${r.status()} ${r.url()}`) })
  page.on('pageerror', (e) => check(`page error (${vp.name})`, e.message, false))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/rostering/board*', (r) => r.fulfill({ json: board(new URL(r.request().url()).searchParams.get('weekStart')) }))
  await page.route('**/api/v1/rostering/compatibility*', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: compat }) : r.continue()))
  if (failed) {
    const refuse = (r) => r.fulfill({ status: 500, json: { title: 'Server error', status: 500 } })
    await page.route(/\/api\/v1\/staff(\?.*)?$/, refuse)
    await page.route(/\/api\/v1\/participants\?/, refuse)
  }
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { page, context }
}
const go = async (page, p) => {
  await page.goto(`${BASE_URL}${p}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
}

async function openShift(page) {
  await page.getByRole('button', { name: 'Add shift' }).first().click({ timeout: 20_000 }).catch(async (e) => {
    console.log(`${page.url()}
${(await page.evaluate(() => (document.querySelector('main') ?? document.body).innerText)).slice(0, 700)}`)
    throw e
  })
}

// The message's region, then the checks: no sideways overflow, and the retry control at the house floor.
async function capture(page, vp, name, message, region, opts = {}) {
  await message.waitFor({ timeout: 45_000 })
  const r = await cropElement(page, region, path.join(OUT_DIR, `${name}-${vp.name}.png`), { touch: vp.touch, natural: true, ...opts })
  checks.push(checkCropHolds(r))
  const m = await region.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  check(`${name} ${vp.name}: no horizontal overflow`, m, m.sw <= m.cw)
  const token = vp.touch ? '--tap-min' : '--control-h-sm'
  const floor = await page.evaluate((t) => {
    const p = document.createElement('div')
    p.style.height = `var(${t})`
    document.body.appendChild(p)
    const h = p.getBoundingClientRect().height
    p.remove()
    return h
  }, token)
  const h = (await region.getByRole('button', { name: 'Try again' }).first().boundingBox()).height
  check(`${name} ${vp.name}: Try again height >= ${token} (${floor}px)`, h, floor > 0 && h >= floor - 0.5)
}

try {
  for (const vp of [{ name: '390', width: 390, height: 844, touch: true }, { name: '1280', width: 1280, height: 900, touch: false }]) {
    // personweek-failed: the shift panel opened from a person's Week tab, both lists refused.
    {
      const { page, context } = await session(vp, true)
      await go(page, '/staff/s-0001?tab=week')
      await openShift(page)
      const dialog = page.getByRole('dialog')
      await capture(page, vp, 'personweek-failed', dialog.getByText(/Couldn't load this staff list/), dialog, { pad: 0 })
      await context.close()
    }
    // personweek-normal: the same panel with the lists loaded, the Staff picker as on main.
    {
      const { page, context } = await session(vp, false)
      await go(page, '/staff/s-0001?tab=week')
      await openShift(page)
      const dialog = page.getByRole('dialog')
      await dialog.getByText('Staff', { exact: true }).first().waitFor({ timeout: 45_000 })
      const failures = await dialog.getByText(/Couldn't load this/).count()
      check(`personweek-normal ${vp.name}: no failure message`, failures, failures === 0)
      checks.push(checkCropHolds(await cropElement(page, dialog, path.join(OUT_DIR, `personweek-normal-${vp.name}.png`), { touch: vp.touch, natural: true, pad: 0 })))
      await context.close()
    }
    // tierboard-failed: the participant's Rostering card.
    {
      const { page, context } = await session(vp, true)
      await go(page, '/participants/p-0001?tab=people&section=roster')
      const msg = page.getByText(/Couldn't load this staff list/).first()
      await capture(page, vp, 'tierboard-failed', msg, msg.locator("xpath=ancestor::div[contains(@class,'space-y-4')][1]"))
      await context.close()
    }
    // identity-failed: Edit on the Identity card, Preferred Staff Member.
    {
      const { page, context } = await session(vp, true)
      await go(page, '/participants/p-0001?tab=about&section=identity')
      const card = page.getByText('Identity', { exact: true }).first().locator("xpath=ancestor::*[.//button[normalize-space()='Edit']][1]")
      await card.getByRole('button', { name: 'Edit', exact: true }).first().click({ timeout: 20_000 }).catch(async (e) => {
        console.log(await page.evaluate(() => `${location.href}
${[...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 30).join(' | ')}
${(document.querySelector('main') ?? document.body).innerText.slice(0, 400)}`))
        throw e
      })
      const msg = page.getByText(/Couldn't load this staff list/).first()
      await capture(page, vp, 'identity-failed', msg, msg.locator("xpath=ancestor::div[contains(@class,'@container')][1]"))
      await context.close()
    }
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
