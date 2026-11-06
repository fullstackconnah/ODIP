using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.AgreementBulkServiceTests;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// Several agreements for one participant (PR A, backend only). Revision numbers count inside an agreement, so everything that read "the participant's newest revision" reads the agreement's.
/// The F7 fixture: A is approved at version 1 and B at version 2, so any lookup that forgets the agreement finds A as an "earlier revision" of B.
/// </summary>
public class MultipleAgreementsTests
{
    private static readonly DateOnly PlanStart = new(2026, 7, 1), PlanEnd = new(2027, 6, 30), Dec20 = new(2026, 12, 20);

    private static PlanBlock SaturdayBlock(string id = "sat") => WeekdayBlock(id, b => b with { Days = new[] { DayOfWeek.Saturday } });

    private static async Task<Fixture> SetUpWithCatalogueAsync()
    {
        var f = await SetUpAsync();
        await CatalogueImportTestSupport.ImportAsync(f.Db, CatalogueFixtures.File2026_27);
        return f;
    }

    private static CreateServiceAgreementDraftDto Request(PlanBlock block, int? baseVersion = null, Guid? agreementId = null, bool newAgreement = false, AgreementKind? kind = null, string? name = null) => new()
    {
        PlanStartDate = PlanStart, PlanEndDate = PlanEnd, AgreementStartDate = Start, AgreementEndDate = Dec20, State = "NSW", BaseVersion = baseVersion,
        Blocks = [new DraftBlockDto { Block = block, Requirements = new DraftBlockRequirementsDto() }],
        AgreementId = agreementId, NewAgreement = newAgreement, AgreementKind = kind, AgreementName = name,
    };

    private static Task<DraftSaveResult> SaveAsync(Fixture f, CreateServiceAgreementDraftDto request, Guid? participantId = null) =>
        new ServiceAgreementDraftService(f.Db).SaveAsync(TenantA, participantId ?? f.ParticipantId, request, "actor", CancellationToken.None);

    private static async Task ApproveAsync(Fixture f, ServiceAgreementDraft draft) =>
        Assert.Equal(ApprovalStatus.Approved, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, true, Admin, CancellationToken.None)).Status);

    /// <summary>F7: A (the participant's first agreement, weekdays) approved at v1 with its roster made, then B (Saturdays) saved as its own agreement and approved at v2.</summary>
    private static async Task<(Fixture F, ServiceAgreementDraft A, ServiceAgreementDraft B)> TwoApprovedAsync(bool populateA = true)
    {
        var f = await SetUpWithCatalogueAsync();
        var a = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, agreementId: f.ParticipantId);
        await ApproveAsync(f, a);
        if (populateA) await PopulateAllAsync(f.Service, f.ParticipantId, a.Id);
        var b = await AddRevisionAsync(f, 2, new[] { SaturdayBlock() }, agreementId: Guid.NewGuid());
        await ApproveAsync(f, b);
        return (f, a, b);
    }

    // ── Saving ────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task NewAgreement_OnParticipantWithNone_UsesParticipantId_ThenAFreshIdAtVersionOne()
    {
        await using var f = await SetUpWithCatalogueAsync();
        var first = (await SaveAsync(f, Request(WeekdayBlock(), newAgreement: true, kind: AgreementKind.Core))).Draft!;
        var second = (await SaveAsync(f, Request(SaturdayBlock(), newAgreement: true, kind: AgreementKind.Trip, name: "  Beach trip  "))).Draft!;

        Assert.Equal((f.ParticipantId, 1, AgreementKind.Core), (first.AgreementId, first.Version, first.AgreementKind));
        Assert.NotEqual(f.ParticipantId, second.AgreementId);
        Assert.Equal((1, AgreementKind.Trip, "Beach trip"), (second.Version, second.AgreementKind, second.AgreementName));
    }

    [Fact]
    public async Task Versions_ArePerAgreement_AndTheBaseVersionIsTheAgreements()
    {
        await using var f = await SetUpWithCatalogueAsync();
        var a1 = (await SaveAsync(f, Request(WeekdayBlock(), newAgreement: true, kind: AgreementKind.Core))).Draft!;
        var b1 = (await SaveAsync(f, Request(SaturdayBlock(), newAgreement: true, kind: AgreementKind.Trip))).Draft!;
        var a2 = (await SaveAsync(f, Request(WeekdayBlock(), baseVersion: 1, agreementId: a1.AgreementId))).Draft!;

        Assert.Equal((1, 2), (b1.Version, a2.Version));
        // B is still at version 1: a save of B from base 2 (A's number) is stale, from base 1 is not.
        Assert.Equal(1, (await SaveAsync(f, Request(SaturdayBlock(), baseVersion: 2, agreementId: b1.AgreementId))).ConflictVersion);
        Assert.NotNull((await SaveAsync(f, Request(SaturdayBlock(), baseVersion: 1, agreementId: b1.AgreementId))).Draft);
        // Kind carries from the base revision when the save leaves it out.
        Assert.Equal(AgreementKind.Trip, (await f.Db.ServiceAgreementDrafts.AsNoTracking().Where(d => d.AgreementId == b1.AgreementId).OrderByDescending(d => d.Version).FirstAsync()).AgreementKind);
    }

    [Fact]
    public async Task Save_NoAgreementId_TwoAgreements_IsRefused_AndOneAgreement_SavesIntoIt()
    {
        await using var f = await SetUpWithCatalogueAsync();
        var a1 = (await SaveAsync(f, Request(WeekdayBlock(), newAgreement: true, kind: AgreementKind.Core))).Draft!;
        var into = (await SaveAsync(f, Request(WeekdayBlock(), baseVersion: 1))).Draft!;
        Assert.Equal((a1.AgreementId, 2), (into.AgreementId, into.Version));

        await SaveAsync(f, Request(SaturdayBlock(), newAgreement: true, kind: AgreementKind.Trip));
        var before = await f.Db.ServiceAgreementDrafts.CountAsync();
        var refused = await SaveAsync(f, Request(WeekdayBlock(), baseVersion: 2));

        Assert.True(refused.AgreementChoiceRequired);
        Assert.Equal(before, await f.Db.ServiceAgreementDrafts.CountAsync());
    }

    [Fact]
    public async Task Save_ForeignAgreementId_Is404_NothingWritten()
    {
        await using var f = await SetUpWithCatalogueAsync();
        var other = new Participant { Id = Guid.NewGuid(), TenantId = TenantA, FirstName = "Bea", LastName = "Li", IsActive = true };
        f.Db.Participants.Add(other);
        await f.Db.SaveChangesAsync();
        var theirs = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, participantId: other.Id, agreementId: Guid.NewGuid());
        var before = await f.Db.ServiceAgreementDrafts.CountAsync();

        var sameTenant = await SaveAsync(f, Request(WeekdayBlock(), baseVersion: 1, agreementId: theirs.AgreementId));
        var unknown = await SaveAsync(f, Request(WeekdayBlock(), baseVersion: 1, agreementId: Guid.NewGuid()));

        Assert.True(sameTenant.NotFound && unknown.NotFound);
        Assert.Equal("Agreement not found.", sameTenant.Errors.Single());
        Assert.Equal(before, await f.Db.ServiceAgreementDrafts.CountAsync());
    }

    [Theory]
    [InlineData(false, 0, 0, null, "Choose the agreement type.")]
    [InlineData(true, 1, 0, null, "Start a new agreement from nothing, or revise an existing one, not both.")]
    [InlineData(true, 0, 99, null, "Choose an agreement type from the list.")]
    [InlineData(true, 0, 0, "x", "Keep the agreement name to 80 characters.")]
    public async Task Save_RefusesWhatTheStoredInputRulesRefuse(bool withKind, int baseVersion, int kindValue, string? longName, string message)
    {
        await using var f = await SetUpWithCatalogueAsync();
        var kind = kindValue == 99 ? (AgreementKind)99 : withKind ? AgreementKind.Core : (AgreementKind?)null;
        var request = Request(WeekdayBlock(), baseVersion: baseVersion, newAgreement: true, kind: kind, name: longName is null ? null : new string('x', 81));
        if (baseVersion > 0) request = request with { AgreementId = null };

        var result = await SaveAsync(f, request);

        Assert.Null(result.Draft);
        Assert.Equal(message, result.Errors.Single());
        Assert.Equal(0, await f.Db.ServiceAgreementDrafts.CountAsync());
    }

    /// <summary>M3: saving B (its version 2) must not delete A's waiting version 1 as an "unused older revision".</summary>
    [Fact]
    public async Task SaveB_NeverDeletesAsWaitingDraft()
    {
        await using var f = await SetUpWithCatalogueAsync();
        var a = (await SaveAsync(f, Request(WeekdayBlock(), newAgreement: true, kind: AgreementKind.Core))).Draft!;
        var b1 = (await SaveAsync(f, Request(SaturdayBlock(), newAgreement: true, kind: AgreementKind.Trip))).Draft!;
        var b2 = await SaveAsync(f, Request(SaturdayBlock(), baseVersion: 1, agreementId: b1.AgreementId));

        Assert.NotNull(b2.Draft);
        Assert.True(await f.Db.ServiceAgreementDrafts.AnyAsync(d => d.Id == a.Id));
        Assert.False(await f.Db.ServiceAgreementDrafts.AnyAsync(d => d.Id == b1.Id));   // B's own unused v1 is replaced, as for one agreement
    }

    // ── Approval, roster and shifts (F7) ──────────────────────────────────────────

    [Fact]
    public async Task Approve_RowCarriesTheAgreementId()
    {
        var (f, a, b) = await TwoApprovedAsync();
        await using var owner = f;
        var rows = await f.Db.ServiceAgreementDraftApprovals.AsNoTracking().ToListAsync();
        Assert.Equal(new[] { a.AgreementId, b.AgreementId }.Order(), rows.Select(r => r.AgreementId).Order());
    }

    /// <summary>M1: approving B (version 2) must not read A's version 1 as an earlier revision and end A's patterns.</summary>
    [Fact]
    public async Task ApproveB_LeavesAsPatternsActive()
    {
        var (f, a, _) = await TwoApprovedAsync();
        await using var owner = f;
        var patterns = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == a.Id).ToListAsync();
        Assert.NotEmpty(patterns);
        Assert.All(patterns, p => Assert.True(p.IsActive));
    }

    /// <summary>M2: approving B must not remove A's future shifts as an earlier revision's.</summary>
    [Fact]
    public async Task ApproveB_LeavesAsFutureShifts()
    {
        var (f, a) = await ApprovedAWithRosterAsync();
        await using var owner = f;
        var patternIds = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == a.Id).Select(p => p.Id).ToListAsync();
        var before = await f.Db.Shifts.CountAsync(s => patternIds.Contains(s.ShiftPatternId!.Value));
        Assert.True(before > 0);

        await ApproveAsync(f, await AddRevisionAsync(f, 2, new[] { SaturdayBlock() }, agreementId: Guid.NewGuid()));

        Assert.Equal(before, await f.Db.Shifts.CountAsync(s => patternIds.Contains(s.ShiftPatternId!.Value)));
    }

    /// <summary>S2 (M2 alone): approving B version 2 over its own version 1 reports and removes only B-agreement shifts, none of A, whose roster is made.</summary>
    [Fact]
    public async Task ApproveB_OldShiftsIgnoreAgreementA()
    {
        var (f, a) = await ApprovedAWithRosterAsync();
        await using var owner = f;
        var agreementB = Guid.NewGuid();
        await ApproveAsync(f, await AddRevisionAsync(f, 1, new[] { SaturdayBlock() }, agreementId: agreementB));
        var aShifts = await f.Db.Shifts.CountAsync();
        var b2 = await AddRevisionAsync(f, 2, new[] { SaturdayBlock() }, agreementId: agreementB);

        var outcome = await f.Service.ApproveAsync(TenantA, f.ParticipantId, b2.Id, true, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.Approved, outcome.Status);
        Assert.True(aShifts > 0);
        Assert.Equal((0, 0, 0), (outcome.OldShifts!.Open, outcome.OldShifts.Assigned, outcome.OldShifts.Removed));
        Assert.Equal(aShifts, await f.Db.Shifts.CountAsync());
    }

    /// <summary>S1: B being at version 2 does not make A's waiting version 1 "superseded".</summary>
    [Fact]
    public async Task PreviewA_NotSupersededByBsNewerVersion()
    {
        await using var f = await SetUpWithCatalogueAsync();
        var a = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, agreementId: f.ParticipantId);
        await AddRevisionAsync(f, 2, new[] { SaturdayBlock() }, agreementId: Guid.NewGuid());

        var preview = await f.Service.PreviewAsync(TenantA, f.ParticipantId, a.Id, Admin, CancellationToken.None);

        Assert.Equal(ApprovalStatus.Previewed, preview.Status);
        Assert.Equal(1, preview.NewestVersion);
        Assert.DoesNotContain("Superseded", preview.ReasonCodes ?? []);
        await ApproveAsync(f, a);
    }

    /// <summary>S4: B's approval is not "a newer revision approved" for A's roster.</summary>
    [Fact]
    public async Task PopulateA_NotRefusedByBsApproval()
    {
        var (f, a, _) = await TwoApprovedAsync(populateA: false);
        await using var owner = f;

        var totals = await PopulateAllAsync(f.Service, f.ParticipantId, a.Id);

        Assert.True(totals.Created > 0);
    }

    /// <summary>S6: renewing A copies A's own newest approved revision, not the participant's highest, and keeps A's kind and name.</summary>
    [Fact]
    public async Task Renewal_StaysInItsAgreement_CopiesKindAndName()
    {
        var (f, a, b) = await TwoApprovedAsync(populateA: false);
        await using var owner = f;
        (a.AgreementKind, a.AgreementName, b.AgreementKind, b.AgreementName) = (AgreementKind.Core, "Day support", AgreementKind.Trip, "Beach trip");
        f.Db.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, PlanStart = PlanStart, PlanEnd = PlanEnd });
        await f.Db.SaveChangesAsync();

        var outcome = await new AgreementRenewalService(f.Db).RenewAsync(TenantA, f.ParticipantId, a.Id, Admin, "coordinator-1", CancellationToken.None);

        var renewed = await f.Db.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks).SingleAsync(d => d.Id == outcome.Draft!.Id);
        Assert.Equal((a.AgreementId, 2, AgreementKind.Core, "Day support"), (renewed.AgreementId, renewed.Version, renewed.AgreementKind, renewed.AgreementName));
        Assert.Equal(a.Blocks.Select(x => x.BlockKey), renewed.Blocks.OrderBy(x => x.Position).Select(x => x.BlockKey));
    }

    /// <summary>S7: bulk answers once per agreement; B's waiting revision skips B only.</summary>
    [Fact]
    public async Task Bulk_OneRowPerAgreement_SkipsOnlyTheWaitingOne()
    {
        var (f, a, b) = await TwoApprovedAsync(populateA: false);
        await using var owner = f;
        await AddPlanAsync(f, f.ParticipantId, PlanStart, PlanEnd);
        await AddRevisionAsync(f, 3, new[] { SaturdayBlock() }, agreementId: b.AgreementId);   // B has a draft waiting

        var items = await RunAsync(f, "renew", new[] { f.ParticipantId });

        Assert.Equal(2, items.Count);
        var itemA = items.Single(i => i.AgreementId == a.AgreementId);
        var itemB = items.Single(i => i.AgreementId == b.AgreementId);
        Assert.Equal("Created", itemA.Outcome);
        Assert.Equal(a.AgreementId, (await f.Db.ServiceAgreementDrafts.AsNoTracking().SingleAsync(d => d.Id == itemA.NewDraftId)).AgreementId);
        Assert.Equal(("Skipped", AgreementBulkService.WaitingWords), (itemB.Outcome, itemB.Reason));
    }

    /// <summary>S7: the Agreements list has a row per agreement, each showing its own revisions.</summary>
    [Fact]
    public async Task AgreementsList_TwoRowsForTwoAgreements()
    {
        var (f, a, b) = await TwoApprovedAsync(populateA: false);
        await using var owner = f;

        var ok = Assert.IsType<OkObjectResult>((await AgreementListTests.Controller(f.Db, f).List(CancellationToken.None)).Result);
        var rows = Assert.IsType<ApiResponse<AgreementListDto>>(ok.Value).Data!.Rows;

        Assert.Equal(2, rows.Count);
        Assert.Equal(a.Id, rows.Single(r => r.AgreementId == a.AgreementId).Current!.DraftId);
        Assert.Equal(b.Id, rows.Single(r => r.AgreementId == b.AgreementId).Current!.DraftId);
    }

    /// <summary>S8: the drafts list gives each agreement's newest revision in full and its older ones as summaries, the most recently changed agreement first.</summary>
    [Fact]
    public async Task List_NewestOfEachAgreementInFull_OrderedByLastChange()
    {
        await using var f = await SetUpWithCatalogueAsync();
        var (idA, idB) = (f.ParticipantId, Guid.NewGuid());
        var a1 = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, agreementId: idA);
        var a2 = await AddRevisionAsync(f, 2, new[] { WeekdayBlock() }, agreementId: idA);
        var b1 = await AddRevisionAsync(f, 1, new[] { SaturdayBlock() }, agreementId: idB);
        var t0 = new DateTime(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);
        (a1.CreatedAt, a2.CreatedAt, b1.CreatedAt) = (t0, t0.AddHours(1), t0.AddHours(2));
        await f.Db.SaveChangesAsync();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(TenantA);
        var controller = new ServiceAgreementDraftsController(f.Db, tenant.Object, new ServiceAgreementDraftService(f.Db), approval: f.Service);

        var list = Assert.IsType<ApiResponse<List<ServiceAgreementDraftDto>>>(Assert.IsType<OkObjectResult>((await controller.List(f.ParticipantId, CancellationToken.None)).Result).Value).Data!;

        Assert.Equal(new[] { b1.Id, a2.Id, a1.Id }, list.Select(d => d.Id));
        Assert.Equal(new[] { false, false, true }, list.Select(d => d.IsSummary));
        Assert.All(list.Take(2), d => Assert.NotEmpty(d.Blocks));
    }

    /// <summary>A approved at version 1 with its roster made (no B yet).</summary>
    private static async Task<(Fixture F, ServiceAgreementDraft A)> ApprovedAWithRosterAsync()
    {
        var f = await SetUpWithCatalogueAsync();
        var a = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, agreementId: f.ParticipantId);
        await ApproveAsync(f, a);
        await PopulateAllAsync(f.Service, f.ParticipantId, a.Id);
        return (f, a);
    }

    [Fact]
    public async Task EndEarlyA_NotRefusedByBWaiting()
    {
        await using var f = await SetUpWithCatalogueAsync();
        var a = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, agreementId: f.ParticipantId);
        await ApproveAsync(f, a);
        await AddRevisionAsync(f, 2, new[] { SaturdayBlock() }, agreementId: Guid.NewGuid());   // B waits with a higher number

        var outcome = await f.Service.EndEarlyAsync(TenantA, f.ParticipantId, a.Id, new DateOnly(2026, 11, 13), Admin, CancellationToken.None);

        Assert.Equal(EndEarlyStatus.Ended, outcome.Status);
    }

    // ── Reads: ending, list, latest, readiness ────────────────────────────────────

    [Fact]
    public async Task Ending_TripShowsBesideLongDaySupport_AndLatestIsPerAgreement()
    {
        var (f, a, b) = await TwoApprovedAsync();
        await using var owner = f;
        b.AgreementKind = AgreementKind.Trip;
        b.AgreementName = "Beach trip";
        await f.Db.SaveChangesAsync();

        var ending = await AgreementEnding.FindAsync(f.Db, new[] { f.ParticipantId }, new DateOnly(2026, 12, 1), CancellationToken.None);
        var latest = await AgreementRevisions.LatestPerAgreementAsync(f.Db, TenantA, new[] { f.ParticipantId }, CancellationToken.None);

        Assert.Equal(new[] { a.AgreementId, b.AgreementId }.Order(), ending.Select(r => r.AgreementId).Order());
        Assert.Equal((AgreementKind.Trip, "Beach trip"), (ending.Single(r => r.AgreementId == b.AgreementId).AgreementKind, ending.Single(r => r.AgreementId == b.AgreementId).AgreementName));
        Assert.Equal(2, latest.Count);
        Assert.Equal((1, 2), (latest[(f.ParticipantId, a.AgreementId)].Current!.Version, latest[(f.ParticipantId, b.AgreementId)].Current!.Version));
    }

    [Fact]
    public async Task Readiness_ApprovedPlusDraftIsReady_ApprovedPlusBrokenApprovedIsNot()
    {
        var (f, a, b) = await TwoApprovedAsync();
        await using var owner = f;
        var ready = () => ParticipantReadinessGate.ServiceNeedsParticipants(f.Db).AnyAsync(p => p.Id == f.ParticipantId);
        Assert.True(await ready());

        // A half-typed third agreement (no approval, no lines) does not block a participant whose approved agreements are in order.
        f.Db.ServiceAgreementDrafts.Add(new ServiceAgreementDraft { Id = Guid.NewGuid(), TenantId = TenantA, ParticipantId = f.ParticipantId, AgreementId = Guid.NewGuid(), Version = 1, State = "NSW", ParticipantNameSnapshot = "Amy Ng" });
        await f.Db.SaveChangesAsync();
        Assert.True(await ready());

        // Breaking an approved agreement's newest revision (no lines) does.
        var broken = await AddRevisionAsync(f, 3, new[] { SaturdayBlock() }, handTyped: true, agreementId: b.AgreementId);
        broken.Lines.Clear();
        await f.Db.SaveChangesAsync();
        Assert.False(await ready());
    }

    /// <summary>S9: signing evidence for A is not "superseded" by B's higher version. (The template is not approved for signing here, so the call ends at that later refusal.)</summary>
    [Fact]
    public async Task SigningA_NotSupersededByB()
    {
        await using var f = await SetUpWithCatalogueAsync();
        var a = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, agreementId: f.ParticipantId);
        await AddRevisionAsync(f, 2, new[] { SaturdayBlock() }, agreementId: Guid.NewGuid());

        var (_, error) = await new ElectronicSigningEvidenceService(f.Db).CreateSnapshotAsync(TenantA, f.ParticipantId, new() { DraftId = a.Id, DraftVersion = 1 }, CancellationToken.None);

        Assert.NotEqual(ElectronicSigningEvidenceService.SupersededDraftError, error);
    }
}
