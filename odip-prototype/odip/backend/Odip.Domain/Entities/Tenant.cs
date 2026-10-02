namespace Odip.Domain.Entities;

/// <summary>
/// Represents an NDIS service provider organisation.
/// The email domain does not decide who signs in or into which tenant (the user's own row names the tenant). It is the organisation's usual
/// address domain: an address elsewhere has to be confirmed by the admin, and a caller from another tenant cannot give their staff one at it.
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
