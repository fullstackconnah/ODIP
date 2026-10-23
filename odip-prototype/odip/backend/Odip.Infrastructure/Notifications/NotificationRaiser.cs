using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Interfaces;
using Odip.Domain.Notifications;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Notifications;

/// <summary>
/// See <see cref="INotificationRaiser"/>. Takes the caller's own tracked <see cref="OdipDbContext"/>
/// — same context, so "same SaveChanges" needs no explicit transaction plumbing. Beside each outbox row it adds the
/// recipient's bell row (<see cref="Odip.Domain.Notifications.InAppNotification"/>), which shares the dedupe and the save.
///
/// TenantId is resolved per-recipient (via <c>Users.IgnoreQueryFilters()</c>) rather than left
/// to <see cref="OdipDbContext.SaveChangesAsync"/>'s ambient auto-stamp: one v1 trigger
/// (<c>CaregiverController.Submit</c>) raises with no authenticated principal at all — ambient
/// <c>ICurrentTenant.TenantId</c> is null there, so the auto-stamp would silently leave
/// <see cref="NotificationOutbox.TenantId"/> at its default (empty Guid). Resolving from the
/// recipient's own row is correct in every case (an authenticated caller's recipients are
/// already same-tenant Users query results) and doesn't depend on the caller's tenant context
/// at all.
/// </summary>
public sealed class NotificationRaiser : INotificationRaiser
{
    private readonly OdipDbContext _db;

    public NotificationRaiser(OdipDbContext db)
    {
        _db = db;
    }

    public async Task RaiseAsync(NotificationEventType type, string entityType, Guid entityId,
        IEnumerable<Guid> recipientUserIds, object payload, CancellationToken ct = default, bool dedupe = true)
    {
        var payloadJson = JsonSerializer.Serialize(payload);
        // The bell's text: one per event, the same for every recipient (the payload's own RecipientEmail never reaches it).
        var (title, linkTo) = InAppNotificationText.Build(type, entityId, payload);
        // 5-minute sliding dedupe window (design spec §1) — a double-click or retry-on-transient-
        // error re-submitting the same action must not raise a second row for the same triple.
        var cutoff = DateTime.UtcNow.AddMinutes(-5);

        foreach (var recipientId in recipientUserIds.Distinct())
        {
            // The newest notice this person already has about this entity, inside the window. The same kind again is a double-click or a retry, and is dropped;
            // a different kind is news (a shift's worker put on, taken off and put back within five minutes must still end with "on").
            // IgnoreQueryFilters: this must see prior rows whatever the calling context's tenant (it may be null/anonymous, e.g. CaregiverController).
            var newest = await _db.NotificationOutbox.IgnoreQueryFilters()
                .Where(o => o.EntityId == entityId && o.RecipientUserId == recipientId && o.CreatedAt >= cutoff)
                .OrderByDescending(o => o.CreatedAt)
                .Select(o => (NotificationEventType?)o.EventType)
                .FirstOrDefaultAsync(ct);
            if (dedupe && newest == type) continue;

            // Select an anonymous projection (not just .Select(u => u.TenantId)) so a missing
            // user (null result) is distinguishable from a found user whose TenantId happens to
            // be Guid.Empty — the latter is a legitimate value in tenant-agnostic test fixtures
            // and must not be treated as "not found".
            var recipientUser = await _db.Users.IgnoreQueryFilters()
                .Where(u => u.Id == recipientId)
                .Select(u => new { u.TenantId })
                .FirstOrDefaultAsync(ct);
            // Recipient must resolve to a real user to know which tenant owns this outbox row —
            // every v1 caller resolves recipientUserIds from an active Users query before
            // calling RaiseAsync, so this is defensive, not an expected path.
            if (recipientUser is null) continue;

            _db.NotificationOutbox.Add(new NotificationOutbox
            {
                Id = Guid.NewGuid(),
                TenantId = recipientUser.TenantId,
                EventType = type,
                EntityType = entityType,
                EntityId = entityId,
                RecipientUserId = recipientId,
                PayloadJson = payloadJson,
                Status = NotificationOutboxStatus.Pending,
                NextAttemptAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow,
            });

            // The bell row (dashboard spec 2026-10-14): beside the outbox row, so it shares the dedupe above and the caller's
            // SaveChanges. It is written above the dispatcher's Notifications:Enabled gate and whatever the recipient's email
            // preference (preferences are email-only), so live ODIP, which sends no email, still shows every event.
            _db.InAppNotifications.Add(new InAppNotification
            {
                Id = Guid.NewGuid(),
                TenantId = recipientUser.TenantId,
                RecipientUserId = recipientId,
                EventType = type,
                EntityType = entityType,
                EntityId = entityId,
                Title = title,
                LinkTo = linkTo,
                CreatedAt = DateTime.UtcNow,
            });
        }

        // Deliberately no SaveChangesAsync here — the caller's own existing SaveChangesAsync
        // commits these rows atomically with the domain write (ruling 4).
    }
}
