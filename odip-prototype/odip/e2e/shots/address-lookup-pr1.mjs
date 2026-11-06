// Address lookup PR1: the AddressField on the participant record (caller A, Address & Living Arrangements edit panel), with the SHAPE section 6 numeric checks.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/address-lookup-pr1.mjs <outdir>
// Served by the mock API (participant p-0001), signed in as Admin. The proxy routes /api/v1/address/* are stubbed in the page with a fake key's behaviour:
// five fixed suggestions, an empty answer for "zzz", and a 404 on every call for the no-key state. Nothing real is called and no key exists here.
// Captures (1280 fine pointer): idle, typing-under-3, suggestions-desktop, active-option-keyboard, none-found, picked-filled, edited-after-pick, no-key-plain.
// Captures (390 touch): suggestions-390, picked-filled-390. One full page per breakpoint. Prints every check and exits 1 when one fails.
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

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])

const SUGGESTIONS = [
  { placeId: 'fake-place-1', mainText: '12 Example Street', secondaryText: 'Brisbane City QLD' },
  { placeId: 'fake-place-2', mainText: '12 Example Road', secondaryText: 'Cairns North QLD' },
  { placeId: 'fake-place-3', mainText: 'Unit 12/345 Extraordinarily Long Example Boulevard', secondaryText: 'Fortitude Valley, Brisbane City QLD' },
  { placeId: 'fake-place-4', mainText: '12 Example Place', secondaryText: 'Townsville City QLD' },
  { placeId: 'fake-place-5', mainText: '12 Example Court', secondaryText: 'Mount Gravatt East QLD' },
]
const PICKED = { street: '12 Example Street', suburb: 'Brisbane City', state: 'QLD', postcode: '4000', formattedAddress: '12 Example Street, Brisbane City QLD 4000' }

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openPage(browser, vp, { noKey = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const calls = { suggest: [], details: [] }
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route('**/api/v1/address/suggest', (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}')
    calls.suggest.push({ url: r.request().url(), method: r.request().method(), q: body.q, session: body.session })
    if (noKey) return r.fulfill({ status: 404, json: { success: false, data: null, message: null, errors: [] } })
    return r.fulfill({ json: envelope(String(body.q).includes('zzz') ? [] : SUGGESTIONS) })
  })
  await page.route('**/api/v1/address/details**', (r) => {
    calls.details.push({ url: r.request().url() })
    if (noKey) return r.fulfill({ status: 404, json: { success: false, data: null, message: null, errors: [] } })
    return r.fulfill({ json: envelope(PICKED) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page, calls }
}

// The Address & Living Arrangements card, in edit mode.
async function openEdit(page) {
  await page.goto(`${BASE_URL}/participants/p-0001?tab=about&section=home-and-living`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const heading = page.getByRole('heading', { name: 'Address & Living Arrangements' })
  await heading.waitFor({ state: 'visible', timeout: 60_000 })
  const card = heading.locator('xpath=ancestor::*[.//button[normalize-space()="Edit"]][1]')
  await card.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('Street').waitFor({ state: 'visible', timeout: 30_000 })
  return card
}

const popupOf = (page) => page.locator('div[style*="position: fixed"]').filter({ has: page.locator('[role="listbox"]') })
const emptyPopupOf = (page) => page.locator('div[style*="position: fixed"]').filter({ hasText: 'No matching address' })

// Relative luminance contrast of an element's text against the first opaque background above it, from computed styles.
const contrastOf = (locator) => locator.evaluate((el) => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 } }
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
  let bg = { r: 255, g: 255, b: 255, a: 1 }
  for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.99) { bg = c; break } }
  const [a, b] = [lum(parse(getComputedStyle(el).color)), lum(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
})

async function typeStreet(page, text) {
  const input = page.getByLabel('Street')
  await input.fill('')
  await input.focus()
  await input.pressSequentially(text)
  return input
}

const crop = async (page, locator, name, vp, also) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad: 16, also })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}

async function run(browser, vp) {
  const ctx = vp.name
  const { context, page, calls } = await openPage(browser, vp)
  try {
    const card = await openEdit(page)
    const input = page.getByLabel('Street')
    const suburb = page.getByLabel('Suburb')

    // Idle: a plain-looking input, a closed combobox, nothing asked.
    if (!vp.touch) await crop(page, card, `idle-${ctx}.png`, vp)
    check(`${ctx} idle: the street box is a closed combobox`, (await input.getAttribute('role')) === 'combobox' && (await input.getAttribute('aria-expanded')) === 'false', await input.getAttribute('aria-expanded'))
    check(`${ctx} idle: no lookup was made`, calls.suggest.length === 0, calls.suggest.length)

    // Under 3 characters: still nothing asked, no popup.
    await typeStreet(page, '12')
    await page.waitForTimeout(600)
    if (!vp.touch) await crop(page, card, `typing-under-3-${ctx}.png`, vp)
    check(`${ctx} typing under 3 characters asks nothing and opens nothing`, calls.suggest.length === 0 && (await page.locator('[role="listbox"]').count()) === 0, { calls: calls.suggest.length })

    // Suggestions.
    await typeStreet(page, '12 Exa')
    await popupOf(page).waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(400)
    const m = await page.evaluate(() => {
      const inputEl = document.querySelector('input[role="combobox"]')
      const list = document.querySelector('[role="listbox"]')
      const popup = list.parentElement
      const attribution = [...popup.querySelectorAll('p')].find((p) => p.textContent === 'Google Maps')
      const rows = [...list.querySelectorAll('[role="option"]')].map((r) => ({ h: r.getBoundingClientRect().height, sw: r.scrollWidth, cw: r.clientWidth }))
      const pr = popup.getBoundingClientRect(), ir = inputEl.getBoundingClientRect()
      const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;visibility:hidden;height:max(var(--control-h),var(--tap-min))'; document.body.append(probe)
      const rowMin = probe.getBoundingClientRect().height; probe.remove()
      const ar = attribution?.getBoundingClientRect()
      const ring = getComputedStyle(inputEl).boxShadow
      return {
        inputH: ir.height, inputW: ir.width, popupW: pr.width, popup: { l: pr.left, r: pr.right, t: pr.top, b: pr.bottom }, vw: document.documentElement.clientWidth, vh: innerHeight,
        docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, rows, rowMin, popupScroll: popup.scrollHeight - popup.clientHeight,
        attribution: ar ? { visible: ar.width > 0 && ar.height > 0, inPopup: ar.left >= pr.left - 1 && ar.right <= pr.right + 1 && ar.top >= pr.top - 1 && ar.bottom <= pr.bottom + 1, outsideListbox: !list.contains(attribution) } : null,
        ring, focused: document.activeElement === inputEl,
      }
    })
    check(`${ctx} input height equals --control-h (${vp.touch ? 44 : 32})`, Math.abs(m.inputH - (vp.touch ? 44 : 32)) <= 0.5, m.inputH)
    check(`${ctx} every option row is at least max(--control-h, --tap-min) (${m.rowMin})`, m.rows.length > 0 && m.rows.every((r) => r.h >= m.rowMin - 0.5), m.rows.map((r) => r.h))
    check(`${ctx} popup width equals input width (1px)`, Math.abs(m.popupW - m.inputW) <= 1, { popup: m.popupW, input: m.inputW })
    check(`${ctx} popup sits inside the viewport`, m.popup.l >= 0 && m.popup.r <= m.vw && m.popup.t >= 0 && m.popup.b <= m.vh, { popup: m.popup, vw: m.vw, vh: m.vh })
    if (vp.touch) check(`${ctx} no horizontal overflow at 390`, m.docOverflow <= 0, m.docOverflow)
    check(`${ctx} no row's content is wider than the row`, m.rows.every((r) => r.sw <= r.cw), m.rows.map((r) => [r.sw, r.cw]))
    check(`${ctx} at most 5 options`, m.rows.length >= 1 && m.rows.length <= 5, m.rows.length)
    check(`${ctx} the popup does not scroll with ${m.rows.length} rows`, m.popupScroll <= 1, m.popupScroll)
    check(`${ctx} "Google Maps" is visible, inside the popup and outside the listbox`, !!m.attribution && m.attribution.visible && m.attribution.inPopup && m.attribution.outsideListbox, m.attribution)
    const contrast = await contrastOf(popupOf(page).getByText('Google Maps'))
    check(`${ctx} "Google Maps" contrast is at least 4.5:1`, contrast >= 4.5, Math.round(contrast * 100) / 100)
    check(`${ctx} the focus ring is visible while the list is open`, m.focused && m.ring !== 'none' && /rgb/.test(m.ring), m.ring)
    const first = calls.suggest[calls.suggest.length - 1]
    check(`${ctx} suggest is a POST with no text in the URL, and a 22-character session`, first.method === 'POST' && !first.url.includes('?') && !first.url.includes('Exa') && /^[A-Za-z0-9_-]{22}$/.test(first.session), { method: first.method, url: first.url.replace(BASE_URL, ''), session: first.session?.length })

    await crop(page, input, vp.touch ? 'suggestions-390.png' : 'suggestions-desktop.png', vp, popupOf(page))

    // Keyboard: Down twice makes the second row active.
    if (!vp.touch) {
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      const active = await page.evaluate(() => {
        const el = document.querySelector('input[role="combobox"]')
        return { id: el.getAttribute('aria-activedescendant'), selected: [...document.querySelectorAll('[role="option"]')].findIndex((o) => o.getAttribute('aria-selected') === 'true') }
      })
      check(`${ctx} Down twice puts the second option active`, active.selected === 1 && !!active.id, active)
      await crop(page, input, `active-option-keyboard-${ctx}.png`, vp, popupOf(page))
      await page.keyboard.press('ArrowUp')   // back to the first row, which the pick below fixes on
    }

    // Pick the first row: the four fields hold the fixture exactly.
    if (vp.touch) await popupOf(page).getByRole('option').first().tap()
    else await page.keyboard.press('Enter')
    await page.waitForFunction((v) => document.querySelector('input[role="combobox"]')?.value === v, PICKED.street, { timeout: 30_000 })
    const filled = { street: await input.inputValue(), suburb: await suburb.inputValue(), state: await page.getByLabel('State').inputValue(), postcode: await page.getByLabel('Postcode').inputValue() }
    check(`${ctx} after a pick the four fields hold the fixture values`, filled.street === PICKED.street && filled.suburb === PICKED.suburb && filled.state === PICKED.state && filled.postcode === PICKED.postcode, filled)
    check(`${ctx} a pick closes the list and keeps focus in the street box`, (await page.locator('[role="listbox"]').count()) === 0 && (await input.evaluate((el) => document.activeElement === el)), '')
    await crop(page, card, `picked-filled-${ctx}.png`, vp)

    if (!vp.touch) {
      // Editing after a pick is plain typing: the other fields stay, the list may offer again.
      await input.pressSequentially(', Unit 4')
      await page.waitForTimeout(700)
      await page.keyboard.press('Escape')
      const kept = { street: await input.inputValue(), suburb: await suburb.inputValue(), postcode: await page.getByLabel('Postcode').inputValue() }
      check(`${ctx} editing the street after a pick leaves suburb and postcode alone`, kept.street === `${PICKED.street}, Unit 4` && kept.suburb === PICKED.suburb && kept.postcode === PICKED.postcode, kept)
      await crop(page, card, `edited-after-pick-${ctx}.png`, vp)

      // Nothing found.
      await typeStreet(page, 'zzzzzz')
      await emptyPopupOf(page).waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(300)
      check(`${ctx} none found: the invitation shows, with no list and no attribution`, (await page.locator('[role="listbox"]').count()) === 0 && (await emptyPopupOf(page).getByText('Google Maps').count()) === 0, '')
      await crop(page, input, `none-found-${ctx}.png`, vp, emptyPopupOf(page))
      await page.keyboard.press('Escape')
    }

    // One whole page per breakpoint, the list closed.
    const f = await fullPage(page, path.join(OUT_DIR, 'full', `address-edit-${ctx}.png`), { touch: vp.touch })
    checks.push(...f.checks)
  } catch (e) {
    check(`${ctx} script error`, false, String(e.message).split('\n')[0])
  }
  await context.close()
}

// No key: the first call is a 404, the field is a plain textbox and makes no further call.
async function runNoKey(browser, vp) {
  const ctx = `${vp.name} no key`
  const { context, page, calls } = await openPage(browser, vp, { noKey: true })
  try {
    const card = await openEdit(page)
    const input = page.getByLabel('Street')
    await typeStreet(page, '12 Exa')
    await page.waitForFunction(() => document.querySelector('input[role="combobox"]') === null, null, { timeout: 30_000 })
    const before = calls.suggest.length
    await input.pressSequentially('mple Street')
    await page.waitForTimeout(800)
    check(`${ctx}: the street box is a plain textbox`, (await page.getByRole('textbox', { name: 'Street' }).count()) === 1 && (await page.getByRole('combobox').count()) === 0, '')
    check(`${ctx}: no further lookup after the 404 (${before} so far)`, calls.suggest.length === before && before === 1, { before, after: calls.suggest.length })
    check(`${ctx}: typing still works`, (await input.inputValue()) === '12 Example Street', await input.inputValue())
    check(`${ctx}: nothing is shown to the person`, (await page.locator('[role="listbox"],[role="alert"]').count()) === 0, '')
    await crop(page, card, 'no-key-plain-1280.png', vp)
  } catch (e) {
    check(`${ctx} script error`, false, String(e.message).split('\n')[0])
  }
  await context.close()
}

const browser = await chromium.launch({ headless: true })
await run(browser, { name: '1280', width: 1280, height: 900, touch: false })
await run(browser, { name: '390', width: 390, height: 844, touch: true })
await runNoKey(browser, { name: '1280', width: 1280, height: 900, touch: false })
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
