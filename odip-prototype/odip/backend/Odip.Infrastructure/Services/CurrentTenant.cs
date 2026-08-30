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
        // Note: ViewAsUserId is accepted here without validating that the user belongs to the
        // selected tenant. Its first real consumer is
        // Odip.Api.Controllers.PortalController.ResolveCurrentStaffIdAsync, which prefers
        // ViewAsUserId over the caller's own JWT subject to resolve the viewed user's linked
        // Staff record. That's safe as-is because of the ordering above: ViewAsUserId is only
        // ever populated when `wasSuperAdmin && TenantId.HasValue` — i.e. only AFTER
        // X-View-As-Tenant has already forced IsSuperAdmin=false and overridden TenantId to the
        // selected tenant. PortalController looks the viewed user up via `_db.Users`, and
        // User's tenant query filter (`IsSuperAdmin || TenantId == _tenant.TenantId`) still
        // applies at that point — IsSuperAdmin is false and TenantId is the override — so an
        // out-of-tenant ViewAsUserId simply resolves to no row (null StaffId / not-linked),
        // never a cross-tenant read. This does NOT generalise: any future consumer that reads
        // ViewAsUserId directly against a query that bypasses the Users tenant filter (a raw
        // SQL query, `IgnoreQueryFilters()`, or a non-ITenantEntity table keyed by user id)
        // would need its own validation that the viewed user actually belongs to TenantId
        // before trusting this value.
        if (wasSuperAdmin && TenantId.HasValue)
        {
            var userHeader = accessor.HttpContext?.Request.Headers["X-View-As-User"].FirstOrDefault();
            if (Guid.TryParse(userHeader, out var viewUserId))
                ViewAsUserId = viewUserId;
        }
    }
}
