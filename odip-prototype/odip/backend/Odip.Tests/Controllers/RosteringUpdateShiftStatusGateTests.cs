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
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>
/// UpdateShift's status-transition gate (design spec §2): PUT can still toggle Draft↔Published
/// (today's only real use) but can no longer jump straight to Completed/InProgress/
/// PendingReview — those are only reachable via the shift-completion endpoints from this point on.
/// </summary>
public class RosteringUpdateShiftStatusGateTests
{
    private static readonly DateOnly ServiceDate = new(2026, 9, 8);

    private static OdipDbContext CreateDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;

        return new OdipDbContext(options, tenant.Object);
    }

    private static Participant SeedParticipant(OdipDbContext db)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        db.SaveChanges();
        return participant;
    }

    private static Shift SeedShift(OdipDbContext db, Guid participantId, ShiftStatus status)
    {
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participantId, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = status,
        };
        db.Shifts.Add(shift);
        db.SaveChanges();
        return shift;
    }

    private static UpdateShiftDto DtoFor(Shift shift, ShiftStatus newStatus) => new()
    {
        ParticipantId = shift.ParticipantId, StaffId = shift.UserId, ServiceDate = shift.ServiceDate,
        StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
        Ratio = shift.Ratio, NightType = shift.NightType, Status = newStatus,
    };

    [Theory]
    [InlineData(ShiftStatus.Draft, ShiftStatus.Published)]
    [InlineData(ShiftStatus.Published, ShiftStatus.Draft)]
    [InlineData(ShiftStatus.Draft, ShiftStatus.Draft)]
    public async Task UpdateShift_DraftPublishedToggle_Succeeds(ShiftStatus from, ShiftStatus to)
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, from);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.UpdateShift(shift.Id, DtoFor(shift, to), CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
        Assert.Equal(to, body.Data!.Status);
    }

    [Theory]
    [InlineData(ShiftStatus.Draft, ShiftStatus.Completed)]
    [InlineData(ShiftStatus.Published, ShiftStatus.InProgress)]
    [InlineData(ShiftStatus.Published, ShiftStatus.PendingReview)]
    [InlineData(ShiftStatus.Published, ShiftStatus.Completed)]
    [InlineData(ShiftStatus.InProgress, ShiftStatus.Published)]
    [InlineData(ShiftStatus.PendingReview, ShiftStatus.Completed)]
    [InlineData(ShiftStatus.Completed, ShiftStatus.Published)]
    public async Task UpdateShift_AnyOtherStatusJump_Returns409_WithStatusTransitionCode(ShiftStatus from, ShiftStatus to)
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, from);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.UpdateShift(shift.Id, DtoFor(shift, to), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(conflict.Value);
        Assert.Equal("STATUS_TRANSITION_VIA_COMPLETION", body.Code);

        var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(from, saved.Status); // rejected write must not persist
    }
}
