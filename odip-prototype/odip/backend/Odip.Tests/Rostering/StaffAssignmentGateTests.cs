using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Rostering;

/// <summary>
/// StaffAssignmentsController's trip-side parity with RosteringController: the same
/// Blocking/RequiresReason/override gate (via RosterGate), HasConflict correctly derived on both
/// create and update, /check never writing. See
/// docs/specs/2026-09-07-staff-leave-unavailability-design.md §3, Testing section.
/// </summary>
public class StaffAssignmentGateTests
{
    private static OdipDbContext CreateDb(string dbName) => TestDb.Create(dbName);

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

    /// <summary>
    /// Spec §3: HasConflict means "a hard finding was overridden". A pending-leave overlap only
    /// raises STAFF_LEAVE_PENDING (RequiresReason == false), so a reason typed against it anyway
    /// must be discarded rather than persisted — otherwise HasConflict would flip true off a soft
    /// finding nobody was required to justify.
    /// </summary>
    [Fact]
    public async Task Create_PendingLeaveOverlap_WithReasonTyped_StillHasConflictFalse_ReasonNotStored()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        SeedPendingLeave(db, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), overrideReason: "not needed");

        var result = await controller.Create(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(ok.Value);
        Assert.False(body.Data!.HasConflict);
        Assert.Null(body.Data.OverrideReason);
        Assert.Contains(RosterConflictService.StaffLeavePending, body.Data.AcknowledgedFindingCodes);

        var saved = await db.StaffAssignments.SingleAsync();
        Assert.False(saved.HasConflict);
        Assert.Null(saved.OverrideReason);
        Assert.Contains(RosterConflictService.StaffLeavePending, saved.AcknowledgedFindingCodes);
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
    public async Task Check_OvernightShiftEndingDayBefore_FiresDoubleBookedShift()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng" };
        db.Participants.Add(participant);
        db.SaveChanges();

        var assignmentStart = new DateOnly(2026, 9, 10);
        var assignmentEnd = new DateOnly(2026, 9, 12);
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id,
            ServiceDate = assignmentStart.AddDays(-1),
            StartTime = new TimeOnly(20, 0), EndTime = new TimeOnly(6, 0), EndsNextDay = true,
        });
        db.SaveChanges();

        var trip = SeedTrip(db, assignmentStart);
        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = new CheckStaffAssignmentDto
        {
            StaffId = staff.Id, TripInstanceId = trip.Id,
            AssignmentStart = assignmentStart, AssignmentEnd = assignmentEnd,
        };

        var result = await controller.Check(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(ok.Value);
        Assert.Contains(body.Data!, f => f.Code == RosterConflictService.DoubleBookedShift);
    }

    [Fact]
    public async Task Check_ShiftDayBeforeNotOvernight_DoesNotFireDoubleBookedShift()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng" };
        db.Participants.Add(participant);
        db.SaveChanges();

        var assignmentStart = new DateOnly(2026, 9, 10);
        var assignmentEnd = new DateOnly(2026, 9, 12);
        db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, UserId = staff.Id,
            ServiceDate = assignmentStart.AddDays(-1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), EndsNextDay = false,
        });
        db.SaveChanges();

        var trip = SeedTrip(db, assignmentStart);
        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = new CheckStaffAssignmentDto
        {
            StaffId = staff.Id, TripInstanceId = trip.Id,
            AssignmentStart = assignmentStart, AssignmentEnd = assignmentEnd,
        };

        var result = await controller.Check(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(ok.Value);
        Assert.DoesNotContain(body.Data!, f => f.Code == RosterConflictService.DoubleBookedShift);
    }

    [Fact]
    public async Task Update_StatusCancelled_SkipsGate_NoOverrideReasonRequired()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
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
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
            IsDriver = false, SleepoverType = SleepoverType.None, Status = AssignmentStatus.Cancelled,
        };
        var updateResult = await controller.Update(created.Id, updateDto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(updateResult.Result);
        var body = Assert.IsType<ApiResponse<StaffAssignmentDto>>(ok.Value);
        Assert.Equal(AssignmentStatus.Cancelled, body.Data!.Status);

        var saved = await db.StaffAssignments.SingleAsync(x => x.Id == created.Id);
        Assert.Equal(AssignmentStatus.Cancelled, saved.Status);
    }

    [Fact]
    public async Task Create_BlockingFindingOverlap_WithReason_StillReturns422_AndDoesNotSave()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = new User
        {
            Id = Guid.NewGuid(), FirstName = "Ben", LastName = "Turner",
            Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true,
            WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2020, 1, 1),
        };
        db.Users.Add(staff);
        db.SaveChanges();
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = CreateDto(trip.Id, staff.Id, new DateOnly(2026, 9, 10), new DateOnly(2026, 9, 12), overrideReason: "reason");

        var result = await controller.Create(dto, CancellationToken.None);

        Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        Assert.Empty(await db.StaffAssignments.ToListAsync());
    }

    [Fact]
    public async Task Check_WithExcludeAssignmentId_DoesNotDoubleBookAgainstExcludedAssignment()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        var otherTrip = SeedTrip(db, new DateOnly(2026, 9, 11));

        var existing = new StaffAssignment
        {
            Id = Guid.NewGuid(), TripInstanceId = trip.Id, UserId = staff.Id,
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
            Status = AssignmentStatus.Confirmed,
        };
        db.StaffAssignments.Add(existing);
        db.SaveChanges();

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));

        // Without ExcludeAssignmentId, the overlapping existing assignment fires DOUBLE_BOOKED_TRIP.
        var withoutExclude = await controller.Check(new CheckStaffAssignmentDto
        {
            StaffId = staff.Id, TripInstanceId = otherTrip.Id,
            AssignmentStart = new DateOnly(2026, 9, 11), AssignmentEnd = new DateOnly(2026, 9, 13),
        }, CancellationToken.None);
        var withoutExcludeBody = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(Assert.IsType<OkObjectResult>(withoutExclude.Result).Value);
        Assert.Contains(withoutExcludeBody.Data!, f => f.Code == RosterConflictService.DoubleBookedTrip);

        // With ExcludeAssignmentId pointing at the same row being re-checked, it no longer double-books against itself.
        var withExclude = await controller.Check(new CheckStaffAssignmentDto
        {
            StaffId = staff.Id, TripInstanceId = trip.Id,
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
            ExcludeAssignmentId = existing.Id,
        }, CancellationToken.None);
        var withExcludeBody = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(Assert.IsType<OkObjectResult>(withExclude.Result).Value);
        Assert.DoesNotContain(withExcludeBody.Data!, f => f.Code == RosterConflictService.DoubleBookedTrip);
    }

    [Fact]
    public async Task Create_ApprovedRecurringRuleOverlap_NoReason_Returns422_WithStaffRecurringUnavailableCode()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);

        // Fixed date (not Today) so the weekday is deterministic across runs.
        var assignmentStart = new DateOnly(2026, 9, 10);
        var trip = SeedTrip(db, assignmentStart, days: 1);

        db.RecurringUnavailabilities.Add(new RecurringUnavailability
        {
            Id = Guid.NewGuid(), UserId = staff.Id, DayOfWeek = assignmentStart.DayOfWeek,
            StartTime = new TimeOnly(0, 0), EndTime = new TimeOnly(23, 59),
            EffectiveFrom = assignmentStart, Status = LeaveStatus.Approved,
            RequestedByUserId = staff.Id, RequestedAt = DateTime.UtcNow,
        });
        db.SaveChanges();

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = CreateDto(trip.Id, staff.Id, assignmentStart, assignmentStart);

        var result = await controller.Create(dto, CancellationToken.None);

        var unprocessable = Assert.IsType<UnprocessableEntityObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(unprocessable.Value);
        Assert.Contains(body.Data!, f => f.Code == RosterConflictService.StaffRecurringUnavailable && f.RequiresReason);
        Assert.Empty(await db.StaffAssignments.ToListAsync());
    }

    // ── PUBLIC_HOLIDAY (connection-map item 8): trips already price holidays in claims and span
    // multiple days, so RosterConflictService.CheckStaffAssignment never fires PUBLIC_HOLIDAY —
    // even when a seeded holiday falls squarely inside the assignment window. ──

    [Fact]
    public async Task Check_HolidayInsideAssignmentWindow_NeverReturnsPublicHolidayFinding()
    {
        using var db = CreateDb(Guid.NewGuid().ToString());
        var staff = SeedStaff(db);
        var trip = SeedTrip(db, new DateOnly(2026, 9, 10));
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = new DateOnly(2026, 9, 11), Name = "Test Holiday", State = null });
        db.SaveChanges();

        var controller = new StaffAssignmentsController(db, new StaffUnavailabilityQuery(db));
        var dto = new CheckStaffAssignmentDto
        {
            StaffId = staff.Id, TripInstanceId = trip.Id,
            AssignmentStart = new DateOnly(2026, 9, 10), AssignmentEnd = new DateOnly(2026, 9, 12),
        };

        var result = await controller.Check(dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<List<RosterFindingDto>>>(ok.Value);
        Assert.DoesNotContain(body.Data!, f => f.Code == RosterConflictService.PublicHoliday);
    }
}
