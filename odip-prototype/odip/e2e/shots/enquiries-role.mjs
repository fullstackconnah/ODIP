// Participants tabs by role: a SupportWorker has no Enquiries tab and makes no GET /inquiries; a Coordinator keeps it. Exit 1 on any failure.
//   bash F:/Projects/.claude/tools/odip-server-test/odip-test.sh <worktree> shots <abs path to this script> <outdir>
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

const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const login = (role) => envelope({ id: '00000000-0000-0000-0000-0000000000a1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.user', fullName: 'Dev User', role, tenantName: 'Sample Support Co', tenantId: 'tenant-0001' })
const devUsers = (role) => envelope([{ username: 'dev.user', role, tenantName: 'Sample Support Co' }])

const checks = []
const check = (name, pass, detail = '') => checks.push({ name, pass: !!pass, detail })

async function open(browser, role, s) {
  const context = await browser.newContext({ ...AU_CONTEXT, viewport: { width: s.width, height: s.height }, hasTouch: s.touch, isMobile: s.touch })
  const page = await context.newPage()
  const inquiryCalls = []
  page.on('pageerror', (e) => console.log(`[enquiries-role] pageerror ${String(e.message).slice(0, 200)}`))
  page.on('request', (r) => { if (/\/api\/v1\/inquiries(\/|\?|$)/.test(r.url())) inquiryCalls.push(r.url()) })
  await page.route('**/api/v1/auth/dev-users', (r) => r.fulfill({ json: devUsers(role) }))
  await page.route('**/api/v1/auth/dev-login', (r) => r.fulfill({ json: login(role) }))
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  const signIn = page.getByRole('button', { name: 'Sign in as selected user' })
  await signIn.waitFor({ state: 'visible', timeout: 60_000 })
  await signIn.click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
  inquiryCalls.length = 0
  return { context, page, inquiryCalls }
}

const browser = await chromium.launch({ headless: true })
const SCENES = [
  { tag: '1280', width: 1280, height: 900, touch: false },
  { tag: '390', width: 390, height: 844, touch: true },
]
for (const s of SCENES) {
  try {
    // SupportWorker: tab bar, then the deep link.
    const sw = await open(browser, 'SupportWorker', s)
    await sw.page.goto(`${BASE_URL}/participants`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const tabs = sw.page.getByRole('tablist', { name: 'Lifecycle stages' })
    await tabs.waitFor({ state: 'visible', timeout: 30_000 })
    await sw.page.waitForTimeout(600)
    const labels = (await tabs.getByRole('tab').allInnerTexts()).map((t) => t.trim())
    check(`${s.tag} sw: no tab labelled Enquiries`, !labels.includes('Enquiries'), labels)
    check(`${s.tag} sw: tabs are Onboarding, Active participants`, labels.join('|') === 'Onboarding|Active participants', labels)
    const crop = await cropElement(sw.page, tabs, path.join(OUT_DIR, `participants-tabs-sw-${s.tag}.png`), { touch: s.touch })
    checks.push(checkCropHolds({ ...crop, touch: s.touch }))
    checks.push(...(await fullPage(sw.page, path.join(OUT_DIR, 'full', `participants-sw-${s.tag}.png`), { touch: s.touch })).checks)

    await sw.page.goto(`${BASE_URL}/participants?tab=enquiries`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await tabs.waitFor({ state: 'visible', timeout: 30_000 })
    await sw.page.waitForTimeout(800)
    const selected = (await tabs.getByRole('tab', { selected: true }).allInnerTexts()).map((t) => t.trim())
    check(`${s.tag} sw deep link: the default tab is selected`, selected.join('|') === 'Active participants', selected)
    check(`${s.tag} sw deep link: no request to /inquiries`, sw.inquiryCalls.length === 0, sw.inquiryCalls)
    if (s.tag === '1280') {
      const c2 = await cropElement(sw.page, tabs, path.join(OUT_DIR, 'sw-enquiries-deeplink-1280.png'), { touch: s.touch })
      checks.push(checkCropHolds({ ...c2, touch: s.touch }))
    }
    await sw.context.close()

    // Coordinator: the tab is there.
    const co = await open(browser, 'Coordinator', s)
    await co.page.goto(`${BASE_URL}/participants`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    const coTabs = co.page.getByRole('tablist', { name: 'Lifecycle stages' })
    await coTabs.waitFor({ state: 'visible', timeout: 30_000 })
    await co.page.waitForTimeout(600)
    const coLabels = (await coTabs.getByRole('tab').allInnerTexts()).map((t) => t.trim())
    check(`${s.tag} coord: the Enquiries tab is present`, coLabels.includes('Enquiries'), coLabels)
    if (s.tag === '1280') {
      const c3 = await cropElement(co.page, coTabs, path.join(OUT_DIR, 'participants-tabs-coord-1280.png'), { touch: s.touch })
      checks.push(checkCropHolds({ ...c3, touch: s.touch }))
    }
    await co.context.close()
  } catch (e) {
    check(`${s.tag}: scene ran`, false, String(e.message).split('\n')[0])
  }
}
await browser.close()
if (!writeChecks(OUT_DIR, checks)) process.exitCode = 1
