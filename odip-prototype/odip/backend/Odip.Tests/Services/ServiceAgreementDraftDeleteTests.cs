using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Rostering;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Services;

/// <summary>
/// Delete draft (participant agreements PR1, D7): the newest unapproved revision can be deleted, with its blocks and lines and an audit row. An approved revision, one with roster patterns and one with a signing
/// snapshot stay in the history (409, in words). Another organisation's revision, or the wrong participant's, is 404 and is left alone.
/// </summary>
public class ServiceAgreementDraftDeleteTests
{
    private static Task<DraftDeleteOutcome> DeleteAsync(Fixture f, ServiceAgreementDraft draft, Guid? tenantId = null, Guid? participantId = null) =>
        new ServiceAgreementDraftService(f.Db).DeleteAsync(tenantId ?? TenantA, participantId ?? f.ParticipantId, draft.Id, Admin, CancellationToken.None);

    [Fact]
    public async Task Deletes_the_newest_unapproved_draft_with_its_blocks_and_lines_and_writes_an_audit_row()
    {
        await using var f = await SetUpAsync(audited: true);
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await MarkApprovedAsync(f.Db, v1);
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, new DateOnly(2026, 12, 21), new DateOnly(2027, 3, 1));
        Assert.NotEmpty(v2.Blocks);

        var outcome = await DeleteAsync(f, v2);

        Assert.Equal(DraftDeleteStatus.Deleted, outcome.Status);
        Assert.False(await f.Db.ServiceAgreementDrafts.AnyAsync(x => x.Id == v2.Id));
        Assert.False(await f.Db.ServiceAgreementDraftBlocks.AnyAsync(b => b.DraftId == v2.Id));
        Assert.False(await f.Db.ServiceAgreementDraftLines.AnyAsync(l => l.DraftId == v2.Id));
        Assert.Equal(1, await f.Db.ServiceAgreementDrafts.CountAsync());      // the approved one before it is untouched and is the newest again
        var reason = Assert.Single(await f.Db.AuditLogs.Where(a => a.EntityId == v2.Id && a.EntityType == nameof(ServiceAgreementDraft)).ToListAsync());
        Assert.Equal((AuditAction.Deleted, Admin.UserId), (reason.Action, reason.ChangedById));
        Assert.Contains("Draft version 2 deleted", reason.Changes);
    }

    [Fact]
    public async Task The_next_save_after_a_delete_takes_the_version_after_the_one_that_is_left()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await MarkApprovedAsync(f.Db, v1);
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, new DateOnly(2026, 12, 21), new DateOnly(2027, 3, 1));
        await DeleteAsync(f, v2);

        Assert.Equal(1, await f.Db.ServiceAgreementDrafts.Where(x => x.ParticipantId == f.ParticipantId).MaxAsync(x => x.Version));
    }

    [Fact]
    public async Task Refuses_an_approved_revision_and_leaves_it_alone()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await MarkApprovedAsync(f.Db, v1);

        var outcome = await DeleteAsync(f, v1);

        Assert.Equal((DraftDeleteStatus.Refused, "An approved agreement can't be deleted. End it early instead."), (outcome.Status, outcome.Error));
        Assert.True(await f.Db.ServiceAgreementDrafts.AnyAsync(x => x.Id == v1.Id));
        Assert.Equal(0, await f.Db.AuditLogs.CountAsync(a => a.EntityId == v1.Id));
    }

    [Fact]
    public async Task Refuses_a_revision_with_roster_patterns()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        f.Db.ShiftPatterns.Add(new ShiftPattern { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, SourceDraftId = v1.Id, DayOfWeek = DayOfWeek.Monday, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), EffectiveFrom = v1.AgreementStartDate });
        await f.Db.SaveChangesAsync();

        var outcome = await DeleteAsync(f, v1);

        Assert.Equal((DraftDeleteStatus.Refused, "This version has roster patterns, so it stays in the history."), (outcome.Status, outcome.Error));
        Assert.True(await f.Db.ServiceAgreementDrafts.AnyAsync(x => x.Id == v1.Id));
    }

    [Fact]
    public async Task Refuses_a_revision_with_a_signing_snapshot()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        f.Db.ElectronicSigningSnapshots.Add(new ElectronicSigningSnapshot { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, DraftId = v1.Id, DraftVersion = 1, DocumentJson = "{}", DocumentHash = new string('a', 64) });
        await f.Db.SaveChangesAsync();

        var outcome = await DeleteAsync(f, v1);

        Assert.Equal((DraftDeleteStatus.Refused, "This version has signing records, so it stays in the history."), (outcome.Status, outcome.Error));
        Assert.True(await f.Db.ServiceAgreementDrafts.AnyAsync(x => x.Id == v1.Id));
    }

    [Fact]
    public async Task Another_organisations_revision_and_the_wrong_participant_are_not_found_and_stay()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        Assert.Equal(DraftDeleteStatus.NotFound, (await DeleteAsync(f, v1, tenantId: TenantB)).Status);
        Assert.Equal(DraftDeleteStatus.NotFound, (await DeleteAsync(f, v1, participantId: Guid.NewGuid())).Status);
        Assert.True(await f.Db.ServiceAgreementDrafts.AnyAsync(x => x.Id == v1.Id));
    }

    private static ServiceAgreementDraftsController Controller(Fixture f, Guid? tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, Admin.UserId!.Value.ToString()), new Claim("fullName", Admin.Name), new Claim(ClaimTypes.Role, "Coordinator") };
        return new ServiceAgreementDraftsController(f.Db, tenant.Object, new ServiceAgreementDraftService(f.Db), approval: f.Service)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } },
        };
    }

    [Fact]
    public async Task The_controller_answers_204_409_and_404_and_a_tenant_B_coordinator_cannot_delete_tenant_As_draft()
    {
        await using var f = await SetUpAsync();
        var v1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        await MarkApprovedAsync(f.Db, v1);
        var v2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, new DateOnly(2026, 12, 21), new DateOnly(2027, 3, 1));

        Assert.IsType<BadRequestObjectResult>(await Controller(f, null).Delete(f.ParticipantId, v2.Id, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await Controller(f, TenantB).Delete(f.ParticipantId, v2.Id, CancellationToken.None));
        Assert.IsType<NotFoundObjectResult>(await Controller(f, TenantA).Delete(Guid.NewGuid(), v2.Id, CancellationToken.None));
        Assert.IsType<ConflictObjectResult>(await Controller(f, TenantA).Delete(f.ParticipantId, v1.Id, CancellationToken.None));
        Assert.True(await f.Db.ServiceAgreementDrafts.AnyAsync(x => x.Id == v2.Id));

        Assert.IsType<NoContentResult>(await Controller(f, TenantA).Delete(f.ParticipantId, v2.Id, CancellationToken.None));
        Assert.False(await f.Db.ServiceAgreementDrafts.AnyAsync(x => x.Id == v2.Id));
    }
}
