using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Retention;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Retention;

/// <summary>
/// F4: the one-off statement that dates participants archived before the clock existed. The archive is written through the real AuditInterceptor, so the jsonb predicate is proved against the
/// shape the interceptor really writes, not one made up for the test. Skipped, never failed, when POSTGRES_CONNECTION_STRING is unset.
/// </summary>
public class RetentionBackfillPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public RetentionBackfillPostgresTests(PostgresFixture pg) => _pg = pg;

    private static OdipDbContext Open(string cs, bool audited)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(cs);
        if (audited) options.AddInterceptors(new AuditInterceptor(new HttpContextAccessor()));
        return new OdipDbContext(options.Options, tenant.Object);
    }

    private static Participant Person(Guid tenantId, string last, bool active, bool draft = false, DateOnly? start = null) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = last, NdisNumber = Guid.NewGuid().ToString("N")[..11], PlanType = PlanType.SelfManaged,
        IsActive = active, IsDraft = draft, RetentionStartsOn = start,
    };

    [SkippableFact]
    public async Task Archived_participants_get_the_audit_date_else_the_last_edit_and_everything_else_is_untouched()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(cs)) await migrate.Database.MigrateAsync();
        var tenantId = Guid.NewGuid();
        await using (var setup = Open(cs, audited: false))
        {
            setup.Tenants.Add(new Tenant { Id = tenantId, Name = "Alpha", EmailDomain = $"{tenantId:N}.example.com" });
            await setup.SaveChangesAsync();
        }

        var audited = Person(tenantId, "Audited", active: true);
        var noAudit = Person(tenantId, "NoAudit", active: false);
        var active = Person(tenantId, "Active", active: true);
        var draft = Person(tenantId, "Draft", active: false, draft: true);
        var dated = Person(tenantId, "Dated", active: false, start: new DateOnly(2020, 2, 2));
        await using (var db = Open(cs, audited: true))
        {
            db.Participants.Add(audited);
            await db.SaveChangesAsync();
            audited.IsActive = false; // the interceptor writes the IsActive true to false row the backfill reads
            await db.SaveChangesAsync();
        }
        await using (var plain = Open(cs, audited: false))
        {
            noAudit.UpdatedAt = new DateTime(2019, 5, 6, 10, 0, 0, DateTimeKind.Utc);
            plain.Participants.AddRange(noAudit, active, draft, dated);
            await plain.SaveChangesAsync();
        }
        DateOnly auditDay;
        await using (var db = Open(cs, audited: false))
        {
            auditDay = DateOnly.FromDateTime((await db.AuditLogs.Where(a => a.EntityId == audited.Id && a.Changes.Contains("IsActive")).MaxAsync(a => a.ChangedAt)).UtcDateTime);

            await db.Database.OpenConnectionAsync(); // the statement holds literal braces, so it runs as-is, the way a migration runs it
            await using var command = db.Database.GetDbConnection().CreateCommand();
            command.CommandText = RetentionBackfill.Sql;
            await command.ExecuteNonQueryAsync();
        }

        await using var read = Open(cs, audited: false);
        async Task<(DateOnly?, bool)> Of(Participant p)
        {
            var row = await read.Participants.Where(x => x.Id == p.Id).Select(x => new { x.RetentionStartsOn, x.RetentionStartEstimated }).SingleAsync();
            return (row.RetentionStartsOn, row.RetentionStartEstimated);
        }
        Assert.Equal(((DateOnly?)auditDay, true), await Of(audited));
        Assert.Equal(((DateOnly?)new DateOnly(2019, 5, 6), true), await Of(noAudit));
        Assert.Equal(((DateOnly?)null, false), await Of(active));
        Assert.Equal(((DateOnly?)null, false), await Of(draft));
        Assert.Equal(((DateOnly?)new DateOnly(2020, 2, 2), false), await Of(dated));
    }
}
