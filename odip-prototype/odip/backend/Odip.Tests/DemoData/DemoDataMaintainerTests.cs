using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// What the maintainer does around the packs: the gate, the one tenant it will ever write to, the provider clock it hands every pack,
/// one pack failing without stopping the others (T9, the InMemory half), the tick lock, and the "only the first tick of the day runs
/// between 00:00 and 05:00" rule. The packs themselves are tested on their own; here they are stand-ins.
/// </summary>
public class DemoDataMaintainerTests
{
    private static DemoTestEnv Env() => DemoTestEnv.At(2026, 10, 2, 0, 30);   // Fri 10:30 AEST

    private static DemoTestEnv.DelegatePack Recorder(List<string> log, string name, int added = 0) =>
        DemoTestEnv.Pack(name, (run, _) =>
        {
            log.Add(name);
            if (added > 0) run.Added("rows", added);
            return Task.CompletedTask;
        });

    private static Shift ShiftFor(DemoRun run, string key) => new()
    {
        Id = DemoIds.For("shift", "test", key), TenantId = run.TenantId, ParticipantId = Guid.NewGuid(), ServiceDate = run.Anchors.D0.AddDays(3),
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Published,
    };

    // ── the gate and the one tenant ───────────────────────────────────────────

    [Fact]
    public async Task Off_RunsNothing_AndNeverTouchesTheDatabase()
    {
        var env = Env();
        await env.AddTenantAsync();
        var ran = new List<string>();
        var maintainer = env.Maintainer(new[] { Recorder(ran, "a") }, new DemoDataOptions { Scenarios = DemoScenarioMode.Off });

        var result = await maintainer.RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.Disabled, result.Status);
        Assert.Empty(ran);
        await using var db = env.AdminDb();
        Assert.Equal(0, await db.AuditLogs.CountAsync());
    }

    [Fact]
    public async Task NoDemoTenant_WritesNothing_AndSaysSo()
    {
        var env = Env();
        var ran = new List<string>();

        var result = await env.RunAsync(new[] { Recorder(ran, "a") });

        Assert.Equal(DemoTickStatus.NoDemoTenant, result.Status);
        Assert.Empty(ran);
        Assert.Contains(env.Log.Entries, e => e.Level == LogLevel.Information && e.Message.Contains("Demo tenant"));
    }

    [Theory]
    [InlineData("Demo", "demo.example.com", true)]        // a tenant named Demo on someone else's domain
    [InlineData("Demo Provider", "demo.odip.com.au", true)] // right domain, wrong name
    [InlineData("Demo", "demo.odip.com.au", false)]        // inactive
    public async Task ATenantThatOnlyLooksLikeTheDemoTenant_IsNotWrittenTo(string name, string domain, bool active)
    {
        var env = Env();
        await env.AddTenantAsync(name, domain, active);
        var ran = new List<string>();

        var result = await env.RunAsync(new[] { Recorder(ran, "a") });

        Assert.Equal(DemoTickStatus.NoDemoTenant, result.Status);
        Assert.Empty(ran);
    }

    [Fact]
    public async Task TwoDemoTenants_IsAmbiguous_SoNothingIsWritten()
    {
        var env = Env();
        await env.AddTenantAsync();
        await env.AddTenantAsync("Demo", "DEMO.odip.com.au", true, Guid.NewGuid());
        var ran = new List<string>();

        var result = await env.RunAsync(new[] { Recorder(ran, "a") });

        Assert.Equal(DemoTickStatus.NoDemoTenant, result.Status);
        Assert.Empty(ran);
    }

    // ── the clock every pack gets ────────────────────────────────────────────

    [Fact]
    public async Task EveryPackGetsTheProvidersCalendarDate_FromProviderSettings()
    {
        var env = Env();
        await env.AddTenantAsync();
        await env.SetProviderStateAsync("QLD");        // Brisbane: no daylight saving
        DemoAnchors? seen = null;

        var result = await env.RunAsync(new[] { DemoTestEnv.Pack("probe", (run, _) => { seen = run.Anchors; return Task.CompletedTask; }) });

        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.NotNull(seen);
        Assert.Equal("Australia/Brisbane", seen!.Provider.Id);
        Assert.Equal(new DateOnly(2026, 10, 2), seen.D0);
        Assert.Equal(new DateOnly(2026, 9, 28), seen.W0);
    }

    [Fact]
    public async Task WithNoProviderSettings_TheZoneIsSydney_TheAppsOwnFallback()
    {
        var env = Env();
        await env.AddTenantAsync();
        DemoAnchors? seen = null;

        await env.RunAsync(new[] { DemoTestEnv.Pack("probe", (run, _) => { seen = run.Anchors; return Task.CompletedTask; }) });

        Assert.Equal("Australia/Sydney", seen!.Provider.Id);
    }

    [Fact]
    public async Task PacksRunInTheOrderGiven_AndTheirRowCountsAreReported()
    {
        var env = Env();
        await env.AddTenantAsync();
        var ran = new List<string>();

        var result = await env.RunAsync(new[] { Recorder(ran, "first", 3), Recorder(ran, "second", 2), Recorder(ran, "third", 0) });

        Assert.Equal(new[] { "first", "second", "third" }, ran);
        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.Equal(5, result.RowsAdded.Values.Sum());
        Assert.Empty(result.Failures);
    }

    [Fact]
    public async Task APackSeesOnlyTheDemoTenantsRows()
    {
        var env = Env();
        await env.AddTenantAsync();
        var otherTenant = Guid.NewGuid();
        await using (var seed = env.AdminDb())
        {
            seed.Users.Add(new User { Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, Username = "d", Email = "d@demo.odip.com.au", FirstName = "D", LastName = "D" });
            seed.Users.Add(new User { Id = Guid.NewGuid(), TenantId = otherTenant, Username = "o", Email = "o@other.example.com", FirstName = "O", LastName = "O" });
            await seed.SaveChangesAsync();
        }
        var seenUsers = -1;

        await env.RunAsync(new[] { DemoTestEnv.Pack("probe", async (run, ct) => seenUsers = await run.Db.Users.CountAsync(ct)) });

        Assert.Equal(1, seenUsers);
    }

    // ── T9: failure isolation ────────────────────────────────────────────────

    [Fact]
    public async Task AThrowingPack_IsReported_TheOthersStillRun_AndTheMaintainerDoesNotThrow()
    {
        var env = Env();
        await env.AddTenantAsync();
        var ran = new List<string>();
        var boom = DemoTestEnv.Pack("boom", (run, _) =>
        {
            run.Db.Shifts.Add(ShiftFor(run, "never-saved"));
            throw new InvalidOperationException("a pack bug");
        });
        var saver = DemoTestEnv.Pack("saver", async (run, ct) =>
        {
            run.Db.Shifts.Add(ShiftFor(run, "saved"));
            await run.SaveAsync(ct);
            run.Added("shifts");
            ran.Add("saver");
        });

        var result = await env.RunAsync(new IDemoPack[] { Recorder(ran, "before"), boom, saver });

        Assert.Equal(DemoTickStatus.Ran, result.Status);
        Assert.Equal(new[] { "before", "saver" }, ran);
        var failure = Assert.Single(result.Failures);
        Assert.Equal("boom", failure.Pack);
        Assert.Contains("a pack bug", failure.Message);
        Assert.Contains(env.Log.Entries, e => e.Level == LogLevel.Error && e.Message.Contains("boom"));
        await using var db = env.AdminDb();
        Assert.Equal(new[] { DemoIds.For("shift", "test", "saved") }, await db.Shifts.Select(s => s.Id).ToArrayAsync());
    }

    [Fact]
    public async Task AGuardViolation_WritesNothingFromThatPack_AndIsReportedAsAFailure()
    {
        var env = Env();
        await env.AddTenantAsync();
        var bad = DemoTestEnv.Pack("bad", async (run, ct) =>
        {
            run.Db.Shifts.Add(ShiftFor(run, "fine"));
            run.Db.Participants.Add(new Participant { Id = Guid.NewGuid(), TenantId = run.TenantId, FirstName = "Not", LastName = "Allowed" });
            await run.SaveAsync(ct);
        });

        var result = await env.RunAsync(new IDemoPack[] { bad });

        var failure = Assert.Single(result.Failures);
        Assert.Contains("guard", failure.Message, StringComparison.OrdinalIgnoreCase);
        await using var db = env.AdminDb();
        Assert.Equal(0, await db.Shifts.CountAsync());
        Assert.Equal(0, await db.Participants.CountAsync());
    }

    [Fact]
    public async Task AFailedPack_LeavesNoTrackedStateBehindForTheNextPack()
    {
        var env = Env();
        await env.AddTenantAsync();
        var trackedInNext = -1;
        var boom = DemoTestEnv.Pack("boom", (run, _) => { run.Db.Shifts.Add(ShiftFor(run, "x")); throw new InvalidOperationException("no"); });
        var next = DemoTestEnv.Pack("next", (run, _) => { trackedInNext = run.Db.ChangeTracker.Entries().Count(); return Task.CompletedTask; });

        await env.RunAsync(new IDemoPack[] { boom, next });

        Assert.Equal(0, trackedInNext);
    }

    [Fact]
    public async Task ACancelledToken_StopsTheTick_InsteadOfBeingSwallowedAsAPackFailure()
    {
        var env = Env();
        await env.AddTenantAsync();
        using var cts = new CancellationTokenSource();
        var second = new List<string>();
        var cancelling = DemoTestEnv.Pack("cancelling", (_, _) => { cts.Cancel(); throw new OperationCanceledException(cts.Token); });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => env.RunAsync(new IDemoPack[] { cancelling, Recorder(second, "after") }, cts.Token));

        Assert.Empty(second);
    }

    // ── the tick lock ────────────────────────────────────────────────────────

    [Fact]
    public async Task ASecondTick_WhileOneIsRunning_SkipsOnTheLock_AndWritesNothing()
    {
        var env = Env();
        await env.AddTenantAsync();
        var shared = new InProcessTickLock();
        var inside = new TaskCompletionSource();
        var release = new TaskCompletionSource();
        var blocker = DemoTestEnv.Pack("blocker", async (_, _) => { inside.SetResult(); await release.Task; });
        var ran = new List<string>();

        var first = env.Maintainer(new IDemoPack[] { blocker }, tickLock: shared).RunAsync(env.Options, CancellationToken.None);
        await inside.Task;
        var second = await env.Maintainer(new IDemoPack[] { Recorder(ran, "second") }, tickLock: shared).RunAsync(env.Options, CancellationToken.None);
        release.SetResult();
        var firstResult = await first;

        Assert.Equal(DemoTickStatus.LockHeld, second.Status);
        Assert.Empty(ran);
        Assert.Equal(DemoTickStatus.Ran, firstResult.Status);
    }

    [Fact]
    public async Task TheLockIsReleased_EvenWhenAPackFailed()
    {
        var env = Env();
        await env.AddTenantAsync();
        var shared = new InProcessTickLock();
        var boom = DemoTestEnv.Pack("boom", (_, _) => throw new InvalidOperationException("x"));

        await env.Maintainer(new IDemoPack[] { boom }, tickLock: shared).RunAsync(env.Options, CancellationToken.None);
        var again = await env.Maintainer(new IDemoPack[] { Recorder(new List<string>(), "ok") }, tickLock: shared).RunAsync(env.Options, CancellationToken.None);

        Assert.Equal(DemoTickStatus.Ran, again.Status);
    }

    // ── cadence: the day roll ────────────────────────────────────────────────

    [Fact]
    public async Task BetweenMidnightAndFiveLocal_OnlyTheFirstTickOfTheDayRuns()
    {
        var env = DemoTestEnv.At(2026, 10, 1, 17, 0);          // 17:00Z on 1 Oct is 03:00 on 2 Oct in Sydney (AEST, UTC+10): inside the quiet window
        await env.AddTenantAsync();
        var ran = new List<string>();
        var maintainer = env.Maintainer(new[] { Recorder(ran, "tick") });

        Assert.Equal(DemoTickStatus.Ran, (await maintainer.RunAsync(env.Options, CancellationToken.None)).Status);      // first of the day: the day roll
        env.Clock.Set(new DateTimeOffset(2026, 10, 1, 18, 0, 0, TimeSpan.Zero));                                          // 04:00 local
        Assert.Equal(DemoTickStatus.QuietHours, (await maintainer.RunAsync(env.Options, CancellationToken.None)).Status);
        env.Clock.Set(new DateTimeOffset(2026, 10, 1, 19, 30, 0, TimeSpan.Zero));                                         // 05:30 local
        Assert.Equal(DemoTickStatus.Ran, (await maintainer.RunAsync(env.Options, CancellationToken.None)).Status);       // quiet window over
        env.Clock.Set(new DateTimeOffset(2026, 10, 2, 14, 30, 0, TimeSpan.Zero));                                         // 00:30 on the 3rd
        Assert.Equal(DemoTickStatus.Ran, (await maintainer.RunAsync(env.Options, CancellationToken.None)).Status);       // first tick of a new day
        env.Clock.Set(new DateTimeOffset(2026, 10, 2, 15, 30, 0, TimeSpan.Zero));                                         // 01:30
        Assert.Equal(DemoTickStatus.QuietHours, (await maintainer.RunAsync(env.Options, CancellationToken.None)).Status);

        Assert.Equal(3, ran.Count);
    }

    [Fact]
    public async Task ByDay_EveryHourlyTickRuns()
    {
        var env = Env();
        await env.AddTenantAsync();
        var ran = new List<string>();
        var maintainer = env.Maintainer(new[] { Recorder(ran, "tick") });

        for (var hour = 0; hour < 5; hour++)
        {
            env.Clock.Set(new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero).AddHours(hour));   // 10:30 .. 14:30 local
            Assert.Equal(DemoTickStatus.Ran, (await maintainer.RunAsync(env.Options, CancellationToken.None)).Status);
        }

        Assert.Equal(5, ran.Count);
    }
}
