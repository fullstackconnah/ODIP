namespace Odip.Domain.Interfaces;

/// <summary>
/// Marks a root aggregate entity as tenant-scoped.
/// OdipDbContext.SaveChangesAsync auto-populates TenantId from ICurrentTenant.
/// </summary>
public interface ITenantEntity
{
    Guid TenantId { get; set; }
}
