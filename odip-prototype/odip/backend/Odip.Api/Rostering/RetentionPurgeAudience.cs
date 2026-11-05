using System.Security.Claims;

namespace Odip.Api.Rostering;

/// <summary>
/// Who sees the "records due for permanent deletion" task: an Admin only, the one role that may purge. The task counts archived participants, so no other role sees it in the list,
/// the counts or by id. A null principal (a unit test with no request) is nobody.
/// </summary>
public static class RetentionPurgeAudience
{
    public static bool MaySee(ClaimsPrincipal? user) => user?.IsInRole("Admin") == true;
}
