using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Infrastructure.Rostering;

/// <summary>One shift on a group activity, as the headcount reads it.</summary>
public sealed record GroupSeat(Guid GroupActivityId, Guid ParticipantId, SupportRatio Ratio, ShiftStatus Status, DateOnly ServiceDate, DateTime? CancelledAt);

/// <summary>
/// How many people each worker of a group activity supports: the divisor a group claim never goes below. A group's claim lines must not add up to more than its workers x the rate, so N is the larger of the
/// quoted N and ceil(people in the group / workers). People in the group are those on a group ratio (1:2 to 1:5, shared support) whose shift is not cancelled, or was cancelled at short notice (the same rule
/// as <c>NotClaimableCancellation</c>), so a didn't-attend mark and its cancellation claim share one count. The people and the staff rows are read under the tenant explicitly: the count decides money.
/// </summary>
public sealed class GroupHeadcount
{
    private readonly ILookup<Guid, GroupSeat> _seats;
    private readonly IReadOnlyDictionary<Guid, int> _staff;
    private readonly IReadOnlySet<Guid> _open;

    /// <param name="openActivities">Activities whose group can still change (shortcut: an id with no activity row is not waited on).</param>
    public GroupHeadcount(IEnumerable<GroupSeat> seats, IReadOnlyDictionary<Guid, int> staffRows, IReadOnlySet<Guid>? openActivities = null)
    {
        _seats = seats.ToLookup(s => s.GroupActivityId);
        _staff = staffRows;
        _open = openActivities ?? new HashSet<Guid>();
    }

    /// <summary>The reason a group line waits: its activity can still gain people or lose staff rows, so the count it divides by is not final.</summary>
    public const string NotFinished = "a group shift whose activity isn't finished yet, so the group's size can still change";

    /// <summary>True while the activity is Draft, Published or InProgress, the statuses <c>GroupActivitiesController.EnsureStaffChangeable</c> / <c>StateRefusal</c> still allow a change in (the claim waits for Cancelled, PendingReview or Completed).</summary>
    public bool IsOpen(Guid? activityId) => activityId is Guid id && _open.Contains(id);

    public static async Task<GroupHeadcount> LoadAsync(OdipDbContext db, Guid tenantId, IEnumerable<Guid?> activityIds, CancellationToken ct)
    {
        var ids = activityIds.OfType<Guid>().Distinct().ToList();
        if (ids.Count == 0) return new GroupHeadcount([], new Dictionary<Guid, int>());
        var seats = await db.Shifts.AsNoTracking().Where(s => s.TenantId == tenantId && s.GroupActivityId != null && ids.Contains(s.GroupActivityId.Value))
            .Select(s => new GroupSeat(s.GroupActivityId!.Value, s.ParticipantId, s.Ratio, s.Status, s.ServiceDate, s.CancelledAt)).ToListAsync(ct);
        var staff = await db.GroupActivityStaff.AsNoTracking().Where(r => r.TenantId == tenantId && ids.Contains(r.GroupActivityId))
            .GroupBy(r => r.GroupActivityId).Select(g => new { g.Key, Count = g.Count() }).ToDictionaryAsync(g => g.Key, g => g.Count, ct);
        var open = (await db.GroupActivities.AsNoTracking().Where(a => a.TenantId == tenantId && ids.Contains(a.Id) && a.Status != ShiftStatus.Cancelled && a.Status != ShiftStatus.PendingReview && a.Status != ShiftStatus.Completed)
            .Select(a => a.Id).ToListAsync(ct)).ToHashSet();
        return new GroupHeadcount(seats, staff, open);
    }

    /// <summary>The headcount floor for a shift on this activity, or 0 for a shift on none. <paramref name="zone"/> is the shift's own zone, which dates every cancellation (shortcut: one activity, one zone).</summary>
    public int Of(Guid? activityId, TimeZoneInfo zone) =>
        activityId is Guid id ? Floor(_seats[id], _staff.GetValueOrDefault(id), zone) : 0;

    /// <summary>ceil(people in the group / workers). Workers are the staff rows less those the 1:1 and 2:1 people need, never below 1: when they need every worker the group is claimed as if one covered it, as before this rule (shortcut: a part-time staff row counts as a whole worker; refine with hours if coordinators staff groups with short rows).</summary>
    public static int Floor(IEnumerable<GroupSeat> seats, int staffRows, TimeZoneInfo zone)
    {
        var counted = seats.Where(s => Counts(s, zone)).ToList();
        var inGroup = counted.Where(s => IsGroupRatio(s.Ratio)).Select(s => s.ParticipantId).Distinct().Count();
        var apart = counted.Where(s => s.Ratio is SupportRatio.OneToOne or SupportRatio.TwoToOne).GroupBy(s => s.ParticipantId).Sum(g => GroupActivityStaffing.Sixtieths(g.First().Ratio));
        var workers = Math.Max(1, staffRows - (apart + 59) / 60);
        return (inGroup + workers - 1) / workers;
    }

    private static bool IsGroupRatio(SupportRatio ratio) => ratio is SupportRatio.OneToTwo or SupportRatio.OneToThree or SupportRatio.OneToFour or SupportRatio.OneToFive or SupportRatio.SharedSupport;

    /// <summary>In the group: not cancelled, or cancelled at short notice. A cancelled seat with no time is not short notice, as <c>NotClaimableCancellation</c> has it.</summary>
    private static bool Counts(GroupSeat s, TimeZoneInfo zone) =>
        s.Status != ShiftStatus.Cancelled || (s.CancelledAt is { } at && PlanCancellation.IsShortNotice(ShiftClaimGenerationService.NoticeDays(s.ServiceDate, at, zone)));
}
