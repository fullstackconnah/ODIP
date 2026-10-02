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

    private static OdipDbContext TenantDb(DemoTestEnv env) =>
        new(env.Options, new ScopedTenantOverride { TenantId = DemoTestEnv.DemoTenantId });

    private static async Task<RosterBoardDto> BoardAsync(DemoTestEnv env, DateOnly week)
    {
        await using var db = TenantDb(env);
        var controller = new RosteringController(db, new StaffCompatibilityLinkService(db), new StaffUnavailabilityQuery(db), clock: env.Clock);
        var result = await controller.GetBoard(week, "participant", CancellationToken.None);
        return Assert.IsType<ApiResponse<RosterBoardDto>>(Assert.IsType<OkObjectResult>(result.Result).Value).Data!;
    }

    private static Guid Story(string key, DateOnly week) => DemoIds.For("shift", "story", key, week);

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
        var shifts = await db.Shifts.Where(s => s.Status == ShiftStatus.PendingReview || s.Status == ShiftStatus.Completed).ToListAsync();
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

    // What the board must say about each story shift, by story key. Independent of the code that builds them: these are the plan's 2.2 table, with
    // the knock-on findings the data really produces (a pending leave covers Saturday too, an expired first aid is on every Emily shift).
    private static readonly Dictionary<string, string[]> Designed = new()
    {
        ["wsc-expired"] = new[] { "WSC_EXPIRED" },
        ["wsc-missing"] = new[] { "WSC_MISSING" },
        ["double-a"] = new[] { "DOUBLE_BOOKED_SHIFT" },
        ["double-b"] = new[] { "DOUBLE_BOOKED_SHIFT" },
        ["unavailable"] = new[] { "STAFF_UNAVAILABLE" },
        ["on-leave"] = new[] { "STAFF_ON_LEAVE", "CREDENTIAL_EXPIRED", "ASSIGNEE_ON_LEAVE" },
        ["recurring"] = new[] { "STAFF_RECURRING_UNAVAILABLE", "ASSIGNEE_ON_LEAVE" },     // the board's badge covers an approved recurring rule too
        ["leave-pending"] = new[] { "STAFF_LEAVE_PENDING", "CREDENTIAL_EXPIRED" },
        ["recurring-pending"] = new[] { "STAFF_RECURRING_PENDING", "CREDENTIAL_EXPIRED" },
        ["excluded"] = new[] { "COMPATIBILITY_EXCLUDED", "STAFF_LEAVE_PENDING", "CREDENTIAL_EXPIRED" },
        ["needs-mh"] = new[] { "COMPETENCY_MISSING" },
        ["needs-night"] = new[] { "COMPETENCY_MISSING" },
        ["needs-fa"] = new[] { "WSC_EXPIRED", "COMPETENCY_MISSING" },
        ["ratio-a"] = new[] { "RATIO_SHORTFALL" },
        ["hours-mon"] = new[] { "OVER_HOURS" },
        ["hours-tue"] = new[] { "OVER_HOURS" },
        ["hours-wed"] = new[] { "OVER_HOURS" },
        ["hours-thu"] = new[] { "OVER_HOURS" },
        ["hours-fri"] = new[] { "OVER_HOURS" },
    };

    private static readonly string[] Unfilled = { "ratio-b", "draft", "cancelled" };

    /// <summary>Codes a lapsing credential adds to any shift of that worker once its date has passed: that is the plan's "near ones age into expired".</summary>
    private static HashSet<string> AgingCodes(User u, DateOnly date)
    {
        var codes = new HashSet<string>();
        if (u.WorkerScreeningExpiryDate is null) codes.Add("WSC_MISSING");
        else if (u.WorkerScreeningExpiryDate < date) codes.Add("WSC_EXPIRED");
        if ((u.IsFirstAidQualified && u.FirstAidExpiryDate < date) || (u.IsDriverEligible && u.DriverLicenceExpiryDate < date)
            || (u.IsManualHandlingCompetent && u.ManualHandlingExpiryDate < date) || (u.IsMedicationCompetent && u.MedicationCompetencyExpiryDate < date))
            codes.Add("CREDENTIAL_EXPIRED");
        return codes;
    }

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
        var week = W0.AddDays(7 * weeksAhead);

        var board = await BoardAsync(env, week);

        await using var db = env.AdminDb();
        var users = await db.Users.ToDictionaryAsync(u => u.Id);
        var shifts = await db.Shifts.Where(s => s.ServiceDate >= week && s.ServiceDate <= week.AddDays(6)).ToListAsync();
        var codesByShift = board.Exceptions.GroupBy(e => e.ShiftId).ToDictionary(g => g.Key, g => g.Select(e => e.Finding.Code).ToHashSet());

        foreach (var (key, designed) in Designed)
        {
            var shift = shifts.SingleOrDefault(s => s.Id == Story(key, week));
            Assert.True(shift is not null, $"story shift '{key}' is missing from the week of {week}");
            var actual = codesByShift.GetValueOrDefault(shift!.Id) ?? new HashSet<string>();
            var expected = designed.ToHashSet();
            if (shift.ServiceDate == LabourDay) expected.Add("PUBLIC_HOLIDAY");
            Assert.True(expected.IsSubsetOf(actual), $"{key} on {shift.ServiceDate}: expected {string.Join(",", expected)} but the board says {string.Join(",", actual)}");
            var extra = actual.Except(expected).ToHashSet();
            Assert.True(extra.IsSubsetOf(AgingCodes(users[shift.UserId!.Value], shift.ServiceDate)), $"{key}: unexpected findings {string.Join(",", extra)}");
        }

        foreach (var key in Unfilled)
        {
            var shift = shifts.Single(s => s.Id == Story(key, week));
            Assert.Null(shift.UserId);
            Assert.False(codesByShift.ContainsKey(shift.Id) && codesByShift[shift.Id].Except(new[] { "PUBLIC_HOLIDAY" }).Any(), $"{key} is unfilled, so no staff finding applies");
        }

        // Pattern shifts carry only what the staff's own credentials and the holiday produce.
        foreach (var shift in shifts.Where(s => s.ShiftPatternId != null && s.UserId != null))
        {
            var actual = codesByShift.GetValueOrDefault(shift.Id) ?? new HashSet<string>();
            var allowed = AgingCodes(users[shift.UserId!.Value], shift.ServiceDate);
            if (shift.ServiceDate == LabourDay) allowed.Add("PUBLIC_HOLIDAY");
            Assert.True(actual.IsSubsetOf(allowed), $"pattern shift {shift.Id} on {shift.ServiceDate}: unexpected {string.Join(",", actual.Except(allowed))}");
        }
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
            .SelectMany(w => Designed.Keys.Concat(Unfilled).Select(k => (Week: w, Id: Story(k, w))))
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
