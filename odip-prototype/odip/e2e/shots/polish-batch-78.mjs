// Captures and numeric checks for polish batch 78: a disabled row action (Patterns, "Generate shifts" on an inactive pattern) stays in the tab order, reads its reason as a description, looks disabled and runs nothing.
// Run through the runner: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <absolute path to this script> <outdir>
// Routed: sign-in as a Coordinator; GET /rostering/patterns answers the mock API's two patterns with the second one inactive; every other call goes to the mock API.
import path from 'node:path'
import { AU_CONTEXT, cropElement, fullPage, prepareOutDir, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const STATES = [{ name: '390', width: 390, height: 844 }, { name: '1280', width: 1280, height: 900 }]
const REASON = 'Inactive patterns generate nothing'
// The Generate shifts dialog is a ConfirmDialog, which is role="alertdialog": a bare [role=dialog] would never see it.
const DIALOG = '[role=dialog], [role=alertdialog]'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a2', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator' })
const checks = []
const add = (name, detail, pass) => checks.push({ name, detail, pass: !!pass })

async function route(page) {
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: devLogin }))
  // The mock has two patterns, both active: the second (Grace Palmer-Hughes) reads inactive.
  await page.route('**/api/v1/rostering/patterns*', async (r) => {
    if (r.request().method() !== 'GET') return r.continue()
    const res = await r.fetch()
    const body = await res.json()
    if (Array.isArray(body?.data) && body.data.length > 1) body.data[1] = { ...body.data[1], isActive: false }
    return r.fulfill({ response: res, json: body })
  })
}

const rowOf = (page, who) => page.locator('tbody tr', { hasText: who }).first()
const generateIn = (row) => row.getByRole('button', { name: /^Generate shifts for / })
const editIn = (row) => row.getByRole('button', { name: /^Edit / })

// Keyboard scene at 1280: Tab onto the inactive row's Generate button, read what it is, shoot it, press Enter on it.
async function keyboardScene(page, inactive, active) {
  await editIn(inactive).focus()
  await page.keyboard.press('Tab')
  const focused = await page.evaluate(() => {
    const el = document.activeElement
    const id = el?.getAttribute('aria-describedby')
    return {
      label: el?.getAttribute('aria-label') ?? null,
      ariaDisabled: el?.getAttribute('aria-disabled') ?? null,
      disabledAttr: !!el?.disabled,
      row: el?.closest('tr')?.textContent?.includes('Grace Palmer-Hughes') ?? false,
      focusVisible: !!el?.matches(':focus-visible'),
      describedText: id ? document.getElementById(id)?.textContent ?? null : null,
    }
  })
  add('Tab lands on the inactive row\'s "Generate shifts" button, aria-disabled and not disabled', focused,
    /^Generate shifts for /.test(focused.label ?? '') && focused.ariaDisabled === 'true' && !focused.disabledAttr && focused.row && focused.focusVisible)
  add('its accessible description is the reason', { describedText: focused.describedText }, focused.describedText === REASON)

  const crop = await cropElement(page, inactive, path.join(OUT_DIR, 'rowmenu-disabled-focus-1280.png'), { touch: false, hideChrome: true, pad: 16 })
  add('crop holds the whole element: rowmenu-disabled-focus-1280.png', { clip: crop.clip, overlap: crop.overlap }, crop.overlap?.pass !== false)

  // Opacity: only the icon dims. The disabled button's own opacity stays 1 (opacity on the button dims its focus ring too); its svg is the enabled sibling's (Edit, same row) at half strength.
  const op = await page.evaluate(() => {
    const el = document.activeElement
    const sib = [...el.closest('tr').querySelectorAll('button')].find((b) => /^Edit /.test(b.getAttribute('aria-label') ?? ''))
    return { button: parseFloat(getComputedStyle(el).opacity), svg: parseFloat(getComputedStyle(el.querySelector(':scope > svg')).opacity), siblingSvg: parseFloat(getComputedStyle(sib.querySelector(':scope > svg')).opacity), cursor: getComputedStyle(el).cursor }
  })
  add('disabled button opacity 1, its icon = enabled sibling icon x 0.5 (within 0.01), cursor not-allowed', op, op.button === 1 && Math.abs(op.svg - op.siblingSvg * 0.5) <= 0.01 && op.cursor === 'not-allowed')

  // Focus ring: the focused disabled button's ring is the focused enabled sibling's. Computed outline-color ignores opacity, so also compare the effective opacity (the product up the ancestor chain).
  const ring = () => page.evaluate(() => {
    const el = document.activeElement
    const cs = getComputedStyle(el)
    let effective = 1
    for (let n = el; n; n = n.parentElement) effective *= parseFloat(getComputedStyle(n).opacity)
    return { label: el.getAttribute('aria-label'), focusVisible: el.matches(':focus-visible'), color: cs.outlineColor, style: cs.outlineStyle, width: cs.outlineWidth, effective }
  })
  const disabledRing = await ring()
  await page.keyboard.press('Shift+Tab')
  const enabledRing = await ring()
  add("focus ring at full strength: the disabled button's outline matches the focused enabled sibling's (colour, solid, width, effective opacity within 0.01)", { disabledRing, enabledRing },
    /^Edit /.test(enabledRing.label ?? '') && disabledRing.focusVisible && enabledRing.focusVisible && disabledRing.color === enabledRing.color && disabledRing.style === 'solid' && disabledRing.style === enabledRing.style && disabledRing.width === enabledRing.width && disabledRing.width !== '0px' && Math.abs(disabledRing.effective - enabledRing.effective) <= 0.01)
  await page.keyboard.press('Tab')
  const back = await ring()
  add('Tab returns to the disabled "Generate shifts" button', back, /^Generate shifts for /.test(back.label ?? ''))

  // Enter fires click on a button: nothing may open.
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)
  const dialogs = await page.locator(DIALOG).count()
  add('Enter on the disabled button opens no dialog or alertdialog (500 ms)', { dialogs }, dialogs === 0)

  // Control for the check above: Enter on the active pattern's button does open the dialog.
  await generateIn(active).focus()
  await page.keyboard.press('Enter')
  const opened = await page.locator(DIALOG).first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)
  add('control: Enter on an active pattern\'s "Generate shifts" opens a dialog', { opened }, opened)
  await page.keyboard.press('Escape')
  await page.locator(DIALOG).first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})

  // Hover on a mouse: a disabled item shows no wash. Control: its enabled sibling does, so the check can fail.
  await page.evaluate(() => document.activeElement?.blur())
  await page.mouse.move(2, 2)
  const paint = (loc) => loc.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
  const rest = await paint(generateIn(inactive))
  await generateIn(inactive).hover()
  await page.waitForTimeout(300)
  const hovered = await paint(generateIn(inactive))
  add('hovering the disabled button leaves its background rgba(0, 0, 0, 0) (300 ms)', { rest, hovered, colorChanged: rest.color !== hovered.color }, hovered.bg === 'rgba(0, 0, 0, 0)')
  await editIn(inactive).hover()
  await page.waitForTimeout(300)
  const siblingHover = await paint(editIn(inactive))
  add('control: hovering the enabled sibling shows a background wash', siblingHover, siblingHover.bg !== 'rgba(0, 0, 0, 0)')

  // Enabled row on a mouse: hover reveals its actions. cropElement parks the mouse before it shoots, so hover inside `during` (after that, just before the screenshot) and wait up to 2 s for the overlay's own reveal (opacity 1).
  const reveal = () => active.evaluate((row) => {
    const overlay = row.querySelector('button[aria-label^="Edit "]').parentElement
    const actions = [...overlay.querySelectorAll('a, button')]
    return { overlay: parseFloat(getComputedStyle(overlay).opacity), actions: actions.length, minActionOpacity: Math.min(...actions.map((a) => parseFloat(getComputedStyle(a).opacity))), minIconOpacity: Math.min(...actions.map((a) => parseFloat(getComputedStyle(a.querySelector(':scope > svg')).opacity))) }
  })
  const enabled = await cropElement(page, active, path.join(OUT_DIR, 'rowmenu-enabled-1280.png'), {
    touch: false, hideChrome: true, pad: 16,
    during: async () => {
      await active.hover()
      const deadline = Date.now() + 2000
      let m = await reveal()
      while (m.overlay !== 1 && Date.now() < deadline) { await page.waitForTimeout(50); m = await reveal() }
      return m
    },
  })
  add('crop holds the whole element: rowmenu-enabled-1280.png', { clip: enabled.clip, overlap: enabled.overlap }, enabled.overlap?.pass !== false)
  add('enabled crop taken with the row actions revealed: overlay opacity 1, 3 or more actions, each button and icon at opacity 1', enabled.measured,
    enabled.measured?.overlay === 1 && enabled.measured.actions >= 3 && enabled.measured.minActionOpacity === 1 && enabled.measured.minIconOpacity === 1)
  const state = await generateIn(active).evaluate((el) => ({ ariaDisabled: el.getAttribute('aria-disabled'), disabledAttr: el.disabled, describedby: el.getAttribute('aria-describedby') }))
  add('an enabled item has no aria-disabled, is not disabled and has no description', state, state.ariaDisabled === null && !state.disabledAttr && state.describedby === null)
  await page.mouse.move(2, 2)
}

const browser = await chromium.launch({ headless: true })
try {
  for (const st of STATES) {
    const mobile = st.width === 390
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: st.width, height: st.height }, hasTouch: mobile, isMobile: mobile })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-11-09T10:00:00+11:00'))
    page.on('pageerror', (e) => add(`page error [${st.name}]`, e.message, false))
    await route(page)
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const btn = page.getByRole('button', { name: 'Sign in as selected user' })
      await btn.waitFor({ state: 'visible', timeout: 60_000 })
      await btn.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })

      await page.goto(`${BASE_URL}/rostering/patterns`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      const inactive = rowOf(page, 'Grace Palmer-Hughes')
      const active = rowOf(page, 'Liam Okafor')
      await inactive.waitFor({ state: 'visible', timeout: 60_000 })
      await active.waitFor({ state: 'visible', timeout: 60_000 })

      if (!mobile) await keyboardScene(page, inactive, active)

      const full = await fullPage(page, path.join(OUT_DIR, `patterns-${st.name}.png`), { touch: mobile })
      checks.push(...full.checks)
    } catch (e) {
      add(`scenes ran [${st.name}]`, String(e.message).split('\n').slice(0, 5).join(' | ').slice(0, 500), false)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
