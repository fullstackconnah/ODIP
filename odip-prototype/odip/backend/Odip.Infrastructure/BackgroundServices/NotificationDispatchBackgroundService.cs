using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications.Templates;

namespace Odip.Infrastructure.BackgroundServices;

/// <summary>
/// Drains <see cref="NotificationOutbox"/>. Same shape as
/// <see cref="HolidaySyncBackgroundService"/>: constructor injection of
/// IServiceScopeFactory/IConfiguration/ILogger&lt;T&gt;, a Task.Delay loop, a fresh DI scope
/// per tick. See docs/specs/2026-09-08-notifications-design.md §3 for the full per-tick
/// algorithm and every ruling below.
///
/// Single-instance constraint: no distributed lock, no SELECT ... FOR UPDATE SKIP LOCKED — the
/// dispatcher assumes exactly one running instance, matching today's single-API-container
/// deployment. Revisit before scaling to more than one replica (see spec §3).
/// </summary>
public class NotificationDispatchBackgroundService : BackgroundService
{
    private static readonly int[] BackoffMinutes = { 1, 5, 15, 60, 240 };
    private const int MaxAttempts = 5;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _config;
    private readonly ILogger<NotificationDispatchBackgroundService> _logger;

    public NotificationDispatchBackgroundService(
        IServiceScopeFactory scopeFactory,
        IConfiguration config,
        ILogger<NotificationDispatchBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var intervalSeconds = _config.GetValue("Notifications:DispatchIntervalSeconds", 30);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunTickAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Notification dispatch tick failed unexpectedly");
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

    public async Task RunTickAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var dbOptions = scope.ServiceProvider.GetRequiredService<DbContextOptions<OdipDbContext>>();
        // v1 outbox rows carry no Channel of their own — every row is dispatched over email
        // (design spec §3 step d: "Render the template, call SmtpEmailChannel.SendAsync").
        // SmsChannel is still registered in DI (below) so the app never fails to resolve
        // INotificationChannel — it just isn't reached by this dispatcher in v1.
        var emailChannel = scope.ServiceProvider.GetServices<INotificationChannel>()
            .First(c => c.Kind == NotificationChannelKind.Email);

        var batchSize = _config.GetValue("Notifications:BatchSize", 50);
        var enabled = _config.GetValue("Notifications:Enabled", false);
        var baseUrl = _config.GetValue<string>("Notifications:PublicBaseUrl") ?? string.Empty;

        // 1. Batch-select (superadmin-scoped context, read-only): Pending rows due now, capped
        // and ordered oldest-first.
        await using var readDb = new OdipDbContext(dbOptions, new Notifications.ScopedTenantOverride { IsSuperAdmin = true });
        var now = DateTime.UtcNow;
        var batch = await readDb.NotificationOutbox
            .Where(o => o.Status == NotificationOutboxStatus.Pending && o.NextAttemptAt <= now)
            .OrderBy(o => o.CreatedAt)
            .Take(batchSize)
            .ToListAsync(ct);

        if (batch.Count == 0) return;

        // 2. Kill switch — rows stay Pending, never dropped, never even looked at further.
        if (!enabled)
        {
            _logger.LogInformation("Notifications:Enabled is false — leaving {Count} pending rows untouched", batch.Count);
            return;
        }

        // 3. Group by TenantId; one tenant-scoped OdipDbContext per group.
        foreach (var group in batch.GroupBy(o => o.TenantId))
        {
            await using var tenantDb = new OdipDbContext(dbOptions, new Notifications.ScopedTenantOverride { TenantId = group.Key });
            foreach (var row in group)
            {
                // Re-attach the row to this tenant-scoped context so field updates persist via
                // this context's SaveChangesAsync.
                var tracked = await tenantDb.NotificationOutbox.FirstOrDefaultAsync(o => o.Id == row.Id, ct);
                if (tracked is null) continue;

                await ProcessRowAsync(tenantDb, tracked, emailChannel, baseUrl, ct);
            }

            await tenantDb.SaveChangesAsync(ct); // one SaveChangesAsync per tenant-group, not per row
        }
    }

    private async Task ProcessRowAsync(
        OdipDbContext db, NotificationOutbox row, INotificationChannel emailChannel, string baseUrl, CancellationToken ct)
    {
        // a. Resolve the recipient User (tenant-scoped query).
        var recipient = await db.Users.FirstOrDefaultAsync(u => u.Id == row.RecipientUserId, ct);
        if (recipient is null)
        {
            row.Status = NotificationOutboxStatus.Skipped;
            row.LastError = "Recipient not found";
            return;
        }

        // b. Resolve the effective preference for (RecipientUserId, EventType, Email) — an
        // explicit disabled row skips; absence means default ON.
        var preference = await db.NotificationPreferences.FirstOrDefaultAsync(
            p => p.UserId == row.RecipientUserId && p.EventType == row.EventType
                 && p.Channel == NotificationChannelKind.Email, ct);
        if (preference is not null && !preference.Enabled)
        {
            row.Status = NotificationOutboxStatus.Skipped;
            row.LastError = "User preference disabled";
            return;
        }

        // c. User.Email is never null by the entity's own definition — empty means no email.
        if (string.IsNullOrWhiteSpace(recipient.Email))
        {
            row.Status = NotificationOutboxStatus.Skipped;
            row.LastError = "Recipient has no email address";
            return;
        }

        // d. Render the template, call the email channel.
        NotificationMessage message;
        try
        {
            message = RenderTemplate(row.EventType, row.PayloadJson, baseUrl);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to render template for outbox row {Id} ({EventType})", row.Id, row.EventType);
            row.Status = NotificationOutboxStatus.Failed;
            row.LastError = $"Template render failed: {ex.Message}";
            return;
        }

        var result = await emailChannel.SendAsync(message, ct);
        ApplyResult(db, row, result, message.RecipientAddress);
    }

    private void ApplyResult(OdipDbContext db, NotificationOutbox row, ChannelSendResult result, string recipientAddress)
    {
        switch (result.Outcome)
        {
            case ChannelSendOutcome.Sent:
                row.Status = NotificationOutboxStatus.Sent;
                row.SentAt = DateTime.UtcNow;
                row.LastError = null;
                db.NotificationLogs.Add(new NotificationLog
                {
                    Id = Guid.NewGuid(),
                    OutboxId = row.Id,
                    Channel = NotificationChannelKind.Email,
                    ProviderMessageId = result.ProviderMessageId,
                    SentAt = row.SentAt.Value,
                    RecipientAddress = recipientAddress,
                });
                break;

            case ChannelSendOutcome.TransientFailure:
                row.Attempts += 1;
                if (row.Attempts >= MaxAttempts)
                {
                    row.Status = NotificationOutboxStatus.Failed;
                    row.LastError = result.Reason;
                }
                else
                {
                    var backoffIndex = Math.Min(row.Attempts - 1, BackoffMinutes.Length - 1);
                    row.NextAttemptAt = DateTime.UtcNow.AddMinutes(BackoffMinutes[backoffIndex]);
                    row.LastError = result.Reason;
                }
                break;

            case ChannelSendOutcome.PermanentFailure:
                row.Status = NotificationOutboxStatus.Failed;
                row.LastError = result.Reason;
                break;

            case ChannelSendOutcome.NotSupported:
            case ChannelSendOutcome.Skipped:
                row.Status = NotificationOutboxStatus.Skipped;
                row.LastError = result.Reason;
                break;
        }
    }

    private static NotificationMessage RenderTemplate(NotificationEventType type, string payloadJson, string baseUrl) =>
        type switch
        {
            NotificationEventType.LeaveRequestSubmitted =>
                LeaveRequestSubmittedTemplate.Render(Deserialize<LeaveRequestSubmittedPayload>(payloadJson), baseUrl),
            NotificationEventType.LeaveRequestDecided =>
                LeaveRequestDecidedTemplate.Render(Deserialize<LeaveRequestDecidedPayload>(payloadJson), baseUrl),
            NotificationEventType.ShiftAssigned =>
                ShiftAssignedTemplate.Render(Deserialize<ShiftAssignedPayload>(payloadJson), baseUrl),
            NotificationEventType.ShiftCompletionPendingReview =>
                ShiftCompletionPendingReviewTemplate.Render(Deserialize<ShiftCompletionPendingReviewPayload>(payloadJson), baseUrl),
            NotificationEventType.ShiftCompletionReturned =>
                ShiftCompletionReturnedTemplate.Render(Deserialize<ShiftCompletionReturnedPayload>(payloadJson), baseUrl),
            NotificationEventType.WitnessRequested =>
                WitnessRequestedTemplate.Render(Deserialize<WitnessRequestedPayload>(payloadJson), baseUrl),
            NotificationEventType.CaregiverSubmissionReceived =>
                CaregiverSubmissionReceivedTemplate.Render(Deserialize<CaregiverSubmissionReceivedPayload>(payloadJson), baseUrl),
            NotificationEventType.IncidentReported =>
                IncidentReportedTemplate.Render(Deserialize<IncidentReportedPayload>(payloadJson), baseUrl),
            _ => throw new NotSupportedException($"No template registered for event type {type}"),
        };

    private static T Deserialize<T>(string json) =>
        JsonSerializer.Deserialize<T>(json) ?? throw new InvalidOperationException($"Could not deserialise payload as {typeof(T).Name}");
}
