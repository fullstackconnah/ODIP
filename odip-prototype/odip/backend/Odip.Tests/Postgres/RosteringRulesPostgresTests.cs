using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Postgres;

/// <summary>
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING), Settings PR 3: the migration gives an existing organisation 15 and 30, and the review queue's
/// correlated per-organisation threshold (with Math.Min/Math.Max) translates on Npgsql and orders the outlier first.
/// </summary>
public class RosteringRulesPostgresTests : IClassFixture<PostgresFixture>
{
    private const string MigrationName = "AddRosteringRulesAndPlanExpiry";
    private readonly PostgresFixture _pg;
    public RosteringRulesPostgresTests(PostgresFixture pg) => _pg = pg;

    private static Task InsertAsync(NpgsqlConnection conn, string table, Dictionary<string, object?> values) =>
        ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, table, values);

    private static async Task<Guid> PlantTenantAsync(NpgsqlConnection conn)
    {
        var tenant = Guid.NewGuid();
        await InsertAsync(conn, "Tenants", new() { ["Id"] = tenant, ["Name"] = "Provider", ["EmailDomain"] = $"{tenant:N}.example.com" });
        return tenant;
    }

    [SkippableFact]
    public async Task TheMigration_GivesAnExistingOrganisation15And30()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        var db = PostgresFixture.NewContext(cs);
        var migrator = db.GetService<IMigrator>();
        var all = db.Database.GetMigrations().ToList();
        var mine = all.Single(m => m.EndsWith("_" + MigrationName, StringComparison.Ordinal));
        await migrator.MigrateAsync(all[all.IndexOf(mine) - 1]);
        await using var conn = new NpgsqlConnection(cs);
        await conn.OpenAsync();
        var tenant = await PlantTenantAsync(conn);
        var row = Guid.NewGuid();
        await InsertAsync(conn, "AppSettings", new() { ["Id"] = row, ["TenantId"] = tenant });

        await migrator.MigrateAsync();

        await using var read = new NpgsqlCommand("SELECT \"VarianceReviewMinutes\", \"PlanExpiryWarningDays\" FROM \"AppSettings\" WHERE \"Id\" = @id", conn);
        read.Parameters.AddWithValue("id", row);
        await using var reader = await read.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal((15, 30), (reader.GetInt32(0), reader.GetInt32(1)));
    }

    [SkippableFact]
    public async Task TheReviewQueue_JudgesEachOrganisationByItsOwnMinutes_OnNpgsql_AndPutsTheOutlierFirst()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        await using var conn = new NpgsqlConnection(_pg.ConnectionString);
        await conn.OpenAsync();
        var (a, b) = (await PlantTenantAsync(conn), await PlantTenantAsync(conn));
        await InsertAsync(conn, "AppSettings", new() { ["Id"] = Guid.NewGuid(), ["TenantId"] = a, ["VarianceReviewMinutes"] = 60, ["PlanExpiryWarningDays"] = 30 });   // B has no row: 15
        var staff = Guid.NewGuid();
        await InsertAsync(conn, "Users", new() { ["Id"] = staff, ["TenantId"] = a, ["Username"] = $"u{staff:N}", ["Email"] = $"{staff:N}@example.com", ["FirstName"] = "Ben", ["LastName"] = "Turner" });
        var shifts = new List<Guid>();
        foreach (var (tenant, day) in new[] { (a, 8), (b, 9) })
        {
            var participant = Guid.NewGuid();
            await InsertAsync(conn, "Participants", new() { ["Id"] = participant, ["TenantId"] = tenant, ["FirstName"] = "Amy", ["LastName"] = "Ng" });
            var shift = Guid.NewGuid();
            shifts.Add(shift);
            await InsertAsync(conn, "Shifts", new()
            {
                ["Id"] = shift, ["TenantId"] = tenant, ["ParticipantId"] = participant, ["ServiceDate"] = new DateOnly(2026, 9, day), ["StartTime"] = new TimeOnly(9, 0),
                ["EndTime"] = new TimeOnly(17, 0), ["Status"] = (int)ShiftStatus.PendingReview,
            });
            await InsertAsync(conn, "ShiftCompletions", new()
            {
                ["Id"] = Guid.NewGuid(), ["TenantId"] = tenant, ["ShiftId"] = shift, ["TimeZoneId"] = "Australia/Sydney", ["SubmittedByUserId"] = staff, ["IsActive"] = true,
                ["VarianceMinutesStart"] = 20, ["VarianceMinutesEnd"] = 0,
            });
        }
        await using var db = PostgresFixture.NewContext(_pg.ConnectionString);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db))
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, staff.ToString())], "Test")) } },
        };

        var ok = Assert.IsType<OkObjectResult>((await controller.GetCompletions(null, null, null, 1, 50, default)).Result);
        var items = Assert.IsType<ApiResponse<PagedResult<CompletionQueueItemDto>>>(ok.Value).Data!.Items.Where(i => shifts.Contains(i.ShiftId)).ToList();

        Assert.Equal([shifts[1], shifts[0]], items.Select(i => i.ShiftId));
        Assert.Equal([(true, 15), (false, 60)], items.Select(i => (i.IsOutlierVariance, i.VarianceReviewMinutes)));
    }
}
