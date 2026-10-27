import { test, expect } from '../../support/fixtures'
import { SEEDED } from '../../support/env'

// The installable shell (spec 2026-10-27): the manifest and worker are served with the right headers, the worker installs (every precache URL
// is a 200: one 404 makes cache.addAll reject and the worker never installs, with no visible error), and a signed-in support worker can reload
// with the network off and still get the app shell. The worker is blocked by default (playwright.config.ts); this describe opts in.
test.describe('install shell @pwa', () => {
  test.use({ role: SEEDED.supportWorker, serviceWorkers: 'allow', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('serves the manifest and the worker uncached, with the security headers', async ({ request }) => {
    const manifest = await request.get('/manifest.webmanifest')
    expect(manifest.status()).toBe(200)
    expect(manifest.headers()['content-type']).toContain('application/manifest+json')
    expect(manifest.headers()['cache-control']).toContain('no-cache')
    const sw = await request.get('/sw.js')
    expect(sw.status()).toBe(200)
    expect(sw.headers()['cache-control']).toContain('no-cache')
    expect(sw.headers()['content-security-policy']).toBeTruthy()
    expect(sw.headers()['x-frame-options']).toBeTruthy()
  })

  test('precaches the app entry, nothing of /welcome/, and every listed URL is a 200', async ({ request }, testInfo) => {
    const html = await (await request.get('/index.html')).text()
    const entry = /<script type="module"[^>]*src="([^"]+)"/.exec(html)?.[1]
    expect(entry, 'index.html names an entry script').toBeTruthy()
    const text = await (await request.get('/sw.js')).text()
    const precache = JSON.parse(/const PRECACHE = (\[.*\])/.exec(text)![1]) as string[]
    expect(precache).toContain(entry)
    expect(precache.filter(u => u.includes('welcome'))).toEqual([])
    let bytes = 0
    for (const url of precache) {
      const res = await request.get(url)
      expect(res.status(), url).toBe(200)
      bytes += (await res.body()).length
    }
    testInfo.annotations.push({ type: 'precache', description: `${precache.length} files, ${bytes} bytes` })
    console.log(`PRECACHE ${precache.length} files, ${bytes} bytes`)
  })

  test('a signed-in support worker reloads offline and still gets the shell, with the API unreachable', async ({ page, context }) => {
    const hosts = new Set<string>()
    page.on('request', r => hosts.add(new URL(r.url()).hostname))
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Mobile' })
    await expect(nav).toBeVisible()
    await page.evaluate(() => navigator.serviceWorker.ready)
    await page.reload()
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

    await context.setOffline(true)
    const res = await page.reload()
    expect(res?.fromServiceWorker(), 'the reload came from the worker').toBe(true)
    await expect(nav).toBeVisible()
    // An offline switch that never reached the worker could not fail this: the API must be unreachable from the page.
    expect(await page.evaluate(() => fetch('/api/v1/portal/my-shifts').then(() => 'reached', () => 'rejected'))).toBe('rejected')
    // Icons are a ligature font (Material Symbols): loaded from the worker's cache, not just declared, or every icon reads as its name.
    expect(await page.evaluate(async () => { await document.fonts.ready; return [...document.fonts].some(f => f.family.includes('Material Symbols Outlined') && f.status === 'loaded') })).toBe(true)
    await context.setOffline(false)
    expect([...hosts]).toEqual(['127.0.0.1'])
  })
})
