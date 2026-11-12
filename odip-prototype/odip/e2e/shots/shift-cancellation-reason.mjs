// Shift cancellation reason shots (SHAPE.md): the Cancellation reason field in the shift slide-over, and the "Cancellations by reason" Reports section.
// States: slideover-cancel-empty (390, desktop), -error, -chosen, -menu-open (390), slideover-old-no-reason, -view-reason, -view-no-reason (desktop), report-rows (390, desktop), report-empty (desktop).
// Numeric checks 1 to 10 of the shape (SHAPE L88-99); each cites its token or component. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/shift-cancellation-reason.mjs <outdir>
// The board and the reports come from the mock API; only sign-in is stubbed. The week (?date=), the clock, the theme (light) and the zone (Sydney) are pinned.
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, fullPage, layoutCheck, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }
const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
prepareOutDir(OUT_DIR)

const WEEK = '2026-09-07'
const NOW = new Date('2026-09-06T23:00:00Z')   // 9:00 am Monday 7 Sep in Sydney: every fixture shift is still ahead
const FROM = '2026-09-28', TO = '2026-10-25'
const USER_ID = '00000000-0000-0000-0000-0000000000a1'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const checks = []
const check = (name, pass, detail = '') => { checks.push({ name, pass: !!pass, detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`) }
const token = (page, name, prop = 'height') => page.evaluate(([t, p]) => { const el = document.createElement('div'); el.style[p] = `var(${t})`; document.body.append(el); const v = el.getBoundingClientRect()[p]; el.remove(); return v }, [name, prop])
const shot = async (page, locator, name, vp, opts = {}) => {
  const file = path.join(OUT_DIR, `${name}-${vp.name}.png`)
  const crop = await cropElement(page, locator, file, { touch: vp.touch, pad: 12, ...opts })
  checks.push(checkCropHolds({ ...crop, touch: vp.touch }))
  if (opts.during) checks.push(crop.measured)
}

const REASONS = [
  'Participant unwell', 'Participant family matter', 'Participant transport unavailable', 'Participant did not attend', 'Participant cancelled, other reason',
  'Staff unavailable', 'Cancelled by the provider', 'Weather or emergency', 'Rostered by mistake', 'Other',
]
const VIEWPORTS = [{ name: '390', width: 390, height: 844, touch: true }, { name: 'desktop', width: 1280, height: 1400, touch: false }]

async function newPage(browser, vp, role) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, colorScheme: 'light', reducedMotion: 'reduce' })
  await context.addInitScript(([id]) => { try { localStorage.setItem('odip_ui_prefs:' + id, JSON.stringify({ theme: 'light' })) } catch { /* storage blocked */ } }, [USER_ID])
  const page = await context.newPage()
  if (vp.touch) {   // the touch emulation alone left `pointer: coarse` false on the first page of a run; pin it so the 44px tokens apply
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }] })
  }
  page.on('pageerror', (e) => check(`${vp.name} page error`, false, e.message))
  const login = envelope({ id: USER_ID, token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.u', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: envelope([{ username: 'dev.u', role, tenantName: 'Sample Support Co' }]) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const btn = page.getByRole('button', { name: 'Sign in as selected user' })
  await btn.waitFor({ state: 'visible', timeout: 60_000 })
  await btn.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 })
  await context.clock.setFixedTime(NOW)
  return { context, page }
}

// Opens a board shift's slide-over and returns it.
async function openShift(page, id, viaParticipant = false) {   // a ReadOnly user reaches a shift panel only on the participant week
  await page.goto(viaParticipant ? `${BASE_URL}/participants/p-0001?tab=people&section=week&week=${WEEK}` : `${BASE_URL}/rostering?date=${WEEK}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  if (viaParticipant) {   // the week card mounts when it scrolls in
    await page.getByRole('tab', { name: /People/ }).first().click({ timeout: 5000 }).catch(() => {})
    for (let y = 0; y < 8; y++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(250) }
  }
  const chip = page.locator(`[data-shift-open="${id}"]`).first()
  await chip.waitFor({ state: 'attached', timeout: 30_000 }).catch(async (e) => {
    throw new Error(`no chip ${id} at ${page.url()}; chips: ${(await page.locator('[data-shift-open]').evaluateAll((l) => l.map((x) => x.getAttribute('data-shift-open')))).join(',')}; headings: ${(await page.locator('h1,h2,h3,h4').allInnerTexts()).join('|').slice(0, 400)}`)
  })
  await chip.scrollIntoViewIfNeeded()
  await chip.click({ position: { x: 6, y: 6 }, timeout: 15_000 })  // the chip's centre can sit on a name link, which navigates
  const dlg = page.getByRole('dialog').first()
  await dlg.getByLabel(/^Status/).first().waitFor({ timeout: 15_000 }).catch(async (e) => {
    const n = await page.getByRole('dialog').count()
    console.log('DEBUG openShift', id, page.url(), 'dialogs', n, (n ? await page.getByRole('dialog').first().innerText() : await page.locator('body').innerText()).slice(0, 600).replace(/\n+/g, ' | '))
    throw e
  })
  await page.waitForTimeout(500)
  return dlg
}
const chooseStatus = async (page, dlg, name) => { await dlg.getByLabel(/^Status/).first().click(); await page.getByRole('option', { name, exact: true }).click() }
const reasonTrigger = (dlg) => dlg.getByLabel(/^Cancellation reason/)

for (const vp of VIEWPORTS) {
  const tag = vp.name
  const fine = !vp.touch
  const browser = await chromium.launch()
  try {
    // ---- the shift slide-over, as an admin ----
    const { context, page } = await newPage(browser, vp, 'Admin')
    let dlg = await openShift(page, 'board-shift-0001')
    const controlH = await token(page, '--control-h'); const tapMin = await token(page, '--tap-min')
    check(`pointer is ${fine ? 'fine' : 'coarse'} (${tag})`, (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) === !!vp.touch, `--control-h ${controlH}, --tap-min ${tapMin}`)

    await chooseStatus(page, dlg, 'Cancelled')
    const trig = reasonTrigger(dlg); await trig.waitFor({ timeout: 10_000 })
    const status = dlg.getByLabel(/^Status/).first()
    const [sb, rb] = [await status.boundingBox(), await trig.boundingBox()]
    check(`2 reason trigger height == Status trigger == --control-h (${tag})`, Math.abs(rb.height - sb.height) <= 0.5 && Math.abs(rb.height - controlH) <= 0.5, `${rb.height} / ${sb.height} / ${controlH}`)
    check(`3 reason trigger left and right edges == Status trigger's (${tag})`, Math.abs(rb.x - sb.x) <= 0.5 && Math.abs(rb.x + rb.width - sb.x - sb.width) <= 0.5, `${rb.x},${rb.x + rb.width} vs ${sb.x},${sb.x + sb.width}`)
    const labels = await dlg.locator('label').allInnerTexts()
    const at = labels.findIndex((t) => /^Status/.test(t.trim()))
    check(`4 the reason FormField is the next one after Status (${tag})`, at >= 0 && /^Cancellation reason/.test((labels[at + 1] ?? '').trim()), JSON.stringify(labels.slice(Math.max(0, at - 1), at + 3)))
    check(`1a no horizontal overflow, slide-over (${tag})`, await page.evaluate(() => { const d = document.scrollingElement; return d.scrollWidth <= d.clientWidth }), '')
    check(`1b slide-over fits itself (${tag})`, await dlg.evaluate((el) => el.scrollWidth <= el.clientWidth), '')
    check(`placeholder shown, field required (${tag})`, /Choose a reason/.test(await trig.innerText()) && /\*/.test(await dlg.getByText(/^Cancellation reason/).first().innerText()), '')
    await shot(page, dlg, 'slideover-cancel-empty', vp, { ...(vp.touch ? {} : { pad: 0 }), during: () => layoutCheck(page, dlg, `slide-over cancel (${tag})`) })   // measured with the viewport grown to the whole panel, so no field is scrolled under the sticky head or foot

    // error: Save with no reason
    await dlg.getByRole('button', { name: 'Save' }).click()
    const err = dlg.getByText('Choose a cancellation reason.')
    await err.waitFor({ timeout: 10_000 })
    const e = await err.evaluate((el) => {
      let p = el.parentElement; while (p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p = p.parentElement
      return { visible: el.getBoundingClientRect().height > 0, scrollBody: !!p, sw: p?.scrollWidth, cw: p?.clientWidth, own: el.scrollWidth <= el.clientWidth }
    })
    check(`5 error visible inside the scroll body, no overflow, trigger aria-invalid (${tag})`, e.visible && e.scrollBody && e.sw <= e.cw && e.own && (await trig.getAttribute('aria-invalid')) === 'true', e)
    await shot(page, dlg, 'slideover-cancel-error', vp, vp.touch ? {} : { pad: 0 })

    // menu: ten rows in order, each tall enough, as wide as the trigger
    await trig.click()
    const list = page.getByRole('listbox').first(); await list.waitFor({ timeout: 10_000 })
    const rows = list.getByRole('option')
    const m = await rows.evaluateAll((els) => els.map((x) => ({ t: x.textContent.trim(), h: x.getBoundingClientRect().height })))
    const [lb, tb] = [await list.boundingBox(), await trig.boundingBox()]
    check(`7 menu: ten rows in order, row height >= --tap-min on touch, panel width == trigger width (${tag})`,
      JSON.stringify(m.map((r) => r.t)) === JSON.stringify(REASONS) && (fine || m.every((r) => r.h >= tapMin - 0.5)) && Math.abs(lb.width - tb.width) <= 1, { heights: m.map((r) => Math.round(r.h)), panel: lb.width, trigger: tb.width })
    if (vp.touch) await shot(page, list, 'slideover-cancel-menu-open', vp, { also: trig })   // the open panel covers the form, so the panel and its trigger are the subject

    // chosen: the two longest labels hold on one line
    for (const [name, state] of [['Participant cancelled, other reason', 'slideover-cancel-chosen'], ['Participant transport unavailable', null]]) {
      if (!(await list.isVisible().catch(() => false))) await trig.click()
      await page.getByRole('option', { name, exact: true }).click()
      await page.waitForTimeout(200)
      const t = await trig.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height, inner: [...el.querySelectorAll('*')].every((c) => c.scrollWidth <= c.clientWidth + 1) }))
      check(`6 "${name}" fits the trigger and the height stays --control-h (${tag})`, t.sw <= t.cw && t.inner && Math.abs(t.h - controlH) <= 0.5, t)
      if (state && vp.touch) await shot(page, dlg, state, vp)
    }
    await context.close()

    // desktop only: an old cancelled shift with no reason (optional, saves as is)
    if (fine) {
      const ctx2 = await newPage(browser, vp, 'Admin')
      const old = await openShift(ctx2.page, 'board-shift-0004')
      await reasonTrigger(old).waitFor({ timeout: 10_000 })
      check(`old shift: placeholder shown and not marked required (${tag})`, /Choose a reason/.test(await reasonTrigger(old).innerText()) && !/\*/.test(await old.getByText(/^Cancellation reason/).first().innerText()), '')
      await shot(ctx2.page, old, 'slideover-old-no-reason', vp, { pad: 0 })
      await ctx2.context.close()

      // slideover-view-reason and slideover-view-no-reason are not captured: ReadOnly is refused /rostering and the participant week (support-type.mjs says the same), so no
      // signed-in user reaches the view-only panel; ShiftSlideOver.test.tsx covers canWrite false (reason shown disabled, field absent when none recorded).
    }

    // ---- the report ----
    const rep = await newPage(browser, vp, 'Admin')
    const go = async (url) => { await rep.page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 }) }
    await go(`/reports?from=${FROM}&to=${TO}`)
    const section = rep.page.locator('section[aria-labelledby="cancellations-by-reason-heading"]')
    await section.locator('tbody tr').first().waitFor({ timeout: 60_000 })
    await rep.page.waitForTimeout(500)
    const pos = await rep.page.evaluate(() => {
      const a = document.getElementById('shift-fulfilment-heading'), b = document.getElementById('cancellations-by-reason-heading'), c = document.getElementById('leave-taken-heading')
      const after = (x, y) => !!(x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING)
      return a && b && c && after(a, b) && after(b, c)
    })
    check(`9 section sits after shift fulfilment and before leave taken (${tag})`, pos, '')
    const full = await fullPage(rep.page, path.join(OUT_DIR, 'full', `report-rows-${tag}.png`), { touch: vp.touch })
    checks.push(...full.checks)
    // house list: collapsed to 5 rows with a Show all button; check 10 and the capture run expanded
    await section.getByRole('button', { name: 'Show all 11' }).click()
    await rep.page.waitForTimeout(300)
    const order = await section.locator('tbody tr').evaluateAll((trs) => trs.map((r) => r.textContent.trim()))
    check(`10 "Not recorded" is the last row, unsorted (${tag})`, order.length === 11 && /^Not recorded/.test(order[order.length - 1]), order)
    const cells = await section.locator('th, td').evaluateAll((els) => els.map((x) => ({ t: x.textContent.trim().slice(0, 30), sw: x.scrollWidth, cw: x.clientWidth })).filter((c) => c.sw > c.cw))
    check(`8a report cells do not overflow (${tag})`, cells.length === 0, cells)
    if (fine) {
      const right = await section.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => {
        const td = tr.querySelectorAll('td')[1]; const r = document.createRange(); r.selectNodeContents(td)
        const cs = getComputedStyle(td); return td.getBoundingClientRect().right - parseFloat(cs.paddingRight) - r.getBoundingClientRect().right
      }))
      check(`8b count cells right aligned (${tag})`, right.every((d) => Math.abs(d) <= 2), right.map((d) => Math.round(d)))
    }
    check(`1c no horizontal overflow, Reports (${tag})`, await rep.page.evaluate(() => { const d = document.scrollingElement; return d.scrollWidth <= d.clientWidth }), '')
    await shot(rep.page, section, 'report-rows', vp, { natural: true })

    if (fine) {
      await rep.page.route(/\/api\/v1\/reports\/cancellations-by-reason/, (r) => r.fulfill({ json: envelope([]) }))
      await go(`/reports?from=${FROM}&to=${TO}`)
      await section.getByText('No cancelled shifts in this range. Try a wider date range.').waitFor({ timeout: 60_000 })
      await shot(rep.page, section, 'report-empty', vp)
    }
    await rep.context.close()
  } finally { await browser.close() }
}

const ok = writeChecks(OUT_DIR, checks)
process.exit(ok ? 0 : 1)
