using Odip.Domain.Notifications;

namespace Odip.Application.Interfaces;

/// <summary>
/// Writes <see cref="NotificationOutbox"/> rows for a domain event, deduped per
/// (EventType, EntityId, RecipientUserId) within a 5-minute sliding window. Takes the SAME
/// <see cref="Odip.Infrastructure.Data.OdipDbContext"/> the calling controller action already
/// has injected — it never calls <c>SaveChangesAsync</c> itself, so the caller's own existing
/// save commits the outbox rows atomically with the domain write (transactional outbox,
/// docs/specs/2026-09-08-notifications-design.md ruling 4).
/// </summary>
public interface INotificationRaiser
{
    Task RaiseAsync(NotificationEventType type, string entityType, Guid entityId,
        IEnumerable<Guid> recipientUserIds, object payload, CancellationToken ct = default);
}
