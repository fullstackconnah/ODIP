using Microsoft.AspNetCore.Http;
using Odip.Domain.Interfaces;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Reads the current tenant from the JWT "tenant_id" claim via IHttpContextAccessor.
/// When a SuperAdmin sends X-View-As-Tenant header, scopes them to that tenant.
/// When X-View-As-User header is also present, sets ViewAsUserId for per-user scoping.
/// Registered as Scoped in DI — one instance per HTTP request.
/// </summary>
public sealed class CurrentTenant : ICurrentTenant
{
    public Guid? TenantId { get; private set; }
    public bool IsSuperAdmin { get; private set; }
    public Guid? ViewAsUserId { get; private set; }

    public CurrentTenant(IHttpContextAccessor accessor)
    {
        var user = accessor.HttpContext?.User;
        var claim = user?.FindFirst("tenant_id")?.Value;
        TenantId = Guid.TryParse(claim, out var parsed) ? parsed : null;
        IsSuperAdmin = user?.IsInRole("SuperAdmin") ?? false;

        // Store original SuperAdmin state before tenant override may clear it
        var wasSuperAdmin = IsSuperAdmin;

        // SuperAdmin header override: scope to a specific tenant for this request
        if (IsSuperAdmin)
        {
            var header = accessor.HttpContext?.Request.Headers["X-View-As-Tenant"].FirstOrDefault();
            if (Guid.TryParse(header, out var overrideTenant))
            {
                TenantId = overrideTenant;
                IsSuperAdmin = false;
            }
        }

        // User-level view-as: only a SuperAdmin who has scoped to a tenant may set this.
        // Note: ViewAsUserId is accepted without validating that the user belongs to the selected
        // tenant. This is safe while ViewAsUserId has no backend consumers; add validation
        // (e.g. a DB lookup) before using it in query filters or audit logs.
        if (wasSuperAdmin && TenantId.HasValue)
        {
            var userHeader = accessor.HttpContext?.Request.Headers["X-View-As-User"].FirstOrDefault();
            if (Guid.TryParse(userHeader, out var viewUserId))
                ViewAsUserId = viewUserId;
        }
    }
}
