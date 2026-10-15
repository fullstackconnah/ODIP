using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Xunit;
using PostgresFixture = Odip.Tests.Postgres.PostgresFixture;

namespace Odip.Tests.DataExport;

/// <summary>
/// The export against a real PostgreSQL. These tests are skipped, never failed, when POSTGRES_CONNECTION_STRING is unset.
/// Every parent subquery must translate to SQL. Two organisations planted side by side must not reach each other's export, whether the
/// filter is on (an Admin) or off (a SuperAdmin context).
/// </summary>
public class DataExportPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public DataExportPostgresTests(PostgresFixture pg) => _pg = pg;

    private async Task<string> MigratedDatabaseAsync()
    {
        var cs = await _pg.CreateDatabaseAsync();
        await using var setup = PostgresFixture.NewContext(cs);
        await setup.Database.MigrateAsync();
        return cs;
    }

    [SkippableFact]
    public async Task Every_scoped_query_runs_on_postgres_and_no_other_organisations_row_reaches_the_export()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await MigratedDatabaseAsync();
        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        DataExportTestKit.Planted own, other;
        await using (var admin = PostgresFixture.NewContext(cs))
        {
            admin.Tenants.AddRange(new Tenant { Id = a, Name = "Alpha Care", EmailDomain = $"{a:N}.example.com" }, new Tenant { Id = b, Name = "Bravo Care", EmailDomain = $"{b:N}.example.com" });
            admin.SaveChanges();
            other = DataExportTestKit.Plant(admin, b, "43100000001");
            own = DataExportTestKit.Plant(admin, a, "43100000002");
        }

        foreach (var superAdmin in new[] { false, true })
        {
            await using var db = PostgresFixture.NewContext(cs, DataExportTestKit.Tenant(superAdmin ? null : a, superAdmin));
            using var zip = await DataExportTestKit.ExportAsync(db, a);
            DataExportTestKit.AssertHoldsOnly(zip, own, other);
        }
    }

    [SkippableFact]
    public async Task The_last_export_is_the_newest_exported_row_of_this_organisation_stored_by_name_on_postgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await MigratedDatabaseAsync();
        var a = Guid.NewGuid();
        AuditLog Row(string type, Guid id, AuditAction action, int day, string by) => new()
        {
            Id = Guid.NewGuid(), EntityType = type, EntityId = id, Action = action, ChangedAt = new DateTimeOffset(2026, 10, day, 5, 4, 0, TimeSpan.Zero), ChangedByName = by,
        };
        await using (var admin = PostgresFixture.NewContext(cs))
        {
            admin.AuditLogs.AddRange(
                Row(nameof(Tenant), a, AuditAction.Exported, 13, "Older Admin"),
                Row(nameof(Tenant), a, AuditAction.Exported, 14, "Jordan Lee"),
                Row(nameof(Participant), a, AuditAction.Exported, 15, "A participant download (PR 2) never moves the line"),
                Row(nameof(Tenant), a, AuditAction.Updated, 16, "Not an export"),
                Row(nameof(Tenant), Guid.NewGuid(), AuditAction.Exported, 17, "Another organisation"));
            await admin.SaveChangesAsync();
        }

        await using var db = PostgresFixture.NewContext(cs, DataExportTestKit.Tenant(a));
        var result = await new DataExportController(db, DataExportTestKit.Tenant(a), NullLogger<DataExportController>.Instance).Last(CancellationToken.None);

        var last = Assert.IsType<ApiResponse<DataExportLastDto?>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal((new DateTime(2026, 10, 14, 5, 4, 0, DateTimeKind.Utc), "Jordan Lee"), (last.ExportedAt, last.ExportedByName));
        Assert.Equal(DateTimeKind.Utc, last.ExportedAt.Kind);
        await using var check = PostgresFixture.NewContext(cs);
        Assert.Equal(4, await check.Database.SqlQueryRaw<int>("SELECT COUNT(*)::int AS \"Value\" FROM \"AuditLogs\" WHERE \"Action\" = 'Exported'").SingleAsync());
    }
}
