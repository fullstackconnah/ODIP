using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The budget ledger over a database (EF InMemory, the funding tests' fixed clock: Sunday 4 Oct 2026, the provider's today in Sydney): which records count and in which group, how the
/// shifts and trips that are not claimed yet are priced, which pool and period each lands in, the provider's today, tenancy, and how many queries a batch costs. The arithmetic itself
/// is <see cref="BudgetLedgerCalculatorTests"/>'s. Prices: the organisation is in NSW, so community access is $60 an hour on a weekday, $84 on a Saturday, $108 on a Sunday and $132 on a
/// public holiday ($1.2 times the standard figure, intensive $1.4 times that), and an eight-hour shift is $480 on a weekday.
/// </summary>
public class BudgetLedgerServiceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static PoolSpec CoreQuarters(PlanType management = PlanType.PlanManaged, decimal each = 2000m, decimal? setAside = null) =>
        Core(management, Q(1, each, setAside), Q(2, each, setAside), Q(3, each, setAside), Q(4, each, setAside));

    private static (LedgerKit Kit, Participant Person, FundingPlan Plan) Arrange(params PoolSpec[] pools)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        var plan = kit.SeedPlan(person, pools.Length == 0 ? new[] { CoreQuarters() } : pools);
        return (kit, person, plan);
    }

    private static async Task<PlanLedger> LedgerOf(LedgerKit kit, Participant person)
    {
        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct);
        return all[person.Id].Ledger!;
    }

    /// <summary>The second quarter, 1 Oct to 31 Dec 2026: the period that holds today.</summary>
    private static PeriodLedger Q2Of(PlanLedger ledger, int pool = 0) => ledger.Pools[pool].Periods[1];

    // ── Claims: every status in its bucket ──────────────────────────────────

    [Fact]
    public async Task EveryClaimStatusCountsInItsBucket_RejectedAndCancelledNotAtAll()
    {
        var (kit, person, _) = Arrange();
        Shift Day(int d) => kit.SeedShift(person, new DateOnly(2026, 10, d), ShiftStatus.Completed);
        kit.SeedShiftClaim(person, TripClaimStatus.Draft, 100m, shift: Day(1));
        kit.SeedShiftClaim(person, TripClaimStatus.Ready, 200m, shift: Day(2));
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 300m, shift: Day(5));
        kit.SeedShiftClaim(person, TripClaimStatus.Approved, 400m, shift: Day(6));
        var paid = kit.SeedShiftClaim(person, TripClaimStatus.Paid, 500m, shift: Day(7));
        var partly = kit.SeedShiftClaim(person, TripClaimStatus.PartiallyPaid, 600m, shift: Day(8));
        kit.SeedShiftClaim(person, TripClaimStatus.Rejected, 700m, shift: Day(9));
        kit.SeedShiftClaim(person, TripClaimStatus.Cancelled, 800m, shift: Day(12));
        kit.Db.ClaimLineItems.Single(l => l.TripClaimId == paid.Id).PaidAmount = 450m;        // paid less than billed: the paid figure counts
        kit.Db.ClaimLineItems.Single(l => l.TripClaimId == partly.Id).PaidAmount = 250m;
        kit.Db.SaveChanges();

        var q2 = Q2Of(await LedgerOf(kit, person));

        Assert.Equal(300m, q2.Pending);              // draft 100 + ready 200
        Assert.Equal(1400m, q2.Claimed);             // submitted 300 + approved 400 + paid 450 + partly paid 250
        Assert.Equal(1700m, q2.Used);
        Assert.Equal(0m, q2.BookedAhead);
        Assert.Equal(6, q2.Items.Count);             // nothing for the rejected or the cancelled claim
        Assert.Equal(new[] { "Approved", "Draft", "Paid", "PartiallyPaid", "Ready", "Submitted" }, q2.Items.Select(i => i.Status).OrderBy(s => s, StringComparer.Ordinal));
    }

    [Fact]
    public async Task APaidClaimWithNoPaidAmountCountsAtItsTotal_AndAPaidAmountOnAClaimNotYetPaidIsIgnored()
    {
        var (kit, person, _) = Arrange();
        var s1 = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        var s2 = kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed);
        var s3 = kit.SeedShift(person, new DateOnly(2026, 10, 5), ShiftStatus.Completed);
        kit.SeedShiftClaim(person, TripClaimStatus.Paid, 500m, shift: s1);                      // PaidAmount never set: the line total stands
        var submitted = kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 300m, shift: s2);
        kit.Db.ClaimLineItems.Single(l => l.TripClaimId == submitted.Id).PaidAmount = 111m;     // a stray figure on a claim that is not paid yet
        kit.SeedShiftClaim(person, TripClaimStatus.PartiallyPaid, 600m, shift: s3);

        var q2 = Q2Of(await LedgerOf(kit, person));

        Assert.Equal(500m + 300m + 600m, q2.Claimed);
    }

    [Fact]
    public async Task ALineWhoseOwnStatusIsRejectedIsLeftOut_WhateverItsClaimsStatus()
    {
        var (kit, person, _) = Arrange();
        var keep = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        var reject = kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed);
        var claim = kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 300m, shift: keep);
        kit.AddShiftLine(claim, reject, 999m, ClaimLineItemStatus.Rejected);
        var draft = kit.SeedShiftClaim(person, TripClaimStatus.Draft, 100m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 5), ShiftStatus.Completed));
        kit.AddShiftLine(draft, reject, 888m, ClaimLineItemStatus.Rejected, date: new DateOnly(2026, 10, 6));

        var q2 = Q2Of(await LedgerOf(kit, person));

        Assert.Equal(300m, q2.Claimed);
        Assert.Equal(100m, q2.Pending);
        Assert.Equal(2, q2.Items.Count);
    }

    [Fact]
    public async Task ATripClaimLineCountsThroughItsBookingsParticipant_ByItsDeliveredFromDate()
    {
        var (kit, person, _) = Arrange();
        var trip = kit.SeedTrip(new DateOnly(2026, 9, 28), 6, TripStatus.Completed);
        var booking = kit.SeedBooking(trip, person);
        kit.SeedTripClaim(trip, booking, TripClaimStatus.Submitted, 700m, new DateOnly(2026, 10, 1));   // delivered from 1 Oct, though the trip began in September

        var ledger = await LedgerOf(kit, person);

        Assert.Equal(0m, ledger.Pools[0].Periods[0].Used);
        var q2 = Q2Of(ledger);
        Assert.Equal(700m, q2.Claimed);
        Assert.Equal(LedgerRowKind.ClaimLine, Assert.Single(q2.Items).Kind);
        Assert.StartsWith("/claims/", Assert.Single(q2.Items).Link);
    }

    // ── Shifts that are not claimed yet ─────────────────────────────────────

    [Fact]
    public async Task CompletedShiftsWithNoClaimLineArePending_PricedAsTheClaimWillBe()
    {
        var (kit, person, _) = Arrange();
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);   // Thursday: 8 h x $60
        kit.SeedShift(person, new DateOnly(2026, 10, 3), ShiftStatus.Completed);   // Saturday: 8 h x $84

        var q2 = Q2Of(await LedgerOf(kit, person));

        Assert.Equal(480m + 672m, q2.Pending);
        Assert.Equal(0m, q2.Claimed);
        Assert.All(q2.Items, i => Assert.Equal(LedgerRowKind.CompletedShift, i.Kind));
        Assert.All(q2.Items, i => Assert.Equal(LedgerGroup.Pending, i.Group));
        Assert.Equal(0, q2.PastUnresolvedCount);
    }

    [Fact]
    public async Task ACompletedShiftThatHasAClaimLineIsCountedOnceThroughTheLine_NotAgainAsAShift()
    {
        var (kit, person, _) = Arrange();
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        kit.SeedShiftClaim(person, TripClaimStatus.Draft, 480m, shift: shift);

        var q2 = Q2Of(await LedgerOf(kit, person));

        Assert.Equal(480m, q2.Pending);
        Assert.Equal(LedgerRowKind.ClaimLine, Assert.Single(q2.Items).Kind);
    }

    [Fact]
    public async Task ARejectedClaimsShiftIsNotCountedAsAnUnclaimedShiftEither_ItStillHasALine()
    {
        var (kit, person, _) = Arrange();
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        kit.SeedShiftClaim(person, TripClaimStatus.Rejected, 480m, shift: shift);

        var q2 = Q2Of(await LedgerOf(kit, person));

        Assert.Empty(q2.Items);   // the money is neither spent nor waiting: the spec counts "completed shifts with no claim line" only
    }

    [Fact]
    public async Task PastShiftsNeverCompletedOrCancelledArePendingAndFlagged()
    {
        var (kit, person, _) = Arrange();
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Published);
        kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.InProgress);
        kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.PendingReview);
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Draft);
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Cancelled);   // counts $0 and is not a row

        var q2 = Q2Of(await LedgerOf(kit, person));

        Assert.Equal(4 * 480m, q2.Pending);
        Assert.Equal(4, q2.PastUnresolvedCount);
        Assert.All(q2.Items, i => Assert.Equal(LedgerRowKind.PastShift, i.Kind));
        Assert.Equal(0m, q2.BookedAhead);
    }

    [Fact]
    public async Task ShiftsFromTodayOnAreBookedAhead_CancelledOnesCountNothing()
    {
        var (kit, person, _) = Arrange();
        kit.SeedShift(person, LedgerKit.Today, ShiftStatus.Published);                    // today (Sunday: 8 h x $108): from today counts
        kit.SeedShift(person, new DateOnly(2026, 10, 5), ShiftStatus.Draft);              // Monday
        kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.InProgress);
        kit.SeedShift(person, new DateOnly(2026, 10, 7), ShiftStatus.PendingReview);
        kit.SeedShift(person, new DateOnly(2026, 10, 8), ShiftStatus.Cancelled);

        var q2 = Q2Of(await LedgerOf(kit, person));

        Assert.Equal(864m + 3 * 480m, q2.BookedAhead);
        Assert.Equal(0m, q2.Used);
        Assert.Equal(4, q2.Items.Count);
        Assert.All(q2.Items, i => Assert.Equal(LedgerRowKind.FutureShift, i.Kind));
        Assert.Equal(q2.Used + q2.BookedAhead, q2.Forecast);
    }

    [Fact]
    public async Task ADaySplitsAtMidnightBetweenPeriods_ByTheServiceDateOnBothEnds()
    {
        var (kit, person, _) = Arrange();
        kit.SeedShift(person, new DateOnly(2026, 9, 30), ShiftStatus.Completed);                       // last day of Q1 (Wednesday)
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);                       // first day of Q2
        kit.SeedShift(person, new DateOnly(2026, 12, 31), ShiftStatus.Published);                      // last day of Q2 (Thursday): booked ahead
        kit.SeedShift(person, new DateOnly(2027, 1, 1), ShiftStatus.Published, 22, 6, endsNextDay: true);   // first day of Q3, an overnight shift that belongs to the day it starts

        var periods = (await LedgerOf(kit, person)).Pools[0].Periods;

        Assert.Equal(480m, periods[0].Pending);
        Assert.Equal(480m, periods[1].Pending);
        Assert.Equal(480m, periods[1].BookedAhead);
        Assert.Equal(8m * 60m, periods[2].BookedAhead);                                                // 22:00 to 06:00 is 8 h; 1 Jan 2027 is a Friday
        Assert.Equal(0m, periods[3].Forecast);
    }

    [Fact]
    public async Task AShiftNoCatalogueRowCoversIsCountedAsZeroAndSaysSo_ItIsNotDropped()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue(effectiveFrom: new DateOnly(2026, 10, 15));   // nothing is valid before mid-October
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters());
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);

        var q2 = Q2Of(await LedgerOf(kit, person));

        var row = Assert.Single(q2.Items);
        Assert.Equal(0m, row.Amount);
        Assert.Equal("No catalogue rate covers this date, so it is counted as $0.", row.Note);
        Assert.Equal(0m, q2.Used);
    }

    [Fact]
    public async Task AShiftIsPricedForTheParticipantsOwnState_ElseTheOrganisations_AndAtTheIntensivePrice()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var own = kit.SeedParticipant(addressState: "VIC", last: "Own");        // VIC price: $50
        var fallback = kit.SeedParticipant(addressState: null, last: "Fallback"); // the organisation's NSW price: $60
        var blank = kit.SeedParticipant(addressState: "  ", last: "Blank");     // blank is no state: the organisation's
        var intensive = kit.SeedParticipant(addressState: "VIC", intensive: true, last: "Intense");   // $70
        foreach (var p in new[] { own, fallback, blank, intensive })
        {
            kit.SeedPlan(p, CoreQuarters());
            kit.SeedShift(p, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        }

        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { own.Id, fallback.Id, blank.Id, intensive.Id }, Ct);

        Assert.Equal(8m * 50m, Q2Of(all[own.Id].Ledger!).Pending);
        Assert.Equal(8m * 60m, Q2Of(all[fallback.Id].Ledger!).Pending);
        Assert.Equal(8m * 60m, Q2Of(all[blank.Id].Ledger!).Pending);
        Assert.Equal(8m * 70m, Q2Of(all[intensive.Id].Ledger!).Pending);
    }

    [Fact]
    public async Task APublicHolidayIsPricedAtTheHolidayRate_OnlyWhereItIsAHoliday()
    {
        var (kit, person, _) = Arrange();
        kit.SeedHoliday(new DateOnly(2026, 10, 5), "NSW");   // Monday, a holiday in NSW: 8 h x $132
        kit.SeedHoliday(new DateOnly(2026, 10, 6), "VIC");   // Tuesday, a holiday in VIC only: an ordinary weekday here
        kit.SeedShift(person, new DateOnly(2026, 10, 5), ShiftStatus.Published);
        kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.Published);

        var q2 = Q2Of(await LedgerOf(kit, person));

        Assert.Equal(8m * 132m + 8m * 60m, q2.BookedAhead);
    }

    // ── Trip bookings ───────────────────────────────────────────────────────

    [Fact]
    public async Task AConfirmedBookingOfAFutureTripIsBookedAhead_PricedByTheTripClaimEngine_InThePeriodTheTripStarts()
    {
        var (kit, person, _) = Arrange();
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);   // Tue 20 to Thu 22 Oct: three weekdays x 8 h x $60
        kit.SeedBooking(trip, person);

        var q2 = Q2Of(await LedgerOf(kit, person));

        Assert.Equal(1440m, q2.BookedAhead);
        var row = Assert.Single(q2.Items);
        Assert.Equal(LedgerRowKind.TripBooking, row.Kind);
        Assert.Equal(new DateOnly(2026, 10, 20), row.Date);
        Assert.Equal($"/trips/{trip.Id}", row.Link);
        Assert.Equal("Confirmed", row.Status);
    }

    [Fact]
    public async Task OnlyConfirmedBookingsCount_CancelledEnquiredHeldOnesAndACancelledTripAreNot_AndATripAlreadyStartedIsNotBookedAhead()
    {
        var (kit, mine, _) = Arrange();
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        foreach (var status in new[] { BookingStatus.Cancelled, BookingStatus.Enquiry, BookingStatus.Held, BookingStatus.Waitlist, BookingStatus.Completed, BookingStatus.NoLongerAttending })
            kit.SeedBooking(trip, mine, status);
        var cancelledTrip = kit.SeedTrip(new DateOnly(2026, 11, 3), 2, TripStatus.Cancelled);
        kit.SeedBooking(cancelledTrip, mine);                                       // confirmed, but the trip is cancelled
        var started = kit.SeedTrip(new DateOnly(2026, 10, 3), 3);                   // started yesterday: not "from today"
        kit.SeedBooking(started, mine);

        var q2 = Q2Of((await kit.Ledger.ComputeAsync(kit.TenantId, new[] { mine.Id }, Ct))[mine.Id].Ledger!);

        Assert.Equal(0m, q2.BookedAhead);
        Assert.Empty(q2.Items);
    }

    [Fact]
    public async Task ABookingOfAParticipantWithNoNdisNumberIsShownAsZeroWithTheReason_BecauseTheTripClaimLeavesThemOut()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant(ndisNumber: null);
        kit.SeedPlan(person, CoreQuarters());
        kit.SeedBooking(kit.SeedTrip(new DateOnly(2026, 10, 20), 3), person);

        var q2 = Q2Of(await LedgerOf(kit, person));

        var row = Assert.Single(q2.Items);
        Assert.Equal(0m, row.Amount);
        Assert.Contains("no NDIS number", row.Note);
    }

    [Fact]
    public async Task ATripsEveningHoursAreSplitOffAtTwentyHundred_AsTheClaimEngineDoes()
    {
        var (kit, person, _) = Arrange();
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 2);                    // Tue and Wed
        trip.DepartureTime = new TimeOnly(14, 0);
        trip.ReturnTime = new TimeOnly(21, 30);
        kit.Db.SaveChanges();
        kit.SeedBooking(trip, person);

        var q2 = Q2Of(await LedgerOf(kit, person));

        // 16 active hours over two days. The first day runs 14:00 + 8 h = 22:00, so 2 h of it is after 20:00; the last day's return at 21:30 adds 1.5 h. Evening 3.5 h x $66, the rest 12.5 h x $60.
        Assert.Equal(3.5m * 66m + 12.5m * 60m, q2.BookedAhead);
    }

    [Fact]
    public async Task AnOverrideOnTheBookingPicksTheCorePoolOfThatManagementType()
    {
        var (kit, person, _) = Arrange(CoreQuarters(PlanType.AgencyManaged), CoreQuarters(PlanType.PlanManaged));
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        kit.SeedBooking(trip, person, planTypeOverride: PlanType.AgencyManaged);   // the participant is plan managed; this booking is agency managed

        var ledger = await LedgerOf(kit, person);

        Assert.Equal(1440m, Q2Of(ledger, 0).BookedAhead);
        Assert.Equal(0m, Q2Of(ledger, 1).BookedAhead);
    }

    // ── Pools, buckets and plans ────────────────────────────────────────────

    [Fact]
    public async Task ShiftsGoToTheCorePoolUnderTheParticipantsPlanType_WhenThePlanHoldsTwo()
    {
        var (kit, person, _) = Arrange(CoreQuarters(PlanType.AgencyManaged), CoreQuarters(PlanType.PlanManaged));
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);

        var ledger = await LedgerOf(kit, person);

        Assert.Equal(0m, Q2Of(ledger, 0).Pending);
        Assert.Equal(480m, Q2Of(ledger, 1).Pending);   // the participant is PlanManaged
    }

    [Fact]
    public async Task AClaimLineBelongsToThePoolOfItsItemsCategoryOnTheServiceDate_StatedPoolsIncluded_AndWhatFitsNoneIsShownNotDropped()
    {
        var (kit, person, _) = Arrange(CoreQuarters(), Stated(15, PlanType.PlanManaged, Q(1, 500m), Q(2, 500m), Q(3, 500m), Q(4, 500m)));
        var skills = kit.SeedItem("15_035_0128_1_3", 15);
        var coaching = kit.SeedItem("09_009_0106_6_3", 9);                                        // category 9: the plan records no pool for it
        var legacyOnly = kit.SeedItem("07_001_0106_6_3", paceCategory: 7, legacyCategory: 7);
        legacyOnly.PaceSupportCategoryNumber = null;                                              // an older row carries only the legacy category (7: not recorded either)
        kit.Db.SaveChanges();
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 120m, shift: shift, itemCode: skills.ItemNumber);
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 70m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed), itemCode: coaching.ItemNumber);
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 30m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 5), ShiftStatus.Completed), itemCode: "NOT-A-CODE");
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 55m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.Completed), itemCode: legacyOnly.ItemNumber);
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 44m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 7), ShiftStatus.Completed));   // community access: Core

        var ledger = await LedgerOf(kit, person);

        Assert.Equal(44m, Q2Of(ledger, 0).Claimed);
        Assert.Equal(120m, Q2Of(ledger, 1).Claimed);
        Assert.Equal(new[] { 30m, 55m, 70m }, ledger.NotInAPool.Select(i => i.Amount).OrderBy(a => a));   // 9, an unknown code and the legacy-only 7: three claim lines, all shown
    }

    [Fact]
    public async Task WhatIsDatedAfterThePlanEndsIsShownAsOutsideThePlanDates_AndWhatIsDatedBeforeItStartsBelongsToAnEarlierPlan()
    {
        var (kit, person, _) = Arrange();
        kit.SeedShift(person, new DateOnly(2027, 8, 2), ShiftStatus.Published);          // after the plan ends on 30 Jun 2027
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 90m, shift: kit.SeedShift(person, new DateOnly(2026, 6, 20), ShiftStatus.Completed));   // before it starts: last year's plan

        var ledger = await LedgerOf(kit, person);

        var outside = Assert.Single(ledger.OutsideThePlan);
        Assert.Equal(480m, outside.Amount);
        Assert.Empty(ledger.NotInAPool);
        Assert.All(ledger.Pools[0].Periods, p => Assert.Equal(0m, p.Forecast));
    }

    [Fact]
    public async Task NothingCarriesAcrossPlans_TheNewPlansFirstPeriodStartsFromItsOwnLimit()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, new DateOnly(2025, 7, 1), new DateOnly(2026, 6, 30), Core(PlanType.PlanManaged, new PeriodSpec(new DateOnly(2025, 7, 1), new DateOnly(2026, 6, 30), 50000m)));   // plenty unspent
        kit.SeedPlan(person, CoreQuarters());

        var ledger = await LedgerOf(kit, person);

        Assert.Equal(2026, ledger.Plan.PlanStart.Year);
        Assert.Equal(0m, ledger.Pools[0].Periods[0].Carried);
        Assert.Equal(2000m, ledger.Pools[0].Periods[0].Available);
    }

    [Fact]
    public async Task APlanThatHasEndedWithNoSuccessorIsStillTheLedger_AndAnUpcomingPlanIsNot()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var ended = kit.SeedParticipant(last: "Ended");
        kit.SeedPlan(ended, new DateOnly(2025, 7, 1), new DateOnly(2026, 6, 30), Core(PlanType.PlanManaged, new PeriodSpec(new DateOnly(2025, 7, 1), new DateOnly(2026, 6, 30), 6000m)));
        var upcoming = kit.SeedParticipant(last: "Upcoming");
        kit.SeedPlan(upcoming, new DateOnly(2026, 11, 1), new DateOnly(2027, 10, 31), Core(PlanType.PlanManaged, new PeriodSpec(new DateOnly(2026, 11, 1), new DateOnly(2027, 10, 31), 6000m)));
        var none = kit.SeedParticipant(last: "None");

        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { ended.Id, upcoming.Id, none.Id }, Ct);

        Assert.False(all[ended.Id].Ledger!.PlanIsCurrent);
        Assert.Equal(6000m, all[ended.Id].Ledger!.Pools[0].Total.Limit);
        Assert.Null(all[upcoming.Id].Ledger);     // nothing has started: no figures, and no "all clear" either
        Assert.Null(all[none.Id].Ledger);
        Assert.Equal(3, all.Count);
    }

    [Fact]
    public async Task TheStatusUsesTheOrganisationsApproachingPercentage_EightyByDefault()
    {
        var (kit, person, _) = Arrange(CoreQuarters(each: 1000m));
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 600m, kit.SeedShift(person, new DateOnly(2026, 9, 29), ShiftStatus.Completed));   // 600 of Q1's 1,000: 60%
        Assert.Equal(BudgetStatus.OnTrack, (await LedgerOf(kit, person)).Pools[0].Periods[0].Status);

        kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = kit.TenantId, ApproachingPercent = 60 });
        kit.Db.SaveChanges();

        Assert.Equal(BudgetStatus.Approaching, (await LedgerOf(kit, person)).Pools[0].Periods[0].Status);
    }

    [Fact]
    public async Task EachStatusComesOutOfTheRecords()
    {
        // One period from 1 Oct 2026 with $1,000 in it: used 0 -> on track; claimed 850 -> approaching; 480 more booked -> forecast over; another 1,200 claimed -> over.
        var (kit, person, _) = Arrange(Core(PlanType.PlanManaged, new PeriodSpec(new DateOnly(2026, 10, 1), new DateOnly(2027, 9, 30), 1000m)));
        static PeriodLedger Only(PlanLedger ledger) => ledger.Pools[0].Periods.Single();
        Assert.Equal(BudgetStatus.OnTrack, Only(await LedgerOf(kit, person)).Status);

        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 850m, kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed));
        Assert.Equal(BudgetStatus.Approaching, Only(await LedgerOf(kit, person)).Status);

        kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.Published);
        Assert.Equal(BudgetStatus.ForecastOver, Only(await LedgerOf(kit, person)).Status);

        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 1200m, kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed));
        Assert.Equal(BudgetStatus.Over, Only(await LedgerOf(kit, person)).Status);
    }

    // ── The provider's today ────────────────────────────────────────────────

    [Fact]
    public async Task TodayIsTheProvidersCalendarDate_NotTheUtcDate()
    {
        // 15:30 UTC on Saturday 3 Oct is 01:30 on Sunday 4 Oct in Sydney (before the 02:00 clock change), so the provider's today is the 4th while the UTC date is the 3rd.
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 3, 15, 30, 0, TimeSpan.Zero));
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters());
        kit.SeedShift(person, new DateOnly(2026, 10, 3), ShiftStatus.Published);   // yesterday for the provider: never resolved, pending
        kit.SeedShift(person, new DateOnly(2026, 10, 4), ShiftStatus.Published);   // today for the provider: booked ahead (a Sunday)

        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct);
        var q2 = Q2Of(all[person.Id].Ledger!);

        Assert.Equal(new DateOnly(2026, 10, 4), all[person.Id].Today);
        Assert.Equal("Australia/Sydney", all[person.Id].TimeBasis);
        Assert.Equal(8m * 84m, q2.Pending);      // the Saturday shift
        Assert.Equal(1, q2.PastUnresolvedCount);
        Assert.Equal(8m * 108m, q2.BookedAhead);
    }

    [Fact]
    public async Task TheProvidersStateDecidesTheZone_APerthProviderIsEightHoursAheadOfUtc()
    {
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 3, 17, 0, 0, TimeSpan.Zero));   // 01:00 on the 4th in Perth
        kit.SeedProvider("WA");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters());

        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct);

        Assert.Equal(new DateOnly(2026, 10, 4), all[person.Id].Today);
        Assert.Equal("Australia/Perth", all[person.Id].TimeBasis);
    }

    // ── Tenancy ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task AnotherOrganisationsParticipantIsAbsent_AndNoneOfItsClaimsShiftsOrBookingsReachAnAnswer()
    {
        var database = Guid.NewGuid().ToString();
        using var a = LedgerKit.Create(TenantA, database);
        using var b = LedgerKit.Create(TenantB, database);
        a.SeedProvider("NSW", TenantA);
        b.SeedProvider("NSW", TenantB);
        a.SeedCommunityAccessCatalogue();
        var mine = a.SeedParticipant(last: "Mine");
        a.SeedPlan(mine, CoreQuarters());
        var theirs = b.SeedParticipant(tenantId: TenantB, last: "Theirs");
        b.SeedPlan(theirs, CoreQuarters());
        var theirShift = b.SeedShift(theirs, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        b.SeedShiftClaim(theirs, TripClaimStatus.Submitted, 9999m, theirShift, itemCode: a.Item(ClaimDayType.Weekday).ItemNumber);
        var theirTrip = b.SeedTrip(new DateOnly(2026, 10, 20), 3);
        b.SeedBooking(theirTrip, theirs);
        a.SeedShift(mine, new DateOnly(2026, 10, 1), ShiftStatus.Completed);

        var asked = await a.Ledger.ComputeAsync(TenantA, new[] { mine.Id, theirs.Id }, Ct);

        Assert.Equal(new[] { mine.Id }, asked.Keys);                        // theirs is not in the answer
        Assert.Equal(480m, Q2Of(asked[mine.Id].Ledger!).Used);              // and none of their 9,999 is in mine
        Assert.Null(await a.Ledger.GetLedgerAsync(TenantA, theirs.Id, Ct));
        Assert.Null(await a.Ledger.GetRowsAsync(TenantA, theirs.Id, Guid.NewGuid(), Guid.NewGuid(), 0, 10, Ct));
        var theirClaim = b.Db.TripClaims.Single();
        Assert.Null(await a.Ledger.ForClaimAsync(TenantA, theirClaim.Id, Ct));   // reached by its id alone, the claim shows no budget of another organisation
        var theirs2 = await b.Ledger.ComputeAsync(TenantB, new[] { theirs.Id, mine.Id }, Ct);
        Assert.Equal(new[] { theirs.Id }, theirs2.Keys);
    }

    [Fact]
    public async Task AParticipantIdFromTheRightTenantButClaimsOfAnotherWithTheSameItemCodeStillCountsOnlyItsOwn()
    {
        var database = Guid.NewGuid().ToString();
        using var a = LedgerKit.Create(TenantA, database);
        using var b = LedgerKit.Create(TenantB, database);
        a.SeedProvider("NSW", TenantA);
        a.SeedCommunityAccessCatalogue();
        var mine = a.SeedParticipant(last: "Mine");
        a.SeedPlan(mine, CoreQuarters());
        var theirs = b.SeedParticipant(tenantId: TenantB, last: "Theirs");
        b.SeedPlan(theirs, CoreQuarters());
        a.SeedShiftClaim(mine, TripClaimStatus.Draft, 100m, shift: a.SeedShift(mine, new DateOnly(2026, 10, 1), ShiftStatus.Completed));
        b.SeedShiftClaim(theirs, TripClaimStatus.Draft, 777m, itemCode: a.Item(ClaimDayType.Weekday).ItemNumber, shift: b.SeedShift(theirs, new DateOnly(2026, 10, 1), ShiftStatus.Completed));

        var q2 = Q2Of(await LedgerOf(a, mine));

        Assert.Equal(100m, q2.Pending);
    }

    // ── The wire shape ──────────────────────────────────────────────────────

    [Fact]
    public async Task TheLedgerDtoCarriesEveryFigureTheScreensNeed_SoNoScreenAddsAnythingUp()
    {
        var (kit, person, plan) = Arrange(CoreQuarters(each: 2000m, setAside: 1000m));
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 400m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed));
        kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.Published);

        var dto = (await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, Ct))!;

        Assert.Equal(plan.Id, dto.PlanId);
        Assert.Equal(new DateOnly(2026, 10, 4), dto.AsOf);
        Assert.Equal("Australia/Sydney", dto.TimeBasis);
        Assert.Equal(80, dto.ApproachingPercent);
        Assert.True(dto.PlanIsCurrent);
        var pool = Assert.Single(dto.Pools);
        Assert.True(pool.HasSetAside);
        var q2 = pool.Periods[1];
        Assert.True(q2.IsCurrent);
        Assert.Equal(1000m, q2.Limit);
        Assert.Equal(1000m, q2.Carried);        // Q1 used nothing of its 1,000
        Assert.Equal(2000m, q2.Available);
        Assert.Equal(400m, q2.Claimed);
        Assert.Equal(0m, q2.Pending);
        Assert.Equal(400m, q2.Used);
        Assert.Equal(480m, q2.BookedAhead);
        Assert.Equal(880m, q2.Forecast);
        Assert.Equal(1600m, q2.Remaining);
        Assert.Equal(1120m, q2.ForecastRemaining);
        Assert.Equal(BudgetStatus.OnTrack, q2.Status);
        Assert.Equal(2, q2.RowCount);
        Assert.Equal(new[] { LedgerGroup.Claimed, LedgerGroup.BookedAhead }, q2.Rows.Select(r => r.Group));
        Assert.Equal(4000m, pool.PlanTotal.Limit);
        Assert.Equal(4000m, pool.PlanTotal.Available);
        Assert.Equal(880m, pool.PlanTotal.Forecast);
        Assert.Equal(3120m, pool.PlanTotal.ForecastRemaining);
    }

    [Fact]
    public async Task AParticipantWithNoPlanThatHasStartedGetsAnAnswerWithNoPlanAndNoPools()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        var person = kit.SeedParticipant();

        var dto = (await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, Ct))!;

        Assert.Null(dto.PlanId);
        Assert.Empty(dto.Pools);
        Assert.Equal(new DateOnly(2026, 10, 4), dto.AsOf);
    }

    [Fact]
    public async Task APeriodHandsOutItsFirstTwoHundredRows_AndTheRestOnRequest_InTheSameOrder()
    {
        var (kit, person, _) = Arrange(CoreQuarters(each: 999999m));
        for (var i = 0; i < 205; i++) kit.SeedShift(person, new DateOnly(2026, 10, 1).AddDays(i % 80), ShiftStatus.Completed);

        var dto = (await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, Ct))!;
        var q2 = dto.Pools[0].Periods[1];
        var page = (await kit.Ledger.GetRowsAsync(kit.TenantId, person.Id, dto.Pools[0].Id, q2.Id, 200, 200, Ct))!;

        Assert.Equal(205, q2.RowCount);
        Assert.Equal(200, q2.Rows.Count);
        Assert.Equal(205, page.Total);
        Assert.Equal(5, page.Rows.Count);
        Assert.True(q2.Rows.Last().Date <= page.Rows.First().Date);      // dated order runs on across the page break
        Assert.Null(await kit.Ledger.GetRowsAsync(kit.TenantId, person.Id, dto.Pools[0].Id, Guid.NewGuid(), 0, 10, Ct));
    }

    // ── What a claim does to a budget ───────────────────────────────────────

    [Fact]
    public async Task AnExistingClaimShowsWhatWasUsedWithoutItWhatItTakesAndWhatIsUsedWithIt()
    {
        var (kit, person, _) = Arrange(CoreQuarters(each: 1000m));
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 300m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed));
        var claim = kit.SeedShiftClaim(person, TripClaimStatus.Draft, 600m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed));

        var block = (await kit.Ledger.ForClaimAsync(kit.TenantId, claim.Id, Ct))!;

        var row = Assert.Single(Assert.Single(block.Participants).Rows);
        Assert.Equal(ClaimBudgetPlacement.Pool, row.Placement);
        Assert.Equal("Core (flexible)", row.PoolName);
        Assert.Equal(new DateOnly(2026, 10, 1), row.PeriodStart);
        Assert.Equal(new DateOnly(2026, 12, 31), row.PeriodEnd);
        Assert.Equal(2000m, row.Available);       // 1,000 + 1,000 carried from Q1
        Assert.Equal(300m, row.UsedBefore);
        Assert.Equal(600m, row.ThisClaim);
        Assert.Equal(900m, row.UsedAfter);
        Assert.Equal(1100m, row.LeftAfter);
        Assert.Equal(BudgetStatus.OnTrack, row.StatusAfter);
    }

    [Fact]
    public async Task ARejectedClaimUsesNothingSoItsBudgetBlockIsNull_AndAClaimOfAParticipantWithNoPlanToo()
    {
        var (kit, person, _) = Arrange();
        var rejected = kit.SeedShiftClaim(person, TripClaimStatus.Rejected, 600m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed));
        var other = kit.SeedParticipant(last: "NoPlan");
        var unplanned = kit.SeedShiftClaim(other, TripClaimStatus.Draft, 100m, shift: kit.SeedShift(other, new DateOnly(2026, 10, 2), ShiftStatus.Completed));

        Assert.Null(await kit.Ledger.ForClaimAsync(kit.TenantId, rejected.Id, Ct));
        Assert.Null(await kit.Ledger.ForClaimAsync(kit.TenantId, unplanned.Id, Ct));
    }

    [Fact]
    public async Task APreviewTakesTheShiftsItReplacesOutOfPending_SoNothingIsCountedTwice()
    {
        var (kit, person, _) = Arrange(CoreQuarters(each: 1000m));
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);   // $480, pending already
        kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 200m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed));

        var block = (await kit.Ledger.EffectOfLinesAsync(kit.TenantId, new[] { new ClaimEffectLine(person.Id, shift.ServiceDate, 4, PlanType.PlanManaged, 480m, shift.Id, null) }, Ct))!;

        var row = Assert.Single(Assert.Single(block.Participants).Rows);
        Assert.Equal(200m, row.UsedBefore);   // the 480 shift is not used before: it is this claim
        Assert.Equal(480m, row.ThisClaim);
        Assert.Equal(680m, row.UsedAfter);    // 200 claimed + 480, and no more than the 680 the ledger already showed
        Assert.Equal(row.UsedAfter, Q2Of(await LedgerOf(kit, person)).Used);
    }

    [Fact]
    public async Task APreviewThatTakesAPeriodOverSaysSo_AndAnItemInNoPoolIsAskedForNotDropped()
    {
        var (kit, person, _) = Arrange(CoreQuarters(each: 200m));
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);

        var block = (await kit.Ledger.EffectOfLinesAsync(
            kit.TenantId,
            new[]
            {
                new ClaimEffectLine(person.Id, shift.ServiceDate, 4, PlanType.PlanManaged, 480m, shift.Id, null),
                new ClaimEffectLine(person.Id, shift.ServiceDate, 9, PlanType.PlanManaged, 75m, null, null),
            },
            Ct))!;

        var rows = Assert.Single(block.Participants).Rows;
        Assert.Equal(2, rows.Count);
        var core = rows[0];
        Assert.Equal(400m, core.Available);      // 200 + 200 carried from Q1
        Assert.Equal(0m, core.UsedBefore);
        Assert.Equal(480m, core.ThisClaim);
        Assert.Equal(480m, core.UsedAfter);
        Assert.Equal(-80m, core.LeftAfter);      // 80 over
        Assert.Equal(BudgetStatus.Over, core.StatusAfter);
        Assert.Equal(ClaimBudgetPlacement.NotInAPool, rows[1].Placement);
        Assert.Equal("Not in a recorded pool", rows[1].PoolName);
        Assert.Equal(75m, rows[1].ThisClaim);
        Assert.Null(rows[1].Available);
    }

    // ── Cost ────────────────────────────────────────────────────────────────

    /// <summary>A batch of participants, each with a plan, a completed shift, a claim line, a future shift and a trip booking.</summary>
    private static (LedgerKit Kit, List<Guid> Ids) Populate(int participants)
    {
        var kit = LedgerKit.Create(countQueries: true);
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        var ids = new List<Guid>();
        for (var i = 0; i < participants; i++)
        {
            var person = kit.SeedParticipant(last: $"Person{i:00}");
            kit.SeedPlan(person, CoreQuarters());
            kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
            kit.SeedShiftClaim(person, TripClaimStatus.Submitted, 100m, shift: kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Completed));
            kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.Published);
            kit.SeedBooking(trip, person);
            ids.Add(person.Id);
        }
        return (kit, ids);
    }

    [Fact]
    public async Task ABatchRunsTheSameFixedNumberOfQueries_HoweverManyParticipantsItHolds()
    {
        var (smallKit, smallIds) = Populate(2);
        var (largeKit, largeIds) = Populate(40);
        using var _s = smallKit;
        using var _l = largeKit;

        var small = LedgerQueryCounter.Start();
        var smallAnswer = await smallKit.Ledger.ComputeAsync(smallKit.TenantId, smallIds, Ct);
        var smallCount = small[0];
        var large = LedgerQueryCounter.Start();
        var largeAnswer = await largeKit.Ledger.ComputeAsync(largeKit.TenantId, largeIds, Ct);
        var largeCount = large[0];

        Assert.Equal(2, smallAnswer.Count);
        Assert.Equal(40, largeAnswer.Count);
        Assert.All(largeAnswer.Values, l => Assert.Equal(480m + 100m, Q2Of(l.Ledger!).Used));
        Assert.Equal(smallCount, largeCount);        // the catalogue and the holidays are read once, and nothing is a query per participant
        Assert.InRange(largeCount, 1, 14);
    }

    [Fact]
    public async Task APreviewAndAClaimDetailCostAFixedNumberOfQueriesToo()
    {
        var (kit, ids) = Populate(30);
        using var _k = kit;
        var person = await kit.Db.Participants.FirstAsync(p => p.Id == ids[0], Ct);
        var shift = await kit.Db.Shifts.FirstAsync(s => s.ParticipantId == person.Id && s.Status == ShiftStatus.Completed, Ct);
        var claim = await kit.Db.TripClaims.FirstAsync(c => c.ParticipantId == person.Id, Ct);

        var preview = LedgerQueryCounter.Start();
        await kit.Ledger.EffectOfLinesAsync(kit.TenantId, new[] { new ClaimEffectLine(person.Id, shift.ServiceDate, 4, PlanType.PlanManaged, 480m, shift.Id, null) }, Ct);
        var previewCount = preview[0];
        var detail = LedgerQueryCounter.Start();
        await kit.Ledger.ForClaimAsync(kit.TenantId, claim.Id, Ct);
        var detailCount = detail[0];

        Assert.InRange(previewCount, 1, 14);
        Assert.InRange(detailCount, 1, 15);
    }
}
