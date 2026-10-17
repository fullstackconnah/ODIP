// The landing page's numeric checks (SHAPE section 10), on the runner's Vite dev server with /api on the mock, plus the
// form-state and viewport captures the finish review judges from. Run as
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <slot> shots <abs>/welcome/capture/page-checks.mjs <outdir>
// One `CHECK <id> PASS|FAIL <detail>` line per check; exits 1 if any FAILs. Every scroll is instant and every wait has a timeout.
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const { chromium } = await import('playwright')

const BASE = process.env.BASE_URL.replace(/\/$/, '') + '/welcome/'
const OUT = process.env.OUT_DIR
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true })
const metrics = {}
let failed = 0
const check = (id, pass, detail) => {
  if (!pass) failed++
  console.log(`CHECK ${id} ${pass ? 'PASS' : 'FAIL'} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) })

const CTX = [['d1440', 1440, 900], ['t1024', 1024, 768], ['i820', 820, 1180], ['m390', 390, 844, true], ['m320', 320, 640, true]]

async function open(w, h, { mobile = false, reduce = false, text200 = false, hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, reducedMotion: reduce ? 'reduce' : 'no-preference', locale: 'en-AU' })
  const page = await ctx.newPage()
  const fontErrors = []
  page.on('response', (r) => { if (/fonts\.(gstatic|googleapis)\.com/.test(r.url()) && r.status() >= 400) fontErrors.push(`${r.status()} ${r.url()}`) })
  await page.goto(BASE + hash, { waitUntil: 'load', timeout: 120_000 })
  await page.evaluate(() => document.fonts.ready)
  if (text200) await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await page.waitForTimeout(700)
  return { ctx, page, fontErrors }
}

/** Step down the page so every one-shot arrival fires, counting visible text under opacity 0.99 at EVERY step; back to the top. */
async function walk(page) {
  const worst = await page.evaluate(async () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],.hp,.sr-only') }
    const faded = (el) => { for (let n = el; n && n !== document.body; n = n.parentElement) if (parseFloat(getComputedStyle(n).opacity) < 0.99) return true; return false }
    let worst = 0
    const step = innerHeight * 0.6
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo({ top: y, behavior: 'instant' })
      await new Promise((r) => setTimeout(r, 140))
      const n = [...document.querySelectorAll('main h1, main h2, main h3, main p, main li, main dt, main dd, main label')].filter((el) => vis(el) && faded(el)).length
      worst = Math.max(worst, n)
    }
    return worst
  })
  await page.waitForTimeout(800)
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await page.waitForTimeout(300)
  return worst
}

const measure = (page) => page.evaluate(() => {
  const de = document.documentElement
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[hidden],.hp,.sr-only') }
  const ownText = (el) => [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())
  const small = []
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || !ownText(el)) continue
    const fs = parseFloat(getComputedStyle(el).fontSize)
    if (fs < 12) small.push(`${el.tagName}.${el.className}:${fs}`)
  }
  const taps = []
  for (const el of document.querySelectorAll('a,button,input,select,textarea')) {
    if (!vis(el) || el.closest('p,dd,.figcap')) continue
    const r = el.getBoundingClientRect()
    if (r.height < 44) taps.push(`${el.tagName}.${el.className}"${(el.textContent || el.id).trim().slice(0, 20)}":${Math.round(r.height)}`)
  }
  // Contrast: each text element against the first opaque background up its tree; alpha text is blended over it.
  const rgba = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 } }
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c.a >= 0.99) return c } return { r: 255, g: 255, b: 255, a: 1 } }
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) })
  const contrast = {}
  const lowContrast = []
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || !ownText(el)) continue
    const cs = getComputedStyle(el)
    const bg = bgOf(el)
    const r = ratio(blend(rgba(cs.color), bg), bg)
    const fs = parseFloat(cs.fontSize)
    const large = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700)
    const key = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] || (el.parentElement && el.parentElement.className.split(' ')[0])}`
    contrast[key] = Math.min(contrast[key] ?? 99, Math.round(r * 10) / 10)
    if (r < (large ? 3 : 4.5)) lowContrast.push(`${key}:${r.toFixed(2)}`)
  }
  for (const el of document.querySelectorAll('.field input, .field select, .field textarea')) {
    if (!vis(el)) continue
    const r = ratio(rgba(getComputedStyle(el).borderTopColor), bgOf(el.parentElement))
    contrast['field-border'] = Math.min(contrast['field-border'] ?? 99, Math.round(r * 10) / 10)
    if (r < 3) lowContrast.push(`border#${el.id}:${r.toFixed(2)}`)
  }
  const unsettled = [...document.querySelectorAll('main .shot')].filter((el) => {
    const cs = getComputedStyle(el); return parseFloat(cs.opacity) < 0.99 || (cs.transform !== 'none' && cs.transform !== 'matrix(1, 0, 0, 1, 0, 0)')
  }).length
  const h1 = document.querySelector('h1')
  return {
    scrollW: de.scrollWidth, clientW: de.clientWidth, height: de.scrollHeight, small, taps, contrast, lowContrast: [...new Set(lowContrast)], unsettled,
    arrived: document.querySelectorAll('.slot[data-in]').length, slots: document.querySelectorAll('.slot').length,
    h1Lines: Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)), h1Size: parseFloat(getComputedStyle(h1).fontSize),
    figures: document.querySelectorAll('main figure').length, tags: document.querySelectorAll('main .tag').length,
  }
})

const imagesLoaded = (page) => page.waitForFunction(() => [...document.querySelectorAll('main img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 }).then(() => true, () => false)

// ---- 1-5, 7, 13 at five widths, with the fold and the slot captures --------------------------------------------------
for (const [n, w, h, mobile] of CTX) {
  const { ctx, page, fontErrors } = await open(w, h, { mobile })
  await shot(page, `fold-${n}`)
  if (n === 'd1440') {
    const fold = await page.evaluate(() => {
      const bottom = (sel) => Math.max(...[...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect().bottom))
      const parts = { bar: '.site-header', h1: 'h1', lede: '.hero .lede', ctas: '.cta-row a', alphaLine: '.alpha-line', plan: '.plan li', planFoot: '.plan__foot' }
      const out = Object.fromEntries(Object.entries(parts).map(([k, s]) => [k, Math.round(bottom(s))]))
      out.planItems = document.querySelectorAll('.plan li').length
      out.slotTop = Math.round(document.getElementById('t0830').getBoundingClientRect().top)
      out.h2Top = Math.round(document.querySelector('#t0830 h2').getBoundingClientRect().top)
      return out
    })
    const { slotTop, h2Top, planItems, ...ends } = fold
    check('fold-1440', Object.values(ends).every((b) => b <= 900) && planItems === 7 && slotTop < 900, fold)
  }
  const hiddenText = await walk(page)
  const m = await measure(page)
  const loaded = await imagesLoaded(page)
  metrics[n] = { ...m, hiddenText, loaded }
  check(`overflow-${n}`, m.scrollW === m.clientW, `${m.scrollW}/${m.clientW}`)
  check(`text-floor-${n}`, m.small.length === 0, m.small.slice(0, 6))
  check(`taps-${n}`, m.taps.length === 0, m.taps.slice(0, 6))
  check(`contrast-${n}`, m.lowContrast.length === 0, m.lowContrast.length ? m.lowContrast.slice(0, 8) : `min ${Math.min(...Object.values(m.contrast))}`)
  const h1Ok = m.h1Size <= 80 && ({ d1440: m.h1Size === 80 && m.h1Lines === 2, t1024: m.h1Lines === 2, m390: m.h1Size === 40 && m.h1Lines === 4, m320: m.h1Size === 40 && m.h1Lines === 4 }[n] ?? true)
  check(`h1-${n}`, h1Ok, `${m.h1Size}px ${m.h1Lines} lines`)
  check(`arrive-${n}`, m.arrived === 7 && m.unsettled === 0 && hiddenText === 0, `data-in ${m.arrived}/7, unsettled ${m.unsettled}, faded text at worst step ${hiddenText}`)
  check(`figures-${n}`, m.figures === 11 && m.tags === 11 && loaded, `${m.figures} figures, ${m.tags} tags, images loaded ${loaded}`)
  if (n === 'd1440' || n === 'm390') {
    for (const id of ['t0830', 't1000', 't1130', 't1300', 't1430', 't1600', 'onshift']) {
      await page.evaluate((i) => document.getElementById(i).scrollIntoView({ block: 'center', behavior: 'instant' }), id)
      await page.waitForTimeout(900)
      await shot(page, `slot-${id}-${w}`)
    }
    // The two plain sections under the day, whole in the viewport (their ground and rules are judged from these).
    for (const id of ['setup', 'alpha']) {
      await page.evaluate((i) => document.getElementById(i).scrollIntoView({ block: 'start', behavior: 'instant' }), id)
      await page.waitForTimeout(500)
      await shot(page, `section-${id}-${w}`)
    }
  }
  if (n === 'd1440') {
    // 8: the rail with 11:30 centred.
    await page.evaluate(() => document.getElementById('t1130').scrollIntoView({ block: 'center', behavior: 'instant' }))
    await page.waitForTimeout(900)
    const rail = await page.evaluate(() => {
      const dot = document.querySelector('.rail__dot'); const stop = document.querySelector('.rail__stops .is-now')
      const ty = new DOMMatrix(getComputedStyle(dot).transform).m42
      return { stop: stop.dataset.for, dotY: Math.round(ty), stopY: stop.offsetTop, diff: Math.round(ty - stop.offsetTop) }
    })
    metrics.rail = rail
    check('rail-1440', rail.stop === 't1130' && Math.abs(rail.diff) <= 2, rail)
    await shot(page, 'd1440-rail')
    // 15: fonts.
    const fonts = await page.evaluate(() => ['800 16px "Plus Jakarta Sans"', '500 16px "Plus Jakarta Sans"', '400 16px Manrope', '700 16px Manrope'].map((f) => [f, document.fonts.check(f)]))
    check('fonts', fonts.every(([, ok]) => ok) && fontErrors.length === 0, { fonts, fontErrors })
  }
  if (n === 'd1440' || n === 'm320') {
    await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForTimeout(400)
    await shot(page, `footer-${w}`)
  }
  await ctx.close()
}

// ---- 9: the worst case, typed into the real form -------------------------------------------------------------------
const WORST = {
  '#f-name': 'Aleksandra Wiśniewska-Kowalczyk',
  '#f-org': 'Northern Rivers Disability and Community Support Services Co-operative Ltd (trading as NRDCSS)',
  '#f-role': 'Senior Rostering and Client Services Coordinator, Northern Region',
  '#f-email': 'bartholomew.fitzgerald@northwind-industries-holdings.example.com',
  '#f-message': ('We run 214 staff across three regions and the roster lives in two spreadsheets plus a whiteboard. <script>alert(1)</script> Our admin team spends most of Monday chasing timesheets and leave forms, then Thursday rebuilding the claims file by hand. Incidents get written up on paper and typed in later, and restrictive practice authorisations sit in a shared drive nobody can find. We would like one place for approvals, the roster and incidents, with something our support workers will actually use on a phone between shifts. Paramètres de confidentialité et de sécurité matter to us too: some participants are wary of new systems, so anything that keeps their information tidy and private will help us explain the change. ').repeat(2).slice(0, 1000),
  '#f-phone': '+61 (02) 9876 5432 ext 104',
}
for (const [id, w, h, mobile] of [['wc-320', 320, 640, true], ['wc-1440', 1440, 900, false]]) {
  const { ctx, page } = await open(w, h, { mobile })
  for (const [sel, v] of Object.entries(WORST)) await page.fill(sel, v)
  await page.selectOption('#f-size', '200-plus')
  await page.focus('#f-phone')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  const wc = await page.evaluate(() => {
    const err = document.getElementById('f-phone-error')
    return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, msgLen: document.getElementById('f-message').value.length,
      phoneError: !err.hidden && err.textContent, errFits: err.scrollWidth <= err.clientWidth, scripts: document.querySelectorAll('main script').length }
  })
  metrics[id] = wc
  check(id, wc.scrollW === wc.clientW && wc.msgLen === 1000 && wc.phoneError === 'Use digits, spaces and + ( ) - only' && wc.errFits && wc.scripts === 0, wc)
  await page.locator('#join').screenshot({ path: path.join(OUT, `${id}-join.png`) })
  await ctx.close()
}

// ---- 10: text at 200% ------------------------------------------------------------------------------------------------
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true], [320, 640, true]]) {
  const { ctx, page } = await open(w, h, { mobile, text200: true })
  await walk(page)
  const t = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }))
  check(`text200-${w}`, t.scrollW === t.clientW, `${t.scrollW}/${t.clientW}`)
  await shot(page, `text200-fold-${w}`)
  await ctx.close()
}

// ---- 11: reduced motion ----------------------------------------------------------------------------------------------
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  const { ctx, page } = await open(w, h, { mobile, reduce: true })
  await walk(page)
  const m = await measure(page)
  const r = await page.evaluate(() => ({ running: document.getAnimations().filter((a) => a.playState === 'running').length, dot: getComputedStyle(document.querySelector('.rail__dot')).transitionDuration }))
  check(`reduced-${w}`, r.running === 0 && r.dot === '0s' && m.unsettled === 0, { ...r, unsettled: m.unsettled })
  await ctx.close()
}

// ---- 12: anchors under the sticky bar on phones ----------------------------------------------------------------------
for (const [w, h] of [[390, 844], [320, 640]]) {
  const { ctx, page } = await open(w, h, { mobile: true })
  await page.locator('.plan a[href="#t1130"]').tap()
  await page.waitForTimeout(1500)
  const a = await page.evaluate(() => ({ h2: Math.round(document.querySelector('#t1130 h2').getBoundingClientRect().top), bar: Math.round(document.querySelector('.site-header').getBoundingClientRect().bottom) }))
  check(`anchor-${w}`, a.h2 >= a.bar, a)
  await ctx.close()
}

// ---- 14: a deep link arrives at once ---------------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '#t1430', { waitUntil: 'load', timeout: 120_000 })
  const d = await page.evaluate(() => {
    const since = Math.round(performance.now() - performance.getEntriesByType('navigation')[0].loadEventEnd)
    const shot = document.querySelector('#t1430 .shot')
    return { since, dataIn: document.getElementById('t1430').hasAttribute('data-in'), opacity: parseFloat(getComputedStyle(shot).opacity) }
  })
  check('deep1440', d.since <= 150 && d.dataIn && d.opacity >= 0.99, d)
  await ctx.close()
}

// ---- Form states for the finish review (SHAPE section 6), at 1440 and 390 -----------------------------------------------
const VALID = { '#f-name': 'Alex Sample', '#f-org': 'Sample Support Co', '#f-email': 'alex@example.org' }
const ENDPOINT = '**/api/public/early-access'
const STATES = [
  ['form-errors', null, 'Check the 4 fields marked below.'],
  ['form-sending', async (route) => { await new Promise((r) => setTimeout(r, 3000)); await route.fulfill({ status: 202, json: { status: 'received' } }) }, 'Sending…'],
  ['form-received', 'live', 'Thanks, we have your details.'],
  ['form-429', (route) => route.fulfill({ status: 429, headers: { 'Retry-After': '480' }, json: {} }), 'Try again in 8 minutes.'],
  ['form-offline', (route) => route.abort(), "We couldn't reach Bunya Support."],
  ['form-500', (route) => route.fulfill({ status: 500, json: {} }), 'Something went wrong on our side'],
]
for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  for (const [name, handler, copy] of STATES) {
    const { ctx, page } = await open(w, h, { mobile })
    if (typeof handler === 'function') await page.route(ENDPOINT, handler)
    if (name !== 'form-errors') {
      for (const [sel, v] of Object.entries(VALID)) await page.fill(sel, v)
      await page.selectOption('#f-size', '10-49')
    }
    await page.locator('[data-submit]').click()
    await page.waitForTimeout(name === 'form-sending' ? 300 : 1200)
    const seen = await page.locator('#join').innerText()
    check(`${name}-${w}`, seen.includes(copy), copy)
    await page.locator('#join').screenshot({ path: path.join(OUT, `${name}-${w}.png`) })
    await ctx.close()
  }
}

writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(metrics, null, 1))
await browser.close()
console.log(failed ? `CHECKS FAILED ${failed}` : 'CHECKS ALL PASS')
if (failed) process.exitCode = 1
