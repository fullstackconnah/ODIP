using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;

namespace Odip.Tests.Support;

/// <summary>
/// The EF InMemory <see cref="OdipDbContext"/> the controller and service tests build on, with a mocked
/// <see cref="ICurrentTenant"/>. One place to change when the context's constructor does.
/// </summary>
internal static class TestDb
{
    /// <summary>A SuperAdmin context (no tenant filter) on the named InMemory database, or on a fresh one when no name is given.</summary>
    public static OdipDbContext Create(string? dbName = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        return Build(dbName, tenant.Object);
    }

    /// <summary>A context scoped to one tenant (not a SuperAdmin), so the tenant query filters apply.</summary>
    public static OdipDbContext ForTenant(string dbName, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return Build(dbName, tenant.Object);
    }

    private static OdipDbContext Build(string? dbName, ICurrentTenant tenant)
    {
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName ?? Guid.NewGuid().ToString())
            .Options;
        return new OdipDbContext(options, tenant);
    }
}
