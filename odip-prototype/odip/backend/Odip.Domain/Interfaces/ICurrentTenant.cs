namespace Odip.Domain.Interfaces;

/// <summary>
/// Provides the tenant context for the current HTTP request.
/// Resolved from the JWT "tenant_id" claim.
/// SuperAdmin users have TenantId = null and IsSuperAdmin = true.
/// </summary>
public interface ICurrentTenant
{
    /// <summary>The current tenant's Guid, or null for SuperAdmin users.</summary>
    Guid? TenantId { get; }

    /// <summary>True when the authenticated user has the SuperAdmin role.</summary>
    bool IsSuperAdmin { get; }

    /// <summary>
    /// Set when a SuperAdmin is viewing as a specific user via X-View-As-User header.
    /// Null when not impersonating.
    /// </summary>
    Guid? ViewAsUserId { get; }
}
