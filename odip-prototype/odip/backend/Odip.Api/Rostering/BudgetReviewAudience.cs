using System.Security.Claims;

namespace Odip.Api.Rostering;

/// <summary>
/// Who may see and who may act on the Admin's review of an emergency booking over budget (the phase 3 review, C2 and C7). The owner's decision is that an Admin reviews the emergency afterwards, so only an
/// Admin or SuperAdmin may complete, cancel, delete or retype the task (the Coordinator who made the emergency may not tick it off themselves), and the task, which names a participant whose budget is spent,
/// is shown only to the roles that already see budget standing elsewhere (the roster, the Funding tab, the Budgets list). A null principal (a unit test with no request) is nobody.
/// </summary>
public static class BudgetReviewAudience
{
    /// <summary>An Admin or SuperAdmin: the only roles that may complete, cancel, delete or retype the review task.</summary>
    public static bool MayAct(ClaimsPrincipal? user) => user?.IsInRole("Admin") == true || user?.IsInRole("SuperAdmin") == true;

    /// <summary>The roles that may see the task: Admin, SuperAdmin and Coordinator. SupportWorker and ReadOnly never see budget standing, and a task title that names a participant "over budget" is that.</summary>
    public static bool MaySee(ClaimsPrincipal? user) => MayAct(user) || user?.IsInRole("Coordinator") == true;
}
