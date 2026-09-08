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
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// StaffAssignmentsController's trip-side parity with RosteringController: the same
/// Blocking/RequiresReason/override gate (via RosterGate), HasConflict correctly derived on both
/// create and update, /check never writing. See
/// docs/specs/2026-09-07-staff-leave-unavailability-design.md §3, Testing section.
/// </summary>
public class StaffAssignmentGateTests
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
            WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
        };
        db.Users.Add(staff);
        db.SaveChanges();
        return staff;
    }

    private static TripInstance SeedTrip(OdipDbContext db, DateOnly start, int days = 5)
    {
        var trip = new TripInstance { Id = Guid.NewGuid(), TripName = "Beach Trip", StartDate = start, DurationDays = days };
        db.TripInstances.Add(trip);
        db.SaveChanges();
        return trip;
    }

    private static void SeedApprovedLeave(OdipDbContext db, Guid userId, DateOnly start, DateOnly end)
    {
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = userId, LeaveType = LeaveType.Annual,
            StartDate = start, EndDate = end, Status = LeaveStatus.Approved,
            RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
    }

    private static void SeedPendingLeave(OdipDbContext db, Guid userId, DateOnly start, DateOnly end)
    {
        db.LeaveRequests.Add(new LeaveRequest
        {
            Id = Guid.NewGuid(), UserId = userId, LeaveType = LeaveType.Annual,
            StartDate = start, EndDate = end, Status = LeaveStatus.Pending,
            RequestedByUserId = userId, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();
    }

    private static CreateStaffAssignmentDto CreateDto(Guid tripId, Guid staffId, DateOnly start, DateOnly end, string? overrideReason = null) => new()
    {
        TripInstanceId = tripId, StaffId = staffId, AssignmentStart = start, AssignmentEnd = end,
        IsDriver = false, SleepoverType = SleepoverType.None, OverrideReason = overrideReason,
    };

    [Fact]
    public async Task Check_ApprovedLeaveOverlap_ReturnsStaffOnLeaveFinding_AndNeverWrites()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedApprovedLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = new CheckStaffAssignmentDto
        {
            StaffId = staff.Id, TripInstanceId = trip.Id,
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
        };

        var result = await controller.Check(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(ok.Value);
        Assert.Contains(body.Data!, f => f.Code == RosterConflictService.StaffOnLeave && f.RequiresReason);
        Assert.Empty(await db.StaffAssignments.ToListAsync());
    }

    [Fact]
    public async Task Create_ApprovedLeaveOverlap_NoReason_Returns422_AndDoesNotSave()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedApprovedLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.Empty(await db.StaffAssignments.ToListAsync());
    }

    [Fact]
    public async Task Create_ApprovedLeaveOverlap_WithReason_Succeeds_SetsHasConflictTrue_RecordsCode()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedApprovedLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), overrideReason: "Approved by manager, staff volunteered.");

        var result = await controller.Create(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(ok.Value);
        Assert.True(body.Data!.HasConflict);
        Assert.Equal("Approved by manager, staff volunteered.", body.Data.OverrideReason);
        Assert.Contains(RosterConflictService.StaffOnLeave, body.Data.AcknowledgedFindingCodes);

        var saved = await db.StaffAssignments.SingleAsync();
        Assert.True(saved.HasConflict);
    }

    [Fact]
    public async Task Create_PendingLeaveOverlap_NoReason_Succeeds_HasConflictFalse_CodeStillRecorded()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedPendingLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var result = await controller.Create(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(ok.Value);
        Assert.False(body.Data!.HasConflict);
        Assert.Null(body.Data.OverrideReason);
        Assert.Contains(RosterConflictService.StaffLeavePending, body.Data.AcknowledgedFindingCodes);
    }

    [Fact]
    public async Task Update_MovingOutOfLeaveWindow_ClearsHasConflictAndOverrideReason()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10), days: 10);
        SeedApprovedLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var createResult = await controller.Create(
            CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), overrideReason: "Covering shortfall."),
            CancellationToken.None);
        var created = ((ApiResponse<StaffAssignmentDto>)((OkObjectResult)createResult.Result!).Value!).Data!;
        Assert.True(created.HasConflict);

        var updateDto = new UpdateStaffAssignmentDto
        {
            TripInstanceId = trip.Id, StaffId = staff.Id,
            AssignmentStart = new DateOnly(2026, 9, 15), AssignmentEnd = new DateOnly(2026, 9, 17),
            IsDriver = false, SleepoverType = SleepoverType.None, Status = AssignmentStatus.Confirmed,
        };
        var updateResult = await controller.Update(created.Id, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(ok.Value);
        Assert.False(body.Data!.HasConflict);
        Assert.Null(body.Data.OverrideReason);
    }

    [Fact]
    public async Task Update_SameDatesUnchanged_DoesNotFlagDoubleBookedAgainstItself()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10), days: 3);

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var createResult = await controller.Create(
            CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12)),
            CancellationToken.None);
        var created = ((ApiResponse<StaffAssignmentDto>)((OkObjectResult)createResult.Result!).Value!).Data!;

        var updateDto = new UpdateStaffAssignmentDto
        {
            TripInstanceId = trip.Id, StaffId = staff.Id,
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
            IsDriver = true, SleepoverType = SleepoverType.None, Status = AssignmentStatus.Confirmed,
        };
        var updateResult = await controller.Update(created.Id, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(ok.Value);
        Assert.False(body.Data!.HasConflict);
        Assert.True(body.Data.IsDriver);
    }

    [Fact]
    public async Task Recheck_DerivesHasConflictFromOverrideReason_NotFromOtherAssignmentsOrAvailability()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));

        var overriddenButFlaggedFalse = new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = staff.Id,
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
            Status = AssignmentStatus.Confirmed, OverrideReason = "x", HasConflict = false,
        };
        var notOverriddenButFlaggedTrue = new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = staff.Id,
            AssignmentStart = new DateOnly(2026, 9, 20), AssignmentEnd = new DateOnly(2026, 9, 22),
            Status = AssignmentStatus.Confirmed, OverrideReason = null, HasConflict = true,
        };
        db.StaffAssignments.AddRange(overriddenButFlaggedFalse, notOverriddenButFlaggedTrue);
        db.SaveChanges();

        var controller = new ConflictsController(db);
        await controller.Recheck(CancellationToken.None);

        var refreshed = await db.StaffAssignments.ToDictionaryAsync(a => a.Id, a => a.HasConflict);
        Assert.True(refreshed[overriddenButFlaggedFalse.Id]);
        Assert.False(refreshed[notOverriddenButFlaggedTrue.Id]);
    }
}
