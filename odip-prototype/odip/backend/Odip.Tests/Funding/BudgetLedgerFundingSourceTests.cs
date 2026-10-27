using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// An other-funded participant is left out of NDIS claims (#426), so their shifts could never become claim lines and sat in the ledger as pending NDIS money forever. They have no NDIS
/// ledger at all now; the funding source is read on every call, so switching it back brings the ledger back. The fixed clock is Sunday 4 Oct 2026.
/// </summary>
public class BudgetLedgerFundingSourceTests
{
    private static readonly CancellationToken Ct = CancellationToken.None;

    private static (LedgerKit Kit, Participant Person) Arrange()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.SeedCommunityAccessCatalogue();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 50000m), Q(2, 50000m), Q(3, 50000m), Q(4, 50000m)));
        return (kit, person);
    }

    private static async Task<Odip.Infrastructure.Services.ParticipantLedger> LedgerOf(LedgerKit kit, Participant person) =>
        (await kit.Ledger.ComputeAsync(kit.TenantId, new[] { person.Id }, Ct))[person.Id];

    [Fact]
    public async Task ComputeAsync_AnOtherFundedParticipantWithAPlanAndCompletedShifts_HasNoLedger()
    {
        var (kit, person) = Arrange();
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);
        person.FundingSource = ParticipantFundingSource.Other;
        kit.Db.SaveChanges();

        var ledger = await LedgerOf(kit, person);

        Assert.Null(ledger.Ledger);
        Assert.Empty(ledger.Items);
    }

    [Fact]
    public async Task ComputeAsync_SwitchingFundingFollowsTheCurrentSource_OtherDropsTheLedgerAndNdisBringsItBack()
    {
        var (kit, person) = Arrange();
        kit.SeedShift(person, new DateOnly(2026, 10, 1), ShiftStatus.Completed);

        person.FundingSource = ParticipantFundingSource.Other;
        kit.Db.SaveChanges();
        Assert.Null((await LedgerOf(kit, person)).Ledger);

        person.FundingSource = ParticipantFundingSource.Ndis;
        kit.Db.SaveChanges();
        var back = await LedgerOf(kit, person);

        Assert.NotNull(back.Ledger);
        Assert.NotEmpty(back.Items);
    }

    [Fact]
    public async Task ComputeAsync_AnOtherFundedParticipantsPastPublishedShift_IsNotPending()
    {
        var (kit, person) = Arrange();
        kit.SeedShift(person, new DateOnly(2026, 10, 2), ShiftStatus.Published);
        person.FundingSource = ParticipantFundingSource.Other;
        kit.Db.SaveChanges();

        var ledger = await LedgerOf(kit, person);

        Assert.Null(ledger.Ledger);
        Assert.Empty(ledger.Items);
    }
}
