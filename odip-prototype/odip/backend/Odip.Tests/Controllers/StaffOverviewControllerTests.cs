using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// Connection map item 12 — StaffController.GetOverview, the staff hub's single data source.
/// Same EF InMemory + Moq&lt;ICurrentTenant&gt; pattern as StaffControllerTests/
/// RosteringCompletionReviewTests.
/// </summary>
public class StaffOverviewControllerTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static OdipDbContext CreateDb(Guid? tenantId, bool isSuperAdmin)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(isSuperAdmin);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static T Seed<T>(OdipDbContext db, T entity) where T : class
    {
        db.Set<T>().Add(entity);
        db.SaveChanges();
        return entity;
    }

    private static User SeedStaff(OdipDbContext db, Guid tenantId, string firstName = "Ben", string lastName = "Turner") => Seed(db, new User
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = firstName, LastName = lastName,
        Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
        Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
    });

    private static Participant SeedParticipant(OdipDbContext db, Guid tenantId) => Seed(db, new Participant
    {
        Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Amy", LastName = "Ng", IsActive = true,
    });

    private static Shift SeedShift(OdipDbContext db, Guid tenantId, Guid participantId, Guid? staffId, DateOnly serviceDate, ShiftStatus status) => Seed(db, new Shift
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, UserId = staffId, ServiceDate = serviceDate,
        StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
        NightType = SleepoverType.None, Status = status,
    });

    private static TripInstance SeedTrip(OdipDbContext db, Guid tenantId, DateOnly start, int days = 3) => Seed(db, new TripInstance
    {
        Id = Guid.NewGuid(), TenantId = tenantId, TripName = "Beach Trip", StartDate = start, DurationDays = days, Status = TripStatus.Confirmed,
    });

    private static StaffAssignment SeedAssignment(OdipDbContext db, Guid tripId, Guid staffId, DateOnly start, DateOnly end, AssignmentStatus status = AssignmentStatus.Confirmed) => Seed(db, new StaffAssignment
    {
        Id = Guid.NewGuid(), TripInstanceId = tripId, UserId = staffId, AssignmentStart = start, AssignmentEnd = end, Status = status,
    });

    private static IncidentReport SeedIncident(OdipDbContext db, Guid reportedByUserId, Guid? involvedUserId, DateTime incidentDateTime, bool isActive = true) => Seed(db, new IncidentReport
    {
        Id = Guid.NewGuid(), ReportedByUserId = reportedByUserId, InvolvedUserId = involvedUserId,
        IncidentType = IncidentType.PropertyDamage, Severity = IncidentSeverity.Low, Status = IncidentStatus.Draft,
        Title = "Incident", Description = "What happened.", IncidentDateTime = incidentDateTime, IsActive = isActive,
    });

    private static ShiftCompletion SeedCompletion(OdipDbContext db, Guid tenantId, Guid shiftId, Guid submittedByUserId, DateTime submittedAt, bool isActive = true) => Seed(db, new ShiftCompletion
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ShiftId = shiftId, ActualStart = submittedAt.AddHours(-8),
        ActualEnd = submittedAt, TimeZoneId = "Australia/Sydney", SubmittedByUserId = submittedByUserId,
        StartedAt = submittedAt.AddHours(-8), SubmittedAt = submittedAt, IsActive = isActive,
    });

    [Fact]
    public async Task GetOverview_HappyPath_PopulatesAllFiveCollections()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(tenantId, isSuperAdmin: false);
        var staff = SeedStaff(db, tenantId);
        var participant = SeedParticipant(db, tenantId);

        SeedLeave(db, tenantId, staff.Id);
        var shift = SeedShift(db, tenantId, participant.Id, staff.Id, Today.AddDays(2), ShiftStatus.Published);
        var trip = SeedTrip(db, tenantId, Today.AddDays(1), days: 3);
        var assignment = SeedAssignment(db, trip.Id, staff.Id, Today.AddDays(1), Today.AddDays(3));
        var incident = SeedIncident(db, reportedByUserId: SeedStaff(db, tenantId, "Ray", "Reporter").Id,
            involvedUserId: staff.Id, incidentDateTime: DateTime.UtcNow.AddDays(-1));
        var completionShift = SeedShift(db, tenantId, participant.Id, staff.Id, Today.AddDays(-1), ShiftStatus.Completed);
        var completion = SeedCompletion(db, tenantId, completionShift.Id, staff.Id, DateTime.UtcNow.AddHours(-1));

        var controller = new StaffController(db, new StaffAvailabilityItemsQuery(db));

        var result = await controller.GetOverview(staff.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffOverviewDto>>(ok.Value);
        var overview = body.Data!;

        Assert.Equal(staff.Id, overview.Staff.Id);

        Assert.Single(overview.Availability);

        var upcomingShift = Assert.Single(overview.UpcomingShifts);
        Assert.Equal(shift.Id, upcomingShift.ShiftId);
        Assert.Equal(participant.Id, upcomingShift.ParticipantId);
        Assert.Equal(participant.FullName, upcomingShift.ParticipantName);
        Assert.Equal(ShiftStatus.Published, upcomingShift.Status);

        var upcomingAssignment = Assert.Single(overview.UpcomingTripAssignments);
        Assert.Equal(assignment.Id, upcomingAssignment.AssignmentId);
        Assert.Equal(trip.Id, upcomingAssignment.TripInstanceId);
        Assert.Equal(trip.TripName, upcomingAssignment.TripName);

        var recentIncident = Assert.Single(overview.RecentIncidents);
        Assert.Equal(incident.Id, recentIncident.Id);

        var recentCompletion = Assert.Single(overview.RecentCompletions);
        Assert.Equal(completion.Id, recentCompletion.CompletionId);
        Assert.Equal(completionShift.Id, recentCompletion.ShiftId);
    }

    [Fact]
    public async Task GetOverview_CrossTenant_ReturnsNotFound()
    {
        var ownerTenantId = Guid.NewGuid();
        var callerTenantId = Guid.NewGuid();
        using var db = CreateDb(callerTenantId, isSuperAdmin: false);
        var otherTenantsStaff = SeedStaff(db, ownerTenantId);

        var controller = new StaffController(db, new StaffAvailabilityItemsQuery(db));

        var result = await controller.GetOverview(otherTenantsStaff.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetOverview_StaffNotFound_ReturnsNotFound()
    {
        using var db = CreateDb(Guid.NewGuid(), isSuperAdmin: true);
        var controller = new StaffController(db, new StaffAvailabilityItemsQuery(db));

        var result = await controller.GetOverview(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    [Fact]
    public async Task GetOverview_UpcomingShifts_ExcludesShiftsOutsideTheFourteenDayWindow()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(tenantId, isSuperAdmin: false);
        var staff = SeedStaff(db, tenantId);
        var participant = SeedParticipant(db, tenantId);
        SeedShift(db, tenantId, participant.Id, staff.Id, Today.AddDays(15), ShiftStatus.Published);
        SeedShift(db, tenantId, participant.Id, staff.Id, Today.AddDays(-1), ShiftStatus.Published);

        var controller = new StaffController(db, new StaffAvailabilityItemsQuery(db));

        var result = await controller.GetOverview(staff.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffOverviewDto>>(ok.Value);
        Assert.Empty(body.Data!.UpcomingShifts);
    }

    [Fact]
    public async Task GetOverview_UpcomingShifts_ExcludesDraftAndCancelledStatuses()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(tenantId, isSuperAdmin: false);
        var staff = SeedStaff(db, tenantId);
        var participant = SeedParticipant(db, tenantId);
        SeedShift(db, tenantId, participant.Id, staff.Id, Today.AddDays(1), ShiftStatus.Draft);
        SeedShift(db, tenantId, participant.Id, staff.Id, Today.AddDays(1), ShiftStatus.Cancelled);
        SeedShift(db, tenantId, participant.Id, staff.Id, Today.AddDays(1), ShiftStatus.Completed);

        var controller = new StaffController(db, new StaffAvailabilityItemsQuery(db));

        var result = await controller.GetOverview(staff.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffOverviewDto>>(ok.Value);
        Assert.Empty(body.Data!.UpcomingShifts);
    }

    [Fact]
    public async Task GetOverview_RecentIncidents_ExcludesIncidentsWhereStaffIsOnlyTheReporter()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(tenantId, isSuperAdmin: false);
        var staff = SeedStaff(db, tenantId);
        SeedIncident(db, reportedByUserId: staff.Id, involvedUserId: null, incidentDateTime: DateTime.UtcNow);

        var controller = new StaffController(db, new StaffAvailabilityItemsQuery(db));

        var result = await controller.GetOverview(staff.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffOverviewDto>>(ok.Value);
        Assert.Empty(body.Data!.RecentIncidents);
    }

    [Fact]
    public async Task GetOverview_RecentCompletions_ExcludesInactiveReturnedCompletions()
    {
        var tenantId = Guid.NewGuid();
        using var db = CreateDb(tenantId, isSuperAdmin: false);
        var staff = SeedStaff(db, tenantId);
        var participant = SeedParticipant(db, tenantId);
        var shift = SeedShift(db, tenantId, participant.Id, staff.Id, Today.AddDays(-1), ShiftStatus.Published);
        SeedCompletion(db, tenantId, shift.Id, staff.Id, DateTime.UtcNow, isActive: false);

        var controller = new StaffController(db, new StaffAvailabilityItemsQuery(db));

        var result = await controller.GetOverview(staff.Id, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffOverviewDto>>(ok.Value);
        Assert.Empty(body.Data!.RecentCompletions);
    }

    private static LeaveRequest SeedLeave(OdipDbContext db, Guid tenantId, Guid userId) => Seed(db, new LeaveRequest
    {
        Id = Guid.NewGuid(), TenantId = tenantId, UserId = userId, LeaveType = LeaveType.Annual,
        StartDate = Today.AddDays(5), EndDate = Today.AddDays(6), Status = LeaveStatus.Approved,
        RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
    });
}
