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

    private static List<ScheduleAvailabilityItemDto> AvailabilityFor(ApiResponse<ScheduleOverviewDto> body, Guid staffId) =>
        body.Data!.Staff.Single(s => s.Id == staffId).Availability;

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

    // 2026-09-09 audit ruling: a Pending recurring rule must be as visible on the board as pending
    // one-off leave already is — it now expands to a PendingRecurringRule window and reads Tentative.
    [Fact]
    public async Task PendingRecurringRuleOverlappingTrip_StatusIsTentative()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10)); // Thursday, 3-day trip -> Sept 10-12
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, DayOfWeek = DayOfWeek.Thursday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 9, 1), Status = LeaveStatus.Pending,
            RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
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

    // ── Unified ScheduleStaffDto.Availability list (Deliverable 1) ──

    /// <summary>
    /// A staff member with one approved leave, one pending recurring rule, and one legacy
    /// Training row — all overlapping the trip window — gets three ScheduleAvailabilityItemDto
    /// entries sourced from the raw records (not the expanded unavailability windows), with the
    /// right Kind/Status/fields on each.
    /// </summary>
    [Fact]
    public async Task AvailabilityList_IncludesApprovedLeavePendingRuleAndLegacyRow_WithCorrectFields()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10)); // Thursday, 3-day trip -> Sept 10-12

        var leave = new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 11),
            Status = LeaveStatus.Approved, Reason = "Family event",
            RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.LeaveRequests.Add(leave);

        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, DayOfWeek = DayOfWeek.Thursday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 9, 1), Status = LeaveStatus.Pending,
            Notes = "Study block", RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);

        var legacy = new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, AvailabilityType = AvailabilityType.Training,
            Notes = "First aid refresher",
            StartDateTime = new DateOnly(2026, 9, 10).ToDateTime(new TimeOnly(9, 0)),
            EndDateTime = new DateOnly(2026, 9, 10).ToDateTime(new TimeOnly(12, 0)),
        };
        db.StaffAvailabilities.Add(legacy);
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        var items = AvailabilityFor(body, staff.Id);
        Assert.Equal(3, items.Count);

        var leaveItem = Assert.Single(items, i => i.Kind == ScheduleAvailabilityKind.Leave);
        Assert.Equal(leave.Id, leaveItem.Id);
        Assert.Equal(LeaveStatus.Approved, leaveItem.Status);
        Assert.Equal(LeaveType.Annual, leaveItem.LeaveType);
        Assert.Equal(new DateOnly(2026, 9, 10), leaveItem.StartDate);
        Assert.Equal(new DateOnly(2026, 9, 11), leaveItem.EndDate);
        Assert.Equal("Family event", leaveItem.Notes);

        var ruleItem = Assert.Single(items, i => i.Kind == ScheduleAvailabilityKind.RecurringRule);
        Assert.Equal(rule.Id, ruleItem.Id);
        Assert.Equal(LeaveStatus.Pending, ruleItem.Status);
        Assert.Equal(DayOfWeek.Thursday, ruleItem.DayOfWeek);
        Assert.Equal(new TimeOnly(9, 0), ruleItem.StartTime);
        Assert.Equal(new TimeOnly(12, 0), ruleItem.EndTime);
        Assert.Equal(new DateOnly(2026, 9, 1), ruleItem.StartDate);
        Assert.Null(ruleItem.EndDate);
        Assert.Equal("Study block", ruleItem.Notes);

        var legacyItem = Assert.Single(items, i => i.Kind == ScheduleAvailabilityKind.Legacy);
        Assert.Equal(legacy.Id, legacyItem.Id);
        Assert.Null(legacyItem.Status);
        Assert.Equal(AvailabilityType.Training, legacyItem.AvailabilityType);
        Assert.Equal(new DateOnly(2026, 9, 10), legacyItem.StartDate);
        Assert.Equal(new DateOnly(2026, 9, 10), legacyItem.EndDate);
        Assert.Equal("First aid refresher", legacyItem.Notes);
    }

    [Fact]
    public async Task AvailabilityList_ExcludesDeclinedLeaveAndCancelledRule()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));

        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 9, 10), EndDate = new DateOnly(2026, 9, 11),
            Status = LeaveStatus.Declined, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, DayOfWeek = DayOfWeek.Thursday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 9, 1), Status = LeaveStatus.Cancelled,
            RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Empty(AvailabilityFor(body, staff.Id));
    }

    [Fact]
    public async Task AvailabilityList_ExcludesLeaveOutsideWindow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10)); // window: Sept 10-12

        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = staff.Id, LeaveType = LeaveType.Annual,
            StartDate = new DateOnly(2026, 8, 1), EndDate = new DateOnly(2026, 8, 2),
            Status = LeaveStatus.Approved, RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        Assert.Empty(AvailabilityFor(body, staff.Id));
    }

    [Fact]
    public async Task AvailabilityList_IncludesOpenEndedRuleStartingBeforeWindow()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10)); // window: Sept 10-12

        var rule = new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, DayOfWeek = DayOfWeek.Thursday,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(12, 0),
            EffectiveFrom = new DateOnly(2026, 8, 1), EffectiveTo = null, Status = LeaveStatus.Approved,
            RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        };
        db.RecurringUnavailabilities.Add(rule);
        db.SaveChanges();

        var controller = new ScheduleController(db, new StaffUnavailabilityQuery(db));
        var result = await controller.GetScheduleOverview(new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 30), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ScheduleOverviewDto>>(ok.Value);
        var item = Assert.Single(AvailabilityFor(body, staff.Id));
        Assert.Equal(rule.Id, item.Id);
        Assert.Equal(ScheduleAvailabilityKind.RecurringRule, item.Kind);
    }
}
