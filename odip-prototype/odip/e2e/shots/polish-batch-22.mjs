// Polish batch 22, item 2: "Delete draft" in the participant's Agreements row menu wears the destructive colour. (a) 1280, light and dark: the Draft row hovered so its icon
// buttons show; (b) 390 touch: the row's more-actions menu open. Numeric: the danger text against the surface it sits on is at least 4.5:1, and the other items keep a neutral colour.
// Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/polish-batch-22.mjs <outdir>
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: String(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${detail}`) }

const requirements = { workerGender: 'NoPreference', driver: false, skills: [] }
const block = { id: 'b1', intensity: 'Standard', workers: 1, participantsPresent: 1, headcountChanges: [], setting: 'Community', location: { state: 'NSW', zone: 'National' }, workerMaySleep: false, sleepoverActiveHours: 0, onPublicHoliday: false, supportType: 'CommunityAccess', days: ['Monday'], start: '09:00:00', end: '12:00:00' }
const draftBody = { state: 'NSW', planStartDate: '2026-07-01', planEndDate: '2027-06-30', agreementStartDate: '2026-10-01', agreementEndDate: '2027-06-30', blocks: [{ block, requirements }], baseVersion: 1 }

/** WCAG contrast of two "rgb(r, g, b)" strings. */
const lum = (rgb) => {
  const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
/** The element's text colour, and the first opaque background found walking up from it. */
const colours = (loc) => loc.evaluate((el) => {
  let bg = 'rgb(255, 255, 255)'
  for (let n = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor
    if (c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c)) { bg = c; break }
  }
  return { fg: getComputedStyle(el).color, bg }
})
const destructiveOf = (page) => page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--color-destructive)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c })

async function open(browser, vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: vp.dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id, theme]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme })) } catch { /* storage blocked */ } }, [USER_ID, vp.dark ? 'dark' : 'light'])
  const page = await context.newPage()
  page.on('pageerror', (e) => check(`page error (${vp.name})`, false, e.message))
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co' }) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}

// hideChrome drops the sticky bar and bottom nav; overlapCheck fails a crop they still cover.
// `before` runs inside the capture, after the chrome is hidden, so a hover-revealed control is still revealed when the pixels are taken.
const shoot = async (page, loc, file, { pad, before } = {}) => {
  const shot = await cropElement(page, loc, file, { pad, hideChrome: true, during: async (clip) => { await before?.(); await page.waitForTimeout(500); return overlapCheck(loc, clip, path.basename(file)) } })
  checks.push(shot.measured, checkCropHolds(shot))
}

const VIEWPORTS = [
  { name: 'desktop-1280', width: 1280, height: 900, touch: false, dark: false },
  { name: 'desktop-1280-dark', width: 1280, height: 900, touch: false, dark: true },
  { name: 'touch-390', width: 390, height: 844, touch: true, dark: false },
]
const browser = await chromium.launch({ headless: true })
let prepared = false
try {
  for (const vp of VIEWPORTS) {
    const { context, page } = await open(browser, vp)
    if (!prepared) {   // p-0004: version 1 approved, then a revision waiting as a Draft (the newest version, so it offers Delete draft)
      prepared = true
      const call = (route, data) => page.request.fetch(`${BASE_URL}/api/v1/${route}`, { method: 'POST', data, headers: { Authorization: 'Bearer mock-jwt-token' } })
      await call('participants/p-0004/service-agreement-drafts/draft-p-0004-v1/approve', { acknowledgeOverlaps: true })
      await call('participants/p-0004/service-agreement-drafts', draftBody)
    }
    await page.goto(`${BASE_URL}/participants/p-0004?tab=agreements`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const card = page.locator('#agreements')
    await card.waitFor({ state: 'visible', timeout: 60_000 })
    const row = page.getByRole('row', { name: /Version 2\b/ })
    await row.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(500)
    const destructive = await destructiveOf(page)
    if (!vp.touch) {
      await row.hover()
      const del = row.getByRole('button', { name: 'Delete draft' })
      await del.waitFor({ state: 'visible', timeout: 10_000 })
      await del.hover()
      await page.waitForTimeout(300)
      const { fg, bg } = await colours(del)
      check(`${vp.name} a: Delete draft icon vs its hover surface >= 4.5:1`, contrast(fg, bg) >= 4.5, `${contrast(fg, bg).toFixed(2)} (${fg} on ${bg})`)
      check(`${vp.name} a: icon colour is --color-destructive`, fg === destructive, `${fg} vs ${destructive}`)
      const edit = row.getByRole('link', { name: 'Edit' })
      if (await edit.count()) check(`${vp.name} a: Edit stays neutral`, (await colours(edit.first())).fg !== destructive)
      await shoot(page, row, path.join(OUT_DIR, `agreements-row-menu-${vp.name}.png`), {
        before: async () => {
          await row.hover()
          await del.hover()
          await page.waitForTimeout(300)
          const box = await del.boundingBox()
          const opacity = await del.evaluate((el) => Number(getComputedStyle(el).opacity))
          check(`${vp.name} a: Delete draft is revealed at capture (box > 0, opacity 1)`, !!box && box.width > 0 && box.height > 0 && opacity === 1, JSON.stringify({ box, opacity }))
        },
      })
      if (!vp.dark) checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'participant-agreements-1280.png'), { touch: false })).checks)
    } else {
      check('b: pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
      await row.getByRole('button', { name: /More actions for/ }).click()
      const opt = page.getByRole('option', { name: 'Delete draft' })
      await opt.waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForTimeout(300)
      const { fg, bg } = await colours(opt)
      check('b: Delete draft text vs the menu surface >= 4.5:1', contrast(fg, bg) >= 4.5, `${contrast(fg, bg).toFixed(2)} (${fg} on ${bg})`)
      check('b: option colour is --color-destructive', fg === destructive, `${fg} vs ${destructive}`)
      const others = page.getByRole('option').filter({ hasNotText: 'Delete draft' })
      if (await others.count()) check('b: the other items stay neutral', (await colours(others.first())).fg !== destructive)
      const h = await opt.evaluate((el) => el.getBoundingClientRect().height)
      check('b: option height >= --tap-min (44)', h >= 43.4, h)
      await shoot(page, opt.locator('xpath=ancestor::*[@role="listbox"][1]'), path.join(OUT_DIR, 'agreements-row-menu-touch-390.png'), { pad: 32 }) // pad 32 keeps the card edge and its float shadow in the crop
      await page.keyboard.press('Escape')
      const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      check('b: no horizontal scroll', o <= 0, o)
      checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'participant-agreements-390.png'), { touch: true })).checks)
    }
    await context.close()
  }
} finally {
  await browser.close()
  if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
}
