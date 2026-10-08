using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// How many trip days no catalogue rate covers (the 2026-10-08 review, L5-04). The count is of DAYS: each date of a booking once, however many of the trip's stretches and
/// pieces (weekday, weekday evening) are unpriced on it, and once per booking however many PACE categories its price is split across. The evening piece belongs to the days the evening
/// hours really fall on (the first day after the departure, the last before the return), not to the whole weekday stretch it sits inside.
/// </summary>
public class BudgetLedgerUnpricedTripDaysTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static PoolSpec CoreQuarters() => Core(PlanType.PlanManaged, Q(1, 50000m), Q(2, 50000m), Q(3, 50000m), Q(4, 50000m));

    private static LedgerKit ArrangeWith(Action<LedgerKit> catalogue)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        catalogue(kit);
        return kit;
    }

    private static SupportCatalogueItem Row(LedgerKit kit, string code, ClaimDayType dayType, int category) => new()
    {
        Id = Guid.NewGuid(), ActivityGroupId = kit.CommunityAccess.Id, ItemNumber = code, Description = code, DayType = dayType, IsIntensive = false,
        PriceLimit_VIC = 50m, PriceLimit_NSW = 60m, CatalogueVersion = "2026-27", EffectiveFrom = new DateOnly(2026, 7, 1), IsActive = true, PaceSupportCategoryNumber = category, SupportCategoryNumber = category,
    };

    private static async Task<PeriodLedger> Q2Of(LedgerKit kit, Participant person)
    {
        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct);
        return all[person.Id].Ledger!.Pools[0].Periods[1];
    }

    [Fact]
    public async Task WhenTheWeekdayAndTheEveningRowsAreBothMissing_EachTripDayIsCountedOnce()
    {
        // Only Saturday has a row. Mon 9 to Wed 11 Nov 2026 is three weekdays, and a 19:00 departure puts evening hours on the first day: both pieces are unpriced on it.
        using var kit = ArrangeWith(k => { k.Db.SupportCatalogueItems.Add(Row(k, "04_Saturday_STD", ClaimDayType.Saturday, 4)); k.Db.SaveChanges(); });
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters());
        var trip = kit.SeedTrip(new DateOnly(2026, 11, 9), 3);
        trip.DepartureTime = new TimeOnly(19, 0);
        kit.Db.SaveChanges();
        kit.SeedBooking(trip, person);

        var q2 = await Q2Of(kit, person);

        var item = Assert.Single(q2.Items);
        Assert.Equal(3, item.UnpricedTripDayCount);     // it was 6: the first day twice
        Assert.Equal(3, q2.UnpricedTripDayCount);
        Assert.Equal(0m, q2.BookedAhead);
    }

    [Fact]
    public async Task WhenOnlyTheEveningRowIsMissing_OnlyTheDaysTheEveningHoursFallOnAreCounted()
    {
        // Mon 9 to Fri 13 Nov 2026: depart 14:00 (the 8 active hours run to 22:00, so 2 h of day one are evening) and return 21:30 (1.5 h of the last day). The weekday row is there.
        using var kit = ArrangeWith(k => k.SeedCommunityAccessCatalogue());
        kit.Db.SupportCatalogueItems.RemoveRange(kit.Db.SupportCatalogueItems.Where(i => i.DayType == ClaimDayType.WeekdayEvening).ToList());
        kit.Db.SaveChanges();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters());
        var trip = kit.SeedTrip(new DateOnly(2026, 11, 9), 5);
        trip.DepartureTime = new TimeOnly(14, 0);
        trip.ReturnTime = new TimeOnly(21, 30);
        kit.Db.SaveChanges();
        kit.SeedBooking(trip, person);

        var q2 = await Q2Of(kit, person);

        var item = Assert.Single(q2.Items);
        Assert.Equal(2, item.UnpricedTripDayCount);     // day one and the last day, not all five
        Assert.Equal(2, q2.UnpricedTripDayCount);
        Assert.Contains("13 Nov 2026", item.Note);      // the note names the days the evening hours are on...
        Assert.DoesNotContain("10 Nov", item.Note);     // ...and not the stretch between them
        Assert.DoesNotContain("11 Nov", item.Note);
        Assert.DoesNotContain("12 Nov", item.Note);
        Assert.Equal(36.5m * 60m, item.Amount);         // the weekday hours still price: 40 h of active time less the 3.5 h of evening
    }

    [Fact]
    public async Task ABookingWhosePriceIsSplitAcrossTwoCategories_CountsItsUnpricedDaysOnce()
    {
        // Friday is priced: its daytime hours under category 4, its 2 evening hours under category 1. Saturday and Sunday have no row: two unpriced days.
        using var kit = ArrangeWith(k =>
        {
            k.Db.SupportCatalogueItems.Add(Row(k, "04_Weekday_STD", ClaimDayType.Weekday, 4));
            k.Db.SupportCatalogueItems.Add(Row(k, "01_Evening_STD", ClaimDayType.WeekdayEvening, 1));
            k.Db.SaveChanges();
        });
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters());
        var trip = kit.SeedTrip(new DateOnly(2026, 11, 6), 3);
        trip.DepartureTime = new TimeOnly(14, 0);
        kit.Db.SaveChanges();
        kit.SeedBooking(trip, person);

        var q2 = await Q2Of(kit, person);

        Assert.Equal(2, q2.Items.Count);                                             // one item for each category the booking is priced in
        Assert.Equal(2, q2.Items.Sum(i => i.UnpricedTripDayCount));                  // the two days once, not once on each part (it was 4)
        Assert.Equal(2, q2.UnpricedTripDayCount);
    }

    // ── The dates a note names (the 2026-10-08 review, L5-03) ───────────────

    private static async Task<string?> NoteOfAWeekdayGapIn(DateOnly start, int days)
    {
        // Only the weekend has a rate, so every weekday of the trip is unpriced and the note has to say which dates.
        using var kit = ArrangeWith(k =>
        {
            k.Db.SupportCatalogueItems.Add(Row(k, "04_Saturday_STD", ClaimDayType.Saturday, 4));
            k.Db.SupportCatalogueItems.Add(Row(k, "04_Sunday_STD", ClaimDayType.Sunday, 4));
            k.Db.SaveChanges();
        });
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, CoreQuarters());
        kit.SeedBooking(kit.SeedTrip(start, days), person);
        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct);
        return Assert.Single(all[person.Id].Items).Note;
    }

    [Fact]
    public async Task ASpanAcrossAMonthEndNamesBothMonths_NotJustTheFirstDaysNumber()
    {
        // Sat 28 Nov to Wed 2 Dec 2026: the weekdays that cannot be priced are 30 Nov, 1 Dec and 2 Dec. It used to read "30 to 02 Dec 2026", which is 30 December to 2 December.
        var note = await NoteOfAWeekdayGapIn(new DateOnly(2026, 11, 28), 5);

        Assert.Equal("No catalogue rate covers weekday 30 Nov to 2 Dec 2026 (24 h), so that part of the trip is counted as $0.", note);
    }

    [Fact]
    public async Task ASpanAcrossAYearEndNamesBothYears()
    {
        // Sat 26 Dec 2026 to Sat 2 Jan 2027: the weekdays are Mon 28 Dec to Fri 1 Jan.
        var note = await NoteOfAWeekdayGapIn(new DateOnly(2026, 12, 26), 8);

        Assert.Contains("weekday 28 Dec 2026 to 1 Jan 2027 (40 h)", note);
    }

    [Fact]
    public async Task ASpanInsideOneMonthStillNamesTheMonthOnce_AndASingleDayItsDate()
    {
        // Fri 6 to Tue 10 Nov 2026: Friday on its own, then Monday and Tuesday after the weekend.
        var note = await NoteOfAWeekdayGapIn(new DateOnly(2026, 11, 6), 5);

        Assert.Contains("weekday 6 Nov 2026", note);
        Assert.Contains("weekday 9 to 10 Nov 2026", note);
        Assert.DoesNotContain("06 Nov", note);   // a day number is written as a person writes it
    }

    [Fact]
    public void TheEstimatorNamesTheEveningHoursOwnDays_NotTheWholeStretch()
    {
        using var kit = ArrangeWith(k => k.SeedCommunityAccessCatalogue());
        var items = kit.Db.SupportCatalogueItems.Where(i => i.DayType != ClaimDayType.WeekdayEvening).ToList();
        var days = Enumerable.Range(0, 5).Select(i => new TripPricingDay(new DateOnly(2026, 11, 9).AddDays(i), false)).ToList();   // Mon 9 to Fri 13 Nov
        var trip = new TripPricingInput(new DateOnly(2026, 11, 9), 5, days, new TimeOnly(14, 0), new TimeOnly(21, 30), 8m);

        var price = new TripPriceEstimator(trip, items, new HashSet<DateOnly>(), "NSW").Price(isIntensive: false);

        Assert.Equal(new[] { ClaimDayType.WeekdayEvening }, price.UnpricedDayTypes);
        Assert.Equal(
            new[] { (ClaimDayType.WeekdayEvening, new DateOnly(2026, 11, 9), new DateOnly(2026, 11, 9), 1, 2m), (ClaimDayType.WeekdayEvening, new DateOnly(2026, 11, 13), new DateOnly(2026, 11, 13), 1, 1.5m) },
            price.UnpricedDays.Select(d => (d.DayType, d.From, d.To, d.DayCount, d.Hours)));
    }
}
