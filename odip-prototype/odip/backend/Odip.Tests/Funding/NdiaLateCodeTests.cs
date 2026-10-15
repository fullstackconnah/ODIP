using Microsoft.AspNetCore.Mvc;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// "Record the NDIA code" on a claim that was marked Rejected before the day it was rejected was kept (budget phase 2b, fix round 2): such a claim has no <c>RejectedDate</c>, and the NDIA's word
/// (the alert and the Funding tab's note) needs a day, so a code recorded on it would be stored and never used. Recording the code is the first day the claim is known to have been refused, so it
/// stamps that day, once, from the injected clock (the funding tests' fixed 4 Oct 2026, 13:00 in the provider's Sydney).
/// </summary>
public class NdiaLateCodeTests
{
    private static LedgerKit Arrange(out Participant person)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        person = kit.SeedParticipant();
        var plan = kit.SeedPlan(person, D(2026, 10, 1), D(2027, 6, 30), Core(PlanType.PlanManaged, Q(2, 8000m), Q(3, 8000m), Q(4, 8000m)));
        plan.CreatedAt = new DateTime(2026, 9, 20, 0, 0, 0, DateTimeKind.Utc);
        kit.Db.SaveChanges();
        return kit;
    }

    /// <summary>A claim rejected before the day was kept: Rejected, with no code and no day, for a shift in the running quarter.</summary>
    private static TripClaim UndatedRejectedClaim(LedgerKit kit, Participant person)
    {
        var shift = kit.SeedShift(person, D(2026, 10, 2), ShiftStatus.Completed);
        var claim = kit.SeedShiftClaim(person, TripClaimStatus.Rejected, 400m, shift);
        Assert.Null(claim.RejectedDate);
        return claim;
    }

    private static ClaimsController ClaimsOf(LedgerKit kit) =>
        new(kit.Db, new ClaimGenerationService(kit.Db), new ShiftClaimGenerationService(kit.Db), new BprCsvService(kit.Db), new InvoiceService(kit.Db), kit.Ledger, kit.Tenant!, kit.Clock);

    private static Task<ActionResult<ApiResponse<bool>>> Put(LedgerKit kit, Guid claimId, UpdateClaimDto dto) => ClaimsOf(kit).UpdateClaim(claimId, dto, CancellationToken.None);

    private static async Task<List<ParticipantAlertDto>> BudgetAlertsAsync(LedgerKit kit, Guid participantId)
    {
        var service = new ParticipantAlertsService(kit.Db, kit.Clock, new BudgetAlertSource(kit.Ledger, new NdiaRejectionReader(kit.Db, kit.Clock), kit.Tenant!));
        return (await service.GetAlertsAsync(participantId)).Single().Alerts.Where(a => a.Type.StartsWith("budget-", StringComparison.Ordinal)).ToList();
    }

    private static async Task<NdiaRejectionDto?> CoreNoteAsync(LedgerKit kit, Guid participantId)
    {
        var controller = new ParticipantFundingLedgerController(kit.Tenant!, kit.Ledger, new NdiaRejectionReader(kit.Db, kit.Clock));
        var ok = Assert.IsType<OkObjectResult>((await controller.Ledger(participantId, CancellationToken.None)).Result);
        return Assert.IsType<ApiResponse<ParticipantLedgerDto>>(ok.Value).Data!.Pools.Single(p => p.Kind == FundingPoolKind.CoreFlexible).NdiaRejection;
    }

    [Fact]
    public async Task ACodeRecordedOnAnUndatedRejectedClaim_StampsTheDay_SoTheAlertAndTheFundingNoteAppear()
    {
        using var kit = Arrange(out var person);
        var claim = UndatedRejectedClaim(kit, person);
        Assert.Empty(await BudgetAlertsAsync(kit, person.Id));
        Assert.Null(await CoreNoteAsync(kit, person.Id));

        var result = await Put(kit, claim.Id, new UpdateClaimDto { RejectionCode = "V27" });

        Assert.Equal(200, Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode ?? 200);
        kit.Db.ChangeTracker.Clear();
        var stored = kit.Db.TripClaims.Single(c => c.Id == claim.Id);
        Assert.Equal(("V27", FundingTestKit.Now.UtcDateTime), (stored.RejectionCode, stored.RejectedDate));
        var alert = Assert.Single(await BudgetAlertsAsync(kit, person.Id));
        Assert.Equal("budget-ndia-exhausted", alert.Type);
        var note = Assert.IsType<NdiaRejectionDto>(await CoreNoteAsync(kit, person.Id));
        Assert.Equal((new DateOnly(2026, 10, 4), "V27", claim.Id), (note.Date, note.Code, note.ClaimId));
    }

    [Fact]
    public async Task ACodeRecordedOnAClaimThatHasItsDay_NeverMovesTheDay()
    {
        using var kit = Arrange(out var person);
        var claim = UndatedRejectedClaim(kit, person);
        var rejectedAt = FundingTestKit.Now.UtcDateTime.AddDays(-3);
        claim.RejectedDate = rejectedAt;
        kit.Db.SaveChanges();

        await Put(kit, claim.Id, new UpdateClaimDto { RejectionCode = "V18" });

        kit.Db.ChangeTracker.Clear();
        Assert.Equal(rejectedAt, kit.Db.TripClaims.Single(c => c.Id == claim.Id).RejectedDate);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("  ")]
    public async Task AWriteThatRecordsNoCode_LeavesAnUndatedClaimUndated(string? code)
    {
        using var kit = Arrange(out var person);
        var claim = UndatedRejectedClaim(kit, person);

        await Put(kit, claim.Id, new UpdateClaimDto { Notes = "Called the NDIA", RejectionCode = code });

        kit.Db.ChangeTracker.Clear();
        var stored = kit.Db.TripClaims.Single(c => c.Id == claim.Id);
        Assert.Null(stored.RejectedDate);
        Assert.Null(stored.RejectionCode);
    }
}
