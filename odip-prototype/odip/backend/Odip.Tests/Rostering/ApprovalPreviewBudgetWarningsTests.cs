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
/// The Populate roster dialog's preview says, for each started week, where the shifts populating would make take a pool past its funding (budget phase 3, moved from the approval preview by S11), as a
/// warning: nothing is refused for a budget, in any mode. The weekday block makes five shifts of four hours a week: at the NSW weekday rate of $60 an hour that is $240 each, $1,200 a week, all inside the
/// October to December period.
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
        Assert.Equal(ApprovalStatus.Approved, (await f.Service.ApproveAsync(TenantA, f.ParticipantId, draft.Id, false, Admin, CancellationToken.None)).Status);   // the patterns Populate fills
        return (f, draft.Id);
    }

    private static async Task<Odip.Application.DTOs.PopulatePreviewDto> Preview(Fixture f, Guid draftId, ServiceAgreementApprovalService? service = null) =>
        (await (service ?? f.Service).PopulatePreviewAsync(TenantA, f.ParticipantId, draftId, CancellationToken.None))!;

    [Fact]
    public async Task ShiftsThatWouldTakeThePoolPastItsFunding_GetOneWarningForThePeriod_InEachWeek()
    {
        var (f, draftId) = await SetUp(october: 1000m);
        await using var _ = f;

        var preview = await Preview(f, draftId);

        Assert.Equal(40, preview.Weeks.Sum(w => w.ToAdd));
        var week = preview.Weeks[0];
        Assert.Equal(new DateOnly(2026, 10, 12), week.WeekStart);
        var warning = Assert.Single(week.BudgetWarnings!);
        Assert.Equal(("Core (flexible)", new DateOnly(2026, 10, 1), new DateOnly(2026, 12, 31)), (warning.PoolName, warning.PeriodStart, warning.PeriodEnd));
        Assert.Equal((1000m, 1200m, 1200m, 200m, 5), (warning.Available, warning.Forecast, warning.Added, warning.OverBy, warning.Count));
        Assert.Equal("These 5 shifts take Core (flexible) to $1,200.00 of $1,000.00 for 1\u00A0Oct\u00A0\u2013\u2060\u00A031\u00A0Dec\u00A02026, $200.00 over.", warning.Message);
    }

    [Fact]
    public async Task ShiftsWithinTheFunding_OrForAParticipantWithNoBudget_HaveNoWarnings()
    {
        var (roomy, roomyDraft) = await SetUp(october: 50000m);
        await using var _1 = roomy;
        var (none, noneDraft) = await SetUp(october: null);
        await using var _2 = none;

        Assert.All((await Preview(roomy, roomyDraft)).Weeks, w => Assert.Null(w.BudgetWarnings));
        Assert.All((await Preview(none, noneDraft)).Weeks, w => Assert.Null(w.BudgetWarnings));
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

        Assert.Equal(40, preview.Weeks.Sum(w => w.ToAdd));
        Assert.All(preview.Weeks, w => Assert.Null(w.BudgetWarnings));
    }
}
