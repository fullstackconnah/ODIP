using System.Security.Claims;
using Microsoft.AspNetCore.Http;
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
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// Double-booking a worker is refused for a Coordinator and needs a written reason from an Admin (spec 2026-10-27), on the four writes that place a worker: create, update, assign and move-staff.
/// An existing clash stays cancellable and editable. Modelled on <see cref="RosteringBudgetGateTests"/>'s role-based controller.
/// </summary>
public class RosterDoubleBookingGateTests
{
    private static readonly DateOnly Monday = new(2026, 8, 24);
    private const string Reason = "Covering a sick call, the worker agreed to both.";

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    private static RosteringController Controller(OdipDbContext db, string role) =>
        new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: new FixedClock(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero)))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(new[] { new Claim(ClaimTypes.Role, role) }, "test")) },
            },
        };

    private static User SeedStaff(OdipDbContext db)
    {
        var user = new User
        {
            Id = Guid.NewGuid(), FirstName = "Sam", LastName = "Wilson", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2030, 1, 1),
        };
        db.Users.Add(user);
        db.SaveChangesAsync().GetAwaiter().GetResult();
        return user;
    }

    private static Participant SeedParticipant(OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Mia", LastName = "Chen", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChangesAsync().GetAwaiter().GetResult();
        return participant;
    }

    private static Shift SeedShift(OdipDbContext db, Guid participantId, Guid? userId, int startHour = 9, int endHour = 15, DateOnly? day = null, ShiftStatus status = ShiftStatus.Draft)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, UserId = userId, ServiceDate = day ?? Monday, StartTime = new TimeOnly(startHour, 0), EndTime = new TimeOnly(endHour, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
        };
        db.Shifts.Add(shift);
        db.SaveChangesAsync().GetAwaiter().GetResult();
        return shift;
    }

    private static UpdateShiftDto Update(Shift shift, Guid? staffId = null, ShiftStatus? status = null, string? notes = null, string? reason = null) => new()
    {
        ParticipantId = shift.ParticipantId, StaffId = staffId ?? shift.UserId, ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
        Ratio = shift.Ratio, NightType = shift.NightType, Status = status ?? shift.Status, Notes = notes ?? shift.Notes, OverrideReason = reason,
    };

    private static ApiResponse<List<RosterFindingDto>> Refused<T>(ActionResult<ApiResponse<T>> result) =>
        (ApiResponse<List<RosterFindingDto>>)Assert.IsType<UnprocessableEntityObjectResult>(result.Result).Value!;

    private static void AssertSaved<T>(ActionResult<ApiResponse<T>> result) => Assert.IsType<OkObjectResult>(result.Result);

    private static void AssertBlocked<T>(ActionResult<ApiResponse<T>> result)
    {
        var finding = Assert.Single(Refused(result).Data!, f => f.Code == RosterConflictService.DoubleBookedShift);
        Assert.Equal(RosterFindingSeverity.Blocking, finding.Severity);
        Assert.Contains("An admin can override", finding.Message);
    }

    private static void AssertNeedsReason<T>(ActionResult<ApiResponse<T>> result)
    {
        var finding = Assert.Single(Refused(result).Data!, f => f.Code == RosterConflictService.DoubleBookedShift);
        Assert.Equal(RosterFindingSeverity.Warning, finding.Severity);
        Assert.True(finding.RequiresReason);
    }

    private static async Task AssertReasonStored(OdipDbContext db, Guid shiftId)
    {
        var saved = await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shiftId);
        Assert.Equal(Reason, saved.OverrideReason);
        Assert.Contains(RosterConflictService.DoubleBookedShift, saved.AcknowledgedFindingCodes!);
    }

    // ── Create ──

    private static CreateShiftDto Create(Guid participantId, Guid staffId, string? reason = null, List<string>? codes = null) => new()
    {
        ParticipantId = participantId, StaffId = staffId, ServiceDate = Monday, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(12, 0),
        Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, OverrideReason = reason, AcknowledgedFindingCodes = codes,
    };

    [Fact]
    public async Task Create_ACoordinatorIsRefused_AndNothingIsSaved()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db); var mia = SeedParticipant(db); SeedShift(db, mia.Id, sam.Id);

        var result = await Controller(db, "Coordinator").CreateShift(Create(mia.Id, sam.Id, Reason, [RosterConflictService.DoubleBookedShift]), default);

        AssertBlocked(result);
        Assert.Equal(1, await db.Shifts.CountAsync());
    }

    [Fact]
    public async Task Create_AnAdminNeedsAReason_ThenSavesWithItStored()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db); var mia = SeedParticipant(db); SeedShift(db, mia.Id, sam.Id);
        var admin = Controller(db, "Admin");

        AssertNeedsReason(await admin.CreateShift(Create(mia.Id, sam.Id), default));
        Assert.Equal(1, await db.Shifts.CountAsync());

        var saved = await admin.CreateShift(Create(mia.Id, sam.Id, Reason, [RosterConflictService.DoubleBookedShift]), default);

        AssertSaved(saved);
        var id = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(saved.Result).Value).Data!.Id;
        await AssertReasonStored(db, id);
    }

    // ── Update ──

    [Fact]
    public async Task Update_PuttingAWorkerOnAClashingShift_BlocksACoordinator_AndNeedsAnAdminsReason()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db); var mia = SeedParticipant(db);
        SeedShift(db, mia.Id, sam.Id);
        var target = SeedShift(db, mia.Id, null, 10, 12);

        AssertBlocked(await Controller(db, "Coordinator").UpdateShift(target.Id, Update(target, sam.Id), default));
        AssertNeedsReason(await Controller(db, "Admin").UpdateShift(target.Id, Update(target, sam.Id), default));
        db.ChangeTracker.Clear();
        Assert.Null((await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == target.Id)).UserId);

        AssertSaved(await Controller(db, "SuperAdmin").UpdateShift(target.Id, Update(target, sam.Id, reason: Reason), default));
        await AssertReasonStored(db, target.Id);
    }

    [Fact]
    public async Task Update_AnExistingClash_CanBeEditedForNotes_AndCancelled_ByACoordinator()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db); var mia = SeedParticipant(db);
        SeedShift(db, mia.Id, sam.Id);
        var clashing = SeedShift(db, mia.Id, sam.Id, 10, 12);
        var coordinator = Controller(db, "Coordinator");

        AssertSaved(await coordinator.UpdateShift(clashing.Id, Update(clashing, notes: "Bring the hoist"), default));
        db.ChangeTracker.Clear();
        AssertSaved(await coordinator.UpdateShift(clashing.Id, Update(clashing, status: ShiftStatus.Cancelled), default));

        var saved = await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == clashing.Id);
        Assert.Equal(ShiftStatus.Cancelled, saved.Status);
    }

    [Fact]
    public async Task Update_ACancelledShiftDoesNotBlockTheWorkersOtherShifts()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db); var mia = SeedParticipant(db);
        SeedShift(db, mia.Id, sam.Id, status: ShiftStatus.Cancelled);
        var target = SeedShift(db, mia.Id, null, 10, 12);

        AssertSaved(await Controller(db, "Coordinator").UpdateShift(target.Id, Update(target, sam.Id), default));
    }

    // ── Assign ──

    [Fact]
    public async Task Assign_ACoordinatorIsRefused_AnAdminNeedsAReason()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db); var mia = SeedParticipant(db);
        SeedShift(db, mia.Id, sam.Id);
        var target = SeedShift(db, mia.Id, null, 10, 12);
        var withReason = new AssignShiftDto { StaffId = sam.Id, OverrideReason = Reason, AcknowledgedFindingCodes = [RosterConflictService.DoubleBookedShift] };

        AssertBlocked(await Controller(db, "Coordinator").AssignShift(target.Id, withReason, default));
        AssertNeedsReason(await Controller(db, "Admin").AssignShift(target.Id, new AssignShiftDto { StaffId = sam.Id }, default));

        AssertSaved(await Controller(db, "Admin").AssignShift(target.Id, withReason, default));
        await AssertReasonStored(db, target.Id);
    }

    // ── Move staff ──

    [Fact]
    public async Task MoveStaff_ACoordinatorIsRefused_AnAdminNeedsAReason()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db); var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, sam.Id);
        SeedShift(db, mia.Id, sam.Id, 10, 12, Monday.AddDays(1));
        var to = SeedShift(db, mia.Id, null, 9, 15, Monday.AddDays(1));
        MoveStaffDto Move(string? reason = null) => new()
        {
            FromShiftId = from.Id, ToShiftId = to.Id, Mode = MoveStaffMode.Move, StaffId = sam.Id, OverrideReason = reason,
            AcknowledgedFindingCodes = reason is null ? null : [RosterConflictService.DoubleBookedShift],
        };

        AssertBlocked(await Controller(db, "Coordinator").MoveStaff(Move(Reason), default));
        AssertNeedsReason(await Controller(db, "Admin").MoveStaff(Move(), default));

        AssertSaved(await Controller(db, "Admin").MoveStaff(Move(Reason), default));
        await AssertReasonStored(db, to.Id);
    }

    [Fact]
    public async Task MoveStaff_ToAnEmptyShift_DoesNotClashWithTheShiftTheWorkerLeaves()
    {
        using var db = TestDb.Create();
        var sam = SeedStaff(db); var mia = SeedParticipant(db);
        var from = SeedShift(db, mia.Id, sam.Id);
        var to = SeedShift(db, mia.Id, null, 10, 12);

        AssertSaved(await Controller(db, "Coordinator").MoveStaff(new MoveStaffDto { FromShiftId = from.Id, ToShiftId = to.Id, Mode = MoveStaffMode.Move, StaffId = sam.Id }, default));
    }
}
