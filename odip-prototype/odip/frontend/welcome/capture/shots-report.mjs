/**
 * Stage 6: REPORT ON TIME shots that live outside shots.mjs (body map crop, trip history). Same shape as shots.mjs.
 */
import { driveIncidentToDetails } from './drivers.mjs'

export const shots = []

shots.push({
  name: 'report-body-map',
  stage: 'report-on-time',
  priority: 'P1',
  route: '/incidents/new',
  cropTarget: 'Injuries card of the Incident Details step: region buttons, front and back body map with the left forearm selected, selected-region line, injury type and injury description; cut just below the description field',
  fixture: false,
  now: '2026-07-11T15:00:00+10:00',
  viewport: { width: 1000, height: 900 },
  alt: 'Injuries card from the incident wizard: grouped body region buttons (head and torso, arms, legs, other) beside a front and back body map with the left forearm highlighted, then the selected region, an injury type of Abrasion and an injury description reading "Small graze, cleaned and dressed on site."',
  notes: 'Mock data; filled through the real UI, no fixtures. The step rail cannot be included: on this step the Incident Details card sits between the rail and the Injuries card, so they are not contiguous (see report-incident-wizard for the rail). The crop is cut inside the card just below the Injury Description field, which leaves out the Add injury button (dark text on dark green in the app) and the empty recorded-injuries table. 1000px viewport, same as the wizard shot.',
  async run({ page, goto, settle, unionRect }) {
    await driveIncidentToDetails(page, goto, { addInjury: false })
    await page.getByText('Selected region:').waitFor()
    await settle()
    const card = page.getByRole('heading', { name: 'Injuries' }).locator('xpath=ancestor::div[contains(@class,"rounded-md")][1]')
    const description = page.getByLabel(/^Injury Description/i).first()
    const cardBox = await unionRect([card], 0)
    const descBox = await unionRect([description], 0)
    const cutY = descBox.y + descBox.height + 14
    return { rect: { x: cardBox.x - 4, y: cardBox.y - 4, width: cardBox.width + 8, height: cutY - (cardBox.y - 4) } }
  },
})

// ---- Trip History (audit) tab: GET audit/TripInstance/t-0001 -------------------------------------------------------
// Unlike every other endpoint the audit route returns its body WITHOUT the ApiResponse envelope (AuditController returns
// { entries, total, page, pageSize, totalPages } directly and useAuditHistory reads res.data), so this fixture is raw.
// Entries for mock trip SCB-2608 (t-0001), newest first, consistent with its mock record (Confirmed, Caloundra QLD, Sunshine
// Coast region, its mock notes text). Round 2: only plain single-word fields (Status, Notes, Destination, Region) so every row
// reads cleanly. Times are relative to the pinned clock (2026-08-04 10:00 +10:00).
const auditEntries = [
  {
    id: 'au-0005', action: 'Updated', changedAt: '2026-08-03T21:00:00Z', changedByName: 'Priya Nadarajah',
    changes: [{ field: 'Status', old: 'Planning', new: 'Confirmed' }],
  },
  {
    id: 'au-0004', action: 'Updated', changedAt: '2026-08-03T01:20:00Z', changedByName: 'Callum Radford',
    changes: [{ field: 'Notes', old: 'Beachfront house enquiry sent.', new: 'Beachfront house confirmed. Check hoist availability for Sienna.' }],
  },
  {
    id: 'au-0003', action: 'Updated', changedAt: '2026-07-31T03:05:00Z', changedByName: 'Priya Nadarajah',
    changes: [{ field: 'Destination', old: 'Sunshine Coast', new: 'Caloundra QLD' }],
  },
  {
    id: 'au-0002', action: 'Updated', changedAt: '2026-07-24T22:30:00Z', changedByName: 'Callum Radford',
    changes: [{ field: 'Region', old: 'Gold Coast', new: 'Sunshine Coast' }],
  },
  { id: 'au-0001', action: 'Created', changedAt: '2026-07-08T00:10:00Z', changedByName: 'Callum Radford', changes: [] },
]

shots.push({
  name: 'report-history',
  stage: 'report-on-time',
  priority: 'P2',
  route: '/trips/t-0001?tab=history',
  cropTarget: 'Trip History tab content: event count and the audit timeline of who changed what and when',
  fixture: true,
  now: '2026-08-04T10:00:00+10:00',
  alt: 'History tab for Sunshine Coast Beach Escape listing five recorded events, newest first, each with who and how long ago: Priya Nadarajah changed Status from Planning to Confirmed 3 hours ago, Callum Radford updated the Notes to "Beachfront house confirmed. Check hoist availability for Sienna.", Priya changed Destination to Caloundra QLD, Callum changed Region to Sunshine Coast, and Callum created the trip 26 days ago.',
  notes: 'Fixture: the mock has no audit route, so GET audit/TripInstance/t-0001 is fed five entries consistent with the mock trip record. The real endpoint returns its body without the usual ApiResponse envelope and the fixture does the same. Round 2: the fixture uses only plain single-word field names (Status, Notes, Destination, Region) and plain values, so no row shows a camelCase or snake_case property name. The real endpoint prints whatever property names the audit log holds.',
  async setup(page) {
    await page.route(/\/api\/v1\/audit\/TripInstance\/t-0001(\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ entries: auditEntries, total: auditEntries.length, page: 1, pageSize: 50, totalPages: 1 }),
      }))
  },
  async run({ page, goto }) {
    await goto('/trips/t-0001?tab=history')
    await page.getByText('5 events recorded').waitFor()
    return { locator: page.getByRole('tabpanel'), pad: 8 }
  },
})
