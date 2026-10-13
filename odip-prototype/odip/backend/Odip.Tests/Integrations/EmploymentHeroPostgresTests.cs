using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Integrations;

/// <summary>What EF InMemory cannot show: the filtered unique payroll-id index, one connection per organisation, and (Task 6) the sync on a real database.</summary>
public class EmploymentHeroPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public EmploymentHeroPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static User Person(Guid tenantId, string first, string? payrollId) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = first, LastName = "Lee", Username = $"{first}{Guid.NewGuid():N}",
        Email = $"{first}.{Guid.NewGuid():N}@example.org", Role = UserRole.SupportWorker, ExternalPayrollId = payrollId,
    };

    [SkippableFact]
    public async Task The_payroll_id_is_unique_per_organisation_over_non_null_values_only()
    {
        RequirePostgres();
        var (dbA, tenantA) = await _pg.NewTenantContextAsync();
        var (dbB, tenantB) = await _pg.NewTenantContextAsync();
        await using var _a = dbA;
        await using var _b = dbB;

        // Any number of unlinked people, and the same EH id in two organisations: allowed.
        dbA.Users.AddRange(Person(tenantA, "ann", null), Person(tenantA, "bob", null), Person(tenantA, "cat", "101"));
        dbB.Users.Add(Person(tenantB, "dan", "101"));
        await dbA.SaveChangesAsync();
        await dbB.SaveChangesAsync();

        // The same EH id twice in one organisation: refused by the index.
        dbA.Users.Add(Person(tenantA, "eve", "101"));
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => dbA.SaveChangesAsync());
        var pg = Assert.IsType<PostgresException>(failure.InnerException);
        Assert.Equal("23505", pg.SqlState);
        Assert.Equal(User.ExternalPayrollIdIndexName, pg.ConstraintName);
    }

    [SkippableFact]
    public async Task An_organisation_has_one_connection()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        EmploymentHeroConnection Connection() => new()
        {
            Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = "777", BusinessName = "Acme Care", ApiKeyCiphertext = [1, 2, 3], ApiKeyNonce = new byte[12],
            ConnectedAt = DateTime.UtcNow, ConnectedByName = "Ada Admin",
        };

        db.EmploymentHeroConnections.Add(Connection());
        await db.SaveChangesAsync();
        db.EmploymentHeroConnections.Add(Connection());

        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => db.SaveChangesAsync());
        Assert.Equal("23505", Assert.IsType<PostgresException>(failure.InnerException).SqlState);
    }
}
