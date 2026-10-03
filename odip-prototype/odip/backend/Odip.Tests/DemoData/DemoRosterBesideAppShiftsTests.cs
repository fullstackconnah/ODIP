using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// Third independent review R3, Q1 and Q8: shifts the app made, or that a person has taken over, beside the roster pack's own. The app holds one shift per pattern and date
/// (its Generate skips a date that already carries one, whoever made it) and the pack's id is not that key; a Draft a coordinator generated for a date beyond the window has a
/// random id, and the window reaches it weeks later. And the script approves the shifts it closed out, not a shift a worker finished again after a coordinator returned it,
/// or one a presenter started and finished by hand.
/// </summary>
public class DemoRosterBesideAppShiftsTests
{
    private static readonly Guid MondayPattern = DemoIds.For("shift-pattern", "priya-thomas-mon");

    private static DateTimeOffset Utc(string s) => DateTimeOffset.Parse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    private static DateTime LocalToUtc(DateTime local) => ProviderLocalTime.LocalToUtc(local, Zone());

    private static Guid OwnShiftId(Guid pattern, DateOnly date) => DemoIds.For("shift", "pattern", pattern, date);

    /// <summary>The Draft the app's own Generate makes for a date of a pattern: a random id and the pattern's id.</summary>
    private static async Task<Guid> AddGeneratedDraftAsync(DemoTestEnv env, DateOnly date)
    {
        await using var db = env.AdminDb();
        var pattern = await db.ShiftPatterns.SingleAsync(p => p.Id == MondayPattern);
        var draft = new Shift
        {
            Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, ParticipantId = pattern.ParticipantId, UserId = pattern.DefaultUserId, ServiceDate = date, StartTime = pattern.StartTime,
            EndTime = pattern.EndTime, EndsNextDay = pattern.EndsNextDay, Ratio = pattern.Ratio, NightType = pattern.NightType, Status = ShiftStatus.Draft, ShiftPatternId = pattern.Id,
            CreatedAt = new DateTime(2026, 10, 2, 1, 0, 0, DateTimeKind.Utc), UpdatedAt = new DateTime(2026, 10, 2, 1, 0, 0, DateTimeKind.Utc),
        };
        db.Shifts.Add(draft);
        await db.SaveChangesAsync();
        return draft.Id;
    }

    [Fact]
    public async Task ADraftTheAppGeneratedForADemoPatternBeyondTheWindow_IsNotDoubledWhenTheWindowReachesIt()
    {
        var env = await TickAsync(Utc("2026-10-02T00:30:00Z"));                                      // Fri 2 Oct 10:30: the window runs to Sun 25 Oct
        var date = new DateOnly(2026, 11, 2);                                                        // a Monday five weeks ahead: Priya's Monday pattern
        var draft = await AddGeneratedDraftAsync(env, date);

        await RunAsync(env, Utc("2026-10-22T23:30:00Z"));                                            // Fri 23 Oct 10:30: the window now runs to Sun 15 Nov

        await using var check = env.AdminDb();
        var shifts = await check.Shifts.Where(s => s.ShiftPatternId == MondayPattern && s.ServiceDate == date).ToListAsync();
        var only = Assert.Single(shifts);                                                            // one shift for the pattern and date, as the app's own Generate would leave
        Assert.Equal(draft, only.Id);
        Assert.Equal(ShiftStatus.Draft, only.Status);
        Assert.False(await check.Shifts.AnyAsync(s => s.Id == OwnShiftId(MondayPattern, date)));
        Assert.True(await check.Shifts.AnyAsync(s => s.Id == OwnShiftId(MondayPattern, date.AddDays(7))));        // and the window is filled as ever beside it
    }

    [Fact]
    public async Task APastDraftTheAppGeneratedForADemoPattern_IsNotCancelledByTheTopUp()
    {
        var env = await TickAsync(Utc("2026-10-02T00:30:00Z"));
        var draft = await AddGeneratedDraftAsync(env, new DateOnly(2026, 9, 7));                     // a Monday five weeks back, before the window

        await RunAsync(env, Utc("2026-10-02T02:30:00Z"));

        await using var check = env.AdminDb();
        Assert.Equal(ShiftStatus.Draft, (await check.Shifts.SingleAsync(s => s.Id == draft)).Status);        // a person's shift: nothing of the top-up's to move
    }

    [Fact]
    public async Task AShiftACoordinatorReturnedAndTheWorkerFinishedAgain_IsNotApprovedBySarahAtThreeDays()
    {
        var env = await TickAsync(Utc("2026-10-02T00:30:00Z"));                                      // Fri 10:30
        Guid again;
        Guid shiftId;
        await using (var db = env.AdminDb())
        {
            // A roster shift the top-up closed out for review, then returned by a coordinator and finished again by its worker.
            var shift = await db.Shifts.Where(s => s.ShiftPatternId != null && s.Status == ShiftStatus.PendingReview && s.ServiceDate >= new DateOnly(2026, 9, 30))
                .OrderBy(s => s.ServiceDate).FirstAsync();
            shiftId = shift.Id;
            var original = await db.ShiftCompletions.SingleAsync(c => c.ShiftId == shift.Id && c.IsActive);
            original.IsActive = false;
            var resubmitted = LocalToUtc(At(new DateOnly(2026, 10, 1), 9, 0));
            var completion = new ShiftCompletion
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, ShiftId = shift.Id, ActualStart = original.ActualStart, ActualEnd = original.ActualEnd, StartedAt = original.StartedAt,
                SubmittedAt = resubmitted, TimeZoneId = original.TimeZoneId, SubmittedByUserId = original.SubmittedByUserId, NothingToNoteConfirmed = true, IsActive = true,
                CreatedAt = resubmitted, UpdatedAt = resubmitted,
            };
            again = completion.Id;
            db.ShiftCompletions.Add(completion);
            shift.ReturnCount = 1;
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Utc("2026-10-05T23:30:00Z"));                                            // Tue 6 Oct 10:30: three days on

        await using var check = env.AdminDb();
        var completionNow = await check.ShiftCompletions.SingleAsync(c => c.Id == again);
        Assert.Null(completionNow.ReviewOutcome);                                                    // theirs to review, not the script's to approve
        Assert.Null(completionNow.ReviewedByUserId);
        Assert.Equal(ShiftStatus.PendingReview, (await check.Shifts.SingleAsync(s => s.Id == shiftId)).Status);
    }

    [Fact]
    public async Task AnEveningAPresenterStartedAndFinishedByHand_IsNotApprovedBySarahAtThreeDays()
    {
        var env = await TickAsync(Utc("2026-10-01T20:30:00Z"));                                      // Fri 06:30: Friday's evening is cast
        var evening = LiveSetCatalog.ShiftId(LiveSetCatalog.Evening, Friday);
        Guid theirs;
        await using (var db = env.AdminDb())
        {
            var shift = await db.Shifts.SingleAsync(s => s.Id == evening);
            var started = LocalToUtc(At(Friday, 14, 30));
            var ended = LocalToUtc(At(Friday, 21, 5));
            var completion = new ShiftCompletion
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, ShiftId = evening, ActualStart = started, ActualEnd = ended, StartedAt = started, SubmittedAt = ended.AddMinutes(5),
                TimeZoneId = Zone().Id, SubmittedByUserId = shift.UserId!.Value, HandoverText = "Settled for the night.", NothingToHandOver = false, NothingToNoteConfirmed = true,
                IsActive = true, CreatedAt = started, UpdatedAt = ended.AddMinutes(5),
            };
            theirs = completion.Id;
            db.ShiftCompletions.Add(completion);
            shift.Status = ShiftStatus.PendingReview;                                                // started by hand, and finished by hand
            shift.UpdatedAt = ended.AddMinutes(5);
            await db.SaveChangesAsync();
        }

        await RunAsync(env, Utc("2026-10-05T23:30:00Z"));                                            // Tue 6 Oct 10:30: three days on

        await using var check = env.AdminDb();
        var completionNow = await check.ShiftCompletions.SingleAsync(c => c.Id == theirs);
        Assert.Null(completionNow.ReviewOutcome);
        Assert.Null(completionNow.ReviewedByUserId);
        Assert.Equal(ShiftStatus.PendingReview, (await check.Shifts.SingleAsync(s => s.Id == evening)).Status);
    }

    [Fact]
    public async Task AShiftOfTodayThatHasBeenWorked_WasNotCreatedAfterItsOwnCompletionStarted()
    {
        var env = await TickAsync(Utc("2026-10-01T10:00:00Z"));                                      // Thu 1 Oct 20:00: the first run, in the evening

        await using var check = env.AdminDb();
        var worked = await (from s in check.Shifts
                            join c in check.ShiftCompletions on s.Id equals c.ShiftId
                            where s.ShiftPatternId != null && s.ServiceDate == new DateOnly(2026, 10, 1)
                            select new { s.CreatedAt, c.ActualStart }).ToListAsync();
        Assert.NotEmpty(worked);                                                                     // Brendan's Thursday shift, 10:00 to 14:00, has been worked
        Assert.All(worked, w => Assert.True(w.CreatedAt <= w.ActualStart, $"created {w.CreatedAt:o}, started {w.ActualStart:o}"));
    }
}
