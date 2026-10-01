using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Infrastructure.Audit;

public sealed class AuditInterceptor : SaveChangesInterceptor
{
    /// <summary>
    /// HttpContext.Items key an anonymous request handler may set to attribute audit rows when
    /// there is no authenticated principal — used by the public caregiver form ("caregiver:{name}").
    /// Ignored whenever a real user is authenticated.
    /// </summary>
    public const string ActorItemKey = "AuditActor";

    /// <summary>
    /// HttpContext.Items key under which a request handler may leave a free-text reason for the change it is making to ONE entity.
    /// The reason is recorded as a "Reason" field on that entity's audit row (the same row, not a second one), so the history of
    /// "why was this participant archived" sits next to what changed. Keyed by the entity's id, so a save that touches several
    /// audited entities attaches the reason only to the one it belongs to.
    /// </summary>
    public static string ReasonItemKey(Guid entityId) => $"AuditReason:{entityId:N}";

    private readonly IHttpContextAccessor _httpContextAccessor;

    public AuditInterceptor(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        if (eventData.Context is not null)
        {
            var auditEntries = BuildAuditEntries(eventData.Context);
            if (auditEntries.Count > 0)
                eventData.Context.Set<AuditLog>().AddRange(auditEntries);
        }

        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }

    private List<AuditLog> BuildAuditEntries(DbContext context)
    {
        var user = _httpContextAccessor.HttpContext?.User;
        Guid? changedById = null;
        string? changedByName = null;

        if (user?.Identity?.IsAuthenticated == true)
        {
            var idClaim = user.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (Guid.TryParse(idClaim, out var userId))
                changedById = userId;

            changedByName = user.FindFirst("fullName")?.Value
                ?? user.FindFirst(System.Security.Claims.ClaimTypes.Name)?.Value;
        }
        else if (_httpContextAccessor.HttpContext?.Items.TryGetValue(ActorItemKey, out var actor) == true
                 && actor is string actorName && !string.IsNullOrWhiteSpace(actorName))
        {
            changedByName = actorName;
        }

        var entries = new List<AuditLog>();
        var now = DateTimeOffset.UtcNow;

        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (!AuditedEntities.Types.Contains(entry.Entity.GetType())) continue;
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)) continue;

            var entityId = GetEntityId(entry);
            if (entityId == Guid.Empty) continue;

            var action = entry.State switch
            {
                EntityState.Added => AuditAction.Created,
                EntityState.Deleted => AuditAction.Deleted,
                _ => AuditAction.Updated
            };

            var changes = BuildChanges(entry);
            // Skip Updated entries with no actual field changes (e.g. spurious EF tracking)
            if (action == AuditAction.Updated && changes.Count == 0) continue;

            if (action == AuditAction.Updated
                && _httpContextAccessor.HttpContext?.Items.TryGetValue(ReasonItemKey(entityId), out var reasonValue) == true
                && reasonValue is string reason && !string.IsNullOrWhiteSpace(reason))
                changes.Add(new FieldChange("Reason", null, reason.Trim()));

            entries.Add(new AuditLog
            {
                Id = Guid.NewGuid(),
                EntityType = entry.Entity.GetType().Name,
                EntityId = entityId,
                Action = action,
                ChangedAt = now,
                ChangedById = changedById,
                ChangedByName = changedByName,
                Changes = JsonSerializer.Serialize(changes)
            });
        }

        return entries;
    }

    private static Guid GetEntityId(EntityEntry entry)
    {
        var idProp = entry.Properties.FirstOrDefault(p => p.Metadata.Name == "Id");
        if (idProp?.CurrentValue is Guid guid) return guid;
        if (idProp?.OriginalValue is Guid origGuid) return origGuid;
        return Guid.Empty;
    }

    private static List<FieldChange> BuildChanges(EntityEntry entry)
    {
        var changes = new List<FieldChange>();

        foreach (var prop in entry.Properties)
        {
            if (prop.Metadata.Name == "Id") continue;
            if (AuditedEntities.IsExcluded(prop.Metadata.Name)) continue;

            switch (entry.State)
            {
                case EntityState.Added:
                    if (prop.CurrentValue is not null)
                        changes.Add(new FieldChange(prop.Metadata.Name, null, FormatValue(prop.CurrentValue)));
                    break;

                case EntityState.Deleted:
                    if (prop.OriginalValue is not null)
                        changes.Add(new FieldChange(prop.Metadata.Name, FormatValue(prop.OriginalValue), null));
                    break;

                case EntityState.Modified:
                    var orig = FormatValue(prop.OriginalValue);
                    var curr = FormatValue(prop.CurrentValue);
                    if (orig != curr)
                        changes.Add(new FieldChange(prop.Metadata.Name, orig, curr));
                    break;
            }
        }

        return changes;
    }

    private static string? FormatValue(object? value) => value switch
    {
        null => null,
        DateTime dt => dt.ToString("O"),
        DateTimeOffset dto => dto.ToString("O"),
        Enum e => e.ToString(),
        _ => value.ToString()
    };
}

internal record FieldChange(string Field, string? Old, string? New);
