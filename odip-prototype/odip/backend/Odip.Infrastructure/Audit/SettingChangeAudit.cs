using System.Security.Claims;
using System.Text.Json;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Audit;

/// <summary>
/// Builds the audit row for ONE named field change on an entity that is deliberately NOT in
/// <see cref="AuditedEntities.Types"/>. The generic <see cref="AuditInterceptor"/> audits a whole
/// entity (every changed column, old and new), which is the wrong tool for
/// <see cref="ProviderSettings"/>: that row holds the organisation's bank account name, BSB and
/// account number, and those must not be copied into AuditLog. A setting that needs a history (the
/// participant readiness mode) writes exactly this one row instead: old value, new value, who.
/// The JSON shape is the interceptor's own (<c>[{"Field","Old","New"}]</c>), so anything that
/// reads AuditLog.Changes reads this too. Nothing is added to the context: the caller adds the
/// returned row in the same SaveChanges as the change it describes.
/// </summary>
public static class SettingChangeAudit
{
    public static AuditLog ForFieldChange(
        string entityType, Guid entityId, string field, string? oldValue, string? newValue, ClaimsPrincipal? actor)
    {
        Guid? changedById = null;
        string? changedByName = null;

        // Same claims, in the same order, as AuditInterceptor.BuildAuditEntries.
        if (actor?.Identity?.IsAuthenticated == true)
        {
            if (Guid.TryParse(actor.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId))
                changedById = userId;
            changedByName = actor.FindFirst("fullName")?.Value ?? actor.FindFirst(ClaimTypes.Name)?.Value;
        }

        return new AuditLog
        {
            Id = Guid.NewGuid(),
            EntityType = entityType,
            EntityId = entityId,
            Action = AuditAction.Updated,
            ChangedAt = DateTimeOffset.UtcNow,
            ChangedById = changedById,
            ChangedByName = changedByName,
            Changes = JsonSerializer.Serialize(new[] { new FieldChange(field, oldValue, newValue) }),
        };
    }
}
