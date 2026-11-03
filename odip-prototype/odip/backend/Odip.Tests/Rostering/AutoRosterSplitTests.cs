using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;
using World = Odip.Tests.Rostering.AutoRosterPlannerTests.World;

namespace Odip.Tests.Rostering;

/// <summary>R7 auto-roster PR3 (D9): a shift nobody can work whole is split where one person's availability ends, when both parts are at least 2 hours.</summary>
public class AutoRosterSplitTests
{
    private static readonly DateOnly Monday = AutoRosterPlannerTests.Monday;

    /// <summary>The worker is marked unavailable from <paramref name="from"/> to <paramref name="to"/> o'clock on the shift's day (a legacy availability row: it makes them "away" for the overlap).</summary>
    private static void Unavailable(World w, AutoRosterWorker worker, Shift shift, double from, double to) => w.Db.StaffAvailabilities.Add(new StaffAvailability
    {
        Id = Guid.NewGuid(), UserId = worker.Id, AvailabilityType = AvailabilityType.Unavailable,
        StartDateTime = shift.ServiceDate.ToDateTime(TimeOnly.MinValue).AddHours(from), EndDateTime = shift.ServiceDate.ToDateTime(TimeOnly.MinValue).AddHours(to),
    });

    [Fact] // [D]
    public async Task SplitsAtTheEdgeOfAvailability_IntoTwoNamedWorkers()
    {
        await using var w = new World();
        var pat = w.Worker("Pat", 38);
        var quinn = w.Worker("Quinn", 38);
        var shift = w.Shift(1, 9, 17);
        Unavailable(w, pat, shift, 13, 17);      // Pat is free until 13:00
        Unavailable(w, quinn, shift, 9, 13);     // Quinn is free from 13:00

        var plan = await w.PlanAsync();

        var split = Assert.Single(plan.Splits);
        Assert.Equal(shift.Id, split.ShiftId);
        Assert.Equal(new TimeOnly(13, 0), split.CutAt);
        Assert.Equal(pat.Id, split.FirstStaffId);
        Assert.Equal(quinn.Id, split.SecondStaffId);
        Assert.Empty(plan.Uncovered);
        Assert.Empty(plan.Placements);
    }

    [Fact] // [D]
    public async Task ASegmentUnderTwoHours_IsNotProposed()
    {
        await using var w = new World();
        var pat = w.Worker("Pat", 38);
        var quinn = w.Worker("Quinn", 38);
        var shift = w.Shift(1, 9, 17);
        Unavailable(w, pat, shift, 10.5, 17);    // Pat is free only 09:00 to 10:30, 1 h 30 min
        Unavailable(w, quinn, shift, 9, 10.5);

        var plan = await w.PlanAsync();

        Assert.Empty(plan.Splits);
        Assert.Equal(shift.Id, Assert.Single(plan.Uncovered).ShiftId);
    }

    [Theory] // [D]
    [InlineData(true, SleepoverType.None)]
    [InlineData(false, SleepoverType.ActiveNight)]
    public async Task AnOvernightOrSleepoverShift_IsNeverSplit(bool endsNextDay, SleepoverType night)
    {
        await using var w = new World();
        var pat = w.Worker("Pat", 38);
        var quinn = w.Worker("Quinn", 38);
        var shift = w.Shift(1, 9, 17);
        shift.EndsNextDay = endsNextDay;
        if (endsNextDay) shift.EndTime = new TimeOnly(5, 0);   // 09:00 to 05:00 next day
        shift.NightType = night;
        Unavailable(w, pat, shift, 14, 24);
        Unavailable(w, quinn, shift, 0, 14);

        var plan = await w.PlanAsync();

        Assert.Empty(plan.Splits);
        Assert.Equal(shift.Id, Assert.Single(plan.Uncovered).ShiftId);
    }

    [Fact]
    public async Task AShiftForTwoSupportWorkers_IsNeverSplit()
    {
        await using var w = new World();
        var pat = w.Worker("Pat", 38);
        var quinn = w.Worker("Quinn", 38);
        var shift = w.Shift(1, 9, 17);
        shift.Ratio = SupportRatio.OneToTwo;
        Unavailable(w, pat, shift, 13, 17);
        Unavailable(w, quinn, shift, 9, 13);

        var plan = await w.PlanAsync();

        Assert.Empty(plan.Splits);
    }

    [Fact]
    public async Task TheSecondPartNeedsSomeoneElse_AndAWholeShiftIsNeverSplitWhenSomeoneCanTakeIt()
    {
        await using var w = new World();
        var pat = w.Worker("Pat", 38);
        var shift = w.Shift(1, 9, 17);
        Unavailable(w, pat, shift, 13, 17);      // only Pat exists: nobody can take 13:00 to 17:00
        var plan = await w.PlanAsync();
        Assert.Empty(plan.Splits);
        Assert.Single(plan.Uncovered);

        var spare = w.Worker("Sam", 38);         // Sam is free all day: the whole shift goes to Sam, no split
        plan = await w.PlanAsync();
        Assert.Empty(plan.Splits);
        Assert.Equal(spare.Id, Assert.Single(plan.Placements).StaffId);
    }

    [Fact]
    public async Task TheSamePlanComesBack_WhateverTheOrder()
    {
        await using var w = new World();
        var pat = w.Worker("Pat", 38);
        var quinn = w.Worker("Quinn", 38);
        var shift = w.Shift(1, 9, 17);
        Unavailable(w, pat, shift, 13, 17);
        Unavailable(w, quinn, shift, 9, 13);

        var forward = await w.PlanAsync();
        var reversed = await w.PlanAsync(reversePool: true);

        Assert.Equal(forward.Splits, reversed.Splits);
    }
}
