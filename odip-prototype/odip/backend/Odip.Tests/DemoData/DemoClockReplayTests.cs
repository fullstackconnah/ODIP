using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// T2: the top-up at many clocks. The same invariants are checked on a fresh database at the plan's replay clocks (today, a day on, a week on, forty
/// days on, both daylight-saving days, the minutes after the clocks go forward and the repeated hour when they go back), in the three zones the
/// provider can be in (Sydney, Brisbane with no daylight saving, Adelaide with a half-hour offset); and on one database that is rolled through
/// the same clocks in turn, where earlier rows may only change through the guarded transitions and the growth per day stays small.
/// The invariants are PR 1's: the roster (design for next week and the week after), nothing Published after it ended, the credential tile, the
/// pending leave queue, no value in a daylight-saving gap, and completion variance that agrees with ShiftVarianceCalculator. The trip and
/// dashboard invariants of plan 2.3 belong to PR 3.
/// </summary>
public class DemoClockReplayTests
{
    private static readonly (string Label, DateTimeOffset Utc)[] Instants =
    {
        ("today, Fri 2 Oct 10:30 AEST", new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero)),
        ("a day on", new DateTimeOffset(2026, 10, 3, 0, 30, 0, TimeSpan.Zero)),
        ("a week on", new DateTimeOffset(2026, 10, 9, 0, 30, 0, TimeSpan.Zero)),
        ("forty days on", new DateTimeOffset(2026, 11, 11, 0, 30, 0, TimeSpan.Zero)),
        ("daylight saving starts, Sun 4 Oct noon", new DateTimeOffset(2026, 10, 4, 1, 0, 0, TimeSpan.Zero)),
        ("minutes after the clocks went forward", new DateTimeOffset(2026, 10, 3, 16, 30, 0, TimeSpan.Zero)),
        ("daylight saving ends, Sun 4 Apr 2027 noon", new DateTimeOffset(2027, 4, 4, 2, 0, 0, TimeSpan.Zero)),
        ("the repeated hour when the clocks go back", new DateTimeOffset(2027, 4, 3, 16, 30, 0, TimeSpan.Zero)),
    };

    private static readonly string[] States = { "NSW", "QLD", "SA" };

    public static IEnumerable<object[]> Clocks() =>
        from state in States
        from instant in Instants
        select new object[] { state, instant.Label, instant.Utc };

    private static async Task<(DemoTestEnv Env, DemoTickResult Result)> FreshAsync(string state, DateTimeOffset utc)
    {
        var env = new DemoTestEnv(utc);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync(state);
        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        return (env, result);
    }

    // The Qualifications rule: flagged credentials with no date, expired, due today or due within 30 days; screening counts once dated.
    private static int IssueCount(User u, DateOnly today)
    {
        bool Issue(DateOnly? date) => date is null || date.Value.DayNumber - today.DayNumber <= 30;
        var count = 0;
        if (u.IsFirstAidQualified && Issue(u.FirstAidExpiryDate)) count++;
        if (u.IsDriverEligible && Issue(u.DriverLicenceExpiryDate)) count++;
        if (u.IsManualHandlingCompetent && Issue(u.ManualHandlingExpiryDate)) count++;
        if (u.IsMedicationCompetent && Issue(u.MedicationCompetencyExpiryDate)) count++;
        if (u.WorkerScreeningExpiryDate is not null && Issue(u.WorkerScreeningExpiryDate)) count++;
        return count;
    }

    /// <summary>The invariants that must hold after any tick, on any database.</summary>
    private static async Task AssertInvariantsAsync(DemoTestEnv env, DemoAnchors anchors, string where)
    {
        await using var db = env.AdminDb();

        // Nothing is left Published after it ended (a filled shift; unfilled drafts and cancellations have nobody to complete them).
        var shifts = await db.Shifts.ToListAsync();
        foreach (var shift in shifts.Where(s => s.Status == ShiftStatus.Published))
            Assert.False(ShiftEnded(anchors, shift), $"{where}: shift {shift.Id} on {shift.ServiceDate} {shift.StartTime} is still Published after it ended");

        // No shift starts or ends in the hour that does not exist when the clocks go forward.
        foreach (var shift in shifts)
        {
            var (startLocal, endLocal) = ProviderLocalTime.RosteredWindowLocal(shift);
            Assert.False(anchors.Zone.IsInvalidTime(startLocal), $"{where}: shift {shift.Id} starts at {startLocal:s}, which does not exist");
            Assert.False(anchors.Zone.IsInvalidTime(endLocal), $"{where}: shift {shift.Id} ends at {endLocal:s}, which does not exist");
        }

        // The completion variance is what the app's own calculator says against the rostered times, in this zone.
        var byShift = shifts.ToDictionary(s => s.Id);
        foreach (var completion in await db.ShiftCompletions.ToListAsync())
        {
            var shift = byShift[completion.ShiftId];
            var (start, end) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, completion.TimeZoneId);
            Assert.Equal(anchors.Provider.Id, completion.TimeZoneId);
            Assert.Equal(ShiftVarianceCalculator.VarianceMinutes(completion.ActualStart, start), completion.VarianceMinutesStart);
            Assert.True(completion.StartedAt <= anchors.NowUtc, $"{where}: a completion started in the future");
            if (completion.ActualEnd is { } actualEnd)
            {
                Assert.Equal(ShiftVarianceCalculator.VarianceMinutes(actualEnd, end), completion.VarianceMinutesEnd);
                Assert.True(completion.SubmittedAt <= anchors.NowUtc, $"{where}: a completion is in the future");
            }
            else
            {
                Assert.Null(completion.SubmittedAt);                           // a shift in progress (the live set): not finished, so nothing of the end yet
                Assert.Equal(ShiftStatus.InProgress, byShift[completion.ShiftId].Status);
            }
        }

        // The pending queue always has somebody waiting, and only for dates still ahead.
        var pending = await db.LeaveRequests.Where(l => l.Status == LeaveStatus.Pending).ToListAsync();
        Assert.True(pending.Count >= 3, $"{where}: only {pending.Count} pending leave requests");
        Assert.All(pending, l => Assert.True(l.StartDate >= anchors.D0, $"{where}: pending request starting {l.StartDate} has passed"));

        // The roster the next two weeks show.
        foreach (var week in new[] { anchors.Monday(1), anchors.Monday(2) })
            await DemoBoardAssertions.AssertDesignedWeekAsync(env, week);
    }

    private static bool ShiftEnded(DemoAnchors anchors, Shift shift)
    {
        var (_, endLocal) = ProviderLocalTime.RosteredWindowLocal(shift);
        return anchors.LocalToUtc(endLocal).AddMinutes(45) <= anchors.NowUtc;
    }

    // ── a fresh database at each clock and in each zone ──────────────────────

    [Theory]
    [MemberData(nameof(Clocks))]
    public async Task T2_AFreshDatabase_BuildsTheDemoCleanly_AndEveryInvariantHolds(string state, string label, DateTimeOffset utc)
    {
        var (env, result) = await FreshAsync(state, utc);
        var where = $"{state} / {label}";
        var anchors = DemoAnchors.Create(utc.UtcDateTime, state);

        Assert.True(result.Status == DemoTickStatus.Ran, $"{where}: {result.Status} {result.Detail}");
        Assert.True(result.Failures.Count == 0, $"{where}: a pack failed: {string.Join("; ", result.Failures.Select(f => f.Pack + ": " + f.Message))}");
        Assert.Empty(result.SkippedStories);
        await AssertInvariantsAsync(env, anchors, where);

        // The credential tile at the first fill: 8 credentials on 6 staff, whatever the day.
        await using var db = env.AdminDb();
        var issues = (await db.Users.ToListAsync()).Select(u => IssueCount(u, anchors.D0)).ToList();
        Assert.True(issues.Sum() == 8 && issues.Count(i => i > 0) == 6, $"{where}: {issues.Sum()} credentials on {issues.Count(i => i > 0)} staff");
    }

    [Theory]
    [MemberData(nameof(Clocks))]
    public async Task T2_ASecondTickOnTheSameClock_ChangesNothing_InAnyZone(string state, string label, DateTimeOffset utc)
    {
        var (env, _) = await FreshAsync(state, utc);
        DemoSnapshot first;
        await using (var db = env.AdminDb()) first = DemoSnapshot.Take(db);
        env.Clock.Set(utc);

        // A second tick the same minute: the quiet-hours rule may skip it (the clocks that fall before 05:00), and when it does run it changes nothing.
        var again = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);

        Assert.True(again.Status is DemoTickStatus.Ran, $"{state} / {label}: {again.Status}");
        await using var check = env.AdminDb();
        var changes = first.Diff(DemoSnapshot.Take(check));
        Assert.True(changes.Count == 0, $"{state} / {label}: " + DemoSnapshot.Describe(changes));
    }

    // ── one database, rolled forward ─────────────────────────────────────────

    private static readonly DateTimeOffset[] Roll =
    {
        new(2026, 10, 2, 0, 30, 0, TimeSpan.Zero), new(2026, 10, 3, 0, 30, 0, TimeSpan.Zero), new(2026, 10, 4, 1, 0, 0, TimeSpan.Zero),
        new(2026, 10, 9, 0, 30, 0, TimeSpan.Zero), new(2026, 10, 16, 0, 30, 0, TimeSpan.Zero), new(2026, 11, 11, 0, 30, 0, TimeSpan.Zero),
        new(2026, 12, 20, 0, 30, 0, TimeSpan.Zero), new(2027, 4, 4, 2, 0, 0, TimeSpan.Zero),
    };

    [Fact]
    public async Task T2_ARollingDatabase_ChangesEarlierRowsOnlyThroughTheGuardedMoves_AndGrowsSlowly()
    {
        var env = new DemoTestEnv(Roll[0]);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        DemoSnapshot? previous = null;
        var previousUtc = Roll[0];
        var growth = new List<(double Days, int Rows)>();

        foreach (var utc in Roll)
        {
            env.Clock.Set(utc);
            var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
            var where = $"rolling / {utc:u}";
            Assert.True(result.Status == DemoTickStatus.Ran, $"{where}: {result.Status}");
            Assert.True(result.Failures.Count == 0, $"{where}: " + string.Join("; ", result.Failures.Select(f => f.Pack + ": " + f.Message)));
            var anchors = DemoAnchors.Create(utc.UtcDateTime, "NSW");
            await AssertInvariantsAsync(env, anchors, where);

            DemoSnapshot now;
            await using (var db = env.AdminDb()) now = DemoSnapshot.Take(db);
            if (previous is not null)
            {
                var changes = previous.Diff(now);
                Assert.DoesNotContain(changes, c => c.Kind == "removed");
                foreach (var change in changes.Where(c => c.Kind == "changed"))
                {
                    var type = DemoSnapshot.TypeOf(change.Key);
                    var type2 = typeof(Shift).Assembly.GetTypes().FirstOrDefault(t => t.Name == type && t.Namespace is not null && t.Namespace.StartsWith("Odip.Domain", StringComparison.Ordinal));
                    Assert.True(type2 is not null && DemoTenantGuard.ModifiableProperties.TryGetValue(type2, out var allowed) && change.Properties.All(allowed.Contains),
                        $"{where}: {change.Key} changed {string.Join(",", change.Properties)}, which the guarded moves do not allow");
                }
                growth.Add(((utc - previousUtc).TotalDays, changes.Count(c => c.Kind == "added")));
            }
            previous = now;
            previousUtc = utc;
        }

        // About a day's worth of rows a day: well under a hundred (the plan expects about forty, three times that with audit history). This is an average
        // over gaps of one to a hundred days, each long gap capped by the fixed windows, so it cannot see the steady state: the day-by-day test below does.
        var totalDays = growth.Sum(g => g.Days);
        var totalRows = growth.Sum(g => g.Rows);
        Assert.True(totalRows / totalDays < 100, $"{totalRows} rows added over {totalDays:0} days is {totalRows / totalDays:0.0} a day");
        // A tick after a gap of a month or more builds every history window at once (four weeks of the shift package, a week of medication), the live
        // days and the roster weeks ahead, audit rows included: the biggest possible tick, about 1,100 rows here, so under 1,500.
        Assert.All(growth, g => Assert.True(g.Rows < 1500, $"one tick added {g.Rows} rows"));
    }

    /// <summary>
    /// PR 2 review L5: the check above averages over gaps of one to a hundred days, and a long gap is capped by the fixed windows (a tick after a gap builds
    /// every window at once), so a steady growth several times too high could still pass it. This is the steady state itself: one tick a day, for four weeks
    /// after the windows are built, with the growth read day by day (every table, the audit history included) so a pack that adds more each day than it
    /// should shows at once.
    /// </summary>
    [Fact]
    public async Task T2_OnConsecutiveDays_TheDatabaseGrowsByADaysRows_AndNoDayAddsMoreThanABoundedNumber()
    {
        var first = new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero);                                   // Fri 10:30 AEST; the clocks go forward on the Sunday
        var env = new DemoTestEnv(first);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var perDay = new List<(DateTimeOffset Day, int Rows)>();
        DemoSnapshot? previous = null;

        for (var day = 0; day <= 7 + 28; day++)                                                                  // a week for the windows to fill, then four weeks
        {
            var utc = first.AddDays(day);
            env.Clock.Set(utc);
            var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
            Assert.True(result.Status == DemoTickStatus.Ran && result.Failures.Count == 0, $"day {day}: {result.Status} " + string.Join("; ", result.Failures.Select(f => f.Pack + ": " + f.Message)));

            DemoSnapshot now;
            await using (var db = env.AdminDb()) now = DemoSnapshot.Take(db);
            if (previous is not null) perDay.Add((utc, previous.Diff(now).Count(c => c.Kind == "added")));
            previous = now;
        }

        // Measured on this fixture (PR 2 fix round 1): 105 to 182 rows a day, 127 on average, the high days being the day a new roster week comes into the
        // window. That is about 46 thousand rows a year with AuditLogs, about half of them audit history (R13: decide the retention sweep within the year). The
        // bounds are the measurement with room: a pack that adds a day's rows twice, or a window that no longer closes, breaks one of them.
        var steady = perDay.Skip(7).ToList();                                                                    // after the windows are built
        var description = "per day: " + string.Join(" ", perDay.Select(d => d.Rows));
        Assert.InRange(steady.Average(d => d.Rows), 60, 160);                                                    // and not zero: the check has to see the growth it bounds
        Assert.True(steady.All(d => d.Rows < 250), description);
        Assert.True(steady.Count(d => d.Rows < 30) == 0, description);                                           // every day adds something (the live set alone writes a day's rows)
    }
}
