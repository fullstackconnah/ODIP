using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Xunit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
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
    private static async Task<(Fixture F, ServiceAgreementDraft A, ServiceAgreementDraft B)> TwoApprovedAsync()
    {
        var f = await SetUpWithCatalogueAsync();
        var a = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() }, agreementId: f.ParticipantId);
        await ApproveAsync(f, a);
        await PopulateAllAsync(f.Service, f.ParticipantId, a.Id);
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
        var (f, a, _) = await TwoApprovedAsync();
        await using var owner = f;
        var patternIds = await f.Db.ShiftPatterns.AsNoTracking().Where(p => p.SourceDraftId == a.Id).Select(p => p.Id).ToListAsync();
        Assert.True(await f.Db.Shifts.CountAsync(s => patternIds.Contains(s.ShiftPatternId!.Value)) > 0);
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
}
