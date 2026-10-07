using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// A booking stops being "booked ahead" once a claim's line has taken it. <c>ClaimGenerationService</c>'s own comment says the booking's lines take the booking's place "so nothing is counted twice", and the
/// claim PREVIEW honours that (<c>EffectOfLinesAsync</c> takes replaced bookings out before it adds the lines). The persisted read did not: <c>BookingsQuery</c> kept every confirmed booking of a
/// trip starting today or later, so the same dollars landed in Pending (the claim line) and in BookedAhead (the booking) at once. These are the mirror image of
/// <see cref="BudgetLedgerServiceTests.AShiftThatAClaimLineHasTakenIsNotAlsoCountedAsPending"/>.
///
/// Scope, deliberately: only a claim line that actually reaches a booking moves it, and only in the states the claim-lines query counts (the claim is not Rejected or Cancelled and the line is not
/// Rejected). Carryover, rejected shifts and residual-budget rules are out of scope and unchanged.
/// </summary>
public class BudgetLedgerClaimReplacesBookingTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static LedgerPeriodDto CurrentPeriod(ParticipantLedgerDto dto) => dto.Pools.Single().Periods.Single(p => p.IsCurrent);

    private static async Task<LedgerPeriodDto> PeriodOf(LedgerKit kit, Participant person) =>
        CurrentPeriod((await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, Ct))!);

    private static (LedgerKit Kit, Participant Person, TripInstance Trip, ParticipantBooking Booking) ArrangeTripStarting(DateOnly start)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 2000m), Q(2, 2000m), Q(3, 2000m), Q(4, 2000m)));
        var trip = kit.SeedTrip(start, 1, TripStatus.Completed, $"{start:yyyy-MM-dd} trip", activeHours: 8m);
        var booking = kit.SeedBooking(trip, person, BookingStatus.Confirmed);
        return (kit, person, trip, booking);
    }

    /// <summary>A trip claim carrying one line for the booking, in the states given: <paramref name="claimStatus"/> on the claim, <paramref name="lineStatus"/> on the line.</summary>
    private static TripClaim ClaimOver(LedgerKit kit, ParticipantBooking booking, TripClaimStatus claimStatus, ClaimLineItemStatus lineStatus, decimal amount = 480m, DateOnly? from = null)
    {
        var trip = kit.Db.TripInstances.First(t => t.Id == booking.TripInstanceId);
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = trip.Id, Status = claimStatus, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = amount };
        var day = kit.Db.TripDays.First(d => d.TripInstanceId == trip.Id);
        kit.Db.TripClaims.Add(claim);
        kit.Db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id,
            SupportItemCode = kit.Item(ClaimDayType.Weekday).ItemNumber, DayType = ClaimDayType.Weekday,
            SupportsDeliveredFrom = from ?? day.Date, SupportsDeliveredTo = from ?? day.Date, Hours = 8m, UnitPrice = amount / 8m, TotalAmount = amount, Status = lineStatus,
        });
        kit.Db.SaveChanges();
        return claim;
    }

    // ── The bug itself: the real generator, today's completed trip ──────────

    [Fact(DisplayName = "PR193: a generated claim for a trip starting today is counted once, not also as booked ahead")]
    public async Task GeneratedClaimForTripStartingToday_IsNotAlsoBookedAhead()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 2000m), Q(2, 2000m), Q(3, 2000m), Q(4, 2000m)));
        var trip = kit.SeedTrip(Today, 1, TripStatus.Completed, "Today trip", activeHours: 8m);
        var booking = kit.SeedBooking(trip, person, BookingStatus.Confirmed);

        var generation = new ClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);

        // BEFORE: the undelivered booking is "booked ahead", and nothing is pending.
        var before = await PeriodOf(kit, person);
        var bookingDollars = before.BookedAhead;

        // PREVIEW: the engine's own words -- the booking is replaced by the claim's lines, so nothing is counted twice.
        var preview = await generation.PreviewClaimAsync(trip.Id, null, Ct);
        var claimDollars = preview.LineItems.Single().TotalAmount;
        var previewAfter = preview.Budget!.Participants.Single().Rows.Single();

        // GENERATE: the real service, real persistence.
        var claim = await generation.GenerateDraftClaimAsync(trip.Id, null, Ct);
        Assert.Equal(TripClaimStatus.Draft, claim.Status);
        Assert.Equal(booking.Id, kit.Db.ClaimLineItems.Single(l => l.TripClaimId == claim.Id).ParticipantBookingId);

        // AFTER: the persisted ledger read.
        var after = await PeriodOf(kit, person);

        // What the claim's own budget block says its "used after" is (ForClaimAsync, the claim detail page).
        var forClaim = (await kit.Ledger.ForClaimAsync(kit.TenantId, claim.Id, Ct))!.Participants.Single().Rows.Single();

        Console.WriteLine(
            $"PR193-LEDGER bookingDollars={bookingDollars} claimDollars={claimDollars} usedBefore={before.Used} usedAfter={after.Used} " +
            $"pendingAfter={after.Pending} bookedAheadAfter={after.BookedAhead} forecastAfter={after.Forecast} " +
            $"previewUsedAfter={previewAfter.UsedAfter} forClaimUsedAfter={forClaim.UsedAfter} today={Today}");

        // EXPECTED (correct behaviour, what this test asserts): the booking's dollars are counted exactly once, as the claim's
        // pending line. Nothing of it is still "booked ahead".
        Assert.True(bookingDollars > 0m, "the fixture must put the booking somewhere before the claim exists");
        Assert.Equal(claimDollars, after.Pending);
        Assert.Equal(0m, after.BookedAhead);
        Assert.Equal(claimDollars, after.Used);
        Assert.Equal(after.Used, forClaim.UsedAfter);
        Assert.Equal(after.Used, previewAfter.UsedAfter);
    }

    /// <summary>Preview and persisted read must agree: the same dollars, the same "used after", whichever route the number came by.</summary>
    [Fact]
    public async Task PreviewAndPersistedLedger_AgreeOnWhatAClaimDoes()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 2000m), Q(2, 2000m), Q(3, 2000m), Q(4, 2000m)));
        var trip = kit.SeedTrip(Today, 1, TripStatus.Completed, "Today trip", activeHours: 8m);
        var booking = kit.SeedBooking(trip, person, BookingStatus.Confirmed);
        var generation = new ClaimGenerationService(kit.Db, kit.Ledger, kit.Tenant);

        var preview = await generation.PreviewClaimAsync(trip.Id, null, Ct);
        var claim = await generation.GenerateDraftClaimAsync(trip.Id, null, Ct);
        var persisted = await PeriodOf(kit, person);
        var forClaim = (await kit.Ledger.ForClaimAsync(kit.TenantId, claim.Id, Ct))!.Participants.Single().Rows.Single();

        Assert.Equal(preview.LineItems.Sum(l => l.TotalAmount), persisted.Pending);
        Assert.Equal(persisted.Pending, forClaim.UsedAfter - forClaim.UsedBefore);
        Assert.Equal(0m, persisted.BookedAhead);
    }

    // ── Which claim and line states move a booking ──────────────────────────

    [Theory]
    [InlineData(TripClaimStatus.Draft, ClaimLineItemStatus.Draft, true)]
    [InlineData(TripClaimStatus.Ready, ClaimLineItemStatus.Draft, true)]
    [InlineData(TripClaimStatus.Submitted, ClaimLineItemStatus.Submitted, true)]
    [InlineData(TripClaimStatus.Approved, ClaimLineItemStatus.Approved, true)]
    [InlineData(TripClaimStatus.Paid, ClaimLineItemStatus.Paid, true)]
    [InlineData(TripClaimStatus.PartiallyPaid, ClaimLineItemStatus.PartiallyPaid, true)]
    // The claim itself is out of the ledger (ClaimLinesQuery drops it), so the booking is still ahead of money.
    [InlineData(TripClaimStatus.Rejected, ClaimLineItemStatus.Approved, false)]
    [InlineData(TripClaimStatus.Cancelled, ClaimLineItemStatus.Approved, false)]
    // So is a rejected line, whatever its claim says.
    [InlineData(TripClaimStatus.Approved, ClaimLineItemStatus.Rejected, false)]
    public async Task ABookingIsReplacedOnlyByAClaimLineThatTheLedgerActuallyCounts(TripClaimStatus claimStatus, ClaimLineItemStatus lineStatus, bool replaced)
    {
        var (kit, person, _, booking) = ArrangeTripStarting(Today);
        using (kit)
        {
            var before = await PeriodOf(kit, person);
            Assert.True(before.BookedAhead > 0m, "the fixture must put the booking somewhere before the claim exists");
            var estimate = before.BookedAhead;

            ClaimOver(kit, booking, claimStatus, lineStatus, amount: estimate);
            var after = await PeriodOf(kit, person);

            if (replaced)
            {
                Assert.Equal(0m, after.BookedAhead);
                // The line is counted, in the claim's own bucket (draft/ready are pending, the rest claimed), for exactly the booking's estimate.
                Assert.Equal(estimate, after.Pending + after.Claimed);
                Assert.Equal(estimate, after.Used);
                Assert.DoesNotContain(after.Rows, r => r.Id == booking.Id);
            }
            else
            {
                Assert.Equal(estimate, after.BookedAhead);
                Assert.Equal(0m, after.Pending);
                Assert.Equal(0m, after.Used);
                Assert.Contains(after.Rows, r => r.Id == booking.Id);
            }
        }
    }

    // ── Boundaries: yesterday, today, tomorrow ─────────────────────────────

    [Fact]
    public async Task ABookingWhoseTripStartedYesterdayWasNeverBookedAhead_AndIsUnaffected()
    {
        var (kit, person, _, booking) = ArrangeTripStarting(Today.AddDays(-1));
        using (kit)
        {
            var before = await PeriodOf(kit, person);
            Assert.Equal(0m, before.BookedAhead);
            Assert.Equal(0m, before.Pending);

            ClaimOver(kit, booking, TripClaimStatus.Draft, ClaimLineItemStatus.Draft, amount: 480m);
            var after = await PeriodOf(kit, person);

            Assert.Equal(0m, after.BookedAhead);
            Assert.Equal(480m, after.Pending);
        }
    }

    [Fact]
    public async Task ABookingWhoseTripStartsTomorrowIsStillBookedAhead_AndStopsBeingOnceClaimed()
    {
        var (kit, person, _, booking) = ArrangeTripStarting(Today.AddDays(1));
        using (kit)
        {
            Assert.Equal(480m, (await PeriodOf(kit, person)).BookedAhead);

            ClaimOver(kit, booking, TripClaimStatus.Draft, ClaimLineItemStatus.Draft);
            var after = await PeriodOf(kit, person);

            Assert.Equal(0m, after.BookedAhead);
            Assert.Equal(480m, after.Pending);
        }
    }

    /// <summary>The boundary the bug turned on: the booking stops being booked ahead the moment the trip's start date is today, not the day before.</summary>
    [Fact]
    public async Task TheReplacementTurnsOnTheTripStartDateReachingToday_NotOneDayLater()
    {
        var (kit, person, _, booking) = ArrangeTripStarting(Today);
        using (kit)
        {
            ClaimOver(kit, booking, TripClaimStatus.Draft, ClaimLineItemStatus.Draft);
            var after = await PeriodOf(kit, person);

            Assert.Equal(0m, after.BookedAhead);
            Assert.Equal(480m, after.Pending);
            Assert.Equal(480m, after.Used);
        }
    }

    // ── Several bookings: partial and mixed lines ──────────────────────────

    [Fact]
    public async Task AClaimLineOverOneBookingLeavesTheOtherBookingsAhead()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 2000m), Q(2, 2000m), Q(3, 2000m), Q(4, 2000m)));

        var tripA = kit.SeedTrip(Today, 1, TripStatus.Completed, "Trip A", activeHours: 8m);
        var bookingA = kit.SeedBooking(tripA, person, BookingStatus.Confirmed);
        var tripB = kit.SeedTrip(Today, 1, TripStatus.Completed, "Trip B", activeHours: 8m);
        var bookingB = kit.SeedBooking(tripB, person, BookingStatus.Confirmed);

        // What one booking is worth here, read from the engine itself rather than assumed.
        var singleBookingAhead = (await PeriodOf(kit, person)).BookedAhead / 2m;

        // The claim covers one booking and its line is rejected: a partial, mixed claim.
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = tripA.Id, Status = TripClaimStatus.Submitted, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 480m };
        kit.Db.TripClaims.Add(claim);
        kit.Db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = bookingA.Id, SupportItemCode = kit.Item(ClaimDayType.Weekday).ItemNumber,
            DayType = ClaimDayType.Weekday, SupportsDeliveredFrom = Today, SupportsDeliveredTo = Today, Hours = 8m, UnitPrice = 60m, TotalAmount = 480m,
            Status = ClaimLineItemStatus.Rejected,
        });
        kit.Db.SaveChanges();

        var period = await PeriodOf(kit, person);

        // A's line is rejected, so A's booking is still ahead; B was never claimed, so B's booking is too.
        Assert.Equal(period.BookedAhead, 2 * singleBookingAhead);
        Assert.Equal(0m, period.Pending);
        Assert.Equal(0m, period.Claimed);
        Assert.Contains(period.Rows, r => r.Id == bookingA.Id);
        Assert.Contains(period.Rows, r => r.Id == bookingB.Id);
    }

    [Fact]
    public async Task AClaimWithOneCountedLineAndOneRejectedLineReplacesOnlyTheFirstBooking()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 2000m), Q(2, 2000m), Q(3, 2000m), Q(4, 2000m)));

        var tripA = kit.SeedTrip(Today, 1, TripStatus.Completed, "Trip A", activeHours: 8m);
        var bookingA = kit.SeedBooking(tripA, person, BookingStatus.Confirmed);
        var tripB = kit.SeedTrip(Today, 1, TripStatus.Completed, "Trip B", activeHours: 8m);
        var bookingB = kit.SeedBooking(tripB, person, BookingStatus.Confirmed);

        var singleBookingAhead = (await PeriodOf(kit, person)).BookedAhead / 2m;

        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Trip, TripInstanceId = tripA.Id, Status = TripClaimStatus.Submitted, ClaimReference = $"TC-{Guid.NewGuid():N}"[..20], TotalAmount = 960m };
        kit.Db.TripClaims.Add(claim);
        foreach (var (booking, status) in new[] { (bookingA, ClaimLineItemStatus.Submitted), (bookingB, ClaimLineItemStatus.Rejected) })
        {
            kit.Db.ClaimLineItems.Add(new ClaimLineItem
            {
                Id = Guid.NewGuid(), TripClaimId = claim.Id, ParticipantBookingId = booking.Id, SupportItemCode = kit.Item(ClaimDayType.Weekday).ItemNumber,
                DayType = ClaimDayType.Weekday, SupportsDeliveredFrom = Today, SupportsDeliveredTo = Today, Hours = 8m, UnitPrice = 60m, TotalAmount = 480m, Status = status,
            });
        }
        kit.Db.SaveChanges();

        var period = await PeriodOf(kit, person);

        Assert.Equal(singleBookingAhead, period.BookedAhead);   // B only
        Assert.Equal(0m, period.Pending);                       // Submitted is claimed, not pending
        Assert.Equal(480m, period.Claimed);                     // A's counted line only
        Assert.Equal(period.Pending + period.Claimed, period.Used);   // "used" is money already on a claim; booked-ahead is not used
        Assert.Contains(period.Rows, r => r.Id == bookingB.Id);
        Assert.DoesNotContain(period.Rows, r => r.Id == bookingA.Id);
        Assert.Contains(period.Rows, r => r.Id == bookingB.Id);
    }

    // ── Nothing else moves ────────────────────────────────────────────────

    [Fact]
    public async Task AnotherParticipantsClaimDoesNotTouchThisBooking()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        var other = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 2000m), Q(2, 2000m), Q(3, 2000m), Q(4, 2000m)));
        kit.SeedPlan(other, Core(PlanType.PlanManaged, Q(1, 2000m), Q(2, 2000m), Q(3, 2000m), Q(4, 2000m)));

        var tripA = kit.SeedTrip(Today, 1, TripStatus.Completed, "Trip A", activeHours: 8m);
        var bookingA = kit.SeedBooking(tripA, person, BookingStatus.Confirmed);
        var tripB = kit.SeedTrip(Today, 1, TripStatus.Completed, "Trip B", activeHours: 8m);
        var bookingB = kit.SeedBooking(tripB, other, BookingStatus.Confirmed);

        // This participant's own booking only (the other booking belongs to `other`).
        var mine = (await PeriodOf(kit, person)).BookedAhead;
        Assert.True(mine > 0m, "the fixture must put this booking somewhere before the other participant's claim exists");
        ClaimOver(kit, bookingB, TripClaimStatus.Approved, ClaimLineItemStatus.Approved);

        var period = await PeriodOf(kit, person);

        Assert.Equal(mine, period.BookedAhead);   // this booking is untouched by the other participant's claim
        Assert.Equal(0m, period.Pending);
        Assert.Equal(0m, period.Claimed);
        Assert.Equal(0m, period.Used);                                 // booked ahead, not used
    }

    [Fact]
    public async Task AClaimLineDatedInAnotherPeriodReplacesTheBookingButCountsWhereItsOwnDateIs()
    {
        var (kit, person, _, booking) = ArrangeTripStarting(Today);
        using (kit)
        {
            // The claim line counts in Q3 (Oct starts Q2 here; go to the next quarter) but it still takes the booking.
            var nextQuarter = D(2027, 1, 1);
            ClaimOver(kit, booking, TripClaimStatus.Draft, ClaimLineItemStatus.Draft, amount: 480m, from: nextQuarter);

            var dto = (await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, Ct))!;
            var current = dto.Pools.Single().Periods.Single(p => p.IsCurrent);
            var later = dto.Pools.Single().Periods.Single(p => p.PeriodStart == nextQuarter);

            Assert.Equal(0m, current.BookedAhead);              // the booking is gone, wherever the line lands
            Assert.Equal(0m, current.Pending);
            Assert.Equal(480m, later.Pending);                  // counted by the line's own service date
        }
    }
}