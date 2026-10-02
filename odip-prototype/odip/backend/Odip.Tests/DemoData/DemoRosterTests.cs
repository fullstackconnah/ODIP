using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Odip.Infrastructure.Notifications;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// The roster half of PR 1: shift patterns, the pattern-generated shifts, the week packs that trigger every roster check (plan 2.2), the
/// way past shifts are closed out, and the screens' own view of it all (the board's findings come from the real RosteringController).
/// Today in these tests is Fri 2026-10-02 10:30 AEST; W0 = Mon 2026-09-28, W1 = Mon 2026-10-05 (Labour Day, and daylight saving has
/// started by then), W2 = Mon 2026-10-12.
/// </summary>
public class DemoRosterTests
{
    private static readonly DateOnly D0 = new(2026, 10, 2);
    private static readonly DateOnly W0 = new(2026, 9, 28);
    private static readonly DateOnly W1 = new(2026, 10, 5);
    private static readonly DateOnly W2 = new(2026, 10, 12);

    /// <summary>Every pack PR 1 runs that the roster depends on, in dependency order.</summary>
    private static IDemoPack[] RosterPacks() => new IDemoPack[]
    {
        new StaffCredentialsPack(), new CompatibilityPack(), new ShiftPatternsPack(), new LeaveAndAvailabilityPack(), new RosterWeeksPack(), new LeaveCoverageTasksPack(),
    };

    private static async Task<DemoTestEnv> RunAsync(DateTimeOffset? at = null, IDemoPack[]? packs = null)
    {
        var env = new DemoTestEnv(at ?? new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var result = await env.RunAsync(packs ?? RosterPacks());
        Assert.Empty(result.Failures);
        return env;
    }

    private static Task<RosterBoardDto> BoardAsync(DemoTestEnv env, DateOnly week) => DemoBoardAssertions.BoardAsync(env, week);

    private static Guid Story(string key, DateOnly week) => DemoBoardAssertions.Story(key, week);

    // ── patterns ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Patterns_AreThirteen_NineActive_TwoEnded_OneInactive_OneStartingNextMonth()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        var patterns = await db.ShiftPatterns.ToListAsync();
        Assert.Equal(13, patterns.Count);
        Assert.All(patterns, p => Assert.Equal(DemoTestEnv.DemoTenantId, p.TenantId));
        Assert.Equal(9, patterns.Count(p => p.IsActive && p.EffectiveTo is null && p.EffectiveFrom <= D0));
        Assert.Equal(2, patterns.Count(p => p.IsActive && p.EffectiveTo is { } to && to < D0));
        Assert.Equal(1, patterns.Count(p => !p.IsActive));
        Assert.Equal(1, patterns.Count(p => p.IsActive && p.EffectiveFrom > D0));
        Assert.Equal(new DateOnly(2026, 9, 1), patterns.Where(p => p.IsActive && p.EffectiveTo is null && p.EffectiveFrom <= D0).Min(p => p.EffectiveFrom));
        Assert.Equal(new DateOnly(2026, 11, 1), patterns.Single(p => p.EffectiveFrom > D0).EffectiveFrom);   // the first of next month
    }

    [Fact]
    public async Task Patterns_IncludeAnOvernightActiveNightAndASleepover_AndEveryRatioTheBoardShows()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        var patterns = await db.ShiftPatterns.ToListAsync();
        var night = Assert.Single(patterns, p => p.NightType == SleepoverType.ActiveNight);
        Assert.True(night.EndsNextDay);
        Assert.Equal(DayOfWeek.Sunday, night.DayOfWeek);     // a Sunday night never touches the 02:00-03:00 daylight-saving hour on the Sunday
        Assert.Single(patterns, p => p.NightType == SleepoverType.Sleepover && p.EndsNextDay);
        Assert.Contains(patterns, p => p.Ratio == SupportRatio.OneToTwo);
        Assert.Contains(patterns, p => p.Ratio == SupportRatio.SharedSupport);
        Assert.All(patterns.Where(p => !p.EndsNextDay), p => Assert.True(p.EndTime > p.StartTime));
    }

    [Fact]
    public async Task Patterns_NeverTouchTheHourThatDoesNotExistWhenDaylightSavingStarts()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        foreach (var p in await db.ShiftPatterns.ToListAsync())
        {
            // 02:00-03:00 on a Sunday: no pattern may start, end or run through it. A Saturday overnight shift would run through it.
            Assert.False(p.DayOfWeek == DayOfWeek.Saturday && p.EndsNextDay, $"{p.Id}: a Saturday overnight pattern crosses the Sunday 02:00 hour");
            if (p.DayOfWeek != DayOfWeek.Sunday) continue;
            var startsBeforeTheGapEnds = p.StartTime < new TimeOnly(3, 0);
            Assert.False(startsBeforeTheGapEnds && (p.EndsNextDay || p.EndTime > new TimeOnly(2, 0)), $"{p.Id} runs through Sunday 02:00-03:00");
        }
    }

    // ── pattern-generated shifts ─────────────────────────────────────────────

    [Fact]
    public async Task PatternShifts_AreGeneratedForEveryOccurrenceInTheWindow_ExactlyAsTheExpanderSaysSo()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        var expander = new ShiftPatternExpander();
        foreach (var pattern in await db.ShiftPatterns.ToListAsync())
        {
            var expected = expander.Occurrences(pattern, W0.AddDays(-14), W0.AddDays(27)).ToList();
            var actual = await db.Shifts.Where(s => s.ShiftPatternId == pattern.Id).Select(s => s.ServiceDate).OrderBy(d => d).ToListAsync();
            Assert.Equal(expected, actual);
        }
        Assert.True(await db.Shifts.CountAsync(s => s.ShiftPatternId != null) > 40, "nine weekly patterns over six weeks");
    }

    [Fact]
    public async Task EveryShiftTakesItsStaffParticipantAndTimesFromThePattern()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        var patterns = await db.ShiftPatterns.ToDictionaryAsync(p => p.Id);
        foreach (var shift in await db.Shifts.Where(s => s.ShiftPatternId != null).ToListAsync())
        {
            var p = patterns[shift.ShiftPatternId!.Value];
            Assert.Equal(p.DefaultUserId, shift.UserId);
            Assert.Equal(p.ParticipantId, shift.ParticipantId);
            Assert.Equal(p.StartTime, shift.StartTime);
            Assert.Equal(p.EndTime, shift.EndTime);
            Assert.Equal(p.EndsNextDay, shift.EndsNextDay);
            Assert.Equal(p.Ratio, shift.Ratio);
            Assert.Equal(p.NightType, shift.NightType);
            Assert.Equal(p.DayOfWeek, shift.ServiceDate.DayOfWeek);
        }
    }

    // ── what is Published, and what is closed out ────────────────────────────

    [Fact]
    public async Task NoPublishedShiftHasEnded_AndEveryEndedShiftIsClosedOutWithOneCompletion()
    {
        var env = await RunAsync();
        var nowUtc = env.Clock.GetUtcNow().UtcDateTime;
        var anchors = DemoAnchors.Create(nowUtc, "NSW");

        await using var db = env.AdminDb();
        var shifts = await db.Shifts.ToListAsync();
        var completions = await db.ShiftCompletions.ToListAsync();
        foreach (var shift in shifts)
        {
            var (_, endLocal) = ProviderLocalTime.RosteredWindowLocal(shift);
            var ended = anchors.LocalToUtc(endLocal) + TimeSpan.FromMinutes(45) <= nowUtc;
            var mine = completions.Where(c => c.ShiftId == shift.Id).ToList();
            if (shift.UserId is null) continue;   // an unfilled shift has nobody to complete it (the story shifts that are Draft or Cancelled)
            if (ended)
            {
                Assert.True(shift.Status is ShiftStatus.PendingReview or ShiftStatus.Completed, $"{shift.Id} ended {endLocal:s} but is {shift.Status}");
                Assert.Single(mine);
            }
            else
            {
                Assert.True(shift.Status is ShiftStatus.Published or ShiftStatus.Draft or ShiftStatus.Cancelled, $"{shift.Id} has not ended but is {shift.Status}");
                Assert.Empty(mine);
            }
        }
        Assert.Contains(shifts, s => s.Status == ShiftStatus.Completed);
        Assert.Contains(shifts, s => s.Status == ShiftStatus.PendingReview);
        Assert.Contains(shifts, s => s.Status == ShiftStatus.Published);
    }

    [Fact]
    public async Task ClosedOutShifts_FollowTheCompletionStateMachine()
    {
        var env = await RunAsync();
        var nowUtc = env.Clock.GetUtcNow().UtcDateTime;

        await using var db = env.AdminDb();
        // The shifts the top-up closed out: the fixture's aged shift stands in for the old seed's and has a note, so its completion is not "nothing to note".
        var shifts = await db.Shifts.Where(s => (s.Status == ShiftStatus.PendingReview || s.Status == ShiftStatus.Completed) && s.Id != DemoFixture.OldShiftId).ToListAsync();
        var completions = await db.ShiftCompletions.ToDictionaryAsync(c => c.ShiftId);
        var sarah = DemoFixture.StaffId("sarah");
        Assert.NotEmpty(shifts);
        foreach (var shift in shifts)
        {
            var c = completions[shift.Id];
            Assert.True(c.IsActive);
            Assert.Equal(shift.UserId, c.SubmittedByUserId);
            Assert.Equal("Australia/Sydney", c.TimeZoneId);
            Assert.NotNull(c.ActualEnd);
            Assert.NotNull(c.SubmittedAt);
            Assert.True(c.SubmittedAt <= nowUtc, "a completion is never in the future");
            Assert.True(c.NothingToNoteConfirmed);
            Assert.True(string.IsNullOrWhiteSpace(c.HandoverText) ? c.NothingToHandOver : !c.NothingToHandOver, "handover text XOR nothing-to-hand-over");

            // The variance is what ShiftVarianceCalculator says against the rostered times.
            var (start, end) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(shift, c.TimeZoneId);
            Assert.Equal(ShiftVarianceCalculator.VarianceMinutes(c.ActualStart, start), c.VarianceMinutesStart);
            Assert.Equal(ShiftVarianceCalculator.VarianceMinutes(c.ActualEnd!.Value, end), c.VarianceMinutesEnd);
            Assert.InRange(c.VarianceMinutesStart, -5, 25);
            Assert.InRange(c.VarianceMinutesEnd, -10, 25);

            if (shift.Status == ShiftStatus.Completed)
            {
                Assert.Equal(ReviewOutcome.Approved, c.ReviewOutcome);
                Assert.Equal(sarah, c.ReviewedByUserId);
                Assert.NotNull(c.ReviewedAt);
                Assert.True(c.ReviewedAt <= nowUtc && c.ReviewedAt >= c.SubmittedAt);
            }
            else
            {
                Assert.Null(c.ReviewOutcome);
                Assert.Null(c.ReviewedByUserId);
                Assert.Null(c.ReviewedAt);
            }
        }
    }

    [Fact]
    public async Task ShiftsThatEndedMoreThanThreeDaysAgoAreCompleted_NewerOnesAreWaitingForReview()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        foreach (var shift in await db.Shifts.Where(s => s.Status == ShiftStatus.PendingReview || s.Status == ShiftStatus.Completed).ToListAsync())
        {
            var daysAgo = D0.DayNumber - shift.ServiceDate.DayNumber;
            Assert.Equal(daysAgo >= 3 ? ShiftStatus.Completed : ShiftStatus.PendingReview, shift.Status);
        }
    }

    // ── the week packs: every roster check on the board ──────────────────────

    private static readonly DateOnly LabourDay = new(2026, 10, 5);

    private static async Task AddHolidayAsync(DemoTestEnv env)
    {
        await using var db = env.AdminDb();
        db.PublicHolidays.Add(new PublicHoliday { Id = Guid.NewGuid(), Date = LabourDay, Name = "Labour Day", State = "NSW" });
        await db.SaveChangesAsync();
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task TheBoardForAStoryWeek_ShowsEachDesignedFinding_AndNothingElse(int weeksAhead)
    {
        var env = await RunAsync();
        await AddHolidayAsync(env);

        await DemoBoardAssertions.AssertDesignedWeekAsync(env, W0.AddDays(7 * weeksAhead), LabourDay);
    }

    [Fact]
    public async Task TheBoardForNextWeek_ShowsFourteenOfTheFifteenBoardCodes_AllButTheTripOneThatPR3Adds()
    {
        var env = await RunAsync();
        await AddHolidayAsync(env);

        var board = await BoardAsync(env, W1);

        var codes = board.Exceptions.Select(e => e.Finding.Code).ToHashSet();
        var expected = new[]
        {
            "WSC_EXPIRED", "WSC_MISSING", "DOUBLE_BOOKED_SHIFT", "STAFF_UNAVAILABLE", "STAFF_ON_LEAVE", "STAFF_RECURRING_UNAVAILABLE", "STAFF_LEAVE_PENDING",
            "STAFF_RECURRING_PENDING", "COMPATIBILITY_EXCLUDED", "CREDENTIAL_EXPIRED", "COMPETENCY_MISSING", "RATIO_SHORTFALL", "OVER_HOURS", "PUBLIC_HOLIDAY",
        };
        foreach (var code in expected) Assert.Contains(code, codes);
        Assert.DoesNotContain("DOUBLE_BOOKED_TRIP", codes);                 // needs a trip: PR 3
        Assert.Contains("ASSIGNEE_ON_LEAVE", codes);                        // the board's own badge for Priya's Thursday shift
    }

    [Fact]
    public async Task WithoutAHolidayRow_ThereIsNoHolidayFinding_ThatCodeIsDataDependent()
    {
        var env = await RunAsync();

        var board = await BoardAsync(env, W1);

        Assert.DoesNotContain(board.Exceptions, e => e.Finding.Code == "PUBLIC_HOLIDAY");
    }

    [Fact]
    public async Task TheTwoReasonRequiredStories_CarryAPersistedOverrideReasonAndTheCodesItAcknowledges()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        foreach (var week in new[] { W1, W2 })
        {
            var onLeave = await db.Shifts.SingleAsync(s => s.Id == Story("on-leave", week));
            Assert.Equal("Leave approved after the roster was published; cover arranged with Rachel", onLeave.OverrideReason);
            Assert.Equal("STAFF_ON_LEAVE", onLeave.AcknowledgedFindingCodes);
            var recurring = await db.Shifts.SingleAsync(s => s.Id == Story("recurring", week));
            Assert.Equal("Study night swapped this week, confirmed with Daniel", recurring.OverrideReason);
            Assert.Equal("STAFF_RECURRING_UNAVAILABLE", recurring.AcknowledgedFindingCodes);
        }
        Assert.Equal(4, await db.Shifts.CountAsync(s => s.OverrideReason != null));
    }

    [Fact]
    public async Task ThePackShifts_FollowThePlansDaysTimesAndRatios()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        async Task<Shift> Get(string key) => await db.Shifts.SingleAsync(s => s.Id == Story(key, W1));
        var ratioA = await Get("ratio-a");
        Assert.Equal(W1, ratioA.ServiceDate);                                                   // Monday
        Assert.Equal((new TimeOnly(7, 0), new TimeOnly(15, 0), SupportRatio.TwoToOne), (ratioA.StartTime, ratioA.EndTime, ratioA.Ratio));
        Assert.Null((await Get("ratio-b")).UserId);                                             // the partner slot is unassigned
        Assert.Equal(DemoFixture.StaffId("james"), ratioA.UserId);
        var night = await Get("needs-night");
        Assert.True(night.EndsNextDay);
        Assert.Equal(SleepoverType.ActiveNight, night.NightType);
        Assert.Equal(DayOfWeek.Tuesday, night.ServiceDate.DayOfWeek);
        Assert.Equal(new TimeOnly(22, 0), night.StartTime);
        var hours = await db.Shifts.Where(s => s.UserId == DemoFixture.StaffId("marcus") && s.ServiceDate >= W1 && s.ServiceDate <= W1.AddDays(6)).ToListAsync();
        Assert.Equal(5, hours.Count);
        Assert.Equal(42.5m, hours.Sum(s => s.DurationHours));
        Assert.Equal(ShiftStatus.Draft, (await Get("draft")).Status);
        Assert.Equal(ShiftStatus.Cancelled, (await Get("cancelled")).Status);
        foreach (var key in new[] { "ratio-a", "ratio-b", "double-a", "on-leave" }) Assert.Equal(ShiftStatus.Published, (await Get(key)).Status);
    }

    [Fact]
    public async Task StoryWeeks_ExistOnlyForTheNextTwoWeeks_NotForHistory()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        var storyIds = new[] { W0.AddDays(-14), W0.AddDays(-7), W0, W1, W2, W0.AddDays(21) }
            .SelectMany(w => DemoBoardAssertions.Designed.Keys.Concat(DemoBoardAssertions.Unfilled).Select(k => (Week: w, Id: Story(k, w))))
            .ToList();
        var wanted = storyIds.Select(x => x.Id).ToList();
        var found = await db.Shifts.Where(s => wanted.Contains(s.Id)).Select(s => s.Id).ToListAsync();
        foreach (var (week, id) in storyIds) Assert.Equal(week == W1 || week == W2, found.Contains(id));
    }

    // ── every row this pack makes is a Demo row ──────────────────────────────

    [Fact]
    public async Task EveryRowCarriesTheDemoTenant_AndADeterministicId()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        Assert.All(await db.ShiftPatterns.ToListAsync(), p => Assert.Equal(DemoTestEnv.DemoTenantId, p.TenantId));
        Assert.All(await db.Shifts.ToListAsync(), s => Assert.Equal(DemoTestEnv.DemoTenantId, s.TenantId));
        Assert.All(await db.ShiftCompletions.ToListAsync(), c => Assert.Equal(DemoTestEnv.DemoTenantId, c.TenantId));
        var ids = (await db.Shifts.Select(s => s.Id).ToListAsync());
        Assert.All(ids, id => Assert.Equal('8', id.ToString("D")[14]));        // DemoIds sets version nibble 8
    }
}
