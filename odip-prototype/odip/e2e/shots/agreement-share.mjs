// Agreement PR3b: send an agreement to a contact. Light theme, reduced motion, 390 touch and 1280.
// States (plan D-captures): the send dialog (default, a contact with no email, Failed, NotConfigured), the share line under the button (sent, opened, expired),
// the approval dialog with Agreed by / How, and the public page (valid, not valid). Data comes from the mock API (AGREEMENT_CONTACTS in mock-api/server.js; p-0004 has an
// approvable revision), except the no-email dialog, which routes the sharing answer to one contact with no address.
// Numeric checks (exit 1 on any failure): no horizontal scroll, and at 390 touch every button, link and select in each captured state is at least 44 px on both sides.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  ;({ chromium } = await import('@playwright/test'))
}

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const ROLE = 'Admin'
const username = `dev.${ROLE.toLowerCase()}`
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username, role: ROLE, tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: `Dev ${ROLE}`, role: ROLE, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

const VIEWPORTS = [
  { name: 'touch-390', width: 390, height: 844, touch: true },
  { name: 'desktop-1280', width: 1280, height: 900, touch: false },
]

const browser = await chromium.launch({ headless: true })
const checks = []
const check = (vp, name, ok, detail = '') => { checks.push({ name: `${vp} ${name}`, pass: !!ok, detail }); console.log(`[agreement-share] ${ok ? 'PASS' : 'FAIL'} ${vp} ${name}${detail ? ` (${detail})` : ''}`) }

/** Every visible button, link and select under `root` is at least 44 px on both sides (touch only). */
async function hitTargets(vp, label, root) {
  if (!vp.touch) return
  const small = await root.evaluate((el) => [...el.querySelectorAll('button, a[href], select')]
    // The house Modal close button is drawn 28 px and takes its 44 px hit area from a TAP_AREA pseudo-element, so its box is not its target.
    .filter((node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden' && node.getAttribute('aria-label') !== 'Close dialog')
    .map((node) => { const box = node.getBoundingClientRect(); return { text: (node.textContent || node.getAttribute('aria-label') || node.tagName).trim().slice(0, 30), w: Math.round(box.width), h: Math.round(box.height) } })
    .filter((box) => box.w < 44 || box.h < 44))
  check(vp.name, `${label}: no hit target under 44 px`, small.length === 0, small.map((box) => `${box.text} ${box.w}x${box.h}`).join('; '))
}

const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

try {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'en-AU', timezoneId: 'Australia/Sydney', hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
    const page = await context.newPage()
    const opts = { touch: vp.touch }
    const shot = async (locator, name, extra = {}) => {
      const result = await cropElement(page, locator, path.join(OUT_DIR, `${vp.name}-${name}.png`), { ...opts, ...extra })
      checks.push(checkCropHolds(result))
      return result
    }
    await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
    await signIn.waitFor({ state: 'visible', timeout: 60_000 })
    await signIn.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })

    // The Save step of p-0004's revision.
    const openSaveStep = async () => {
      await page.goto(`${BASE_URL}/participants/p-0004/agreement-draft`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const next = page.getByRole('button', { name: 'Next', exact: true })
      await next.waitFor({ state: 'visible', timeout: 60_000 })
      for (let i = 0; i < 3; i++) await next.click()
      await page.getByRole('button', { name: 'Mark approved for rostering', exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
      await page.evaluate(() => document.fonts.ready)
    }
    // The mock keeps its sent links between viewports; the first states start from none sent.
    const sharingGlob = '**/api/v1/participants/p-0004/service-agreement-drafts/*/sharing'
    await page.route(sharingGlob, async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      await route.fulfill({ response, json: { ...body, data: { ...body.data, shares: [] } } })
    })
    await openSaveStep()
    if (vp.touch) check(vp.name, 'pointer is coarse (touch emulation intact)', await page.evaluate(() => matchMedia('(pointer: coarse)').matches))

    const section = page.locator('section[aria-labelledby="save-send"]')
    const dialog = page.getByRole('dialog', { name: 'Send this agreement to a contact', exact: true })
    const sendButton = dialog.getByRole('button', { name: 'Send', exact: true })
    await shot(section, 'send-idle')
    await hitTargets(vp, 'send section', section)

    // Default dialog, then each outcome. Failed and NotConfigured leave the dialog open, so the contact is changed in place.
    await section.getByRole('button', { name: 'Send to a contact' }).click()
    await dialog.waitFor({ state: 'visible' })
    await shot(dialog, 'dialog-default')
    await hitTargets(vp, 'send dialog', dialog)
    check(vp.name, 'dialog starts on the default contact', (await dialog.getByLabel('Send to').inputValue()) === 'c-1')
    await dialog.getByLabel('Send to').selectOption('c-fail')
    await sendButton.click()
    await dialog.getByText("The email didn't go.").waitFor({ state: 'visible' })
    await shot(dialog, 'dialog-failed')
    await dialog.getByLabel('Send to').selectOption('c-config')
    await sendButton.click()
    await dialog.getByText("Email isn't set up for your organisation yet.").waitFor({ state: 'visible' })
    await shot(dialog, 'dialog-not-configured')
    await hitTargets(vp, 'send dialog with outcome', dialog)
    check(vp.name, 'dialog: no horizontal scroll', await noHScroll(page))
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

    // Sent and not opened, then opened, then expired: each send is the newest row.
    const send = async (contact) => {
      await section.getByRole('button', { name: /^Send (to a contact|again)$/ }).click()
      await dialog.waitFor({ state: 'visible' })
      await dialog.getByLabel('Send to').selectOption(contact)
      await sendButton.click()
      await dialog.waitFor({ state: 'hidden' })
    }
    await page.unroute(sharingGlob)
    await send('c-1')
    await page.getByText(/^Sent to Jo Lee on .* · not opened yet$/).waitFor({ state: 'visible' })
    await shot(section, 'share-sent')
    await send('c-opened')
    await page.getByText(/^Sent to Sam Park on .* · opened /).waitFor({ state: 'visible' })
    await shot(section, 'share-opened')
    await send('c-expired')
    await page.getByText(/^The link sent to Ari Cole on .* has expired\.$/).waitFor({ state: 'visible' })
    check(vp.name, 'expired: the button now reads Send again', (await section.getByRole('button', { name: 'Send again' }).count()) === 1)
    await shot(section, 'share-expired')
    await hitTargets(vp, 'share line states', section)

    // Approval dialog with the two optional fields, started from the live link's contact.
    await page.getByRole('button', { name: 'Mark approved for rostering', exact: true }).click()
    const approval = page.getByRole('dialog', { name: 'Approve this agreement for rostering?', exact: true })
    await approval.getByLabel('Agreed by').waitFor({ state: 'visible', timeout: 30_000 })
    check(vp.name, 'approval: Agreed by starts on the contact the link went to', (await approval.getByLabel('Agreed by').inputValue()) === 'c-expired')
    check(vp.name, 'approval: How starts on Email', (await approval.getByLabel('How').inputValue()) === 'Email')
    // The dialog is taller than the 390 viewport, so the crop is the Who agreed box itself: the Agreed by and How selects, then the typed name below.
    const whoBox = approval.locator('section[aria-labelledby="agreed-heading"]')
    // The sticky Cancel / Approve footer must not sit over the box: scroll the dialog so the box is at its top, measure once the crop has settled.
    const footer = approval.locator('div.sticky.bottom-0')
    const how = approval.getByLabel('How')
    const theirName = approval.getByRole('textbox', { name: 'Their name' })
    const scrollWho = () => whoBox.evaluate((box) => box.scrollIntoView({ block: 'start' }))
    const measure = (withInput) => async () => {
      const handles = await Promise.all([footer, how, ...(withInput ? [theirName] : [])].map((l) => l.elementHandle()))
      return whoBox.evaluate((box, [footerEl, howEl, inputEl]) => ({
        boxBottom: box.getBoundingClientRect().bottom, footerTop: footerEl.getBoundingClientRect().top,
        inputBottom: inputEl ? inputEl.getBoundingClientRect().bottom : null, howTop: howEl.getBoundingClientRect().top, howBottom: howEl.getBoundingClientRect().bottom,
      }), handles)
    }
    const checkClear = (label, { measured: m, clip }, withInput) => check(vp.name, `approval ${label}: Who agreed box (and name input) above the footer, How inside the crop`,
      m.boxBottom <= m.footerTop && (!withInput || m.inputBottom <= m.footerTop) && m.howTop >= clip.y && m.howBottom <= clip.y + clip.height, JSON.stringify({ ...m, clipY: clip.y, clipH: clip.height }))
    await scrollWho()
    checkClear('agreed by', await shot(whoBox, 'approval-agreed-by', { during: measure(false) }), false)
    await hitTargets(vp, 'approval dialog', approval)
    await approval.getByLabel('Agreed by').selectOption('other')
    await theirName.waitFor({ state: 'visible' })
    await theirName.fill('Pat Lee')
    await scrollWho()
    checkClear('someone else', await shot(whoBox, 'approval-someone-else', { during: measure(true) }), true)
    check(vp.name, 'approval: someone else shows the typed name in a visible input', (await theirName.inputValue()) === 'Pat Lee' && await theirName.isVisible() && (await whoBox.evaluate((box, input) => box.contains(input), await theirName.elementHandle())))
    await hitTargets(vp, 'approval dialog, someone else', approval)
    check(vp.name, 'approval: no horizontal scroll', await noHScroll(page))
    await approval.getByRole('button', { name: 'Cancel', exact: true }).click()

    // A revision whose only contact has no email: the dialog says so and offers the participant's page.
    await page.route(sharingGlob, (route) => route.fulfill({ json: envelope({ contacts: [{ personId: 'c-none', name: 'Pat Nominee', roles: 'Plan nominee', isDefault: false }], shares: [] }) }))
    await openSaveStep()
    await section.getByRole('button', { name: 'Send to a contact' }).click()
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByText('None of the contacts has an email recorded.').waitFor({ state: 'visible' })
    check(vp.name, 'no email: Send is disabled', await sendButton.isDisabled())
    await shot(dialog, 'dialog-no-email')
    await hitTargets(vp, 'no-email dialog', dialog)
    await page.unroute(sharingGlob)

    // The public page: valid (the full page at this width too), then a link that is not valid.
    await page.goto(`${BASE_URL}/agreement/mock-valid`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const download = page.getByRole('link', { name: 'Download PDF' })
    await download.waitFor({ state: 'visible', timeout: 30_000 })
    await page.evaluate(() => document.fonts.ready)
    check(vp.name, 'public: marked noindex', (await page.locator('meta[name="robots"][content="noindex"]').count()) === 1)
    check(vp.name, 'public: no approve control', (await page.getByRole('button').count()) === 0)
    await hitTargets(vp, 'public page', page.locator('main'))
    check(vp.name, 'public: no horizontal scroll', await noHScroll(page))
    await page.evaluate(() => window.scrollTo(0, 0))
    // The header sits above main: widen the crop to it so the crop starts above the h1 (the pad alone is clamped at the page top).
    const pub = await shot(page.locator('main'), 'public-valid-main', { also: page.locator('header').first() })
    const h1Top = await page.locator('h1').first().evaluate((el) => el.getBoundingClientRect().top)
    check(vp.name, 'public: h1 top is at least 8 px inside the crop', h1Top - pub.clip.y >= 8, `h1 top ${Math.round(h1Top)}, crop top ${Math.round(pub.clip.y)}`)
    // The Download PDF icon and label share one row (the link must be inline-flex at every width, not only under a coarse pointer).
    check(vp.name, 'public: Download PDF icon and label share one row', await download.evaluate((link) => {
      const icon = link.querySelector('svg').getBoundingClientRect()
      const range = document.createRange(); range.selectNodeContents([...link.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()))
      const label = range.getBoundingClientRect()
      return icon.top >= label.top - 1 && icon.top < label.bottom
    }))
    checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${vp.name}-public-valid.png`), opts)).checks)
    await page.goto(`${BASE_URL}/agreement/mock-expired`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText(/This link isn.t valid any more\./).waitFor({ state: 'visible', timeout: 30_000 })
    check(vp.name, 'public invalid: no horizontal scroll', await noHScroll(page))
    await shot(page.locator('main'), 'public-invalid')
    await context.close()
  }
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
