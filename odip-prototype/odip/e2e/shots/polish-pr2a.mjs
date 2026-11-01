// Polish PR 2a: selected tint + bar, the one field treatment, the calmer dark primary and the dark elevation steps.
// Numeric checks 1-6 and 9 from SHAPE-PR2 section 6 (exit 1 on any failure), on the section 6 routes at 1280 light, 1280 dark and 390 light touch.
// A page header (2b scope) holding a second solid primary is recorded as `known2b` (printed and in known2b.json), never as a pass (PLAN-AMEND-PR2A ruling 4).
// Check 3 skips only the 48px brand tile: since polish 3a a success pill is the Selected tint, so no pill is excluded.
// Captures: only the changed states, padded crops plus one full page per breakpoint where it changed.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

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

const username = 'dev.admin'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const devUsers = envelope([{ username, role: 'Admin', tenantName: 'Sample Support Co' }])
const devLogin = envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username, fullName: 'Dev Admin', role: 'Admin', tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })

const PROFILES = [
  { name: 'desktop-1280', width: 1280, height: 900, touch: false, dark: false },
  { name: 'desktop-1280-dark', width: 1280, height: 900, touch: false, dark: true },
  { name: 'touch-390', width: 390, height: 844, touch: true, dark: false },
]

const browser = await chromium.launch({ headless: true })
const checks = []
const known2b = []
const check = (tag, name, ok, detail = '') => { checks.push({ name: `${tag} ${name}`, pass: !!ok, detail }); console.log(`[polish-pr2a] ${ok ? 'PASS' : 'FAIL'} ${tag} ${name}${detail !== '' ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`) }
const safe = async (tag, name, fn) => { try { await fn() } catch (e) { check(tag, name, false, String(e.message).split('\n')[0]) } }

// In-page helpers, installed before every page script: colours normalised through a canvas, WCAG contrast, token probes.
function installHelpers() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const px = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]] }
  const lum = (rgb) => rgb.slice(0, 3).map((c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0)
  const contrast = (a, b) => { const [hi, lo] = [lum(px(a)), lum(px(b))].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
  const tok = (name) => { const el = document.createElement('i'); el.style.backgroundColor = `var(--color-${name})`; document.body.appendChild(el); const out = getComputedStyle(el).backgroundColor; el.remove(); return out }
  const same = (a, b) => { const x = px(a), y = px(b); return x[3] === 255 && y[3] === 255 && x[0] === y[0] && x[1] === y[1] && x[2] === y[2] }
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' }
  window.__h = { px, contrast, tok, same, shown }
}
const gotoReady = async (page, url) => {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.locator('main, form').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
}
const setTheme = (page, dark) => page.evaluate((d) => { if (d) document.documentElement.dataset.theme = 'dark' }, dark)

async function signIn(page) {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const button = page.getByRole('button', { name: 'Sign in as selected user' })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}

// Checks 1-4 on whatever page is open. `login` pages hold exactly one primary and no main.
async function measureRoute(page) {
  return page.evaluate(() => {
    const h = window.__h
    const primary = h.tok('primary'), lime = h.tok('primary-fixed')
    const all = [...document.querySelectorAll('body *')].filter(h.shown)
    const solids = all.filter((el) => {
      const r = el.getBoundingClientRect()
      return r.height >= 28 && r.width >= 56 && h.same(getComputedStyle(el).backgroundColor, primary) && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' && !el.closest('table tbody, [role=dialog]')
    }).map((el) => ({ text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), top: el.getBoundingClientRect().top + scrollY, inHeader: !!el.closest('header, [data-page-header]') || (!!el.closest('main') && el.getBoundingClientRect().top + scrollY < 160) }))
    const limes = all.filter((el) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)' && h.same(getComputedStyle(el).backgroundColor, lime) && !(r.width <= 48 && r.height <= 48) })
      .map((el) => (el.textContent || '').trim().slice(0, 30))
    const selected = [...document.querySelectorAll('main [role=radio][aria-checked=true], main [role=tab][aria-selected=true], main nav [aria-current=page]')].filter(h.shown).map((el) => {
      const cs = getComputedStyle(el)
      const hasBar = (s) => s.includes(primary.replace(/\s+/g, ' ')) && /(^|[\s-])2px(\s|$)/.test(s)
      return {
        label: (el.textContent || '').trim().slice(0, 24), bg: cs.backgroundColor,
        notSolid: !h.same(cs.backgroundColor, primary) && !h.same(cs.backgroundColor, lime),
        bar: hasBar(cs.boxShadow) || (parseFloat(cs.borderBottomWidth) >= 2 && h.same(cs.borderBottomColor, primary)),
        shadow: cs.boxShadow,
      }
    })
    const T = ['selected', 'on-selected', 'primary', 'background', 'sidebar', 'card', 'popover', 'surface-container-high'].reduce((o, n) => ({ ...o, [n]: h.tok(n) }), {})
    return { solids, limes, selected, T, onSel: h.contrast(T['on-selected'], T.selected), barSel: h.contrast(T.primary, T.selected), sideP: h.contrast(T.background, T.sidebar), pageCard: h.contrast(T.card, T.background), cardPop: h.contrast(T.popover, T.card), popHigh: h.contrast(T['surface-container-high'], T.popover) }
  })
}

// Check 5: one field in each state, injected beside a real FormField input so it wears the real classes.
async function fieldStates(page) {
  return page.evaluate(async () => {
    const h = window.__h
    const src = [...document.querySelectorAll('main input[type=text], main input:not([type])')].find(h.shown)
    if (!src) return { error: 'no text input on the page' }
    const wrap = document.createElement('div')
    wrap.id = '__states'
    wrap.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;padding:16px;background:var(--color-card)'
    const states = { empty: {}, filled: { value: 'Typed value' }, focus: {}, error: { 'aria-invalid': 'true', value: 'Wrong' }, disabled: { disabled: '', value: 'Locked' }, readonly: { readonly: '', value: 'Read only' } }
    const els = {}
    for (const [name, attrs] of Object.entries(states)) {
      const cell = document.createElement('label'); cell.style.cssText = 'display:block;font-size:12px'; cell.append(name)
      const el = document.createElement('input'); el.className = src.className; el.placeholder = 'Placeholder'; el.setAttribute('aria-label', name)
      for (const [k, v] of Object.entries(attrs)) k === 'value' ? (el.value = v) : el.setAttribute(k, v)
      cell.append(el); wrap.append(cell); els[name] = el
    }
    ;(document.querySelector('main') ?? document.body).prepend(wrap)
    els.focus.focus()
    await new Promise((r) => setTimeout(r, 400))
    const read = (el) => { const cs = getComputedStyle(el); return { bg: cs.backgroundColor, border: cs.borderTopColor, style: cs.borderTopStyle, opacity: cs.opacity, shadow: cs.boxShadow, color: cs.color } }
    const out = {}
    for (const name of Object.keys(states)) out[name] = read(els[name])
    const rings = [...out.focus.shadow.matchAll(/(rgba?\([^)]*\))\s+(-?\d+)px\s+(-?\d+)px\s+(-?\d+)px\s+(-?\d+)px/g)].map((m) => ({ color: m[1], spread: +m[5] })).filter((r) => r.spread > 0)
    const ring = rings.sort((a, b) => b.spread - a.spread)[0] ?? null
    return { out, ringSpread: ring?.spread ?? 0, ringVsField: ring ? h.contrast(ring.color, out.focus.bg) : 0, borderVsField: h.contrast(out.empty.border, out.empty.bg) }
  })
}

const staffHref = async (page) => {
  await gotoReady(page, '/staff')
  const href = await page.locator('a[href^="/staff/"]:not([href="/staff/new"])').first().getAttribute('href')
  return href ?? '/staff'
}

try {
  // ---------- Login, signed out (checks 1 and 6) ----------
  for (const profile of PROFILES) {
    const tag = `${profile.name} /login`
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, colorScheme: profile.dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    await context.addInitScript(installHelpers)
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
    await safe(tag, 'login checks', async () => {
      await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.getByRole('button', { name: 'Sign in as selected user' }).waitFor({ state: 'visible', timeout: 60_000 })
      await page.waitForTimeout(600)
      await setTheme(page, profile.dark)
      await page.waitForTimeout(300)
      const m = await measureRoute(page)
      check(tag, '1 exactly one solid primary', m.solids.length === 1, m.solids)
      await page.evaluate(() => document.activeElement?.blur?.())
      await page.waitForTimeout(300)
      const parity = await page.evaluate(() => {
        const ins = [...document.querySelectorAll('form input')].filter((e) => window.__h.shown(e) && ['email', 'password', 'text'].includes(e.type))
        const [a, b] = ins.slice(0, 2).map((e) => { const cs = getComputedStyle(e); return { type: e.type, bg: cs.backgroundColor, border: cs.borderTopColor, height: e.getBoundingClientRect().height, radius: cs.borderTopLeftRadius } })
        return { a, b }
      })
      check(tag, '6 Email and Password match at rest (fill, border, height, radius)', !!parity.a && !!parity.b && parity.a.bg === parity.b.bg && parity.a.border === parity.b.border && parity.a.height === parity.b.height && parity.a.radius === parity.b.radius, parity)
      const forgot = await page.getByRole('button', { name: /forgot password/i }).first().evaluate((el) => { const r = el.getBoundingClientRect(); const rg = document.createRange(); rg.selectNodeContents(el); return { h: r.height, fs: getComputedStyle(el).fontSize, lines: rg.getClientRects().length } })
      check(tag, 'forgot password is 14px with a 44px hit area', forgot.fs === '14px' && (!profile.touch || forgot.h >= 44 - 0.5), forgot)
      if (profile.touch) check(tag, 'forgot password is one line at 390 touch', forgot.h <= 44.5 && forgot.lines === 1, forgot)
      if (profile.name !== 'desktop-1280-dark') checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${profile.name}-login.png`), { touch: profile.touch })).checks)
    })
    await context.close()
  }

  // ---------- Signed-in routes ----------
  const ROUTES = [
    { key: 'trips', url: '/trips' }, { key: 'tasks', url: '/tasks' }, { key: 'incidents', url: '/incidents' },
    { key: 'incident-new', url: '/incidents/new' }, { key: 'reports', url: '/reports' }, { key: 'staff-detail', url: null },
    { key: 'participants', url: '/participants' }, { key: 'settings-profile', url: '/settings?section=profile' }, { key: 'roster', url: '/rostering' },
  ]
  for (const profile of PROFILES) {
    const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, colorScheme: profile.dark ? 'dark' : 'light', reducedMotion: 'reduce' })
    await context.addInitScript(installHelpers)
    await context.addInitScript(() => { try { localStorage.setItem('odip.trips.view', 'table') } catch { /* ignore */ } })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers }))
    await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin }))
    await signIn(page)
    const staffUrl = await staffHref(page)
    for (const route of ROUTES) {
      const url = route.url ?? staffUrl
      const tag = `${profile.name} ${url}`
      await safe(tag, 'route checks', async () => {
        await gotoReady(page, url)
        await setTheme(page, profile.dark)
        await page.waitForTimeout(300)
        const m = await measureRoute(page)
        // 1 one solid primary; a second one that is only a page header's is known2b (2b scope), not a pass.
        const body = m.solids.filter((s) => !s.inHeader)
        if (m.solids.length <= 1) check(tag, '1 at most one solid primary', true, m.solids)
        else if (body.length <= 1 && m.solids.length > body.length) { known2b.push({ tag, solids: m.solids }); console.log(`[polish-pr2a] KNOWN2B ${tag} ${JSON.stringify(m.solids)}`) }
        else check(tag, '1 at most one solid primary', false, m.solids)
        // 2 selected is not primary or lime, and carries the 2px bar.
        check(tag, '2 selected is not primary or lime, with a 2px primary bar', m.selected.every((s) => s.notSolid && s.bar), m.selected.filter((s) => !(s.notSolid && s.bar)).map((s) => ({ l: s.label, bg: s.bg, shadow: s.shadow })))
        // 3 lime appears at most once (the nav's active item).
        check(tag, '3 lime appears at most once', m.limes.length <= 1, m.limes)
        if (url.startsWith('/settings')) check(tag, '3 settings: the one lime area is the main nav item', m.limes.length === 1 && (profile.width < 768 || m.selected.length >= 1), { limes: m.limes })
        // 4 selected contrast, from the resolved tokens.
        check(tag, '4 on-selected 4.5:1 and the bar 3:1 on the selected tint', m.onSel >= 4.5 && m.barSel >= 3, { onSel: +m.onSel.toFixed(2), barSel: +m.barSel.toFixed(2) })
        // 9 dark steps (resolved), measured once per theme profile; the values are recorded for the report.
        if (route.key === 'trips' && profile.width === 1280) {
          console.log(`[polish-pr2a] RECORD ${profile.name} steps sidebar:page ${m.sideP.toFixed(3)}, page:card ${m.pageCard.toFixed(3)}, card:popover ${m.cardPop.toFixed(3)}, popover:high ${m.popHigh.toFixed(3)}`)
          if (profile.dark) check(tag, '9 dark steps sidebar:page >= 1.08, page:card >= 1.12, card:popover >= 1.12, popover:high >= 1.1', m.sideP >= 1.08 && m.pageCard >= 1.12 && m.cardPop >= 1.12 && m.popHigh >= 1.1, { sideP: +m.sideP.toFixed(3), pageCard: +m.pageCard.toFixed(3), cardPop: +m.cardPop.toFixed(3), popHigh: +m.popHigh.toFixed(3) })
        }
        // Captures of the changed states.
        const opts = { touch: profile.touch }
        if (route.key === 'trips' && profile.width === 1280) {
          const group = page.locator('[role=radiogroup]:visible').first()
          checks.push(checkCropHolds(await cropElement(page, group, path.join(OUT_DIR, `${profile.name}-trips-header.png`), { ...opts, also: page.getByText('New trip').first() })))
        }
        if (route.key === 'settings-profile' && profile.name === 'desktop-1280') checks.push(checkCropHolds(await cropElement(page, page.locator('nav[aria-label="Settings"]').first(), path.join(OUT_DIR, `${profile.name}-settings-rail.png`), opts)))
        if (route.key === 'roster' && profile.name === 'desktop-1280') checks.push(checkCropHolds(await cropElement(page, page.locator('[role=radiogroup]:visible').first().locator('xpath=../..'), path.join(OUT_DIR, `${profile.name}-roster-toolbar.png`), opts)))
        if (route.key === 'incident-new') {
          // 5 input states, forced on the open form.
          const s = await fieldStates(page)
          if (s.error) check(tag, '5 input states', false, s.error)
          else {
            const o = s.out
            const borders = [o.empty.border, o.focus.border, o.error.border, o.disabled.border]
            check(tag, '5 border: empty = filled, and differs from focus, error and disabled', o.empty.border === o.filled.border && new Set(borders).size === 4, borders)
            check(tag, '5 fill: disabled differs from empty; read-only is transparent with a dashed edge', o.disabled.bg !== o.empty.bg && o.readonly.bg === 'rgba(0, 0, 0, 0)' && o.readonly.style === 'dashed', { dis: o.disabled.bg, empty: o.empty.bg, ro: o.readonly.bg, style: o.readonly.style })
            check(tag, '5 focus ring is 2px or more and 3:1 against the field', s.ringSpread >= 2 && s.ringVsField >= 3, { spread: s.ringSpread, vs: +s.ringVsField.toFixed(2) })
            check(tag, '5 edge is 3:1 against the field', s.borderVsField >= 3, +s.borderVsField.toFixed(2))
            check(tag, '5 no field has opacity below 1', Object.values(o).every((f) => f.opacity === '1'), Object.fromEntries(Object.entries(o).map(([k, f]) => [k, f.opacity])))
            const box = page.locator('#__states')
            await page.evaluate(() => document.querySelector('#__states input[aria-label=focus]').focus())
            await page.waitForTimeout(300)
            checks.push(checkCropHolds(await cropElement(page, box, path.join(OUT_DIR, `${profile.name}-field-states.png`), opts)))
          }
        }
        if (route.key === 'trips' && profile.dark) { await gotoReady(page, '/'); await setTheme(page, true); await page.waitForTimeout(400); checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${profile.name}-dashboard.png`), opts)).checks) }
        if (route.key === 'incident-new' && profile.name !== 'desktop-1280-dark') { await gotoReady(page, url); checks.push(...(await fullPage(page, path.join(OUT_DIR, 'full', `${profile.name}-incident-new.png`), opts)).checks) }
      })
    }
    await context.close()
  }
} finally {
  await browser.close()
}
writeFileSync(path.join(OUT_DIR, 'known2b.json'), JSON.stringify(known2b, null, 2))
console.log(`[polish-pr2a] known2b routes: ${known2b.length}`)
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
