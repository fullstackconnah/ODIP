using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// A trip that has started and has no claim yet (the 2026-10-08 review, L5-01). The trip claim engine refuses to build a claim until the trip is Completed, so for every trip there is a window,
/// from the day after it starts to the day a coordinator generates its claim, in which the booking is neither booked ahead (that is "from today on") nor a claim line. It used to be counted
/// nowhere; it is pending now, flagged, priced by the same estimator, and a claim line that takes its place (the #194 "counted line" rule) still removes it, so nothing is counted twice.
/// The fixed clock is Sunday 4 Oct 2026 (the provider's today). Prices: the organisation is in NSW, so community access is $60 an hour on a weekday, $84 on a Saturday and $108 on a Sunday.
/// </summary>
public class BudgetLedgerStartedTripTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static (LedgerKit Kit, Participant Person) Arrange()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 50000m), Q(2, 50000m), Q(3, 50000m), Q(4, 50000m)));
        return (kit, person);
    }

    /// <summary>03:00 UTC on the date: the provider's calendar date is the same one (Sydney is ten or eleven hours ahead).</summary>
    private static DateTimeOffset At(int year, int month, int day) => new(year, month, day, 3, 0, 0, TimeSpan.Zero);

    private static async Task<PeriodLedger> Q2Of(LedgerKit kit, Participant person)
    {
        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct);
        return all[person.Id].Ledger!.Pools[0].Periods[1];   // 1 Oct to 31 Dec 2026
    }

    private static (TripInstance Trip, ParticipantBooking Booking) Booked(LedgerKit kit, Participant person, DateOnly start, int days, TripStatus status = TripStatus.Completed, string name = "Coastal weekend")
    {
        var trip = kit.SeedTrip(start, days, status, name);
        return (trip, kit.SeedBooking(trip, person));
    }

    // ── The same trip, day by day ───────────────────────────────────────────

    [Fact]
    public async Task OneTripHasTheSameForecastTheDayBeforeItStartsOnItsFirstDayAndTwoDaysIn_BookedAheadBecomingPending()
    {
        var (kit, person) = Arrange();
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 6), 3, TripStatus.Confirmed);   // Tue 6 to Thu 8 Oct: three weekdays x 8 h x $60
        kit.SeedBooking(trip, person);

        kit.Clock.Set(At(2026, 10, 5));
        var dayBefore = await Q2Of(kit, person);
        kit.Clock.Set(At(2026, 10, 6));
        var firstDay = await Q2Of(kit, person);
        trip.Status = TripStatus.InProgress;
        kit.Db.SaveChanges();
        kit.Clock.Set(At(2026, 10, 8));
        var twoDaysIn = await Q2Of(kit, person);

        Assert.Equal((1440m, 0m, 1440m), (dayBefore.BookedAhead, dayBefore.Pending, dayBefore.Forecast));
        Assert.Equal((1440m, 0m, 1440m), (firstDay.BookedAhead, firstDay.Pending, firstDay.Forecast));      // the start day is still "from today on"
        Assert.Equal((0m, 1440m, 1440m), (twoDaysIn.BookedAhead, twoDaysIn.Pending, twoDaysIn.Forecast));   // the forecast does not drop: the money moved from booked ahead to pending
        Assert.Equal(1440m, twoDaysIn.Used);
        Assert.Equal(0, dayBefore.StartedUnclaimedTripCount);
        Assert.Equal(0, firstDay.StartedUnclaimedTripCount);
        Assert.Equal(1, twoDaysIn.StartedUnclaimedTripCount);
    }

    // ── What it is ──────────────────────────────────────────────────────────

    [Fact]
    public async Task ARunningTripAndACompletedOneWithNoClaimArePendingAndFlagged_AtWhatTheTripEstimatorSays()
    {
        var (kit, person) = Arrange();
        Booked(kit, person, new DateOnly(2026, 10, 2), 3, TripStatus.InProgress, "Running");   // Fri 2, Sat 3, Sun 4: $480 + $672 + $864
        Booked(kit, person, new DateOnly(2026, 10, 1), 2, TripStatus.Completed, "Finished");   // Thu 1, Fri 2: $960

        var q2 = await Q2Of(kit, person);

        Assert.Equal(480m + 672m + 864m + 960m, q2.Pending);
        Assert.Equal(0m, q2.BookedAhead);
        Assert.Equal(0m, q2.Claimed);
        Assert.Equal(2, q2.StartedUnclaimedTripCount);
        Assert.Equal(2, q2.Items.Count);
        Assert.All(q2.Items, item =>
        {
            Assert.Equal(LedgerRowKind.TripBooking, item.Kind);   // still a trip booking, so a claim preview takes it out as it takes a booked-ahead one
            Assert.Equal(LedgerGroup.Pending, item.Group);
            Assert.Contains("has started and has no claim yet", item.Note);
        });
    }

    [Fact]
    public async Task AStartedTripThatIsPartlyPricedKeepsItsGapNoteBesideTheStartedNote()
    {
        var (kit, person) = Arrange();
        Booked(kit, person, new DateOnly(2026, 9, 25), 3);   // Fri 25, Sat 26, Sun 27 Sep: in the plan's first quarter, finished and not claimed
        kit.Db.SupportCatalogueItems.RemoveRange(kit.Db.SupportCatalogueItems.Where(i => i.DayType == ClaimDayType.Sunday).ToList());
        kit.Db.SaveChanges();

        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct);
        var q1 = all[person.Id].Ledger!.Pools[0].Periods[0];

        var item = Assert.Single(q1.Items);
        Assert.Equal(480m + 672m, item.Amount);                            // the Sunday has no rate: never invented
        Assert.Equal(LedgerGroup.Pending, item.Group);
        Assert.Contains("has started and has no claim yet", item.Note);
        Assert.Contains("No catalogue rate covers Sunday 27 Sep 2026", item.Note);
        Assert.Equal(1, item.UnpricedTripDayCount);
    }

    [Fact]
    public async Task AStartedTripBeforeThePlanStartedIsTheEarlierPlansAndIsNotCounted()
    {
        var (kit, person) = Arrange();
        Booked(kit, person, new DateOnly(2026, 6, 20), 3);   // the plan starts on 1 Jul 2026

        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct);

        Assert.Empty(all[person.Id].Items);
        Assert.Equal(0m, all[person.Id].Ledger!.Pools[0].Total.Pending);
    }

    // ── A claim takes the trip's place, once ────────────────────────────────

    [Fact]
    public async Task TheRealGeneratorsDraftClaimTakesTheStartedTripsPlace_CountedOnceAtTheLinesTotal()
    {
        var (kit, person) = Arrange();
        var (trip, _) = Booked(kit, person, new DateOnly(2026, 10, 1), 3);   // Thu 1, Fri 2, Sat 3: $480 + $480 + $672
        var estimate = await Q2Of(kit, person);
        Assert.Equal(1632m, estimate.Pending);

        var claim = await new ClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant).GenerateDraftClaimAsync(trip.Id, null, Ct);
        var after = await Q2Of(kit, person);

        Assert.Equal(1632m, claim.TotalAmount);
        Assert.Equal(claim.TotalAmount, after.Pending);                      // the lines replace the estimate: not both
        Assert.Equal(0m, after.BookedAhead);
        Assert.All(after.Items, item => Assert.Equal(LedgerRowKind.ClaimLine, item.Kind));
        Assert.Equal(0, after.StartedUnclaimedTripCount);
    }

    [Fact]
    public async Task EachWayAClaimCanStopCountingGoesBackToTheEstimate_AndASubmittedClaimIsClaimedOnly()
    {
        var (kit, person) = Arrange();
        var day = new DateOnly(2026, 10, 1);   // a Thursday: a one-day trip is $480 whichever it is
        var (rejectedTrip, rejectedBooking) = Booked(kit, person, day, 1, name: "Rejected claim");
        kit.SeedTripClaim(rejectedTrip, rejectedBooking, TripClaimStatus.Rejected, 480m, day);
        var (cancelledTrip, cancelledBooking) = Booked(kit, person, day, 1, name: "Cancelled claim");
        kit.SeedTripClaim(cancelledTrip, cancelledBooking, TripClaimStatus.Cancelled, 480m, day);
        var (lineTrip, lineBooking) = Booked(kit, person, day, 1, name: "Rejected line");
        var (_, rejectedLine) = kit.SeedTripClaim(lineTrip, lineBooking, TripClaimStatus.Draft, 480m, day);
        rejectedLine.Status = ClaimLineItemStatus.Rejected;
        var (deletedTrip, deletedBooking) = Booked(kit, person, day, 1, name: "Deleted claim");
        var (deletedClaim, deletedLine) = kit.SeedTripClaim(deletedTrip, deletedBooking, TripClaimStatus.Draft, 480m, day);
        kit.Db.ClaimLineItems.Remove(deletedLine);
        kit.Db.TripClaims.Remove(deletedClaim);
        var (submittedTrip, submittedBooking) = Booked(kit, person, day, 1, name: "Submitted claim");
        kit.SeedTripClaim(submittedTrip, submittedBooking, TripClaimStatus.Submitted, 700m, day);
        var (draftTrip, draftBooking) = Booked(kit, person, day, 1, name: "Draft claim");
        kit.SeedTripClaim(draftTrip, draftBooking, TripClaimStatus.Draft, 300m, day);
        kit.Db.SaveChanges();

        var q2 = await Q2Of(kit, person);

        Assert.Equal(4 * 480m + 300m, q2.Pending);   // the four that stopped counting are estimates again; the draft is its line
        Assert.Equal(700m, q2.Claimed);              // submitted: its line only, the estimate is gone
        Assert.Equal(4, q2.StartedUnclaimedTripCount);
        Assert.Equal(4, q2.Items.Count(i => i.Kind == LedgerRowKind.TripBooking));
        Assert.Equal(2, q2.Items.Count(i => i.Kind == LedgerRowKind.ClaimLine));
    }

    [Fact]
    public async Task ACancelledTripAndACancelledBookingAddNothing()
    {
        var (kit, person) = Arrange();
        Booked(kit, person, new DateOnly(2026, 10, 1), 3, TripStatus.Cancelled);                         // started, then cancelled
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 2), 3, TripStatus.Completed);
        kit.SeedBooking(trip, person, BookingStatus.Cancelled);                                          // the booking, not the trip, was cancelled

        var q2 = await Q2Of(kit, person);

        Assert.Empty(q2.Items);
        Assert.Equal(0m, q2.Forecast);
        Assert.Equal(0, q2.StartedUnclaimedTripCount);
    }

    // ── The claim preview, and the page of rows ─────────────────────────────

    [Fact]
    public async Task APreviewOfAStartedTripsClaimTakesItsEstimateOut_SoUsedAfterIsUsedBeforePlusTheClaim()
    {
        var (kit, person) = Arrange();
        Booked(kit, person, new DateOnly(2026, 10, 1), 1, name: "Another trip");                        // $480, pending either way
        var (trip, booking) = Booked(kit, person, new DateOnly(2026, 10, 1), 3);                         // $1,632, the trip being claimed

        var effect = await kit.Ledger.EffectOfLinesAsync(
            kit.TenantId, new[] { new ClaimEffectLine(person.Id, trip.StartDate, 4, PlanType.PlanManaged, 1632m, null, booking.Id) }, Ct);

        var row = Assert.Single(Assert.Single(effect!.Participants).Rows);
        Assert.Equal(480m, row.UsedBefore);                      // only the other trip: the one being claimed was taken out
        Assert.Equal(1632m, row.ThisClaim);
        Assert.Equal(480m + 1632m, row.UsedAfter);
        Assert.Equal(row.ThisClaim, row.UsedAfter - row.UsedBefore);
    }

    [Fact]
    public async Task TheRowsEndpointHandsOutTheSameRowsTheLedgerDoes_StartedTripsIncluded()
    {
        var (kit, person) = Arrange();
        Booked(kit, person, new DateOnly(2026, 10, 1), 2, name: "Finished");                            // started and unclaimed
        Booked(kit, person, new DateOnly(2026, 10, 20), 3, TripStatus.Confirmed, "Coming up");           // booked ahead
        kit.SeedShift(person, new DateOnly(2026, 10, 12), ShiftStatus.Published);

        var ledger = await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, Ct);
        var pool = ledger!.Pools[0];
        var period = pool.Periods[1];
        var page = await kit.Ledger.GetRowsAsync(kit.TenantId, person.Id, pool.Id, period.Id, 0, 200, Ct);

        Assert.Equal(3, period.RowCount);
        Assert.Equal(3, page!.Total);
        Assert.Equal(
            period.Rows.Select(r => (r.Id, r.Kind, r.Group, r.Date, r.Amount, r.Note)),
            page.Rows.Select(r => (r.Id, r.Kind, r.Group, r.Date, r.Amount, r.Note)));
        Assert.Equal(1, period.StartedUnclaimedTripCount);       // the wire carries the flag on the period and on the pool
        Assert.Equal(1, pool.StartedUnclaimedTripCount);
    }
}
