using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Tasks;

namespace Odip.Infrastructure.DemoData.Packs;

/// <summary>
/// The LeaveCoverage obligation tasks (plan 2.7 and 7). When a coordinator approves leave, the app raises one task per Published shift the
/// leave leaves uncovered, keyed <c>leave-coverage:{shiftId}:{leaveId}</c> (LeaveController.RaiseLeaveCoverageTasksAsync). Priya's approved
/// leave in each pack week covers her Thursday shift, so this raises the same task, with the same key, title, due date, link and priority,
/// through <see cref="ObligationTaskService"/> itself. Tasks that already exist are never touched (the service would refresh an open one's
/// title and due date; that is the owner's row now).
///
/// When the shift has been worked (closed out), the obligation is met: its task is completed the way the app completes an obligation task
/// (<see cref="ObligationTaskService.CompleteAsync"/>: Completed, the provider's date, an auto-completed stamp). Without that, one overdue
/// task would pile up every week.
/// </summary>
public sealed class LeaveCoverageTasksPack : IDemoPack
{
    public string Name => "leave-coverage-tasks";

    public async Task RunAsync(DemoRun run, CancellationToken ct)
    {
        var anchors = run.Anchors;
        var leaveIds = RosterCatalog.PackWeeksEverCreated(anchors).Select(w => DemoIds.For("leave", "priya-annual", w)).ToHashSet();

        // Leave still ahead (a handful: the database filters on the date) is what needs tasks raised; the ids of every week since the top-up
        // began are matched in memory.
        var current = (await DemoQueries.ApprovedLeaveNotYetOver(run.Db, anchors.D0).ToListAsync(ct))
            .Where(l => leaveIds.Contains(l.Id)).ToList();

        var service = new ObligationTaskService(run.Db, run.Clock);
        var raised = await RaiseAsync(run, service, current, ct);
        var completed = await CompleteWorkedAsync(run, service, leaveIds, ct);

        if (raised + completed == 0) return;
        await run.SaveAsync(ct);
        run.Added("leave coverage tasks", raised);
        run.Changed("leave coverage tasks completed", completed);
    }

    private static async Task<int> RaiseAsync(DemoRun run, IObligationTaskService service, List<LeaveRequest> leaves, CancellationToken ct)
    {
        if (leaves.Count == 0) return 0;

        var userIds = leaves.Select(l => l.UserId).Distinct().ToList();
        var firstDay = leaves.Min(l => l.StartDate);
        var shifts = await DemoQueries.PublishedShiftsOf(run.Db, userIds, firstDay).ToListAsync(ct);

        var wanted = new List<(Shift Shift, LeaveRequest Leave, string Key)>();
        foreach (var leave in leaves)
        {
            foreach (var shift in shifts.Where(s => s.UserId == leave.UserId && s.ServiceDate >= leave.StartDate && s.ServiceDate <= leave.EndDate))
                wanted.Add((shift, leave, $"leave-coverage:{shift.Id}:{leave.Id}"));
        }
        if (wanted.Count == 0) return 0;

        var keys = wanted.Select(w => w.Key).ToList();
        var existing = (await DemoQueries.ExistingTaskKeys(run.Db, keys).ToListAsync(ct)).ToHashSet();

        var count = 0;
        foreach (var (shift, leave, key) in wanted.Where(w => !existing.Contains(w.Key)))
        {
            var staff = run.Directory.AllUsers.FirstOrDefault(u => u.Id == leave.UserId);
            var staffName = staff is null ? "A staff member" : $"{staff.FirstName} {staff.LastName}";
            var participantName = shift.Participant?.FullName ?? "a participant";
            var date = shift.ServiceDate;
            await service.EnsureAsync(new ObligationTaskSpec(
                SourceKey: key,
                Type: TaskType.LeaveCoverage,
                Title: $"Re-cover shift for {participantName} on {date.ToString("ddd d MMM", CultureInfo.InvariantCulture)} — {staffName} is on leave",
                DueDate: date,
                LinkTo: $"/rostering?date={date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}",
                ShiftId: shift.Id,
                LeaveRequestId: leave.Id,
                Priority: TaskPriority.High), ct);
            count++;
        }
        return count;
    }

    private static async Task<int> CompleteWorkedAsync(DemoRun run, IObligationTaskService service, HashSet<Guid> leaveIds, CancellationToken ct)
    {
        var openTasks = await DemoQueries.OpenCoverageTasks(run.Db).ToListAsync(ct);
        var open = openTasks.Where(t => leaveIds.Contains(t.LeaveRequestId!.Value)).ToList();
        if (open.Count == 0) return 0;

        var shiftIds = open.Select(t => t.ShiftId!.Value).Distinct().ToList();
        var worked = (await DemoQueries.WorkedShiftIds(run.Db, shiftIds).ToListAsync(ct)).ToHashSet();

        var count = 0;
        foreach (var task in open.Where(t => worked.Contains(t.ShiftId!.Value)))
        {
            await service.CompleteAsync(task.SourceKey!, ct);
            count++;
        }
        return count;
    }
}
