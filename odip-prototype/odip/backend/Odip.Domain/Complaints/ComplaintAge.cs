using System.Linq.Expressions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Complaints;

/// <summary>
/// The one definition of how long a complaint has been open, so the list's "Open for" figure and its "open longer than 21 days" filter cannot disagree.
/// Whole calendar days from ReceivedOn to the provider's own today (never UTC, never the browser); only Open and Investigating complaints are open.
/// </summary>
public static class ComplaintAge
{
    /// <summary>A complaint open for more than this many days is "long open". The frontend mirrors it as LONG_OPEN_DAYS (api/types/complaints.ts).</summary>
    public const int LongOpenDays = 21;

    public static bool IsOpen(ComplaintStatus status) => status is ComplaintStatus.Open or ComplaintStatus.Investigating;

    /// <summary>Calendar days open (0 = received today); null once Resolved or Closed.</summary>
    public static int? OpenDays(ComplaintStatus status, DateOnly receivedOn, DateOnly today) =>
        IsOpen(status) ? today.DayNumber - receivedOn.DayNumber : null;

    /// <summary>Exactly <c>OpenDays &gt; LongOpenDays</c>, as a predicate EF can translate.</summary>
    public static Expression<Func<Complaint, bool>> IsOpenLongerThanExpr(DateOnly today)
    {
        var cutoff = today.AddDays(-LongOpenDays);
        return c => (c.Status == ComplaintStatus.Open || c.Status == ComplaintStatus.Investigating) && c.ReceivedOn < cutoff;
    }
}
