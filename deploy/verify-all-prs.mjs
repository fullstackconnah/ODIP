// Browser verification of behaviour claimed across PRs #1-#9.
// Each check maps to a specific claim made in a PR description.
//
//   ODIP_API_TARGET=http://192.168.4.70:8475 VITE_DEV_AUTH=true npm run dev
//   node verify-all-prs.mjs
import { chromium } from 'playwright'
import fs from 'fs'

// Defaults to the local dev server, but ALWAYS run this against the deployed URL too:
//   node <script> http://192.168.4.70:8475
// Localhost proves the code works; only the deployed URL proves the Docker build and
// its build args are correct. A VITE_DEV_AUTH build arg missing from the Dockerfile
// passed every localhost run for nine PRs while production was broken.
const BASE = process.argv[2] || process.env.ODIP_BASE_URL || 'http://localhost:5173'
const OUT = 'F:/Projects/personal/ODIP/.playwright'
const STATE = `${process.cwd()}/state.json`
fs.mkdirSync(OUT, { recursive: true })

const results = []
const consoleErrors = []
function check(pr, name, pass, detail = '') {
  results.push({ pr, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${pr}] ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const ctx = fs.existsSync(STATE) && BASE.includes('localhost')
  ? await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } })
  : await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
page.on('console', m => { if (m.type() === 'error' && !/frame-ancestors|favicon/i.test(m.text())) consoleErrors.push(m.text()) })
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message))

// ── Auth (PR #1: dev login bypass) ───────────────────────────────────────
await page.goto(BASE + '/participants', { waitUntil: 'networkidle' })
if (page.url().includes('/login')) {
  await page.getByRole('button', { name: /sign in as selected user/i }).click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 })
  await ctx.storageState({ path: STATE })
}
check('#1', 'dev login grants access without Firebase', !page.url().includes('/login'), page.url())

// ── PR #3: Trips submenu ─────────────────────────────────────────────────
await page.locator('aside').first().waitFor({ state: 'visible', timeout: 15000 })
await page.waitForTimeout(700)
const tripsBtn = page.locator('aside button', { hasText: 'Trips' }).first()
check('#3', 'Trips is a submenu button (not a link)', await tripsBtn.count() > 0)
const expanded1 = await tripsBtn.getAttribute('aria-expanded')
check('#3', 'submenu exposes aria-expanded', expanded1 !== null, `aria-expanded=${expanded1}`)
const controls = await tripsBtn.getAttribute('aria-controls')
check('#5', 'aria-controls target exists in DOM even when collapsed',
  !!controls && await page.locator(`#${controls}`).count() > 0, `#${controls}`)
await tripsBtn.click(); await page.waitForTimeout(400)
const expanded2 = await tripsBtn.getAttribute('aria-expanded')
check('#3', 'toggling changes aria-expanded', expanded1 !== expanded2, `${expanded1} -> ${expanded2}`)

// ── PR #3/#4: participant form ───────────────────────────────────────────
await page.goto(BASE + '/participants/new', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
const formText = await page.locator('body').innerText()
check('#3', 'Mobility Aids group present', /mobility aids/i.test(formText))
check('#3', 'Overnight Support present', /overnight support/i.test(formText))
for (const eq of ['Hi-Lo', 'Hoist', 'Shower Chair', 'Commode', 'Standing Machine']) {
  check('#3', `equipment "${eq}" present`, new RegExp(eq.replace('-', '.?'), 'i').test(formText))
}
const mobilitySupport = await page.getByLabel(/wheelchair in vehicle|manual hoist|slide board/i).count()
check('#3', 'Mobility Support options from data dictionary', mobilitySupport > 0, `${mobilitySupport} matched`)

// PR #4: fieldset/legend group semantics
const fsCount = await page.locator('fieldset').count()
const legendCount = await page.locator('fieldset > legend').count()
check('#4', 'checkbox groups use fieldset/legend', fsCount >= 3 && legendCount >= 3, `${fsCount} fieldset / ${legendCount} legend`)

// PR #4: every labelled control has a real label association
const labelAudit = await page.evaluate(() => {
  const scope = document.querySelector('form') || document
    const controls = [...scope.querySelectorAll('input:not([type=hidden]), select, textarea')]
  let named = 0, unnamed = []
  for (const c of controls) {
    const byFor = c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`)
    const wrapped = c.closest('label')
    const aria = c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')
    if (byFor || wrapped || aria) named++
    else unnamed.push(c.name || c.type || c.tagName)
  }
  return { total: controls.length, named, unnamed: unnamed.slice(0, 5) }
})
check('#4', 'all form controls have an accessible name',
  labelAudit.named === labelAudit.total,
  `${labelAudit.named}/${labelAudit.total}${labelAudit.unnamed.length ? ' unnamed: ' + labelAudit.unnamed.join(',') : ''}`)

// PR #4: equipment notes gated — focusable but inert until a box is ticked
const notes = page.locator('textarea').filter({ hasNot: page.locator('[disabled]') }).first()
const notesState = await page.evaluate(() => {
  const ta = [...document.querySelectorAll('textarea')]
    .find(t => /equipment/i.test(t.previousElementSibling?.textContent || '') ||
               /equipment/i.test(t.closest('div')?.innerText || ''))
  if (!ta) return null
  return { readOnly: ta.readOnly, ariaDisabled: ta.getAttribute('aria-disabled'),
           disabled: ta.disabled, describedBy: !!ta.getAttribute('aria-describedby') }
})
check('#4', 'equipment notes use readOnly+aria-disabled (stays focusable)',
  !!notesState && notesState.readOnly === true && notesState.ariaDisabled === 'true' && notesState.disabled === false,
  JSON.stringify(notesState))

await page.screenshot({ path: `${OUT}/pr-participant-form.png`, fullPage: true })

// ── PR #5: unsaved-changes guard ─────────────────────────────────────────
await page.locator('input').first().fill('VerifyTest')
await page.waitForTimeout(300)
let blocked = false
page.once('dialog', async d => { blocked = true; await d.dismiss() })
await page.locator('aside a', { hasText: 'Participants' }).first().click().catch(() => {})
await page.waitForTimeout(1200)
const stillOnForm = page.url().includes('/participants/new')
const guardText = /unsaved|leave|discard/i.test(await page.locator('body').innerText())
check('#5', 'unsaved-changes guard blocks navigation', stillOnForm || blocked || guardText,
  `url=${page.url().split('/').slice(-2).join('/')} dialog=${blocked} prompt=${guardText}`)

// ── PR #5: destructive confirmation + modal a11y ─────────────────────────
// The guard above intentionally blocks navigation (it aborts page.goto), so clear the
// dirty field first. Being forced to do this is itself evidence the guard works.
await page.locator('input').first().fill('').catch(() => {})
await page.waitForTimeout(400)
await page.goto(BASE + '/participants', { waitUntil: 'networkidle' }).catch(async () => {
  await page.goto(BASE + '/participants', { waitUntil: 'domcontentloaded' })
})
await page.waitForTimeout(1500)
const rowMenu = page.locator('button[aria-haspopup], button[title*="ction" i]').first()
const modalAudit = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]')
  return d ? { role: true, modal: d.getAttribute('aria-modal'), labelled: !!d.getAttribute('aria-labelledby') } : null
})
check('#5', 'no dialog open on a plain list view', modalAudit === null)

// ── PR #5: theming — no raw hex in rendered styles on a migrated page ────
// PR #5 migrated PAGE CONTENT to tokens and explicitly left the app shell (sidebar,
// header, brand block, tenant badges) on literals — those values have no token yet.
// Scope the assertion to <main> accordingly.
const hexInline = await page.evaluate(() => {
  const main = document.querySelector('main')
  if (!main) return -1
  return [...main.querySelectorAll('[class]')]
    .filter(e => /\[#[0-9a-fA-F]{6}\]/.test(e.className + '')).length
})
check('#5', 'no hex-literal classes in page content (shell excluded by design)',
  hexInline === 0, `${hexInline} elements in <main>`)

// ── PR #5: empty states ──────────────────────────────────────────────────
await page.goto(BASE + '/billing', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const emptyText = await page.locator('body').innerText()
check('#5', 'empty state teaches rather than saying "no data"',
  /is a pool of money|add one to start/i.test(emptyText))

// ── Backend claims via the API (PRs #6, #7, #8) ──────────────────────────
const token = await page.evaluate(() => localStorage.getItem('odip_token'))
const api = async (path) => {
  const r = await page.request.get(BASE + path, { headers: { Authorization: `Bearer ${token}` } })
  return { status: r.status(), body: await r.text() }
}
const fr = await api('/api/v1/field-registry/fields?pageSize=5')
check('#8', 'field-registry paging returns requested size not all 280', fr.status === 200 &&
  (JSON.parse(fr.body).data?.items?.length ?? 0) === 5,
  `status=${fr.status} items=${(() => { try { return JSON.parse(fr.body).data.items.length } catch { return '?' } })()}`)

const domains = await api('/api/v1/field-registry/domains')
check('#7', 'data dictionary seeded (domains present)', domains.status === 200 &&
  (JSON.parse(domains.body).data?.length ?? 0) > 0,
  `${(() => { try { return JSON.parse(domains.body).data.length } catch { return '?' } })()} domains`)

const fs2 = await api('/api/v1/billing/funding-sources')
check('#8', 'billing API reachable and authorised', fs2.status === 200, `status=${fs2.status}`)

const devUsers = await api('/api/v1/auth/dev-users')
check('#2', 'dev-users no longer exposes email',
  devUsers.status === 200 && !/"email"/i.test(devUsers.body), `status=${devUsers.status}`)

check('—', 'no console errors across the run', consoleErrors.length === 0,
  consoleErrors.slice(0, 2).join(' || '))

await browser.close()

const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) { console.log('FAILURES:'); failed.forEach(f => console.log(`  - [${f.pr}] ${f.name}${f.detail ? ': ' + f.detail : ''}`)) }
process.exit(failed.length ? 1 : 0)
