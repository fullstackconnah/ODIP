using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// Staff leave, recurring unavailability and legacy availability (plan 2.7), shaped so that the only roster findings they cause are the
/// designed ones:
///  - Each week pack (next week and the week after, keyed by the week's Monday) carries the rows its stories need: Priya's approved annual
///    leave Wed to Fri (check 6), Emily's pending personal leave Fri to Sat (check 8) and a pending recurring Tuesday-morning rule (check
///    9), Daniel's whole-Friday "Unavailable" legacy row (check 5), and Brendan's pending annual leave Fri to Sun (a second pending
///    request, on days he is not rostered). Pending requests are always for dates still ahead, so the approvals queue is replenished as
///    weeks pass, and one whose start has passed undecided is cancelled (<see cref="MoveForwardAsync"/>).
///  - Static rows are created once, on the first run, and dated from it: the recurring rules (Daniel's Wednesday study night, Marcus's
///    Thursday early morning, Lachlan's declined Friday request), decided leave in the past (so every status and type is on the screen),
///    and legacy rows that never block rostering (Preferred, Tentative, Available) or that lie in the past (Training, Leave). None of them
///    can overlap a rostered day in any pack week, so none adds a finding.
/// Legacy availability bounds are written the way the availability editor writes them: a date at 00:00:00 to a date at 23:59:59, wall clock.
/// Instants (requested, decided) are provider-local times converted once, and never in the future.
/// </summary>
public sealed class LeaveAndAvailabilityPack : IDemoPack
{
    public string Name => "leave-and-availability";

    private const string LapsedNote = "Cancelled automatically: the start date passed with no decision.";

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var leave = new List<LeaveRequest>();
        var rules = new List<RecurringUnavailability>();
        var availability = new List<StaffAvailability>();

        foreach (var week in RosterCatalog.PackWeeks(run.Anchors))
            BuildWeek(run, week, leave, rules, availability);
        BuildStatic(run, leave, rules, availability);

        var existingLeave = await run.ExistingIdsAsync<LeaveRequest>(leave.Select(l => l.Id), ct);
        var existingRules = await run.ExistingIdsAsync<RecurringUnavailability>(rules.Select(r => r.Id), ct);
        var existingAvailability = await run.ExistingIdsAsync<StaffAvailability>(availability.Select(a => a.Id), ct);
        var newLeave = leave.Where(l => !existingLeave.Contains(l.Id)).ToList();
        var newRules = rules.Where(r => !existingRules.Contains(r.Id)).ToList();
        var newAvailability = availability.Where(a => !existingAvailability.Contains(a.Id)).ToList();

        // The app holds a leave request to (staff member, type, first day, last day), and a recurring rule to (staff member, day, times, effective from and to), among those not
        // cancelled or declined: a second identical request is a 409 ("An identical request already exists."), from the coordinator's form, the staff portal and an approval's edit
        // alike. A request a person made first holds the key, and the top-up writes none beside it (PR 1 audit); one that is itself cancelled or declined is outside the key and is
        // written as ever. The legacy availability rows have no such rule.
        newLeave = await WithoutHeldLeaveAsync(run, newLeave, ct);
        newRules = await WithoutHeldRulesAsync(run, newRules, ct);

        if (newLeave.Count + newRules.Count + newAvailability.Count > 0)
        {
            run.Db.LeaveRequests.AddRange(newLeave);
            run.Db.RecurringUnavailabilities.AddRange(newRules);
            run.Db.StaffAvailabilities.AddRange(newAvailability);
            await run.SaveAsync(ct);
            run.Added("leave requests", newLeave.Count);
            run.Added("recurring unavailability rules", newRules.Count);
            run.Added("availability records", newAvailability.Count);
        }

        await MoveForwardAsync(run, ct);
    }

    private static async Task<List<LeaveRequest>> WithoutHeldLeaveAsync(DemoRun run, List<LeaveRequest> rows, CancellationToken ct)
    {
        var inTheKey = rows.Where(l => l.Status != LeaveStatus.Cancelled && l.Status != LeaveStatus.Declined).ToList();
        if (inTheKey.Count == 0) return rows;

        var held = (await DemoQueries.ActiveLeaveKeysOf(run.Db, inTheKey.Select(l => l.UserId).Distinct().ToList()).ToListAsync(ct)).ToHashSet();
        return rows.Where(l => !inTheKey.Contains(l) || !held.Contains(new DemoQueries.LeaveKey(l.UserId, l.LeaveType, l.StartDate, l.EndDate))).ToList();
    }

    private static async Task<List<RecurringUnavailability>> WithoutHeldRulesAsync(DemoRun run, List<RecurringUnavailability> rows, CancellationToken ct)
    {
        var inTheKey = rows.Where(r => r.Status != LeaveStatus.Cancelled && r.Status != LeaveStatus.Declined).ToList();
        if (inTheKey.Count == 0) return rows;

        var held = (await DemoQueries.ActiveRuleKeysOf(run.Db, inTheKey.Select(r => r.UserId).Distinct().ToList()).ToListAsync(ct)).ToHashSet();
        return rows.Where(r => !inTheKey.Contains(r) || !held.Contains(new DemoQueries.RuleKey(r.UserId, r.DayOfWeek, r.StartTime, r.EndTime, r.EffectiveFrom, r.EffectiveTo))).ToList();
    }

    // ── the rows ─────────────────────────────────────────────────────────────

    private static void BuildWeek(DemoRun run, DateOnly week, List<LeaveRequest> leave, List<RecurringUnavailability> rules, List<StaffAvailability> availability)
    {
        var a = run.Anchors;
        var yesterday = a.D0.AddDays(-1);

        var priya = run.Directory.Staff("priya");
        var rachel = run.Directory.Staff("rachel");
        if (priya is not null)
        {
            leave.Add(Leave(run, DemoIds.For("leave", "priya-annual", week), priya, LeaveType.Annual, week.AddDays(2), week.AddDays(4), LeaveStatus.Approved,
                "Family trip.", At(a, week.AddDays(-21), 9, 10), decidedBy: rachel, decidedAt: At(a, week.AddDays(-19), 14, 20)));
        }
        else run.Skipped($"leave for week {Day(week)}: Priya annual", "Priya Sharma missing");

        var emily = run.Directory.Staff("emily");
        if (emily is not null)
        {
            var requested = At(a, Min(week.AddDays(-3), yesterday), 8, 45);
            leave.Add(Leave(run, DemoIds.For("leave", "emily-personal", week), emily, LeaveType.Personal, week.AddDays(4), week.AddDays(5), LeaveStatus.Pending,
                "Appointment on Friday and a recovery day.", requested));
            rules.Add(Recurring(run, DemoIds.For("recurring", "emily-pending", week), emily, DayOfWeek.Tuesday, new TimeOnly(6, 0), new TimeOnly(9, 0), week, week.AddDays(6),
                LeaveStatus.Pending, "Early-morning commitment on Tuesdays for the next few weeks.", requested));
        }
        else run.Skipped($"leave for week {Day(week)}: Emily", "Emily Nguyen missing");

        var brendan = run.Directory.Staff("brendan");
        if (brendan is not null)
        {
            leave.Add(Leave(run, DemoIds.For("leave", "brendan-annual", week), brendan, LeaveType.Annual, week.AddDays(4), week.AddDays(6), LeaveStatus.Pending,
                "Long weekend away.", At(a, Min(week.AddDays(-6), a.D0.AddDays(-2)), 17, 30)));
        }
        else run.Skipped($"leave for week {Day(week)}: Brendan", "Brendan Nguyen missing");

        var daniel = run.Directory.Staff("daniel");
        if (daniel is not null)
        {
            availability.Add(Availability(run, DemoIds.For("availability", "daniel-unavailable", week), daniel, AvailabilityType.Unavailable, week.AddDays(4), week.AddDays(4), "Medical appointment"));
        }
        else run.Skipped($"availability for week {Day(week)}: Daniel", "Daniel Williams missing");
    }

    private static void BuildStatic(DemoRun run, List<LeaveRequest> leave, List<RecurringUnavailability> rules, List<StaffAvailability> availability)
    {
        var a = run.Anchors;
        var d0 = a.D0;
        var rachel = run.Directory.Staff("rachel");
        User? S(string key) => run.Directory.Staff(key);

        // Decided leave, all in the past (before the roster window opens), so each status and type is on the screen without touching a rostered day.
        if (S("james") is { } james)
            leave.Add(Leave(run, DemoIds.For("leave", "james-annual"), james, LeaveType.Annual, d0.AddDays(-45), d0.AddDays(-39), LeaveStatus.Approved, "Seven days with family.",
                At(a, d0.AddDays(-60), 9, 0), decidedBy: rachel, decidedAt: At(a, d0.AddDays(-58), 11, 15)));
        if (S("jade") is { } jade)
            leave.Add(Leave(run, DemoIds.For("leave", "jade-annual"), jade, LeaveType.Annual, d0.AddDays(-60), d0.AddDays(-56), LeaveStatus.Approved, "A week away.",
                At(a, d0.AddDays(-80), 9, 30), decidedBy: rachel, decidedAt: At(a, d0.AddDays(-78), 10, 0)));
        if (S("lachlan") is { } lachlan)
            leave.Add(Leave(run, DemoIds.For("leave", "lachlan-other"), lachlan, LeaveType.Other, d0.AddDays(-20), d0.AddDays(-20), LeaveStatus.Approved, "Training course.",
                At(a, d0.AddDays(-35), 8, 40), decidedBy: rachel, decidedAt: At(a, d0.AddDays(-34), 9, 5)));
        if (S("marcus") is { } marcus)
        {
            leave.Add(Leave(run, DemoIds.For("leave", "marcus-sick"), marcus, LeaveType.Sick, d0.AddDays(-33), d0.AddDays(-32), LeaveStatus.Approved, "Gastro.",
                At(a, d0.AddDays(-33), 7, 30), decidedBy: rachel, decidedAt: At(a, d0.AddDays(-33), 10, 0)));

            // Declined, for next week and the one after: a declined request never blocks anything, so it may sit on rostered days.
            var declined = Leave(run, DemoIds.For("leave", "marcus-declined"), marcus, LeaveType.Annual, a.Monday(1), a.Monday(1).AddDays(1), LeaveStatus.Declined, "Two days to catch up on errands.",
                At(a, d0.AddDays(-6), 16, 0), decidedBy: rachel, decidedAt: At(a, d0.AddDays(-4), 9, 45));
            declined.DecisionNote = "Roster minimums not met that week.";
            leave.Add(declined);
        }
        if (S("emily") is { } emily)
        {
            var cancelled = Leave(run, DemoIds.For("leave", "emily-cancelled"), emily, LeaveType.Annual, a.Monday(2), a.Monday(2).AddDays(4), LeaveStatus.Cancelled,
                "A week at the coast (plans changed).", At(a, d0.AddDays(-7), 9, 20), decidedBy: emily, decidedAt: At(a, d0.AddDays(-2), 18, 5));
            leave.Add(cancelled);
        }

        // Recurring rules. Daniel's and Marcus's are in force from a month ago with no end; Marcus's ends before his 08:30 start so it never overlaps a shift.
        if (S("daniel") is { } daniel)
            rules.Add(Recurring(run, DemoIds.For("recurring", "daniel-study"), daniel, DayOfWeek.Wednesday, new TimeOnly(16, 0), new TimeOnly(20, 0), d0.AddDays(-30), null,
                LeaveStatus.Approved, "Study night (evening class).", At(a, d0.AddDays(-45), 9, 0), decidedBy: rachel, decidedAt: At(a, d0.AddDays(-44), 9, 30)));
        if (S("marcus") is { } marcus2)
            rules.Add(Recurring(run, DemoIds.For("recurring", "marcus-thursday"), marcus2, DayOfWeek.Thursday, new TimeOnly(6, 0), new TimeOnly(8, 0), d0.AddDays(-30), null,
                LeaveStatus.Approved, "School drop-off.", At(a, d0.AddDays(-40), 17, 0), decidedBy: rachel, decidedAt: At(a, d0.AddDays(-39), 8, 50)));
        if (S("lachlan") is { } lachlan2)
        {
            var declined = Recurring(run, DemoIds.For("recurring", "lachlan-declined"), lachlan2, DayOfWeek.Friday, new TimeOnly(14, 0), new TimeOnly(18, 0), d0.AddDays(-14), null,
                LeaveStatus.Declined, "Wants Friday afternoons off for a course.", At(a, d0.AddDays(-20), 12, 0), decidedBy: rachel, decidedAt: At(a, d0.AddDays(-18), 9, 0));
            declined.DecisionNote = "Needed for the Friday afternoon roster.";
            rules.Add(declined);
        }

        // Legacy availability: the three types that never block rostering, and two that would, placed where nobody is rostered.
        if (S("emily") is { } emily2)
            availability.Add(Availability(run, DemoIds.For("availability", "emily-training"), emily2, AvailabilityType.Training, d0.AddDays(-20), d0.AddDays(-19), "Manual handling refresher."));
        if (S("priya") is { } priya)
            availability.Add(Availability(run, DemoIds.For("availability", "priya-leave"), priya, AvailabilityType.Leave, a.Monday(-1).AddDays(1), a.Monday(-1).AddDays(1),
                "Annual leave day (recorded before the leave screen existed)."));
        if (S("marcus") is { } marcus3)
            availability.Add(Availability(run, DemoIds.For("availability", "marcus-preferred"), marcus3, AvailabilityType.Preferred, a.Monday(1), a.Monday(2).AddDays(6), "Prefers weekday mornings."));
        if (S("brendan") is { } brendan)
            availability.Add(Availability(run, DemoIds.For("availability", "brendan-tentative"), brendan, AvailabilityType.Tentative, d0.AddDays(5), d0.AddDays(5), "Waiting on a family commitment."));
        if (S("sarah") is { } sarah)
            availability.Add(Availability(run, DemoIds.For("availability", "sarah-available"), sarah, AvailabilityType.Available, d0, d0.AddDays(13), "Available for extra cover."));
    }

    private static LeaveRequest Leave(DemoRun run, Guid id, User user, LeaveType type, DateOnly start, DateOnly end, LeaveStatus status, string reason, DateTime requestedAt,
        User? decidedBy = null, DateTime? decidedAt = null)
    {
        var requested = NotFuture(run, requestedAt);
        var decided = decidedAt is null ? (DateTime?)null : Later(NotFuture(run, decidedAt.Value), requested);
        return new LeaveRequest
        {
            Id = id, TenantId = run.TenantId, UserId = user.Id, LeaveType = type, StartDate = start, EndDate = end, Status = status, Reason = reason,
            RequestedByUserId = user.Id, RequestedAt = requested, DecidedByUserId = decidedBy?.Id, DecidedAt = decided,
            CreatedAt = requested, UpdatedAt = decided ?? requested,
        };
    }

    private static RecurringUnavailability Recurring(DemoRun run, Guid id, User user, DayOfWeek day, TimeOnly start, TimeOnly end, DateOnly from, DateOnly? to, LeaveStatus status,
        string notes, DateTime requestedAt, User? decidedBy = null, DateTime? decidedAt = null)
    {
        var requested = NotFuture(run, requestedAt);
        var decided = decidedAt is null ? (DateTime?)null : Later(NotFuture(run, decidedAt.Value), requested);
        return new RecurringUnavailability
        {
            Id = id, TenantId = run.TenantId, UserId = user.Id, DayOfWeek = day, StartTime = start, EndTime = end, EffectiveFrom = from, EffectiveTo = to, Notes = notes,
            Status = status, RequestedByUserId = user.Id, RequestedAt = requested, DecidedByUserId = decidedBy?.Id, DecidedAt = decided,
            CreatedAt = requested, UpdatedAt = decided ?? requested,
        };
    }

    /// <summary>A legacy availability row, with the bounds the editor writes: first date at 00:00:00 to last date at 23:59:59, zone-less.</summary>
    private static StaffAvailability Availability(DemoRun run, Guid id, User user, AvailabilityType type, DateOnly first, DateOnly last, string notes) => new()
    {
        Id = id, UserId = user.Id,
        StartDateTime = first.ToDateTime(new TimeOnly(0, 0, 0), DateTimeKind.Unspecified),
        EndDateTime = last.ToDateTime(new TimeOnly(23, 59, 59), DateTimeKind.Unspecified),
        AvailabilityType = type, Notes = notes, CreatedAt = run.NowUtc, UpdatedAt = run.NowUtc,
    };

    /// <summary>A provider-local clock time on a date, as the UTC instant it is: the one conversion.</summary>
    private static DateTime At(DemoAnchors anchors, DateOnly date, int hour, int minute) => anchors.LocalToUtc(date, new TimeOnly(hour, minute));

    private static DateOnly Min(DateOnly a, DateOnly b) => a <= b ? a : b;

    private static string Day(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>No request or decision is ever in the future: a story about next month's rows is told from an hour ago.</summary>
    private static DateTime NotFuture(DemoRun run, DateTime instant) => instant <= run.NowUtc.AddHours(-1) ? instant : run.NowUtc.AddHours(-1);

    private static DateTime Later(DateTime decided, DateTime requested) => decided > requested ? decided : requested.AddMinutes(30);

    // ── forward-only moves ───────────────────────────────────────────────────

    /// <summary>
    /// A request nobody decided before its start date is cancelled: leave whose first day is before today, a recurring rule whose first
    /// effective day is before today. Only rows of this top-up (found by their ids) and only while still Pending; a request the owner has
    /// decided, edited into the future or cancelled is not touched.
    /// </summary>
    private static async Task MoveForwardAsync(DemoRun run, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var weeks = RosterCatalog.PackWeeksEverCreated(anchors).ToList();
        var leaveIds = weeks.SelectMany(w => new[] { DemoIds.For("leave", "emily-personal", w), DemoIds.For("leave", "brendan-annual", w) }).ToHashSet();
        var ruleIds = weeks.Select(w => DemoIds.For("recurring", "emily-pending", w)).ToHashSet();

        // The database returns the few requests still Pending whose start date has gone; the id sets (one pair per week since the top-up began)
        // are matched in memory, so a host that was switched off for months still catches up.
        var lapsedLeave = (await DemoQueries.LapsedLeave(run.Db, anchors.D0).ToListAsync(ct))
            .Where(l => leaveIds.Contains(l.Id)).ToList();
        var lapsedRules = (await DemoQueries.LapsedRules(run.Db, anchors.D0).ToListAsync(ct))
            .Where(r => ruleIds.Contains(r.Id)).ToList();
        if (lapsedLeave.Count + lapsedRules.Count == 0) return;

        foreach (var l in lapsedLeave)
        {
            l.Status = LeaveStatus.Cancelled;
            l.DecidedAt = anchors.NowUtc;
            l.DecisionNote = LapsedNote;
            l.UpdatedAt = anchors.NowUtc;
        }
        foreach (var r in lapsedRules)
        {
            r.Status = LeaveStatus.Cancelled;
            r.DecidedAt = anchors.NowUtc;
            r.DecisionNote = LapsedNote;
            r.UpdatedAt = anchors.NowUtc;
        }
        await run.SaveAsync(ct);
        run.Changed("lapsed pending requests", lapsedLeave.Count + lapsedRules.Count);
    }
}
