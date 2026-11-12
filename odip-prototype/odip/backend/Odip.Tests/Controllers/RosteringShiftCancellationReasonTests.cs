using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Api.Serialization;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;

namespace Odip.Tests.Controllers;

/// <summary>The reason on a cancelled shift: one rule in ApplyStatus, one test per row of the spec's input table (2026-11-12 shift cancellation reason design).</summary>
public class RosteringShiftCancellationReasonTests
{
    private static readonly DateOnly ServiceDate = new(2026, 9, 8);

    private static Shift Seed(OdipDbContext db, ShiftStatus status, ShiftCancellationReason? reason = null)
    {
        var participant = new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = "Ng", IsActive = true };
        db.Participants.Add(participant);
        var shift = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = participant.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne,
            NightType = SleepoverType.None, Status = status, UserId = Guid.NewGuid(), CancellationReason = reason,
        };
        db.Shifts.Add(shift);
        db.SaveChanges();
        return shift;
    }

    private static UpdateShiftDto DtoFor(Shift shift, ShiftStatus status, ShiftCancellationReason? reason = null) => new()
    {
        ParticipantId = shift.ParticipantId, StaffId = shift.UserId, ServiceDate = shift.ServiceDate,
        StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
        Ratio = shift.Ratio, NightType = shift.NightType, Status = status, CancellationReason = reason,
    };

    private static RosteringController Controller(OdipDbContext db) => new(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db));

    private static async Task<(ActionResult<ApiResponse<ShiftDto>> Result, Shift Saved)> PutAsync(OdipDbContext db, Shift shift, UpdateShiftDto dto)
    {
        var result = await Controller(db).UpdateShift(shift.Id, dto, CancellationToken.None);
        return (result, await db.Shifts.AsNoTracking().SingleAsync(s => s.Id == shift.Id));
    }

    [Theory]
    [InlineData(ShiftStatus.Published)]
    [InlineData(ShiftStatus.Draft)]
    public async Task Row1_NewCancel_WithReason_StoresIt_AndTheReadReturnsIt(ShiftStatus from)
    {
        using var db = TestDb.Create();
        var shift = Seed(db, from);
        var (result, saved) = await PutAsync(db, shift, DtoFor(shift, ShiftStatus.Cancelled, ShiftCancellationReason.StaffUnavailable));

        Assert.Equal(ShiftCancellationReason.StaffUnavailable, saved.CancellationReason);
        var body = Assert.IsType<ApiResponse<ShiftDto>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(ShiftCancellationReason.StaffUnavailable, body.Data!.CancellationReason);
        if (from == ShiftStatus.Published) Assert.NotNull(saved.CancelledAt);   // the notice clock is untouched
        else Assert.Null(saved.CancelledAt);   // row 6: a Draft cancel stores the reason, CancelledAt stays null
    }

    [Fact]
    public async Task Row1_AlreadyCancelled_NewReason_Replaces_AndKeepsCancelledAt()
    {
        using var db = TestDb.Create();
        var shift = Seed(db, ShiftStatus.Cancelled, ShiftCancellationReason.Weather);
        var at = new DateTime(2026, 9, 1, 3, 0, 0, DateTimeKind.Utc);
        shift.CancelledAt = at;
        db.SaveChanges();
        var (_, saved) = await PutAsync(db, shift, DtoFor(shift, ShiftStatus.Cancelled, ShiftCancellationReason.Other));

        Assert.Equal(ShiftCancellationReason.Other, saved.CancellationReason);
        Assert.Equal(at, saved.CancelledAt);
    }

    [Fact]
    public async Task Row2_NewCancel_ReasonOmitted_StoresNull_AndTheServerNeverRequiresOne()
    {
        using var db = TestDb.Create();
        var shift = Seed(db, ShiftStatus.Published);
        var (result, saved) = await PutAsync(db, shift, DtoFor(shift, ShiftStatus.Cancelled));

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(ShiftStatus.Cancelled, saved.Status);
        Assert.Null(saved.CancellationReason);
    }

    [Fact]
    public async Task Row3_AlreadyCancelled_ReasonOmitted_LeavesTheStoredReasonUnchanged()
    {
        using var db = TestDb.Create();
        var shift = Seed(db, ShiftStatus.Cancelled, ShiftCancellationReason.ParticipantUnwell);
        var (_, saved) = await PutAsync(db, shift, DtoFor(shift, ShiftStatus.Cancelled));

        Assert.Equal(ShiftCancellationReason.ParticipantUnwell, saved.CancellationReason);
    }

    [Theory]
    [InlineData(ShiftStatus.Published)]
    [InlineData(ShiftStatus.Draft)]
    public async Task Row4_StatusNotCancelled_ReasonGiven_IsIgnored_NoError(ShiftStatus status)
    {
        using var db = TestDb.Create();
        var shift = Seed(db, status);
        var (result, saved) = await PutAsync(db, shift, DtoFor(shift, status, ShiftCancellationReason.Weather));

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Null(saved.CancellationReason);
    }

    [Theory]
    [InlineData(ShiftStatus.Draft)]
    [InlineData(ShiftStatus.Published)]
    public async Task Row5_UnCancel_ClearsTheReason_AndCancelledAtAsBefore(ShiftStatus to)
    {
        using var db = TestDb.Create();
        var shift = Seed(db, ShiftStatus.Cancelled, ShiftCancellationReason.RosteredInError);
        shift.CancelledAt = DateTime.UtcNow;
        db.SaveChanges();
        var (_, saved) = await PutAsync(db, shift, DtoFor(shift, to, ShiftCancellationReason.RosteredInError));

        Assert.Null(saved.CancellationReason);
        Assert.Null(saved.CancelledAt);
    }

    [Fact]
    public async Task Row7_AValueOutsideTheEnum_Is400_AndNothingIsSaved()
    {
        using var db = TestDb.Create();
        var shift = Seed(db, ShiftStatus.Published);
        var (result, saved) = await PutAsync(db, shift, DtoFor(shift, ShiftStatus.Cancelled, (ShiftCancellationReason)99));

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Equal(ShiftErrorCodes.ShiftCancellationReasonInvalid, Assert.IsType<ApiResponse<ShiftDto>>(bad.Value).Code);
        Assert.Equal(ShiftStatus.Published, saved.Status);
        Assert.Null(saved.CancellationReason);
    }

    [Fact]
    public void Row7_AnUnknownName_FailsDeserialization_AndABareNumberReachesTheGuard()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        ApiJsonOptions.Configure(options);
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<UpdateShiftDto>("""{"cancellationReason":"NotAReason"}""", options));
        var bare = JsonSerializer.Deserialize<UpdateShiftDto>("""{"cancellationReason":99}""", options)!;
        Assert.False(Enum.IsDefined(bare.CancellationReason!.Value));   // the controller's explicit guard is what turns this into a 400
        Assert.Equal(ShiftCancellationReason.Weather, JsonSerializer.Deserialize<UpdateShiftDto>("""{"cancellationReason":"Weather"}""", options)!.CancellationReason);
    }

    [Fact]
    public async Task ReasonOnlyChange_OnACancelledShiftOnALiveClaim_IsAllowed()
    {
        using var db = TestDb.Create();
        var shift = Seed(db, ShiftStatus.Cancelled, ShiftCancellationReason.ParticipantFamily);
        var claim = new TripClaim { Id = Guid.NewGuid(), Kind = ClaimKind.Shift, ParticipantId = shift.ParticipantId, Status = TripClaimStatus.Draft, ClaimReference = "TC-CANC-0002", TotalAmount = 100m };
        db.TripClaims.Add(claim);
        db.ClaimLineItems.Add(new ClaimLineItem
        {
            Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, SupportItemCode = "04_Weekday_STD", DayType = ClaimDayType.Weekday, SupportsDeliveredFrom = shift.ServiceDate,
            SupportsDeliveredTo = shift.ServiceDate, Hours = 8m, UnitPrice = 12.5m, TotalAmount = 100m, ClaimType = ClaimType.Cancellation, Status = ClaimLineItemStatus.Draft,
        });
        db.SaveChanges();
        var (result, saved) = await PutAsync(db, shift, DtoFor(shift, ShiftStatus.Cancelled, ShiftCancellationReason.Other));

        // The claim guard only refuses a reopen, a move or a participant change; the reason is not billed, so changing it is allowed.
        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal(ShiftCancellationReason.Other, saved.CancellationReason);
    }
}
