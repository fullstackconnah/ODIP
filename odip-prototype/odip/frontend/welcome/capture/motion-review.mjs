// The landing page's motion, slowed 4x and caught mid-motion for review (SHAPE section 9), with a video per context. Run as
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <slot> shots <abs>/welcome/capture/motion-review.mjs <outdir>
// Frames are <seq>-<width>-<n>.png. The page is never edited: the slow-down is CDP's animation playback rate, or, if that
// does not take, a style tag that multiplies the motion tokens by 4 (the script says which ran).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const { chromium } = await import('playwright')

const BASE = process.env.BASE_URL.replace(/\/$/, '') + '/welcome/'
const OUT = process.env.OUT_DIR
mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ headless: true })
const SLOW = 4
const report = {}
const TOKENS = ['--dur-press', '--dur-hover', '--dur-strike', '--dur-frame', '--delay-frame', '--stagger', '--dur-dot', '--dur-label', '--dur-drop', '--delay-drop', '--dur-fade']

async function open(name, w, h, { mobile = false, reduce = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, reducedMotion: reduce ? 'reduce' : 'no-preference',
    recordVideo: { dir: path.join(OUT, `video-${name}`), size: { width: w, height: h } },
  })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Animation.enable')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW })
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  // Prove the slow-down took: the hero dot's drop should advance about 100 ms in 400 ms of wall clock.
  const advanced = await page.evaluate(async () => {
    const a = document.getAnimations().find((x) => x.animationName === 'drop' || x.animationName === 'fade')
    if (!a) return null
    const t0 = a.currentTime
    await new Promise((r) => setTimeout(r, 400))
    return a.currentTime - t0
  })
  let method = 'cdp-playback-rate'
  if (advanced === null || advanced > 200) {
    method = 'token-style'
    const vals = await page.evaluate((ts) => Object.fromEntries(ts.map((t) => [t, getComputedStyle(document.documentElement).getPropertyValue(t).trim()])), TOKENS)
    await page.addStyleTag({ content: `:root { ${Object.entries(vals).map(([t, v]) => `${t}: ${parseFloat(v) * SLOW}ms`).join('; ')} }` })
  }
  report[name] = { method, dropAdvancedMsIn400: advanced }
  await page.evaluate(() => document.fonts.ready)
  return { ctx, page }
}

/** n frames at even intervals across `ms` of wall clock. */
async function frames(page, seq, w, n, ms) {
  for (let i = 1; i <= n; i++) {
    await page.screenshot({ path: path.join(OUT, `${seq}-${w}-${i}.png`) })
    if (i < n) await page.waitForTimeout(ms / (n - 1))
  }
}

for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  // drop: the hero dot on load, 0 to 2.4 s slowed.
  {
    const { ctx, page } = await open(`drop-${w}`, w, h, { mobile })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await frames(page, 'drop', w, 7, 2400)
    await ctx.close()
  }
  // arrive: #t1000 crosses 88% (its strike draws), then its screen reaches the viewport and settles; the On shift phones,
  // entering together, show the 60 ms stagger.
  {
    const { ctx, page } = await open(`arrive-${w}`, w, h, { mobile })
    await page.evaluate(() => { const s = document.getElementById('t1000'); scrollTo({ top: s.getBoundingClientRect().top + scrollY - innerHeight * 0.8, behavior: 'instant' }) })
    await frames(page, 'arrive', w, 8, (420 + 80 + 60) * SLOW)
    await page.evaluate(() => { const s = document.querySelector('#t1000 .shot'); scrollTo({ top: s.getBoundingClientRect().top + scrollY - innerHeight * 0.3, behavior: 'instant' }) })
    await frames(page, 'settle', w, 8, (420 + 80) * SLOW)
    await page.evaluate(() => { const s = document.querySelector('#onshift .phones'); scrollTo({ top: s.getBoundingClientRect().top + scrollY - innerHeight * 0.2, behavior: 'instant' }) })
    await frames(page, 'stagger', w, 8, (420 + 80 + 60) * SLOW)
    await ctx.close()
  }
  // rail (1440 only): 10:00 to 1:00 mid-travel, then the retarget: 4:00 and, 300 ms slowed later, 11:30.
  if (w === 1440) {
    const { ctx, page } = await open('rail-1440', w, h)
    const centre = (id) => page.evaluate((i) => document.getElementById(i).scrollIntoView({ block: 'center', behavior: 'instant' }), id)
    const dotY = () => page.evaluate(() => Math.round(new DOMMatrix(getComputedStyle(document.querySelector('.rail__dot')).transform).m42))
    await centre('t1000')
    await page.waitForTimeout(420 * SLOW + 200)
    await centre('t1300')
    await frames(page, 'rail', w, 6, 420 * SLOW)
    await centre('t1600')
    await page.waitForTimeout(300 * SLOW)
    const before = await dotY()
    await centre('t1130')
    const ys = []
    for (let i = 1; i <= 6; i++) {
      ys.push(await dotY())
      await page.screenshot({ path: path.join(OUT, `retarget-${w}-${i}.png`) })
      await page.waitForTimeout((420 * SLOW) / 5)
    }
    const target = await page.evaluate(() => document.querySelector('.rail__stops .is-now').offsetTop)
    report.retarget = { atRetarget: before, samples: ys, target, firstStep: ys[0] - before }
    await ctx.close()
  }
  // press: the button under the pointer (desktop), a tap on a phone (no hover nudge).
  {
    const { ctx, page } = await open(`press-${w}`, w, h, { mobile })
    const btn = page.locator('.cta-row .btn--olive')
    if (mobile) {
      const box = await btn.boundingBox()
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
      await page.waitForTimeout(150)
      report[`press-${w}`] = { ...report[`press-${w}`], arrowTransform: await page.evaluate(() => getComputedStyle(document.querySelector('.cta-row .btn--olive .ico')).transform) }
      await page.screenshot({ path: path.join(OUT, `press-${w}-1.png`) })
    } else {
      await btn.hover()
      await page.waitForTimeout(150 * SLOW)
      await page.screenshot({ path: path.join(OUT, `press-${w}-1.png`) })
      await page.mouse.down()
      await page.waitForTimeout(120 * SLOW)
      await page.screenshot({ path: path.join(OUT, `press-${w}-2.png`) })
      report[`press-${w}`] = { ...report[`press-${w}`], pressed: await btn.evaluate((el) => getComputedStyle(el).transform) }
      await page.mouse.up()
      await page.waitForTimeout(120 * SLOW)
      await page.screenshot({ path: path.join(OUT, `press-${w}-3.png`) })
    }
    await ctx.close()
  }
  // received: a submit to the live mock, frames through the fade.
  {
    const { ctx, page } = await open(`received-${w}`, w, h, { mobile })
    await page.fill('#f-name', 'Alex Sample')
    await page.fill('#f-org', 'Sample Support Co')
    await page.fill('#f-email', 'alex@example.org')
    await page.selectOption('#f-size', '10-49')
    await page.locator('[data-submit]').click()
    await page.locator('[data-success]').waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('#join').scrollIntoViewIfNeeded()
    await frames(page, 'received', w, 6, 200 * SLOW)
    await ctx.close()
  }
  // reduced: the same arrival (and the rail at 1440) under reduced motion; opacity only, the dot jumps.
  {
    const { ctx, page } = await open(`reduced-${w}`, w, h, { mobile, reduce: true })
    await page.evaluate(() => { const s = document.querySelector('#t1000 .shot'); scrollTo({ top: s.getBoundingClientRect().top + scrollY - innerHeight * 0.3, behavior: 'instant' }) })
    await frames(page, 'reduced-arrive', w, 6, 200 * SLOW + 400)
    report[`reduced-${w}`] = {
      ...report[`reduced-${w}`],
      shotTransition: await page.evaluate(() => getComputedStyle(document.querySelector('#t1000 .shot')).transitionProperty),
      shotTransform: await page.evaluate(() => getComputedStyle(document.querySelector('#t1000 .shot')).transform),
    }
    if (w === 1440) {
      await page.evaluate(() => document.getElementById('t1430').scrollIntoView({ block: 'center', behavior: 'instant' }))
      await frames(page, 'reduced-rail', w, 3, 400)
      report['reduced-1440'].dotTransition = await page.evaluate(() => getComputedStyle(document.querySelector('.rail__dot')).transitionDuration)
    }
    await ctx.close()
  }
}

writeFileSync(path.join(OUT, 'motion.json'), JSON.stringify(report, null, 1))
console.log('MOTION ' + JSON.stringify(report))
await browser.close()
