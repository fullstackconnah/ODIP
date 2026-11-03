using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.ProblemReports;

namespace Odip.Infrastructure.BackgroundServices;

/// <summary>
/// Retries the problem reports the controller could not put on the Work Board straight away: every
/// <c>WorkBoard:SendIntervalSeconds</c> (60) it sends the due Saved rows, with the notification outbox's backoff
/// (1, 5, 15, 60, 240 minutes) and five attempts before a row is Failed. The tick follows
/// <see cref="NotificationDispatchBackgroundService"/>: rows are read in a superadmin context and each is written back
/// through a context scoped to its own tenant, one SaveChanges per tenant group. Once a day it removes Sent and Failed
/// reports older than 90 days. Single instance, like the dispatcher.
/// </summary>
public class ProblemReportSendBackgroundService : BackgroundService
{
    private static readonly int[] BackoffMinutes = { 1, 5, 15, 60, 240 };
    private const int MaxAttempts = 5;
    private const int BatchSize = 20;
    private static readonly TimeSpan PerSendLimit = TimeSpan.FromSeconds(30);

    /// <summary>How long a Sent or Failed report is kept, counted from when it was made.</summary>
    public const int RetentionDays = 90;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<ProblemReportSendBackgroundService> _logger;

    public ProblemReportSendBackgroundService(
        IServiceScopeFactory scopeFactory,
        IConfiguration config,
        ILogger<ProblemReportSendBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var intervalSeconds = _config.GetValue("WorkBoard:SendIntervalSeconds", 60);
        var nextPurgeAt = DateTime.MinValue;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunTickAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError("Problem report send tick failed unexpectedly: {ErrorType}", ex.GetType().Name);
            }

            // The purge does not depend on the board being configured: Saved rows are never purged, so only Sent and Failed ones go.
            if (DateTime.UtcNow >= nextPurgeAt)
            {
                try
                {
                    await PurgeExpiredAsync(DateTime.UtcNow, stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogError("Problem report purge failed: {ErrorType}", ex.GetType().Name);
                }
                nextPurgeAt = DateTime.UtcNow.AddDays(1);
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(intervalSeconds), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>Deletes Sent and Failed reports made more than <see cref="RetentionDays"/> days ago, in every organisation, and returns how many went. PostgreSQL only (ExecuteDeleteAsync).</summary>
    public async Task<int> PurgeExpiredAsync(DateTime nowUtc, CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var dbOptions = scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>();
        await using var db = new OdipDbContext(dbOptions, new Notifications.ScopedTenantOverride { IsSuperAdmin = true });
        var cutoff = nowUtc.AddDays(-RetentionDays);
        return await db.ProblemReports.Where(r => r.Status != ProblemReportStatus.Saved && r.CreatedAt < cutoff).ExecuteDeleteAsync(ct);
    }

    public async Task RunTickAsync(CancellationToken ct)
    {
        // Not configured: nothing can be sent, so don't even open a scope or SELECT every tick.
        if (WorkBoardSettings.From(_config) is null) return;

        using var scope = _scopeFactory.CreateScope();
        var dbOptions = scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>();
        var sender = scope.ServiceProvider.GetRequiredService<IProblemReportSender>();

        // Read in a superadmin context. A row read here is never saved through it (the write would not be tenant scoped).
        await using var readDb = new OdipDbContext(dbOptions, new Notifications.ScopedTenantOverride { IsSuperAdmin = true });
        var now = DateTime.UtcNow;
        var batch = await readDb.ProblemReports.AsNoTracking()
            .Where(r => r.Status == ProblemReportStatus.Saved && r.NextAttemptAt <= now)
            .OrderBy(r => r.CreatedAt)
            .Take(BatchSize)
            .Select(r => new { r.Id, r.TenantId })
            .ToListAsync(ct);

        foreach (var group in batch.GroupBy(r => r.TenantId))
        {
            await using var tenantDb = new OdipDbContext(dbOptions, new Notifications.ScopedTenantOverride { TenantId = group.Key });
            foreach (var item in group)
            {
                var row = await tenantDb.ProblemReports.FirstOrDefaultAsync(r => r.Id == item.Id, ct);
                if (row is null || row.Status != ProblemReportStatus.Saved) continue;

                var result = await SendAsync(sender, row, ct);
                if (result.Error == ProblemReportSendResult.NotConfigured) continue;
                Apply(row, result);
            }

            // Saved without the stop token: a card that was made must have its id recorded even as the host shuts down.
            await tenantDb.SaveChangesAsync(CancellationToken.None);
        }
    }

    private static async Task<ProblemReportSendResult> SendAsync(IProblemReportSender sender, ProblemReport row, CancellationToken ct)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(ct);
        limit.CancelAfter(PerSendLimit);
        try
        {
            return await sender.TrySendAsync(row, limit.Token);
        }
        catch (Exception) when (!ct.IsCancellationRequested)
        {
            return new ProblemReportSendResult(false, null, ProblemReportSendResult.UnknownOutcome);
        }
    }

    private void Apply(ProblemReport row, ProblemReportSendResult result)
    {
        if (result.Sent)
        {
            row.Status = ProblemReportStatus.Sent;
            row.CardId = result.CardId;
            row.SentAt = DateTime.UtcNow;
            row.LastError = null;
            return;
        }

        row.Attempts++;
        row.LastError = result.Error;
        if (row.Attempts >= MaxAttempts)
        {
            row.Status = ProblemReportStatus.Failed;
            _logger.LogWarning("Problem report {ReportId} could not be sent after {Attempts} attempts and is marked Failed", row.Id, row.Attempts);
        }
        else
        {
            row.NextAttemptAt = DateTime.UtcNow.AddMinutes(BackoffMinutes[row.Attempts - 1]);
        }
    }
}
