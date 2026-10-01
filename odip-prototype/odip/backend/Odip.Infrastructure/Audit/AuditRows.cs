using System.Security.Claims;
using System.Text.Json;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Audit;

/// <summary>
/// Hand-built audit rows, in the exact shape <see cref="AuditInterceptor"/> writes (one JSON array of field, old, new objects in
/// <see cref="AuditLog.Changes"/>, the same actor claims), for the rare change that must be recorded WITHOUT auditing the whole entity.
/// The interceptor records every changed field of an audited entity, so an entity that also holds sensitive columns (ProviderSettings holds the
/// provider bank details) cannot be added to <see cref="AuditedEntities"/>; the one change that matters is written as a single-field row instead.
/// </summary>
public static class AuditRows
{
    /// <summary>
    /// A single-field <see cref="AuditAction.Updated"/> row: <paramref name="field"/> went from <paramref name="oldValue"/> to
    /// <paramref name="newValue"/>. The actor is read from the principal exactly as the interceptor reads it (the name identifier claim as the id, the
    /// <c>fullName</c> or name claim as the name); an unauthenticated or missing principal leaves both empty. The caller adds the row to the context so
    /// it is saved with the change it describes, in the same transaction.
    /// </summary>
    public static AuditLog FieldChanged(
        string entityType, Guid entityId, string field, string? oldValue, string? newValue, ClaimsPrincipal? actor, DateTimeOffset? at = null)
    {
        Guid? actorId = null;
        string? actorName = null;
        if (actor?.Identity?.IsAuthenticated == true)
        {
            if (Guid.TryParse(actor.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var id)) actorId = id;
            actorName = actor.FindFirst("fullName")?.Value ?? actor.FindFirst(ClaimTypes.Name)?.Value;
        }

        return new AuditLog
        {
            Id = Guid.NewGuid(),
            EntityType = entityType,
            EntityId = entityId,
            Action = AuditAction.Updated,
            ChangedAt = at ?? DateTimeOffset.UtcNow,
            ChangedById = actorId,
            ChangedByName = actorName,
            Changes = JsonSerializer.Serialize(new[] { new FieldChange(field, oldValue, newValue) }),
        };
    }
}
