// Sign-in page: the warning above the form when this phone holds unsent changes from a worker (named copy). Exit 1 on any failed check.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to>/e2e/shots/signin-unsent-notice.mjs <outdir>
// Served by the mock API; the queue is seeded in localStorage before load; theme pinned to light.
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { AU_CONTEXT, prepareOutDir, cropElement, checkCropHolds, writeChecks } from '../shots/lib/capture.mjs'

let chromium
try { ;({ chromium } = await import('playwright')) } catch { ;({ chromium } = await import('@playwright/test')) }

const BASE_URL = process.env.BASE_URL
const OUT_DIR = process.env.OUT_DIR
if (!BASE_URL || !OUT_DIR) throw new Error('BASE_URL and OUT_DIR must be set (run this through odip-test.sh shots)')
mkdirSync(OUT_DIR, { recursive: true })
prepareOutDir(OUT_DIR)

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })
const queue = [1, 2].map((i) => ({ id: `r${i}`, userId: 'u-asha', ownerFirstName: 'Asha', viewAsTenant: null, viewAsUser: null, shiftId: 's1', kind: 'start', path: '/x', method: 'POST', body: {}, clientTime: '2026-11-06T00:00:00Z', createdAt: i, status: 'waiting', label: { participant: 'P', serviceDate: '2026-11-06', rostered: '9-1' } }))

const VPS = [{ name: '390', width: 390, height: 844, touch: true }, { name: '1280', width: 1280, height: 900, touch: false }]
const browser = await chromium.launch({ headless: true })
for (const vp of VPS) {
  const t = (n) => `${vp.name}: ${n}`
  const state = `signin-unsent-named-${vp.name}`
  try {
    const context = await browser.newContext({ ...AU_CONTEXT, colorScheme: 'light', viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.addInitScript((q) => { localStorage.setItem('odip_offline:u-asha:queue', JSON.stringify(q)) }, queue)
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const note = page.getByRole('status').filter({ hasText: 'unsent changes from Asha' })
    await note.waitFor({ state: 'visible', timeout: 60_000 })
    const text = (await note.innerText()).replace(/\s+/g, ' ').trim()
    check(t('copy is the named sentence pair'), text.includes('2 unsent changes from Asha are on this phone.') && text.includes('Sign in as Asha to send them. Signing in as anyone else deletes them.'), text)
    const m = await page.evaluate(() => {
      const n = [...document.querySelectorAll('[role="status"]')].find((e) => /unsent change/.test(e.textContent))
      const form = document.querySelector('form').getBoundingClientRect(), r = n.getBoundingClientRect()
      const clipped = [n, ...n.querySelectorAll('*')].some((e) => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis')
      return { noteW: r.width, formW: form.width, noteLeft: r.left, formLeft: form.left, noteBottom: r.bottom, formTop: form.top, docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped }
    })
    check(t('notice is as wide as the form card (same column), no larger'), Math.abs(m.noteW - m.formW) <= 1 && Math.abs(m.noteLeft - m.formLeft) <= 1, m)
    check(t('notice sits above the form card'), m.noteBottom <= m.formTop + 0.5, m)
    check(t('no horizontal page overflow; no clipped or ellipsised text'), m.docOverflow <= 0 && !m.clipped, m)
    check(t('the notice adds no control, so no tap target to size'), (await note.locator('button, a, input').count()) === 0)
    const r = await cropElement(page, note, path.join(OUT_DIR, `${state}.png`), { touch: vp.touch, natural: true, pad: 16 })
    checks.push(checkCropHolds({ ...r, touch: vp.touch }))
    await context.close()
  } catch (e) { check(t(`${state} ran`), false, String(e.message).split('\n')[0]) }
}
await browser.close()
process.exit(writeChecks(OUT_DIR, checks) ? 0 : 1)
