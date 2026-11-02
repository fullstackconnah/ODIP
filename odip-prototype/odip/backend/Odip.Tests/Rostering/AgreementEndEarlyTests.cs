using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// End early (participant agreements PR1): an approved revision ends on a chosen last day, in one save. Its end date moves up and the signed end is kept, its patterns stop there, and its unfilled Draft
/// shifts after it are removed while the rest are kept and listed. It is refused (in this order) for a draft, a replaced revision, a last day outside the agreement, a newer revision waiting, and shifts
/// after the last day that were worked or claimed.
/// </summary>
public class AgreementEndEarlyTests
{
    private static readonly DateOnly SignedEnd = new(2026, 12, 20);
    private static readonly DateOnly Friday30Oct = new(2026, 10, 30);

    /// <summary>An approved revision (12 Oct to 20 Dec) with every weekday shift of the started weeks made, as approving and Populate roster leave it.</summary>
    private static async Task<ServiceAgreementDraft> ApprovedAsync(Fixture f, int version = 1, DateOnly? start = null, DateOnly? end = null, bool ongoing = false, bool populate = true)
    {
        var draft = await AddRevisionAsync(f, version, new[] { WeekdayBlock() }, start, end);
        if (ongoing) { draft.IsOngoing = true; await f.Db.SaveChangesAsync(); }
        Assert.Equal(ApprovalStatus.Approved, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, CancellationToken.None)).Status);
        if (populate) await PopulateAllAsync(f.Service, f.ParticipantId, draft.Id);
        return draft;
    }

    private static Task<EndEarlyOutcome> EndAsync(Fixture f, ServiceAgreementDraft draft, DateOnly lastDay, ApprovalCaller? caller = null) =>
        f.Service.EndEarlyAsync(TenantA, f.ParticipantId, draft.Id, lastDay, caller ?? Admin, CancellationToken.None);

    private static async Task<Shift> ShiftAfterAsync(Fixture f, ServiceAgreementDraft draft, DateOnly lastDay) =>
        await f.Db.Shifts.OrderBy(s => s.ServiceDate).FirstAsync(s => f.Db.ShiftPatterns.Any(p => p.Id == s.ShiftPatternId && p.SourceDraftId == draft.Id) && s.ServiceDate > lastDay);

    // ── The effects ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task Ends_the_agreement_on_the_last_day_and_keeps_the_signed_end()
    {
        await using var f = await SetUpAsync(audited: true);
        var v1 = await ApprovedAsync(f);
        var before = await f.Db.Shifts.CountAsync(s => s.ServiceDate <= Friday30Oct);
        var after = await f.Db.Shifts.CountAsync(s => s.ServiceDate > Friday30Oct);
        Assert.True(before > 0 && after > 0);

        var outcome = await EndAsync(f, v1, Friday30Oct);

        Assert.Equal(EndEarlyStatus.Ended, outcome.Status);
        var stored = await f.Db.ServiceAgreementDrafts.AsNoTracking().SingleAsync(x => x.Id == v1.Id);
        Assert.Equal((Friday30Oct, SignedEnd, false), (stored.AgreementEndDate, stored.OriginalAgreementEndDate, stored.IsOngoing));
        Assert.Equal((Friday30Oct, SignedEnd), (outcome.Draft!.AgreementEndDate, outcome.Draft.OriginalAgreementEndDate));
        Assert.All(await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v1.Id).ToListAsync(), p => Assert.Equal(Friday30Oct, p.EffectiveTo));
        Assert.Equal(before, await f.Db.Shifts.CountAsync(s => s.ServiceDate <= Friday30Oct));
        Assert.Equal(0, await f.Db.Shifts.CountAsync(s => s.ServiceDate > Friday30Oct));
        Assert.Equal(after, outcome.OldShifts!.Removed);
        Assert.Equal(0, outcome.OldShifts.Assigned);
    }

    [Fact]
    public async Task Keeps_and_lists_a_shift_with_a_worker_and_removes_the_unfilled_ones()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        var staffed = await ShiftAfterAsync(f, v1, Friday30Oct);
        staffed.Status = ShiftStatus.Published;
        staffed.UserId = Guid.NewGuid();
        await f.Db.SaveChangesAsync();

        var outcome = await EndAsync(f, v1, Friday30Oct);

        Assert.Equal(EndEarlyStatus.Ended, outcome.Status);
        Assert.Equal(1, outcome.OldShifts!.Assigned);
        Assert.Equal(staffed.Id, Assert.Single(outcome.OldShifts.Shifts).Id);
        Assert.Equal(staffed.Id, Assert.Single(await f.Db.Shifts.Where(s => s.ServiceDate > Friday30Oct).ToListAsync()).Id);
    }

    [Fact]
    public async Task A_second_End_early_keeps_the_first_signed_end()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        await EndAsync(f, v1, Friday30Oct);

        var outcome = await EndAsync(f, v1, new DateOnly(2026, 10, 23));

        Assert.Equal(EndEarlyStatus.Ended, outcome.Status);
        Assert.Equal((new DateOnly(2026, 10, 23), SignedEnd), (outcome.Draft!.AgreementEndDate, outcome.Draft.OriginalAgreementEndDate));
    }

    [Fact]
    public async Task An_Ongoing_agreement_ended_early_is_no_longer_Ongoing_and_keeps_the_plan_end_as_its_signed_end()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f, ongoing: true);

        var outcome = await EndAsync(f, v1, Friday30Oct);

        Assert.Equal(EndEarlyStatus.Ended, outcome.Status);
        // The save rule snaps an Ongoing end to the plan end: IsOngoing off is what keeps the early end.
        Assert.Equal((false, Friday30Oct, SignedEnd), (outcome.Draft!.IsOngoing, outcome.Draft.AgreementEndDate, outcome.Draft.OriginalAgreementEndDate));
    }

    [Fact]
    public async Task Populate_roster_makes_nothing_after_the_last_day()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f, populate: false);
        await EndAsync(f, v1, Friday30Oct);

        await PopulateAllAsync(f.Service, f.ParticipantId, v1.Id);

        Assert.True(await f.Db.Shifts.AnyAsync());
        Assert.Equal(0, await f.Db.Shifts.CountAsync(s => s.ServiceDate > Friday30Oct));
    }

    [Fact]
    public async Task An_approved_renewal_that_starts_after_the_end_is_not_a_reason_to_refuse_and_its_patterns_are_untouched()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f, end: new DateOnly(2026, 11, 22));
        var v2 = await ApprovedAsync(f, 2, start: new DateOnly(2026, 11, 23), end: SignedEnd);
        var renewalTo = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v2.Id).Select(p => p.EffectiveTo).ToListAsync();

        var outcome = await EndAsync(f, v1, Friday30Oct);

        Assert.Equal(EndEarlyStatus.Ended, outcome.Status);
        Assert.Equal(renewalTo, await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == v2.Id).Select(p => p.EffectiveTo).ToListAsync());
    }

    [Fact]
    public async Task Writes_an_audit_row_with_the_reason()
    {
        await using var f = await SetUpAsync(audited: true);
        var v1 = await ApprovedAsync(f);

        await EndAsync(f, v1, Friday30Oct);

        var log = Assert.Single(await f.Db.AuditLogs.Where(a => a.EntityId == v1.Id && a.EntityType == nameof(ServiceAgreementDraft)).ToListAsync());
        Assert.Equal((AuditAction.Updated, Admin.UserId, "Alex Admin"), (log.Action, log.ChangedById, log.ChangedByName));
        Assert.Contains("Ended early: last day 30 Oct 2026", log.Changes);
    }

    [Fact]
    public async Task A_last_day_in_the_past_keeps_the_past_draft_shifts_and_does_not_list_them()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f, start: Today.AddDays(-20));
        var lastDay = Today.AddDays(-5);
        // Populate starts from today, so the past Draft shift (a Wednesday after the last day, before today) is made by hand.
        var pattern = await f.Db.ShiftPatterns.FirstAsync(p => p.SourceDraftId == v1.Id);
        var pastDay = Today.AddDays(-3);
        f.Db.Shifts.Add(new Shift { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, ShiftPatternId = pattern.Id, ServiceDate = pastDay, StartTime = new TimeOnly(9, 0), EndTime = new TimeOnly(13, 0), Status = ShiftStatus.Draft });
        await f.Db.SaveChangesAsync();

        var outcome = await EndAsync(f, v1, lastDay);

        Assert.Equal(EndEarlyStatus.Ended, outcome.Status);
        Assert.Equal(1, await f.Db.Shifts.CountAsync(s => s.ServiceDate == pastDay));    // clamped to today, as Approve does (N3)
        Assert.Empty(outcome.OldShifts!.Shifts);
        Assert.Equal(0, await f.Db.Shifts.CountAsync(s => s.ServiceDate >= Today));
    }

    // ── The refusals ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task Refuses_a_draft_that_is_not_approved()
    {
        await using var f = await SetUpAsync();
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });

        var outcome = await EndAsync(f, draft, Friday30Oct);

        Assert.Equal(EndEarlyStatus.Refused, outcome.Status);
        Assert.Equal("Only an approved agreement can be ended early. Delete a draft instead.", outcome.Error);
    }

    [Fact]
    public async Task Refuses_a_revision_a_newer_approved_one_has_taken_over()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        await ApprovedAsync(f, 2, start: new DateOnly(2026, 11, 2));

        var outcome = await EndAsync(f, v1, Friday30Oct);

        Assert.Equal(EndEarlyStatus.Refused, outcome.Status);
        Assert.Equal("Version 2 takes over on 2 Nov 2026. End that version instead.", outcome.Error);
        Assert.Equal(SignedEnd, (await f.Db.ServiceAgreementDrafts.AsNoTracking().SingleAsync(x => x.Id == v1.Id)).AgreementEndDate);
    }

    [Theory]
    [InlineData("2026-10-11")]    // before the start
    [InlineData("2026-12-20")]    // the current end: nothing is ended
    [InlineData("2026-12-25")]    // after the end
    public async Task Refuses_a_last_day_outside_the_agreement(string day)
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);

        var outcome = await EndAsync(f, v1, DateOnly.Parse(day));

        Assert.Equal(EndEarlyStatus.BadDate, outcome.Status);
        Assert.Equal("Choose a last day from 12 Oct 2026 to 19 Dec 2026.", outcome.Error);
        Assert.Null((await f.Db.ServiceAgreementDrafts.AsNoTracking().SingleAsync(x => x.Id == v1.Id)).OriginalAgreementEndDate);
    }

    [Fact]
    public async Task Refuses_while_a_newer_unapproved_revision_waits()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, new DateOnly(2026, 12, 21), new DateOnly(2027, 3, 1));

        var outcome = await EndAsync(f, v1, Friday30Oct);

        Assert.Equal(EndEarlyStatus.Refused, outcome.Status);
        Assert.Equal("Version 2 is waiting. Approve or delete it first.", outcome.Error);
    }

    /// <summary>M2: a shift after the last day that was worked (Completed), is under way (InProgress) or is handed in for review (PendingReview) stops the end, and nothing changes.</summary>
    [Theory]
    [InlineData(ShiftStatus.Completed)]
    [InlineData(ShiftStatus.InProgress)]
    [InlineData(ShiftStatus.PendingReview)]
    public async Task Refuses_when_a_shift_after_the_last_day_was_worked(ShiftStatus status)
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        (await ShiftAfterAsync(f, v1, Friday30Oct)).Status = status;
        await f.Db.SaveChangesAsync();
        var shifts = await f.Db.Shifts.CountAsync();

        var outcome = await EndAsync(f, v1, Friday30Oct);

        Assert.Equal(EndEarlyStatus.Refused, outcome.Status);
        Assert.Contains("worked or claimed", outcome.Error);
        Assert.Equal(shifts, await f.Db.Shifts.CountAsync());
        var stored = await f.Db.ServiceAgreementDrafts.AsNoTracking().SingleAsync(x => x.Id == v1.Id);
        Assert.Equal((SignedEnd, null), (stored.AgreementEndDate, stored.OriginalAgreementEndDate));
    }

    /// <summary>M2: a claim line stops the end whatever the claim's status, a Cancelled claim included, and whatever the shift's own status.</summary>
    [Theory]
    [InlineData(TripClaimStatus.Draft)]
    [InlineData(TripClaimStatus.Cancelled)]
    public async Task Refuses_when_a_shift_after_the_last_day_has_a_claim_line_in_any_claim_status(TripClaimStatus claimStatus)
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        var shift = await ShiftAfterAsync(f, v1, Friday30Oct);
        var claim = new TripClaim { Id = Guid.NewGuid(), TenantId = TenantA, Kind = ClaimKind.Shift, ParticipantId = f.ParticipantId, PeriodFrom = shift.ServiceDate, PeriodTo = shift.ServiceDate, ClaimReference = "TC-EE", Status = claimStatus };
        f.Db.TripClaims.Add(claim);
        f.Db.ClaimLineItems.Add(new ClaimLineItem { TenantId = TenantA, Id = Guid.NewGuid(), TripClaimId = claim.Id, ShiftId = shift.Id, SupportItemCode = "04_X", SupportsDeliveredFrom = shift.ServiceDate, SupportsDeliveredTo = shift.ServiceDate, Hours = 4, UnitPrice = 73.58m, TotalAmount = 294.32m });
        await f.Db.SaveChangesAsync();

        var outcome = await EndAsync(f, v1, Friday30Oct);

        Assert.Equal(EndEarlyStatus.Refused, outcome.Status);
        Assert.Equal(SignedEnd, (await f.Db.ServiceAgreementDrafts.AsNoTracking().SingleAsync(x => x.Id == v1.Id)).AgreementEndDate);
    }

    [Fact]
    public async Task A_cancelled_shift_with_no_claim_does_not_stop_the_end()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        (await ShiftAfterAsync(f, v1, Friday30Oct)).Status = ShiftStatus.Cancelled;
        await f.Db.SaveChangesAsync();

        Assert.Equal(EndEarlyStatus.Ended, (await EndAsync(f, v1, Friday30Oct)).Status);
    }

    [Fact]
    public async Task Another_organisations_revision_and_the_wrong_participant_are_not_found_and_nothing_changes()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);

        Assert.Equal(EndEarlyStatus.NotFound, (await f.Service.EndEarlyAsync(TenantB, f.ParticipantId, v1.Id, Friday30Oct, Admin, CancellationToken.None)).Status);
        Assert.Equal(EndEarlyStatus.NotFound, (await f.Service.EndEarlyAsync(TenantA, Guid.NewGuid(), v1.Id, Friday30Oct, Admin, CancellationToken.None)).Status);
        Assert.Equal(EndEarlyStatus.NotFound, (await f.Service.EndEarlyAsync(TenantA, f.ParticipantId, Guid.NewGuid(), Friday30Oct, Admin, CancellationToken.None)).Status);
        Assert.Equal(SignedEnd, (await f.Db.ServiceAgreementDrafts.AsNoTracking().SingleAsync(x => x.Id == v1.Id)).AgreementEndDate);
    }

    // ── The controller ────────────────────────────────────────────────────────────

    private static ServiceAgreementDraftsController Controller(Fixture f, Guid? tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(tenantId is null);
        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, SuperAdmin.UserId!.Value.ToString()), new Claim("fullName", SuperAdmin.Name), new Claim(ClaimTypes.Role, "SuperAdmin") };
        return new ServiceAgreementDraftsController(f.Db, tenant.Object, new ServiceAgreementDraftService(f.Db), approval: f.Service)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) } },
        };
    }

    [Fact]
    public async Task A_SuperAdmin_with_no_tenant_context_gets_400_and_with_one_ends_the_agreement()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        var dto = new EndAgreementEarlyDto { LastDay = Friday30Oct };

        var without = await Controller(f, null).EndEarly(f.ParticipantId, v1.Id, dto, CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(without.Result);
        Assert.IsType<BadRequestObjectResult>(await Controller(f, null).Delete(f.ParticipantId, v1.Id, CancellationToken.None));

        var with = await Controller(f, TenantA).EndEarly(f.ParticipantId, v1.Id, dto, CancellationToken.None);
        var ok = Assert.IsType<OkObjectResult>(with.Result);
        Assert.Equal((Friday30Oct, SignedEnd), (Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(ok.Value).Data!.AgreementEndDate, Assert.IsType<ApiResponse<ServiceAgreementDraftDto>>(ok.Value).Data!.OriginalAgreementEndDate!.Value));
    }

    [Fact]
    public async Task The_controller_answers_404_for_another_organisation_400_for_a_bad_day_and_409_for_a_draft()
    {
        await using var f = await SetUpAsync();
        var v1 = await ApprovedAsync(f);
        var draft = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, new DateOnly(2026, 12, 21), new DateOnly(2027, 3, 1));

        Assert.IsType<NotFoundObjectResult>((await Controller(f, TenantB).EndEarly(f.ParticipantId, v1.Id, new EndAgreementEarlyDto { LastDay = Friday30Oct }, CancellationToken.None)).Result);
        Assert.IsType<BadRequestObjectResult>((await Controller(f, TenantA).EndEarly(f.ParticipantId, v1.Id, new EndAgreementEarlyDto { LastDay = SignedEnd }, CancellationToken.None)).Result);
        Assert.IsType<ConflictObjectResult>((await Controller(f, TenantA).EndEarly(f.ParticipantId, draft.Id, new EndAgreementEarlyDto { LastDay = new DateOnly(2027, 1, 5) }, CancellationToken.None)).Result);
    }
}
