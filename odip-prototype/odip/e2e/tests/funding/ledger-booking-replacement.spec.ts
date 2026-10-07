import { expect, Locator, Page } from '@playwright/test';
import { call, test } from '../../support/fixtures';
import { expectStatus, login, type ApiResult, type Session } from '../../support/api';
import { SEEDED } from '../../support/env';
import { addDays, nextWednesday, sydneyToday } from '../../support/dates';

// PR193 browser acceptance, run against the real candidate API and PostgreSQL in real Chromium.
// The SAME journey runs twice, as two distinctly named cases, over one body: once for a trip that starts
// TODAY in the app's own date semantics (sydneyToday(), the one "today" the server and the browser agree on)
// and once for a trip that starts in the FUTURE. BookingsQuery holds a booking as booked ahead while
// StartDate >= today, so today is a boundary the future case cannot stand in for, and the today case is never
// moved into the future to pass.
// A funded participant's confirmed, priced trip booking stands in their budget ledger as BOOKED
// AHEAD; generating the claim from the real trip Claims UI TAKES THE BOOKING'S PLACE instead of stacking on top
// of it, so the money moves booked ahead -> pending and is counted once; and the Funding tab the user never left
// refreshes on that mutation, in the same app and the same query client, with no reload.
//
// Every rule below is read off the code, not assumed:
//   BudgetLedgerService.BookingsQuery      booked ahead means: booking Confirmed, trip not Cancelled,
//                                          StartDate >= today, and no non-rejected claim line already stands in for
//                                          that booking. So one claim line for the booking retires it completely.
//   BudgetLedgerService.ClaimLineItemOf    a Draft or Ready claim's lines are PENDING; Submitted and later are
//                                          CLAIMED. So the money after generation is pending, not claimed.
//   BudgetLedgerService.AddBookingItems    the booked-ahead amount is TripPriceEstimator's, over the trip's
//                                          TripDay rows; a participant with no NDIS number is shown at $0 with a
//                                          reason, so the seed carries a number.
//   BudgetLedger (domain)                  Used = Claimed + Pending; Forecast = Used + BookedAhead.
//   ClaimGenerationService                 GENERATION requires a Completed trip and refuses a second active claim
//                                          for the trip. The PREVIEW does not check either, which is what makes it
//                                          a safe probe of the claim engine before the trip is completed.
//   claims.ts refreshLedgers               a claim write invalidates ['participant-funding', id, 'ledger'] for the
//                                          participants it names, or for whatever ledger keys this client holds open.
//                                          This is the cache contract under test: the return to Funding must be an
//                                          in-app link click, never a page.goto (a goto would rebuild the app and its
//                                          query client, hiding a broken invalidation).
//
// Guardrails: the session is a real dev-login of a seeded coordinator (no credential is invented here), every row
// created is synthetic test data of this spec, and nothing is mocked -- no route interception, no stubbed response.
// The only network calls the test makes itself are the fixture writes in create*(), which are plain authenticated
// API calls, the same ones the UI would make.

const API_PATH_PREFIX = '/api/v1';

/** Per-run tag, so anything this spec writes under a unique business key (TripCode) never collides with
 *  an earlier run's rows left behind in the shared scratch database. */
const runTag = `${(process.pid % 4096).toString(36).padStart(3, '0')}${Date.now().toString(36).slice(-5)}`;

type LedgerPeriod = {
  limit: number;
  carried: number;
  available: number;
  claimed: number;
  pending: number;
  bookedAhead: number;
  used: number;
  forecast: number;
  isCurrent: boolean;
  rowCount: number;
  rows: { kind: string; group: string; description: string; amount: number; link: string | null }[];
};

type LedgerPeriodTotals = Pick<
  LedgerPeriod,
  'limit' | 'carried' | 'available' | 'claimed' | 'pending' | 'bookedAhead' | 'used' | 'forecast' | 'rowCount'
>;

/** The money the ledger's own `money()` prints for an amount, computed here so the assertions read the server's
 *  figure rather than a string the test invented. */
function money(amount: number): string {
  const cents = Math.round(Math.abs(amount) * 100);
  if (cents === 0) return '$0';
  const whole = cents % 100 === 0;
  const text = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
  return amount < 0 ? `-${text}` : text;
}

/** The seeded tenant's own API, read straight: the ledger for one participant, reduced to the pool's current period.
 *  This is the server's arithmetic, not the browser's rendering of it. */
async function ledgerPeriod(session: Session, participantId: string): Promise<LedgerPeriodTotals> {
  const res: ApiResult = await expectStatus(
    'GET participant ledger',
    200,
    await call(session, 'GET', `/participants/${participantId}/funding/ledger`),
  );
  const pools: { periods: LedgerPeriod[] }[] = res.data?.pools ?? [];
  const period = pools.flatMap(p => p.periods).find(p => p.isCurrent);
  expect(period, 'the funded participant has a current funding period with figures').toBeTruthy();
  const { rows: _rows, ...totals } = period as LedgerPeriod;
  return totals as LedgerPeriodTotals;
}

/** A participant who is active, non-draft (the Warn-mode readiness gate refuses a draft one for a booking) and
 *  carries an NDIS number, without which the booking prices at $0. The address is on the seeded tenant's own
 *  demo.odip.com.au domain so no address confirmation is demanded. */
async function createParticipant(session: Session, name: string): Promise<string> {
  const res: ApiResult = await expectStatus(
    'POST participant',
    201,
    await call(session, 'POST', '/participants', {
      firstName: name,
      lastName: 'LedgerAcceptance',
      dateOfBirth: '1990-05-14',
      email: `${name.toLowerCase()}.ledger@demo.odip.com.au`,
      phone: '0400000000',
      addressStreet: '1 Ledger Street',
      addressSuburb: 'Newtown',
      addressState: 'NSW',
      addressPostcode: '2042',
      ndisNumber: `420${Math.floor(100000000 + Math.random() * 899999999)}`,
      planType: 1, // PlanManaged: an agency-managed plan can hold pools the provider is paid from
      isDraft: false,
    }),
  );
  const id = res.data?.id as string | undefined;
  expect(typeof id === 'string' && id.length > 0, 'the created participant has an id').toBe(true);

  // A create never accepts an activation boolean: the server stamps IsActive = false (ParticipantsController.Create,
  // "never accept an activation boolean from the client"). The real screen then activates the participant through
  // POST /participants/{id}/status, and booking is gated on exactly that (ParticipantReadiness.CheckAsync, Warn mode:
  // IsActive && !IsDraft). Skipping this step makes every booking a 400 "Participant is not ready for booking or
  // rostering.", so the activation is done the way the product does it rather than worked around.
  const activated: ApiResult = await expectStatus('POST participant status', 200, await call(session, 'POST', `/participants/${id}/status`, {
    isActive: true,
    reason: 'E2E browser acceptance: activate so the participant is bookable',
  }));
  expect(activated.data?.isActive, 'the participant is active before it is booked').toBe(true);

  return id as string;
}

/** One Core (flexible) pool (category 0, as FundingPlanValidator demands) with a single funding period that runs
 *  the whole plan, so the periods are contiguous and cover today. */
async function createFundingPlan(session: Session, participantId: string, from: string): Promise<string> {
  const planStart = addDays(from, -30);
  const planEnd = addDays(from, 300);
  const res: ApiResult = await expectStatus(
    'POST funding plan',
    201,
    await call(session, 'POST', `/participants/${participantId}/funding/plans`, {
      planStart,
      planEnd,
      reassessmentDate: addDays(from, 270),
      periodLengthMonths: 3,
      evidence: 0, // PlanCopy
      confirmedOn: from,
      confirmedByName: 'E2E Browser Acceptance',
      pools: [
        {
          kind: 0, // CoreFlexible: categories 01-04 are bought from one pool, so the category stays 0
          paceCategory: 0,
          managementType: 2, // PlanType.AgencyManaged
          periods: [{ periodStart: planStart, periodEnd: planEnd, planAmount: 20000, setAside: 0 }],
        },
      ],
    }),
  );
  return res.data?.id as string;
}

/** A trip whose StartDate is TODAY or in the FUTURE. This is the eligibility gate of the whole spec: the
 *  ledger only holds a booking as booked ahead while StartDate >= today, so a past-dated trip would be a past
 *  booking and never booked-ahead money. TripDay rows are generated because both the ledger's pricing and the
 *  claim engine work a day at a time over them, and an unpriced booking is $0 with a note. */
async function createTripWithConfirmedBooking(
  session: Session,
  participantId: string,
  name: string,
  startDate: string,
  caseDiscriminator: string,
): Promise<{ tripId: string; bookingId: string }> {
  // The code is built, not blindly sliced: a slice(0, 20) would silently cut the date-and-case suffix off the
  // end, and both cases of one run share the run tag -- so the whole code has to fit the column uncut for the
  // two business keys to stay distinct from each other and from an earlier run's leftovers.
  const tripCode = `E2E-${runTag}-${caseDiscriminator}${startDate.slice(5, 7)}${startDate.slice(8, 10)}`;
  expect(
    tripCode.length,
    'the trip code fits varchar(20) whole, so its case-and-date suffix cannot be truncated into a collision',
  ).toBeLessThanOrEqual(20);
  const trip: ApiResult = await expectStatus(
    'POST trip',
    201,
    await call(session, 'POST', '/trips', {
      tripName: name,
      // TripCode is varchar(20) with a unique filtered index (OdipDbContext: HasMaxLength(20) +
      // IsUnique().HasFilter("\"TripCode\" IS NOT NULL")). The run tag keeps a re-run from colliding with
      // an earlier run's leftovers; the case discriminator and date keep this run's two cases apart.
      tripCode,
      destination: 'Newtown',
      region: 'Sydney',
      startDate,
      durationDays: 2,
    }),
  );
  const tripId = trip.data.id as string;

  await expectStatus(
    'POST schedule',
    200,
    await call(session, 'POST', `/trips/${tripId}/schedule/generate`, {}),
  );

  const booking: ApiResult = await expectStatus(
    'POST booking',
    201,
    await call(session, 'POST', '/bookings', {
      tripInstanceId: tripId,
      participantId,
      bookingStatus: 'Confirmed',
    }),
  );

  return { tripId, bookingId: booking.data.id as string };
}

/** Step the real modal to its preview: "+ Generate Claim" then "Preview Claim". The preview is the claim
 *  engine's own answer for this trip: what it would build, from the catalogue, today.
 *
 *  DELIBERATELY no page.goto and no navigation of any kind: this helper runs while the Funding tab's ledger
 *  cache is populated and must stay in that same document. page.goto tears the app and its QueryClient
 *  down, which would replace exactly the state R2 is about. The caller has already arrived on the trip's
 *  Claims tab by real in-app navigation and owns that step. */
async function previewClaim(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '+ Generate Claim' }).click();
  const modal = page.getByRole('dialog', { name: 'Generate NDIS Claim' });
  await expect(modal, 'the generate-claim modal opens').toBeVisible();
  await modal.getByRole('button', { name: 'Preview Claim →' }).click();
  const preview = page.getByRole('dialog', { name: 'Claim Preview' });
  await expect(preview, 'the preview step replaces the input step').toBeVisible();
  return preview;
}

/** The claim engine will not price anything without provider settings ("Provider settings are not
 *  configured", ClaimGenerationService) and prices the trip in the organisation's own state. The scratch
 *  database's seeded provider row is replaced once, by the SuperAdmin, if it is missing -- API setup against
 *  this isolated app only. The claim itself is still generated through the UI. */
async function ensureProviderSettings(session: Session): Promise<void> {
  const sa: Session = await login(SEEDED.superAdmin);
  const current: ApiResult = await expectStatus(
    'GET provider-settings',
    200,
    await call(sa, 'GET', '/provider-settings'),
  );
  if (current.data?.organisationName) return;
  await expectStatus(
    'PUT provider-settings',
    [200, 201],
    await call(sa, 'PUT', '/provider-settings', {
      registrationNumber: 'E2E-0000-01',
      abn: '00000000000',
      organisationName: 'E2E Browser Acceptance (SYNTHETIC)',
      address: '1 Example Street, Newtown NSW 2042',
      state: 'NSW',
      gstRegistered: true,
      isPaceProvider: false,
      bankAccountName: 'E2E Browser Acceptance',
      bsb: '000000',
      accountNumber: '00000000',
      invoiceFooterNotes: 'SYNTHETIC E2E TEST DATA.',
      managerName: 'E2E Manager',
      managerPhone: '0412345678',
    }),
  );
}

/** The Funding tab's ledger region for the pool's current period, addressed by its own aria-label. */
function ledgerRowsRegion(page: Page): Locator {
  return page.getByRole('region', { name: /Ledger rows for/ });
}

/** The journey, over whatever trip start date the case hands it: a priced booking standing as booked-ahead
 *  money, the claim generated through the trip's real Claims modal, and the money moved to pending in the open
 *  tab. Both cases assert identically because the contract under test is identical; the start date is a
 *  parameter rather than a branch, so neither case can quietly grow a weaker copy of the rules. */
async function bookingBecomesPending(
  page: Page,
  session: Session,
  tripStart: string,
  caseDiscriminator: string,
): Promise<void> {
    // The timeout is set per case so the config other specs share stays untouched.
    const today = sydneyToday();
    expect(
      tripStart >= today,
      'the case start date is today or later, which is the booked-ahead gate itself',
    ).toBe(true);

    // ── Seed: a funded participant with a confirmed, priced, still-open booking. ──
    const participantId = await createParticipant(session, `Pr193${Date.now().toString(36).slice(-5)}`);
    await createFundingPlan(session, participantId, today);
    const tripName = `PR193 ledger ${tripStart}`;
    await ensureProviderSettings(session);
    const { tripId } = await createTripWithConfirmedBooking(
      session,
      participantId,
      tripName,
      tripStart,
      caseDiscriminator,
    );
    // GENERATION requires a Completed trip (ClaimGenerationService.GenerateDraftClaimAsync). The InProgress
    // gate demands confirmed STAFF, which this trip has none of; Completed carries no gate, so the trip moves
    // straight from Draft to Completed here, once the confirmed booking exists.
    await expectStatus(
      'PATCH trip Completed',
      200,
      await call(session, 'PATCH', `/trips/${tripId}`, { status: 'Completed' }),
    );

    // ── The server's own arithmetic BEFORE anything happens in the browser. ──
    const before = await ledgerPeriod(session, participantId);
    expect(before.bookedAhead, 'the confirmed future booking stands as booked-ahead money').toBeGreaterThan(0);
    expect(before.used, 'nothing is used before the claim exists').toBe(0);
    expect(before.claimed, 'nothing is claimed before the claim exists').toBe(0);
    expect(before.pending, 'nothing is pending before the claim exists').toBe(0);
    const bookedAheadMoney = money(before.bookedAhead);

    // ── Open the ledger ONCE and leave it open for the rest of the test: this tab is the witness. ──
    await page.goto(`/participants/${participantId}?tab=funding`);
    const rows = ledgerRowsRegion(page);
    // Generous, because this is the one assertion that waits on a COLD ledger endpoint: this stack
    // answers /funding/ledger in 3-4s warm (measured) and its first call after a build is slower still.
    // Only the wait is widened; every ledger-value assertion below keeps the shared expect budget.
    await expect(rows, 'the ledger rows region is rendered').toBeVisible({ timeout: 60_000 });
    await expect(
      rows.getByText('Booked ahead', { exact: true }),
      'the booking is grouped under Booked ahead on screen',
    ).toBeVisible();
    await expect(
      rows.getByText(bookedAheadMoney, { exact: true }),
      'the booking is on screen as booked-ahead money at the server\'s own price',
    ).toBeVisible();
    const glances = page.getByText('Available', { exact: true });
    await expect(
      glances.first().locator('..'),
      'the glance strip is on screen before the claim',
    ).toBeVisible();

    // The lifetime evidence itself: a value stamped on THIS document while the ledger cache was warm.
    // If anything replaced the document or the query client, the stamp would be gone.
    await page.evaluate(() => { (window as unknown as Record<string, string>).__pr193Document = 'alive'; });
    const ledgerRefetches: string[] = [];
    page.on('request', r => {
      if (r.url().includes('/funding/ledger')) ledgerRefetches.push(r.url());
    });

    // ── Leave Funding by an in-app link, in the same app instance and the same query client. A
    //    page.goto here would rebuild the app and its query client, which is exactly what would hide a
    //    broken ledger invalidation. The link used is the ledger's OWN booking row: it is the row under
    //    test, and it already points at the trip that made it -- FundingLedger renders
    //    <Link to={row.link}> and BudgetLedgerService.AddBookingItems gives a booking the link
    //    /trips/{tripId}. That is the shortest real path from the money to the thing that made it, and
    //    the same link asserted GONE at the end, once the claim has taken the row's place.
    const bookingLink = rows.locator(`a[href="/trips/${tripId}"]`).first();
    await expect(
      bookingLink,
      'the booked-ahead row links to the trip that made it, which is how the trip is reached',
    ).toBeVisible();
    await bookingLink.click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}$`));
    await page.getByRole('tab', { name: 'Claims', exact: true }).click();
    const preview = await previewClaim(page);
    await expect(
      preview.getByText('Total Estimate'),
      'the preview shows a total',
    ).toBeVisible();
    await expect(
      preview.getByText('Line Items'),
      'the preview priced line items',
    ).toBeVisible();
    await expect(
      preview.getByText('Participants:'),
      'the preview counts the booked participant',
    ).toBeVisible();
    const previewTotal = (await preview.getByText('Total Estimate').locator('..').innerText()).match(/\$[\d,]+(\.\d{2})?/);
    expect(previewTotal, 'the preview states a money total').toBeTruthy();

    // ── Generate the claim through the real modal. No API shortcut, no stubbed response. ──
    // The request log is counted from HERE, so what is asserted at the end is a ledger request made after the
    // successful write -- never one of the requests that populated the cache in the first place.
    const ledgerRequestsBeforeMutation = ledgerRefetches.length;
    await page.getByRole('button', { name: 'Confirm & Generate' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Claim Preview' }),
      'the modal closes once the claim is generated',
    ).toBeHidden();
    await expect(
      page.getByRole('cell', { name: 'Draft' }),
      'the generated claim is a Draft claim, which the ledger counts as pending',
    ).toBeVisible();
    // Read the claim's own reference off THIS page, while the claim list is the only table showing Draft.
    // It has to be read here: on the Funding tab the ledger's own Pending row also reads Draft, so the same
    // locator would there return the ledger row's description instead of a claim reference.
    const draftReference = (
      await page.getByRole('cell', { name: 'Draft' }).locator('xpath=preceding::td[1]').innerText()
    ).trim();
    expect(
      draftReference,
      'the generated Draft claim shows its own reference in its own Reference column',
    ).toMatch(/^\S+$/);
    const draftClaimHref = await page
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: 'Draft' }) })
      .getByRole('link', { name: 'View' })
      .getAttribute('href');
    expect(draftClaimHref, 'the claim row links to the claim').toMatch(/^\/claims\/[0-9a-f-]{36}$/);

    // The COUNT is deliberately not sampled here: the tab is off Funding at this point, and the ledger
    // request the invalidation causes goes out when the Funding tab mounts again further down. Sampling
    // now would read zero and prove nothing. It is read once, at the assertion, below.

    // ── R3 rejection control, same real UI, nothing mocked: this trip now has an active claim, so a second
    //    generation is refused by the claim engine in its own words and the ledger must be untouched by the
    //    refusal. The modal is reopened through its own affordance first -- the previous one closed when the
    //    claim was generated, and a closed modal is not an interaction target: clicking its hidden buttons
    //    would prove nothing. Preview has no status checks (ClaimGenerationService.PreviewClaimAsync), so it
    //    succeeds; the refusal happens on the write, which is the mutation under test. ──
    await page.getByRole('button', { name: '+ Generate Claim' }).click();
    const second = page.getByRole('dialog', { name: 'Generate NDIS Claim' });
    await expect(second, 'the generate-claim modal reopens').toBeVisible();
    await second.getByRole('button', { name: 'Preview Claim →' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Claim Preview' }),
      'the preview step is reached again for the refused generation',
    ).toBeVisible();
    await page.getByRole('button', { name: 'Confirm & Generate' }).click();
    await expect(
      page.getByText(/An active claim already exists/i),
      'the server refuses a second claim for the same trip',
    ).toBeVisible();
    await expect(
      page.getByRole('dialog', { name: 'Claim Preview' }),
      'the refused generation leaves the modal open on its preview step, holding the error',
    ).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Claim Preview' }),
      'the modal closes on cancel, leaving the trip page as it was',
    ).toBeHidden();

    const afterReject = await ledgerPeriod(session, participantId);
    expect(
      afterReject.pending,
      'a refused second generation leaves the ledger exactly as the first generation left it',
    ).toBeCloseTo(before.bookedAhead, 2);
    expect(afterReject.bookedAhead, 'a refused second generation adds no booked-ahead money').toBe(0);
    expect(afterReject.claimed, 'a refused second generation claims nothing').toBe(0);

    // ── Back to the participant through a REAL in-app navigation: the claim's own row on the trip's bookings
    //    links to the participant (BookingsTab renders <Link to={`/participants/${b.participantId}`}>). No
    //    page.goto here: a goto would tear down the app and its query client, and the invalidation under test
    //    would never be exercised. ──
    await page.getByRole('tab', { name: 'Bookings' }).click();
    const participantLink = page.getByTitle('View participant').first();
    await expect(
      participantLink,
      'the trip page links to the booked participant, which is the way back into the ledger',
    ).toBeVisible();
    await participantLink.click();
    await page.waitForURL(new RegExp(`/participants/${participantId}`));
    await page.getByRole('tab', { name: 'Funding' }).click();
    await expect(rows, 'the Funding tab is back, in the same app instance').toBeVisible();

    // ── The server's own arithmetic after the claim: the claim line TOOK the booking's place. ──
    const after = await ledgerPeriod(session, participantId);
    expect(
      after.bookedAhead,
      'the booking no longer stands as booked ahead: its claim line takes its place',
    ).toBe(0);
    expect(after.claimed, 'a Draft claim is pending, not claimed').toBe(0);
    expect(after.used, 'used = claimed + pending, and claimed is zero here').toBeCloseTo(after.pending, 2);
    expect(
      after.forecast,
      'forecast = used + booked ahead, with nothing booked ahead left',
    ).toBeCloseTo(after.used, 2);
    // The double-count invariant, stated over the money that is actually committed: a claim line REPLACES
    // the booking, so committed money (used + booked ahead) must be identical before and after. Asserting
    // `used` alone would be wrong: used = claimed + pending, so it necessarily RISES as the booking's money
    // moves out of booked-ahead and into pending. What must not change is the total, and that pending now
    // carries exactly the amount bookedAhead carried -- the same money, counted once, on the other side.
    expect(
      after.used + after.bookedAhead,
      'committed money is unchanged: the claim line took the booking\'s place rather than adding to it',
    ).toBeCloseTo(before.used + before.bookedAhead, 2);
    expect(
      after.pending,
      'the same money is now pending, at the booking\'s own price, counted once',
    ).toBeCloseTo(before.bookedAhead, 2);
    expect(
      after.available - after.forecast,
      'what is left to spend is unchanged by the swap of booked-ahead for pending',
    ).toBeCloseTo(before.available - before.forecast, 2);

    // ── The cache contract: this Funding tab was opened BEFORE the mutation and was never reloaded, yet it
    //    shows the money after the claim. That is only possible if the claim write invalidated this
    //    participant's ledger key in this query client (claims.ts refreshLedgers). ──
    await expect(
      rows.getByText('Pending', { exact: true }),
      'the ledger now groups the money as Pending, which only a refetch can do',
    ).toBeVisible();
    // The three group headings always render, so an empty group is proved by what is inside it, not by its
    // absence (FundingLedger.Group renders the heading plus its note and "Nothing here this period." when the
    // group has no rows). So: the booked-ahead GROUP is empty, and the pending group holds the claim rows.
    const bookedAheadGroup = rows.getByRole('heading', { name: 'Booked ahead', exact: true }).locator('..');
    await expect(
      bookedAheadGroup.getByText('Nothing here this period.'),
      'no booked-ahead row survives the claim in the open tab',
    ).toBeVisible();
    await expect(
      rows.getByRole('heading', { name: 'Pending', exact: true }).locator('..').getByRole('link').first(),
      'the pending group holds the claim rows that replaced the booking',
    ).toBeVisible();
    await expect(
      rows.getByText(money(after.pending), { exact: true }),
      'the pending figure on screen is the server\'s own pending total',
    ).toBeVisible();
    // The very same money now sits under Pending -- that is the replacement, not a leftover -- so the
    // amount must be gone from the BOOKED-AHEAD group specifically, and present under Pending.
    await expect(
      rows.getByRole('heading', { name: 'Booked ahead', exact: true }).locator('..').getByText(bookedAheadMoney, { exact: true }),
      'the booked-ahead amount is gone from the booked-ahead group it used to sit in',
    ).toHaveCount(0);
    await expect(
      rows.getByRole('heading', { name: 'Pending', exact: true }).locator('..').getByText(bookedAheadMoney, { exact: true }).first(),
      'that same amount is now a pending claim line',
    ).toBeVisible();

    // ── The claim reference is what the ledger row now links to: the money is attributed to the
    //    claim, not to the booking. The row description is built by the server as
    //    "{claimReference} · {itemCode} · {hours} h" (BudgetLedgerService.ClaimLineItemOf), so the
    //    reference is read off the claim list the same page already rendered and matched literally.
    await expect(
      rows.getByText(new RegExp(`^${draftReference} ·`)),
      'the ledger row now carries the claim reference, not the booking description',
    ).toBeVisible();
    await expect(
      rows.locator(`a[href="${draftClaimHref}"]`),
      'the pending row links to the very claim that replaced the booking',
    ).toHaveCount(1);
    await expect(
      rows.locator(`a[href="/trips/${tripId}"]`),
      'no ledger row still points at the trip booking it replaced',
    ).toHaveCount(0);

    // ── The lifetime evidence, each part stated no more strongly than what it actually proves. The window
    //    sentinel proves the DOCUMENT survived: nothing tore the app down and rebuilt it. It says nothing about
    //    object identity of the query client, which lives module-scoped at frontend/src/App.tsx:68 and is not
    //    reachable from the page. The request count proves a real /funding/ledger request went out over the wire
    //    after the successful claim write; it does not, on its own, identify WHICH invalidation call caused it,
    //    because returning to the Funding tab mounts the ledger again. ──
    expect(
      await page.evaluate(() => (window as unknown as Record<string, string>).__pr193Document),
      'the whole journey ran in ONE document: nothing reloaded the page between cache population and here',
    ).toBe('alive');
    expect(
      ledgerRefetches.length,
      'a real ledger request went out AFTER the successful claim write, over the wire, in that same document',
    ).toBeGreaterThan(ledgerRequestsBeforeMutation);
}

test.describe('PR193 budget ledger: a generated claim takes the booking\'s place, in an open tab', () => {
  test('a trip starting TODAY: booked ahead becomes pending after the trip Claims UI generates the claim', async ({
    page,
    session,
  }) => {
    // The shared 45s budget fits one UI action; this journey seeds real data and walks three real SPA
    // navigations plus two real generations. Raised here so the config other specs share is untouched.
    test.setTimeout(240_000);

    // Sydney's today, in the app's own date semantics: the boundary of BookingsQuery's StartDate >= today.
    await bookingBecomesPending(page, session, sydneyToday(), 'T');
  });

  test('a trip starting in the FUTURE: booked ahead becomes pending after the trip Claims UI generates the claim', async ({
    page,
    session,
  }) => {
    test.setTimeout(240_000);

    await bookingBecomesPending(page, session, nextWednesday(sydneyToday()), 'F');
  });
});