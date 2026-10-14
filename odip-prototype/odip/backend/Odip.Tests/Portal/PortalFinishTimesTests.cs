using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// The finish flow's times step on the server (owner decisions 3 and 4, 2026-10-14): either actual time may move up to 15 minutes from the
/// server's stamp, compared to the minute because the worker picks whole minutes, with a reason. The stamped originals, the reason, the
/// kilometres and the "anything to report?" answer are stored on the completion. Fixture: stamp 09:05 local (23:05Z), now 11:00 local
/// (01:00Z); the rostered window is 23:00Z to 07:00Z.
/// </summary>
public class PortalFinishTimesTests
{
    private static readonly DateTime Stamp = ActualStartUtc;
    private static readonly DateTime Now = DefaultNow.UtcDateTime;

    private static FinishShiftDto Dto(DateTime? start = null, DateTime? end = null, string? reason = null, double? km = null, bool? report = null) =>
        new() { NothingToNote = true, ActualStart = start, ActualEnd = end, TimeAdjustmentReason = reason, Kilometres = km, AnythingToReport = report };

    private static async Task<ShiftCompletion> Finish(ShiftPackageFixture f, FinishShiftDto dto)
    {
        Detail(await f.Controller.FinishShift(f.Shift.Id, dto, default));
        return await f.Db.ShiftCompletions.SingleAsync();
    }

    /// <summary>Asserts a 400 that changed nothing, and returns its code.</summary>
    private static async Task<string?> Refused(ShiftPackageFixture f, FinishShiftDto dto)
    {
        var body = Failure(await f.Controller.FinishShift(f.Shift.Id, dto, default), 400);
        var stored = await f.Db.ShiftCompletions.SingleAsync();
        Assert.Equal(ShiftStatus.InProgress, f.Shift.Status);
        Assert.Null(stored.ActualEnd);
        Assert.Null(stored.OriginalActualStart);
        Assert.Null(stored.TimeAdjustmentReason);
        return body.Code;
    }

    private static DateTime? At(DateTime from, int? minutes) => minutes is { } m ? from.AddMinutes(m) : null;


    [Fact]
    public async Task WithNoTimesGiven_TheFinishInstantIsTheEnd_AndNothingIsMarkedAdjusted()
    {
        var c = await Finish(Create(), Dto());

        Assert.Equal(Stamp, c.ActualStart);
        Assert.Equal(Now, c.ActualEnd);
        Assert.Null(c.OriginalActualStart);
        Assert.Null(c.OriginalActualEnd);
        Assert.Null(c.TimeAdjustmentReason);
        Assert.Null(c.Kilometres);
        Assert.Null(c.AnythingToReport);
    }

    [Fact]
    public async Task AnEarlierEnd_WithAReason_IsStored_WithTheFinishInstantAsTheOriginal_AndTheVarianceFollowsIt()
    {
        var c = await Finish(Create(), Dto(end: Now.AddMinutes(-10), reason: "  Left at ten to eleven.  "));

        Assert.Equal(Now.AddMinutes(-10), c.ActualEnd);
        Assert.Equal(Now, c.OriginalActualEnd);
        Assert.Equal("Left at ten to eleven.", c.TimeAdjustmentReason);
        Assert.Equal(-370, c.VarianceMinutesEnd);   // 00:50Z against the rostered 07:00Z
    }

    [Fact]
    public async Task AnEarlierStart_WithAReason_MovesTheStart_AndKeepsTheStamp()
    {
        var c = await Finish(Create(), Dto(start: Stamp.AddMinutes(-10), reason: "Arrived early for breakfast."));

        Assert.Equal(Stamp.AddMinutes(-10), c.ActualStart);
        Assert.Equal(Stamp, c.OriginalActualStart);
        Assert.Equal(Now, c.ActualEnd);
        Assert.Null(c.OriginalActualEnd);
        Assert.Equal(-5, c.VarianceMinutesStart);   // 22:55Z against the rostered 23:00Z
    }

    [Theory]
    [InlineData(-15, null)]
    [InlineData(15, null)]
    [InlineData(null, -15)]
    public async Task ExactlyFifteenMinutes_IsAccepted(int? startMinutes, int? endMinutes)
    {
        var c = await Finish(Create(), Dto(start: At(Stamp, startMinutes), end: At(Now, endMinutes), reason: "Times fixed."));

        Assert.True(c.OriginalActualStart is not null || c.OriginalActualEnd is not null);
    }

    [Theory]
    [InlineData(-16, null)]
    [InlineData(16, null)]
    [InlineData(null, -16)]
    public async Task MoreThanFifteenMinutes_Is400TooLarge_AndNothingChanges(int? startMinutes, int? endMinutes)
    {
        var f = Create();

        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentTooLarge,
            await Refused(f, Dto(start: At(Stamp, startMinutes), end: At(Now, endMinutes), reason: "Times fixed.")));
    }

    [Fact]
    public async Task TheBoundsCountFromTheStampTruncatedToTheMinute_AndTheStampsOwnMinuteIsNoChange()
    {
        // Review Focus 1: a 09:05:40 stamp offers 08:50 to 09:20 on the screen. A minute past either edge is refused, and 09:05 is no change.
        var f = Create();
        f.Completion!.ActualStart = Stamp.AddSeconds(40);
        f.Db.SaveChanges();

        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentTooLarge, await Refused(f, Dto(start: Stamp.AddMinutes(-16), reason: "x")));
        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentTooLarge, await Refused(f, Dto(start: Stamp.AddMinutes(16), reason: "x")));
        var same = await Finish(f, Dto(start: Stamp));
        Assert.Null(same.OriginalActualStart);
        Assert.Equal(Stamp.AddSeconds(40), same.ActualStart);
    }

    [Theory]
    [InlineData(-15)]
    [InlineData(15)]
    public async Task TheEarliestAndLatestOfferedStart_AreAccepted_ForASecondsStamp(int minutes)
    {
        var f = Create();
        f.Completion!.ActualStart = Stamp.AddSeconds(40);
        f.Db.SaveChanges();

        var c = await Finish(f, Dto(start: Stamp.AddMinutes(minutes), reason: "Fixed my start."));

        Assert.Equal(Stamp.AddMinutes(minutes), c.ActualStart);
        Assert.Equal(Stamp.AddSeconds(40), c.OriginalActualStart);
    }

    [Fact]
    public async Task MovedTimesSentWithSeconds_AreStoredToTheMinute_AndSecondsInsideTheStampsMinuteAreNoChange()
    {
        // Review CR-B Should 1: the app sends whole minutes, but the server rule must not depend on it.
        var c = await Finish(Create(), Dto(start: Stamp.AddSeconds(30), end: Now.AddMinutes(-10).AddSeconds(30), reason: "Left at ten to."));

        Assert.Equal(Stamp, c.ActualStart);   // 23:05:30 is the stamp's own minute: no move
        Assert.Null(c.OriginalActualStart);
        Assert.Equal(Now.AddMinutes(-10), c.ActualEnd);
        Assert.Equal(Now, c.OriginalActualEnd);
    }

    [Fact]
    public async Task TheEndBoundCountsFromTheMinuteOfTheFinish_AndThatMinuteIsNoChange()
    {
        var f = Create(now: DefaultNow.AddSeconds(30));

        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentTooLarge, await Refused(f, Dto(end: Now.AddMinutes(-16), reason: "x")));
        var c = await Finish(f, Dto(end: Now));
        Assert.Null(c.OriginalActualEnd);
        Assert.Equal(Now.AddSeconds(30), c.ActualEnd);
    }

    [Fact]
    public async Task AnEndMoreThanFiveMinutesAhead_Is400InFuture_ButAFastPhonesFewMinutesAreTheFinishInstant()
    {
        var f = Create();

        Assert.Equal(ShiftErrorCodes.ShiftActualEndInFuture, await Refused(f, Dto(end: Now.AddMinutes(6), reason: "x")));
        var c = await Finish(f, Dto(end: Now.AddMinutes(3)));   // inside ShiftBreakRules.ClockSkewAllowance: no change, no reason needed
        Assert.Equal(Now, c.ActualEnd);
        Assert.Null(c.OriginalActualEnd);
    }

    [Fact]
    public async Task AnEndChosenEarlier_ThatDriftsPastFifteenMinutesBeforeSubmit_IsRefused()
    {
        // Review Focus 2: the worker picked 10:55 at 11:00 and submits at 11:11. The server judges against ITS stamp at submit.
        var f = Create();
        f.Advance(TimeSpan.FromMinutes(11));

        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentTooLarge, await Refused(f, Dto(end: Now.AddMinutes(-5), reason: "Left at five to.")));
    }


    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    public async Task AnAdjustmentWithoutAReason_Is400(string? reason)
    {
        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentReasonRequired, await Refused(Create(), Dto(end: Now.AddMinutes(-5), reason: reason)));
    }

    [Fact]
    public async Task AReasonOver500Characters_Is400_WithItsOwnCode_And500IsKept()
    {
        var f = Create();

        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentReasonTooLong, await Refused(f, Dto(end: Now.AddMinutes(-5), reason: new string('x', 501))));
        Assert.Equal(500, (await Finish(f, Dto(end: Now.AddMinutes(-5), reason: new string('x', 500)))).TimeAdjustmentReason!.Length);
    }

    [Fact]
    public async Task AStartThatIsNotBeforeTheEnd_Is400()
    {
        var f = Create(now: new DateTimeOffset(Stamp.AddMinutes(10)));   // ten minutes into the shift

        Assert.Equal(ShiftErrorCodes.ShiftStartNotBeforeEnd, await Refused(f, Dto(start: Stamp.AddMinutes(12), reason: "x")));
        Assert.Equal(ShiftErrorCodes.ShiftStartNotBeforeEnd, await Refused(f, Dto(end: Stamp.AddMinutes(-1), reason: "x")));
    }

    [Fact]
    public async Task AdjustedTimesThatLeaveABreakOutside_Are400_SoTheCoordinatorNeverSeesABreakOutsideTheShift()
    {
        // Review Focus 3. NetWorked would clamp the break, but the review would still list a break that ends after the shift.
        var f = Create();
        f.Db.ShiftBreaks.Add(new ShiftBreak
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ShiftCompletionId = f.Completion!.Id, CreatedByUserId = f.Worker.Id,
            StartedAt = Now.AddMinutes(-20), EndedAt = Now.AddMinutes(-8),
        });
        f.Db.SaveChanges();

        Assert.Equal(ShiftErrorCodes.ShiftBreakOutsideTimes, await Refused(f, Dto(end: Now.AddMinutes(-10), reason: "Left early.")));
        Assert.Equal(Now.AddMinutes(-8), (await Finish(f, Dto(end: Now.AddMinutes(-8), reason: "Left when my break ended."))).ActualEnd);
    }


    [Theory]
    [InlineData("0", "0")]
    [InlineData("12.46", "12.5")]
    [InlineData("2000", "2000")]
    public async Task Kilometres_AreStoredToOneDecimalPlace(string given, string stored)
    {
        var c = await Finish(Create(), Dto(km: double.Parse(given, CultureInfo.InvariantCulture)));

        Assert.Equal(decimal.Parse(stored, CultureInfo.InvariantCulture), c.Kilometres);
    }

    [Theory]
    [InlineData("-0.1")]
    [InlineData("2000.1")]
    public async Task Kilometres_OutsideZeroTo2000_Are400(string given)
    {
        Assert.Equal(ShiftErrorCodes.ShiftKilometresOutOfRange, await Refused(Create(), Dto(km: double.Parse(given, CultureInfo.InvariantCulture))));
    }

    [Fact]
    public async Task KilometresTooBigForADecimal_StillGetTheCodedRefusal_NotAFrameworkError()
    {
        // Review deep N4: a body the decimal can't hold failed model binding with an uncoded 400 the portal can't land on step 1.
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Odip.Api.Serialization.ApiJsonOptions.Configure(options);
        var dto = JsonSerializer.Deserialize<FinishShiftDto>("{\"nothingToNote\":true,\"kilometres\":1e30}", options)!;

        Assert.Equal(ShiftErrorCodes.ShiftKilometresOutOfRange, await Refused(Create(), dto));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    [InlineData(null)]
    public async Task TheAnythingToReportAnswer_IsStoredAsGiven(bool? answer)
    {
        Assert.Equal(answer, (await Finish(Create(), Dto(report: answer))).AnythingToReport);
    }

    [Fact]
    public async Task AFinishWithMovedTimes_KeepsTheShiftsReturnCount()
    {
        // Review CR-B Should 3: a returned shift finished again still says how often it was returned.
        var f = Create();
        f.Shift.ReturnCount = 2;
        f.Db.SaveChanges();

        await Finish(f, Dto(end: Now.AddMinutes(-10), reason: "Left early.", km: 12.5));

        Assert.Equal(2, (await f.Db.Shifts.SingleAsync()).ReturnCount);
    }

    [Fact]
    public async Task AnotherWorkersFinish_WithMovedTimes_Is404_AndChangesNothing()
    {
        // Review CR-B Should 3: the new inputs never reach a shift the caller doesn't own.
        var f = Create();
        var other = f.AddWorker();

        var result = await f.ControllerFor(other.Id).FinishShift(f.Shift.Id, Dto(start: Stamp.AddMinutes(-10), end: Now.AddMinutes(-10), reason: "x", km: 5, report: true), default);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        var stored = await f.Db.ShiftCompletions.SingleAsync();
        Assert.Equal(ShiftStatus.InProgress, f.Shift.Status);
        Assert.Null(stored.ActualEnd);
        Assert.Null(stored.OriginalActualStart);
        Assert.Null(stored.Kilometres);
        Assert.Null(stored.AnythingToReport);
    }

    [Fact]
    public async Task TheManualStartPath_KeepsItsOwnStartRules_AndTakesOnlyTheEndRule()
    {
        // Published + ActualStart: there is no stamp to adjust, so the start is the manual start (no reason, no original). A moved end still needs one.
        var c = await Finish(Create(ShiftStatus.Published), Dto(start: Stamp));
        Assert.Equal(Stamp, c.ActualStart);
        Assert.Null(c.OriginalActualStart);
        Assert.True(c.StartWasManual);

        var g = Create(ShiftStatus.Published);
        var body = Failure(await g.Controller.FinishShift(g.Shift.Id, Dto(start: Stamp, end: Now.AddMinutes(-5)), default), 400);
        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentReasonRequired, body.Code);
        Assert.Empty(await g.Db.ShiftCompletions.ToListAsync());
    }
}

/// <summary>The My shifts list says "Returned" for a shift a coordinator sent back (SHAPE call 6): the summary carries the return count.</summary>
public class PortalMyShiftsListTests
{
    [Fact]
    public async Task MyShifts_CarryTheReturnCount()
    {
        var f = Create(ShiftStatus.Published);
        f.Shift.ReturnCount = 1;
        f.Db.SaveChanges();

        var ok = Assert.IsType<OkObjectResult>((await f.Controller.GetMyShifts(ServiceDate, ServiceDate, default)).Result);

        Assert.Equal(1, Assert.Single(Assert.IsType<ApiResponse<PortalShiftsResponseDto>>(ok.Value).Data!.Shifts).ReturnCount);
    }

    [Fact]
    public async Task MyShifts_CarryTheProvidersZone_SoTheListJudgesTodayAndEndedThere()
    {
        // Review CR-B Should 2: the list compared provider-local shift times with the device clock.
        var f = Create(ShiftStatus.Published);

        var ok = Assert.IsType<OkObjectResult>((await f.Controller.GetMyShifts(ServiceDate, ServiceDate, default)).Result);

        Assert.Equal("Australia/Sydney", Assert.IsType<ApiResponse<PortalShiftsResponseDto>>(ok.Value).Data!.TimeZoneId);   // the fixture provider is NSW
    }
}
