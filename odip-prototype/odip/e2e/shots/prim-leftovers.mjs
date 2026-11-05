// Primitives leftovers: portal call links (Button href), a DisclosureToggle header in TenantFormPanel, the restrictive practice dialog on the house inputClass.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/prim-leftovers.mjs <outdir>
// Sign-in is stubbed with page.route; data is the mock API's (shift sh-next, participant p-0001). Computed boxes only. Exit 1 on any failure.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, fullPage, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role, username) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev User', role, tenantName: 'Sample Support Co' })
const devUsers = (role, username) => envelope([{ username, role, tenantName: 'Sample Support Co' }])

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openPage(browser, { width, height, touch, scheme, role, username, setup }) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width, height }, hasTouch: touch, isMobile: touch, colorScheme: scheme, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await setup?.(page)
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role, username) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role, username) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}
const noHScroll = async (page, ctx) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  check(`${ctx}: no horizontal overflow`, o <= 0, o)
}
const crop = async (page, locator, name, touch, pad = 12) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch }))
}

// Text vs background contrast for a ghost action, in the page. Colours go through a canvas so oklch and color-mix come back as sRGB; translucent backgrounds are composited down the ancestor chain.
function measureGhost(el) {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const rgba = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) }
  const layers = []
  for (let n = el; n; n = n.parentElement) layers.push(rgba(getComputedStyle(n).backgroundColor))
  let bg = [255, 255, 255, 1]
  for (const l of layers.reverse()) bg = over(l, bg)
  const fg = over(rgba(getComputedStyle(el).color), bg)
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a)
  const r = el.getBoundingClientRect()
  return { ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, fg: fg.slice(0, 3).map(Math.round), bg: bg.slice(0, 3).map(Math.round), h: Math.round(r.height), pad: parseFloat(getComputedStyle(el, '::before').height) || 0 }
}

const NOTE = { id: 'note-ghost', shiftId: 'sh-next', authorUserId: '00000000-0000-0000-0000-0000000000a1', authorName: 'Dev User', body: 'Settled well after lunch.', createdAt: '2026-09-08T09:30:00Z', updatedAt: '2026-09-08T09:30:00Z', flaggedCategories: [], flagsAcknowledgedAt: null, incidentId: null }

// A portal shift page for sh-next at 390 touch. Published by default; inProgress adds a completion, draft a saved finish draft on the report step; notes adds one note by this worker.
async function openShift(browser, scheme, { inProgress = false, draft = false, notes = false } = {}) {
  const setup = async (page) => {
    if (draft) await page.addInitScript(() => sessionStorage.setItem('odip-shift-end-draft:sh-next', JSON.stringify({ step: 'report', reached: 'report', timesSig: null })))
    await page.route('**/api/v1/portal/shifts/sh-next', async (r) => {
      const response = await r.fetch()
      const body = await response.json()
      if (body?.data) {
        body.data.status = inProgress ? 'InProgress' : 'Published'
        if (inProgress) {
          const start = new Date(Date.now() - 2 * 3600_000).toISOString()
          body.data.completion = { id: 'sc-ghost', shiftId: 'sh-next', actualStart: start, actualEnd: null, timeZoneId: body.data.timeZoneId, geolocationDeclined: false, startWasManual: false, submittedByUserId: '00000000-0000-0000-0000-0000000000a1', submittedByName: 'Dev User', startedAt: start, submittedAt: null, reviewedByUserId: null, reviewedByName: null, reviewedAt: null, breaks: [], ...body.data.completion }
          body.data.breaks ??= []
        }
      }
      await r.fulfill({ response, json: body })
    })
    if (notes) await page.route(/\/api\/v1\/portal\/shifts\/[^/]+\/notes/, (r) => r.request().method() === 'GET' ? r.fulfill({ json: envelope([NOTE]) }) : r.continue())
  }
  const { context, page } = await openPage(browser, { width: 390, height: 844, touch: true, scheme, role: 'SupportWorker', username: 'dev.worker', setup })
  await page.goto(`${BASE_URL}/portal/shifts/sh-next`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  return { context, page }
}

const browser = await chromium.launch({ headless: true })
try {
  // 1. Portal shift: the emergency contact call links are <a href="tel:"> of 44px or more at 390 touch, cropped with the card expanded.
  for (const scheme of ['light', 'dark']) {
    const tag = scheme === 'light' ? 'portal-call-390' : 'portal-call-dark-390'
    const t = (n) => `${tag}: ${n}`
    try {
      const { context, page } = await openShift(browser, scheme)
      const region = page.locator('#before-contacts')
      await region.waitFor({ state: 'attached', timeout: 60_000 })
      await region.scrollIntoViewIfNeeded()
      await region.locator('summary').click()
      check(t('card is expanded'), await region.evaluate((el) => el.open === true))
      await page.waitForTimeout(500)
      const links = await region.evaluate((el) => [...el.querySelectorAll('a')].map((a) => ({
        tag: a.tagName, href: a.getAttribute('href') ?? '', name: (a.textContent ?? '').trim(),
        h: Math.round(a.getBoundingClientRect().height), pad: parseFloat(getComputedStyle(a, '::before').height) || 0,
      })))
      check(t('at least one call link'), links.length > 0, links.length)
      for (const l of links) {
        check(t(`"${l.name}" is an <a> with a tel: href`), l.tag === 'A' && l.href.startsWith('tel:'), l)
        check(t(`"${l.name}" is at least 44px tall to tap`), Math.max(l.h, l.pad) >= 43.5, l)
      }
      await noHScroll(page, t('page'))
      // Each call link lies inside the clip and is not covered by the bottom nav or any fixed chrome.
      const r = await cropElement(page, region, path.join(OUT_DIR, `${tag}.png`), {
        touch: true, natural: true, pad: 12,
        during: async (clip) => { for (const [i, a] of (await region.locator('a').all()).entries()) checks.push(await overlapCheck(a, clip, `${tag} link ${i + 1}`)) },
      })
      checks.push(checkCropHolds({ ...r, touch: true }))
      if (scheme === 'light') {
        const full = await fullPage(page, path.join(OUT_DIR, 'full', 'portal-390.png'), { touch: true })
        checks.push(...full.checks)
      }
      await context.close()
    } catch (e) { check(t('ran'), false, String(e.message).split('\n')[0]) }
  }

  // 1b. The three ghost actions at 390 touch, light and dark: text contrast against the real background, and a 44px hit box.
  const ghosts = [
    { key: 'before', label: 'BeforeSection "Everything about"', find: async (page) => page.getByRole('button', { name: /^Everything about/ }) },
    { key: 'finish', label: 'FinishFlow "Back to shift"', inProgress: true, draft: true, find: async (page) => page.getByRole('button', { name: 'Back to shift' }).first() },
    { key: 'notes', label: 'ShiftNotesSection "Edit"', inProgress: true, notes: true, find: async (page) => { await page.getByRole('tab', { name: /^Notes/ }).click(); return page.getByRole('button', { name: 'Edit', exact: true }).first() } },
  ]
  for (const g of ghosts) for (const scheme of ['light', 'dark']) {
    const tag = `portal-ghost-${g.key}${scheme === 'dark' ? '-dark' : ''}-390`
    const t = (n) => `${tag}: ${n}`
    let page
    try {
      const opened = await openShift(browser, scheme, g)
      const { context } = opened
      page = opened.page
      const btn = await g.find(page)
      await btn.waitFor({ state: 'visible', timeout: 60_000 })
      await btn.scrollIntoViewIfNeeded()
      await page.waitForTimeout(500)
      const m = await btn.evaluate(measureGhost)
      check(t(`${g.label} text contrast is at least 4.5:1`), m.ratio >= 4.5, m)
      check(t(`${g.label} hit box is at least 44px tall`), Math.max(m.h, m.pad) >= 43.5, m)
      await noHScroll(page, t('page'))
      const r = await cropElement(page, btn, path.join(OUT_DIR, `${tag}.png`), { touch: true, natural: true, pad: 24 })
      checks.push(checkCropHolds({ ...r, touch: true }))
      await context.close()
    } catch (e) {
      const panel = await page?.locator('#shift-panel-notes').innerText({ timeout: 3000 }).catch(() => 'no notes panel')
      check(t('ran'), false, `${String(e.message).split('\n')[0]} | ${String(panel).replace(/\s+/g, ' ').slice(0, 300)}`)
    }
  }

  // 2. Tenant form: the Provider Settings DisclosureToggle, closed then open, at 1280.
  try {
    const { context, page } = await openPage(browser, { width: 1280, height: 900, touch: false, scheme: 'light', role: 'SuperAdmin', username: 'dev.super' })
    await page.goto(`${BASE_URL}/settings?section=tenants`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'New tenant' }).click()
    const dialog = page.getByRole('dialog', { name: 'New Tenant' })
    await dialog.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(500)
    const toggles = ['Provider Settings', 'Initial Admin User']
    const section = (name) => dialog.getByRole('button', { name }).locator('xpath=..')
    await crop(page, section('Provider Settings'), 'disclosure-closed-1280.png', false)
    for (const name of toggles) {
      const b = dialog.getByRole('button', { name })
      const before = await b.getAttribute('aria-expanded')
      await b.click()
      const after = await b.getAttribute('aria-expanded')
      check(`disclosure ${name}: aria-expanded flips false to true`, before === 'false' && after === 'true', { before, after })
      const controls = await b.getAttribute('aria-controls')
      check(`disclosure ${name}: aria-controls points at the open panel`, !!controls && (await page.locator(`#${controls}`).count()) === 1, controls)
    }
    await page.waitForTimeout(300)
    await crop(page, section('Provider Settings'), 'disclosure-open-1280.png', false)
    await noHScroll(page, 'disclosure 1280')
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', 'tenant-form-1280.png'), { touch: false })).checks)
    await context.close()
  } catch (e) { check('disclosure ran', false, String(e.message).split('\n')[0]) }

  // 3. Restrictive practice dialog at 390 touch: its row inputs are as tall as a house input on the same dialog.
  try {
    const { context, page } = await openPage(browser, { width: 390, height: 844, touch: true, scheme: 'light', role: 'Admin', username: 'dev.admin' })
    await page.goto(`${BASE_URL}/participants/p-0001?tab=health&section=restrictive-practices`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: 'Add entries' }).first().click()
    const dialog = page.getByRole('dialog').last()
    await dialog.waitFor({ state: 'visible', timeout: 60_000 })
    await page.waitForTimeout(400)
    // The setup step's "Number of entries" is a FormField input: the house height.
    const house = await dialog.getByLabel('Number of entries').evaluate((el) => Math.round(el.getBoundingClientRect().height))
    await dialog.getByRole('button', { name: 'Continue' }).click()
    const rowInput = dialog.locator('input[aria-label$="row 1"]').first()
    await rowInput.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(400)
    const heights = await dialog.locator('input[aria-label*=", row "]').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().height)))
    check('rp-dialog-390: row inputs found', heights.length > 0, heights)
    check('rp-dialog-390: every row input is the house input height', heights.every((h) => h === house), { house, heights })
    const add = dialog.getByRole('button', { name: 'Add row' })
    const addBox = await add.evaluate((el) => ({ h: Math.round(el.getBoundingClientRect().height), pad: parseFloat(getComputedStyle(el, '::before').height) || 0, secondary: el.className.includes('bg-[var(--color-card)]') }))
    check('rp-dialog-390: Add row is a secondary Button, 44px to tap', addBox.secondary && Math.max(addBox.h, addBox.pad) >= 43.5, addBox)
    await noHScroll(page, 'rp-dialog-390')
    await crop(page, dialog, 'rp-dialog-390.png', true)
    await context.close()
  } catch (e) { check('rp-dialog-390 ran', false, String(e.message).split('\n')[0]) }
} finally {
  await browser.close()
}
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
