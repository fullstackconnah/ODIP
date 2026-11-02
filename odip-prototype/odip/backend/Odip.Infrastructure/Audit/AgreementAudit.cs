using System.Text.Json;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Audit;

/// <summary>
/// The audit row for a service agreement revision being deleted or ended early. <see cref="ServiceAgreementDraft"/> is deliberately not in <see cref="AuditedEntities.Types"/> (an immutable
/// revision with large JSON columns), so these two actions write one row of their own, in the same SaveChanges as the change: the reason as one field, who and when.
/// </summary>
internal static class AgreementAudit
{
    public static AuditLog Row(Guid draftId, AuditAction action, string reason, ApprovalCaller caller, DateTimeOffset at) => new()
    {
        Id = Guid.NewGuid(), EntityType = nameof(ServiceAgreementDraft), EntityId = draftId, Action = action, ChangedAt = at,
        ChangedById = caller.UserId, ChangedByName = caller.Name,
        Changes = JsonSerializer.Serialize(new[] { new FieldChange("Reason", null, reason) }),
    };
}
