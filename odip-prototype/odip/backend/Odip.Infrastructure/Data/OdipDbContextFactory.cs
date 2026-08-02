using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Odip.Domain.Interfaces;

namespace Odip.Infrastructure.Data;

/// <summary>
/// Design-time factory used by EF Core tooling (dotnet ef migrations add/update).
/// Provides a stub ICurrentTenant so the DbContext can be constructed without
/// the full DI container being available.
/// </summary>
public class OdipDbContextFactory : IDesignTimeDbContextFactory<OdipDbContext>
{
    public OdipDbContext CreateDbContext(string[] args)
    {
        var optionsBuilder = new DbContextOptionsBuilder<OdipDbContext>();

        var connectionString =
            Environment.GetEnvironmentVariable("POSTGRES_CONNECTION_STRING")
            ?? throw new InvalidOperationException(
                "Set POSTGRES_CONNECTION_STRING before running dotnet ef commands.");

        optionsBuilder.UseNpgsql(connectionString);

        return new OdipDbContext(optionsBuilder.Options, new DesignTimeTenant());
    }

    /// <summary>
    /// Stub tenant used only during design-time operations (migrations).
    /// Acts as SuperAdmin so no query filters interfere with schema generation.
    /// </summary>
    private sealed class DesignTimeTenant : ICurrentTenant
    {
        public Guid? TenantId => null;
        public bool IsSuperAdmin => true;
        public Guid? ViewAsUserId => null;
    }
}
