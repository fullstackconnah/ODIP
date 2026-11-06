// Record administration modal: the Status group wraps at 390 (no overlap, no clipped label) and collapsed fields leave no gap above Notes. Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/med-status-toggle-390.mjs <outdir>
// Served by the mock API; sign-in stubbed as Admin; the MAR day is stubbed with page.route (one unrecorded slot to Record, one recorded slot to Amend). Clock pinned to 2026-11-06 10:00 Sydney.
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

const NOW = new Date('2026-11-06T10:00:00+11:00')
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.admin', fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = envelope([{ username: 'dev.admin', role: 'Admin', tenantName: 'Sample Support Co' }])
const adm = {
  id: 'adm-amend', participantMedicationId: 'med-0002', participantId: 'p-0001', participantName: 'Liam Okafor', medicationName: 'Levetiracetam', doseDescription: '500mg', tripInstanceId: null,
  scheduledAt: '2026-11-05T22:00:00', administeredAt: '2026-11-05T11:05:00Z', administeredAtTimeZone: 'Australia/Sydney', status: 'Administered', doseGiven: '500mg',
  recordedByName: "Jack O'Sullivan", recordedByUserId: 's-0003', witnessName: null, witnessStaffId: null, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null,
  reason: null, prnReason: null, prnOutcome: null, prnOutcomeAt: null, limitBreachAcknowledged: false, notes: null, createdAt: '2026-11-05T11:05:00Z', recordedWithoutCompetency: false,
  incidentId: null, amendmentReason: null, amendmentNote: null, amendedByName: null, amendedAt: null,
}
const entry = (administration) => ({
  medicationId: 'med-0002', participantId: 'p-0001', participantName: 'Liam Okafor', medicationName: 'Levetiracetam', strength: '500mg', doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', packaging: 'WebsterPack',
  pharmacyName: 'Riverside Pharmacy', pharmacyPhone: '07 3000 1111', scheduledTime: '22:00', scheduledAt: '2026-11-05T22:00:00', isHighRisk: false, supportLevel: 'Administer', isOverdue: false, administration, incidentId: null,
})
const mar = (administration) => envelope({ date: '2026-11-06', prnMedications: [], entries: [entry(administration)] })

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openModal(browser, vp, mode) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, reducedMotion: 'reduce' })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route('**/api/v1/medications/mar**', (r) => r.fulfill({ json: mar(mode === 'amend' ? adm : null) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await page.goto(`${BASE_URL}/medications`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.getByRole('button', { name: mode === 'amend' ? 'Amend' : 'Record', exact: true }).first().click({ timeout: 60_000 })
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(400)
  return { context, page, dialog }
}
const crop = async (page, locator, name, vp) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad: 16 })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
// A CSS custom property's resolved pixel value, read off a probe element.
const px = (page, tok) => page.evaluate((v) => { const d = document.createElement('div'); d.style.height = `var(${v})`; document.body.append(d); const h = d.getBoundingClientRect().height; d.remove(); return h }, tok)

const VPS = [{ name: '390', width: 390, height: 844, touch: true }, { name: '1280', width: 1280, height: 900, touch: false }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  for (const [mode, state] of [['record', `record-default-${vp.name}`], ...(vp.touch ? [['amend', 'amend-390']] : [])]) {
    try {
      const { context, page, dialog } = await openModal(browser, vp, mode)
      const group = dialog.getByRole('radiogroup')
      const radios = group.getByRole('radio')
      const boxes = await radios.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight, t: e.textContent } }))
      const gb = await group.boundingBox()
      const overlaps = []
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) overlaps.push([a.t, b.t])
      }
      check(t(`${mode}: five options, no two bounding boxes overlap`), boxes.length === 5 && overlaps.length === 0, overlaps)
      check(t(`${mode}: no clipped label (scrollWidth <= clientWidth, scrollHeight <= clientHeight)`), boxes.every((b) => b.sw <= b.cw && b.sh <= b.ch + 1), boxes.map((b) => [b.t, b.sw, b.cw, b.sh, b.ch]))
      const tap = await px(page, '--tap-min'), ctl = await px(page, '--control-h')
      check(t(`${mode}: each option height >= --tap-min (${tap}) and = --control-h (${ctl})`), boxes.every((b) => b.h >= tap - 0.5 && Math.abs(b.h - ctl) <= 0.5), boxes.map((b) => b.h))
      // Space between the Dose given input and the "Notes" label: the modal's own field gap is space-y-4 (1rem) plus FormField's label-to-control offset is inside the label, so the gap must be <= 16px.
      const gap = await page.evaluate(() => {
        const lab = (re) => [...document.querySelectorAll('[role="dialog"] label')].find((e) => re.test(e.textContent.trim()))
        const dose = lab(/^Dose given/), notes = lab(/^(Notes|What was given instead)/)
        const input = dose.closest('div').querySelector('input')
        return { toNotes: notes.getBoundingClientRect().top - input.getBoundingClientRect().bottom }
      })
      check(t(`${mode}: gap between the Dose given input and the Notes label <= 16px (modal field gap, space-y-4)`), gap.toNotes <= 16.5, gap)
      // The modal is narrower than the five labels side by side even at 1280, so the group wraps to two rows there too (main squeezed them, the same defect): allow at most two rows.
      if (!vp.touch) check(t(mode+": status group is at most two rows (height "+gb.height+" <= 2 x --control-h + gap, modal width "+(await dialog.boundingBox()).width+")"), gb.height <= 2*ctl + 8 + 0.5, gb.height)
      await crop(page, dialog, `${state}.png`, vp)
      if (mode === 'record') {
        await radios.nth(1).click()
        await page.waitForTimeout(300)
        const sel = await radios.nth(1).getAttribute('aria-checked')
        check(t('record: selecting Refused marks it checked'), sel === 'true', sel)
        if (vp.touch) await crop(page, dialog, 'record-selected-390.png', vp)
        checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${state}-page.png`), { touch: vp.touch })).checks)
      }
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }
}
await browser.close()
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
