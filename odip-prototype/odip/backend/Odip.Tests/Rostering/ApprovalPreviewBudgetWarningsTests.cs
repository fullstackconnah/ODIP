using Moq;
using Odip.Api.Services;
using Odip.Domain.Enums;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Funding;
using Xunit;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>
/// The approval dialog's preview says where the shifts approval would make take a pool past its funding (budget phase 3), as a warning: nothing is refused for a budget, in any mode. The weekday block makes forty
/// shifts of four hours between Monday 12 October and the horizon (5 December): at the NSW weekday rate of $60 an hour that is $240 each, $9,600 in all, all inside the October to December period.
/// </summary>
public class ApprovalPreviewBudgetWarningsTests
{
    private static async Task<(Fixture F, Guid DraftId)> SetUp(decimal? october)
    {
        var f = await SetUpAsync();
        var kit = LedgerKit.Wrap(f.Db, TenantA);
        kit.SeedCommunityAccessCatalogue();
        if (october is { } amount) kit.SeedPlan(f.Db.Participants.Single(), LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, amount)));
        var draft = await AddRevisionAsync(f, 1, new[] { WeekdayBlock() });
        return (f, draft.Id);
    }

    private static async Task<Odip.Application.DTOs.DraftApprovalPreviewDto> Preview(Fixture f, Guid draftId, ServiceAgreementApprovalService? service = null) =>
        (await (service ?? f.Service).PreviewAsync(TenantA, f.ParticipantId, draftId, Admin, CancellationToken.None)).Preview!;

    [Fact]
    public async Task ShiftsThatWouldTakeThePoolPastItsFunding_GetOneWarningForThePeriod_AndApprovalIsStillOffered()
    {
        var (f, draftId) = await SetUp(october: 1000m);
        await using var _ = f;

        var preview = await Preview(f, draftId);

        Assert.True(preview.CanApprove);
        Assert.Equal(40, preview.ShiftsToCreate);
        var warning = Assert.Single(preview.BudgetWarnings!);
        Assert.Equal(("Core (flexible)", new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 31)), (warning.PoolName, warning.PeriodStart, warning.PeriodEnd));
        Assert.Equal((1000m, 9600m, 9600m, 8600m, 40), (warning.Available, warning.Forecast, warning.Added, warning.OverBy, warning.Count));
        Assert.Equal("These 40 shifts take Core (flexible) to $9,600.00 of $1,000.00 for 1 Oct\u00A0\u2013\u00A031 Dec 2026, $8,600.00 over.", warning.Message);
    }

    [Fact]
    public async Task ShiftsWithinTheFunding_OrForAParticipantWithNoBudget_HaveNoWarnings()
    {
        var (roomy, roomyDraft) = await SetUp(october: 50000m);
        await using var _1 = roomy;
        var (none, noneDraft) = await SetUp(october: null);
        await using var _2 = none;

        Assert.Null((await Preview(roomy, roomyDraft)).BudgetWarnings);
        Assert.Null((await Preview(none, noneDraft)).BudgetWarnings);
    }

    [Fact]
    public async Task APreviewThatCannotWorkOutTheBudget_IsStillShown_WithoutWarnings()
    {
        var (f, draftId) = await SetUp(october: 1000m);
        await using var _ = f;
        var broken = new Mock<IShiftCostSource>();
        broken.Setup(s => s.EstimateAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<IReadOnlyList<ShiftSpec>>(), It.IsAny<CancellationToken>())).ThrowsAsync(new InvalidOperationException("boom"));
        var effect = new ShiftBudgetEffect(f.Db, new BudgetLedgerService(f.Db, f.Clock), broken.Object);
        var service = new ServiceAgreementApprovalService(f.Db, new RosterPlacementGate(), new RosterShiftGenerator(), clock: f.Clock, budget: effect);

        var preview = await Preview(f, draftId, service);

        Assert.True(preview.CanApprove);
        Assert.Null(preview.BudgetWarnings);
    }
}
