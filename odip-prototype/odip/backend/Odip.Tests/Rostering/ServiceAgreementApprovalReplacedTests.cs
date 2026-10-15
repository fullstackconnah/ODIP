using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using Npgsql;
using Odip.Api.Controllers;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Saving again deletes the participant's earlier unapproved revision, so a page that still holds that revision asks to preview or approve one that is not there any more. It is not "not found": a newer
/// revision exists, which is what the screen was told before a save could delete anything (the 409 <c>draft-superseded</c>, or a preview that says the revision cannot be approved). And an approval that
/// is already under way when the save lands meets the restricting keys of the revision that has just gone, which is the same answer and not a server error.
/// </summary>
public class ServiceAgreementApprovalReplacedTests
{
    /// <summary>Version 1 as a coordinator's page holds it, and version 2, saved since: version 1 and its blocks and lines are gone, as a save leaves them.</summary>
    private static async Task<ServiceAgreementDraft> ReplacedAsync(Fixture f)
    {
        var replaced = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await AddRevisionAsync(f, 2, new[] { WeekdayBlock() });
        f.Db.ServiceAgreementDrafts.Remove(replaced);              // its blocks and lines are tracked with it and go too
        await f.Db.SaveChangesAsync();
        return replaced;
    }

    private static ServiceAgreementDraftsController Controller(Fixture f)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, Admin.UserId!.Value.ToString()), new Claim("fullName", "Alex Admin"), new Claim(ClaimTypes.Role, "Admin") };
        return new ServiceAgreementDraftsController(f.Db, tenant.Object, new ServiceAgreementDraftService(f.Db), configuration: f.Configuration, approval: f.Service)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } },
        };
    }

    // ── A revision a save has replaced ────────────────────────────────────────────

    [Fact]
    public async Task Approving_a_replaced_revision_says_superseded_with_the_newest_version_and_not_that_it_was_not_found()
    {
        await using var f = await SetUpAsync();
        var replaced = await ReplacedAsync(f);

        var outcome = await f.Service.ApproveAsync(TenantA, f.ParticipantId, replaced.Id, false, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.Superseded, outcome.Status);
        Assert.Equal(2, outcome.NewestVersion);
        Assert.Equal(new[] { ServiceAgreementApprovalService.SupersededMessage }, outcome.Errors);
        Assert.Empty(await f.Db.ServiceAgreementDraftApprovals.ToListAsync());
        Assert.Empty(await f.Db.ShiftPatterns.ToListAsync());
    }

    [Fact]
    public async Task The_preview_of_a_replaced_revision_says_it_cannot_be_approved_because_a_newer_one_exists()
    {
        await using var f = await SetUpAsync();
        var replaced = await ReplacedAsync(f);

        var outcome = await f.Service.PreviewAsync(TenantA, f.ParticipantId, replaced.Id, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.Superseded, outcome.Status);
        Assert.Equal(2, outcome.NewestVersion);
        var preview = Assert.IsType<DraftApprovalPreviewDto>(outcome.Preview);
        Assert.False(preview.CanApprove);
        var reason = Assert.Single(preview.Reasons);
        Assert.Equal(("Superseded", ServiceAgreementApprovalService.SupersededMessage), (reason.Code, reason.Message));
    }

    [Fact]
    public async Task A_role_that_may_not_approve_is_told_so_for_a_replaced_revision_too()
    {
        await using var f = await SetUpAsync();
        f.Db.PlanPricingSettings.Add(new PlanPricingSettings { Id = Guid.NewGuid(), TenantId = TenantA, ApproverRoles = "Admin" });
        var replaced = await ReplacedAsync(f);

        Assert.Equal(ApprovalStatus.NotAnApprover, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, replaced.Id, false, Coordinator, CancellationToken.None)).Status);
        Assert.Equal(ApprovalStatus.NotAnApprover, (await f.Service.PreviewAsync(TenantA, f.ParticipantId, replaced.Id, Coordinator, CancellationToken.None)).Status);
    }

    [Fact]
    public async Task Over_http_a_replaced_revision_is_a_409_draft_superseded_to_approve_and_a_200_that_says_so_to_preview()
    {
        await using var f = await SetUpAsync();
        var replaced = await ReplacedAsync(f);
        var controller = Controller(f);

        var approve = await controller.Approve(f.ParticipantId, replaced.Id, new ApproveDraftDto(), CancellationToken.None);
        var preview = await controller.ApprovalPreview(f.ParticipantId, replaced.Id, CancellationToken.None);

        var conflict = Assert.IsType<ApiResponse<DraftVersionConflictDto>>(Assert.IsType<ConflictObjectResult>(approve.Result).Value);
        Assert.Equal(("draft-superseded", 2), (conflict.Code, conflict.Data!.CurrentVersion));
        var shown = Assert.IsType<ApiResponse<DraftApprovalPreviewDto>>(Assert.IsType<OkObjectResult>(preview.Result).Value).Data!;
        Assert.False(shown.CanApprove);
        Assert.Equal("Superseded", Assert.Single(shown.Reasons).Code);
    }

    [Fact]
    public async Task A_revision_that_never_was_is_still_not_found_for_a_participant_with_no_revisions_and_for_another_organisations()
    {
        await using var f = await SetUpAsync();
        var bare = Guid.NewGuid();
        var theirs = Guid.NewGuid();
        f.Db.Participants.Add(new Participant { Id = bare, TenantId = TenantA, FirstName = "Bare", LastName = "Person", IsActive = true });
        f.Db.Participants.Add(new Participant { Id = theirs, TenantId = TenantB, FirstName = "Other", LastName = "Person", IsActive = true });
        await f.Db.SaveChangesAsync();
        await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, tenantId: TenantB, participantId: theirs);

        Assert.Equal(ApprovalStatus.NotFound, (await f.Service.ApproveAsync(TenantA, bare, Guid.NewGuid(), false, Admin, CancellationToken.None)).Status);        // nothing was ever saved for them
        Assert.Equal(ApprovalStatus.NotFound, (await f.Service.PreviewAsync(TenantA, bare, Guid.NewGuid(), Admin, CancellationToken.None)).Status);
        Assert.Equal(ApprovalStatus.NotFound, (await f.Service.ApproveAsync(TenantA, theirs, Guid.NewGuid(), false, Admin, CancellationToken.None)).Status);       // another organisation's participant, which has revisions
        Assert.Equal(ApprovalStatus.NotFound, (await f.Service.PreviewAsync(TenantA, theirs, Guid.NewGuid(), Admin, CancellationToken.None)).Status);
    }

    // ── An approval under way when a save lands ───────────────────────────────────

    /// <summary>On the first save that holds an approval to write, lets another request in first (the save that replaces the revision) and then fails the way PostgreSQL does when a key refuses the write.</summary>
    private sealed class SaveLandsFirst(Func<Task> otherRequest, Func<Exception> failure) : SaveChangesInterceptor
    {
        private bool _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (_fired || !eventData.Context!.ChangeTracker.Entries<ServiceAgreementDraftApproval>().Any(entry => entry.State == EntityState.Added)) return result;
            _fired = true;
            await otherRequest();
            throw failure();
        }
    }

    private static DbUpdateException KeyRefusal() => new("insert or update violates foreign key constraint", new PostgresException(
        messageText: "insert or update on table \"ShiftPatterns\" violates foreign key constraint", severity: "ERROR", invariantSeverity: "ERROR",
        sqlState: PostgresErrorCodes.ForeignKeyViolation, tableName: "ShiftPatterns", constraintName: "FK_ShiftPatterns_ServiceAgreementDrafts_SourceDraftId"));

    [Fact]
    public async Task An_approval_whose_revision_a_save_replaces_meanwhile_is_superseded_and_keeps_nothing()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var interceptor = new SaveLandsFirst(async () =>
        {
            await using var other = NewDb(f.DbName);                                   // the save: version 2 in, version 1 and its blocks and lines out
            other.ServiceAgreementDrafts.Remove(await other.ServiceAgreementDrafts.Include(d => d.Blocks).Include(d => d.Lines).SingleAsync(d => d.Id == v1.Id));
            other.ServiceAgreementDrafts.Add(BuildRevision(TenantA, f.ParticipantId, 2, new[] { WeekdayBlock() }));
            await other.SaveChangesAsync();
        }, KeyRefusal);
        await using var racing = NewDb(f.DbName, false, interceptor);

        var outcome = await new ServiceAgreementApprovalService(racing, new RosterPlacementGate(), new RosterShiftGenerator(), clock: f.Clock)
            .ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.Superseded, outcome.Status);
        Assert.Equal(2, outcome.NewestVersion);
        await using var read = NewDb(f.DbName);
        Assert.Empty(await read.ServiceAgreementDraftApprovals.ToListAsync());
        Assert.Empty(await read.ShiftPatterns.ToListAsync());
        Assert.Equal(new[] { 2 }, await read.ServiceAgreementDrafts.Select(d => d.Version).ToListAsync());
    }

    [Fact]
    public async Task A_key_refusal_that_is_not_about_a_replaced_revision_is_not_hidden_as_superseded()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        var interceptor = new SaveLandsFirst(() => Task.CompletedTask, KeyRefusal);                  // nobody replaced anything: the revision is still there
        await using var racing = NewDb(f.DbName, false, interceptor);

        await Assert.ThrowsAsync<DbUpdateException>(() => new ServiceAgreementApprovalService(racing, new RosterPlacementGate(), new RosterShiftGenerator(), clock: f.Clock)
            .ApproveAsync(TenantA, f.ParticipantId, v1.Id, false, Admin, CancellationToken.None));

        await using var read = NewDb(f.DbName);
        Assert.Empty(await read.ServiceAgreementDraftApprovals.ToListAsync());
    }
}
