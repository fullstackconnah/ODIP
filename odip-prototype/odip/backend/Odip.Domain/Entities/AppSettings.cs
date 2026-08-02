using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// Per-tenant application settings. One row per tenant.
/// </summary>
public class AppSettings : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public int QualificationWarningDays { get; set; } = 30;
}
