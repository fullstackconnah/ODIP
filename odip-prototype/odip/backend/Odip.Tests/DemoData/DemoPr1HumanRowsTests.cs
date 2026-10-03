using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.DemoData;
using Xunit;
using static Odip.Tests.DemoData.DemoLive;

namespace Odip.Tests.DemoData;

/// <summary>
/// The audit of PR 1's packs for the shape of PR 2's finding H1, which PR 1's packs, live in production, can share: a pack decides "is my row already there?" by its own
/// deterministic id on a table the app holds to a natural key (a unique index, or a rule its controllers enforce), and a person can make a row for that key first. Each test
/// here makes the person's row, with a random id as the app makes it, before the top-up writes its own, and asks what the table holds afterwards. The tables the audit found
/// guarded already (the compatibility matrix, the emergency contacts, the provider settings) have their tests in DemoStaticPacksTests; the leave requests and the recurring
/// rules were not, and these tests were red for them.
/// </summary>
public class DemoPr1HumanRowsTests
{
    private static readonly DateTimeOffset FirstRun = DateTimeOffset.Parse("2026-10-02T00:30:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);       // Fri 10:30

    private static readonly DateOnly NextMonday = new(2026, 10, 5);

    private static DateTime LocalToUtc(DateTime local) => ProviderLocalTime.LocalToUtc(local, Zone());

    private static async Task<DemoTestEnv> EnvBeforeTheFirstTickAsync()
    {
        var env = new DemoTestEnv(FirstRun);
        await DemoFixture.SeedPeopleAsync(env);
        await env.SetProviderStateAsync("NSW");
        return env;
    }

    // ── leave requests: one request per (staff member, type, first day, last day) among those not cancelled or declined ──

    [Theory]
    [InlineData(LeaveStatus.Pending, true)]
    [InlineData(LeaveStatus.Approved, true)]
    [InlineData(LeaveStatus.Declined, false)]
    [InlineData(LeaveStatus.Cancelled, false)]
    public async Task APriyaAnnualLeaveRequestAPersonMadeFirst_HoldsTheKeyUnlessItIsCancelledOrDeclined(LeaveStatus status, bool holdsTheKey)
    {
        var env = await EnvBeforeTheFirstTickAsync();
        var priya = DemoFixture.StaffId("priya");
        var start = NextMonday.AddDays(2);                                                           // Wed to Fri of next week: the dates the top-up gives her annual leave
        var end = NextMonday.AddDays(4);
        var requested = LocalToUtc(At(new DateOnly(2026, 10, 1), 9, 0));
        Guid theirs;
        await using (var db = env.AdminDb())
        {
            var row = new LeaveRequest
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, UserId = priya, LeaveType = LeaveType.Annual, StartDate = start, EndDate = end, Status = status,
                Reason = "Entered by the presenter.", RequestedByUserId = priya, RequestedAt = requested, CreatedAt = requested, UpdatedAt = requested,
            };
            theirs = row.Id;
            db.LeaveRequests.Add(row);
            await db.SaveChangesAsync();
        }

        await RunAsync(env, FirstRun);

        await using var check = env.AdminDb();
        var sameKey = await check.LeaveRequests.Where(l => l.UserId == priya && l.LeaveType == LeaveType.Annual && l.StartDate == start && l.EndDate == end).ToListAsync();
        var inTheKey = sameKey.Where(l => l.Status != LeaveStatus.Cancelled && l.Status != LeaveStatus.Declined).ToList();
        if (holdsTheKey)
            Assert.Equal(theirs, Assert.Single(inTheKey).Id);                                         // the app would have refused a second identical request: 409
        else
            Assert.Equal(DemoIds.For("leave", "priya-annual", NextMonday), Assert.Single(inTheKey).Id);   // theirs is outside the key, and the top-up's story row is written as ever
        Assert.Equal(holdsTheKey ? 1 : 2, sameKey.Count);

        // The rest of the story is written as ever: the same week's other requests, and the following week's.
        Assert.True(await check.LeaveRequests.AnyAsync(l => l.Id == DemoIds.For("leave", "emily-personal", NextMonday)));
        Assert.True(await check.LeaveRequests.AnyAsync(l => l.Id == DemoIds.For("leave", "priya-annual", NextMonday.AddDays(7))));
    }

    [Fact]
    public async Task APendingRequestAPersonMade_IdenticalToTheTopUpsDeclinedOne_DoesNotStopItBeingWritten()
    {
        var env = await EnvBeforeTheFirstTickAsync();
        var marcus = DemoFixture.StaffId("marcus");
        var requested = LocalToUtc(At(new DateOnly(2026, 10, 1), 9, 0));
        await using (var db = env.AdminDb())                                                         // the dates of Marcus's declined request: next Monday and Tuesday
        {
            db.LeaveRequests.Add(new LeaveRequest
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, UserId = marcus, LeaveType = LeaveType.Annual, StartDate = NextMonday, EndDate = NextMonday.AddDays(1),
                Status = LeaveStatus.Pending, Reason = "Entered by the presenter.", RequestedByUserId = marcus, RequestedAt = requested, CreatedAt = requested, UpdatedAt = requested,
            });
            await db.SaveChangesAsync();
        }

        await RunAsync(env, FirstRun);

        await using var check = env.AdminDb();
        var declined = await check.LeaveRequests.SingleAsync(l => l.Id == DemoIds.For("leave", "marcus-declined"));       // outside the key: it holds nothing, and nothing holds it back
        Assert.Equal(LeaveStatus.Declined, declined.Status);
        Assert.Equal(2, await check.LeaveRequests.CountAsync(l => l.UserId == marcus && l.StartDate == NextMonday && l.EndDate == NextMonday.AddDays(1)));
    }

    // ── recurring rules: one rule per (staff member, day, times, effective from, effective to) among those not cancelled or declined ──

    [Theory]
    [InlineData(LeaveStatus.Pending, true)]
    [InlineData(LeaveStatus.Approved, true)]
    [InlineData(LeaveStatus.Declined, false)]
    [InlineData(LeaveStatus.Cancelled, false)]
    public async Task AnEmilyTuesdayRuleAPersonMadeFirst_HoldsTheKeyUnlessItIsCancelledOrDeclined(LeaveStatus status, bool holdsTheKey)
    {
        var env = await EnvBeforeTheFirstTickAsync();
        var emily = DemoFixture.StaffId("emily");
        var from = NextMonday;                                                                       // the week's rule: its Monday to its Sunday, Tuesdays 06:00 to 09:00
        var to = NextMonday.AddDays(6);
        var requested = LocalToUtc(At(new DateOnly(2026, 10, 1), 9, 0));
        Guid theirs;
        await using (var db = env.AdminDb())
        {
            var row = new RecurringUnavailability
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, UserId = emily, DayOfWeek = DayOfWeek.Tuesday, StartTime = new TimeOnly(6, 0), EndTime = new TimeOnly(9, 0),
                EffectiveFrom = from, EffectiveTo = to, Notes = "Entered by the presenter.", Status = status, RequestedByUserId = emily, RequestedAt = requested,
                CreatedAt = requested, UpdatedAt = requested,
            };
            theirs = row.Id;
            db.RecurringUnavailabilities.Add(row);
            await db.SaveChangesAsync();
        }

        await RunAsync(env, FirstRun);

        await using var check = env.AdminDb();
        var sameKey = await check.RecurringUnavailabilities.Where(r => r.UserId == emily && r.DayOfWeek == DayOfWeek.Tuesday && r.StartTime == new TimeOnly(6, 0)
                                                                        && r.EndTime == new TimeOnly(9, 0) && r.EffectiveFrom == from && r.EffectiveTo == to).ToListAsync();
        var inTheKey = sameKey.Where(r => r.Status != LeaveStatus.Cancelled && r.Status != LeaveStatus.Declined).ToList();
        if (holdsTheKey)
            Assert.Equal(theirs, Assert.Single(inTheKey).Id);
        else
            Assert.Equal(DemoIds.For("recurring", "emily-pending", NextMonday), Assert.Single(inTheKey).Id);
        Assert.Equal(holdsTheKey ? 1 : 2, sameKey.Count);
        Assert.True(await check.RecurringUnavailabilities.AnyAsync(r => r.Id == DemoIds.For("recurring", "emily-pending", NextMonday.AddDays(7))));
    }

    // ── shift completions: one active completion per shift ──

    [Theory]
    [InlineData("started")]                                                                          // a presenter started the shift in the portal: InProgress, their completion active
    [InlineData("returned")]                                                                         // a coordinator returned it: Published again, their completion inactive, one return counted
    [InlineData("published-with-an-active-one")]                                                     // the same key held by a completion of theirs on a Published shift (the app does not leave that state)
    public async Task ARosterShiftWithACompletionAPersonMade_IsNotClosedOutByTheTopUp_AndTheDayRollRunsClean(string how)
    {
        var env = await TickAsync(FirstRun);                                                         // Fri 10:30: Monday's 09:00 to 13:00 shift of Priya's (Thomas's pattern) is Published, ahead
        var pattern = DemoIds.For("shift-pattern", "priya-thomas-mon");
        var shiftId = DemoIds.For("shift", "pattern", pattern, NextMonday);
        Guid theirs;
        await using (var db = env.AdminDb())
        {
            var shift = await db.Shifts.SingleAsync(s => s.Id == shiftId);
            Assert.Equal(ShiftStatus.Published, shift.Status);
            var started = LocalToUtc(At(NextMonday, 9, 4));
            var completion = new ShiftCompletion
            {
                Id = Guid.NewGuid(), TenantId = DemoTestEnv.DemoTenantId, ShiftId = shiftId, ActualStart = started, TimeZoneId = Zone().Id, SubmittedByUserId = shift.UserId!.Value,
                StartedAt = started, IsActive = how != "returned", CreatedAt = started, UpdatedAt = started,
            };
            theirs = completion.Id;
            db.ShiftCompletions.Add(completion);
            if (how == "started") shift.Status = ShiftStatus.InProgress;
            if (how == "returned") shift.ReturnCount = 1;
            await db.SaveChangesAsync();
        }

        await RunAsync(env, DateTimeOffset.Parse("2026-10-05T03:00:00Z", CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal));    // Mon 5 Oct 14:00: the shift ended an hour ago

        await using var check = env.AdminDb();
        var completions = await check.ShiftCompletions.Where(c => c.ShiftId == shiftId).ToListAsync();
        Assert.Equal(theirs, Assert.Single(completions).Id);                                         // the top-up wrote none beside theirs
        Assert.Equal(how == "started" ? ShiftStatus.InProgress : ShiftStatus.Published, (await check.Shifts.SingleAsync(s => s.Id == shiftId)).Status);
        Assert.Null(completions[0].SubmittedAt);
    }

    // ── obligation tasks: one task per source key ──

    [Fact]
    public async Task ACoverageTaskAPersonsActionRaised_ForAKeyTheTopUpWouldRaise_IsKept_AndNoSecondTaskIsWritten()
    {
        var env = await TickAsync(FirstRun);                                                         // the top-up raises the coverage tasks of Priya's approved leave
        List<string> keys;
        await using (var db = env.AdminDb())
        {
            var tasks = await db.BookingTasks.Where(t => t.SourceKey != null && t.SourceKey.StartsWith("leave-coverage:")).ToListAsync();
            Assert.NotEmpty(tasks);
            keys = tasks.Select(t => t.SourceKey!).OrderBy(k => k, StringComparer.Ordinal).ToList();
            foreach (var task in tasks)                                                              // the same task as the app's own approval makes it: a random id, the same key
            {
                var theirs = (BookingTask)db.Entry(task).CurrentValues.ToObject();
                theirs.Id = Guid.NewGuid();
                db.BookingTasks.Remove(task);
                db.BookingTasks.Add(theirs);
            }
            await db.SaveChangesAsync();
        }

        await RunAsync(env, FirstRun.AddHours(1));                                                   // a later tick

        await using var check = env.AdminDb();
        var now = await check.BookingTasks.Where(t => t.SourceKey != null && t.SourceKey.StartsWith("leave-coverage:")).ToListAsync();
        Assert.Equal(keys, now.Select(t => t.SourceKey!).OrderBy(k => k, StringComparer.Ordinal).ToList());      // one task per key, none added beside the person's
    }
}
