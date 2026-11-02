using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using Odip.Tests.Support;

namespace Odip.Tests.Controllers;

/// <summary>
/// UpdateShift's status-transition gate (design spec §2): PUT can still toggle Draft↔Published
/// (today's only real use) but can no longer jump straight to Completed/InProgress/
/// PendingReview — those are only reachable via the shift-completion endpoints from this point on.
/// Cancelled → Draft/Published (un-cancel) is also allowed via PUT.
/// </summary>
public class RosteringUpdateShiftStatusGateTests
{
    private static readonly DateOnly ServiceDate = new(2026, 9, 8);

    private static OdipDbContext CreateDb() => TestDb.Create();

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
            NightType = SleepoverType.None, Status = status, UserId = Guid.NewGuid(),
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
    [InlineData(ShiftStatus.Draft, ShiftStatus.Cancelled)]
    [InlineData(ShiftStatus.Published, ShiftStatus.Cancelled)]
    [InlineData(ShiftStatus.Cancelled, ShiftStatus.Draft)]
    [InlineData(ShiftStatus.Cancelled, ShiftStatus.Published)]
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
    [InlineData(ShiftStatus.Cancelled, ShiftStatus.Completed)]
    [InlineData(ShiftStatus.Cancelled, ShiftStatus.InProgress)]
    [InlineData(ShiftStatus.InProgress, ShiftStatus.Cancelled)]
    [InlineData(ShiftStatus.PendingReview, ShiftStatus.Cancelled)]
    [InlineData(ShiftStatus.Completed, ShiftStatus.Cancelled)]
    public async Task UpdateShift_AnyOtherStatusJump_Returns409_WithStatusTransitionCode(ShiftStatus from, ShiftStatus to)
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, from);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.UpdateShift(shift.Id, DtoFor(shift, to), CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(conflict.Value);
        Assert.Equal("SHIFT_STATUS_LOCKED", body.Code);

        var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(from, saved.Status); // rejected write must not persist
    }

    [Fact]
    public async Task UpdateShift_PendingReview_TimeChange_Returns409()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, ShiftStatus.PendingReview);
        var dto = DtoFor(shift, shift.Status) with { StartTime = shift.StartTime.AddHours(1) };
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.UpdateShift(shift.Id, dto, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(conflict.Value);
        Assert.Equal("SHIFT_TIMES_LOCKED", body.Code);

        var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal(shift.StartTime, saved.StartTime); // rejected write must not persist
    }

    [Fact]
    public async Task UpdateShift_PendingReview_NonTimeChange_Returns200()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, ShiftStatus.PendingReview);
        var dto = DtoFor(shift, shift.Status) with { Notes = "Updated coordinator note." };
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var result = await controller.UpdateShift(shift.Id, dto, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(ok.Value);
        Assert.Equal("Updated coordinator note.", body.Data!.Notes);

        var saved = await db.Shifts.SingleAsync(s => s.Id == shift.Id);
        Assert.Equal("Updated coordinator note.", saved.Notes);
    }

    // ── Cancel time and the claim lock (claims PR2) ────────────────────────

    private static async Task<Shift> UpdateAsync(OdipDbContext db, Shift shift, UpdateShiftDto dto)
    {
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));
        var result = await controller.UpdateShift(shift.Id, dto, CancellationToken.None);
        Assert.IsType<OkObjectResult>(result.Result);
        return await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shift.Id);
    }

    private static ClaimLineItem ClaimOn(OdipDbContext db, Shift shift, ClaimLineItemStatus lineStatus = ClaimLineItemStatus.Draft)
    {
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = shift.ParticipantId, Status = TripClaimStatus.Draft, ClaimReference = "TC-CANC-0001", TotalAmount = 100m };
        var line = new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, SupportItemCode = "04_Weekday_STD", DayType = ClaimDayType.Weekday, SupportsDeliveredFrom = shift.ServiceDate,
            SupportsDeliveredTo = shift.ServiceDate, Hours = 8m, UnitPrice = 12.5m, TotalAmount = 100m, ClaimType = ClaimType.Cancellation, Status = lineStatus,
        };
        db.TripClaims.Add(claim);
        db.ClaimLineItems.Add(line);
        db.SaveChanges();
        return line;
    }

    [Fact]
    public async Task D_CancellingAPublishedShift_StampsTheCancelTime_ButADraftCancelDoesNot()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        var published = SeedShift(db, participant.Id, ShiftStatus.Published);
        var draft = SeedShift(db, participant.Id, ShiftStatus.Draft);
        var before = DateTime.UtcNow;

        var cancelledPublished = await UpdateAsync(db, published, DtoFor(published, ShiftStatus.Cancelled));
        var cancelledDraft = await UpdateAsync(db, draft, DtoFor(draft, ShiftStatus.Cancelled));

        Assert.InRange(cancelledPublished.CancelledAt!.Value, before, DateTime.UtcNow);
        Assert.Equal(DateTimeKind.Utc, cancelledPublished.CancelledAt!.Value.Kind);
        Assert.Null(cancelledDraft.CancelledAt);   // a draft was never promised to anyone: no notice to measure
    }

    [Fact]
    public async Task ReopeningClearsTheCancelTime_AndEditingACancelledShiftKeepsIt()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, ShiftStatus.Cancelled);
        var stamp = new DateTime(2026, 9, 1, 3, 0, 0, DateTimeKind.Utc);
        shift.CancelledAt = stamp;
        db.SaveChanges();

        var edited = await UpdateAsync(db, shift, DtoFor(shift, ShiftStatus.Cancelled) with { Notes = "Family called." });
        Assert.Equal(stamp, edited.CancelledAt);

        var reopened = await UpdateAsync(db, shift, DtoFor(shift, ShiftStatus.Published));
        Assert.Null(reopened.CancelledAt);
    }

    [Fact]
    public async Task D_ACancelledShiftOnALiveClaim_CannotBeReopenedOrMoved_UntilTheClaimIsGone()
    {
        using var db = CreateDb();
        var participant = SeedParticipant(db);
        var shift = SeedShift(db, participant.Id, ShiftStatus.Cancelled);
        var line = ClaimOn(db, shift);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

        var reopen = await controller.UpdateShift(shift.Id, DtoFor(shift, ShiftStatus.Published), CancellationToken.None);
        var move = await controller.UpdateShift(shift.Id, DtoFor(shift, ShiftStatus.Cancelled) with { ServiceDate = shift.ServiceDate.AddDays(1) }, CancellationToken.None);

        foreach (var result in new[] { reopen, move })
        {
            var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
            var body = Assert.IsType<ApiResponse<ShiftDto>>(conflict.Value);
            Assert.Equal(ShiftErrorCodes.ShiftClaimLocked, body.Code);
            Assert.Contains("TC-CANC-0001", body.Errors!.Single());
        }
        var saved = await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shift.Id);
        Assert.Equal((ShiftStatus.Cancelled, shift.ServiceDate), (saved.Status, saved.ServiceDate));   // a refused write must not persist

        line.Status = ClaimLineItemStatus.Rejected;   // the NDIA rejected the CANC line: the claim no longer counts
        db.SaveChanges();
        var reopened = await UpdateAsync(db, shift, DtoFor(shift, ShiftStatus.Published));
        Assert.Equal(ShiftStatus.Published, reopened.Status);
    }
}
