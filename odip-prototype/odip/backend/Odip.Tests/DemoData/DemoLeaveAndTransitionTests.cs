using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Odip.Infrastructure.DemoData.Packs;
using Xunit;

namespace Odip.Tests.DemoData;

/// <summary>
/// Leave, recurring unavailability and legacy availability (plan 2.7), the LeaveCoverage obligation tasks, and the forward-only
/// transitions that keep all of it believable as the clock moves: a past shift is closed out, a request nobody decided before its start
/// date is cancelled, a coverage task is completed once its shift has been worked. Rows are weekly packs keyed by their week, so a request
/// that has lapsed is replaced by one for a coming week.
/// </summary>
public class DemoLeaveAndTransitionTests
{
    private static readonly DateOnly D0 = new(2026, 10, 2);
    private static readonly DateOnly W1 = new(2026, 10, 5);
    private static readonly DateOnly W2 = new(2026, 10, 12);

    private static IDemoPack[] Packs() => new IDemoPack[]
    {
        new StaffCredentialsPack(), new CompatibilityPack(), new ShiftPatternsPack(), new LeaveAndAvailabilityPack(), new RosterWeeksPack(), new LeaveCoverageTasksPack(),
    };

    private static async Task<DemoTestEnv> RunAsync(DateTimeOffset? at = null)
    {
        var env = new DemoTestEnv(at ?? new DateTimeOffset(2026, 10, 2, 0, 30, 0, TimeSpan.Zero));
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        var result = await env.RunAsync(Packs());
        Assert.Empty(result.Failures);
        return env;
    }

    private static async Task TickAtAsync(DemoTestEnv env, DateTimeOffset utc)
    {
        env.Clock.Set(utc);
        var result = await env.RunAsync(Packs());
        Assert.Empty(result.Failures);
    }

    private static Guid Leave(string key, DateOnly week) => DemoIds.For("leave", key, week);
    private static Guid Story(string key, DateOnly week) => DemoIds.For("shift", "story", key, week);

    // ── leave ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Leave_CoversEveryStatusAndEveryTypeAndBothKinds()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        var leave = await db.LeaveRequests.ToListAsync();
        foreach (var status in Enum.GetValues<LeaveStatus>()) Assert.Contains(leave, l => l.Status == status);
        foreach (var type in Enum.GetValues<LeaveType>()) Assert.Contains(leave, l => l.LeaveType == type);
        var rules = await db.RecurringUnavailabilities.ToListAsync();
        Assert.Contains(rules, r => r.Status == LeaveStatus.Approved);
        Assert.Contains(rules, r => r.Status == LeaveStatus.Pending);
        Assert.Contains(rules, r => r.Status == LeaveStatus.Declined);
        Assert.All(leave, l => Assert.Equal(DemoTestEnv.DemoTenantId, l.TenantId));
        Assert.All(rules, r => Assert.Equal(DemoTestEnv.DemoTenantId, r.TenantId));
    }

    [Fact]
    public async Task ThePendingQueue_HasAtLeastThreeRequests_AllForDatesStillAhead_AndRequestedInThePast()
    {
        var env = await RunAsync();
        var nowUtc = env.Clock.GetUtcNow().UtcDateTime;

        await using var db = env.AdminDb();
        var pending = await db.LeaveRequests.Where(l => l.Status == LeaveStatus.Pending).ToListAsync();
        Assert.True(pending.Count >= 3, $"only {pending.Count} pending requests");
        Assert.All(pending, l =>
        {
            Assert.True(l.StartDate > D0, $"pending request starting {l.StartDate} is not in the future");
            Assert.True(l.RequestedAt < nowUtc, "a request cannot be made in the future");
            Assert.Equal(DateTimeKind.Utc, l.RequestedAt.Kind);
            Assert.Null(l.DecidedAt);
            Assert.Null(l.DecidedByUserId);
            Assert.Equal(l.UserId, l.RequestedByUserId);
        });
        var pendingRules = await db.RecurringUnavailabilities.Where(r => r.Status == LeaveStatus.Pending).ToListAsync();
        Assert.All(pendingRules, r => Assert.True(r.EffectiveFrom > D0));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task EachStoryWeekHasPriyasApprovedLeave_AndEmilyAndBrendansPendingRequests(int weeksAhead)
    {
        var env = await RunAsync();
        var week = W1.AddDays(7 * (weeksAhead - 1));

        await using var db = env.AdminDb();
        var priya = await db.LeaveRequests.SingleAsync(l => l.Id == Leave("priya-annual", week));
        Assert.Equal((DemoFixture.StaffId("priya"), LeaveType.Annual, LeaveStatus.Approved), (priya.UserId, priya.LeaveType, priya.Status));
        Assert.Equal((week.AddDays(2), week.AddDays(4)), (priya.StartDate, priya.EndDate));        // Wed to Fri
        Assert.Equal(DemoFixture.StaffId("rachel"), priya.DecidedByUserId);
        Assert.True(priya.DecidedAt > priya.RequestedAt);

        var emily = await db.LeaveRequests.SingleAsync(l => l.Id == Leave("emily-personal", week));
        Assert.Equal((DemoFixture.StaffId("emily"), LeaveType.Personal, LeaveStatus.Pending), (emily.UserId, emily.LeaveType, emily.Status));
        Assert.Equal((week.AddDays(4), week.AddDays(5)), (emily.StartDate, emily.EndDate));        // Fri to Sat

        var brendan = await db.LeaveRequests.SingleAsync(l => l.Id == Leave("brendan-annual", week));
        Assert.Equal((DemoFixture.StaffId("brendan"), LeaveStatus.Pending), (brendan.UserId, brendan.Status));
        Assert.Equal((week.AddDays(4), week.AddDays(6)), (brendan.StartDate, brendan.EndDate));    // Fri to Sun: Brendan has no shifts on those days
    }

    [Fact]
    public async Task DecidedRequests_CarryWhoDecidedAndWhy()
    {
        var env = await RunAsync();
        var nowUtc = env.Clock.GetUtcNow().UtcDateTime;

        await using var db = env.AdminDb();
        foreach (var l in await db.LeaveRequests.Where(l => l.Status == LeaveStatus.Approved).ToListAsync())
        {
            Assert.NotNull(l.DecidedByUserId);
            Assert.True(l.DecidedAt <= nowUtc && l.DecidedAt >= l.RequestedAt);
        }
        var declined = await db.LeaveRequests.Where(l => l.Status == LeaveStatus.Declined).ToListAsync();
        var one = Assert.Single(declined);
        Assert.False(string.IsNullOrWhiteSpace(one.DecisionNote));
        var cancelled = await db.LeaveRequests.SingleAsync(l => l.Status == LeaveStatus.Cancelled);
        Assert.Equal(cancelled.UserId, cancelled.DecidedByUserId);                                   // cancelled by the worker
    }

    [Fact]
    public async Task OnlyTheRequestsTheStoriesNeedCanBlockOrTrouble_TheRestAreHistoryOrNeverCount()
    {
        // The leave that overlaps a rostered day produces a roster finding, so any approved or pending leave must either be one of the
        // designed pack requests or lie entirely before the roster window (history). Declined and cancelled rows never count.
        var env = await RunAsync();

        await using var db = env.AdminDb();
        var windowStart = new DateOnly(2026, 9, 28).AddDays(-14);
        var designed = new[] { "priya-annual", "emily-personal", "brendan-annual" }.SelectMany(k => new[] { Leave(k, W1), Leave(k, W2) }).ToHashSet();
        foreach (var l in await db.LeaveRequests.Where(l => l.Status == LeaveStatus.Approved || l.Status == LeaveStatus.Pending).ToListAsync())
            Assert.True(designed.Contains(l.Id) || l.EndDate < windowStart, $"leave {l.Id} ({l.StartDate}..{l.EndDate}) would add an unplanned finding");
    }

    // ── recurring and legacy availability ────────────────────────────────────

    [Fact]
    public async Task RecurringRules_AreTheDocumentedOnes()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        var rules = await db.RecurringUnavailabilities.ToListAsync();
        var daniel = Assert.Single(rules, r => r.UserId == DemoFixture.StaffId("daniel"));
        Assert.Equal((DayOfWeek.Wednesday, new TimeOnly(16, 0), new TimeOnly(20, 0), LeaveStatus.Approved), (daniel.DayOfWeek, daniel.StartTime, daniel.EndTime, daniel.Status));
        Assert.Equal(D0.AddDays(-30), daniel.EffectiveFrom);
        Assert.Null(daniel.EffectiveTo);
        var marcus = Assert.Single(rules, r => r.UserId == DemoFixture.StaffId("marcus"));
        Assert.Equal((DayOfWeek.Thursday, LeaveStatus.Approved), (marcus.DayOfWeek, marcus.Status));
        Assert.True(marcus.EndTime <= new TimeOnly(8, 30), "must not overlap Marcus's 08:30 start");
        var lachlan = Assert.Single(rules, r => r.UserId == DemoFixture.StaffId("lachlan"));
        Assert.Equal((DayOfWeek.Friday, LeaveStatus.Declined), (lachlan.DayOfWeek, lachlan.Status));
        Assert.False(string.IsNullOrWhiteSpace(lachlan.DecisionNote));
        var emily = await db.RecurringUnavailabilities.Where(r => r.UserId == DemoFixture.StaffId("emily")).OrderBy(r => r.EffectiveFrom).ToListAsync();
        Assert.Equal(2, emily.Count);                                                                // one per story week
        Assert.All(emily, r => Assert.Equal((DayOfWeek.Tuesday, new TimeOnly(6, 0), new TimeOnly(9, 0), LeaveStatus.Pending), (r.DayOfWeek, r.StartTime, r.EndTime, r.Status)));
        Assert.Equal(new[] { W1, W2 }, emily.Select(r => r.EffectiveFrom).ToArray());
        Assert.All(emily, r => Assert.Equal(r.EffectiveFrom.AddDays(6), r.EffectiveTo));
    }

    [Fact]
    public async Task LegacyAvailability_HasAllSixTypes_WithTheDateBoundsTheEditorWrites()
    {
        var env = await RunAsync();

        await using var db = env.AdminDb();
        var rows = await db.StaffAvailabilities.ToListAsync();
        foreach (var type in Enum.GetValues<AvailabilityType>()) Assert.Contains(rows, a => a.AvailabilityType == type);
        var users = (await db.Users.Select(u => u.Id).ToListAsync()).ToHashSet();
        Assert.All(rows, a =>
        {
            Assert.Contains(a.UserId, users);                                                         // the non-tenant table only ever hangs off Demo users
            Assert.Equal(TimeSpan.Zero, a.StartDateTime.TimeOfDay);                                  // "date T00:00:00" ...
            Assert.Equal(new TimeSpan(23, 59, 59), a.EndDateTime.TimeOfDay);                         // ... "date T23:59:59", as AvailabilityRecordFormModal writes
            Assert.Equal(DateTimeKind.Unspecified, a.StartDateTime.Kind);                            // wall-clock dates, never shifted
            Assert.Equal(DateTimeKind.Unspecified, a.EndDateTime.Kind);
        });
        var daniel = await db.StaffAvailabilities.SingleAsync(a => a.Id == DemoIds.For("availability", "daniel-unavailable", W1));
        Assert.Equal(AvailabilityType.Unavailable, daniel.AvailabilityType);
        Assert.Equal(W1.AddDays(4), DateOnly.FromDateTime(daniel.StartDateTime));                    // Friday
        Assert.Equal("Medical appointment", daniel.Notes);
    }

    // ── LeaveCoverage tasks ──────────────────────────────────────────────────

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task ApprovingPriyasLeave_RaisesACoverageTaskForHerPublishedThursdayShift(int weeksAhead)
    {
        var env = await RunAsync();
        var week = W1.AddDays(7 * (weeksAhead - 1));
        var shiftId = Story("on-leave", week);
        var leaveId = Leave("priya-annual", week);

        await using var db = env.AdminDb();
        var task = await db.BookingTasks.SingleAsync(t => t.SourceKey == $"leave-coverage:{shiftId}:{leaveId}");
        Assert.Equal(TaskType.LeaveCoverage, task.TaskType);
        Assert.Equal(TaskItemStatus.NotStarted, task.Status);
        Assert.Equal(TaskPriority.High, task.Priority);
        Assert.Equal(week.AddDays(3), task.DueDate);                                                 // the Thursday
        Assert.Equal(shiftId, task.ShiftId);
        Assert.Equal(leaveId, task.LeaveRequestId);
        Assert.Equal($"/rostering?date={week.AddDays(3).ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture)}", task.LinkTo);
        Assert.Equal(DemoTestEnv.DemoTenantId, task.TenantId);
        Assert.Contains("Thomas Patel", task.Title);
        Assert.Contains("Priya Sharma is on leave", task.Title);
        Assert.Contains(week.AddDays(3).ToString("ddd d MMM", System.Globalization.CultureInfo.InvariantCulture), task.Title);
        Assert.Equal(2, await db.BookingTasks.CountAsync(t => t.TaskType == TaskType.LeaveCoverage));
    }

    // ── forward-only transitions ─────────────────────────────────────────────

    [Fact]
    public async Task APendingRequest_BecomesCancelled_OnceItsStartDateHasPassed_AndOnlyThen()
    {
        var env = await RunAsync();
        var emilyW1 = Leave("emily-personal", W1);
        var emilyW2 = Leave("emily-personal", W2);

        await TickAtAsync(env, new DateTimeOffset(2026, 10, 8, 20, 30, 0, TimeSpan.Zero));        // Fri 9 Oct 07:30 AEDT: the start date is today, not yet passed
        await using (var db = env.AdminDb())
            Assert.Equal(LeaveStatus.Pending, (await db.LeaveRequests.SingleAsync(l => l.Id == emilyW1)).Status);

        await TickAtAsync(env, new DateTimeOffset(2026, 10, 9, 23, 30, 0, TimeSpan.Zero));        // Sat 10 Oct 10:30 AEDT: Friday has passed
        await using var after = env.AdminDb();
        var lapsed = await after.LeaveRequests.SingleAsync(l => l.Id == emilyW1);
        Assert.Equal(LeaveStatus.Cancelled, lapsed.Status);
        Assert.NotNull(lapsed.DecidedAt);
        Assert.False(string.IsNullOrWhiteSpace(lapsed.DecisionNote));
        Assert.Equal(LeaveStatus.Pending, (await after.LeaveRequests.SingleAsync(l => l.Id == emilyW2)).Status);   // next week's is still waiting for a decision
        Assert.Equal(LeaveStatus.Approved, (await after.LeaveRequests.SingleAsync(l => l.Id == Leave("priya-annual", W1))).Status);   // approved leave is never touched
        var rule = await after.RecurringUnavailabilities.SingleAsync(r => r.Id == DemoIds.For("recurring", "emily-pending", W1));
        Assert.Equal(LeaveStatus.Cancelled, rule.Status);
    }

    [Fact]
    public async Task ThePendingQueueIsReplenished_WhenWeeksPass()
    {
        var env = await RunAsync();

        await TickAtAsync(env, new DateTimeOffset(2026, 10, 15, 0, 30, 0, TimeSpan.Zero));        // Thu 15 Oct
        await using var db = env.AdminDb();
        var pending = await db.LeaveRequests.Where(l => l.Status == LeaveStatus.Pending).ToListAsync();

        Assert.True(pending.Count >= 3, $"only {pending.Count} pending requests a fortnight on");
        Assert.All(pending, l => Assert.True(l.StartDate > new DateOnly(2026, 10, 15)));
    }

    [Fact]
    public async Task ACoverageTask_IsCompleted_OnceItsShiftHasBeenWorked()
    {
        var env = await RunAsync();
        var w1Task = $"leave-coverage:{Story("on-leave", W1)}:{Leave("priya-annual", W1)}";
        var w2Task = $"leave-coverage:{Story("on-leave", W2)}:{Leave("priya-annual", W2)}";

        await TickAtAsync(env, new DateTimeOffset(2026, 10, 10, 23, 30, 0, TimeSpan.Zero));       // Sun 11 Oct 10:30 AEDT: Thursday 8 Oct was worked
        await using var db = env.AdminDb();
        var done = await db.BookingTasks.SingleAsync(t => t.SourceKey == w1Task);
        Assert.Equal(TaskItemStatus.Completed, done.Status);
        Assert.Equal(new DateOnly(2026, 10, 11), done.CompletedDate);                              // the provider's date, not the UTC date
        Assert.NotNull(done.AutoCompletedAt);
        Assert.Equal(TaskItemStatus.NotStarted, (await db.BookingTasks.SingleAsync(t => t.SourceKey == w2Task)).Status);
    }

    [Fact]
    public async Task AdayLater_ShiftsThatHaveJustBeenWorkedAreClosedOut_AndOldReviewsAreApproved()
    {
        var env = await RunAsync();

        await TickAtAsync(env, new DateTimeOffset(2026, 10, 5, 2, 0, 0, TimeSpan.Zero));          // Mon 5 Oct 13:00 AEDT
        await using var db = env.AdminDb();
        var shifts = await db.Shifts.Where(s => s.UserId != null).ToListAsync();
        var completions = (await db.ShiftCompletions.ToListAsync()).ToDictionary(c => c.ShiftId);
        Assert.DoesNotContain(shifts, s => s.Status == ShiftStatus.Published && s.ServiceDate < new DateOnly(2026, 10, 5));
        foreach (var shift in shifts.Where(s => s.Status is ShiftStatus.PendingReview or ShiftStatus.Completed))
        {
            Assert.True(completions.ContainsKey(shift.Id));
            var daysAgo = new DateOnly(2026, 10, 5).DayNumber - shift.ServiceDate.DayNumber;
            Assert.Equal(daysAgo >= 3 ? ShiftStatus.Completed : ShiftStatus.PendingReview, shift.Status);
            Assert.Equal(shift.Status == ShiftStatus.Completed, completions[shift.Id].ReviewOutcome == ReviewOutcome.Approved);
        }
        // Wed 30 Sep was PendingReview on Friday 2 Oct (2 days ago); by Monday 5 Oct it is 5 days ago and has been approved.
        var wednesday = shifts.First(s => s.ServiceDate == new DateOnly(2026, 9, 30) && s.ShiftPatternId != null);
        Assert.Equal(ShiftStatus.Completed, wednesday.Status);
        Assert.Equal(DemoFixture.StaffId("sarah"), completions[wednesday.Id].ReviewedByUserId);
    }

    [Fact]
    public async Task ATransition_NeverMovesARowSomeoneElseAlreadyMoved()
    {
        var env = await RunAsync();
        Guid victim;
        await using (var db = env.AdminDb())
        {
            // The owner cancels a Published shift by hand; it must stay Cancelled, whatever the clock says.
            var shift = await db.Shifts.Where(s => s.ShiftPatternId != null && s.Status == ShiftStatus.Published).OrderBy(s => s.ServiceDate).FirstAsync();
            shift.Status = ShiftStatus.Cancelled;
            victim = shift.Id;
            await db.SaveChangesAsync();
        }

        await TickAtAsync(env, new DateTimeOffset(2026, 10, 20, 0, 30, 0, TimeSpan.Zero));

        await using var check = env.AdminDb();
        Assert.Equal(ShiftStatus.Cancelled, (await check.Shifts.SingleAsync(s => s.Id == victim)).Status);
        Assert.False(await check.ShiftCompletions.AnyAsync(c => c.ShiftId == victim));
    }
}
