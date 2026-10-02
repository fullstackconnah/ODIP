/**
 * Stage 2: STAY shots (trip accommodation). Same shape as shots.mjs.
 */
export const shots = []

const envelope = (data) => JSON.stringify({ success: true, data, message: null, errors: null })

// GET trips/t-0001/accommodation (the mock returns [] for every trip).
// Trip SCB-2608 (Sunshine Coast Beach Escape, 14-17 Aug 2026) needs 8 beds / 5 bedrooms (mock trip record);
// Seabreeze Accessible House (mock property a-0001) has 5 bedrooms / 8 beds, max 9, wheelchair accessible.
// Backend rule (BookingsAccommodationController): HasOverlapConflict is set when another active reservation at the same
// property overlaps the dates, so the second row is an extension request for the same house that overlaps the confirmed
// stay on the nights of 16-17 Aug. Costs are obviously-sample values.
const scbAccommodation = [
  {
    id: 'res-0001', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
    accommodationPropertyId: 'a-0001', propertyName: 'Seabreeze Accessible House',
    requestSentDate: '2026-06-20', dateBooked: '2026-06-26', dateConfirmed: '2026-07-01',
    checkInDate: '2026-08-14', checkOutDate: '2026-08-17', bedroomsReserved: 5, bedsReserved: 8,
    cost: 2850, confirmationReference: 'SAH-140826', reservationStatus: 'Confirmed',
    comments: 'Ceiling hoist in bedroom 1; hire a mobile hoist for the second accessible room.',
    cancellationReason: null, hasOverlapConflict: false,
  },
  {
    id: 'res-0002', tripInstanceId: 't-0001', tripName: 'Sunshine Coast Beach Escape',
    accommodationPropertyId: 'a-0001', propertyName: 'Seabreeze Accessible House',
    requestSentDate: '2026-07-28', dateBooked: null, dateConfirmed: null,
    checkInDate: '2026-08-16', checkOutDate: '2026-08-18', bedroomsReserved: 2, bedsReserved: 3,
    cost: 1100, confirmationReference: null, reservationStatus: 'Requested',
    comments: 'Extension request for a late return; overlaps the confirmed stay.',
    cancellationReason: null, hasOverlapConflict: true,
  },
]

shots.push({
  name: 'stay-accommodation',
  stage: 'stay',
  priority: 'P1',
  route: '/trips/t-0001?tab=accommodation',
  cropTarget: 'Trip Accommodation tab panel: reservation count, Stay Timeline coverage bar with reservation bars, and the reservations table with status, dates, bedrooms / beds and a Conflict flag',
  fixture: true,
  now: '2026-08-04T10:00:00+10:00',
  alt: 'Accommodation tab for Sunshine Coast Beach Escape with two reservations at Seabreeze Accessible House: a Confirmed stay for 14 to 17 August holding 5 of 5 bedrooms and 8 of 8 beds, and a Requested extension for 16 to 18 August marked with a red Conflict flag because it overlaps; a Stay Timeline above shows all 3 nights covered.',
  notes: 'Fixture: the mock returns an empty list for trips/:id/accommodation, so GET trips/t-0001/accommodation is fed two reservations. Property, trip dates and bed/bedroom requirement (8 beds, 5 bedrooms) come from the mock; the second reservation is an overlapping extension request so the double-booking flag shows. Costs are sample values.',
  async setup(page) {
    await page.route(/\/api\/v1\/trips\/t-0001\/accommodation(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: envelope(scbAccommodation) }))
  },
  async run({ page, goto }) {
    await goto('/trips/t-0001?tab=accommodation')
    await page.getByText('Seabreeze Accessible House').first().waitFor()
    await page.getByText('Conflict', { exact: true }).waitFor()
    await page.getByText('Wheelchair Accessible').first().waitFor()
    return { locator: page.getByRole('tabpanel'), pad: 8 }
  },
})
