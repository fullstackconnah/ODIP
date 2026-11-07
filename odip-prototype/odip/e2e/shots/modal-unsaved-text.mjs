// Modal unsaved text: Escape on a New note / Add risk dialog with typed text asks "Discard changes?" instead of closing.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/modal-unsaved-text.mjs <outdir>
// Served by the mock API; sign-in is stubbed as Admin. Captures note-prompt-390, note-prompt-1280, risk-prompt-390 (the dialog and the prompt over it).
// Numeric checks: the prompt is the topmost layer, its buttons are at least --tap-min (44) tall at 390, no horizontal overflow. Exit 1 on any failure.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, overlapCheck, writeChecks } from '../shots/lib/capture.mjs'

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

const checks = []
const check = (name, pass, detail = '') => {
  checks.push({ name, pass: !!pass, detail })
  console.log(`CHECK ${pass ? 'ok' : 'FAIL'} ${name} = ${JSON.stringify(detail)}`)
}

const browser = await chromium.launch({ headless: true })

async function openPage(vp) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, reducedMotion: 'reduce' })
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page }
}

// Types into the open dialog, presses Escape, then measures and shoots the prompt over the dialog.
async function shoot(vp, { section, tab, open, field, text, dialogName, file }) {
  const { context, page } = await openPage(vp)
  const ctx = `${file} ${vp.width}`
  try {
    await page.goto(`${BASE_URL}/participants/p-0001?tab=${tab}&section=${section}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByRole('button', { name: open }).first().click({ timeout: 60_000 })
    const dialog = page.getByRole('dialog', { name: dialogName })
    await dialog.waitFor({ state: 'visible', timeout: 30_000 })
    await dialog.getByLabel(field).first().fill(text)
    await page.keyboard.press('Escape')
    const prompt = page.getByRole('alertdialog', { name: 'Discard changes?' })
    await prompt.waitFor({ state: 'visible', timeout: 30_000 })
    check(`${ctx}: Escape with typed text asks instead of closing (dialog still open)`, await dialog.isVisible())

    const top = await page.evaluate(() => {
      const p = document.querySelector('[role="alertdialog"]')
      const hit = (el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && p.contains(h) }
      return { dialog: hit(p), buttons: [...p.querySelectorAll('button')].filter((b) => b.textContent.trim()).map((b) => ({ name: b.textContent.trim(), top: hit(b), h: Math.round(b.getBoundingClientRect().height * 10) / 10 })), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }
    })
    check(`${ctx}: the prompt is the topmost layer (nothing covers it or its buttons)`, top.dialog && top.buttons.length === 2 && top.buttons.every((b) => b.top), top)
    if (vp.touch) check(`${ctx}: prompt buttons are at least --tap-min (44px) tall`, top.buttons.every((b) => b.h >= 44), top.buttons.map((b) => b.h))
    check(`${ctx}: no horizontal overflow`, top.overflow <= 0, top.overflow)
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim())
    check(`${ctx}: focus is on Keep editing when the prompt opens`, focused === 'Keep editing', focused)

    const f = path.join(OUT_DIR, file)
    const r = await cropElement(page, prompt, f, { touch: vp.touch, also: dialog, pad: 16, during: (clip) => overlapCheck(prompt, clip, f) })
    checks.push(checkCropHolds({ ...r, touch: vp.touch }))
    checks.push(r.measured)

    await page.getByRole('button', { name: 'Keep editing' }).click()
    check(`${ctx}: Keep editing keeps the typed text`, (await dialog.getByLabel(field).first().inputValue()) === text)
  } catch (e) {
    check(`script error ${ctx}`, false, String(e.message).split('\n')[0])
  }
  await context.close()
}

const NOTE = { tab: 'records', section: 'notes', open: /new note/i, field: /title/i, text: 'Evening wind-down', dialogName: 'New note' }
await shoot({ width: 390, height: 844, touch: true }, { ...NOTE, file: 'note-prompt-390.png' })
await shoot({ width: 1280, height: 800, touch: false }, { ...NOTE, file: 'note-prompt-1280.png' })
await shoot({ width: 390, height: 844, touch: true }, { tab: 'health', section: 'risks', open: 'Add risk', field: /description/i, text: 'Slippery floor in the bathroom', dialogName: 'Add risk entry', file: 'risk-prompt-390.png' })
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
