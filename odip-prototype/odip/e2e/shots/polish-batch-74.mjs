// Polish batch 74: the dashboard's action tiles no longer crush their text (PB72-L1). Each tile is its own size container; a tile under 36rem in a band that shows the
// line moves the link under the text, on the text column's left edge. Numeric checks (exit 1 on any failure), measured from computed boxes, never class names.
// Admin on the stock mock dashboard at 1024, 1280 and 1440 light, and 390 touch. Captures: the band at each width (tiles-<w>.png) and `/` as one full page at 1280 and 390.
// The "before" column is computed from the measured boxes: the old flex row left the text what remained after the figure, the link at its one-line width and two gaps (min 0).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, fullPage, layoutCheck, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

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

const tenantName = 'Sample Support Co'
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
// Admin first (the brief); ReadOnly is the fallback if the Admin dashboard does not draw its band (PB72's captures were ReadOnly), and the role used is logged.
const ROLES = [{ role: 'Admin', username: 'dev.admin', fullName: 'Dev Admin' }, { role: 'ReadOnly', username: 'dev.readonly', fullName: 'Dev ReadOnly' }]
const devUsers = (r) => envelope([{ username: r.username, role: r.role, tenantName }])
const devLogin = (r) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: r.username, fullName: r.fullName, role: r.role, tenantName, tenantId: 'tenant-0001' })

const PROFILES = [
  { name: '1024', width: 1024, height: 800, touch: false },
  { name: '1280', width: 1280, height: 900, touch: false, full: true },
  { name: '1440', width: 1440, height: 900, touch: false },
  { name: '390', width: 390, height: 844, touch: true, full: true },
]
const WANTED = ['NDIS Commission overdue', 'Qualification issues', 'Overdue']

const checks = []
const check = (tag, name, ok, detail = '') => { checks.push({ name: `${tag} ${name}`, pass: !!ok, detail }); console.log(`[polish-batch-74] ${ok ? 'PASS' : 'FAIL'} ${tag} ${name}${detail !== '' ? ` (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`) }
const fmt = (n) => (typeof n === 'number' ? +n.toFixed(1) : n)

const browser = await chromium.launch({ headless: true })

async function signIn(page, r) {
  await page.route('**/api/v1/auth/dev-users', (route) => route.fulfill({ json: devUsers(r) }))
  await page.route('**/api/v1/auth/dev-login', (route) => route.fulfill({ json: devLogin(r) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const button = page.getByRole('button', { name: 'Sign in as selected user' })
  await button.waitFor({ state: 'visible', timeout: 60_000 })
  await button.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}

// Every action tile (a named group holding its own link) in the band: its boxes, in DOM order. `fold` says whether the link sits under the text column.
const measureTiles = (page) => page.evaluate(() => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  const tapMin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-min')) || 0
  const grid = document.querySelector('section[aria-label="Alerts"] div.grid')
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } }
  const shown = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 }
  const all = grid ? [...grid.querySelectorAll('[data-attention]')] : []
  const tops = [...new Set(all.map((t) => Math.round(t.getBoundingClientRect().top)))].sort((a, b) => a - b)
  const perRow = tops.length ? all.filter((t) => Math.round(t.getBoundingClientRect().top) === tops[0]).length : 0
  const tiles = all.filter((t) => t.getAttribute('role') === 'group' && t.querySelector(':scope > a')).map((tile) => {
    const text = tile.querySelector(':scope > div'), link = tile.querySelector(':scope > a')
    const label = text.querySelector('span'), detail = text.querySelectorAll('span')[1] ?? null
    // The link holds one run (an outer span): the label's head, then the last word and the chevron in a no-wrap span (PB74-F1). `words` is the last-word span (sr-only on a phone).
    const run = link.firstElementChild, chev = link.querySelector('svg'), words = chev.previousElementSibling
    const texts = []
    for (const w = document.createTreeWalker(run, NodeFilter.SHOW_TEXT); w.nextNode();) if (w.currentNode.textContent.trim()) texts.push(w.currentNode)
    const textRects = () => texts.flatMap((n) => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()] }).filter((q) => q.width > 0.5)
    // The old row (flex; the text flex 1 with min-width 0; the link shrink-0, so its words at their one-line width): what is left for the text once the figure, the link and the two gaps are taken.
    const wrap = run.style.whiteSpace; run.style.whiteSpace = 'nowrap'
    const one = textRects()
    const oneLine = words.getBoundingClientRect().width > 1.5 && one.length ? Math.max(...one.map((q) => q.right)) - Math.min(...one.map((q) => q.left)) : 0
    run.style.whiteSpace = wrap
    const tb = box(tile), xb = box(text), lb = box(link), wb = box(words)
    const ts = getComputedStyle(tile), figure = tile.firstElementChild.getBoundingClientRect().width
    const linkOld = (oneLine > 1.5 ? oneLine + 2 : 0) + 16
    const before = Math.max(0, tile.clientWidth - parseFloat(ts.paddingLeft) - parseFloat(ts.paddingRight) - figure - linkOld - 2 * parseFloat(ts.columnGap))
    // The words' last line (text rects only, one per line and text node): the chevron must sit right after it, on the same line.
    const rects = textRects(), lastTop = rects.length ? Math.max(...rects.map((q) => q.top)) : 0
    const onLast = rects.filter((q) => q.top > lastTop - 3)
    const last = onLast.length ? { top: Math.min(...onLast.map((q) => q.top)), bottom: Math.max(...onLast.map((q) => q.bottom)), right: Math.max(...onLast.map((q) => q.right)) } : null
    const lines = rects.map((q) => q.top).sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 3).length
    const cb = box(chev)
    const chevGap = last ? cb.l - last.right : null, chevOnLine = !!last && cb.t >= last.top - 4 && cb.b <= last.bottom + 4
    const after = getComputedStyle(link, '::after'), cs = getComputedStyle(tile)
    return {
      label: (label?.textContent ?? '').trim(), tile: tb, text: xb, link: lb, words: wb,
      detailShown: !!detail && shown(detail), wordsShown: wb.w > 1.5 && wb.h > 1.5,
      folded: lb.t >= xb.b - 1, left: lb.l - xb.l,
      inside: lb.l >= tb.l - 1 && lb.r <= tb.r + 1 && lb.b <= tb.b + 1 && xb.l >= tb.l - 1 && xb.r <= tb.r + 1,
      coversTile: after.position === 'absolute' && after.top === '0px' && after.left === '0px' && after.right === '0px' && after.bottom === '0px',
      container: `${cs.containerType} ${cs.containerName}`, textMin: xb.w / rem, before, oneLine, lines, chevGap, chevOnLine,
    }
  })
  return { rem, tapMin, perRow, rows: tops.length, tiles, labels: all.map((t) => t.getAttribute('aria-label') ?? t.textContent.trim().slice(0, 30)) }
})

// Signs in and waits for the band; one reload if it does not draw. A failure prints what the page shows, so the next step starts from evidence.
let working = null
async function openDashboard(makeContext, tag) {
  for (const r of working ? [working] : ROLES) {
    const context = await makeContext()
    const page = await context.newPage()
    page.on('pageerror', (e) => console.log(`[polish-batch-74] ${tag} ${r.role} pageerror: ${String(e.message).slice(0, 300)}`))
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[polish-batch-74] ${tag} ${r.role} console.error: ${m.text().slice(0, 300)}`) })
    await signIn(page, r)
    const band = page.locator('section[aria-label="Alerts"]')
    try {
      await band.waitFor({ state: 'visible', timeout: 15_000 })
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
      try { await band.waitFor({ state: 'visible', timeout: 15_000 }) } catch {
        const seen = await page.evaluate(() => ({ url: location.pathname, bands: document.querySelectorAll('section[aria-label="Alerts"]').length, text: (document.querySelector('main') ?? document.body).innerText.replace(/s+/g, ' ').slice(0, 300) }))
        console.log(`[polish-batch-74] ${tag} ${r.role}: no band after a reload: ${JSON.stringify(seen)}`)
        await context.close()
        continue
      }
    }
    working = r
    console.log(`[polish-batch-74] ${tag} signed in as ${r.role}`)
    return { context, page, band, role: r.role }
  }
  throw new Error(`no role drew the Alerts band at ${tag}`)
}

try {
  const summary = []
  for (const profile of PROFILES) {
    const tag = profile.name
    const makeContext = () => browser.newContext({ ...AU_CONTEXT, viewport: { width: profile.width, height: profile.height }, hasTouch: profile.touch, isMobile: profile.touch, colorScheme: 'light', reducedMotion: 'reduce' })
    const { context, page, band, role } = await openDashboard(makeContext, tag)
    await page.waitForTimeout(1200)

    const m = await measureTiles(page)
    const names = m.tiles.map((t) => t.label)
    check(tag, 'the band shows the NDIS Commission overdue, Qualification issues and Overdue tiles', WANTED.every((w) => names.includes(w)), names)
    const phone = profile.width < 768
    const minText = Math.min(...m.tiles.map((t) => t.text.w))
    for (const t of m.tiles) console.log(`[polish-batch-74] ${tag} tile "${t.label}": tile ${fmt(t.tile.w)}px, text ${fmt(t.text.w)}px (${fmt(t.textMin)}rem), link ${fmt(t.link.w)}x${fmt(t.link.h)}, ${t.folded ? 'link UNDER the text' : 'link beside the text'}, detail ${t.detailShown ? 'shown' : 'hidden'}`)
    check(tag, 'every action tile is a size container named tile', m.tiles.length > 0 && m.tiles.every((t) => t.container === 'inline-size tile'), m.tiles.map((t) => t.container))
    check(tag, 'every link keeps its ::after over the whole tile', m.tiles.every((t) => t.coversTile))
    check(tag, 'every link and text column lies inside its tile', m.tiles.every((t) => t.inside), m.tiles.filter((t) => !t.inside).map((t) => t.label))

    if (!phone) {
      check(tag, 'every action tile shows its line', m.tiles.every((t) => t.detailShown))
      check(tag, 'every action tile text column is at least 12rem wide', m.tiles.every((t) => t.text.w >= 12 * m.rem - 0.5), m.tiles.map((t) => ({ l: t.label, w: fmt(t.text.w) })))
      check(tag, 'every link shows its words', m.tiles.every((t) => t.wordsShown), m.tiles.filter((t) => !t.wordsShown).map((t) => t.label))
      check(tag, 'every link box is at least --tap-min tall', m.tiles.every((t) => t.link.h >= m.tapMin - 0.5), m.tapMin)
      // A tile under 36rem folds; one at 36rem or more keeps the link beside the text. Either way the link never touches the text column.
      check(tag, 'a tile under 36rem has its link under the text, left edge on the text column', m.tiles.filter((t) => t.tile.w < 36 * m.rem).every((t) => t.folded && Math.abs(t.left) <= 1), m.tiles.map((t) => ({ l: t.label, w: fmt(t.tile.w), folded: t.folded, left: fmt(t.left) })))
      check(tag, 'a tile at 36rem or more has its link beside the text', m.tiles.filter((t) => t.tile.w >= 36 * m.rem).every((t) => !t.folded))
      // PB74-F1: wrapped or not, the chevron follows the last word: 0 to 8px after the last line box, inside that line box (4px).
      if (profile.width === 1440) check(tag, 'every link chevron sits 0 to 8px after the last line of its words, on that line', m.tiles.length > 0 && m.tiles.every((t) => t.chevGap !== null && t.chevGap >= 0 && t.chevGap <= 8 && t.chevOnLine), m.tiles.map((t) => ({ l: t.label, lines: t.lines, gap: fmt(t.chevGap), onLine: t.chevOnLine })))
    } else {
      check(tag, 'the detail is hidden in every action tile', m.tiles.every((t) => !t.detailShown))
      check(tag, 'the link words are sr-only (1px) in every action tile', m.tiles.every((t) => !t.wordsShown), m.tiles.map((t) => fmt(t.words.w)))
      check(tag, 'every link box is at least --tap-min tall with touch emulation', m.tapMin >= 44 && m.tiles.every((t) => t.link.h >= m.tapMin - 0.5), { tapMin: m.tapMin, heights: m.tiles.map((t) => fmt(t.link.h)) })
      check(tag, 'no link drops under the text on a phone', m.tiles.every((t) => !t.folded), m.tiles.map((t) => t.folded))
      check(tag, 'one tile a row', m.perRow === 1, m.perRow)
    }

    checks.push(checkCropHolds(await cropElement(page, band, path.join(OUT_DIR, `tiles-${profile.name}.png`), { touch: profile.touch, pad: 12, natural: profile.touch })))
    // The helper's layout checks on the dashboard: fullPage runs them at the two widths it shoots; the others run the same check directly.
    if (profile.full) {
      const full = await fullPage(page, path.join(OUT_DIR, 'full', `dashboard-${profile.name}.png`), { touch: profile.touch })
      checks.push(...full.checks)
    } else {
      checks.push(await layoutCheck(page, page.locator('main').first(), `dashboard-${profile.name}`))
    }

    summary.push({ width: profile.width, role, perRow: m.perRow, rows: m.rows, tiles: m.tiles.map((t) => ({ label: t.label, tileW: fmt(t.tile.w), before: fmt(t.before), linkOneLine: fmt(t.oneLine), after: fmt(t.text.w), link: t.folded ? 'under the text' : 'beside the text', detail: t.detailShown })) })
    await context.close()
  }
  writeFileSync(path.join(OUT_DIR, 'measure.json'), JSON.stringify(summary, null, 2))
  for (const s of summary) console.log(`[polish-batch-74] SUMMARY ${s.width}: ${s.perRow} a row, ` + s.tiles.map((t) => `${t.label} tile ${t.tileW} text ${t.before}->${t.after} (${t.link})`).join('; '))
} finally {
  await browser.close()
}
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
