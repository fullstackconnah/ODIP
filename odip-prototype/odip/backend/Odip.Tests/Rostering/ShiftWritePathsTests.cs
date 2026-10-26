using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Rostering;

/// <summary>
/// The tripwire for the Upcoming shifts import's partial undo: undo deletes a Draft whose UpdatedAt still equals its CreatedAt, so every roster
/// write that can change a Draft must move UpdatedAt, or undo would delete an edited shift. The grep of write paths found none that misses it.
/// </summary>
public class ShiftWritePathsTests
{
    private static readonly DateOnly Monday = new(2026, 8, 24);

    private sealed class FixedClock(DateTimeOffset now) : TimeProvider { public override DateTimeOffset GetUtcNow() => now; }

    public static TheoryData<string> Paths => new() { "update", "cancel", "assign", "move-staff", "swap", "publish-week" };

    [Theory]
    [MemberData(nameof(Paths))]
    public async Task ShiftWritePaths_BumpUpdatedAt(string path)
    {
        var tenantId = Guid.NewGuid();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db),
            clock: new FixedClock(new DateTimeOffset(2026, 8, 20, 0, 0, 0, TimeSpan.Zero)), tenant: tenant.Object);

        User Staff(string first) => db.Users.Add(new User
        {
            Id = Guid.NewGuid(), FirstName = first, LastName = "Ng", Username = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid()}@example.com",
            Role = UserRole.SupportWorker, Position = Position.SupportWorker, IsActive = true, WorkerScreeningNumber = "WSC-1", WorkerScreeningExpiryDate = new DateOnly(2035, 1, 1),
        }).Entity;
        var sam = Staff("Sam");
        var alex = Staff("Alex");
        var mia = db.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Mia", LastName = "Chen", IsActive = true }).Entity;
        // CreatedAt = UpdatedAt a day back, so a same-tick UtcNow cannot make the check pass by accident.
        var then = DateTime.UtcNow.AddDays(-1);
        Shift Draft(Guid? userId, int day) => db.Shifts.Add(new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = mia.Id, UserId = userId, ServiceDate = Monday.AddDays(day), StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(15, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.Draft, CreatedAt = then, UpdatedAt = then,
        }).Entity;
        var shift = Draft(path is "assign" ? null : sam.Id, 0);
        var other = Draft(path is "move-staff" ? null : alex.Id, 1);
        await db.SaveChangesAsync();

        UpdateShiftDto Edit(ShiftStatus status) => new()
        {
            ParticipantId = mia.Id, StaffId = sam.Id, ServiceDate = shift.ServiceDate, StartTime = new TimeOnly(10, 0), EndTime = new TimeOnly(15, 0),
            Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = status,
        };
        IActionResult? result = path switch
        {
            "update" => (await controller.UpdateShift(shift.Id, Edit(ShiftStatus.Draft), default)).Result,
            "cancel" => (await controller.UpdateShift(shift.Id, Edit(ShiftStatus.Cancelled), default)).Result,
            "assign" => (await controller.AssignShift(shift.Id, new AssignShiftDto { StaffId = alex.Id, ExpectedStaffId = null }, default)).Result,
            "move-staff" => (await controller.MoveStaff(new MoveStaffDto { FromShiftId = shift.Id, ToShiftId = other.Id, Mode = MoveStaffMode.Move }, default)).Result,
            "swap" => (await controller.MoveStaff(new MoveStaffDto { FromShiftId = shift.Id, ToShiftId = other.Id, Mode = MoveStaffMode.Swap }, default)).Result,
            _ => (await controller.PublishWeek(Monday, default)).Result,
        };

        Assert.IsType<OkObjectResult>(result);
        var after = await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shift.Id);
        Assert.NotEqual(after.CreatedAt, after.UpdatedAt);
        Assert.True(after.UpdatedAt > then);
    }
}
