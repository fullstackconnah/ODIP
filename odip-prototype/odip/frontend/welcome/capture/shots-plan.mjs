/**
 * Stage 1: PLAN shots that live outside shots.mjs (dashboard attention band). Same shape as shots.mjs.
 */
import { graceAlerts } from './fixtures.mjs'

export const shots = []

shots.push({
  name: 'plan-dashboard-missing',
  stage: 'plan',
  priority: 'P1',
  route: '/',
  cropTarget: 'Dashboard "Needs attention" band: tiles for Missing Accommodation, Missing Vehicles and Missing Staff (amber) among the other attention tiles; page title, sidebar and top bar excluded',
  fixture: true,
  now: '2026-08-04T10:00:00+10:00',
  alt: 'The dashboard Needs attention band as two rows of tinted tiles with large figures: Qualification Issues 2, Critical Participant Alerts 1, Overdue 1 and QSC Overdue 1 in red; Missing Accommodation 1, Missing Vehicles 1, Missing Staff 2, Open Incidents 2 and Pending Leave 5 in amber.',
  notes: 'Mock dashboard summary (static counts). The mock answers GET participants/alerts with a participant object, which crashes the page (alertsAggregate.filter), so that one request is fixtured with the Grace Palmer-Hughes alert set also used by care-risk-alerts; that makes the Critical Participant Alerts tile read 1. Everything else is the mock.',
  async setup(page) {
    await page.route(/\/api\/v1\/participants\/alerts(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [graceAlerts], message: null, errors: null }) }))
  },
  async run({ page, goto }) {
    // The app's route gate sends a signed-out visitor at exactly "/" to the landing page. Visit another route first so the
    // mock-preview session is seeded (main.tsx), then load "/" as a signed-in user.
    await goto('/trips')
    await goto('/')
    const band = page.getByRole('region', { name: 'Needs attention' })
    await band.waitFor()
    await page.getByText('Missing Accommodation').first().waitFor()
    return { locator: band, pad: 8 }
  },
})
