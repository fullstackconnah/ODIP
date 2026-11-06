using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// PUT portal/shifts/{id}/finish-details: the worker adds what finish-later left out. Only the assigned worker, only while the shift awaits review
/// and was finished "details later"; the end can only move earlier than the tap, with a reason. Fixture: the tap is 11:00 local (01:00Z).
/// </summary>
public class PortalFinishDetailsTests
{
    private static readonly DateTime Now = DefaultNow.UtcDateTime;

    private static async Task<ShiftPackageFixture> FinishedLaterAsync()
    {
        var f = Create();
        Detail(await f.Controller.FinishShift(f.Shift.Id, PortalFinishLaterTests.Later(), default));
        return f;
    }

    private static FinishDetailsDto Everything() => new()
    {
        Kilometres = 12.5, PreShiftTravelMinutes = 10, PreShiftTravelKilometres = 4, PostShiftTravelMinutes = 15, PostShiftTravelKilometres = 6,
        HandoverText = "  Amy had a quiet afternoon.  ", NothingToNote = true, AnythingToReport = false,
    };

    private static Task<ShiftCompletion> StoredAsync(ShiftPackageFixture f) => f.Db.ShiftCompletions.SingleAsync();

    [Fact]
    public async Task Filling_everything_in_empties_the_missing_list_and_stores_the_answers()
    {
        var f = await FinishedLaterAsync();

        var detail = Detail(await f.Controller.FinishDetails(f.Shift.Id, Everything(), default));

        Assert.Empty(detail.MissingDetails);
        var c = await StoredAsync(f);
        Assert.Equal(12.5m, c.Kilometres);
        Assert.Equal("Amy had a quiet afternoon.", c.HandoverText);
        Assert.True(c.NothingToNoteConfirmed);
        Assert.False(c.AnythingToReport);
        Assert.Equal(ShiftStatus.PendingReview, detail.Status);
    }

    [Fact]
    public async Task A_partial_save_keeps_the_rest_missing_and_no_trip_clears_that_leg()
    {
        var f = await FinishedLaterAsync();

        var detail = Detail(await f.Controller.FinishDetails(f.Shift.Id,
            new FinishDetailsDto { Kilometres = 3, PreTravelNone = true, PreShiftTravelMinutes = 10, PreShiftTravelKilometres = 4 }, default));

        Assert.Equal(["tripAfter", "notes", "handover", "report"], detail.MissingDetails);
        var c = await StoredAsync(f);
        Assert.True(c.PreTravelNone);
        Assert.Null(c.PreShiftTravelMinutes);
        Assert.Null(c.PreShiftTravelKilometres);
    }

    [Fact]
    public async Task A_shift_not_finished_details_later_is_409_and_nothing_changes()
    {
        var f = Create();
        Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { NothingToNote = true }, default));

        var body = Failure(await f.Controller.FinishDetails(f.Shift.Id, Everything(), default), 409);

        Assert.Equal(ShiftErrorCodes.ShiftNotPendingReview, body.Code);
        Assert.Null((await StoredAsync(f)).Kilometres);
    }

    [Fact]
    public async Task After_approval_the_put_is_409_and_nothing_changes()
    {
        var f = await FinishedLaterAsync();
        f.Shift.Status = ShiftStatus.Completed;
        f.Db.SaveChanges();

        var body = Failure(await f.Controller.FinishDetails(f.Shift.Id, Everything(), default), 409);

        Assert.Equal(ShiftErrorCodes.ShiftNotPendingReview, body.Code);
        Assert.Null((await StoredAsync(f)).Kilometres);
    }

    [Fact]
    public async Task Another_worker_gets_404_and_nothing_changes()
    {
        var f = await FinishedLaterAsync();
        var other = f.AddWorker();

        var result = await f.ControllerFor(other.Id).FinishDetails(f.Shift.Id, Everything(), default);

        Assert.Equal(404, Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode);
        Assert.Null((await StoredAsync(f)).Kilometres);
    }

    [Fact]
    public async Task An_end_later_than_the_tap_is_refused_with_end_after_tap()
    {
        var f = await FinishedLaterAsync();

        var body = Failure(await f.Controller.FinishDetails(f.Shift.Id,
            new FinishDetailsDto { ActualEnd = Now.AddMinutes(20), TimeAdjustmentReason = "Stayed on." }, default), 400);

        Assert.Equal(ShiftErrorCodes.ShiftActualEndAfterTap, body.Code);
        Assert.Equal(Now, (await StoredAsync(f)).ActualEnd);
    }

    [Fact]
    public async Task An_earlier_end_needs_a_reason_and_keeps_the_tap_as_the_original()
    {
        var f = await FinishedLaterAsync();

        var noReason = Failure(await f.Controller.FinishDetails(f.Shift.Id, new FinishDetailsDto { ActualEnd = Now.AddMinutes(-40) }, default), 400);
        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentReasonRequired, noReason.Code);

        Detail(await f.Controller.FinishDetails(f.Shift.Id,
            new FinishDetailsDto { ActualEnd = Now.AddMinutes(-40), TimeAdjustmentReason = "Left at twenty past ten." }, default));

        var c = await StoredAsync(f);
        Assert.Equal(Now.AddMinutes(-40), c.ActualEnd);
        Assert.Equal(Now, c.OriginalActualEnd);
        Assert.Equal("Left at twenty past ten.", c.TimeAdjustmentReason);
    }

    [Fact]
    public async Task Another_tenants_shift_id_gets_404_and_nothing_changes()
    {
        var f = Create(tenantId: Guid.NewGuid());
        var foreignTenant = Guid.NewGuid();
        var participant = new Participant { Id = Guid.NewGuid(), TenantId = foreignTenant, FirstName = "Zed", LastName = "Roe", IsActive = true };
        var shift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = foreignTenant, ParticipantId = participant.Id, UserId = f.Worker.Id, ServiceDate = ServiceDate,
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.PendingReview,
        };
        f.Db.Participants.Add(participant);
        f.Db.Shifts.Add(shift);
        f.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = foreignTenant, ShiftId = shift.Id, ActualStart = ActualStartUtc, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = f.Worker.Id, StartedAt = ActualStartUtc, IsActive = true, DetailsRequired = true,
        });
        f.Db.SaveChanges();

        var result = await f.Controller.FinishDetails(shift.Id, Everything(), default);

        Assert.Equal(404, Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode);
        Assert.Null(f.Db.ShiftCompletions.IgnoreQueryFilters().Single(c => c.ShiftId == shift.Id).Kilometres);
    }

    [Fact]
    public async Task A_2001_character_handover_fails_model_validation_so_the_action_never_runs_and_nothing_is_stored()
    {
        var f = await FinishedLaterAsync();   // [ApiController] answers 400 on this result before the action; a direct call skips it, so the rule is pinned on the DTO
        var results = new List<ValidationResult>();
        var dto = new FinishDetailsDto { Kilometres = 3, HandoverText = new string('a', 2001) };

        Assert.False(Validator.TryValidateObject(dto, new ValidationContext(dto), results, validateAllProperties: true));
        Assert.Contains(results, r => r.MemberNames.Contains(nameof(FinishDetailsDto.HandoverText)));
        Assert.Null((await StoredAsync(f)).Kilometres);
        Assert.Null((await StoredAsync(f)).HandoverText);
    }

    [Fact]
    public async Task A_details_later_shift_before_the_window_is_listed_with_its_missing_details_until_filled_and_a_legacy_one_never_is()
    {
        var f = await FinishedLaterAsync();
        var legacy = new Shift
        {
            Id = Guid.NewGuid(), TenantId = f.Shift.TenantId, ParticipantId = f.Participant.Id, UserId = f.Worker.Id, ServiceDate = ServiceDate.AddDays(-2),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Ratio = SupportRatio.OneToOne, NightType = SleepoverType.None, Status = ShiftStatus.PendingReview,
        };
        f.Db.Shifts.Add(legacy);
        f.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = legacy.TenantId, ShiftId = legacy.Id, ActualStart = ActualStartUtc, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = f.Worker.Id, StartedAt = ActualStartUtc, IsActive = true, DetailsRequired = false,
        });
        f.Db.SaveChanges();
        var from = ServiceDate.AddDays(7);   // the window starts a week after both shifts

        async Task<IReadOnlyList<PortalShiftSummaryDto>> ListedAsync() =>
            Assert.IsType<ApiResponse<PortalShiftsResponseDto>>(Assert.IsType<OkObjectResult>((await f.Controller.GetMyShifts(from, from.AddDays(13), default)).Result).Value).Data!.Shifts;

        var before = await ListedAsync();
        var listed = Assert.Single(before);
        Assert.Equal(f.Shift.Id, listed.Id);
        Assert.NotEmpty(listed.MissingDetails);

        Detail(await f.Controller.FinishDetails(f.Shift.Id, Everything(), default));

        Assert.Empty(await ListedAsync());
    }
}
