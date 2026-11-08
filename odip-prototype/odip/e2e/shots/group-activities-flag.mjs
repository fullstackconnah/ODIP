// Group activities switch in Settings > Workspace visibility, and its turn-off confirm.
// Capture states: switch-off-390, switch-on-1280, confirm-off-390, confirm-off-1280, save-failed-1280
// Run through the runner: odip-test.sh <worktree> shots e2e/shots/group-activities-flag.mjs <outdir>
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

const checks = []
const check = (name, detail, pass) => { checks.push({ name, pass, detail }) }
const browser = await chromium.launch({ headless: true })

async function session(vp, { enabled, failPut }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce', ...(vp.touch ? { hasTouch: true, isMobile: true } : {}) })
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, e.message, false))
  let state = { hiddenAccommodation: false, hiddenVehicles: false, hiddenTrips: false, groupActivitiesEnabled: enabled }
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  await page.route('**/api/v1/settings/module-visibility', (r) => {
    if (r.request().method() === 'PUT') {
      if (failPut) return r.fulfill({ status: 500, json: { title: 'Server error', status: 500 } })
      state = { ...state, ...r.request().postDataJSON() }
    }
    return r.fulfill({ json: envelope(state) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: 'Sign in as selected user' }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/settings?section=workspace-visibility`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const box = page.getByRole('checkbox', { name: 'Group activities' })
  await box.waitFor({ timeout: 45_000 })
  return { page, context, box, section: page.getByRole('region', { name: 'Workspace visibility' }) }
}

const px = (page, token) => page.evaluate((t) => {
  const p = document.createElement('div')
  p.style.height = `var(${t})`
  document.body.appendChild(p)
  const h = p.getBoundingClientRect().height
  p.remove()
  return h
}, token)

async function crop(page, vp, name, locator) {
  const r = await cropElement(page, locator, path.join(OUT_DIR, `${name}-${vp.name}.png`), { touch: vp.touch, natural: true })
  checks.push(checkCropHolds(r))
}

async function sectionChecks(page, vp, section, box) {
  const m = await section.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
  check(`${vp.name}: no horizontal overflow on the section`, m, m.sw <= m.cw)
  const row = await box.locator('xpath=ancestor::label[1]').boundingBox()
  const tap = await px(page, '--tap-min')
  const ours = await section.getByText(/Run group sessions on the roster board/).evaluate((el) => getComputedStyle(el).fontSize)
  const theirs = await section.getByText(/Schedule assignments and vehicle warnings/).evaluate((el) => getComputedStyle(el).fontSize)
  check(`${vp.name}: helper font size equals the other switches' (${theirs})`, { ours, theirs }, ours === theirs)
  if (vp.touch) check(`${vp.name}: switch row height >= --tap-min (${tap}px)`, row.height, tap > 0 && row.height >= tap - 0.5)
}

try {
  for (const vp of [{ name: '390', width: 390, height: 844, touch: true }, { name: '1280', width: 1280, height: 900, touch: false }]) {
    const off = vp.touch
    {
      const { page, context, box, section } = await session(vp, { enabled: !off })
      await sectionChecks(page, vp, section, box)
      await crop(page, vp, off ? 'switch-off' : 'switch-on', section)
      await context.close()
    }
    {
      const { page, context, box } = await session(vp, { enabled: true })
      await box.click()
      await page.getByRole('button', { name: 'Save changes' }).click()
      const dialog = page.getByRole('alertdialog')
      await dialog.waitFor({ timeout: 20_000 })
      const floor = await px(page, '--control-h')
      for (const label of ['Cancel', 'Turn off']) {
        const h = (await dialog.getByRole('button', { name: label }).boundingBox()).height
        check(`${vp.name}: confirm ${label} height >= --control-h (${floor}px)`, h, floor > 0 && h >= floor - 0.5)
      }
      await crop(page, vp, 'confirm-off', dialog)
      await context.close()
    }
  }
  {
    const vp = { name: '1280', width: 1280, height: 900, touch: false }
    const { page, context, box, section } = await session(vp, { enabled: false, failPut: true })
    await box.click()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await page.getByRole('alert').filter({ hasText: 'Not saved' }).waitFor({ timeout: 20_000 })
    check('1280: failed save leaves the switch as chosen', await box.isChecked(), await box.isChecked())
    await crop(page, vp, 'save-failed', section)
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
