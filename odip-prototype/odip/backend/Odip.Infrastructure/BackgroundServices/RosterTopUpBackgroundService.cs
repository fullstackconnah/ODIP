using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.BackgroundServices;

/// <summary>What one run of the top-up did, for its one summary line.</summary>
public sealed record RosterTopUpRun(int Tenants, int Participants, int Patterns, int ShiftsCreated, int ParticipantsNotReady, int Failures);

/// <summary>
/// Keeps the open shifts of the patterns an approved agreement made generated eight weeks ahead (plan builder, phase D). Approval generates the first eight weeks at once; this carries the horizon
/// forward, so the roster board does not run dry after it, until each agreement ends. Same shape as <see cref="NotificationDispatchBackgroundService"/> and the other hosted services: a fresh DI scope per
/// run, a Task.Delay loop, logging and cancellation, and, because it runs outside an HTTP request with no tenant claim, a hand-built <see cref="OdipDbContext"/> for the organisations it reads across
/// (a SuperAdmin-scoped context, read-only) and then one tenant-scoped context for each organisation it works in, as the dispatcher does.
/// <para>
/// It ticks hourly and does an organisation's work once for each of that organisation's provider days (the provider's calendar date, not the UTC date): the day it has done is remembered in memory,
/// so a restart does it again, which is harmless because <see cref="RosterShiftGenerator"/> makes a shift only where there is none. For every organisation it finds the active agreement-made patterns
/// (<c>SourceDraftId</c> set, active, not ended), asks <see cref="IRosterPlacementGate"/> whether each participant may be rostered (a participant who is not is skipped and counted: the next day brings
/// them in once they are), and EXTENDS each pattern to the provider's today plus <c>RosterTopUp:HorizonDays</c> (56), held to its end: from the day after the last day a generation reached for it
/// (<see cref="ShiftPattern.GeneratedThrough"/>, and today at the earliest). It never fills a hole behind that day, so a shift a coordinator deleted stays deleted (a Generate over its day makes it
/// again). A hand-made or demo pattern (no source), an ended pattern and a switched-off pattern are never read. One participant's failure is logged and counted and does not stop the rest, and the
/// organisation's day is only marked done when nobody failed (a failure is tried again at the next tick, which is cheap: what is generated is not asked for again). <c>RosterTopUp:Enabled</c> (default
/// true) switches it off.
/// </para>
/// </summary>
public sealed class RosterTopUpBackgroundService : BackgroundService
{
    private static readonly TimeSpan FirstRunDelay = TimeSpan.FromMinutes(1);
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<RosterTopUpBackgroundService> _logger;
    private readonly TimeProvider _clock;
    private readonly object _gate = new();
    private readonly Dictionary<Guid, DateOnly> _doneOn = new();

    public RosterTopUpBackgroundService(IServiceScopeFactory scopeFactory, IConfiguration config, ILogger<RosterTopUpBackgroundService> logger, TimeProvider? clock = null)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
        _clock = clock ?? TimeProvider.System;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var options = RosterTopUpOptions.From(_config);
        if (!options.Enabled)
        {
            _logger.LogInformation("Roster top-up is off (RosterTopUp:Enabled is false): open shifts for agreement patterns are made at approval and by the Generate button only");
            return;
        }

        _logger.LogInformation("Roster top-up is on: first run in {Delay}, then every {Interval}, keeping {Days} days of open shifts for agreement patterns", FirstRunDelay, Interval, options.HorizonDays);
        var delay = FirstRunDelay;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(delay, stoppingToken);
                await RunOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                // A BackgroundService that throws takes the host down in .NET 8: whatever a run met is logged, and the next hour tries again.
                _logger.LogError(ex, "Roster top-up failed unexpectedly; the next run will try again");
            }

            delay = Interval;
        }
    }

    /// <summary>One run: every organisation with agreement patterns that has not been done on its own provider day. Never throws for one organisation's or participant's failure; counts it.</summary>
    public async Task<RosterTopUpRun> RunOnceAsync(CancellationToken ct)
    {
        var options = RosterTopUpOptions.From(_config);
        using var scope = _scopeFactory.CreateScope();
        var dbOptions = scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>();
        var gate = scope.ServiceProvider.GetRequiredService<IRosterPlacementGate>();
        var generator = scope.ServiceProvider.GetService<RosterShiftGenerator>() ?? new RosterShiftGenerator();

        // The organisations that have an agreement pattern that could still be live (a day of slack on "not ended": which provider day it is depends on the organisation's own zone, decided below).
        var utcToday = DateOnly.FromDateTime(_clock.GetUtcNow().UtcDateTime);
        var floor = utcToday.AddDays(-1);
        List<Guid> tenantIds;
        await using (var across = new OdipDbContext(dbOptions, new ScopedTenantOverride { IsSuperAdmin = true }))
        {
            tenantIds = await across.ShiftPatterns.AsNoTracking()
                .Where(p => p.SourceDraftId != null && p.IsActive && (p.EffectiveTo == null || p.EffectiveTo >= floor))
                .Select(p => p.TenantId).Distinct().ToListAsync(ct);
        }

        int tenants = 0, participants = 0, patternsSeen = 0, created = 0, notReady = 0, failures = 0;
        foreach (var tenantId in tenantIds)
        {
            try
            {
                await using var db = new OdipDbContext(dbOptions, new ScopedTenantOverride { TenantId = tenantId });
                var provider = ProviderTimeZoneResolver.FromState(await db.ProviderSettings.Where(p => p.TenantId == tenantId).Select(p => p.State).FirstOrDefaultAsync(ct));
                var today = ProviderLocalTime.TodayIn(_clock.GetUtcNow().UtcDateTime, provider.Zone);
                lock (_gate) { if (_doneOn.TryGetValue(tenantId, out var done) && done == today) continue; }

                var patterns = await db.ShiftPatterns.AsNoTracking()
                    .Where(p => p.SourceDraftId != null && p.IsActive && (p.EffectiveTo == null || p.EffectiveTo >= today)).ToListAsync(ct);
                var tenantFailures = 0;
                if (patterns.Count > 0)
                {
                    tenants++;
                    patternsSeen += patterns.Count;
                    var horizon = today.AddDays(options.HorizonDays);
                    foreach (var forParticipant in patterns.GroupBy(p => p.ParticipantId))
                    {
                        participants++;
                        try
                        {
                            // What is due for each pattern: from the day after what it has reached (today at the earliest) to the horizon, within the pattern's own dates. A pattern already taken to the horizon, to its
                            // own end, or one that starts after the horizon has nothing due, and a participant with nothing due is not asked about, locked or saved at all (for the last eight weeks of an agreement
                            // every run used to take the lock, open a transaction and save nothing, and could meet a busy lock for no work).
                            var due = forParticipant.Select(p => (Pattern: p, From: ExtendFrom(p, today))).Where(x => x.From <= horizon && x.From <= (x.Pattern.EffectiveTo ?? DateOnly.MaxValue) && x.Pattern.EffectiveFrom <= horizon).ToList();
                            if (due.Count == 0) continue;
                            if (!await gate.MayPlaceAsync(db, forParticipant.Key, ct)) { notReady++; continue; }
                            // Patterns that share a starting day are generated together.
                            foreach (var window in due.GroupBy(x => x.From))
                            {
                                var generated = await generator.GenerateAsync(db, forParticipant.Key, window.Select(x => x.Pattern.Id).ToList(), window.Key, horizon, ct);
                                created += generated.Created;
                            }
                        }
                        catch (RosterBusyException)
                        {
                            failures++; tenantFailures++;
                            db.ChangeTracker.Clear();
                            _logger.LogWarning("Roster top-up skipped participant {ParticipantId}: another change to their roster was still running; it is tried again at the next tick", forParticipant.Key);
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            failures++; tenantFailures++;
                            db.ChangeTracker.Clear();
                            _logger.LogError(ex, "Roster top-up could not generate shifts for participant {ParticipantId}; the others carry on", forParticipant.Key);
                        }
                    }
                }

                // Done for the provider's day only when nobody failed: a failed participant is tried again at the next tick (the others have nothing due, so that costs little).
                if (tenantFailures == 0) { lock (_gate) { _doneOn[tenantId] = today; } }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                failures++;
                _logger.LogError(ex, "Roster top-up failed for organisation {TenantId}; the others carry on and it is tried again next hour", tenantId);
            }
        }

        var run = new RosterTopUpRun(tenants, participants, patternsSeen, created, notReady, failures);
        if (tenants > 0 || failures > 0)
            _logger.LogInformation("Roster top-up: {Patterns} agreement patterns for {Participants} participants in {Tenants} organisations, {Shifts} shifts created, {NotReady} participants skipped as not ready, {Failures} failures",
                run.Patterns, run.Participants, run.Tenants, run.ShiftsCreated, run.ParticipantsNotReady, run.Failures);
        else
            _logger.LogDebug("Roster top-up: nothing due");
        return run;
    }

    /// <summary>The first day to generate for a pattern: the day after the last one a generation reached for it, and not before today.</summary>
    private static DateOnly ExtendFrom(ShiftPattern pattern, DateOnly today) => pattern.GeneratedThrough is { } through && through >= today ? through.AddDays(1) : today;
}
