using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// What a batch of shifts, or one confirmed trip booking, does to a budget (budget phase 3), as warnings: one for each pool and period the action puts money into whose forecast is then above what is available.
/// Fixed clock: 4 Oct 2026, a Sunday. NSW weekday support is $60 an hour, so an 8-hour shift is $480; the October to December period holds $1,000 and January to March $5,000.
/// </summary>
public class ShiftBudgetEffectTests : IDisposable
{
    private readonly LedgerKit _kit = LedgerKit.Create();

    public void Dispose() => _kit.Dispose();

    private Participant Seed(decimal october = 1000m, decimal january = 5000m, bool withCatalogue = true)
    {
        _kit.SeedProvider("NSW");
        if (withCatalogue) _kit.SeedCommunityAccessCatalogue();
        var participant = _kit.SeedParticipant();
        _kit.SeedPlan(participant, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, october), LedgerKit.Q(3, january)));
        return participant;
    }

    private ShiftBudgetEffect Effect(IShiftCostSource? costs = null) => new(_kit.Db, _kit.Ledger, costs);

    private static PlannedShift Day(DateOnly date, Guid? id = null, int endHour = 17) => new(id, date, new TimeOnly(9, 0), new TimeOnly(endHour, 0), false, SupportRatio.OneToOne, SleepoverType.None);

    /// <summary>Eight weekdays from Monday 12 Oct 2026: $3,840 in the October quarter.</summary>
    private static List<PlannedShift> EightWeekdays() =>
        new[] { 12, 13, 14, 15, 16, 19, 20, 21 }.Select(d => Day(new DateOnly(2026, 10, d))).ToList();

    // ── Shifts ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task ShiftsThatTakeAPoolPastItsFunding_GiveOneWarningForThePeriod_WithTheFigures()
    {
        var participant = Seed(october: 1000m);

        var warnings = await Effect().ForShiftsAsync(_kit.TenantId, participant.Id, EightWeekdays(), default);

        var warning = Assert.Single(warnings);
        Assert.Equal(("Core (flexible)", new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 31)), (warning.PoolName, warning.PeriodStart, warning.PeriodEnd));
        Assert.Equal((1000m, 0m, 3840m, 3840m, 2840m, 8), (warning.Available, warning.Used, warning.Forecast, warning.Added, warning.OverBy, warning.Count));
        Assert.Equal("These 8 shifts take Core (flexible) to $3,840.00 of $1,000.00 for 1 Oct\u00A0\u2013\u2060\u00A031 Dec 2026, $2,840.00 over.", warning.Message);
    }

    [Fact]
    public async Task OneShift_ReadsAsThisShift()
    {
        var participant = Seed(october: 100m);

        var warning = Assert.Single(await Effect().ForShiftsAsync(_kit.TenantId, participant.Id, new[] { Day(new DateOnly(2026, 10, 12)) }, default));

        Assert.Equal("This shift takes Core (flexible) to $480.00 of $100.00 for 1 Oct\u00A0\u2013\u2060\u00A031 Dec 2026, $380.00 over.", warning.Message);
    }

    [Fact]
    public async Task ShiftsWithinTheFunding_GiveNoWarning()
    {
        var participant = Seed(october: 5000m);

        Assert.Empty(await Effect().ForShiftsAsync(_kit.TenantId, participant.Id, EightWeekdays(), default));
    }

    [Fact]
    public async Task ShiftsAcrossTwoPeriods_WarnOnlyForThePeriodThatGoesOver()
    {
        var participant = Seed(october: 500m, january: 5000m);
        var planned = new List<PlannedShift> { Day(new DateOnly(2026, 10, 12)), Day(new DateOnly(2026, 10, 13)), Day(new DateOnly(2027, 1, 11)) };

        var warning = Assert.Single(await Effect().ForShiftsAsync(_kit.TenantId, participant.Id, planned, default));

        Assert.Equal((new DateOnly(2026, 10, 1), 2, 960m), (warning.PeriodStart, warning.Count, warning.Forecast));
    }

    [Fact]
    public async Task WhatIsAlreadyBooked_CountsWithTheNewShifts()
    {
        var participant = Seed(october: 1000m);
        _kit.SeedShift(participant, new DateOnly(2026, 10, 12));   // $480 already booked

        var warning = Assert.Single(await Effect().ForShiftsAsync(_kit.TenantId, participant.Id, new[] { Day(new DateOnly(2026, 10, 13)), Day(new DateOnly(2026, 10, 14)) }, default));

        Assert.Equal((1440m, 960m), (warning.Forecast, warning.Added));
    }

    [Fact]
    public async Task ShiftsAlreadySaved_AreNotCountedTwice_WhenTheirIdsAreGiven()
    {
        var participant = Seed(october: 1000m);
        var first = _kit.SeedShift(participant, new DateOnly(2026, 10, 12));
        var second = _kit.SeedShift(participant, new DateOnly(2026, 10, 13));
        var third = _kit.SeedShift(participant, new DateOnly(2026, 10, 14));   // all three are in the ledger: $1,440

        var warning = Assert.Single(await Effect().ForShiftsAsync(_kit.TenantId, participant.Id,
            new[] { Day(first.ServiceDate, first.Id), Day(second.ServiceDate, second.Id), Day(third.ServiceDate, third.Id) }, default));

        Assert.Equal((1440m, 1440m, 3), (warning.Forecast, warning.Added, warning.Count));   // the ledger's $1,440, not $2,880
    }

    [Fact]
    public async Task AParticipantWithNoPlan_OrShiftsOutsideItsDatesOrInNoPool_GiveNoWarning()
    {
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        var noPlan = _kit.SeedParticipant();
        var statedOnly = _kit.SeedParticipant();
        _kit.SeedPlan(statedOnly, LedgerKit.Stated(15, PlanType.PlanManaged, LedgerKit.Q(2, 10m)));
        var outside = _kit.SeedParticipant();
        _kit.SeedPlan(outside, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 10m)));

        Assert.Empty(await Effect().ForShiftsAsync(_kit.TenantId, noPlan.Id, EightWeekdays(), default));
        Assert.Empty(await Effect().ForShiftsAsync(_kit.TenantId, statedOnly.Id, EightWeekdays(), default));
        Assert.Empty(await Effect().ForShiftsAsync(_kit.TenantId, outside.Id, new[] { Day(new DateOnly(2027, 8, 2)) }, default));
    }

    [Fact]
    public async Task ShiftsTheEstimatorCannotPrice_AreNotCounted_AndSayNothing()
    {
        var participant = Seed(october: 1m);
        var stub = new Mock<IShiftCostSource>();
        stub.Setup(s => s.EstimateAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<IReadOnlyList<ShiftSpec>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid _, Guid _, IReadOnlyList<ShiftSpec> specs, CancellationToken _) =>
                specs.Select((_, i) => i % 2 == 0 ? (ShiftCostEstimate)new ShiftCostEstimate.NotPriced("unpriced") : new ShiftCostEstimate.Priced(480m, 4)).ToList());

        var warning = Assert.Single(await Effect(stub.Object).ForShiftsAsync(_kit.TenantId, participant.Id, EightWeekdays(), default));

        Assert.Equal((4, 1920m), (warning.Count, warning.Added));   // only the four that could be priced
        stub.Setup(s => s.EstimateAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<IReadOnlyList<ShiftSpec>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid _, Guid _, IReadOnlyList<ShiftSpec> specs, CancellationToken _) => specs.Select(_ => (ShiftCostEstimate)new ShiftCostEstimate.NotPriced("unpriced")).ToList());
        Assert.Empty(await Effect(stub.Object).ForShiftsAsync(_kit.TenantId, participant.Id, EightWeekdays(), default));
    }

    [Fact]
    public async Task HardLimitMakesNoDifference_NothingHereIsEverBlocked()
    {
        var participant = Seed(october: 1000m);
        _kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = _kit.TenantId, Mode = BudgetLimitMode.HardLimit });
        _kit.Db.SaveChanges();

        var warnings = await Effect().ForShiftsAsync(_kit.TenantId, participant.Id, EightWeekdays(), default);

        Assert.Single(warnings);
    }

    [Fact]
    public async Task AnotherOrganisationsParticipant_GivesNothing()
    {
        var database = Guid.NewGuid().ToString();
        using var a = LedgerKit.Create(LedgerKit.TenantA, database);
        using var b = LedgerKit.Create(LedgerKit.TenantB, database);
        a.SeedProvider("NSW");
        a.SeedCommunityAccessCatalogue();
        var theirs = a.SeedParticipant();
        a.SeedPlan(theirs, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 100m)));

        var asB = await new ShiftBudgetEffect(b.Db, b.Ledger).ForShiftsAsync(LedgerKit.TenantB, theirs.Id, EightWeekdays(), default);
        var asA = await new ShiftBudgetEffect(a.Db, a.Ledger).ForShiftsAsync(LedgerKit.TenantA, theirs.Id, EightWeekdays(), default);

        Assert.Empty(asB);
        Assert.Single(asA);
    }

    // ── A confirmed trip booking ────────────────────────────────────────────

    [Fact]
    public async Task AConfirmedBookingThatTakesThePoolPastItsFunding_GivesAWarning_ReadFromTheLedger()
    {
        var participant = Seed(october: 1000m);
        var trip = _kit.SeedTrip(new DateOnly(2026, 10, 20), 3);   // three days at 8 active hours: $1,440
        var booking = _kit.SeedBooking(trip, participant);

        var warning = Assert.Single(await Effect().ForBookingAsync(_kit.TenantId, participant.Id, booking.Id, default));

        Assert.Equal("This booking takes Core (flexible) to $1,440.00 of $1,000.00 for 1 Oct\u00A0\u2013\u2060\u00A031 Dec 2026, $440.00 over.", warning.Message);
        Assert.Equal((1440m, 1, 440m), (warning.Added, warning.Count, warning.OverBy));
        Assert.Equal("Sophie Brown", warning.ParticipantName);   // the bulk confirm of several participants says whose pool each line is about (the phase 3 review, C5)
    }

    [Fact]
    public async Task ABookingWithinTheFunding_OrNotConfirmed_OrAlreadyUnderWay_OrWithNothingToPrice_GivesNoWarning()
    {
        var roomy = Seed(october: 5000m);
        var small = _kit.SeedBooking(_kit.SeedTrip(new DateOnly(2026, 10, 20), 1), roomy);
        Assert.Empty(await Effect().ForBookingAsync(_kit.TenantId, roomy.Id, small.Id, default));

        var tight = _kit.SeedParticipant();
        _kit.SeedPlan(tight, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 100m)));
        var held = _kit.SeedBooking(_kit.SeedTrip(new DateOnly(2026, 10, 20), 3), tight, BookingStatus.Held);
        var past = _kit.SeedBooking(_kit.SeedTrip(new DateOnly(2026, 9, 28), 3), tight);   // already under way: not booked ahead
        Assert.Empty(await Effect().ForBookingAsync(_kit.TenantId, tight.Id, held.Id, default));
        Assert.Empty(await Effect().ForBookingAsync(_kit.TenantId, tight.Id, past.Id, default));

        var noNumber = _kit.SeedParticipant(ndisNumber: null);
        _kit.SeedPlan(noNumber, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, 100m)));
        var unpriced = _kit.SeedBooking(_kit.SeedTrip(new DateOnly(2026, 10, 20), 3), noNumber);   // no NDIS number: the trip claim will not include it, so it adds $0
        Assert.Empty(await Effect().ForBookingAsync(_kit.TenantId, noNumber.Id, unpriced.Id, default));
    }
}
