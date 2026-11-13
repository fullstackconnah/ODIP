using Odip.Domain.Entities;

namespace Odip.Infrastructure.Data;

public static partial class WhatsNewSeed
{
    private static readonly Entry K_2026_11_agreement_approval_roles = new(
    new Item("2026-11-agreement-approval-roles", "Agreement approvals show who could approve",
        "On an approved agreement revision, the page now shows which roles could approve it at the time and which role the approver acted in. Approvals made before this change do not show the line.",
        Staff, false));
}
