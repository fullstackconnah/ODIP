using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Auth.Microsoft;

/// <summary>The Microsoft sign-in indexes and the callback against a real PostgreSQL (EF InMemory cannot see unique or filtered indexes).</summary>
public class MicrosoftSignInPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public MicrosoftSignInPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static User NewUser(Guid tenantId, Guid? tid = null, Guid? oid = null)
    {
        var n = Guid.NewGuid().ToString("N");
        return new User { Id = Guid.NewGuid(), TenantId = tenantId, Username = n, Email = n + "@example.test", FirstName = "A", LastName = "B", Role = UserRole.ReadOnly, MicrosoftTenantId = tid, MicrosoftObjectId = oid };
    }

    private async Task<Guid> NewTenantAsync()
    {
        var (db, id) = await _pg.NewTenantContextAsync();
        await db.DisposeAsync();
        return id;
    }

    [SkippableFact]
    public async Task UserIdentityIndex_UniqueWhenSet_ManyNullsAllowed()
    {
        RequirePostgres();
        var org = await NewTenantAsync();
        var (tid, oid) = (Guid.NewGuid(), Guid.NewGuid());
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        db.Users.AddRange(NewUser(org), NewUser(org), NewUser(org, tid, oid));
        await db.SaveChangesAsync();

        db.Users.Add(NewUser(org, tid, oid));
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(ex.InnerException);
        Assert.Equal(PostgresErrorCodes.UniqueViolation, pg.SqlState);
        Assert.Equal(User.MicrosoftIdentityIndexName, pg.ConstraintName);
    }

    [SkippableFact]
    public async Task LinkTid_UniqueAcrossOrgs()
    {
        RequirePostgres();
        var (a, b) = (await NewTenantAsync(), await NewTenantAsync());
        var tid = Guid.NewGuid();
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        db.MicrosoftTenantLinks.Add(new MicrosoftTenantLink { Id = Guid.NewGuid(), TenantId = a, MicrosoftTenantId = tid, LinkedByUserId = Guid.NewGuid() });
        await db.SaveChangesAsync();

        db.MicrosoftTenantLinks.Add(new MicrosoftTenantLink { Id = Guid.NewGuid(), TenantId = b, MicrosoftTenantId = tid, LinkedByUserId = Guid.NewGuid() });
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(MicrosoftTenantLink.MicrosoftTenantIdIndexName, Assert.IsType<PostgresException>(ex.InnerException).ConstraintName);
    }

    [SkippableFact]
    public async Task Link_OnePerOrg()
    {
        RequirePostgres();
        var a = await NewTenantAsync();
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        db.MicrosoftTenantLinks.Add(new MicrosoftTenantLink { Id = Guid.NewGuid(), TenantId = a, MicrosoftTenantId = Guid.NewGuid(), LinkedByUserId = Guid.NewGuid() });
        await db.SaveChangesAsync();

        db.MicrosoftTenantLinks.Add(new MicrosoftTenantLink { Id = Guid.NewGuid(), TenantId = a, MicrosoftTenantId = Guid.NewGuid(), LinkedByUserId = Guid.NewGuid() });
        var ex = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal(MicrosoftTenantLink.OrganisationIndexName, Assert.IsType<PostgresException>(ex.InnerException).ConstraintName);
    }
}
