using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Medications;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>Bounds for a time a phone recorded offline and sent late (pure).</summary>
public class ClientTimeRulesTests
{
    private static readonly DateTime Now = new(2026, 7, 14, 1, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime NotBefore = Now.AddHours(-3);

    [Theory]
    [InlineData(300, ClientTimeViolation.None)]
    [InlineData(301, ClientTimeViolation.InFuture)]
    [InlineData(-172800, ClientTimeViolation.None)]
    [InlineData(-172801, ClientTimeViolation.TooOld)]
    public void FutureAndAge_EdgesAreInclusive(int secondsFromNow, ClientTimeViolation expected) =>
        Assert.Equal(expected, ClientTimeRules.Check(Now.AddSeconds(secondsFromNow), Now, null));

    [Theory]
    [InlineData(0, ClientTimeViolation.None)]
    [InlineData(-1, ClientTimeViolation.BeforeStart)]
    public void NotBefore_IsInclusive(int secondsFromNotBefore, ClientTimeViolation expected) =>
        Assert.Equal(expected, ClientTimeRules.Check(NotBefore.AddSeconds(secondsFromNotBefore), Now, NotBefore));

    [Fact]
    public void AnUnspecifiedKind_IsReadAsUtc() =>
        Assert.Equal(DateTimeKind.Utc, ShiftBreakRules.ToUtc(DateTime.SpecifyKind(Now, DateTimeKind.Unspecified)).Kind);
}

/// <summary>
/// Late (offline-queued) writes: Start, Finish, breaks and notes accept the phone's own time and id, bounded and idempotent. Fixture: stamp 09:05
/// local (23:05Z on the 13th), rostered 23:00Z to 07:00Z, now 01:00Z on the 14th.
/// </summary>
public class PortalLateWritesTests
{
    private static readonly DateTime Now = DefaultNow.UtcDateTime;

    private static async Task<string?> Code(Task<ActionResult<ApiResponse<PortalShiftDetailDto>>> call, int status) => Failure(await call, status).Code;

    // ── Start ──

    [Fact]
    public async Task Start_ClientTime_SetsActualStart_AndFlag()
    {
        var f = Create(ShiftStatus.Published);
        var startedAt = Now.AddHours(-1);

        Detail(await f.Controller.StartShift(f.Shift.Id, new StartShiftDto { StartedAt = startedAt }, default));

        var c = await f.Db.ShiftCompletions.SingleAsync();
        Assert.Equal(startedAt, c.ActualStart);
        Assert.Equal(Now, c.StartedAt);
        Assert.True(c.SentFromOffline);
        Assert.Equal(60, c.VarianceMinutesStart);   // 00:00Z against the rostered 23:00Z
    }

    [Theory]
    [InlineData(-49 * 60, "SHIFT_CLIENT_TIME_TOO_OLD")]
    [InlineData(6, "SHIFT_CLIENT_TIME_IN_FUTURE")]
    public async Task Start_ClientTimeOutOfBounds_Is400WithItsCode(int minutesFromNow, string code)
    {
        var f = Create(ShiftStatus.Published);

        Assert.Equal(code, await Code(f.Controller.StartShift(f.Shift.Id, new StartShiftDto { StartedAt = Now.AddMinutes(minutesFromNow) }, default), 400));
        Assert.Empty(await f.Db.ShiftCompletions.ToListAsync());
    }

    [Fact]
    public async Task Start_EarlyGuard_JudgedAgainstStartedAt()
    {
        // Earliest start is 22:00Z (an hour before the rostered 23:00Z); the clock says 01:00Z, which alone would pass.
        var f = Create(ShiftStatus.Published);

        Assert.Equal(ShiftErrorCodes.ShiftStartTooEarly,
            await Code(f.Controller.StartShift(f.Shift.Id, new StartShiftDto { StartedAt = new DateTime(2026, 7, 13, 21, 30, 0, DateTimeKind.Utc) }, default), 409));
        Detail(await f.Controller.StartShift(f.Shift.Id, new StartShiftDto { StartedAt = new DateTime(2026, 7, 13, 22, 1, 0, DateTimeKind.Utc) }, default));
    }

    [Fact]
    public async Task Start_Replay_InProgress_Returns200_EvenWithOldClientTime()
    {
        var f = Create();

        Detail(await f.Controller.StartShift(f.Shift.Id, new StartShiftDto { StartedAt = Now.AddDays(-5) }, default));

        var c = await f.Db.ShiftCompletions.SingleAsync();
        Assert.Equal(ActualStartUtc, c.ActualStart);
        Assert.False(c.SentFromOffline);
    }

    [Fact]
    public async Task OldClient_NoFields_FlagFalse_TimesFromClock()
    {
        var f = Create(ShiftStatus.Published);
        Detail(await f.Controller.StartShift(f.Shift.Id, new StartShiftDto(), default));
        var started = await f.Db.ShiftCompletions.SingleAsync();
        Assert.Equal((Now, Now, false), (started.ActualStart, started.StartedAt, started.SentFromOffline));

        f.Advance(TimeSpan.FromMinutes(10));
        Detail(await f.Controller.StartBreak(f.Shift.Id, null, default));
        var brk = await f.Db.ShiftBreaks.SingleAsync();
        Assert.Equal(f.Clock.GetUtcNow().UtcDateTime, brk.StartedAt);
        f.Advance(TimeSpan.FromMinutes(5));
        Detail(await f.Controller.EndBreak(f.Shift.Id, brk.Id, null, default));
        Assert.Equal(f.Clock.GetUtcNow().UtcDateTime, (await f.Db.ShiftBreaks.SingleAsync()).EndedAt);

        Detail(await f.Controller.FinishShift(f.Shift.Id, new FinishShiftDto { NothingToNote = true }, default));
        var done = await f.Db.ShiftCompletions.SingleAsync();
        Assert.Equal((f.Clock.GetUtcNow().UtcDateTime, false), (done.ActualEnd!.Value, done.SentFromOffline));
    }

    // ── Finish ──

    private static FinishShiftDto Fin(DateTime? finishedAt, DateTime? askedEnd = null, string? reason = null) =>
        new() { NothingToNote = true, FinishedAt = finishedAt, ActualEnd = askedEnd, TimeAdjustmentReason = reason };

    [Fact]
    public async Task Finish_FinishedAt_IsActualEnd()
    {
        var f = Create();
        f.Advance(TimeSpan.FromHours(2));   // 03:00Z

        Detail(await f.Controller.FinishShift(f.Shift.Id, Fin(Now), default));

        var c = await f.Db.ShiftCompletions.SingleAsync();
        Assert.Equal(Now, c.ActualEnd);
        Assert.Null(c.OriginalActualEnd);
        Assert.Equal(Now.AddHours(2), c.SubmittedAt);
        Assert.True(c.SentFromOffline);
        Assert.Equal(-360, c.VarianceMinutesEnd);   // 01:00Z against the rostered 07:00Z
    }

    [Fact]
    public async Task Finish_FinishedAt_WithAdjustment()
    {
        var f = Create();
        f.Advance(TimeSpan.FromHours(2));
        Detail(await f.Controller.FinishShift(f.Shift.Id, Fin(Now, Now.AddMinutes(-10), "Left early."), default));
        var c = await f.Db.ShiftCompletions.SingleAsync();
        Assert.Equal((Now.AddMinutes(-10), (DateTime?)Now), (c.ActualEnd!.Value, c.OriginalActualEnd));

        var g = Create();
        g.Advance(TimeSpan.FromHours(2));
        Assert.Equal(ShiftErrorCodes.ShiftTimeAdjustmentTooLarge, await Code(g.Controller.FinishShift(g.Shift.Id, Fin(Now, Now.AddMinutes(-16), "x"), default), 400));
    }

    [Fact]
    public async Task Finish_FinishedAt_BeforeActualStart_400()
    {
        var f = Create();

        Assert.Equal(ShiftErrorCodes.ShiftClientTimeBeforeStart, await Code(f.Controller.FinishShift(f.Shift.Id, Fin(ActualStartUtc.AddMinutes(-1)), default), 400));
        Assert.Equal(ShiftStatus.InProgress, f.Shift.Status);
    }

    [Fact]
    public async Task Finish_FinishedAt_TooOld_400_BeforeBlockers()
    {
        var f = Create();
        f.Db.ShiftBreaks.Add(new ShiftBreak { Id = Guid.NewGuid(), TenantId = f.Shift.TenantId, ShiftCompletionId = f.Completion!.Id, StartedAt = ActualStartUtc.AddMinutes(5), CreatedByUserId = f.Worker.Id });
        f.Db.SaveChanges();

        Assert.Equal(ShiftErrorCodes.ShiftClientTimeTooOld, await Code(f.Controller.FinishShift(f.Shift.Id, Fin(Now.AddHours(-49)), default), 400));
    }

    [Fact]
    public async Task Finish_FinishedAt_AskedEndLaterThanNowPlus5_400_InFuture()
    {
        var f = Create();

        // Against the finish time (an hour ago) this end would be 65 minutes ahead and read as a plain adjustment; the future check is the real clock's.
        Assert.Equal(ShiftErrorCodes.ShiftActualEndInFuture, await Code(f.Controller.FinishShift(f.Shift.Id, Fin(Now.AddHours(-1), Now.AddMinutes(6), "x"), default), 400));
    }

    private static void AddDailyMed(ShiftPackageFixture f, string time)
    {
        f.Db.ParticipantMedications.Add(new ParticipantMedication
        {
            Id = Guid.NewGuid(), TenantId = f.Worker.TenantId, ParticipantId = f.Participant.Id, Name = "Levetiracetam", Strength = "500mg", DoseDescription = "1 tablet",
            Type = MedicationType.Regular, TimesOfDay = time, Frequency = MedicationFrequency.Daily, StartDate = new DateTime(2026, 1, 1),
            Status = MedicationStatus.Active, SupportLevel = MedicationSupportLevel.Administer,
        });
        f.Db.SaveChanges();
    }

    [Fact]
    public async Task Finish_DoseDueAfterFinishedAt_DoesNotBlock()
    {
        var f = Create();
        AddDailyMed(f, "10:30");   // 00:30Z; finished at 00:00Z (10:00 local), sent at 01:00Z

        Detail(await f.Controller.FinishShift(f.Shift.Id, Fin(Now.AddHours(-1)), default));
    }

    [Fact]
    public async Task Finish_DoseDueBeforeFinishedAt_Blocks422()
    {
        var f = Create();
        AddDailyMed(f, "10:30");

        var body = Failure(await f.Controller.FinishShift(f.Shift.Id, Fin(Now.AddMinutes(-15)), default), 422);   // finished 10:45 local

        Assert.Equal(ShiftErrorCodes.ShiftFinishBlocked, body.Code);
    }

    [Fact]
    public async Task Finish_Replay_PendingReview_200_Unchanged()
    {
        var f = Create();
        Detail(await f.Controller.FinishShift(f.Shift.Id, Fin(Now.AddMinutes(-30)), default));
        f.Advance(TimeSpan.FromHours(1));

        Detail(await f.Controller.FinishShift(f.Shift.Id, Fin(Now.AddMinutes(-5)), default));

        Assert.Equal(Now.AddMinutes(-30), (await f.Db.ShiftCompletions.SingleAsync()).ActualEnd);
    }

    [Fact]
    public async Task Finish_FinishedAt_BeforeALiveBreakEnd_400_BreakOutsideTimes()
    {
        var f = Create();
        f.Advance(TimeSpan.FromMinutes(1));
        Detail(await f.Controller.StartBreak(f.Shift.Id, null, default));
        f.Advance(TimeSpan.FromMinutes(5));
        Detail(await f.Controller.EndBreak(f.Shift.Id, (await f.Db.ShiftBreaks.SingleAsync()).Id, null, default));   // ended by the server clock, 01:06Z
        f.Advance(TimeSpan.FromSeconds(20));

        // A phone a couple of minutes behind: its finish time lands before the break the server stamped.
        Assert.Equal(ShiftErrorCodes.ShiftBreakOutsideTimes, await Code(f.Controller.FinishShift(f.Shift.Id, Fin(Now.AddMinutes(4)), default), 400));

        var c = await f.Db.ShiftCompletions.SingleAsync();
        Assert.Null(c.ActualEnd);
        Assert.Equal(ShiftStatus.InProgress, f.Shift.Status);
    }

    // ── Breaks ──

    [Fact]
    public async Task Break_ClientTimes_AreStored_AndFlag()
    {
        var f = Create();
        var id = Guid.NewGuid();

        Detail(await f.Controller.StartBreak(f.Shift.Id, new StartBreakDto { BreakId = id, StartedAt = Now.AddMinutes(-40) }, default));
        Detail(await f.Controller.EndBreak(f.Shift.Id, id, new EndBreakDto { EndedAt = Now.AddMinutes(-20) }, default));

        var b = await f.Db.ShiftBreaks.SingleAsync();
        Assert.Equal((id, Now.AddMinutes(-40), (DateTime?)Now.AddMinutes(-20)), (b.Id, b.StartedAt, b.EndedAt));
        Assert.True((await f.Db.ShiftCompletions.SingleAsync()).SentFromOffline);
    }

    [Fact]
    public async Task Break_SameId_Replay_200_NoSecondRow()
    {
        var f = Create();
        var id = Guid.NewGuid();
        Detail(await f.Controller.StartBreak(f.Shift.Id, new StartBreakDto { BreakId = id, StartedAt = Now.AddMinutes(-40) }, default));
        Detail(await f.Controller.EndBreak(f.Shift.Id, id, new EndBreakDto { EndedAt = Now.AddMinutes(-20) }, default));

        // The replay is judged before "a break is running" and before any time check: it is already done.
        Detail(await f.Controller.StartBreak(f.Shift.Id, new StartBreakDto { BreakId = id, StartedAt = Now.AddDays(-9) }, default));

        Assert.Single(await f.Db.ShiftBreaks.ToListAsync());
    }

    [Fact]
    public async Task Break_IdOfOtherCompletion_409()
    {
        var f = Create(tenantId: Guid.NewGuid());
        var otherTenantsBreak = Guid.NewGuid();
        f.Db.ShiftBreaks.Add(new ShiftBreak
        {
            Id = otherTenantsBreak, TenantId = Guid.NewGuid(), ShiftCompletionId = Guid.NewGuid(), StartedAt = Now.AddHours(-9), EndedAt = Now.AddHours(-8), CreatedByUserId = Guid.NewGuid(),
        });
        f.Db.SaveChanges();

        Assert.Equal(ShiftErrorCodes.ShiftBreakIdConflict,
            await Code(f.Controller.StartBreak(f.Shift.Id, new StartBreakDto { BreakId = otherTenantsBreak }, default), 409));
        Assert.Empty(f.Db.ShiftBreaks.Where(b => b.ShiftCompletionId == f.Completion!.Id));
    }

    [Fact]
    public async Task Break_ClientEnd_BeforeStart_400()
    {
        var f = Create();
        var id = Guid.NewGuid();
        Detail(await f.Controller.StartBreak(f.Shift.Id, new StartBreakDto { BreakId = id, StartedAt = Now.AddMinutes(-30) }, default));

        Assert.Equal(ShiftErrorCodes.ShiftBreakEndNotAfterStart, await Code(f.Controller.EndBreak(f.Shift.Id, id, new EndBreakDto { EndedAt = Now.AddMinutes(-31) }, default), 400));
        Assert.Equal(ShiftErrorCodes.ShiftClientTimeTooOld, await Code(f.Controller.EndBreak(f.Shift.Id, id, new EndBreakDto { EndedAt = Now.AddHours(-50) }, default), 400));
    }

    [Fact]
    public async Task Break_ClientEnd_TooOld_400()
    {
        var f = Create();
        var id = Guid.NewGuid();
        Detail(await f.Controller.StartBreak(f.Shift.Id, new StartBreakDto { BreakId = id, StartedAt = Now.AddMinutes(-30) }, default));

        Assert.Equal(ShiftErrorCodes.ShiftClientTimeTooOld, await Code(f.Controller.EndBreak(f.Shift.Id, id, new EndBreakDto { EndedAt = Now.AddHours(-49) }, default), 400));
        Assert.Null((await f.Db.ShiftBreaks.SingleAsync()).EndedAt);
    }

    [Fact]
    public async Task Break_EmptyGuidId_IsNotAClientId_TwoBreaksTwoRows()
    {
        var f = Create();
        Detail(await f.Controller.StartBreak(f.Shift.Id, new StartBreakDto { BreakId = Guid.Empty, StartedAt = Now.AddMinutes(-40) }, default));
        var first = await f.Db.ShiftBreaks.SingleAsync();
        Detail(await f.Controller.EndBreak(f.Shift.Id, first.Id, new EndBreakDto { EndedAt = Now.AddMinutes(-30) }, default));

        Detail(await f.Controller.StartBreak(f.Shift.Id, new StartBreakDto { BreakId = Guid.Empty, StartedAt = Now.AddMinutes(-20) }, default));

        var rows = await f.Db.ShiftBreaks.ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.DoesNotContain(rows, b => b.Id == Guid.Empty);
    }

    [Fact]
    public async Task Break_ClientStart_TooOld_400_AndFutureKeepsTheExistingCode()
    {
        var f = Create();

        Assert.Equal(ShiftErrorCodes.ShiftClientTimeTooOld, await Code(f.Controller.StartBreak(f.Shift.Id, new StartBreakDto { StartedAt = Now.AddHours(-49) }, default), 400));
        Assert.Equal(ShiftErrorCodes.ShiftBreakInFuture, await Code(f.Controller.StartBreak(f.Shift.Id, new StartBreakDto { StartedAt = Now.AddMinutes(6) }, default), 400));
        Assert.Empty(await f.Db.ShiftBreaks.ToListAsync());
    }

    // ── Notes ──

    private static async Task<(int Status, ShiftNoteDto? Note, string? Code)> Note(ShiftPackageFixture f, CreateShiftNoteDto dto, Guid? caller = null)
    {
        var result = await (caller is { } c ? f.ControllerFor(c) : f.Controller).CreateShiftNote(f.Shift.Id, dto, default);
        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        var body = Assert.IsType<ApiResponse<ShiftNoteDto>>(obj.Value);
        return (obj.StatusCode!.Value, body.Data, body.Code);
    }

    [Fact]
    public async Task Note_SameId_SameAuthor_ReturnsExisting_NoSecondTask()
    {
        var f = Create();
        var dto = new CreateShiftNoteDto { Id = Guid.NewGuid(), Body = "She had a fall near the bathroom." };

        var first = await Note(f, dto);
        var again = await Note(f, dto);

        Assert.Equal((200, 200, dto.Id), (first.Status, again.Status, again.Note!.Id));
        Assert.Single(await f.Db.ShiftNotes.ToListAsync());
        Assert.Single(await f.Db.BookingTasks.ToListAsync());
    }

    [Fact]
    public async Task Note_SameId_OtherAuthor_409()
    {
        var f = Create();
        var dto = new CreateShiftNoteDto { Id = Guid.NewGuid(), Body = "Quiet shift." };
        await Note(f, dto);
        f.Db.Users.Find(f.Worker.Id);   // the other author needs the shift too, or the request is a 404 before the id is looked at
        var other = f.AddWorker();
        f.Shift.UserId = other.Id;
        f.Db.SaveChanges();

        var refused = await Note(f, dto, other.Id);

        Assert.Equal((409, ShiftErrorCodes.ShiftNoteIdConflict), (refused.Status, refused.Code));
        Assert.Null(refused.Note);
    }

    [Fact]
    public async Task Note_SameId_SameAuthor_OtherShift_409()
    {
        var f = Create();
        var dto = new CreateShiftNoteDto { Id = Guid.NewGuid(), Body = "Quiet shift." };
        await Note(f, dto);
        var otherShift = new Shift
        {
            Id = Guid.NewGuid(), TenantId = f.Shift.TenantId, ParticipantId = f.Participant.Id, UserId = f.Worker.Id, ServiceDate = ServiceDate.AddDays(1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.InProgress,
        };
        f.Db.Shifts.Add(otherShift);
        f.Db.ShiftCompletions.Add(new ShiftCompletion
        {
            Id = Guid.NewGuid(), TenantId = f.Shift.TenantId, ShiftId = otherShift.Id, ActualStart = ActualStartUtc, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = f.Worker.Id, StartedAt = ActualStartUtc, IsActive = true,
        });
        f.Db.SaveChanges();

        var result = await f.Controller.CreateShiftNote(otherShift.Id, dto, default);

        var obj = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(409, obj.StatusCode);
        Assert.Equal(ShiftErrorCodes.ShiftNoteIdConflict, Assert.IsType<ApiResponse<ShiftNoteDto>>(obj.Value).Code);
    }

    [Fact]
    public async Task Note_EmptyGuidId_IsNotAClientId_TwoNotesTwoRows()
    {
        var f = Create();

        await Note(f, new CreateShiftNoteDto { Id = Guid.Empty, Body = "First." });
        var second = await Note(f, new CreateShiftNoteDto { Id = Guid.Empty, Body = "Second." });

        Assert.Equal(200, second.Status);
        var rows = await f.Db.ShiftNotes.ToListAsync();
        Assert.Equal(2, rows.Count);
        Assert.DoesNotContain(rows, n => n.Id == Guid.Empty);
    }

    [Theory]
    [InlineData(300, 200, null)]
    [InlineData(301, 400, "SHIFT_CLIENT_TIME_IN_FUTURE")]
    [InlineData(-172800, 200, null)]
    [InlineData(-172801, 400, "SHIFT_CLIENT_TIME_TOO_OLD")]
    public async Task Note_CreatedAt_Edges(int secondsFromNow, int status, string? code)
    {
        var f = Create();
        var at = Now.AddSeconds(secondsFromNow);

        var result = await Note(f, new CreateShiftNoteDto { Body = "Settled.", CreatedAt = at });

        Assert.Equal((status, code), (result.Status, result.Code));
        if (status != 200) return;
        var stored = await f.Db.ShiftNotes.SingleAsync();
        Assert.Equal((at, at), (stored.CreatedAt, stored.UpdatedAt));
    }

    [Fact]
    public async Task Note_NoCreatedAt_Unchanged()
    {
        var f = Create();
        var before = DateTime.UtcNow;

        await Note(f, new CreateShiftNoteDto { Body = "Settled." });

        var stored = await f.Db.ShiftNotes.SingleAsync();
        Assert.True(stored.CreatedAt >= before, "an absent CreatedAt keeps the entity default, not the injected clock");
        Assert.NotEqual(Now, stored.CreatedAt);
    }
}
