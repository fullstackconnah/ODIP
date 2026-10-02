using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// T3: the top-up on a database the old seed built and time has aged. The old seed methods run in Program.cs order, every old row is
/// remembered, the clock moves two months on, and a full tick runs: every old row is still there and equal, apart from the credential
/// columns on the ten staff (decision D1); the new data is present; and running every old seed method again adds nothing, because the
/// top-up never wrote the first row into a table an old seed guards with Any(). This runs against the REAL seed, not a fixture, so it
/// notices if somebody else changes the seed in a way that breaks a prerequisite (a person the stories need).
/// </summary>
public class DemoOldSeedTests
{
    /// <summary>Program.cs's startup seed block, in its order.</summary>
    internal static async Task RunOldSeedAsync(OdipDbContext db)
    {
        await DbSeeder.SeedAsync(db);
        await DbSeeder.SeedNdisDataAsync(db);
        await DbSeeder.SeedDataDictionaryAsync(db);
        await DbSeeder.SeedMedicationsAsync(db);
        await DbSeeder.SeedParticipantNotesAsync(db);
        await DbSeeder.SeedParticipantRoutinesAsync(db);
        await DbSeeder.SeedRestrictivePracticesAsync(db);
        await DbSeeder.SeedParticipantRiskEntriesAsync(db);
        await DbSeeder.SeedParticipantConsentsAsync(db);
        await DbSeeder.SeedParticipantHealthConditionsAsync(db);
        await DbSeeder.SeedParticipantClinicalEnrichmentAsync(db);
        await DbSeeder.SeedParticipantAdlAssessmentsAsync(db);
        await DbSeeder.SeedParticipantDailyLivingAsync(db);
        await DbSeeder.SeedCommunityAccessDailyLivingAsync(db);
        await DbSeeder.SeedShiftNotesAsync(db);
    }

    private static readonly DateTimeOffset TwoMonthsOn = new(2026, 12, 2, 0, 30, 0, TimeSpan.Zero);   // Wed 2 Dec 11:30 AEDT

    private static async Task<(DemoTestEnv Env, DemoSnapshot Old)> OldSeededAsync()
    {
        var env = new DemoTestEnv(TwoMonthsOn);
        await using (var db = env.AdminDb()) await RunOldSeedAsync(db);
        await using var read = env.AdminDb();
        return (env, DemoSnapshot.Take(read));
    }

    [Fact]
    public async Task T3_EveryOldRowSurvives_ExceptTheCredentialColumnsOnTheStaff_AndTheNewDataIsThere()
    {
        var (env, old) = await OldSeededAsync();
        Assert.True(old.Count > 500, "the old seed built a database");

        var result = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.Empty(result.Failures);
        Assert.Empty(result.SkippedStories);                               // every person the stories need is in the real seed
        await using var read = env.AdminDb();
        var after = DemoSnapshot.Take(read);

        var oldRowChanges = old.Diff(after).Where(c => c.Kind != "added").ToList();
        Assert.DoesNotContain(oldRowChanges, c => c.Kind == "removed");
        var changed = oldRowChanges.Where(c => c.Kind == "changed").ToList();
        Assert.True(changed.All(c => DemoSnapshot.TypeOf(c.Key) == nameof(User)), "only users changed: " + DemoSnapshot.Describe(changed));
        var allowed = DemoTenantGuard.ModifiableProperties[typeof(User)];
        Assert.All(changed, c => Assert.True(c.Properties.All(allowed.Contains), $"{c.Key} changed {string.Join(",", c.Properties)}"));
        Assert.Equal(10, changed.Count);                                   // the ten staff; the read-only user is untouched

        // The new data.
        Assert.Equal(1, await read.ProviderSettings.IgnoreQueryFilters().CountAsync(p => p.TenantId == DemoTestEnv.DemoTenantId));
        Assert.Equal(13, await read.ShiftPatterns.CountAsync());
        Assert.True(await read.Shifts.IgnoreQueryFilters().CountAsync() > 80);
        Assert.True(await read.ShiftCompletions.CountAsync() > 15);
        Assert.True(await read.LeaveRequests.CountAsync() >= 10);
        Assert.Equal(10, await read.StaffParticipantCompatibilities.CountAsync());
        Assert.Equal(2, await read.BookingTasks.CountAsync(t => t.TaskType == TaskType.LeaveCoverage));       // Priya's Thursday in each of the two pack weeks
    }

    [Fact]
    public async Task T3_CallingEveryOldSeedMethodAgain_AddsNothing_AndChangesNothing()
    {
        var (env, _) = await OldSeededAsync();
        await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        DemoSnapshot afterTopUp;
        await using (var read = env.AdminDb()) afterTopUp = DemoSnapshot.Take(read);

        await using (var db = env.AdminDb()) await RunOldSeedAsync(db);

        await using var again = env.AdminDb();
        var changes = afterTopUp.Diff(DemoSnapshot.Take(again));
        Assert.True(changes.Count == 0, "the old seed, run again, changed: " + DemoSnapshot.Describe(changes));
    }

    [Fact]
    public async Task T1_OnTheRealOldSeed_TheFirstTickBuildsTheDemo_AndASecondChangesNothing()
    {
        // The same scenario as Postgres_T1_*, on InMemory: fresh database, old seed, then the first tick.
        var (env, _) = await OldSeededAsync();

        var first = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        DemoSnapshot afterFirst;
        await using (var read = env.AdminDb()) afterFirst = DemoSnapshot.Take(read);
        var second = await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);
        await using var again = env.AdminDb();

        Assert.Empty(first.Failures);
        Assert.Empty(first.SkippedStories);
        Assert.True(first.RowsAdded.Values.Sum() > 150);
        Assert.Equal(0, second.RowsAdded.Values.Sum());
        var changes = afterFirst.Diff(DemoSnapshot.Take(again));
        Assert.True(changes.Count == 0, "a second tick changed: " + DemoSnapshot.Describe(changes));
    }

    [Fact]
    public async Task T9_TwoMaintainersRacingOnTheRealOldSeed_OneSkipsOnTheLock_AndTheFinalRowsEqualASingleRun()
    {
        // The same scenario as Postgres_T9_*, with an in-process lock: the logic of the test (which rows are compared, who holds the lock).
        var (raced, _) = await OldSeededAsync();
        var (single, _) = await OldSeededAsync();
        var shared = new InProcessTickLock();
        var inside = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var blocker = DemoTestEnv.Pack("blocker", async (_, _) => { inside.TrySetResult(); await release.Task; });
        var packs = new List<IDemoPack> { blocker };
        packs.AddRange(DemoPacks.Default());

        var first = raced.Maintainer(packs, tickLock: shared).RunAsync(raced.Options, CancellationToken.None);
        await inside.Task.WaitAsync(TimeSpan.FromSeconds(30));
        var second = await raced.Maintainer(DemoPacks.Default(), tickLock: shared).RunAsync(raced.Options, CancellationToken.None);
        release.SetResult();
        var firstResult = await first;
        await single.Maintainer(DemoPacks.Default()).RunAsync(single.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.LockHeld, second.Status);
        Assert.Empty(firstResult.Failures);
        DemoSnapshot a, b;
        await using (var ra = raced.AdminDb()) a = DemoSnapshot.Take(ra);
        await using (var rb = single.AdminDb()) b = DemoSnapshot.Take(rb);
        static bool IsDemoId(string key) => Guid.TryParse(key[(key.IndexOf('|') + 1)..], out var id) && id.ToString("D")[14] == '8';
        foreach (var type in new[] { "Shift", "ShiftPattern", "ShiftCompletion", "LeaveRequest", "RecurringUnavailability", "StaffAvailability", "StaffParticipantCompatibility", "Person", "ParticipantContactRole" })
        {
            Assert.Equal(
                b.Keys.Where(k => DemoSnapshot.TypeOf(k) == type && IsDemoId(k)).OrderBy(k => k, StringComparer.Ordinal).ToList(),
                a.Keys.Where(k => DemoSnapshot.TypeOf(k) == type && IsDemoId(k)).OrderBy(k => k, StringComparer.Ordinal).ToList());
        }
        Assert.True(a.Keys.Count(k => DemoSnapshot.TypeOf(k) == "Shift" && IsDemoId(k)) > 80);
        Assert.Equal(b.CountOf("BookingTask"), a.CountOf("BookingTask"));
    }

    [Fact]
    public async Task T3_TheTopUpNeverWritesTheFirstRowOfATableAnOldSeedGuardsWithAny()
    {
        // The old seeds that open with "if (await ctx.X.AnyAsync()) return;" must still find X empty if the top-up ran first on a database the
        // old seed has not touched: here, a bare Demo tenant with only the people (as a half-restored database would be).
        var env = new DemoTestEnv(TwoMonthsOn);
        await DemoFixture.SeedPeopleAsync(env, oldSeed: false);

        await env.Maintainer(DemoPacks.Default()).RunAsync(env.Options, CancellationToken.None);

        await using var db = env.AdminDb();
        Assert.Equal(0, await db.ParticipantMedications.IgnoreQueryFilters().CountAsync());
        Assert.Equal(0, await db.ParticipantNotes.IgnoreQueryFilters().CountAsync());
        Assert.Equal(0, await db.ParticipantRoutines.IgnoreQueryFilters().CountAsync());
        Assert.Equal(0, await db.RestrictivePractices.IgnoreQueryFilters().CountAsync());
        Assert.Equal(0, await db.ShiftNotes.IgnoreQueryFilters().CountAsync());
        Assert.Equal(0, await db.ParticipantRiskEntries.IgnoreQueryFilters().CountAsync());
    }
}
