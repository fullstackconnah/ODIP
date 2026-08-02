using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

public class AuditLog
{
    public Guid Id { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public Guid EntityId { get; set; }
    public AuditAction Action { get; set; }
    public DateTimeOffset ChangedAt { get; set; }
    public Guid? ChangedById { get; set; }
    public string? ChangedByName { get; set; }
    /// <summary>JSON array of { field, old, new } objects.</summary>
    public string Changes { get; set; } = "[]";
}
