using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Migrations;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>
/// The incident clock against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): the overdue predicate over the stored NotifyDueAt
/// translates, and the migration's backfill keeps every open Required incident overdue.
/// </summary>
public class IncidentClockPostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly PostgresFixture _pg;
    public IncidentClockPostgresTests(PostgresFixture pg) => _pg = pg;

    private static IncidentReport Row(Guid tenantId, Guid reporterId, string title, QscReportingStatus status, DateTime createdAt, ReportableClass cls = ReportableClass.None, DateTime? due = null) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ReportedByUserId = reporterId, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Low,
        Status = IncidentStatus.Submitted, Title = title, Description = "What happened.", IncidentDateTime = new DateTime(2026, 10, 1, 9, 0, 0, DateTimeKind.Utc),
        CreatedAt = createdAt, ReportableClass = cls, NotifyDueAt = due, QscReportingStatus = status, IsActive = true,
        QscReportedAt = status is QscReportingStatus.ReportedWithin24h or QscReportingStatus.ReportedLate ? createdAt.AddHours(2) : null,
    };

    private static User Reporter(Guid tenantId) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Lee", Username = $"sam.{Guid.NewGuid():N}", Email = $"sam.{Guid.NewGuid():N}@example.com",
        Role = UserRole.Coordinator, IsActive = true,
    };

    [SkippableFact]
    public async Task T_PG1_TheOverdueFilter_OverNpgsql_ReturnsExactlyTheRowsWhoseStoredDeadlinePassed()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var reporter = Reporter(tenantId);
        var now = DateTime.UtcNow;
        var past = Row(tenantId, reporter.Id, "Past", QscReportingStatus.Required, now.AddHours(-30), ReportableClass.Within24h, now.AddHours(-6));
        var future = Row(tenantId, reporter.Id, "Future", QscReportingStatus.Required, now.AddHours(-1), ReportableClass.Within24h, now.AddHours(23));
        var noDue = Row(tenantId, reporter.Id, "No due", QscReportingStatus.Required, now.AddHours(-30));
        var reported = Row(tenantId, reporter.Id, "Reported", QscReportingStatus.ReportedLate, now.AddHours(-30), ReportableClass.Within24h, now.AddHours(-6));
        db.AddRange(reporter, past, future, noDue, reported);
        await db.SaveChangesAsync(Ct);

        var result = await new IncidentsController(db).GetAll(null, null, null, null, null, true, null, null, 1, 50, Ct);

        var page = Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
        Assert.Equal(new[] { past.Id }, page.Items.Select(i => i.Id));
    }

    [SkippableFact]
    public async Task T_PG2_TheBackfill_KeepsOpenRequiredRowsOverdue_GivesReportedRowsAClass_AndLeavesPendingAlone_AndIsSafeToRunTwice()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        await using var _ = db;
        var reporter = Reporter(tenantId);
        var created = DateTime.UtcNow.AddHours(-30);
        var required = Row(tenantId, reporter.Id, "Required", QscReportingStatus.Required, created);
        var onTime = Row(tenantId, reporter.Id, "On time", QscReportingStatus.ReportedWithin24h, created);
        var pending = Row(tenantId, reporter.Id, "Pending", QscReportingStatus.Pending, created);
        var notRequired = Row(tenantId, reporter.Id, "Not required", QscReportingStatus.NotRequired, created);
        db.AddRange(reporter, required, onTime, pending, notRequired);
        await db.SaveChangesAsync(Ct);

        // Scoped to this test's organisation so other tests' rows are untouched.
        var sql = AddIncidentReportingClock.BackfillSql.TrimEnd(';') + $" AND \"TenantId\" = '{tenantId}';";
        await db.Database.ExecuteSqlRawAsync(sql, Ct);
        await db.Database.ExecuteSqlRawAsync(sql, Ct);

        await using var check = PostgresFixture.NewContext(_pg.ConnectionString);
        var rows = await check.IncidentReports.AsNoTracking().Where(i => i.TenantId == tenantId).ToDictionaryAsync(i => i.Title, Ct);
        Assert.Equal(ReportableClass.Within24h, rows["Required"].ReportableClass);
        Assert.Equal(created.AddHours(24), rows["Required"].NotifyDueAt!.Value, TimeSpan.FromSeconds(1));
        Assert.Equal(ReportableClass.Within24h, rows["On time"].ReportableClass);
        Assert.Equal(ReportableClass.None, rows["Pending"].ReportableClass);
        Assert.Null(rows["Pending"].NotifyDueAt);
        Assert.Equal(ReportableClass.None, rows["Not required"].ReportableClass);

        var overdue = await check.IncidentReports.AsNoTracking().Where(Odip.Domain.Incidents.QscReporting.IsOverdueExpr(DateTime.UtcNow)).Where(i => i.TenantId == tenantId).Select(i => i.Title).ToListAsync(Ct);
        Assert.Equal(new[] { "Required" }, overdue);
    }
}
