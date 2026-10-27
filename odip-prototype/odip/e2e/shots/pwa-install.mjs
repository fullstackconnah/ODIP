// PR1 of the installable app: SHAPE numeric checks 1-10 (PASS/FAIL lines with the measured numbers) and captures 1-8.
// Run: bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <slot> shots <this file> <outdir>
// 390x844, touch + isMobile, headless. Crops are the element plus 16px, clipped to the viewport. Check 3 (sync bar), 7 and the offline rows are PR3.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const NAV = 'nav[aria-label="Mobile"]'
const CARD = '.install-card'
const results = []
const check = (n, name, ok, detail) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} #${n} ${name}: ${detail}`) }
const browser = await chromium.launch({ headless: true })

async function open(role, { vp = { width: 390, height: 844 }, touch = true, ua, scheme = 'light', reduced = 'no-preference' } = {}) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, userAgent: ua, colorScheme: scheme, reducedMotion: reduced, locale: 'en-AU', timezoneId: 'Australia/Sydney', serviceWorkers: 'block' })
  const user = { id: '00000000-0000-0000-0000-0000000000a1', username: `dev.${role.toLowerCase()}`, fullName: `Dev ${role}`, role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' }
  await ctx.addInitScript(([u]) => { localStorage.setItem('odip_token', 'mock-jwt-token'); localStorage.setItem('odip_user', u) }, [JSON.stringify(user)])
  const page = await ctx.newPage()
  page.on('pageerror', e => console.log('PAGE ERROR', e.message))
  return page
}
const go = async (page, p) => { await page.goto(BASE_URL + p, { waitUntil: 'domcontentloaded', timeout: 120_000 }); await page.waitForSelector('#main', { timeout: 60_000 }); await page.waitForTimeout(400) }
const settled = p => p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'))
const offer = p => p.evaluate(() => { const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: 'dismissed' }); window.dispatchEvent(e) })
const rect = (p, sel) => p.evaluate(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom } }, sel)
const lines = (p, sel) => p.$$eval(sel, els => els.map(e => { const c = getComputedStyle(e); const lh = parseFloat(c.lineHeight) || parseFloat(c.fontSize) * 1.2; return Math.round(e.getBoundingClientRect().height / lh) }))
const overflow = p => p.evaluate(() => document.scrollingElement.scrollWidth)
const touchTargets = (p, sel) => p.$$eval(`${sel} button, ${sel} a`, els => els.map(e => { const r = e.getBoundingClientRect(); const b = getComputedStyle(e, '::before'); return [e.textContent.trim().slice(0, 14), Math.max(r.width, parseFloat(b.width) || 0), Math.max(r.height, parseFloat(b.height) || 0)] }))
async function crop(p, name, sels, { pad = 16, box } = {}) {
  const vp = p.viewportSize()
  let b = box
  if (!b) {
    const rs = (await Promise.all(sels.map(s => rect(p, s)))).filter(Boolean)
    const x0 = Math.min(...rs.map(r => r.left)), y0 = Math.min(...rs.map(r => r.top)), x1 = Math.max(...rs.map(r => r.left + r.width)), y1 = Math.max(...rs.map(r => r.bottom))
    b = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
  }
  const x = Math.max(0, b.x - pad), y = Math.max(0, b.y - pad)
  await p.screenshot({ path: path.join(OUT_DIR, name + '.png'), clip: { x, y, width: Math.min(vp.width - x, b.width + 2 * pad), height: Math.min(vp.height - y, b.height + 2 * pad) } })
}
const hit = (a, b) => !(a.bottom <= b.top || a.top >= b.bottom)
const delta = (a, b) => ['top', 'left', 'width'].map(k => Math.abs(a[k] - b[k]))
const INSETS = ':root{--safe-top:47px;--safe-bottom:34px}'
const lead = async p => ({ first: await rect(p, '#main > :first-child'), h1: await rect(p, 'h1') })

// --- Android card on /portal (SupportWorker): layout shift, targets, clearance, wrapping, overflow ---
let p = await open('SupportWorker')
await go(p, '/portal')
await settled(p); await p.waitForTimeout(500) // let fonts and entry fades finish so the baseline is the settled layout
const before0 = await lead(p); await p.waitForTimeout(1500)
const before = await lead(p)
console.log('BASELINE DRIFT', JSON.stringify([...delta(before0.first, before.first), await p.evaluate(() => window.scrollY)]))
await offer(p); await p.waitForSelector(CARD); await settled(p)
const after = await lead(p)
const dIn = [...delta(before.first, after.first), ...delta(before.h1, after.h1)]
check(3, 'no layout shift when the card appears', dIn.every(v => v === 0), `deltas ${JSON.stringify(dIn)}`)
const tt = await touchTargets(p, CARD)
check(1, 'card touch targets >= 44x44', tt.length >= 2 && tt.every(t => t[1] >= 44 && t[2] >= 44), JSON.stringify(tt))
const card = await rect(p, CARD), nav = await rect(p, NAV), head = await rect(p, 'header')
const tbs = await p.$$eval('[role=toolbar]', els => els.map(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom } }))
check(4, 'card clear of header, nav and toolbars', card.bottom <= nav.top - 8 && !hit(card, head) && !tbs.some(t => hit(card, t)), `card ${Math.round(card.top)}-${Math.round(card.bottom)} nav.top ${Math.round(nav.top)} header.bottom ${Math.round(head.bottom)}`)
const tl = await lines(p, '#install-prompt-title'), bl = await lines(p, `${CARD} p:not(#install-prompt-title)`)
check(5, 'prompt text wrapping', tl[0] <= 2 && bl.every(n => n <= 4), `title ${tl} body ${bl}`)
check(2, 'no horizontal overflow (android card)', (await overflow(p)) <= 390, `scrollWidth ${await overflow(p)}`)
await crop(p, '01-android-light', [CARD, NAV])
// full page at 390: resize the viewport to the page height, then prove touch emulation survived the resize
const fullH = await p.evaluate(() => document.scrollingElement.scrollHeight)
await p.setViewportSize({ width: 390, height: Math.min(fullH, 3000) }); await p.waitForTimeout(300)
const resized = await p.evaluate(n => ({ coarse: matchMedia('(pointer: coarse)').matches, link: Math.round(document.querySelector(n + ' a')?.getBoundingClientRect().height) }), NAV)
check(2, 'touch emulation survives the full-page resize', resized.coarse && resized.link >= 44, JSON.stringify(resized))
await p.screenshot({ path: path.join(OUT_DIR, '08-portal-390-full.png') })
await p.setViewportSize({ width: 390, height: 844 })
await p.getByRole('button', { name: 'Not now' }).click(); await p.waitForSelector(CARD, { state: 'detached' })
const gone = await lead(p)
const dOut = [...delta(before.first, gone.first), ...delta(before.h1, gone.h1)]
check(3, 'no layout shift when the card leaves', dOut.every(v => v === 0), `deltas ${JSON.stringify(dOut)}`)
check(3, 'focus moved to #main after Not now', await p.evaluate(() => document.activeElement?.id === 'main'), await p.evaluate(() => document.activeElement?.tagName))
await p.context().close()

p = await open('SupportWorker', { scheme: 'dark' })
await go(p, '/portal'); await offer(p); await p.waitForSelector(CARD); await settled(p)
await crop(p, '01-android-dark', [CARD, NAV]); await p.context().close()

// --- iOS card ---
for (const scheme of ['light', 'dark']) {
  p = await open('SupportWorker', { ua: IOS_UA, scheme })
  await go(p, '/portal'); await p.waitForSelector(CARD); await settled(p)
  if (scheme === 'light') {
    const sl = await lines(p, `${CARD} li`), it = await touchTargets(p, CARD)
    check(5, 'iOS steps wrap to <= 2 lines', sl.length === 2 && sl.every(n => n <= 2), `steps ${sl}`)
    check(1, 'iOS card touch targets >= 44x44', it.length >= 1 && it.every(t => t[1] >= 44 && t[2] >= 44), JSON.stringify(it))
    check(2, 'no horizontal overflow (iOS card)', (await overflow(p)) <= 390, `scrollWidth ${await overflow(p)}`)
  }
  await crop(p, `02-ios-${scheme}`, [CARD, NAV]); await p.context().close()
}

// --- Coordinator on / (role-neutral copy) ---
p = await open('Coordinator'); await go(p, '/'); await offer(p); await p.waitForSelector(CARD); await settled(p)
await crop(p, '03-coordinator-android', [CARD, NAV]); await p.context().close()

// --- Safe areas (SupportWorker): header, nav, footer, then a shift's ActionBar ---
p = await open('SupportWorker'); await go(p, '/portal')
await p.addStyleTag({ content: INSETS }); await p.waitForTimeout(200)
const hd = await p.evaluate(() => { const h = document.querySelector('header'); return { pt: parseFloat(getComputedStyle(h).paddingTop), h: Math.round(h.getBoundingClientRect().height) } })
const nv = await p.evaluate(n => { const e = document.querySelector(n); return { pb: parseFloat(getComputedStyle(e).paddingBottom), h: Math.round(e.getBoundingClientRect().height) } }, NAV)
const ft = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('footer')).paddingBottom))
check(6, 'header with --safe-top 47', hd.pt === 47 && hd.h === 95, JSON.stringify(hd))
check(6, 'nav with --safe-bottom 34', nv.pb === 34 && nv.h === 102, JSON.stringify(nv))
check(6, 'PlatformFooter shell counts the inset once (114)', ft === 114, `padding-bottom ${ft}`)
await crop(p, '04-header-safe-top', [], { box: { x: 0, y: 0, width: 390, height: 120 }, pad: 0 })
await crop(p, '05-nav-safe-bottom', [], { box: { x: 0, y: 704, width: 390, height: 140 }, pad: 0 })
const links = await p.$$eval('a[href*="/portal/shifts/"]', as => [...new Set(as.map(a => a.getAttribute('href')))])
let bar = null
for (const href of links) {
  await go(p, href); await p.addStyleTag({ content: INSETS })
  bar = await p.evaluate(() => { const t = document.querySelector('[role=toolbar][aria-label="Shift actions"]'); return t && getComputedStyle(t).bottom })
  if (bar) { await p.waitForTimeout(200); await crop(p, '06-shift-actionbar-nav', ['[role=toolbar][aria-label="Shift actions"]', NAV]); break }
}
check(6, 'ActionBar sits on the nav (bottom 102)', bar === '102px', `bottom ${bar} over ${links.length} shift links`)
await p.context().close()

// wizard footer: padding-bottom 12 (below lg the nav already carries the inset)
p = await open('Coordinator'); await go(p, '/incidents/new'); await p.addStyleTag({ content: INSETS }); await p.waitForTimeout(200)
const wz = await p.evaluate(() => {
  const f = [...document.querySelectorAll('div')].find(e => e.className.includes('bottom-[var(--mobile-nav-h)]') && e.className.includes('border-t'))
  const r = f?.getBoundingClientRect()
  return f && { pb: parseFloat(getComputedStyle(f).paddingBottom), top: r.top }
})
check(6, 'WizardNavFooter padding-bottom 12', wz?.pb === 12, JSON.stringify(wz))
if (wz) await crop(p, '07-wizard-footer-nav', [], { box: { x: 0, y: wz.top, width: 390, height: 844 - wz.top } })
await p.context().close()

// --- 8: theme-color follows the theme ---
p = await open('SupportWorker'); await go(p, '/portal')
const tc = await p.evaluate(() => {
  const out = {}
  for (const t of ['light', 'dark']) { window.odipTheme.set(t); out[t] = [document.querySelector('meta[name=theme-color]').content, getComputedStyle(document.documentElement).getPropertyValue('--color-background').trim()] }
  return out
})
check(8, 'theme-color equals --color-background in both themes', Object.values(tc).every(([m, v]) => m.toLowerCase() === v.toLowerCase()), JSON.stringify(tc))
await p.context().close()

// --- 9: reduced motion ---
p = await open('SupportWorker', { reduced: 'reduce' }); await go(p, '/portal'); await offer(p); await p.waitForSelector(CARD); await p.waitForTimeout(50)
const tf = await p.$eval(CARD, e => getComputedStyle(e).transform)
check(9, 'reduced motion: no transform 50ms after mount', tf === 'none', `transform ${tf}`)
await p.context().close()

// --- 10: desktop untouched ---
p = await open('SupportWorker', { vp: { width: 1280, height: 800 }, touch: false }); await go(p, '/portal'); await offer(p); await p.waitForTimeout(500)
const dk = await p.evaluate(n => ({ card: !!document.querySelector('.install-card'), spacer: !!document.querySelector('[data-install-spacer]'), header: Math.round(document.querySelector('header').getBoundingClientRect().height), nav: getComputedStyle(document.querySelector(n)).display }), NAV)
check(10, 'desktop: no card, no spacer, header 48, nav hidden', !dk.card && !dk.spacer && dk.header === 48 && dk.nav === 'none', JSON.stringify(dk))
await p.screenshot({ path: path.join(OUT_DIR, '08-portal-1280-full.png') })
await p.context().close()

// --- SHAPE OPEN 2: a way back from /portal/leave and /portal/witness-approvals ---
p = await open('SupportWorker')
for (const route of ['/portal/leave', '/portal/witness-approvals']) {
  await go(p, route)
  const back = await p.evaluate(n => ({
    backControls: [...document.querySelectorAll('main a, main button, header a, header button')].map(e => (e.getAttribute('aria-label') || e.textContent || '').trim()).filter(t => /back|portal|home|my shifts/i.test(t)),
    navVisible: getComputedStyle(document.querySelector(n)).display !== 'none',
    navLabels: [...document.querySelectorAll(n + ' a, ' + n + ' button')].map(e => e.textContent.trim()),
  }), NAV)
  console.log(`OPEN2 ${route}: ${JSON.stringify(back)}`)
}
await p.context().close()

await browser.close()
console.log(`SUMMARY ${results.filter(Boolean).length}/${results.length} checks passed`)
process.exit(results.every(Boolean) ? 0 : 1)
