using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Security;

/// <summary>
/// The dashboard's conflict, open-incident and overdue-QSC tiles count rows of tables that have no organisation column or query filter. Each count now joins the caller's own trips
/// (reservations, vehicle and staff assignments) or users (incidents), so another organisation's rows are not added to the caller's numbers.
/// </summary>
public class CrossTenantDashboardTests
{
    /// <summary>One of each thing a tile counts, all owned by <paramref name="tenantId"/>: three conflicted rows on a trip, and an open incident whose QSC report is overdue.</summary>
    private static void Plant(OdipDbContext db, Guid tenantId)
    {
        var trip = Trip(db, tenantId);
        var reporter = User(db, tenantId);
        db.AccommodationReservations.Add(new AccommodationReservation
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, AccommodationPropertyId = Guid.NewGuid(), HasOverlapConflict = true,
        });
        db.VehicleAssignments.Add(new VehicleAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, VehicleId = Vehicle(db, tenantId).Id, HasOverlapConflict = true });
        db.StaffAssignments.Add(new StaffAssignment { Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = reporter.Id, HasConflict = true });
        db.IncidentReports.Add(new IncidentReport
        {
            Id = Guid.NewGuid(), ReportedByUserId = reporter.Id, IncidentType = IncidentType.Other, OtherTypeSpecify = "x", Severity = IncidentSeverity.High, Status = IncidentStatus.Draft,
            Title = "Open", Description = "Open", IncidentDateTime = DateTime.UtcNow.AddDays(-3), CreatedAt = DateTime.UtcNow.AddDays(-3),
            QscReportingStatus = QscReportingStatus.Required,
        });
        db.SaveChanges();
    }

    private static async Task<DashboardSummaryDto> SummaryAsync(OdipDbContext db)
    {
        var result = await new DashboardController(db).GetSummary(CancellationToken.None);
        return Assert.IsType<ApiResponse<DashboardSummaryDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    [Fact]
    public async Task Summary_DoesNotCountTheConflictsAndIncidentsOfAnotherTenant()
    {
        using var db = Db();
        Plant(db, B);

        var summary = await SummaryAsync(db);

        Assert.Equal((0, 0, 0), (summary.ConflictCount, summary.OpenIncidentCount, summary.QscOverdueCount));
    }

    [Fact]
    public async Task Summary_StillCountsTheCallersOwn_AndOnlyTheirs()
    {
        using var db = Db();
        Plant(db, A);
        Plant(db, B);

        var summary = await SummaryAsync(db);

        Assert.Equal((3, 1, 1), (summary.ConflictCount, summary.OpenIncidentCount, summary.QscOverdueCount));
    }
}
