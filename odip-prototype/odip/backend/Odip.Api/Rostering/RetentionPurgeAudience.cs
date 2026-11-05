using System.Security.Claims;
using Odip.Domain.Enums;

namespace Odip.Api.Rostering;

/// <summary>
/// Who sees the Admin-only tasks (<see cref="AdminOnlyTypes"/>): the "records due for permanent deletion" task (an Admin only, the one role that may purge; it counts archived participants) and the compliance-date reminders.
/// No other role sees them in the list, the counts or by id. A null principal (a unit test with no request) is nobody.
/// </summary>
public static class RetentionPurgeAudience
{
    public static readonly TaskType[] AdminOnlyTypes = [TaskType.RetentionPurgeDue, TaskType.ComplianceDue];

    public static bool IsAdminOnly(TaskType type) => AdminOnlyTypes.Contains(type);

    public static bool MaySee(ClaimsPrincipal? user) => user?.IsInRole("Admin") == true;

    /// <summary>An Admin or SuperAdmin: the only roles that may change the task (a Coordinator cannot tick it off or retype it).</summary>
    public static bool MayAct(ClaimsPrincipal? user) => user?.IsInRole("Admin") == true || user?.IsInRole("SuperAdmin") == true;
}
