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

namespace Odip.Tests.Schedule;

/// <summary>
/// ScheduleController's trip-status cells now source unavailability from IStaffUnavailabilityQuery
/// (PR 1) instead of a raw StaffAvailability query — see
/// docs/specs/2026-09-07-staff-leave-unavailability-design.md §4.
/// </summary>
public class ScheduleControllerTests
{
    private static OdipDbContext CreateDb(string dbName)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(dbName)
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static User SeedStaff(OdipDbContext db)
    {
        var staff = new User
        {
            Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
        };
        db.Users.Add(staff);
        db.SaveChanges();
        return staff;
    }

    private static TripInstance SeedTrip(OdipDbContext db, DateOnly start, int days = 3)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Beach Trip", StartDate = start, DurationDays = days, Status = TripStatus.Confirmed };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static ScheduleStaffTripStatusDto StatusFor(ApiResponse<ScheduleOverviewDto> body, Guid staffId, Guid tripId) =>
        body.Data!.Staff.Single(s => s.Id == staffId).TripStatuses.Single(t => t.TripId == tripId);

    [Fact]
    public async Task PendingLeaveOverlappingTrip_StatusIsTentative()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 12),
            Status = LeaveStatus.Pending, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Equal("Tentative", StatusFor(body, staff.Id, trip.Id).Status);
    }

    [Fact]
    public async Task ApprovedLeaveOverlappingTrip_StatusIsUnavailable()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 12),
            Status = LeaveStatus.Approved, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Equal("Unavailable", StatusFor(body, staff.Id, trip.Id).Status);
    }

    [Fact]
    public async Task LegacyTrainingAvailabilityOverlappingTrip_StatusIsUnavailable()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        db.StaffAvailabilities.Add(new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, AvailabilityType = AvailabilityType.Training,
            Notes = "First aid refresher",
            StartDateTime = new DateOnly(2026, 9, 10).ToDateTime(new TimeOnly(9, 0)),
            EndDateTime = new DateOnly(2026, 9, 10).ToDateTime(new TimeOnly(12, 0)),
        });
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Equal("Unavailable", StatusFor(body, staff.Id, trip.Id).Status);
    }

    [Fact]
    public async Task NoOverlap_StatusIsAvailable()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Equal("Available", StatusFor(body, staff.Id, trip.Id).Status);
    }

    /// <summary>
    /// Being assigned to THIS trip wins over a pending-leave overlap — the assignedToThis check
    /// runs before the pendingLeave check in GetScheduleOverview, so the cell reads Assigned, not
    /// Tentative.
    /// </summary>
    [Fact]
    public async Task AssignedToTrip_WithPendingLeaveOverlap_StatusIsAssigned()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        db.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = staff.Id,
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
            Status = AssignmentStatus.Confirmed,
        });
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 12),
            Status = LeaveStatus.Pending, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Equal("Assigned", StatusFor(body, staff.Id, trip.Id).Status);
    }

    /// <summary>
    /// Being assigned to a DIFFERENT overlapping trip wins over a pending-leave overlap — the
    /// conflicting check runs before the pendingLeave check in GetScheduleOverview, so the cell
    /// reads Conflict, not Tentative.
    /// </summary>
    [Fact]
    public async Task AssignedToOtherOverlappingTrip_WithPendingLeaveOverlap_StatusIsConflict()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        var otherTrip = SeedTrip(db, new DateOnly(2026, 9, 11));
        db.StaffAssignments.Add(new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = otherTrip.Id, UserId = staff.Id,
            AssignmentStart = new DateOnly(2026, 9, 11), AssignmentEnd = new DateOnly(2026, 9, 13),
            Status = AssignmentStatus.Confirmed,
        });
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 12),
            Status = LeaveStatus.Pending, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Equal("Conflict", StatusFor(body, staff.Id, trip.Id).Status);
    }
}
