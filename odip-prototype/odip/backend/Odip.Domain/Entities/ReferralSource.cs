using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// One entry on an organisation's list of who sends it enquiries (Settings > Content > Referral sources). An enquiry points at one by id, so a rename flows
/// through; "remove" is <see cref="IsActive"/> = false, never a delete, so old enquiries keep their label.
/// </summary>
public class ReferralSource : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
