namespace Odip.Domain.Entities;

/// <summary>
/// Represents an NDIS service provider organisation.
/// Email domain is used to resolve the tenant at login.
/// </summary>
public class Tenant
{
    public Guid Id { get; set; }

    /// <summary>Display name, e.g. "Ability Options"</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Unique email domain, e.g. "abilityoptions.com.au"</summary>
    public string EmailDomain { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<User> Users { get; set; } = [];
}
