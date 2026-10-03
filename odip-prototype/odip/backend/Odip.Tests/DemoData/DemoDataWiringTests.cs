using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Infrastructure.BackgroundServices;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Tests.EarlyAccess;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The flag-Off test (TOFF) and the hosted service. With <c>DemoData:Scenarios</c> Off (the default, and what CI and the image build use)
/// the top-up adds NOTHING to the host: no service, no hosted service, no options object, so startup and every request behave exactly as
/// they did before this feature. With it On, one maintainer and one hosted service are registered and the service runs a first tick
/// after a short delay, then on a fixed interval, and a tick that fails never takes the host down.
/// </summary>
public class DemoDataWiringTests
{
    private static IConfiguration Config(string? scenarios, params (string Key, string Value)[] extra)
    {
        var data = new Dictionary<string, string?>();
        if (scenarios is not null) data[DemoDataOptions.ScenariosKey] = scenarios;
        foreach (var (key, value) in extra) data[key] = value;
        return new ConfigurationBuilder().AddInMemoryCollection(data).Build();
    }

    // ── TOFF: the flag-Off proofs ────────────────────────────────────────────

    [Theory]
    [InlineData(null)]
    [InlineData("Off")]
    [InlineData("off")]
    [InlineData("")]
    public void Off_AddsNothingToTheHost(string? value)
    {
        var services = new ServiceCollection();

        services.AddDemoData(Config(value));

        Assert.Empty(services);
    }

    [Theory]
    [InlineData("true")]
    [InlineData("1")]
    [InlineData("yes")]
    [InlineData("Enabled")]
    public void ATypoIsOff_ButOnlyAHostedLogLineIsAdded_NeverTheMaintainer(string value)
    {
        var services = new ServiceCollection();

        services.AddDemoData(Config(value));

        var descriptor = Assert.Single(services);
        Assert.Equal(typeof(IHostedService), descriptor.ServiceType);
        Assert.DoesNotContain(services, d => d.ServiceType == typeof(DemoDataMaintainer));
    }

    [Fact]
    public async Task TheTypoNotice_SaysWhatWasSeen_AndThatItIsTreatedAsOff()
    {
        var log = new CapturingLogger<DemoDataConfigNotice>();
        var options = DemoDataOptions.FromConfiguration(Config("tru"));

        await new DemoDataConfigNotice(options, log).StartAsync(CancellationToken.None);

        var entry = Assert.Single(log.Entries);
        Assert.Equal(LogLevel.Warning, entry.Level);
        Assert.Contains("tru", entry.Message);
        Assert.Contains("Off", entry.Message);
    }

    [Fact]
    public async Task WhenOff_EvenAHostedServiceThatGotRegisteredAnyway_DoesNothing()
    {
        var factory = new ThrowingScopeFactory();
        var service = new DemoDataHostedService(factory, MaintainerFor(new DemoDataOptions()), new DemoDataOptions(), new CapturingLogger<DemoDataHostedService>());

        await service.StartAsync(CancellationToken.None);

        Assert.True(service.ExecuteTask is null || service.ExecuteTask.IsCompletedSuccessfully);
        Assert.Equal(0, factory.Created);
        await service.StopAsync(CancellationToken.None);
    }

    // ── On: what gets registered ─────────────────────────────────────────────

    [Fact]
    public void On_RegistersOneMaintainer_AndOneHostedService()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(TimeProvider.System);

        services.AddDemoData(Config("On"));

        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
        Assert.NotNull(provider.GetRequiredService<DemoDataMaintainer>());
        Assert.Single(provider.GetServices<IHostedService>().OfType<DemoDataHostedService>());
        Assert.True(provider.GetRequiredService<DemoDataOptions>().Enabled);
    }

    // ── the pack list at startup, with the flag On (PR 2 verification F1) ───

    /// <summary>The hosted service's startup log with the flag On and the given pack list: started and stopped before its first tick (an hour away), so nothing else is logged.</summary>
    private static async Task<IReadOnlyList<(LogLevel Level, string Message)>> StartupLogAsync(string? packs)
    {
        var log = new CapturingLogger<DemoDataHostedService>();
        var settings = new List<(string Key, string Value)> { (DemoDataOptions.FirstRunDelaySecondsKey, "3600") };
        if (packs is not null) settings.Add((DemoDataOptions.PacksKey, packs));
        var options = DemoDataOptions.FromConfiguration(Config("On", settings.ToArray()));
        var service = new DemoDataHostedService(new ThrowingScopeFactory(), MaintainerFor(options), options, log);

        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);
        return log.Entries;
    }

    [Fact]
    public async Task On_ATypoInThePackList_IsLoggedAsAWarningBesideTheStartupLine_NamingTheTypo_AndWhatWillRun()
    {
        var entries = (await StartupLogAsync("provider-settings, live-sett ,incidents")).ToList();

        var startup = Assert.Single(entries, e => e.Message.StartsWith("Demo data top-up is On", StringComparison.Ordinal));
        var warning = Assert.Single(entries, e => e.Level == LogLevel.Warning);
        Assert.Equal(entries.IndexOf(startup) + 1, entries.IndexOf(warning));                                 // beside the startup line
        Assert.Contains("'live-sett'", warning.Message, StringComparison.Ordinal);                            // it names the typo
        Assert.Contains(DemoDataOptions.PacksKey, warning.Message, StringComparison.Ordinal);

        // What will run is read from the filter: the two real packs, in the order the code runs them (not the order they were typed), and not the typed text.
        var willRun = "provider-settings, incidents";
        Assert.Contains($"will run (2 of {DemoPacks.Names.Count}): {willRun}", warning.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("live-sett", warning.Message[warning.Message.IndexOf("will run", StringComparison.Ordinal)..], StringComparison.Ordinal);
        Assert.Contains(willRun, startup.Message, StringComparison.Ordinal);
        Assert.DoesNotContain("live-sett", startup.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task On_ACorrectPackList_LogsNoWarning_AndTheStartupLineListsWhatWillRun_InTheOrderTheyRun()
    {
        var entries = await StartupLogAsync("incidents,provider-settings");

        Assert.DoesNotContain(entries, e => e.Level >= LogLevel.Warning);
        var startup = Assert.Single(entries);
        Assert.Contains($"2 of {DemoPacks.Names.Count}: provider-settings, incidents", startup.Message, StringComparison.Ordinal);       // the code's order, not the typed one
    }

    [Theory]
    [InlineData(" ")]
    [InlineData(",")]
    [InlineData(" , ,")]
    public async Task On_AValueThatIsSetButNamesNoPack_IsLoggedAsAWarning_BesideTheStartupLine_AndEveryPackRuns(string value)
    {
        var entries = (await StartupLogAsync(value)).ToList();

        var startup = Assert.Single(entries, e => e.Message.StartsWith("Demo data top-up is On", StringComparison.Ordinal));
        var warning = Assert.Single(entries, e => e.Level == LogLevel.Warning);
        Assert.Equal(entries.IndexOf(startup) + 1, entries.IndexOf(warning));                                 // beside the startup line
        Assert.Contains("is set but names no pack, so every pack runs", warning.Message, StringComparison.Ordinal);
        Assert.Contains(string.Join(", ", DemoPacks.Names), startup.Message, StringComparison.Ordinal);       // and the startup line lists them all
        Assert.Contains($"{DemoPacks.Names.Count} of {DemoPacks.Names.Count}", startup.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task On_ANoListAtAll_LogsNoWarning_AndTheStartupLineListsEveryPack()
    {
        foreach (var packs in new string?[] { null, "" })
        {
            var entries = await StartupLogAsync(packs);

            Assert.DoesNotContain(entries, e => e.Level >= LogLevel.Warning);
            var startup = Assert.Single(entries);
            Assert.Contains(string.Join(", ", DemoPacks.Names), startup.Message, StringComparison.Ordinal);
            Assert.Contains($"{DemoPacks.Names.Count} of {DemoPacks.Names.Count}", startup.Message, StringComparison.Ordinal);
        }
    }

    // ── the hosted service's rhythm ──────────────────────────────────────────

    private static DemoDataMaintainer MaintainerFor(DemoDataOptions options, params IDemoPack[] packs) =>
        new(options, TimeProvider.System, new CapturingLogger<DemoDataMaintainer>(), packs, new InProcessTickLock());

    /// <summary>
    /// A service whose pack records when each tick STARTS. <paramref name="gate"/>, when given, holds every tick (inside the pack) until
    /// the test completes it, so a test can look at a tick that is still running without racing the clock.
    /// </summary>
    private static (ServiceProvider Provider, DemoTestEnv Env, List<DateTime> Ticks, DemoDataOptions Options) OnProvider(
        Task? gate = null, TimeSpan? firstRunDelay = null, TimeSpan? interval = null, ILogger<DemoDataHostedService>? log = null)
    {
        var env = DemoTestEnv.At(2026, 10, 2, 0, 30);
        env.AddTenantAsync().GetAwaiter().GetResult();
        var ticks = new List<DateTime>();
        var options = new DemoDataOptions
        {
            Scenarios = DemoScenarioMode.On,
            FirstRunDelay = firstRunDelay ?? TimeSpan.FromMilliseconds(40),
            Interval = interval ?? TimeSpan.FromMilliseconds(60),
        };
        var pack = DemoTestEnv.Pack("tick", async (_, ct) =>
        {
            lock (ticks) ticks.Add(DateTime.UtcNow);
            if (gate is not null) await gate.WaitAsync(ct);
        });

        var services = new ServiceCollection();
        services.AddLogging();
        if (log is not null) services.AddSingleton(log);
        services.AddSingleton(options);
        services.AddSingleton<DbContextOptions<OdipDbContext>>(env.Options);
        services.AddSingleton(new DemoDataMaintainer(options, env.Clock, new CapturingLogger<DemoDataMaintainer>(), new[] { pack }, new InProcessTickLock()));
        services.AddSingleton<IHostedService, DemoDataHostedService>();
        return (services.BuildServiceProvider(), env, ticks, options);
    }

    private static async Task<int> WaitForAsync(List<DateTime> ticks, int count, int timeoutMs = 5000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            lock (ticks) if (ticks.Count >= count) return ticks.Count;
            await Task.Delay(10);
        }
        lock (ticks) return ticks.Count;
    }

    [Fact]
    public async Task TheHostedService_WaitsBeforeTheFirstTick_ThenTicksOnTheInterval_AndStopsWhenAsked()
    {
        // Nothing below depends on how fast the test thread gets to run, because this test runs inside the image build on a loaded runner
        // (it used to assert "no tick yet" a few milliseconds after StartAsync, against a 40 ms first-run delay). The first tick is held
        // on a gate the test opens, and the delay is long next to a scheduling stall and to the coarse timers of a Windows machine.
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var (provider, _, ticks, options) = OnProvider(gate.Task, firstRunDelay: TimeSpan.FromMilliseconds(400));
        await using var scopeGuard = provider;
        var service = provider.GetServices<IHostedService>().OfType<DemoDataHostedService>().Single();
        var startedAt = DateTime.UtcNow;

        // StartAsync returns at once: readiness never waits for the demo data. A service that ran the held first tick inline would
        // never come back, so the wait turns that into a failure instead of a hang.
        await service.StartAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        Assert.True(await WaitForAsync(ticks, 1) >= 1, "the first tick never started");
        Assert.True(ticks[0] - startedAt >= TimeSpan.FromMilliseconds(300), "the first tick must wait for the first-run delay");

        // The first tick is still running (held), so the loop must not start a second one on top of it.
        await Task.Delay(options.Interval * 3);
        lock (ticks) Assert.Single(ticks);

        gate.SetResult();
        Assert.True(await WaitForAsync(ticks, 3) >= 3, "the service must keep ticking on the interval once the first tick is done");

        await service.StopAsync(CancellationToken.None);
        int count;
        lock (ticks) count = ticks.Count;
        await Task.Delay(200);
        lock (ticks) Assert.Equal(count, ticks.Count);          // stopped: no more ticks
    }

    [Fact]
    public async Task ATickThatCannotEvenStart_IsLogged_AndTheNextTickStillHappens()
    {
        var log = new CapturingLogger<DemoDataHostedService>();
        var options = new DemoDataOptions { Scenarios = DemoScenarioMode.On, FirstRunDelay = TimeSpan.Zero, Interval = TimeSpan.FromMilliseconds(30) };
        var factory = new ThrowingScopeFactory();
        var service = new DemoDataHostedService(factory, MaintainerFor(options), options, log);

        await service.StartAsync(CancellationToken.None);
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (factory.Created < 3 && DateTime.UtcNow < deadline) await Task.Delay(10);
        await service.StopAsync(CancellationToken.None);

        Assert.True(factory.Created >= 3, "the service must keep ticking after a failed tick");
        Assert.True(log.Entries.Count(e => e.Level == LogLevel.Error) >= 3);
        Assert.True(service.ExecuteTask is { IsFaulted: false });
    }

    // Review L2: ExecuteAsync must never throw, because a BackgroundService that throws stops the host in .NET 8 and restart: unless-stopped
    // would then crash-loop the API. Task.Delay throws ArgumentOutOfRangeException for a delay beyond about 49.7 days; the config knobs are
    // clamped, but options can also be built in code, so the loop itself has to survive a wait it cannot make.
    private static async Task<bool> WaitForErrorAsync(CapturingLogger<DemoDataHostedService> log, int timeoutMs = 5000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (log.Entries.Any(e => e.Level == LogLevel.Error)) return true;
            await Task.Delay(10);
        }
        return false;
    }

    [Fact]
    public async Task AFirstRunDelayTheFrameworkCannotWaitFor_IsLoggedAtError_AndTheServiceStillTicksOnTheInterval()
    {
        var log = new CapturingLogger<DemoDataHostedService>();
        var (provider, _, ticks, _) = OnProvider(firstRunDelay: TimeSpan.FromDays(100), log: log);
        await using var scopeGuard = provider;
        var service = provider.GetServices<IHostedService>().OfType<DemoDataHostedService>().Single();

        await service.StartAsync(CancellationToken.None);                  // used to throw ArgumentOutOfRangeException right here
        var ticked = await WaitForAsync(ticks, 3);
        await service.StopAsync(CancellationToken.None);

        Assert.True(ticked >= 3, "the loop must survive the failed wait and carry on ticking");
        var error = Assert.Single(log.Entries, e => e.Level == LogLevel.Error);       // one line for the one failure, not a stream
        Assert.Contains("loop failed unexpectedly", error.Message);
        Assert.True(service.ExecuteTask is { IsFaulted: false });
    }

    [Fact]
    public async Task AnIntervalTheFrameworkCannotWaitFor_IsLoggedAtError_ThenTheDefaultIntervalApplies_NeverAHotLoop()
    {
        var log = new CapturingLogger<DemoDataHostedService>();
        var (provider, _, ticks, _) = OnProvider(firstRunDelay: TimeSpan.Zero, interval: TimeSpan.FromDays(100), log: log);
        await using var scopeGuard = provider;
        var service = provider.GetServices<IHostedService>().OfType<DemoDataHostedService>().Single();

        await service.StartAsync(CancellationToken.None);
        Assert.True(await WaitForAsync(ticks, 1) >= 1, "the first tick runs before the interval is ever used");
        Assert.True(await WaitForErrorAsync(log), "the unusable interval must be logged at Error");
        await Task.Delay(300);                                              // a hot loop would tick and log every few milliseconds

        lock (ticks) Assert.Single(ticks);
        Assert.Single(log.Entries, e => e.Level == LogLevel.Error);
        Assert.True(service.ExecuteTask is { IsCompleted: false }, "the service is still running, waiting out the default interval");
        await service.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));
    }

    private sealed class ThrowingScopeFactory : IServiceScopeFactory
    {
        private int _created;
        public int Created => Volatile.Read(ref _created);

        public IServiceScope CreateScope()
        {
            Interlocked.Increment(ref _created);
            throw new InvalidOperationException("no scope for you");
        }
    }
}
