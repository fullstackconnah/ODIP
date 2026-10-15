using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;

namespace Odip.Tests.Incidents;

/// <summary>
/// Against a real PostgreSQL (skipped, never failed, without POSTGRES_CONNECTION_STRING): every incident list and its total hold only the caller's organisation.
/// A count drops the list's projection, so a scope that only rode on the projection's join to the reporter would leave the total counting other organisations.
/// </summary>
public class IncidentTenantScopePostgresTests : IClassFixture<PostgresFixture>
{
    private static readonly CancellationToken Ct = CancellationToken.None;
    private readonly PostgresFixture _pg;
    public IncidentTenantScopePostgresTests(PostgresFixture pg) => _pg = pg;

    /// <summary>One open incident on a trip, its QSC report overdue, so every list and filter matches it.</summary>
    private static async Task<(IncidentReport Incident, TripInstance Trip)> PlantAsync(OdipDbContext db, Guid tenantId)
    {
        var reporter = new User { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Sam", LastName = "Lee", Username = $"sam.{Guid.NewGuid():N}", Email = $"sam.{Guid.NewGuid():N}@example.com", Role = UserRole.Coordinator, IsActive = true };
        var trip = new TripInstance { Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Trip", StartDate = new DateOnly(2026, 10, 1), DurationDays = 3 };
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ReportedByUserId = reporter.Id, TripInstanceId = trip.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.High,
            Status = IncidentStatus.Submitted, Title = "Incident", Description = "What happened.", IncidentDateTime = DateTime.UtcNow.AddHours(-31),
            CreatedAt = DateTime.UtcNow.AddHours(-30), QscReportingStatus = QscReportingStatus.Required, IsActive = true,
        };
        db.AddRange(reporter, trip, incident);
        await db.SaveChangesAsync(Ct);
        return (incident, trip);
    }

    [SkippableFact]
    public async Task EveryIncidentList_AndItsTotal_HoldOnlyTheCallersOrganisation_OverNpgsql()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (own, ownTenant) = await _pg.NewTenantContextAsync();
        await using var _own = own;
        var (other, otherTenant) = await _pg.NewTenantContextAsync();
        await using var _other = other;
        var mine = await PlantAsync(own, ownTenant);
        var theirs = await PlantAsync(other, otherTenant);
        var controller = new IncidentsController(own);

        foreach (var (isOverdueQsc, needsAttention) in new (bool?, bool?)[] { (null, null), (true, null), (null, true) })
        {
            var page = Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>(
                (await controller.GetAll(null, null, null, null, null, isOverdueQsc, null, null, 1, 50, Ct, needsAttention)).Result).Value).Data!;
            Assert.Equal((mine.Incident.Id, 1), (Assert.Single(page.Items).Id, page.TotalCount));
        }

        var byForeignTrip = Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>(
            (await controller.GetAll(theirs.Trip.Id, null, null, null, null, null, null, null, 1, 50, Ct)).Result).Value).Data!;
        Assert.Equal((0, 0), (byForeignTrip.Items.Count, byForeignTrip.TotalCount));

        var overdue = Assert.IsType<ApiResponse<List<IncidentListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetOverdueQsc(Ct)).Result).Value).Data!;
        Assert.Equal(mine.Incident.Id, Assert.Single(overdue).Id);
        Assert.Empty(Assert.IsType<ApiResponse<List<IncidentListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetByTrip(theirs.Trip.Id, Ct)).Result).Value).Data!);
        Assert.IsType<NotFoundObjectResult>((await controller.GetById(theirs.Incident.Id, Ct)).Result);
    }

    /// <summary>A SuperAdmin who chose <paramref name="tenantId"/>, resolved by the real <see cref="CurrentTenant"/> from the role and the view-as header.</summary>
    private static ICurrentTenant SuperAdminViewing(Guid tenantId)
    {
        var http = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, "SuperAdmin"), new Claim("tenant_id", Guid.NewGuid().ToString()) }, "Test")) };
        http.Request.Headers["X-View-As-Tenant"] = tenantId.ToString();
        return new CurrentTenant(new HttpContextAccessor { HttpContext = http });
    }

    [SkippableFact]
    public async Task AnIncidentWithNoTenant_IsInNoReadPath_ForAnOrganisationsUser_OrASuperAdminWhoChoseThatOrganisation_OverNpgsql()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (own, ownTenant) = await _pg.NewTenantContextAsync();
        await using var _own = own;
        var mine = await PlantAsync(own, ownTenant);
        // What the previous image files after a rollback: the organisation's own reporter, open with its QSC report overdue, but no TenantId.
        var leftNull = new IncidentReport
        {
            Id = Guid.NewGuid(), ReportedByUserId = mine.Incident.ReportedByUserId, TripInstanceId = mine.Trip.Id, IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.High,
            Status = IncidentStatus.Submitted, Title = "Unscoped", Description = "What happened.", IncidentDateTime = DateTime.UtcNow.AddHours(-31),
            CreatedAt = DateTime.UtcNow.AddHours(-30), QscReportingStatus = QscReportingStatus.Required, IsActive = true,
        };
        await using (var admin = PostgresFixture.NewContext(_pg.ConnectionString))
        {
            admin.IncidentReports.Add(leftNull);
            await admin.SaveChangesAsync(Ct);
            Assert.Null((await admin.IncidentReports.AsNoTracking().SingleAsync(i => i.Id == leftNull.Id, Ct)).TenantId);
        }

        var viewing = SuperAdminViewing(ownTenant);
        Assert.False(viewing.IsSuperAdmin);
        await using var asSuperAdmin = PostgresFixture.NewContext(_pg.ConnectionString, viewing);
        foreach (var db in new[] { own, asSuperAdmin })
        {
            var controller = new IncidentsController(db);
            foreach (var (isOverdueQsc, needsAttention) in new (bool?, bool?)[] { (null, null), (true, null), (null, true) })
            {
                var page = Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>(
                    (await controller.GetAll(null, null, null, null, null, isOverdueQsc, null, null, 1, 50, Ct, needsAttention)).Result).Value).Data!;
                Assert.Equal((mine.Incident.Id, 1), (Assert.Single(page.Items).Id, page.TotalCount));
            }
            Assert.Equal(mine.Incident.Id, Assert.Single(Assert.IsType<ApiResponse<List<IncidentListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetOverdueQsc(Ct)).Result).Value).Data!).Id);
            Assert.Equal(mine.Incident.Id, Assert.Single(Assert.IsType<ApiResponse<List<IncidentListDto>>>(Assert.IsType<OkObjectResult>((await controller.GetByTrip(mine.Trip.Id, Ct)).Result).Value).Data!).Id);
            Assert.IsType<NotFoundObjectResult>((await controller.GetById(leftNull.Id, Ct)).Result);
            Assert.IsType<NotFoundObjectResult>((await controller.Delete(leftNull.Id, Ct)).Result);
            var summary = Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>((await new DashboardController(db).GetSummary(Ct)).Result).Value).Data!;
            Assert.Equal((1, 1), (summary.OpenIncidentCount, summary.QscOverdueCount));
        }
    }

    [SkippableFact]
    public async Task TheTenantMigration_GivesEveryExistingIncidentItsReportersOrganisation_AndARowLeftNullIsSeenOnlyByASuperAdminWithNoOrganisation()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var cs = await _pg.CreateDatabaseAsync();
        await using var db = PostgresFixture.NewContext(cs);
        var migrator = db.GetService<IMigrator>();

        // The schema just before the migration, with incidents of two organisations: two reported by A's user, one by B's.
        await migrator.MigrateAsync("20261014071657_AddInAppNotifications");
        var (a, b, userA, userB) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        var reporterOf = new Dictionary<Guid, Guid> { [Guid.NewGuid()] = userA, [Guid.NewGuid()] = userA, [Guid.NewGuid()] = userB };
        await using (var conn = new NpgsqlConnection(cs))
        {
            await conn.OpenAsync();
            foreach (var (tenant, user) in new[] { (a, userA), (b, userB) })
            {
                await ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, "Tenants", new() { ["Id"] = tenant, ["Name"] = "Provider", ["EmailDomain"] = $"{tenant:N}.example.com" });
                await ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, "Users", new() { ["Id"] = user, ["TenantId"] = tenant, ["Email"] = $"{user:N}@example.com", ["Username"] = user.ToString("N") });
            }
            foreach (var (incident, reporter) in reporterOf)
                await ShiftPackagePostgresTests.InsertMinimalRowAsync(conn, "IncidentReports", new() { ["Id"] = incident, ["ReportedByUserId"] = reporter, ["Title"] = "Incident" });
        }

        await migrator.MigrateAsync();

        await using var after = new NpgsqlConnection(cs);
        await after.OpenAsync();
        var tenantOf = new Dictionary<Guid, Guid> { [userA] = a, [userB] = b };
        await using (var rows = new NpgsqlCommand("SELECT \"Id\", \"TenantId\" FROM \"IncidentReports\"", after))
        await using (var reader = await rows.ExecuteReaderAsync())
        {
            var seen = 0;
            while (await reader.ReadAsync())
            {
                Assert.Equal(tenantOf[reporterOf[reader.GetGuid(0)]], reader.GetGuid(1));
                seen++;
            }
            Assert.Equal(3, seen);
        }

        // An incident the previous image files after a rollback leaves TenantId out: hidden from the organisation, seen by a SuperAdmin with none chosen.
        var leftNull = Guid.NewGuid();
        await ShiftPackagePostgresTests.InsertMinimalRowAsync(after, "IncidentReports", new() { ["Id"] = leftNull, ["ReportedByUserId"] = userA, ["Title"] = "Incident" });
        var scoped = new Mock<ICurrentTenant>();
        scoped.Setup(t => t.TenantId).Returns(a);
        scoped.Setup(t => t.IsSuperAdmin).Returns(false);
        await using (var organisation = PostgresFixture.NewContext(cs, scoped.Object))
            Assert.Equal(2, await organisation.IncidentReports.CountAsync(i => reporterOf.Keys.Contains(i.Id) || i.Id == leftNull));
        await using (var superAdmin = PostgresFixture.NewContext(cs))
            Assert.True(await superAdmin.IncidentReports.AnyAsync(i => i.Id == leftNull));
    }
}
