using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// Shifts the shift claim cannot price (round 1b of the 2026-10-08 fix, review F1). The interim guard gives a sleepover, a passive night, a group or shared shift, and a shift no catalogue rate
/// covers, no price: the ledger counts them as $0, so Used, Forecast, the status and the plan total all leave them out, and the only trace used to be a note on each shift's own row. Trips
/// have a counted figure and a sentence for exactly this; shifts now have the same: every period and every pool counts the shifts it leaves out, and the period names why. The organisation is
/// in NSW (an eight-hour weekday is $480) and the fixed clock is Sunday 4 Oct 2026.
/// </summary>
public class UnpricedShiftCountTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static (LedgerKit Kit, Participant Person) Arrange()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 100000m), Q(2, 100000m), Q(3, 100000m), Q(4, 100000m)));
        return (kit, person);
    }

    private static Shift Seed(
        LedgerKit kit, Participant person, DateOnly date, ShiftStatus status = ShiftStatus.Completed, SupportRatio ratio = SupportRatio.OneToOne, SleepoverType night = SleepoverType.None,
        int start = 9, int end = 17, bool overnight = false)
    {
        var shift = kit.SeedShift(person, date, status, start, end, overnight);
        shift.Ratio = ratio;
        shift.NightType = night;
        kit.Db.SaveChanges();
        return shift;
    }

    private static async Task<ParticipantLedgerDto> LedgerOf(LedgerKit kit, Participant person) => (await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, Ct))!;

    [Fact]
    public async Task EveryShiftTheClaimCannotPriceIsCountedAndNamedByItsReason_InThePeriodAndThePool()
    {
        var (kit, person) = Arrange();
        Seed(kit, person, new DateOnly(2026, 10, 1));                                                                              // priced: $480
        Seed(kit, person, new DateOnly(2026, 10, 2), night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);          // a sleepover
        Seed(kit, person, new DateOnly(2026, 10, 3), ratio: SupportRatio.OneToThree, start: 9, end: 15);                           // a 1:3 group shift
        Seed(kit, person, new DateOnly(2026, 10, 6), night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);          // a second sleepover: one reason, two shifts

        var ledger = await LedgerOf(kit, person);

        var q2 = ledger.Pools[0].Periods[1];
        Assert.Equal(3, q2.UnpricedShiftCount);
        Assert.Equal(new[] { "a 1:3 group shift", "a sleepover" }, q2.UnpricedShiftReasons);   // each reason once, in a fixed order
        Assert.Equal(3, ledger.Pools[0].UnpricedShiftCount);
        Assert.Equal(480m, q2.Pending);                                                      // and the money is what could be priced: the count is what says the figure is low
    }

    [Fact]
    public async Task ABookedAheadShiftIsCountedToo_InItsOwnPeriodOnly()
    {
        var (kit, person) = Arrange();
        Seed(kit, person, new DateOnly(2026, 10, 20), ShiftStatus.Published, ratio: SupportRatio.OneToTwo);
        Seed(kit, person, new DateOnly(2027, 1, 12), ShiftStatus.Published, ratio: SupportRatio.OneToFour);

        var ledger = await LedgerOf(kit, person);

        var periods = ledger.Pools[0].Periods;
        Assert.Equal(new[] { 0, 1, 1, 0 }, periods.Select(p => p.UnpricedShiftCount));
        Assert.Equal(new[] { "a 1:2 group shift" }, periods[1].UnpricedShiftReasons);
        Assert.Equal(new[] { "a 1:4 group shift" }, periods[2].UnpricedShiftReasons);
        Assert.Equal(2, ledger.Pools[0].UnpricedShiftCount);
        Assert.Empty(periods[0].UnpricedShiftReasons);
    }

    [Fact]
    public async Task AShiftThatIsBothAGroupShiftAndASleepoverCountsOnce_AndNamesBoth()
    {
        var (kit, person) = Arrange();
        Seed(kit, person, new DateOnly(2026, 10, 2), ratio: SupportRatio.OneToThree, night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);

        var q2 = (await LedgerOf(kit, person)).Pools[0].Periods[1];

        Assert.Equal(1, q2.UnpricedShiftCount);
        Assert.Equal(new[] { "a 1:3 group shift", "a sleepover" }, q2.UnpricedShiftReasons);
    }

    [Fact]
    public async Task AShiftNoCatalogueRateCoversIsCountedToo()
    {
        var (kit, person) = Arrange();
        kit.Db.SupportCatalogueItems.RemoveRange(kit.Db.SupportCatalogueItems.Where(i => i.DayType == ClaimDayType.Saturday).ToList());
        kit.Db.SaveChanges();
        Seed(kit, person, new DateOnly(2026, 10, 3));   // a Saturday, with no Saturday rate

        var q2 = (await LedgerOf(kit, person)).Pools[0].Periods[1];

        Assert.Equal(1, q2.UnpricedShiftCount);
        Assert.Equal(new[] { "no catalogue rate for the date" }, q2.UnpricedShiftReasons);
    }

    [Fact]
    public async Task PricedShiftsAreNotCounted_EvenTheOnesTheEstimatorQualifies()
    {
        var (kit, person) = Arrange();
        Seed(kit, person, new DateOnly(2026, 10, 1));                                                                                // plain
        Seed(kit, person, new DateOnly(2026, 10, 5), ratio: SupportRatio.TwoToOne);                                                  // two-to-one: priced
        Seed(kit, person, new DateOnly(2026, 10, 6), night: SleepoverType.ActiveNight, start: 18, end: 2, overnight: true);          // an active night: priced and flagged

        var ledger = await LedgerOf(kit, person);

        var q2 = ledger.Pools[0].Periods[1];
        Assert.Equal(0, q2.UnpricedShiftCount);
        Assert.Empty(q2.UnpricedShiftReasons);
        Assert.Equal(0, ledger.Pools[0].UnpricedShiftCount);
        Assert.Equal(1440m, q2.Pending);
    }

    [Fact]
    public async Task ThePoolCountsEveryPeriodsShiftsAndAShiftOutsideThePlanIsInNoPeriodsCount()
    {
        var (kit, person) = Arrange();
        Seed(kit, person, new DateOnly(2026, 9, 28), night: SleepoverType.Sleepover, start: 22, end: 6, overnight: true);             // the first quarter
        Seed(kit, person, new DateOnly(2026, 10, 2), night: SleepoverType.PassiveNight, start: 22, end: 6, overnight: true);          // the second
        Seed(kit, person, new DateOnly(2027, 7, 5), ShiftStatus.Published, ratio: SupportRatio.OneToThree);                           // after the plan ends: "Outside the plan dates"

        var ledger = await LedgerOf(kit, person);

        Assert.Equal(new[] { 1, 1, 0, 0 }, ledger.Pools[0].Periods.Select(p => p.UnpricedShiftCount));
        Assert.Equal(2, ledger.Pools[0].UnpricedShiftCount);
        Assert.Equal(1, ledger.OutsideThePlanDates.Count);   // it is in the bucket, shown and not dropped, and not in any pool's figures
    }

    [Fact]
    public async Task APartlyPricedTripIsNotAShift()
    {
        var (kit, person) = Arrange();
        kit.Db.SupportCatalogueItems.RemoveRange(kit.Db.SupportCatalogueItems.Where(i => i.DayType == ClaimDayType.Sunday).ToList());
        kit.Db.SaveChanges();
        kit.SeedBooking(kit.SeedTrip(new DateOnly(2026, 10, 23), 3), person);   // Fri, Sat, Sun: the Sunday has no rate

        var q2 = (await LedgerOf(kit, person)).Pools[0].Periods[1];

        Assert.Equal(1, q2.UnpricedTripDayCount);   // trips have their own count...
        Assert.Equal(0, q2.UnpricedShiftCount);     // ...and this one is for shifts only
    }
}
