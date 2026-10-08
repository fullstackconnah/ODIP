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
/// The holiday override rows in a claim and in the budget (the 2026-10-08 review, L3-01 and L3-05). The synced feed misses days (Boxing Day 2026 for NSW among them), so the maintained
/// <c>PublicHolidayOverrides</c> table holds them, and the plan quote read it. The two claim engines, the budget ledger and the roster read the synced rows only, so the same day was a public
/// holiday on the agreement and an ordinary Saturday everywhere else (an eight-hour shift: quote 1,307.68, claim 828.32). Now all of them read both tables through one loader, with the state
/// matched in any case. A PART-day override row (SA and NT from 19:00 on Christmas Eve, QLD from 18:00) has no meaning in a claim that prices a whole shift at one day type, so it stays
/// quote-only. Prices here: the organisation is in NSW, so community access is $60 an hour on a weekday, $84 on a Saturday and $132 on a public holiday.
/// </summary>
public class HolidayOverridesInClaimsTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly BoxingDay = new(2026, 12, 26);   // a Saturday; the synced feed has no row for it

    private static (LedgerKit Kit, Participant Person) Arrange(string? addressState = null)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant(addressState: addressState);
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m), Q(3, 100000m), Q(4, 100000m)));
        return (kit, person);
    }

    private static void SeedOverride(LedgerKit kit, DateOnly date, string? state, string name = "Boxing Day", TimeOnly? from = null, TimeOnly? to = null)
    {
        kit.Db.PublicHolidayOverrides.Add(new PublicHolidayOverride { Id = Guid.NewGuid(), Date = date, State = state, Name = name, StartTime = from, EndTime = to, Source = "NDIS-CODES 5.3" });
        kit.Db.SaveChanges();
    }

    private static async Task<PeriodLedger> Q2Of(LedgerKit kit, Participant person)
    {
        var all = await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct);
        return all[person.Id].Ledger!.Pools[0].Periods[1];
    }

    // ── 26 December 2026, NSW ───────────────────────────────────────────────

    [Fact]
    public async Task AShiftOnBoxingDayIsClaimedAsAPublicHoliday_AndTheLedgerEstimatesTheSame()
    {
        var (kit, person) = Arrange();
        SeedOverride(kit, BoxingDay, "NSW");
        var shift = kit.SeedShift(person, BoxingDay, ShiftStatus.Completed);   // 09:00-17:00, eight hours

        var preview = await new ShiftClaimGenerationService(kit.Db).PreviewAsync(person.Id, BoxingDay, BoxingDay, Ct);
        var q2 = await Q2Of(kit, person);

        var line = Assert.Single(preview.LineItems);
        Assert.Equal((ClaimDayType.PublicHoliday, 132m, 1056m), (line.DayType, line.UnitPrice, line.TotalAmount));   // not the Saturday rate: $84 an hour, $672
        Assert.Equal(1056m, q2.Items.Single(i => i.ShiftId == shift.Id).Amount);                                      // the estimate is the claim
        Assert.Equal(preview.TotalAmount, q2.Pending);
    }

    [Fact]
    public async Task ATripDayOnBoxingDayIsClaimedAsAPublicHoliday_AndTheLedgersBookedAheadEstimateIsTheSame()
    {
        var (kit, person) = Arrange();
        SeedOverride(kit, BoxingDay, "NSW");
        var trip = kit.SeedTrip(BoxingDay, 1);
        kit.SeedBooking(trip, person);

        var preview = await new ClaimGenerationService(kit.Db).PreviewClaimAsync(trip.Id, null, Ct);
        var q2 = await Q2Of(kit, person);

        var line = Assert.Single(preview.LineItems);
        Assert.Equal((ClaimDayType.PublicHoliday, 1056m), (line.DayType, line.TotalAmount));
        Assert.Equal(1056m, Assert.Single(q2.Items).Amount);
        Assert.Equal(1056m, q2.BookedAhead);
    }

    [Fact]
    public async Task AnOverrideForAnotherStateOrForNobodyElseChangesNothingHere()
    {
        var (kit, person) = Arrange();
        SeedOverride(kit, BoxingDay, "SA");                 // a South Australian holiday: an ordinary Saturday in NSW
        kit.SeedShift(person, BoxingDay, ShiftStatus.Completed);

        var preview = await new ShiftClaimGenerationService(kit.Db).PreviewAsync(person.Id, BoxingDay, BoxingDay, Ct);

        Assert.Equal(ClaimDayType.Saturday, Assert.Single(preview.LineItems).DayType);
    }

    [Fact]
    public async Task ANationalOverrideRowAppliesInEveryState()
    {
        var (kit, person) = Arrange();
        SeedOverride(kit, BoxingDay, null, "National day");
        kit.SeedShift(person, BoxingDay, ShiftStatus.Completed);

        var preview = await new ShiftClaimGenerationService(kit.Db).PreviewAsync(person.Id, BoxingDay, BoxingDay, Ct);

        Assert.Equal(ClaimDayType.PublicHoliday, Assert.Single(preview.LineItems).DayType);
    }

    // ── Part-day rows stay quote-only ───────────────────────────────────────

    [Fact]
    public async Task APartDayOverrideRowIsNotAWholeDayHolidayInAClaimOrTheLedger()
    {
        // NSW has no part-day rows, but the rule is the table's: a row with a start or an end is a part of the day, and a claim prices a whole shift at one day type.
        var (kit, person) = Arrange();
        var christmasEve = new DateOnly(2026, 12, 24);       // a Thursday
        SeedOverride(kit, christmasEve, "NSW", "Christmas Eve (evening)", from: new TimeOnly(18, 0));
        kit.SeedShift(person, christmasEve, ShiftStatus.Completed);

        var preview = await new ShiftClaimGenerationService(kit.Db).PreviewAsync(person.Id, christmasEve, christmasEve, Ct);
        var q2 = await Q2Of(kit, person);

        Assert.Equal(ClaimDayType.Weekday, Assert.Single(preview.LineItems).DayType);
        Assert.Equal(480m, q2.Pending);
    }

    // ── The state in any case (L3-05) ───────────────────────────────────────

    [Theory]
    [InlineData("nsw")]
    [InlineData(" Nsw ")]
    public async Task AnOverrideRowWrittenInAnotherCaseIsStillFound(string written)
    {
        var (kit, person) = Arrange(addressState: "Nsw");
        SeedOverride(kit, BoxingDay, written);
        kit.SeedShift(person, BoxingDay, ShiftStatus.Completed);

        var preview = await new ShiftClaimGenerationService(kit.Db).PreviewAsync(person.Id, BoxingDay, BoxingDay, Ct);
        var q2 = await Q2Of(kit, person);

        Assert.Equal(ClaimDayType.PublicHoliday, Assert.Single(preview.LineItems).DayType);
        Assert.Equal(1056m, q2.Pending);
    }

    [Fact]
    public async Task AFeedRowWrittenInLowerCaseIsFoundByTheClaimEngines()
    {
        // The claim engines' SQL compared the state exactly, so a row written "nsw" was never read even though the code says any case works.
        var (kit, person) = Arrange();
        kit.Db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 10, 5), Name = "Labour Day", State = "nsw" });
        kit.Db.SaveChanges();
        kit.SeedShift(person, new DateOnly(2026, 10, 5), ShiftStatus.Completed);
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 5), 1);
        kit.SeedBooking(trip, person);

        var shifts = await new ShiftClaimGenerationService(kit.Db).PreviewAsync(person.Id, new DateOnly(2026, 10, 5), new DateOnly(2026, 10, 5), Ct);
        var trips = await new ClaimGenerationService(kit.Db).PreviewClaimAsync(trip.Id, null, Ct);

        Assert.Equal(ClaimDayType.PublicHoliday, Assert.Single(shifts.LineItems).DayType);
        Assert.Equal(ClaimDayType.PublicHoliday, Assert.Single(trips.LineItems).DayType);
    }
}
