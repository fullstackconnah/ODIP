using Microsoft.EntityFrameworkCore;
using Odip.Domain.Entities;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Each approval row records the organisation's approver roles in force when the check ran, and the roles the approver acted in. Older rows hold null, and no path rewrites a row.</summary>
public class ApprovalRolesProvenanceTests
{
    private static async Task SetRolesAsync(Fixture f, string roles)
    {
        var row = await f.Db.PlanPricingSettings.SingleOrDefaultAsync(s => s.TenantId == TenantA);
        if (row is null) f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApproverRoles = roles });
        else row.ApproverRoles = roles;
        await f.Db.SaveChangesAsync();
    }

    private static Task<ServiceAgreementDraftApproval> RowAsync(Fixture f, Guid draftId) =>
        f.Db.ServiceAgreementDraftApprovals.AsNoTracking().SingleAsync(a => a.DraftId == draftId);

    private static async Task<(ServiceAgreementDraft Draft, ApprovalOutcome Outcome)> ApproveFirstAsync(Fixture f, ApprovalCaller caller)
    {
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        return (draft, await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, caller, CancellationToken.None));
    }

    [Fact]
    public async Task A_coordinator_approving_with_no_settings_records_Admin_Coordinator_in_force_and_Coordinator()
    {
        await using var f = await SetUpAsync();
        var (draft, outcome) = await ApproveFirstAsync(f, Coordinator);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        var row = await RowAsync(f, draft.Id);
        Assert.Equal(("Admin,Coordinator", "Coordinator"), (row.ApproverRolesInForce, row.ApprovedByRoles));
    }

    [Fact]
    public async Task An_admin_approving_when_only_admins_may_records_Admin_and_Admin()
    {
        await using var f = await SetUpAsync();
        await SetRolesAsync(f, "Admin");
        var (draft, outcome) = await ApproveFirstAsync(f, Admin);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        var row = await RowAsync(f, draft.Id);
        Assert.Equal(("Admin", "Admin"), (row.ApproverRolesInForce, row.ApprovedByRoles));
    }

    [Fact]
    public async Task Changing_the_roles_later_leaves_the_earlier_approval_as_it_was()
    {
        await using var f = await SetUpAsync();
        await SetRolesAsync(f, "Admin");
        var (v1, first) = await ApproveFirstAsync(f, Admin);
        Assert.Equal(ApprovalStatus.Approved, first.Status);

        await SetRolesAsync(f, "Admin,Coordinator");
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() });
        var second = await f.Service.ApproveAsync(TenantA, f.ParticipantId, v2.Id, true, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.Approved, second.Status);
        Assert.Equal("Admin", (await RowAsync(f, v1.Id)).ApproverRolesInForce);
        Assert.Equal("Admin,Coordinator", (await RowAsync(f, v2.Id)).ApproverRolesInForce);
    }

    [Fact]
    public async Task A_super_admin_approves_while_only_admins_may_and_the_row_shows_SuperAdmin_beside_Admin()
    {
        await using var f = await SetUpAsync();
        await SetRolesAsync(f, "Admin");
        var (draft, outcome) = await ApproveFirstAsync(f, SuperAdmin);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        var row = await RowAsync(f, draft.Id);
        Assert.Equal("Admin", row.ApproverRolesInForce);
        Assert.Contains("SuperAdmin", (row.ApprovedByRoles ?? "").Split(','));
    }

    [Fact]
    public async Task A_super_admin_approving_with_no_settings_records_the_default_list()
    {
        await using var f = await SetUpAsync();
        var (draft, outcome) = await ApproveFirstAsync(f, SuperAdmin);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        var row = await RowAsync(f, draft.Id);
        Assert.Equal("Admin,Coordinator", row.ApproverRolesInForce);
        Assert.Contains("SuperAdmin", (row.ApprovedByRoles ?? "").Split(','));
    }

    [Fact]
    public async Task A_caller_with_two_roles_records_both_sorted_once()
    {
        await using var f = await SetUpAsync();
        var (draft, outcome) = await ApproveFirstAsync(f, new ApprovalCaller(Guid.NewGuid(), "Dana Dual", new[] { "Coordinator", "Admin", "Coordinator" }));

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        Assert.Equal("Admin,Coordinator", (await RowAsync(f, draft.Id)).ApprovedByRoles);
    }

    [Fact]
    public async Task A_role_set_longer_than_the_column_is_cut_to_200_and_the_approval_still_succeeds()
    {
        await using var f = await SetUpAsync();
        var roles = new[] { "Admin" }.Concat(Enumerable.Range(1, 4).Select(i => $"Role{i}" + new string('x', 55))).ToArray();
        var (draft, outcome) = await ApproveFirstAsync(f, new ApprovalCaller(Guid.NewGuid(), "Long Roles", roles));

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        var expected = string.Join(",", roles.OrderBy(r => r, StringComparer.Ordinal))[..200];
        var row = await RowAsync(f, draft.Id);
        Assert.Equal(expected, row.ApprovedByRoles);
        Assert.Equal(200, row.ApprovedByRoles!.Length);
    }

    [Fact]
    public async Task A_role_the_organisation_does_not_let_approve_is_refused_and_writes_nothing()
    {
        await using var f = await SetUpAsync();
        await SetRolesAsync(f, "Admin");
        var (_, outcome) = await ApproveFirstAsync(f, Coordinator);

        Assert.Equal(ApprovalStatus.NotAnApprover, outcome.Status);
        Assert.Equal(ServiceAgreementApprovalService.NotAnApproverMessage, Assert.Single(outcome.Errors!));
        Assert.Equal(0, await f.Db.ServiceAgreementDraftApprovals.CountAsync());
    }

    [Fact]
    public async Task Approving_again_answers_AlreadyApproved_and_the_first_row_keeps_its_values()
    {
        await using var f = await SetUpAsync();
        var (draft, first) = await ApproveFirstAsync(f, Coordinator);
        Assert.Equal(ApprovalStatus.Approved, first.Status);

        await SetRolesAsync(f, "Admin");
        var again = await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.AlreadyApproved, again.Status);
        Assert.Equal(1, await f.Db.ServiceAgreementDraftApprovals.CountAsync());
        var row = await RowAsync(f, draft.Id);
        Assert.Equal(("Admin,Coordinator", "Coordinator"), (row.ApproverRolesInForce, row.ApprovedByRoles));
    }
}
