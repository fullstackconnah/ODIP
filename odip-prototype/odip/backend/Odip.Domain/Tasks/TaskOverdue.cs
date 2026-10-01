using System.Linq.Expressions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Tasks;

/// <summary>
/// The ONE definition of "overdue" for a task, so the dashboard's Overdue figure and the Tasks list's Overdue filter can never disagree
/// (L3-03: the tile said 2 and its page listed none, because the list filtered on the stored status alone and nothing in production
/// writes Overdue). Same shape as <see cref="Odip.Domain.Incidents.QscReporting"/>: an expression, so it translates to SQL.
/// </summary>
public static class TaskOverdue
{
    /// <summary>
    /// Overdue when the stored status says so, or when the task is still open and its due DAY has passed. <paramref name="providerToday"/>
    /// is the PROVIDER's calendar date (<c>ProviderTimeZoneResolver.TodayAsync</c>), never the UTC date: a task due yesterday in Sydney
    /// is overdue from Sydney's midnight, not from 10:00 or 11:00 the next morning when the UTC date catches up.
    /// </summary>
    public static Expression<Func<BookingTask, bool>> IsOverdueExpr(DateOnly providerToday) =>
        t => t.Status == TaskItemStatus.Overdue
             || (t.DueDate != null && t.DueDate < providerToday
                 && t.Status != TaskItemStatus.Completed && t.Status != TaskItemStatus.Cancelled);
}
