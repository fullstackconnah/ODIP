using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;

namespace Odip.Infrastructure.BackgroundServices;

/// <summary>
/// Runs the demo top-up on a clock (plan 5.2): a first tick shortly after the host starts (the "startup run"), then every
/// <see cref="DemoDataOptions.Interval"/>. Modelled on <see cref="HolidaySyncBackgroundService"/> and the notification dispatcher: a
/// Task.Delay loop and a fresh DI scope per tick. It is only registered when <c>DemoData:Scenarios</c> is On
/// (<see cref="DemoDataServiceCollectionExtensions.AddDemoData"/>), and checks the flag again on entry.
///
/// It runs after startup and never inside the Program.cs migrate-and-seed retry loop, so readiness is not delayed and a non-transient
/// failure cannot crash the API at boot: <see cref="ExecuteAsync"/> never throws (a BackgroundService that throws takes the host down in
/// .NET 8), and a tick that fails is logged and followed by the next one. The loop itself is guarded too: whatever escapes a wait or a tick
/// (in practice only a delay Task.Delay cannot take, which the clamped config knobs cannot produce but code-built options can) is logged
/// at Error and the loop carries on, so the worst a bad value costs is an error line.
/// </summary>
public sealed class DemoDataHostedService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly DemoDataMaintainer _maintainer;
    private readonly DemoDataOptions _options;
    private readonly ILogger<DemoDataHostedService> _logger;

    public DemoDataHostedService(IServiceScopeFactory scopeFactory, DemoDataMaintainer maintainer, DemoDataOptions options,
        ILogger<DemoDataHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _maintainer = maintainer;
        _options = options;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled) return;

        // The packs that will run, from the filter and not the typed text (PR 2 verification F1 and F6), and, beside it, what is wrong with the list if anything is: a name
        // that is not a pack matches nothing, and an allow-list with a typo in it is a pack that quietly stays off.
        _logger.LogInformation("Demo data top-up is On: first tick in {Delay}, then every {Interval}; packs that will run, {Packs}", _options.FirstRunDelay, _options.Interval,
            _options.DescribePacksThatRun());
        if (_options.Warning is not null) _logger.LogWarning("{Warning}", _options.Warning);

        var delay = _options.FirstRunDelay;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(delay, stoppingToken);
                await TickOnceAsync(stoppingToken);
                delay = _options.Interval;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                // The host is stopping.
            }
            catch (Exception ex)
            {
                // The next wait is the configured interval when that is a time Task.Delay can take (it was the first-run delay, or the
                // tick, that failed), otherwise the default one: a failure can never turn into a loop that ticks without waiting.
                delay = IsUsableWait(_options.Interval) ? _options.Interval : DemoDataOptions.DefaultInterval;
                _logger.LogError(ex, "The demo data loop failed unexpectedly; it keeps running and waits {Delay} before the next tick", delay);
            }
        }
    }

    private static bool IsUsableWait(TimeSpan wait) => wait >= TimeSpan.Zero && wait <= DemoDataOptions.MaxInterval;

    /// <summary>One tick in its own DI scope. Never throws; returns null when the tick could not be started or the host is stopping.</summary>
    public async Task<DemoTickResult?> TickOnceAsync(CancellationToken ct)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var dbOptions = scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>();
            return await _maintainer.RunAsync(dbOptions, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return null;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Demo data tick failed unexpectedly; the next tick will try again");
            return null;
        }
    }
}
