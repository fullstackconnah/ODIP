using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Xunit;
using static Odip.Tests.Portal.ShiftPackageFixture;

namespace Odip.Tests.Portal;

/// <summary>Pure break rules and worked-time arithmetic.</summary>
public class ShiftBreakRulesTests
{
    private static readonly DateTime Start = new(2026, 7, 13, 23, 5, 0, DateTimeKind.Utc);   // 09:05 local
    private static readonly DateTime Now = new(2026, 7, 14, 1, 0, 0, DateTimeKind.Utc);      // 11:00 local

    private static ShiftBreak B(int startMinutesAfterStart, int? endMinutesAfterStart) => new()
    {
        Id = Guid.NewGuid(), StartedAt = Start.AddMinutes(startMinutesAfterStart),
        EndedAt = endMinutesAfterStart is { } e ? Start.AddMinutes(e) : null,
    };

    [Fact]
    public void ABreakInsideTheWindow_IsValid() =>
        Assert.Equal(ShiftBreakViolation.None, ShiftBreakRules.Validate(Start.AddMinutes(30), Start.AddMinutes(60), Start, Now, []));

    [Fact]
    public void StartingBeforeTheShiftStarted_IsRejected() =>
        Assert.Equal(ShiftBreakViolation.BeforeShiftStart, ShiftBreakRules.Validate(Start.AddMinutes(-1), Start.AddMinutes(10), Start, Now, []));

    [Theory]
    [InlineData(5, false)]   // inside the device-clock-skew allowance
    [InlineData(6, true)]    // beyond it
    public void ABreakInTheFuture_IsRejectedBeyondTheSkewAllowance(int minutesAheadOfNow, bool rejected)
    {
        var result = ShiftBreakRules.Validate(Now.AddMinutes(-10), Now.AddMinutes(minutesAheadOfNow), Start, Now, []);

        Assert.Equal(rejected ? ShiftBreakViolation.InFuture : ShiftBreakViolation.None, result);
    }

    [Fact]
    public void ABreakMustEndAfterItStarts()
    {
        Assert.Equal(ShiftBreakViolation.EndNotAfterStart, ShiftBreakRules.Validate(Start.AddMinutes(30), Start.AddMinutes(30), Start, Now, []));
        Assert.Equal(ShiftBreakViolation.EndNotAfterStart, ShiftBreakRules.Validate(Start.AddMinutes(30), Start.AddMinutes(20), Start, Now, []));
    }

    [Fact]
    public void OverlappingAnotherBreak_IsRejected_ButTouchingIsFine()
    {
        var existing = new[] { B(30, 60) };

        Assert.Equal(ShiftBreakViolation.Overlap, ShiftBreakRules.Validate(Start.AddMinutes(45), Start.AddMinutes(75), Start, Now, existing));
        Assert.Equal(ShiftBreakViolation.Overlap, ShiftBreakRules.Validate(Start.AddMinutes(10), Start.AddMinutes(40), Start, Now, existing));
        Assert.Equal(ShiftBreakViolation.Overlap, ShiftBreakRules.Validate(Start.AddMinutes(35), Start.AddMinutes(45), Start, Now, existing));   // inside
        Assert.Equal(ShiftBreakViolation.None, ShiftBreakRules.Validate(Start.AddMinutes(60), Start.AddMinutes(70), Start, Now, existing));      // starts as it ends
        Assert.Equal(ShiftBreakViolation.None, ShiftBreakRules.Validate(Start.AddMinutes(10), Start.AddMinutes(30), Start, Now, existing));      // ends as it starts
    }

    [Fact]
    public void ARunningBreakIsOpenEnded_SoAnythingStartingAfterItOverlaps()
    {
        var running = new[] { B(30, null) };

        Assert.Equal(ShiftBreakViolation.Overlap, ShiftBreakRules.Validate(Start.AddMinutes(45), Start.AddMinutes(50), Start, Now, running));
        Assert.Equal(ShiftBreakViolation.None, ShiftBreakRules.Validate(Start.AddMinutes(10), Start.AddMinutes(30), Start, Now, running));
    }

    // ── net worked minutes ──

    [Fact]
    public void NetWorked_IsTheWorkedSpanMinusBreaks()
    {
        var (gross, breaks, net) = ShiftBreakRules.NetWorked(Start, Start.AddHours(8), Now, [B(120, 150), B(240, 255)]);

        Assert.Equal(480, gross);
        Assert.Equal(45, breaks);
        Assert.Equal(435, net);
    }

    [Fact]
    public void NetWorked_InProgress_CountsUpToNow_AndARunningBreakCountsToo()
    {
        // 09:05 -> 11:00 is 115 minutes; a break running since 10:30 has taken 30 of them.
        var (gross, breaks, net) = ShiftBreakRules.NetWorked(Start, null, Now, [B(85, null)]);

        Assert.Equal(115, gross);
        Assert.Equal(30, breaks);
        Assert.Equal(85, net);
    }

    [Fact]
    public void NetWorked_ClampsABreakToTheWorkedSpan_AndNeverGoesNegative()
    {
        // A break recorded as starting before the shift, and one running past its end, contribute only their overlap.
        var (gross, breaks, net) = ShiftBreakRules.NetWorked(Start, Start.AddMinutes(60), Now,
            [new ShiftBreak { StartedAt = Start.AddMinutes(-30), EndedAt = Start.AddMinutes(10) }, B(50, 500)]);

        Assert.Equal(60, gross);
        Assert.Equal(20, breaks);
        Assert.Equal(40, net);

        var (_, _, allBreak) = ShiftBreakRules.NetWorked(Start, Start.AddMinutes(10), Now, [B(0, 10)]);
        Assert.Equal(0, allBreak);
    }

    [Fact]
    public void NetWorked_RoundsHalfMinutesAwayFromZero_AndAddsUp()
    {
        var (gross, breaks, net) = ShiftBreakRules.NetWorked(Start, Start.AddSeconds(90), Now,
            [new ShiftBreak { StartedAt = Start, EndedAt = Start.AddSeconds(30) }]);

        Assert.Equal(2, gross);    // 1.5 -> 2
        Assert.Equal(1, breaks);   // 0.5 -> 1
        Assert.Equal(gross - breaks, net);
    }

    [Fact]
    public void ToUtc_TreatsUnsuffixedAsUtc_AndConvertsLocal()
    {
        Assert.Equal(new DateTime(2026, 7, 14, 1, 0, 0, DateTimeKind.Utc),
            ShiftBreakRules.ToUtc(new DateTime(2026, 7, 14, 1, 0, 0, DateTimeKind.Unspecified)));
        Assert.Equal(DateTimeKind.Utc, ShiftBreakRules.ToUtc(new DateTime(2026, 7, 14, 1, 0, 0, DateTimeKind.Unspecified)).Kind);
    }
}

/// <summary>The four break endpoints on the worker's OWN InProgress shift.</summary>
public class PortalBreaksTests
{
    private static readonly DateTime NowUtc = ShiftPackageFixture.DefaultNow.UtcDateTime; // 11:00 local

    private static async Task<(ShiftPackageFixture F, Guid BreakId)> WithEndedBreakAsync(int startMinutesAgo = 60, int lengthMinutes = 30)
    {
        var f = Create();
        var breakStart = NowUtc.AddMinutes(-startMinutesAgo);
        f.Db.ShiftBreaks.Add(new ShiftBreak
        {
            Id = Guid.NewGuid(), ShiftCompletionId = f.Completion!.Id, StartedAt = breakStart, EndedAt = breakStart.AddMinutes(lengthMinutes),
            CreatedByUserId = f.Worker.Id,
        });
        await f.Db.SaveChangesAsync();
        return (f, (await f.Db.ShiftBreaks.SingleAsync()).Id);
    }

    // ── start ──

    [Fact]
    public async Task Start_CreatesARunningBreak_StampedWithTheServerClock_AndReturnsTheRefreshedShift()
    {
        var f = Create();

        var detail = Detail(await f.Controller.StartBreak(f.Shift.Id, default));

        var b = Assert.Single(detail.Breaks);
        Assert.True(b.IsRunning);
        Assert.Equal(NowUtc, b.StartedAt);
        Assert.Null(b.EndedAt);
        Assert.Equal(f.Worker.Id, b.CreatedByUserId);
        Assert.Equal(b.Id, Assert.Single(detail.Completion!.Breaks).Id);
    }

    [Fact]
    public async Task Start_WhileABreakIsAlreadyRunning_Is409_AndNothingIsAdded()
    {
        var f = Create();
        Detail(await f.Controller.StartBreak(f.Shift.Id, default));
        f.Advance(TimeSpan.FromMinutes(5));

        var body = Failure(await f.Controller.StartBreak(f.Shift.Id, default), 409);

        Assert.Equal(ShiftErrorCodes.ShiftBreakAlreadyRunning, body.Code);
        Assert.Single(await f.Db.ShiftBreaks.ToListAsync());
    }

    [Fact]
    public async Task Start_ThenAnotherAfterTheFirstEnds_IsAllowed()
    {
        var f = Create();
        var first = Detail(await f.Controller.StartBreak(f.Shift.Id, default)).Breaks.Single();
        f.Advance(TimeSpan.FromMinutes(10));
        Detail(await f.Controller.EndBreak(f.Shift.Id, first.Id, default));
        f.Advance(TimeSpan.FromMinutes(20));

        var detail = Detail(await f.Controller.StartBreak(f.Shift.Id, default));

        Assert.Equal(2, detail.Breaks.Count);
        Assert.Single(detail.Breaks, b => b.IsRunning);
    }

    // ── end ──

    [Fact]
    public async Task End_StampsTheEnd_AndNetWorkedMinutesFollow()
    {
        var f = Create();
        var started = Detail(await f.Controller.StartBreak(f.Shift.Id, default)).Breaks.Single();
        f.Advance(TimeSpan.FromMinutes(30));

        var detail = Detail(await f.Controller.EndBreak(f.Shift.Id, started.Id, default));

        var b = Assert.Single(detail.Breaks);
        Assert.False(b.IsRunning);
        Assert.Equal(NowUtc.AddMinutes(30), b.EndedAt);
        Assert.Equal(30, b.Minutes);
        // 09:05 -> 11:30 is 145 minutes worked, less the 30-minute break.
        Assert.Equal(30, detail.Completion!.BreakMinutes);
        Assert.Equal(115, detail.Completion.NetWorkedMinutes);
    }

    [Fact]
    public async Task End_IsIdempotent_ADoubleTapIsASuccess_AndDoesNotMoveTheEnd()
    {
        var f = Create();
        var started = Detail(await f.Controller.StartBreak(f.Shift.Id, default)).Breaks.Single();
        f.Advance(TimeSpan.FromMinutes(30));
        var first = Detail(await f.Controller.EndBreak(f.Shift.Id, started.Id, default));
        f.Advance(TimeSpan.FromMinutes(5));

        var second = Detail(await f.Controller.EndBreak(f.Shift.Id, started.Id, default));

        Assert.Equal(first.Breaks.Single().EndedAt, second.Breaks.Single().EndedAt);
    }

    [Fact]
    public async Task ARunningBreak_CountsTowardsBreakMinutes_UpToNow()
    {
        var f = Create();
        Detail(await f.Controller.StartBreak(f.Shift.Id, default));
        f.Advance(TimeSpan.FromMinutes(12));

        var detail = Detail(await f.Controller.GetShiftDetail(f.Shift.Id, default));

        Assert.Equal(12, detail.Breaks.Single().Minutes);
        Assert.Equal(12, detail.Completion!.BreakMinutes);
    }

    // ── edit ──

    [Fact]
    public async Task Edit_CorrectsTheTimes_StampsEditedAt_AndNetMinutesFollow()
    {
        var (f, id) = await WithEndedBreakAsync();
        var newStart = NowUtc.AddMinutes(-50);
        var newEnd = NowUtc.AddMinutes(-20);

        var detail = Detail(await f.Controller.EditBreak(f.Shift.Id, id, new EditShiftBreakDto { StartedAt = newStart, EndedAt = newEnd }, default));

        var b = Assert.Single(detail.Breaks);
        Assert.Equal(newStart, b.StartedAt);
        Assert.Equal(newEnd, b.EndedAt);
        Assert.Equal(NowUtc, b.EditedAt);
        Assert.Equal(30, detail.Completion!.BreakMinutes);
    }

    [Fact]
    public async Task Edit_ARunningBreakWithNoEnd_StaysRunning()
    {
        var f = Create();
        var started = Detail(await f.Controller.StartBreak(f.Shift.Id, default)).Breaks.Single();

        var detail = Detail(await f.Controller.EditBreak(f.Shift.Id, started.Id,
            new EditShiftBreakDto { StartedAt = NowUtc.AddMinutes(-15), EndedAt = null }, default));

        Assert.True(detail.Breaks.Single().IsRunning);
        Assert.Equal(NowUtc.AddMinutes(-15), detail.Breaks.Single().StartedAt);
    }

    [Theory]
    [InlineData("before-start", ShiftErrorCodes.ShiftBreakBeforeShiftStart)]
    [InlineData("future", ShiftErrorCodes.ShiftBreakInFuture)]
    [InlineData("end-not-after-start", ShiftErrorCodes.ShiftBreakEndNotAfterStart)]
    [InlineData("overlap", ShiftErrorCodes.ShiftBreakOverlap)]
    [InlineData("no-end", ShiftErrorCodes.ShiftBreakEndRequired)]
    public async Task Edit_BreakingARule_Is400WithACode_AndTheBreakIsUnchanged(string scenario, string expectedCode)
    {
        var (f, id) = await WithEndedBreakAsync();
        // A second, earlier break to overlap against: 10:00-10:10 local.
        f.Db.ShiftBreaks.Add(new ShiftBreak
        {
            Id = Guid.NewGuid(), ShiftCompletionId = f.Completion!.Id, StartedAt = NowUtc.AddMinutes(-120), EndedAt = NowUtc.AddMinutes(-110),
            CreatedByUserId = f.Worker.Id,
        });
        await f.Db.SaveChangesAsync();
        var original = await f.Db.ShiftBreaks.AsNoTracking().SingleAsync(b => b.Id == id);

        var dto = scenario switch
        {
            "before-start" => new EditShiftBreakDto { StartedAt = ActualStartUtc.AddMinutes(-5), EndedAt = ActualStartUtc.AddMinutes(1) },
            "future" => new EditShiftBreakDto { StartedAt = NowUtc.AddMinutes(-5), EndedAt = NowUtc.AddMinutes(30) },
            "end-not-after-start" => new EditShiftBreakDto { StartedAt = NowUtc.AddMinutes(-40), EndedAt = NowUtc.AddMinutes(-40) },
            "overlap" => new EditShiftBreakDto { StartedAt = NowUtc.AddMinutes(-115), EndedAt = NowUtc.AddMinutes(-90) },
            _ => new EditShiftBreakDto { StartedAt = original.StartedAt, EndedAt = null },
        };

        var body = Failure(await f.Controller.EditBreak(f.Shift.Id, id, dto, default), 400);

        Assert.Equal(expectedCode, body.Code);
        var after = await f.Db.ShiftBreaks.AsNoTracking().SingleAsync(b => b.Id == id);
        Assert.Equal(original.StartedAt, after.StartedAt);
        Assert.Equal(original.EndedAt, after.EndedAt);
        Assert.Null(after.EditedAt);
    }

    [Fact]
    public async Task Edit_AnUnsuffixedTimeIsTreatedAsUtc()
    {
        var (f, id) = await WithEndedBreakAsync();
        var unsuffixed = DateTime.SpecifyKind(NowUtc.AddMinutes(-50), DateTimeKind.Unspecified);

        var detail = Detail(await f.Controller.EditBreak(f.Shift.Id, id,
            new EditShiftBreakDto { StartedAt = unsuffixed, EndedAt = unsuffixed.AddMinutes(20) }, default));

        Assert.Equal(NowUtc.AddMinutes(-50), detail.Breaks.Single().StartedAt);
    }

    // ── delete ──

    [Fact]
    public async Task Delete_RemovesTheBreak_AndNetMinutesRecover()
    {
        var (f, id) = await WithEndedBreakAsync();

        var detail = Detail(await f.Controller.DeleteBreak(f.Shift.Id, id, default));

        Assert.Empty(detail.Breaks);
        Assert.Equal(0, detail.Completion!.BreakMinutes);
        Assert.Empty(await f.Db.ShiftBreaks.ToListAsync());
    }

    // ── only while InProgress ──

    [Theory]
    [InlineData(ShiftStatus.Published, 409, ShiftErrorCodes.ShiftNotInProgress)]
    [InlineData(ShiftStatus.PendingReview, 409, ShiftErrorCodes.ShiftAlreadyFinished)]
    [InlineData(ShiftStatus.Completed, 409, ShiftErrorCodes.ShiftAlreadyCompleted)]
    [InlineData(ShiftStatus.Cancelled, 409, ShiftErrorCodes.ShiftCancelled)]
    [InlineData(ShiftStatus.Draft, 409, ShiftErrorCodes.ShiftNotPublished)]
    public async Task EveryBreakWrite_NeedsTheShiftInProgress(ShiftStatus status, int http, string code)
    {
        var f = Create(status);
        var anyId = Guid.NewGuid();

        foreach (var result in new[]
                 {
                     await f.Controller.StartBreak(f.Shift.Id, default),
                     await f.Controller.EndBreak(f.Shift.Id, anyId, default),
                     await f.Controller.EditBreak(f.Shift.Id, anyId, new EditShiftBreakDto { StartedAt = NowUtc, EndedAt = NowUtc.AddMinutes(5) }, default),
                     await f.Controller.DeleteBreak(f.Shift.Id, anyId, default),
                 })
        {
            Assert.Equal(code, Failure(result, http).Code);
        }
        Assert.Empty(await f.Db.ShiftBreaks.ToListAsync());
    }

    // ── roster scoping: the caller's OWN shift only ──

    [Fact]
    public async Task AnotherWorkersShift_Is404_ForEveryBreakEndpoint_LikeAnyOtherPortalAction()
    {
        var (f, id) = await WithEndedBreakAsync();
        var stranger = f.ControllerFor(f.AddWorker().Id);

        Assert.IsType<NotFoundObjectResult>((await stranger.StartBreak(f.Shift.Id, default)).Result);
        Assert.IsType<NotFoundObjectResult>((await stranger.EndBreak(f.Shift.Id, id, default)).Result);
        Assert.IsType<NotFoundObjectResult>((await stranger.EditBreak(f.Shift.Id, id, new EditShiftBreakDto(), default)).Result);
        Assert.IsType<NotFoundObjectResult>((await stranger.DeleteBreak(f.Shift.Id, id, default)).Result);
        Assert.Single(await f.Db.ShiftBreaks.ToListAsync());
    }

    [Fact]
    public async Task ABreakThatBelongsToAnotherShiftsCompletion_Is404()
    {
        var (f, _) = await WithEndedBreakAsync();
        // A second shift of the same worker, in progress, with its own break.
        var other = new Shift
        {
            Id = Guid.NewGuid(), ParticipantId = f.Participant.Id, UserId = f.Worker.Id, ServiceDate = ServiceDate.AddDays(1),
            StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(17, 0), Status = ShiftStatus.InProgress,
        };
        var otherCompletion = new ShiftCompletion
        {
            Id = Guid.NewGuid(), ShiftId = other.Id, ActualStart = ActualStartUtc, TimeZoneId = "Australia/Sydney",
            SubmittedByUserId = f.Worker.Id, StartedAt = ActualStartUtc, IsActive = true,
        };
        var foreignBreak = new ShiftBreak { Id = Guid.NewGuid(), ShiftCompletionId = otherCompletion.Id, StartedAt = NowUtc.AddMinutes(-30), EndedAt = NowUtc.AddMinutes(-10), CreatedByUserId = f.Worker.Id };
        f.Db.Shifts.Add(other);
        f.Db.ShiftCompletions.Add(otherCompletion);
        f.Db.ShiftBreaks.Add(foreignBreak);
        await f.Db.SaveChangesAsync();

        var body = Failure(await f.Controller.DeleteBreak(f.Shift.Id, foreignBreak.Id, default), 404);

        Assert.Equal(ShiftErrorCodes.ShiftBreakNotFound, body.Code);
        Assert.Equal(2, (await f.Db.ShiftBreaks.ToListAsync()).Count);
    }

    // ── audit ──

    [Fact]
    public async Task BreakCreatesEditsAndDeletes_AreAudited()
    {
        var f = Create(withAuditing: true);
        var started = Detail(await f.Controller.StartBreak(f.Shift.Id, default)).Breaks.Single();
        f.Advance(TimeSpan.FromMinutes(10));
        Detail(await f.Controller.EndBreak(f.Shift.Id, started.Id, default));
        Detail(await f.Controller.EditBreak(f.Shift.Id, started.Id,
            new EditShiftBreakDto { StartedAt = NowUtc.AddMinutes(1), EndedAt = NowUtc.AddMinutes(9) }, default));
        Detail(await f.Controller.DeleteBreak(f.Shift.Id, started.Id, default));

        var actions = await f.Db.AuditLogs.Where(a => a.EntityType == nameof(ShiftBreak) && a.EntityId == started.Id)
            .Select(a => a.Action).ToListAsync();

        Assert.Contains(AuditAction.Created, actions);
        Assert.Contains(AuditAction.Updated, actions);
        Assert.Contains(AuditAction.Deleted, actions);
        Assert.Contains(typeof(ShiftBreak), AuditedEntities.Types);
    }

    // ── schema ──

    [Fact]
    public void Model_HasAPartialUniqueIndexForOneRunningBreakPerCompletion_AndABreakTenantFilter()
    {
        var f = Create();
        var entity = f.Db.Model.FindEntityType(typeof(ShiftBreak))!;

        var running = Assert.Single(entity.GetIndexes(), i => i.GetDatabaseName() == ShiftBreak.OneRunningIndexName);
        Assert.True(running.IsUnique);
        Assert.Equal("\"EndedAt\" IS NULL", running.GetFilter());
        Assert.NotNull(entity.GetQueryFilter());
        Assert.True(typeof(Odip.Domain.Interfaces.ITenantEntity).IsAssignableFrom(typeof(ShiftBreak)));
    }
}
