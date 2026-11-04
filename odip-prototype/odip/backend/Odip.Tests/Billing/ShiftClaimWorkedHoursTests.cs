using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;

namespace Odip.Tests.Billing;

/// <summary>
/// W2 PR3: a shift claim bills the hours worked (the Employment Hero pay window). Extra time over 5 minutes is claimed only once a coordinator approves it; while it is Pending or Declined that side is claimed at
/// rostered hours. Rostered 09:00-17:00 Sydney on Mon 7 Sep 2026 (AEST, UTC+10) at $50/h unless a test says otherwise.
/// </summary>
public class ShiftClaimWorkedHoursTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private static readonly DateOnly Day = new(2026, 9, 7);
    private static readonly TimeZoneInfo Sydney = TimeZoneInfo.FindSystemTimeZoneById("Australia/Sydney");

    /// <summary>A Sydney wall time on <see cref="Day"/> (plus <paramref name="dayOffset"/> days) as the UTC instant the completion stores.</summary>
    private static DateTime Utc(int hour, int minute, int dayOffset = 0) =>
        TimeZoneInfo.ConvertTimeToUtc(Day.AddDays(dayOffset).ToDateTime(new TimeOnly(hour, minute)), Sydney);

    private static (LedgerKit Kit, ShiftClaimGenerationService Engine, Participant Person) NewKit(BudgetLimitMode? mode = null, bool withLedger = true, params PoolSpec[] pools)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("VIC").TimeZoneId = "Australia/Sydney";
        kit.EnsureCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        if (pools.Length > 0) kit.SeedPlan(person, pools);
        if (mode is { } m) kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = kit.TenantId, Mode = m });
        kit.Db.SaveChanges();
        return (kit, new ShiftClaimGenerationService(kit.Db, withLedger ? kit.Ledger : null, kit.Tenant), person);
    }

    /// <summary>A completed shift (9-17 unless given) with the worker's actual Sydney times, the variance the worker's clock gave and the coordinator's decision.</summary>
    private static Shift Worked(LedgerKit kit, Participant person, DateOnly date, (int H, int M) actualStart, (int H, int M) actualEnd, ExtraTimeDecision? decision, int varStart, int varEnd,
        int startHour = 9, int endHour = 17, SleepoverType night = SleepoverType.None, int endDayOffset = 0)
    {
        var shift = kit.SeedShift(person, date, ShiftStatus.Completed, startHour, endHour);
        shift.NightType = night;
        kit.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = kit.TenantId, ShiftId = shift.Id, ActualStart = Utc(actualStart.H, actualStart.M), ActualEnd = Utc(actualEnd.H, actualEnd.M, endDayOffset),
            VarianceMinutesStart = varStart, VarianceMinutesEnd = varEnd, ExtraTime = decision, TimeZoneId = "Australia/Sydney", SubmittedByUserId = Guid.NewGuid(), StartedAt = Utc(actualStart.H, actualStart.M), IsActive = true,
        });
        kit.Db.SaveChanges();
        return shift;
    }

    [Theory]
    [InlineData(ExtraTimeDecision.Approved, 8.67, 433.50)]   // 520 minutes: 8.6667 h, which the estimator's two-place rule makes 8.67
    [InlineData(ExtraTimeDecision.Pending, 8, 400)]
    [InlineData(ExtraTimeDecision.Declined, 8, 400)]
    [InlineData(null, 8, 400)]
    public async Task ExtraTime_IsClaimedOnlyOnceApproved(ExtraTimeDecision? decision, double hours, double total)
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        Worked(kit, person, Day, (8, 40), (17, 20), decision, -20, 20);

        var claim = (await engine.GenerateAsync(person.Id, Day, Day, Ct)).Claim;

        var line = Assert.Single(kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id));
        Assert.Equal((decimal)hours, line.Hours);
        Assert.Equal((decimal)total, line.TotalAmount);
    }

    [Fact]
    public async Task HeldExtraTime_PricesLikeRostered_OnTheEveningBand()
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        Worked(kit, person, Day, (14, 40), (23, 20), ExtraTimeDecision.Pending, -20, 20, startHour: 15, endHour: 23);

        var claim = (await engine.GenerateAsync(person.Id, Day, Day, Ct)).Claim;

        var lines = kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id).ToList();
        Assert.Equal(8m, lines.Sum(l => l.Hours));
        Assert.Equal(415m, claim.TotalAmount);   // 15:00-20:00 at $50 and 20:00-23:00 at $55, exactly the rostered price
    }

    [Fact]
    public async Task WithinFiveMinutes_IsClaimedAsWorked()
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        Worked(kit, person, Day, (8, 57), (17, 3), null, -3, 3);

        var claim = (await engine.GenerateAsync(person.Id, Day, Day, Ct)).Claim;

        Assert.Equal(8.1m, Assert.Single(kit.Db.ClaimLineItems.Where(l => l.TripClaimId == claim.Id)).Hours);   // 8 h 06 min
    }

    [Fact]
    public async Task UnpricedApprovedExtraTime_FallsBackToHeldHours_AndIsListedAsExtraTimeOnly()
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        // The extra 20 minutes run past midnight into the night band, which the test catalogue has no rate for.
        Worked(kit, person, Day, (15, 0), (0, 20), ExtraTimeDecision.Approved, 0, 80, startHour: 15, endHour: 23, endDayOffset: 1);

        var result = await engine.GenerateAsync(person.Id, Day, Day, Ct);

        Assert.Equal(8m, kit.Db.ClaimLineItems.Where(l => l.TripClaimId == result.Claim.Id).Sum(l => l.Hours));
        var left = Assert.Single(result.LeftOut);
        Assert.True(left.ExtraTimeOnly);
        Assert.Contains("Extra time 23:00–00:20 · 80 min", left.Description);
    }

    [Fact]
    public async Task PassiveNightAndSleepover_StayRostered()
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        var shift = kit.SeedShift(person, Day, ShiftStatus.Completed);
        foreach (var night in new[] { SleepoverType.PassiveNight, SleepoverType.Sleepover })
        {
            shift.NightType = night;
            var completion = new ShiftCompletion { ActualStart = Utc(8, 40), ActualEnd = Utc(17, 20), VarianceMinutesStart = -20, VarianceMinutesEnd = 20, ExtraTime = ExtraTimeDecision.Approved, TimeZoneId = "Australia/Sydney" };
            Assert.Equal(ShiftClaimWindow.Rostered(shift), ShiftClaimWindow.For(shift, completion, Sydney).Priced);
        }
        await Task.CompletedTask;
    }

    [Fact]
    public void ApprovedExtraTime_IsConvertedInTheEstimatorsZone_NotTheCompletions()
    {
        var shift = new Shift { ServiceDate = Day, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), NightType = SleepoverType.None };
        var completion = new ShiftCompletion { ActualStart = Utc(8, 40), ActualEnd = Utc(17, 20), VarianceMinutesStart = -20, VarianceMinutesEnd = 20, ExtraTime = ExtraTimeDecision.Approved, TimeZoneId = "Australia/Sydney" };

        var inSydney = ShiftClaimWindow.For(shift, completion, Sydney);
        var inBrisbane = ShiftClaimWindow.For(shift, completion, TimeZoneInfo.FindSystemTimeZoneById("Australia/Brisbane"));

        Assert.Equal(new TimeOnly(8, 40), inSydney.Priced.Start);
        Assert.Equal(new TimeOnly(9, 0), inSydney.WithoutExtra!.Start);
        Assert.Equal("Extra time 08:40–09:00, 17:00–17:20 · 40 min", inSydney.ExtraText);
        Assert.Equal(new TimeOnly(8, 40), inBrisbane.Priced.Start);   // no clock change in September: the same wall time
    }

    [Fact]
    public void ApprovedEarlyStartBeforeTheServiceDate_CannotBeClaimed_AndSaysWhy()
    {
        var shift = new Shift { ServiceDate = Day, StartTime = new TimeOnly(0, 0), EndTime = new TimeOnly(8, 0), NightType = SleepoverType.None };
        var completion = new ShiftCompletion { ActualStart = Utc(23, 40, -1), ActualEnd = Utc(8, 0), VarianceMinutesStart = -20, VarianceMinutesEnd = 0, ExtraTime = ExtraTimeDecision.Approved, TimeZoneId = "Australia/Sydney" };

        var window = ShiftClaimWindow.For(shift, completion, Sydney);

        Assert.NotNull(window.CannotClaimExtraBecause);
        Assert.Equal(new TimeOnly(0, 0), window.Priced.Start);
    }

    private static PoolSpec Q1(decimal amount) => LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(1, amount));

    [Fact]
    public async Task HardLimit_ExtraTimeOverBudget_ClaimsRostered_AndLeavesTheExtraOut()
    {
        var (kit, engine, person) = NewKit(BudgetLimitMode.HardLimit, true, Q1(420m));   // $400 rostered fits; $433.50 worked does not
        using var _ = kit;
        Worked(kit, person, Day, (8, 40), (17, 20), ExtraTimeDecision.Approved, -20, 20);

        var result = await engine.GenerateAsync(person.Id, Day, Day, Ct);

        Assert.Equal(8m, kit.Db.ClaimLineItems.Where(l => l.TripClaimId == result.Claim.Id).Sum(l => l.Hours));
        var left = Assert.Single(result.LeftOut);
        Assert.True(left.ExtraTimeOnly);
        Assert.Contains("over its budget (hard limit)", left.Reason);
    }

    [Fact]
    public async Task HardLimit_TwoShifts_TheEarlierExtraFits_TheLaterIsLeftOut()
    {
        var (kit, engine, person) = NewKit(BudgetLimitMode.HardLimit, true, Q1(840m));   // $800 rostered, $40 headroom, $33.50 of extra time each
        using var _ = kit;
        Worked(kit, person, Day, (8, 40), (17, 20), ExtraTimeDecision.Approved, -20, 20);
        Worked(kit, person, Day.AddDays(1), (8, 40), (17, 20), ExtraTimeDecision.Approved, -20, 20);

        var result = await engine.GenerateAsync(person.Id, Day, Day.AddDays(1), Ct);

        var lines = kit.Db.ClaimLineItems.Where(l => l.TripClaimId == result.Claim.Id).OrderBy(l => l.SupportsDeliveredFrom).ToList();
        Assert.Equal(new[] { 8.67m, 8m }, lines.Select(l => l.Hours));
        Assert.Equal(Day.AddDays(1), Assert.Single(result.LeftOut).ServiceDate);
    }

    [Fact]
    public async Task HardLimit_BookedAheadShiftsTakeTheHeadroom()
    {
        var (kit, engine, person) = NewKit(BudgetLimitMode.HardLimit, true, Q1(830m));   // 400 claimed shift + 400 booked ahead leaves $30 of headroom, under the $33.50
        using var _ = kit;
        Worked(kit, person, Day, (8, 40), (17, 20), ExtraTimeDecision.Approved, -20, 20);
        kit.SeedShift(person, new DateOnly(2026, 9, 25), ShiftStatus.Published);

        var result = await engine.GenerateAsync(person.Id, Day, Day, Ct);

        Assert.Equal(8m, kit.Db.ClaimLineItems.Where(l => l.TripClaimId == result.Claim.Id).Sum(l => l.Hours));
        Assert.True(Assert.Single(result.LeftOut).ExtraTimeOnly);
    }

    [Fact]
    public async Task WarnMode_ExtraTimeOverBudget_ClaimsTheWorkedHours()
    {
        var (kit, engine, person) = NewKit(BudgetLimitMode.Warn, true, Q1(420m));
        using var _ = kit;
        Worked(kit, person, Day, (8, 40), (17, 20), ExtraTimeDecision.Approved, -20, 20);

        var result = await engine.GenerateAsync(person.Id, Day, Day, Ct);

        Assert.Equal(8.67m, Assert.Single(kit.Db.ClaimLineItems.Where(l => l.TripClaimId == result.Claim.Id)).Hours);
        Assert.Empty(result.LeftOut);
    }

    [Fact]
    public async Task HardLimit_NoLedger_LeavesTheExtraOut()
    {
        var (kit, engine, person) = NewKit(BudgetLimitMode.HardLimit, false);
        using var _ = kit;
        Worked(kit, person, Day, (8, 40), (17, 20), ExtraTimeDecision.Approved, -20, 20);

        var result = await engine.GenerateAsync(person.Id, Day, Day, Ct);

        Assert.Equal(8m, Assert.Single(kit.Db.ClaimLineItems.Where(l => l.TripClaimId == result.Claim.Id)).Hours);
        Assert.Contains("budget could not be checked", Assert.Single(result.LeftOut).Reason);
    }

    [Fact]
    public async Task ApprovingAfterTheClaim_NeverBillsTheShiftAgain()
    {
        var (kit, engine, person) = NewKit();
        using var _ = kit;
        Worked(kit, person, Day, (8, 40), (17, 20), ExtraTimeDecision.Pending, -20, 20);
        await engine.GenerateAsync(person.Id, Day, Day, Ct);

        kit.Db.ShiftCompletions.Single().ExtraTime = ExtraTimeDecision.Approved;
        kit.Db.SaveChanges();

        await Assert.ThrowsAsync<InvalidOperationException>(() => engine.GenerateAsync(person.Id, Day, Day, Ct));
        Assert.Equal(1, kit.Db.ClaimLineItems.Count());
    }

    [Fact]
    public async Task TheLedgerCountsACompletedShiftAtItsClaimWindow()
    {
        var (kit, _, person) = NewKit(null, true, Q1(10000m));
        using var _ = kit;
        var approved = Worked(kit, person, Day, (8, 40), (17, 20), ExtraTimeDecision.Approved, -20, 20);
        Worked(kit, person, Day.AddDays(1), (8, 40), (17, 20), ExtraTimeDecision.Pending, -20, 20);

        var items = (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id].Items;

        Assert.Contains(items, i => i.ShiftId == approved.Id && i.Description.StartsWith("Shift 08:40–17:20 · 8.67 h"));
        Assert.Contains(items, i => i.ShiftId != approved.Id && i.Description.StartsWith("Shift 09:00–17:00 · 8 h"));
    }
}
