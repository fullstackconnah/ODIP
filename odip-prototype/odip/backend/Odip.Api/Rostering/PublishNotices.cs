using Microsoft.EntityFrameworkCore;
using Odip.Application.Interfaces;
using Odip.Domain.Notifications;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Notifications.Templates;

namespace Odip.Api.Rostering;

/// <summary>One line of a worker's publish notice: a shift (name is the participant) or a group activity part (name is the activity title).</summary>
public sealed record PublishNoticeLine(Guid UserId, string EntityType, Guid EntityId, string Name, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime);

/// <summary>
/// The one place a publish tells workers (Publish week and a group activity's own Publish): one ShiftAssigned notice per worker listing every line, earliest first.
/// </summary>
public static class PublishNotices
{
    /// <summary>
    /// The staff lines of activities a publish just moved Draft to Published: dated on or after <paramref name="today"/>, one per worker row, active users only. A worker whose screening has lapsed,
    /// who starts after the day or is marked No for an attached participant is not told, but the activity still goes out (holding it would strand its participants).
    /// </summary>
    public static async Task<List<PublishNoticeLine>> ActivityLinesAsync(OdipDbContext db, Guid tenantId, IReadOnlyCollection<GroupActivity> activities, DateOnly today, CancellationToken ct)
    {
        var due = activities.Where(a => a.ServiceDate >= today && a.Status == ShiftStatus.Published).ToDictionary(a => a.Id);
        if (due.Count == 0) return [];
        var ids = due.Keys.ToList();
        var rows = await db.GroupActivityStaff.AsNoTracking().Where(r => r.TenantId == tenantId && ids.Contains(r.GroupActivityId)).ToListAsync(ct);
        var userIds = rows.Select(r => r.UserId).Distinct().ToList();
        var users = await db.Users.AsNoTracking().Where(u => u.TenantId == tenantId && userIds.Contains(u.Id) && u.IsActive)
            .ToDictionaryAsync(u => u.Id, u => (Expiry: u.WorkerScreeningExpiryDate, Start: u.EmploymentStartDate), ct);
        var attendees = await db.Shifts.AsNoTracking().Where(s => s.TenantId == tenantId && s.GroupActivityId != null && ids.Contains(s.GroupActivityId.Value))
            .Select(s => new { ActivityId = s.GroupActivityId!.Value, s.ParticipantId }).ToListAsync(ct);
        var excluded = (await db.StaffParticipantCompatibilities.AsNoTracking().Where(c => c.Level == CompatibilityLevel.Excluded && userIds.Contains(c.UserId)).Select(c => new { c.UserId, c.ParticipantId }).ToListAsync(ct))
            .Select(c => (c.UserId, c.ParticipantId)).ToHashSet();
        return rows
            .Where(r => users.TryGetValue(r.UserId, out var u)
                && !(u.Expiry < due[r.GroupActivityId].ServiceDate || u.Start > due[r.GroupActivityId].ServiceDate)
                && !attendees.Any(a => a.ActivityId == r.GroupActivityId && excluded.Contains((r.UserId, a.ParticipantId))))
            .Select(r => new PublishNoticeLine(r.UserId, "GroupActivity", r.GroupActivityId, due[r.GroupActivityId].Title, due[r.GroupActivityId].ServiceDate, r.StartTime, r.EndTime))
            .ToList();
    }

    /// <summary>Raises one notice per worker (no dedupe: a publish only moves Drafts, so a repeat finds nothing to tell). Returns the workers told.</summary>
    public static async Task<int> RaiseAsync(OdipDbContext db, INotificationRaiser raiser, IEnumerable<PublishNoticeLine> lines, CancellationToken ct)
    {
        var byWorker = lines.GroupBy(l => l.UserId).ToList();
        var workerIds = byWorker.Select(g => g.Key).ToList();
        var emails = await db.Users.Where(u => workerIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id, u => u.Email, ct);
        var told = 0;
        foreach (var worker in byWorker)
        {
            if (!emails.TryGetValue(worker.Key, out var email)) continue;
            var ordered = worker.OrderBy(l => l.ServiceDate).ThenBy(l => l.StartTime).ToList();
            var first = ordered[0];
            // The notice hangs off the first shift when there is one, else the first activity.
            var anchor = ordered.FirstOrDefault(l => l.EntityType == "Shift") ?? first;
            await raiser.RaiseAsync(NotificationEventType.ShiftAssigned, anchor.EntityType, anchor.EntityId, new[] { worker.Key },
                new ShiftAssignedPayload(email, first.Name, first.ServiceDate, first.StartTime, first.EndTime,
                    ordered.Skip(1).Select(l => new ShiftAssignedLine(l.Name, l.ServiceDate, l.StartTime, l.EndTime, l.EntityType == "GroupActivity")).ToList(), first.EntityType == "GroupActivity"), ct, dedupe: false);
            told++;
        }
        return told;
    }
}
