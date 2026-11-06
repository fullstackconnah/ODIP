// Medication amendment reason: the amend form (reason picker and note) and the "Amended:" line on the participant Medications tab. Captures plus the SHAPE numeric checks N1 to N8. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/med-amend-reason.mjs <outdir>
// Served by the mock API; sign-in is stubbed as Admin. The MAR day, the participant's administrations and the amend PUT are stubbed with page.route (synthetic rows). The clock is pinned to 2026-11-06 10:00 Sydney.
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
const SERVER_ERROR = 'Could not save the amendment. Try again.'
const STAFF30 = 'Bartholomew Featherstonehaugh' // 30 characters
const NOTE200 = 'Entered against the wrong slot after the evening round; the dose was given at the time shown on the chart, so the recorded time was moved to match it and the original entry was left in the history.'

const adm = (id, over = {}) => ({
  id, participantMedicationId: 'med-0002', participantId: 'p-0001', participantName: 'Liam Okafor', medicationName: 'Levetiracetam', doseDescription: '500mg', tripInstanceId: null,
  scheduledAt: '2026-11-05T22:00:00', administeredAt: '2026-11-05T11:05:00Z', administeredAtTimeZone: 'Australia/Sydney', status: 'Administered', doseGiven: '500mg',
  recordedByName: "Jack O'Sullivan", recordedByUserId: 's-0003', witnessName: null, witnessStaffId: null, witnessStatus: 'NotRequired', witnessRequestedAt: null, witnessRespondedAt: null,
  reason: null, prnReason: null, prnOutcome: null, prnOutcomeAt: null, limitBreachAcknowledged: false, notes: null, createdAt: '2026-11-05T11:05:00Z', recordedWithoutCompetency: false,
  incidentId: null, amendmentReason: null, amendmentNote: null, amendedByName: null, amendedAt: null, ...over,
})
const AMENDABLE = adm('adm-amend')
const marDay = envelope({
  date: '2026-11-06', prnMedications: [], entries: [{
    medicationId: 'med-0002', participantId: 'p-0001', participantName: 'Liam Okafor', medicationName: 'Levetiracetam', strength: '500mg', doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', packaging: 'WebsterPack',
    pharmacyName: 'Riverside Pharmacy', pharmacyPhone: '07 3000 1111', scheduledTime: '22:00', scheduledAt: '2026-11-05T22:00:00', isHighRisk: false, supportLevel: 'Administer', isOverdue: false,
    administration: AMENDABLE, incidentId: null,
  }],
})
const HISTORY = envelope([
  adm('h-amended', { amendmentReason: 'EnteredInError', amendmentNote: NOTE200, amendedByName: STAFF30, amendedAt: '2026-11-06T01:42:00Z' }),
  adm('h-older', { administeredAt: '2026-11-04T11:05:00Z' }), // amended before the reason was required: reason null
  adm('h-plain', { administeredAt: '2026-11-03T11:05:00Z', medicationName: 'Risperidone' }),
])

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function openPage(browser, vp, { dark = false, fail = false } = {}) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  await context.clock.setFixedTime(NOW)
  const page = await context.newPage()
  const sent = []
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.route('**/api/v1/medications/mar**', (r) => r.fulfill({ json: marDay }))
  await page.route('**/api/v1/participants/p-0001/administrations**', (r) => r.fulfill({ json: HISTORY }))
  await page.route('**/api/v1/medications/administrations/*', async (r) => {
    sent.push(JSON.parse(r.request().postData() ?? '{}'))
    if (fail) return r.fulfill({ status: 400, json: { success: false, data: null, message: SERVER_ERROR, errors: [SERVER_ERROR] } })
    return r.fulfill({ json: envelope(AMENDABLE) })
  })
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  return { context, page, sent }
}

const setDark = (page, dark) => dark ? page.evaluate(() => { document.documentElement.dataset.theme = 'dark' }) : Promise.resolve()
const openAmend = async (page, dark) => {
  await page.goto(`${BASE_URL}/medications`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await setDark(page, dark)
  await page.getByRole('button', { name: 'Amend' }).first().click({ timeout: 60_000 })
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(400)
  return dialog
}
const openHistory = async (page, dark) => {
  await page.goto(`${BASE_URL}/participants/p-0001?tab=health&section=medications`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await setDark(page, dark)
  const box = page.locator('h3', { hasText: 'Recent administrations' }).locator('..')
  await box.getByText('Amended:').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(400)
  return box
}
const noOverflow = async (page, dialog, ctx) => {
  const m = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: innerWidth }))
  const body = await dialog.evaluate((d) => { let e = document.getElementById('amendment-reason'); for (; e && e !== d; e = e.parentElement) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) break } return { sw: e.scrollWidth, cw: e.clientWidth } })
  check(`${ctx}: no horizontal overflow (page and modal body)`, m.doc <= m.inner && body.sw <= body.cw, { ...m, ...body })
}
const crop = async (page, locator, name, vp, pad = 16) => {
  const r = await cropElement(page, locator, path.join(OUT_DIR, name), { touch: vp.touch, natural: true, pad })
  checks.push(checkCropHolds({ ...r, touch: vp.touch }))
}
// Relative luminance contrast of an element's text against the first opaque background above it, from computed styles.
const contrastOf = (locator) => locator.evaluate((el) => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 } }
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0)
  let bg = { r: 255, g: 255, b: 255, a: 1 }
  for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.99) { bg = c; break } }
  const [a, b] = [lum(parse(getComputedStyle(el).color)), lum(bg)]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
})

const VPS = [{ name: '1280', width: 1280, height: 900, touch: false }, { name: '390', width: 390, height: 844, touch: true }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const is390 = vp.touch

  // amend-default (light), with N1, N2, N3, N5
  try {
    const { context, page } = await openPage(browser, vp)
    const dialog = await openAmend(page, false)
    const select = page.locator('#amendment-reason')
    const sb = await select.boundingBox()
    check(t(`N1 select height ${is390 ? '>= 44' : '>= 36'}`), sb.height >= (is390 ? 44 : 36) - 0.5, sb.height)
    await noOverflow(page, dialog, t('N2 amend default'))
    const radio = await dialog.getByRole('radiogroup').first().boundingBox()
    check(t('N3 reason select sits above the Status group'), sb.y < radio.y, { select: sb.y, status: radio.y })
    if (is390) check(t('N3 both lie inside the 390 viewport on open'), sb.y >= 0 && sb.y + sb.height <= vp.height && radio.y >= 0 && radio.y + radio.height <= vp.height, { select: [sb.y, sb.y + sb.height], status: [radio.y, radio.y + radio.height], vh: vp.height })
    if (is390) {
      const fit = await select.evaluate((s) => {
        const cs = getComputedStyle(s), ctx = document.createElement('canvas').getContext('2d')
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
        const content = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 24
        return { text: ctx.measureText('Recorded for the wrong person').width, content }
      })
      check(t('N5 the longest label fits the closed select'), fit.text < fit.content, fit)
    }
    await crop(page, dialog, `amend-default-${vp.name}.png`, vp)
    if (is390) {
      // N4 and amend-reason-missing: scroll the modal to the bottom, Save with no reason.
      await dialog.evaluate((d) => { let e = document.getElementById('amendment-reason'); for (; e && e !== d; e = e.parentElement) { const o = getComputedStyle(e).overflowY; if ((o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight) break } e.scrollTop = e.scrollHeight; d.scrollTop = d.scrollHeight })
      await page.getByRole('button', { name: 'Save amendment' }).click()
      await page.waitForTimeout(400)
      const err = page.getByText('Required — choose why this record is being corrected')
      await err.waitFor({ state: 'visible', timeout: 10_000 })
      const eb = await err.boundingBox()
      const active = await page.evaluate(() => document.activeElement?.id)
      check(t('N4 error text is inside the viewport after Save'), eb.y >= 0 && eb.y + eb.height <= vp.height, { top: eb.y, bottom: eb.y + eb.height, vh: vp.height })
      check(t('N4 focus is on the select'), active === 'amendment-reason', active)
      await crop(page, dialog, 'amend-reason-missing-390.png', vp)
      // amend-other-note-missing: choose Other, Save with a blank note.
      await select.selectOption('Other')
      await page.getByRole('button', { name: 'Save amendment' }).click()
      await page.getByText('Required — say what was wrong').waitFor({ state: 'visible', timeout: 10_000 })
      await page.waitForTimeout(300)
      await noOverflow(page, dialog, t('N2 with the Other error showing'))
      await crop(page, dialog, 'amend-other-note-missing-390.png', vp)
    } else {
      await select.selectOption('Other')
      await page.getByRole('button', { name: 'Save amendment' }).click()
      await page.getByText('Required — say what was wrong').waitFor({ state: 'visible', timeout: 10_000 })
      await noOverflow(page, dialog, t('N2 with the Other error showing'))
    }
    await context.close()
  } catch (e) { check(t('amend form ran'), false, String(e.message).split('\n')[0]) }

  if (is390) {
    // amend-server-error-390: a reason is chosen, the server refuses.
    try {
      const { context, page, sent } = await openPage(browser, vp, { fail: true })
      const dialog = await openAmend(page, false)
      await page.locator('#amendment-reason').selectOption('WrongTime')
      await page.getByRole('button', { name: 'Save amendment' }).click()
      await page.getByText(SERVER_ERROR).first().waitFor({ state: 'visible', timeout: 10_000 })
      check(t('the PUT carries the chosen reason'), sent.length === 1 && sent[0].amendmentReason === 'WrongTime', sent)
      await crop(page, dialog, 'amend-server-error-390.png', vp)
      await context.close()
    } catch (e) { check(t('amend-server-error ran'), false, String(e.message).split('\n')[0]) }

    // amend-default-dark-390
    try {
      const { context, page } = await openPage(browser, vp, { dark: true })
      const dialog = await openAmend(page, true)
      await crop(page, dialog, 'amend-default-dark-390.png', vp)
      await context.close()
    } catch (e) { check(t('amend-default-dark ran'), false, String(e.message).split('\n')[0]) }
  }

  // history, light (and dark at 1280): N6, N7, N8
  for (const dark of vp.touch ? [false] : [false, true]) {
    const state = dark ? 'history-amended-dark' : 'history-amended'
    try {
      const { context, page } = await openPage(browser, vp, { dark })
      const box = await openHistory(page, dark)
      const rows = box.locator('div.p-3')
      const amended = rows.nth(0), older = rows.nth(1), plain = rows.nth(2)
      const line = amended.getByText('Amended:').first()
      const ratio = await contrastOf(line)
      check(t(`N7 ${dark ? 'dark' : 'light'}: history line contrast >= 4.5`), ratio >= 4.5, ratio.toFixed(2))
      if (!dark) {
        check(t('N8 an older row has no "Amended:" element'), (await older.getByText(/^Amended:/).count()) === 0, await older.innerText())
        check(t('N8 a never-amended row has no "Amended:" element'), (await plain.getByText(/^Amended:/).count()) === 0)
      }
      if (is390 && !dark) {
        const wide = await amended.evaluate((row) => [...row.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.tagName + ' ' + (e.textContent || '').trim().slice(0, 20)))
        check(t('N6 no element wider than its row'), wide.length === 0, wide)
        const broken = await amended.evaluate((row) => {
          const bad = []
          for (const p of row.querySelectorAll('p')) {
            const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
            for (let n = w.nextNode(); n; n = w.nextNode()) {
              for (const m of n.textContent.matchAll(/\S+/g)) {
                const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length)
                if (new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size > 1) bad.push(m[0].slice(0, 20))
              }
            }
          }
          return bad
        })
        check(t('N6 every line break falls at a space'), broken.length === 0, broken)
        const badge = async (row) => (await row.locator('span').filter({ hasText: /^Administered$/ }).first().boundingBox())
        const [ba, bp] = [await badge(amended), await badge(plain)]
        check(t('N6 the status badge keeps its width'), ba && bp && Math.abs(ba.width - bp.width) <= 1, { amended: ba?.width, plain: bp?.width })
      }
      const o = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      check(t(`${state}: no horizontal overflow`), o <= 0, o)
      await crop(page, box, `${state}-${vp.name}.png`, vp)
      if (!dark) checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${state}-${vp.name}.png`), { touch: vp.touch })).checks)
      if (is390 && !dark) await crop(page, older, 'history-older-row-390.png', vp)
      await context.close()
    } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
  }
}
await browser.close()
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
