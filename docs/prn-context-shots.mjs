import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const { BASE_URL, OUT_DIR } = process.env
if (!BASE_URL || !OUT_DIR) throw new Error('Controlled runner variables are required')
mkdirSync(OUT_DIR, { recursive: true })
const envelope = (data) => ({ success: true, data, message: null, errors: [] })
const user = envelope([{ username: 'dev.coordinator', role: 'Coordinator', tenantName: 'Sample Support Co' }])
const login = envelope({ id: 'dev-1', token: 'mock-jwt-token', expiresAt: '2099-01-01T00:00:00Z', username: 'dev.coordinator', fullName: 'Dev Coordinator', role: 'Coordinator', tenantName: 'Sample Support Co', tenantId: 'tenant-1' })
const prn = { medicationId: 'm-1', participantId: 'p-1', participantName: 'Noah Blake', name: 'Ibuprofen', strength: '200mg', doseDescription: '1 tablet', prnIndication: 'Pain', prnMaxDosesPer24h: 4, prnMinIntervalMinutes: 240, packaging: 'OriginalPackaging', dosesInLast24h: 1, lastDoseAt: '2026-10-17T04:00:00Z', outcomePendingAdministrationId: 'admin-1' }
const exactAdministration = { id: 'admin-1', status: 'Administered', incidentId: null, administeredAt: '2026-10-17T03:30:00Z', administeredAtTimeZone: 'Australia/Sydney', recordedByName: 'Dev Coordinator', participantId: 'p-1', participantName: 'Noah Blake', medicationName: 'Ibuprofen', doseDescription: '1 tablet', reason: null, notes: null, tripInstanceId: null, scheduledAt: '2026-10-17T03:30:00Z' }
const entry = { medicationId: 'm-1', participantId: 'p-1', participantName: 'Noah Blake', medicationName: 'Ibuprofen', strength: '200mg', doseDescription: '1 tablet', form: 'Tablet', route: 'Oral', packaging: 'OriginalPackaging', pharmacyName: null, pharmacyPhone: null, scheduledTime: '03:30', scheduledAt: '2026-10-17T03:30:00Z', isHighRisk: false, supportLevel: 'FullSupport', isOverdue: false, administration: exactAdministration }
const browser = await chromium.launch({ headless: true })
try {
  for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: name === 'mobile', hasTouch: name === 'mobile', locale: 'en-AU', timezoneId: 'Australia/Sydney' })
    const page = await context.newPage()
    await page.route('**/api/v1/auth/dev-users', route => route.fulfill({ json: user }))
    await page.route('**/api/v1/auth/dev-login', route => route.fulfill({ json: login }))
    await page.route('**/api/v1/medications/mar*', route => route.fulfill({ json: envelope({ date: '2026-10-17', entries: [entry], prnMedications: [prn] }) }))
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.getByRole('button', { name: 'Sign in as selected user' }).click()
    await page.goto(`${BASE_URL}/medications`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.getByRole('button', { name: 'Record outcome' }).click()
    await page.getByText('Noah Blake · Ibuprofen 200mg').waitFor()
    await page.getByText(/Given/).waitFor()
    await page.screenshot({ path: path.join(OUT_DIR, `prn-context-${name}-${width}x${height}.png`) })
    await context.close()
  }
} finally { await browser.close() }
