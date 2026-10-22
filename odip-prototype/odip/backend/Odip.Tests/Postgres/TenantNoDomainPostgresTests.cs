using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>The email domain is optional. On a real PostgreSQL the plain unique index must allow many organisations with none, and still refuse a repeated domain.</summary>
public class TenantNoDomainPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public TenantNoDomainPostgresTests(PostgresFixture pg) => _pg = pg;

    [SkippableFact]
    public async Task Two_organisations_with_no_domain_are_allowed_and_a_repeated_domain_is_not()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(cs);
        await db.Database.MigrateAsync();

        db.Tenants.AddRange(
            new Tenant { Id = Guid.NewGuid(), Name = "A", EmailDomain = null },
            new Tenant { Id = Guid.NewGuid(), Name = "B", EmailDomain = null });
        await db.SaveChangesAsync();
        Assert.Equal(2, await db.Tenants.CountAsync(t => t.EmailDomain == null));

        db.Tenants.AddRange(
            new Tenant { Id = Guid.NewGuid(), Name = "C", EmailDomain = "c.example.com" },
            new Tenant { Id = Guid.NewGuid(), Name = "D", EmailDomain = "c.example.com" });
        await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
    }
}
