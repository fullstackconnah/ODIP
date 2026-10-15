using Microsoft.AspNetCore.Mvc;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The Funding tab's note on a pool (budget phase 2b): "NDIA rejected a claim on {date}: not enough funds in the funding period ({code})" (the page words it; the server sends the date, the code and the claim). It rides on the ledger response, on the pool the claim's lines belong to, for as long
/// as the rejection is active (see <see cref="NdiaRejectionReader"/>), and is absent from every other pool. It carries no money.
/// </summary>
public class LedgerNdiaNoteTests
{
    private static ParticipantFundingLedgerController ControllerFor(LedgerKit kit) =>
        new(kit.Tenant!, kit.Ledger, new NdiaRejectionReader(kit.Db, kit.Clock));

    private static LedgerKit Arrange(out Participant person, out FundingPlan plan)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        kit.SeedItem("15_001", 15);
        person = kit.SeedParticipant();
        plan = kit.SeedPlan(person, D(2026, 10, 1), D(2027, 6, 30), Core(PlanType.PlanManaged, Q(2, 8000m), Q(3, 8000m), Q(4, 8000m)), Stated(15, PlanType.PlanManaged, Q(2, 1000m), Q(3, 1000m), Q(4, 1000m)));
        plan.CreatedAt = new DateTime(2026, 9, 20, 0, 0, 0, DateTimeKind.Utc);
        kit.Db.SaveChanges();
        return kit;
    }

    private static TripClaim Reject(LedgerKit kit, Participant person, string code, string? itemCode = null)
    {
        var shift = kit.SeedShift(person, D(2026, 10, 2), ShiftStatus.Completed);
        var claim = kit.SeedShiftClaim(person, TripClaimStatus.Rejected, 400m, shift, itemCode);
        claim.RejectionCode = code;
        claim.RejectedDate = FundingTestKit.Now.UtcDateTime;
        kit.Db.SaveChanges();
        return claim;
    }

    private static ParticipantLedgerDto Ledger(ActionResult<ApiResponse<ParticipantLedgerDto>> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        return Assert.IsType<ApiResponse<ParticipantLedgerDto>>(ok.Value).Data!;
    }

    [Fact]
    public async Task ThePoolOfTheRejectedClaim_CarriesTheNote_AndTheOtherPoolDoesNot()
    {
        using var kit = Arrange(out var person, out var plan);
        var claim = Reject(kit, person, "V27");

        var ledger = Ledger(await ControllerFor(kit).Ledger(person.Id, CancellationToken.None));

        var core = ledger.Pools.Single(p => p.Kind == FundingPoolKind.CoreFlexible);
        var note = Assert.IsType<NdiaRejectionDto>(core.NdiaRejection);
        Assert.Equal((new DateOnly(2026, 10, 4), "V27", claim.Id, claim.ClaimReference), (note.Date, note.Code, note.ClaimId, note.ClaimReference));
        Assert.Null(ledger.Pools.Single(p => p.Kind == FundingPoolKind.Stated).NdiaRejection);
        Assert.Equal(plan.Id, ledger.PlanId);
    }

    [Fact]
    public async Task AClaimOfTheStatedPoolsItem_PutsTheNoteOnTheStatedPool()
    {
        using var kit = Arrange(out var person, out _);
        Reject(kit, person, "V18", itemCode: "15_001");

        var ledger = Ledger(await ControllerFor(kit).Ledger(person.Id, CancellationToken.None));

        Assert.Null(ledger.Pools.Single(p => p.Kind == FundingPoolKind.CoreFlexible).NdiaRejection);
        Assert.Equal("V18", ledger.Pools.Single(p => p.Kind == FundingPoolKind.Stated).NdiaRejection!.Code);
    }

    [Fact]
    public async Task WithNoRejection_NoPoolCarriesANote()
    {
        using var kit = Arrange(out var person, out _);
        Reject(kit, person, "V16");

        var ledger = Ledger(await ControllerFor(kit).Ledger(person.Id, CancellationToken.None));

        Assert.All(ledger.Pools, p => Assert.Null(p.NdiaRejection));
    }

    [Fact]
    public async Task TheNoteEndsWhenALaterFundingPeriodStarts()
    {
        using var kit = Arrange(out var person, out _);
        Reject(kit, person, "V28");
        Assert.NotNull(Ledger(await ControllerFor(kit).Ledger(person.Id, CancellationToken.None)).Pools.Single(p => p.Kind == FundingPoolKind.CoreFlexible).NdiaRejection);

        kit.Clock.Set(new DateTimeOffset(2027, 1, 1, 3, 0, 0, TimeSpan.Zero));

        Assert.Null(Ledger(await ControllerFor(kit).Ledger(person.Id, CancellationToken.None)).Pools.Single(p => p.Kind == FundingPoolKind.CoreFlexible).NdiaRejection);
    }

    [Fact]
    public async Task AParticipantWithNoPlan_StillAnswersWithNoPoolsAndNoNote()
    {
        using var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        var person = kit.SeedParticipant();

        var ledger = Ledger(await ControllerFor(kit).Ledger(person.Id, CancellationToken.None));

        Assert.Empty(ledger.Pools);
    }

    [Fact]
    public async Task TheControllerStillWorksWithoutTheReader_AsItDidBeforeThisPhase()
    {
        using var kit = Arrange(out var person, out _);
        Reject(kit, person, "V27");
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(LedgerKit.TenantA);

        var ledger = Ledger(await new ParticipantFundingLedgerController(tenant.Object, kit.Ledger).Ledger(person.Id, CancellationToken.None));

        Assert.All(ledger.Pools, p => Assert.Null(p.NdiaRejection));
    }
}
