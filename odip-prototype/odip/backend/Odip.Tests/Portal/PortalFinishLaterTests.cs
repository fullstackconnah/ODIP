using Microsoft.EntityFrameworkCore;
using Odip.Api.Rostering;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>
/// Finish later (end the shift now, add the details after): the opt-in finish, the tap an online re-send carries, the legacy finish that must not
/// change, and the one list of missing details the readers show. Fixture: stamp 09:05 local (23:05Z), now 11:00 local (01:00Z).
/// </summary>
public class PortalFinishLaterTests
{
    private static readonly DateTime Now = DefaultNow.UtcDateTime;
    private static readonly string[] AllMissing = ["kilometres", "tripTo", "tripAfter", "notes", "handover", "report"];

    internal static FinishShiftDto Later(DateTime? tappedAt = null, DateTime? finishedAt = null) =>
        new() { DetailsLater = true, EndTappedAt = tappedAt, FinishedAt = finishedAt };

    private static Task<ShiftCompletion> StoredAsync(ShiftPackageFixture f) => f.Db.ShiftCompletions.SingleAsync();

    // ── the legacy finish does not change ──

    [Fact]
    public async Task Legacy_finish_without_the_flag_and_without_a_note_is_still_409_note_required()
    {
        var f = Create();

        var body = Failure(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto(), default), 409);

        Assert.Equal(ShiftErrorCodes.ShiftNoteRequired, body.Code);
    }

    [Fact]
    public async Task Legacy_finish_saves_DetailsRequired_false_and_lists_nothing_missing()
    {
        var f = Create();

        var detail = Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { NothingToNote = true }, default));

        Assert.False((await StoredAsync(f)).DetailsRequired);
        Assert.Empty(detail.MissingDetails);
        Assert.Empty(detail.Completion!.MissingDetails);
    }

    [Fact]
    public async Task Legacy_finish_with_an_end_20_minutes_early_is_still_refused_as_too_large()
    {
        var f = Create();

        var body = Failure(await f.Controller.FinishShift(f.Shift.Id,
            new FinishShiftDto { NothingToNote = true, ActualEnd = Now.AddMinutes(-20), TimeAdjustmentReason = "Left early." }, default), 400);

        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentTooLarge, body.Code);
    }

    [Fact]
    public async Task Legacy_finish_with_an_end_12_minutes_early_stores_it_with_the_tap_as_the_original()
    {
        var f = Create();

        Detail(await f.Controller.FinishShift(f.Shift.Id,
            new FinishShiftDto { NothingToNote = true, ActualEnd = Now.AddMinutes(-12), TimeAdjustmentReason = "Left early." }, default));

        var c = await StoredAsync(f);
        Assert.Equal(Now.AddMinutes(-12), c.ActualEnd);
        Assert.Equal(Now, c.OriginalActualEnd);
    }

    // ── the opt-in ──

    [Fact]
    public async Task DetailsLater_with_no_note_and_no_details_is_200_pending_review_and_lists_everything_missing()
    {
        var f = Create();

        var detail = Detail(await f.Controller.FinishShift(f.Shift.Id, Later(), default));

        Assert.Equal(ShiftStatus.PendingReview, detail.Status);
        Assert.True((await StoredAsync(f)).DetailsRequired);
        Assert.Equal(AllMissing, detail.MissingDetails);
        Assert.Equal(AllMissing, detail.Completion!.MissingDetails);
    }

    [Fact]
    public async Task A_replay_on_a_pending_review_shift_is_200_and_changes_nothing()
    {
        var f = Create();
        Detail(await f.Controller.FinishShift(f.Shift.Id, Later(), default));
        var before = await StoredAsync(f);
        var submittedAt = before.SubmittedAt;
        var end = before.ActualEnd;
        f.Advance(TimeSpan.FromMinutes(3));

        Detail(await f.Controller.FinishShift(f.Shift.Id, Later(), default));

        var after = await StoredAsync(f);
        Assert.Equal(submittedAt, after.SubmittedAt);
        Assert.Equal(end, after.ActualEnd);
    }

    // ── the tap an online re-send carries ──

    [Fact]
    public async Task EndTappedAt_becomes_the_end_and_is_not_marked_offline_but_FinishedAt_is()
    {
        var tap = Now.AddMinutes(-4);
        var f = Create();
        Detail(await f.Controller.FinishShift(f.Shift.Id, Later(tappedAt: tap), default));
        var online = await StoredAsync(f);
        Assert.Equal(tap, online.ActualEnd);
        Assert.False(online.SentFromOffline);

        var g = Create();
        Detail(await g.Controller.FinishShift(g.Shift.Id, Later(finishedAt: tap), default));
        Assert.True((await StoredAsync(g)).SentFromOffline);
    }

    [Fact]
    public async Task EndTappedAt_more_than_the_skew_in_the_future_is_refused()
    {
        var f = Create();

        var body = Failure(await f.Controller.FinishShift(f.Shift.Id, Later(tappedAt: Now.AddMinutes(6)), default), 400);

        Assert.Equal(ShiftErrorCodes.ShiftClientTimeInFuture, body.Code);
    }

    [Fact]
    public async Task EndTappedAt_within_the_skew_in_the_future_is_accepted()
    {
        var f = Create();

        Detail(await f.Controller.FinishShift(f.Shift.Id, Later(tappedAt: Now.AddMinutes(4)), default));
    }

    [Fact]
    public async Task EndTappedAt_before_the_start_is_refused()
    {
        var f = Create();
        f.Completion!.ActualStart = Now.AddMinutes(-10);   // started 10 minutes ago, so a tap 20 minutes ago is inside the age bound but before the start
        f.Db.SaveChanges();

        var body = Failure(await f.Controller.FinishShift(f.Shift.Id, Later(tappedAt: Now.AddMinutes(-20)), default), 400);

        Assert.Equal(ShiftErrorCodes.ShiftClientTimeBeforeStart, body.Code);
    }

    [Theory]
    [InlineData(31, true)]
    [InlineData(29, false)]
    public async Task EndTappedAt_may_be_at_most_30_minutes_old(int minutesOld, bool refused)
    {
        var f = Create();

        var result = await f.Controller.FinishShift(f.Shift.Id, Later(tappedAt: Now.AddMinutes(-minutesOld)), default);

        if (refused)
        {
            Assert.Equal(ShiftErrorCodes.ShiftClientTimeTooOld, Failure(result, 400).Code);
            Assert.Equal(ShiftStatus.InProgress, f.Shift.Status);
        }
        else Detail(result);
    }

    [Fact]
    public async Task A_back_dated_tap_cannot_skip_a_dose_that_is_due_before_the_real_now()
    {
        var f = Create();
        f.Db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Name = "Levetiracetam", Strength = "500mg",
            DoseDescription = "1 tablet", Type = MedicationType.Regular, TimesOfDay = "10:50", Frequency = MedicationFrequency.Daily,
            StartDate = new DateTime(2026, 1, 1), Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer,
        });
        f.Db.SaveChanges();   // now is 11:00 local: the 10:50 dose came due 10 minutes ago and has no outcome

        var result = await f.Controller.FinishShift(f.Shift.Id, Later(tappedAt: Now.AddMinutes(-20)), default);   // tap at 10:40, before the dose

        var body = Failure(result, 422);
        Assert.Equal(ShiftErrorCodes.ShiftFinishBlocked, body.Code);
        Assert.Equal(ShiftStatus.InProgress, f.Shift.Status);
    }

    // ── one list, every reader ──

    [Fact]
    public async Task Detail_and_completion_and_queue_return_the_same_list_and_travel_is_left_out_when_the_organisation_does_not_claim_it()
    {
        var f = Create();
        Detail(await f.Controller.FinishShift(f.Shift.Id, Later(), default));
        var c = await StoredAsync(f);

        Assert.Equal(AllMissing, Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).MissingDetails);
        Assert.Equal(AllMissing, (await ShiftCompletionMapper.ToDtoAsync(f.Db, c, 0, default)).MissingDetails);
        Assert.Equal(AllMissing, (await ShiftCompletionMapper.MissingDetailsAsync(f.Db, [c.Id], default))[c.Id]);

        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = c.TenantId, ClaimProviderTravel = false });
        f.Db.SaveChanges();
        Assert.Equal(["kilometres", "notes", "handover", "report"], Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default)).MissingDetails);
    }
}
