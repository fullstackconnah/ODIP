using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Security.CrossTenant;

namespace Odip.Tests.Security;

/// <summary>
/// Every incident read answers only the caller's organisation: each list, filter and count leaves out organisation B's incident, even when the caller names B's
/// trip or shift, and B's incident by its id is "not found". The incident is open with its QSC report overdue, so every filter would match it.
/// </summary>
public class CrossTenantIncidentListTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private sealed record Planted(IncidentReport Incident, TripInstance Trip, Shift Shift);

    private static Planted Plant(OdipDbContext db, Guid tenantId)
    {
        var reporter = User(db, tenantId);
        var participant = Participant(db, tenantId);
        var trip = Trip(db, tenantId);
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participant.Id, UserId = reporter.Id, ServiceDate = new DateOnly(2026, 10, 1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Completed,
        };
        db.Shifts.Add(shift);
        var incident = new IncidentReport
        {
            Id = Guid.NewGuid(), ReportedByUserId = reporter.Id, TripInstanceId = trip.Id, ShiftId = shift.Id, IncidentType = IncidentType.PropertyDamage,
            Severity = IncidentSeverity.High, Status = IncidentStatus.Submitted, Title = "Incident", Description = "What happened.",
            IncidentDateTime = DateTime.UtcNow.AddHours(-31), CreatedAt = DateTime.UtcNow.AddHours(-30), QscReportingStatus = QscReportingStatus.Required, IsActive = true,
        };
        db.IncidentReports.Add(incident);
        db.SaveChanges();
        return new Planted(incident, trip, shift);
    }

    private static PagedResult<IncidentListDto> Page(ActionResult<ApiResponse<PagedResult<IncidentListDto>>> result) =>
        Assert.IsType<ApiResponse<PagedResult<IncidentListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    private static List<IncidentListDto> List(ActionResult<ApiResponse<List<IncidentListDto>>> result) =>
        Assert.IsType<ApiResponse<List<IncidentListDto>>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;

    [Theory]
    [InlineData("default")]
    [InlineData("isOverdueQsc")]
    [InlineData("needsAttention")]
    [InlineData("status")]
    public async Task GetAll_ListsAndCountsOnlyTheCallersOwnIncidents(string filter)
    {
        using var db = Db();
        var own = Plant(db, A);
        Plant(db, B);

        var page = Page(await new IncidentsController(db).GetAll(null, filter == "status" ? IncidentStatus.Submitted : null, null, null, null,
            filter == "isOverdueQsc" ? true : null, null, null, 1, 50, Ct, needsAttention: filter == "needsAttention" ? true : null));

        Assert.Equal(own.Incident.Id, Assert.Single(page.Items).Id);
        Assert.Equal(1, page.TotalCount);
    }

    [Fact]
    public async Task GetAll_ByAnotherTenantsTripOrShift_FindsAndCountsNothing()
    {
        using var db = Db();
        Plant(db, A);
        var foreign = Plant(db, B);
        var controller = new IncidentsController(db);

        var byTrip = Page(await controller.GetAll(foreign.Trip.Id, null, null, null, null, null, null, null, 1, 50, Ct));
        var byShift = Page(await controller.GetAll(null, null, null, null, null, null, foreign.Shift.Id, null, 1, 50, Ct));

        Assert.Equal((0, 0), (byTrip.Items.Count, byTrip.TotalCount));
        Assert.Equal((0, 0), (byShift.Items.Count, byShift.TotalCount));
    }

    [Fact]
    public async Task GetByTrip_GetByShift_AndOverdueQsc_ReturnOnlyTheCallersOwnIncidents()
    {
        using var db = Db();
        var own = Plant(db, A);
        var foreign = Plant(db, B);
        var controller = new IncidentsController(db);

        Assert.Empty(List(await controller.GetByTrip(foreign.Trip.Id, Ct)));
        Assert.Empty(List(await controller.GetByShift(foreign.Shift.Id, Ct)));
        Assert.Equal(own.Incident.Id, Assert.Single(List(await controller.GetByTrip(own.Trip.Id, Ct))).Id);
        Assert.Equal(own.Incident.Id, Assert.Single(List(await controller.GetOverdueQsc(Ct))).Id);
    }

    [Fact]
    public async Task GetById_AnotherTenantsIncident_IsNotFound_AndTheOwnerStillReadsTheirs()
    {
        using var db = Db();
        var own = Plant(db, A);
        var foreign = Plant(db, B);
        var controller = new IncidentsController(db);

        Assert.IsType<NotFoundObjectResult>((await controller.GetById(foreign.Incident.Id, Ct)).Result);
        Assert.IsType<OkObjectResult>((await controller.GetById(own.Incident.Id, Ct)).Result);
    }
}
