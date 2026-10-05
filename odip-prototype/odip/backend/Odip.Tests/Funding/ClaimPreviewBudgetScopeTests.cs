using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// Budget feature, phase 2a — regression for ledger security audit F-1: the two claim previews
/// carried a money block, and they are the only money-bearing endpoints in the feature that never
/// read <see cref="ICurrentTenant"/>. A SuperAdmin with no <c>X-View-As-Tenant</c> header keeps
/// <c>IsSuperAdmin == true</c> (see <c>CurrentTenant</c>), which is the first term of every
/// tenant-filtered query, so the foreign trip / participant resolved and the preview computed
/// <em>that organisation's</em> whole funding position. The generators used to pass the record's own
/// <c>TenantId</c> to the ledger, so a guard on a null <c>TenantId</c> alone would not have closed
/// it: a SuperAdmin whose JWT carries its own <c>tenant_id</c> is not null and is still unfiltered.
///
/// Each test is written as "returns no other organisation's money", so it passes only on a refusal
/// or an empty block, and fails on any populated figure. The five caller states from the audit are
/// each covered, plus the two that must keep working.
/// </summary>
public class ClaimPreviewBudgetScopeTests
{
    private static readonly CancellationToken Ct = default;

    private static Mock<ICurrentTenant> Tenant(Guid? tenantId, bool isSuperAdmin)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(isSuperAdmin);
        tenant.Setup(t => t.ViewAsUserId).Returns((Guid?)null);
        return tenant;
    }

    private static ClaimsController Controller(
        Odip.Infrastructure.Data.OdipDbContext db,
        ICurrentTenant tenant,
        BudgetLedgerService? ledger = null) =>
        new(db,
            new ClaimGenerationService(db, ledger, tenant),
            new ShiftClaimGenerationService(db, ledger, tenant),
            new BprCsvService(db),
            new InvoiceService(db),
            ledger ?? new BudgetLedgerService(db, TimeProvider.System),
            tenant);

    // ── The leak: a SuperAdmin with no organisation chosen ───────────────────

    [Fact]
    public async Task ATripClaimPreviewByASuperAdminWithNoOrganisationChosenCarriesNoBudgetAtAll()
    {
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero));
        kit.SeedProvider();
        kit.SeedCommunityAccessCatalogue();
        var orgB = kit.SeedParticipant(tenantId: kit.TenantId, last: "Blue");
        kit.SeedPlan(orgB, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        kit.SeedBooking(trip, orgB);

        // Byte-for-byte what CurrentTenant builds for a SuperAdmin with no header: no tenant_id claim.
        var caller = Tenant(null, isSuperAdmin: true);
        var controller = Controller(kit.Db, caller.Object, kit.Ledger);

        var result = await controller.PreviewClaim(trip.Id, new ClaimPreviewRequestDto(), Ct);

        // The preview itself is answered — the endpoint has always returned the lines and total
        // to any caller [Authorize] admits, and the budget finding is not a reason to change that.
        var preview = ExtractPreview(result.Result);
        Assert.True(preview.LineItems.Count > 0);
        // But no figure of any organisation's, which is what the block would have been.
        Assert.Null(preview.Budget);
    }

    [Fact]
    public async Task AShiftClaimPreviewByASuperAdminWithNoOrganisationChosenCarriesNoBudgetAtAll()
    {
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero));
        kit.SeedCommunityAccessCatalogue();
        var orgB = kit.SeedParticipant(tenantId: kit.TenantId, last: "Blue");
        kit.SeedPlan(orgB, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        kit.SeedShift(orgB, new DateOnly(2026, 10, 6), ShiftStatus.Completed);

        var caller = Tenant(null, isSuperAdmin: true);
        var controller = Controller(kit.Db, caller.Object, kit.Ledger);

        var result = await controller.PreviewShiftClaim(orgB.Id, new GenerateShiftClaimRequestDto
        {
            From = new DateOnly(2026, 10, 1),
            To = new DateOnly(2026, 10, 31)
        }, Ct);

        var preview = ExtractShiftPreview(result.Result);
        Assert.True(preview.LineItems.Count > 0);
        Assert.Null(preview.Budget);
    }

    // ── The case the audit's first draft missed: a non-null TenantId is not safety ──

    [Fact]
    public async Task ATripClaimPreviewByASuperAdminWhoseJwtCarriesItsOwnTenantStillCarriesNoForeignBudget()
    {
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero));
        kit.SeedProvider();
        kit.SeedCommunityAccessCatalogue();
        var homeTenant = Guid.NewGuid();
        // A participant of ANOTHER organisation, reached by the unfiltered SuperAdmin context.
        var orgB = kit.SeedParticipant(tenantId: kit.TenantId, last: "Blue");
        kit.SeedPlan(orgB, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        kit.SeedBooking(trip, orgB);

        // TenantId is SET (the SuperAdmin's own home tenant) and IsSuperAdmin is still true: the
        // filter is bypassed, so this is exactly the state a null-TenantId guard would let through.
        var caller = Tenant(homeTenant, isSuperAdmin: true);
        var controller = Controller(kit.Db, caller.Object, kit.Ledger);

        var result = await controller.PreviewClaim(trip.Id, new ClaimPreviewRequestDto(), Ct);

        // the trip resolves, and that is correct
        Assert.Null(ExtractPreview(result.Result).Budget);   // but no figure of the trip's organisation
    }

    [Fact]
    public async Task AShiftClaimPreviewByASuperAdminWhoseJwtCarriesItsOwnTenantStillCarriesNoForeignBudget()
    {
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero));
        kit.SeedCommunityAccessCatalogue();
        var homeTenant = Guid.NewGuid();
        var orgB = kit.SeedParticipant(tenantId: kit.TenantId, last: "Blue");
        kit.SeedPlan(orgB, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        kit.SeedShift(orgB, new DateOnly(2026, 10, 6), ShiftStatus.Completed);

        var caller = Tenant(homeTenant, isSuperAdmin: true);
        var controller = Controller(kit.Db, caller.Object, kit.Ledger);

        var result = await controller.PreviewShiftClaim(orgB.Id, new GenerateShiftClaimRequestDto
        {
            From = new DateOnly(2026, 10, 1),
            To = new DateOnly(2026, 10, 31)
        }, Ct);

        // the participant resolves, and that is correct
        Assert.Null(ExtractShiftPreview(result.Result).Budget);   // but no figure of their organisation
    }

    // ── The service backstop: an entity's own tenant id is never the answer ──

    [Fact]
    public async Task TheLedgerRefusesLinesWhoseParticipantsAreNotInsideTheTenantItIsGiven()
    {
        var when = new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero);
        var now = LedgerKit.Create(now: when);
        now.SeedCommunityAccessCatalogue();
        // A participant of this organisation, and one of another. "Foreign" has to mean a different
        // tenant, or the guard is right to let it through.
        var own = now.SeedParticipant(tenantId: LedgerKit.TenantA, last: "Own");
        var foreign = now.SeedParticipant(tenantId: LedgerKit.TenantB, last: "Blue");
        now.SeedPlan(own, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        now.SeedPlan(foreign, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        var shift = now.SeedShift(foreign, new DateOnly(2026, 10, 6), ShiftStatus.Completed);

        // Naming organisation A and A's own participant is A's own business and must keep working.
        var forItsOwnOrg = await now.Ledger.EffectOfLinesAsync(
            LedgerKit.TenantA, new[] { new ClaimEffectLine(own.Id, shift.ServiceDate, 4, PlanType.PlanManaged, 480m, shift.Id, null) }, Ct);
        Assert.NotNull(forItsOwnOrg);
        Assert.Equal(own.Id, Assert.Single(forItsOwnOrg!.Participants).ParticipantId);

        // Asked for organisation A, naming organisation B's participant: no figure, not B's.
        var wrongTenant = await now.Ledger.EffectOfLinesAsync(
            LedgerKit.TenantA, new[] { new ClaimEffectLine(foreign.Id, shift.ServiceDate, 4, PlanType.PlanManaged, 480m, null, null) }, Ct);
        Assert.Null(wrongTenant);

        // One foreign participant poisons the call, so a partial figure is never returned.
        var mixed = await now.Ledger.EffectOfLinesAsync(
            LedgerKit.TenantA,
            new[]
            {
                new ClaimEffectLine(own.Id, shift.ServiceDate, 4, PlanType.PlanManaged, 480m, null, null),
                new ClaimEffectLine(foreign.Id, shift.ServiceDate, 4, PlanType.PlanManaged, 480m, null, null)
            }, Ct);
        Assert.Null(mixed);

        // And the other organisation, asking about itself on its own scoped context, still answers:
        // the guard is about which tenant is named, not about the second tenant being unreadable.
        var other = LedgerKit.Create(LedgerKit.TenantB, now: when);
        other.SeedCommunityAccessCatalogue();
        var theirPerson = other.SeedParticipant(tenantId: LedgerKit.TenantB, last: "Theirs");
        other.SeedPlan(theirPerson, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        var theirShift = other.SeedShift(theirPerson, new DateOnly(2026, 10, 6), ShiftStatus.Completed);
        var theirOwn = await other.Ledger.EffectOfLinesAsync(
            LedgerKit.TenantB, new[] { new ClaimEffectLine(theirPerson.Id, theirShift.ServiceDate, 4, PlanType.PlanManaged, 480m, theirShift.Id, null) }, Ct);
        Assert.NotNull(theirOwn);
        Assert.True(Assert.Single(theirOwn!.Participants).Rows.Count > 0);
    }

    [Fact]
    public async Task ALineForTheCallersOwnParticipantInTheCallersOwnTenantStillReturnsAFigure()
    {
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero));
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        var shift = kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.Completed);

        var block = await kit.Ledger.EffectOfLinesAsync(
            kit.TenantId, new[] { new ClaimEffectLine(person.Id, shift.ServiceDate, 4, PlanType.PlanManaged, 480m, shift.Id, null) }, Ct);

        Assert.NotNull(block);                                  // the backstop did not swallow the feature
        var row = Assert.Single(Assert.Single(block!.Participants).Rows);
        Assert.True(row.Available > 0m);
    }

    // ── The states that must keep working: the fix may not break them ──

    [Fact]
    public async Task AnAdminOfTheirOwnOrganisationStillSeesTheirOwnBudgetsTripPreview()
    {
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero));
        kit.SeedProvider();
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        kit.SeedBooking(trip, person);

        var caller = Tenant(kit.TenantId, isSuperAdmin: false);
        var controller = Controller(kit.Db, caller.Object, kit.Ledger);

        var result = await controller.PreviewClaim(trip.Id, new ClaimPreviewRequestDto(), Ct);
        var preview = ExtractPreview(result.Result);
        Assert.NotNull(preview.Budget);
        Assert.Equal(person.Id, Assert.Single(preview.Budget!.Participants).ParticipantId);
    }

    [Fact]
    public async Task AnAdminOfTheirOwnOrganisationStillSeesTheirOwnBudgetShiftPreview()
    {
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero));
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.Completed);

        var caller = Tenant(kit.TenantId, isSuperAdmin: false);
        var controller = Controller(kit.Db, caller.Object, kit.Ledger);

        var result = await controller.PreviewShiftClaim(person.Id, new GenerateShiftClaimRequestDto
        {
            From = new DateOnly(2026, 10, 1),
            To = new DateOnly(2026, 10, 31)
        }, Ct);
        var preview = ExtractShiftPreview(result.Result);
        Assert.NotNull(preview.Budget);
        Assert.Equal(person.Id, Assert.Single(preview.Budget!.Participants).ParticipantId);
    }

    [Fact]
    public async Task ASuperAdminViewingAsTheOrganisationStillSeesThatOrganisationsBudget()
    {
        // X-View-As-Tenant: CurrentTenant sets TenantId to the chosen org and IsSuperAdmin to false,
        // so this is the intended explicit selection and must be untouched by the fix.
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero));
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        kit.SeedShift(person, new DateOnly(2026, 10, 6), ShiftStatus.Completed);

        var caller = Tenant(kit.TenantId, isSuperAdmin: false);
        var controller = Controller(kit.Db, caller.Object, kit.Ledger);

        var result = await controller.PreviewShiftClaim(person.Id, new GenerateShiftClaimRequestDto
        {
            From = new DateOnly(2026, 10, 1),
            To = new DateOnly(2026, 10, 31)
        }, Ct);
        var preview = ExtractShiftPreview(result.Result);
        Assert.NotNull(preview.Budget);
        Assert.Equal(person.Id, Assert.Single(preview.Budget!.Participants).ParticipantId);
    }

    [Fact]
    public async Task ACoordinatorOfTheirOwnOrganisationStillSeesTheirOwnBudget()
    {
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero));
        kit.SeedProvider();
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 5000m), Q(2, 5000m), Q(3, 5000m), Q(4, 5000m)));
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        kit.SeedBooking(trip, person);

        var caller = Tenant(kit.TenantId, isSuperAdmin: false);
        var controller = Controller(kit.Db, caller.Object, kit.Ledger);

        var result = await controller.PreviewClaim(trip.Id, new ClaimPreviewRequestDto(), Ct);
        Assert.NotNull(ExtractPreview(result.Result).Budget);
    }

    [Fact]
    public async Task APreviewForAParticipantWithNoPlanStillCarriesNoBudgetAndTheSameTotal()
    {
        // The pre-existing "no figure" case must survive: the fix is a scope guard, not a change
        // to when a block appears.
        var kit = LedgerKit.Create(now: new DateTimeOffset(2026, 10, 4, 0, 0, 0, TimeSpan.Zero));
        kit.SeedProvider();
        kit.SeedCommunityAccessCatalogue();
        var trip = kit.SeedTrip(new DateOnly(2026, 10, 20), 3);
        kit.SeedBooking(trip, kit.SeedParticipant());

        var caller = Tenant(kit.TenantId, isSuperAdmin: false);
        var controller = Controller(kit.Db, caller.Object, kit.Ledger);
        var withLedger = ExtractPreview((await controller.PreviewClaim(trip.Id, new ClaimPreviewRequestDto(), Ct)).Result);
        var withoutLedger = ExtractPreview((await Controller(kit.Db, caller.Object).PreviewClaim(trip.Id, new ClaimPreviewRequestDto(), Ct)).Result);

        Assert.Null(withLedger.Budget);
        Assert.Null(withoutLedger.Budget);
        Assert.Equal(withoutLedger.TotalAmount, withLedger.TotalAmount);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static ClaimPreviewResponseDto ExtractPreview(ActionResult? result) => Ok<ClaimPreviewResponseDto>(result).Data!;

    private static ShiftClaimPreviewResponseDto ExtractShiftPreview(ActionResult? result) => Ok<ShiftClaimPreviewResponseDto>(result).Data!;

    private static ApiResponse<T> Ok<T>(ActionResult? result) =>
        Assert.IsType<ApiResponse<T>>(Assert.IsType<OkObjectResult>(result).Value);

}
