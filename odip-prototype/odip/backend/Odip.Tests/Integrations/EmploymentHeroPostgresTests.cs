using System.Net;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Tests.Imports;
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

    private static async Task ConnectAsync(OdipDbContext db, Guid tenantId)
    {
        var (cipher, nonce) = EhFixture.Keys.Protect(EhFixture.ApiKey, tenantId);
        db.EmploymentHeroConnections.Add(new EmploymentHeroConnection
        {
            Id = Guid.NewGuid(), TenantId = tenantId, BusinessId = EhFixture.Business, BusinessName = "Acme Care", ApiKeyCiphertext = cipher, ApiKeyNonce = nonce,
            ConnectedAt = DateTime.UtcNow, ConnectedByName = "Ada Admin",
        });
        await db.SaveChangesAsync();
    }

    private static StubHttpHandler EhList(object[] employees) => new StubHttpHandler().On(StubHttpHandler.EmployeesPage(EhFixture.Business), HttpStatusCode.OK, employees);

    [SkippableFact]
    public async Task The_sync_runs_on_Postgres()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        await ConnectAsync(db, tenantId);
        var token = Guid.NewGuid().ToString("N")[..8];
        var sam = Person(tenantId, "Sam", null);
        db.Users.Add(sam);
        await db.SaveChangesAsync();

        var result = await EhFixture.Sync(EhList([StubHttpHandler.Employee(101, "Sam", "Lee", sam.Email), StubHttpHandler.Employee(102, "Ana", "Ruiz", $"ana.{token}@example.org")]))
            .RunAsync(db, tenantId, CancellationToken.None);

        Assert.Equal(EmploymentHeroSyncOutcome.Done, result.Outcome);
        db.ChangeTracker.Clear();
        Assert.Equal(new[] { "101", "102" }, await db.Users.Where(u => u.ExternalPayrollId != null).OrderBy(u => u.ExternalPayrollId).Select(u => u.ExternalPayrollId!).ToArrayAsync());
        Assert.Equal(1, await db.EmploymentHeroSyncLogs.CountAsync());
    }

    [SkippableFact]
    public async Task Two_syncs_at_once_create_each_person_once_on_Postgres()
    {
        RequirePostgres();
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await using (setup) await ConnectAsync(setup, tenantId);
        var token = Guid.NewGuid().ToString("N")[..8];
        var employees = Enumerable.Range(1, 30).Select(i => StubHttpHandler.Employee(800 + i, "New", $"Person{i}", $"new{i}.{token}@example.org")).ToArray();
        await using var a = PostgresFixture.NewContext(_pg.ConnectionString, ImportTestSupport.Tenant(tenantId));
        await using var b = PostgresFixture.NewContext(_pg.ConnectionString, ImportTestSupport.Tenant(tenantId));

        // Sync now pressed during the half-hourly run: the second waits on the organisation's lock, then finds everyone already linked.
        var results = await Task.WhenAll(
            EhFixture.Sync(EhList(employees)).RunAsync(a, tenantId, CancellationToken.None),
            EhFixture.Sync(EhList(employees)).RunAsync(b, tenantId, CancellationToken.None));

        // On a slow, busy test server the second run may give up on the 20 s lock wait (Busy): that is a correct answer too, never a failure.
        Assert.All(results, r => Assert.NotEqual(EmploymentHeroSyncOutcome.Failed, r.Outcome));
        Assert.Equal(30, results.Sum(r => r.Log?.Created ?? 0));
        await using var check = PostgresFixture.NewContext(_pg.ConnectionString, ImportTestSupport.Tenant(tenantId));
        Assert.Equal(30, await check.Users.CountAsync(u => u.ExternalPayrollId != null));
        Assert.Equal(0, await check.EmploymentHeroAttentions.CountAsync());
    }

    [SkippableFact]
    public async Task One_person_the_database_refuses_costs_only_that_person_on_Postgres()
    {
        RequirePostgres();
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        await ConnectAsync(db, tenantId);
        // A SuperAdmin row in the organisation already holds EH id 900. The sync never reads SuperAdmins, so it takes EH 900 for a new person and the
        // payroll-id index refuses that save. Inside the run's transaction, EF's savepoint must keep 901 and 902 going.
        var holder = Person(tenantId, "sup", "900");
        holder.Role = UserRole.SuperAdmin;
        db.Users.Add(holder);
        await db.SaveChangesAsync();
        var token = Guid.NewGuid().ToString("N")[..8];

        var result = await EhFixture.Sync(EhList([
                StubHttpHandler.Employee(900, "Nina", "Ross", $"nina.{token}@example.org"),
                StubHttpHandler.Employee(901, "Omar", "Saeed", $"omar.{token}@example.org"),
                StubHttpHandler.Employee(902, "Pia", "Tran", $"pia.{token}@example.org")]))
            .RunAsync(db, tenantId, CancellationToken.None);

        Assert.Equal(EmploymentHeroSyncOutcome.Done, result.Outcome);
        db.ChangeTracker.Clear();
        Assert.Equal(new[] { "901", "902" }, await db.Users.Where(u => u.Role != UserRole.SuperAdmin && u.ExternalPayrollId != null)
            .OrderBy(u => u.ExternalPayrollId).Select(u => u.ExternalPayrollId!).ToArrayAsync());
        var item = await db.EmploymentHeroAttentions.SingleAsync();
        Assert.Equal((EmploymentHeroAttentionKind.FixInEmploymentHero, "900"), (item.Kind, item.ExternalEmployeeId));
        Assert.Contains("couldn't save their details", item.Reason);
        Assert.Equal(1, await db.EmploymentHeroSyncLogs.CountAsync());
    }
}
