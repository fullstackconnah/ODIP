using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// "Priced as ODIP will claim it": the ledger prices a shift that is not claimed yet with <see cref="ShiftPriceEstimator"/> and a trip booking with <see cref="TripPriceEstimator"/>, the code the
/// two claim engines now run themselves, so an estimate and the claim made from it must be the same figure. These tests make the engines produce the real claim (a generated draft, and the
/// trip preview) for the same records and compare it, line for line, with what the ledger said first: several day types, a public holiday, the intensive flag, the state fallback,
/// an overnight shift, an evening split, and active hours that are not eight.
/// </summary>
public class ClaimPricingEqualityTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static PoolSpec CoreQuarters() => Core(PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m), Q(3, 100000m), Q(4, 100000m));

    private static LedgerKit ArrangeKit(string providerState = "NSW")
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider(providerState);
        kit.SeedCommunityAccessCatalogue();
        return kit;
    }

    private static async Task<List<LedgerItem>> ItemsOf(LedgerKit kit, params Participant[] people)
    {
        var all = await kit.Ledger.ComputeAsync(kit.TenantId, people.Select(p => p.Id).ToList(), Ct);
        return all.Values.SelectMany(l => l.Items).ToList();
    }

    // ── Shifts ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task EveryShiftTheLedgerCountsAsPendingIsPricedAsTheGeneratedClaimLineIs()
    {
        var kit = ArrangeKit("NSW");
        kit.SeedHoliday(new DateOnly(2026, 10, 5), "NSW");                                          // a Monday holiday
        var standard = kit.SeedParticipant(addressState: null, last: "Standard");                   // priced in the organisation's NSW
        var victorian = kit.SeedParticipant(addressState: "VIC", last: "Victorian");                // priced in their own state
        var intensive = kit.SeedParticipant(addressState: "VIC", intensive: true, last: "Intensive");
        var people = new[] { standard, victorian, intensive };
        foreach (var person in people)
        {
            kit.SeedPlan(person, CoreQuarters());
            kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);                // Thursday
            kit.SeedShift(person, new DateOnly(2026, 10, 3), ShiftStatus.Completed, 8, 12);         // Saturday, 4 h
            kit.SeedShift(person, new DateOnly(2026, 10, 4), ShiftStatus.Completed, 10, 14);        // Sunday, 4 h
            kit.SeedShift(person, new DateOnly(2026, 10, 5), ShiftStatus.Completed, 9, 17);         // the holiday
            kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.Completed, 22, 6, endsNextDay: true);   // an overnight shift: 8 h
        }
        var estimated = (await ItemsOf(kit, people)).Where(i => i.Kind == LedgerRowKind.CompletedShift).ToList();
        Assert.Equal(15, estimated.Count);
        Assert.All(estimated, i => Assert.Null(i.Note));   // every one was priced: none is an unpriced $0

        var generator = new ShiftClaimGenerationService(kit.Db);
        foreach (var person in people)
        {
            var claim = await generator.GenerateDraftClaimAsync(person.Id, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 6), Ct);
            var lines = await kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToListAsync(Ct);

            Assert.Equal(5, lines.Count);
            foreach (var line in lines)
            {
                var estimate = estimated.Single(i => i.ShiftId == line.ShiftId);
                Assert.Equal(line.TotalAmount, estimate.Amount);                                      // the same figure, to the cent
                Assert.Equal(line.SupportsDeliveredFrom, estimate.Date);
                Assert.Equal(PaceCategories.Of(kit.Item(line.DayType, person.IsIntensiveSupport)), estimate.PaceCategory);
            }
        }
    }

    [Fact]
    public async Task TheShiftPreviewTotalIsTheLedgersPendingTotalForTheSameShifts()
    {
        var kit = ArrangeKit("VIC");
        var person = kit.SeedParticipant(intensive: true);
        kit.SeedPlan(person, CoreQuarters());
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        kit.SeedShift(person, new DateOnly(2026, 10, 3), ShiftStatus.Completed, 7, 11);
        var before = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id].Ledger!.Pools[0].Periods[1];

        var preview = await new ShiftClaimGenerationService(kit.Db, kit.Ledger).PreviewAsync(person.Id, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), Ct);

        Assert.Equal(before.Pending, preview.TotalAmount);
        var row = Assert.Single(Assert.Single(preview.Budget!.Participants).Rows);
        Assert.Equal(0m, row.UsedBefore);                  // the two shifts are this claim, so nothing was used without it
        Assert.Equal(preview.TotalAmount, row.ThisClaim);
        Assert.Equal(before.Used, row.UsedAfter);          // and with it the period is exactly where the ledger already had it: nothing counted twice
    }

    [Fact]
    public async Task AShiftWithNoCatalogueRowIsLeftOutOfTheClaimAndCountedAsZeroByTheLedger()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue(effectiveFrom: new DateOnly(2026, 10, 15));   // no row is valid before mid-October
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters());
        var unpriced = kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        var priced = kit.SeedShift(person, new DateOnly(2026, 10, 20), ShiftStatus.Completed);

        var items = await ItemsOf(kit, person);
        var preview = await new ShiftClaimGenerationService(kit.Db).PreviewAsync(person.Id, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), Ct);

        var line = Assert.Single(preview.LineItems);                                // the engine leaves the shift it cannot price out of the claim
        Assert.Equal(priced.Id, line.ShiftId);
        Assert.Equal(0m, items.Single(i => i.ShiftId == unpriced.Id).Amount);      // and the ledger counts it as $0, and says why
        Assert.NotNull(items.Single(i => i.ShiftId == unpriced.Id).Note);
        Assert.Equal(line.TotalAmount, items.Sum(i => i.Amount));
    }

    // ── Trips ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task EveryTripBookingTheLedgerCountsAsBookedAheadIsPricedAsTheTripPreviewAndTheGeneratedClaimAre()
    {
        var kit = ArrangeKit("NSW");
        kit.SeedHoliday(new DateOnly(2026, 10, 9), "NSW");                                             // a Friday holiday inside the trip
        var standard = kit.SeedParticipant(last: "Standard");
        var intensive = kit.SeedParticipant(intensive: true, last: "Intensive");
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 8), 6, activeHours: 6.5m);                      // Thu 8 to Tue 13: a holiday, a weekend and weekdays
        trip.DepartureTime = new TimeOnly(15, 0);                                                      // 15:00 + 6.5 h = 21:30: 1.5 h of the first day is after 20:00
        trip.ReturnTime = new TimeOnly(20, 45);                                                        // and 0.75 h of the last
        kit.Db.SaveChanges();
        foreach (var person in new[] { standard, intensive })
        {
            kit.SeedPlan(person, CoreQuarters());
            kit.SeedBooking(trip, person);
        }

        var estimated = (await ItemsOf(kit, standard, intensive)).Where(i => i.Kind == LedgerRowKind.TripBooking).ToList();
        var preview = await new ClaimGenerationService(kit.Db).PreviewClaimAsync(trip.Id, null, Ct);
        trip.Status = TripStatus.Completed;
        kit.Db.SaveChanges();
        var claim = await new ClaimGenerationService(kit.Db).GenerateDraftClaimAsync(trip.Id, null, Ct);
        var generated = await kit.Db.ClaimLineItems.Include(l => l.ParticipantBooking).Where(l => l.TripClaimId == claim.Id).ToListAsync(Ct);

        Assert.Equal(2, estimated.Count);
        foreach (var person in new[] { standard, intensive })
        {
            var estimate = estimated.Single(i => i.BookingId == kit.Db.ParticipantBookings.Single(b => b.ParticipantId == person.Id).Id);
            var previewTotal = preview.LineItems.Where(l => l.NdisNumber == person.NdisNumber && l.ParticipantName == person.FullName).Sum(l => l.TotalAmount);
            var claimTotal = generated.Where(l => l.ParticipantBooking!.ParticipantId == person.Id).Sum(l => l.TotalAmount);

            Assert.True(estimate.Amount > 0m);
            Assert.Equal(previewTotal, estimate.Amount);
            Assert.Equal(claimTotal, estimate.Amount);
            Assert.Equal(new DateOnly(2026, 10, 8), estimate.Date);       // counted in the period the trip starts in
        }
        Assert.True(estimated.Single(i => i.Amount > estimated.Min(e => e.Amount)).Amount > estimated.Min(i => i.Amount));   // the intensive participant costs more
    }

    [Fact]
    public async Task TheTripEstimatorsLinesAreTheEnginesLines_ForTheWholePricingRuleSet()
    {
        var kit = ArrangeKit("QLD");
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 9), 4, activeHours: 9m);   // Fri to Mon: weekday, Saturday, Sunday, weekday
        var person = kit.SeedParticipant(intensive: true);
        kit.SeedBooking(trip, person);
        var items = kit.Db.SupportCatalogueItems.ToList();
        var input = new TripPricingInput(
            trip.StartDate, trip.DurationDays, trip.TripDays.Select(d => new TripPricingDay(d.Date, d.IsPublicHoliday)).ToList(), new TimeOnly(8, 0), new TimeOnly(18, 0), 9m);

        var price = new TripPriceEstimator(input, items, new HashSet<DateOnly>(), "QLD").Price(isIntensive: true);
        var preview = await new ClaimGenerationService(kit.Db).PreviewClaimAsync(trip.Id, null, Ct);

        Assert.Equal(preview.LineItems.Select(l => (l.DayType, l.SupportsDeliveredFrom, l.SupportsDeliveredTo, l.Hours, l.UnitPrice, l.TotalAmount)),
            price.Lines.Select(l => (l.DayType, l.From, l.To, l.Hours, l.UnitPrice, l.TotalAmount)));
        Assert.Empty(price.UnpricedDayTypes);
        Assert.Equal(preview.TotalAmount, price.Total);
    }

    [Fact]
    public async Task TheTripPreviewCarriesABudgetBlockForEachParticipantWithAPlan_AndNoneForOneWithout()
    {
        var kit = ArrangeKit("NSW");
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        var planned = kit.SeedParticipant(last: "Planned");
        var tight = kit.SeedParticipant(last: "Tight");
        var unplanned = kit.SeedParticipant(last: "Unplanned");
        kit.SeedPlan(planned, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        kit.SeedPlan(tight, Core(PlanType.PlanManaged, Q(1, 300m), Q(2, 300m), Q(3, 300m), Q(4, 300m)));
        foreach (var person in new[] { planned, tight, unplanned }) kit.SeedBooking(trip, person);

        var preview = await new ClaimGenerationService(kit.Db, kit.Ledger).PreviewClaimAsync(trip.Id, null, Ct);

        Assert.Equal(new[] { planned.Id, tight.Id }.OrderBy(id => id), preview.Budget!.Participants.Select(p => p.ParticipantId).OrderBy(id => id));
        var plannedRow = Assert.Single(preview.Budget.Participants.Single(p => p.ParticipantId == planned.Id).Rows);
        Assert.Equal(1440m, plannedRow.ThisClaim);
        Assert.Equal(0m, plannedRow.UsedBefore);                  // the booking is booked ahead, not used: the claim is what takes it
        Assert.Equal(1440m, plannedRow.UsedAfter);
        Assert.Equal(BudgetStatus.OnTrack, plannedRow.StatusAfter);
        var tightRow = Assert.Single(preview.Budget.Participants.Single(p => p.ParticipantId == tight.Id).Rows);
        Assert.Equal(600m, tightRow.Available);                   // 300 + 300 carried
        Assert.Equal(-840m, tightRow.LeftAfter);
        Assert.Equal(BudgetStatus.Over, tightRow.StatusAfter);
    }

    [Fact]
    public async Task APreviewWithNoLedgerAndAPreviewForAnOrganisationNobodyHasAPlanIn_CarryNoBudgetBlock()
    {
        var kit = ArrangeKit("NSW");
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        kit.SeedBooking(trip, kit.SeedParticipant());

        var without = await new ClaimGenerationService(kit.Db).PreviewClaimAsync(trip.Id, null, Ct);
        var noPlans = await new ClaimGenerationService(kit.Db, kit.Ledger).PreviewClaimAsync(trip.Id, null, Ct);

        Assert.Null(without.Budget);
        Assert.Null(noPlans.Budget);
        Assert.Equal(without.TotalAmount, noPlans.TotalAmount);
    }
}
