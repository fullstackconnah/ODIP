using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A date the organisation must keep up with (Settings > Compliance dates): a registration, an audit, an insurance policy or a key personnel check. The nightly scan raises an Admin task from
/// 90 days before <see cref="ExpiresOn"/>. A <see cref="ComplianceKind.KeyPersonnel"/> label is a person's name, so it is never logged. Deleting one is a real delete; its task closes with it.
/// </summary>
public class ComplianceItem : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public ComplianceKind Kind { get; set; }
    public string Label { get; set; } = string.Empty;
    /// <summary>The last day it is valid; for an audit, the day it is due.</summary>
    public DateOnly ExpiresOn { get; set; }
    /// <summary>A registration, policy or certificate number.</summary>
    public string? Reference { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
