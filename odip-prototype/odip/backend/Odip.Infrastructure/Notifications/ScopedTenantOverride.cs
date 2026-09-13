using Odip.Domain.Interfaces;

namespace Odip.Infrastructure.Notifications;

/// <summary>
/// A plain, non-HTTP <see cref="ICurrentTenant"/> the notification dispatcher passes directly
/// into a hand-built <c>new OdipDbContext(dbOptions, new ScopedTenantOverride { ... })</c> — the
/// dispatcher runs outside the HTTP pipeline, so there is no ambient JWT for the real
/// <see cref="Odip.Infrastructure.Services.CurrentTenant"/> to read. Never registered in DI —
/// no risk of leaking into request-scoped resolution.
/// docs/specs/2026-09-08-notifications-design.md §3.
/// </summary>
public sealed class ScopedTenantOverride : ICurrentTenant
{
    public Guid? TenantId { get; init; }
    public bool IsSuperAdmin { get; init; }
    public Guid? ViewAsUserId { get; init; }
}
