using Odip.Domain.Funding;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The positional shape of the calculator's two result records. <see cref="PeriodLedger"/> and <see cref="PoolTotals"/> are built by <see cref="BudgetLedgerCalculator"/> and read all over the
/// budget feature, and branches that build on the ledger in parallel (alerts, the Budgets list, hard limits) merge against this shape. A count inserted in the MIDDLE of a positional record
/// misbinds silently where two ints sit side by side, so the order the records had before the fix round is kept, and every count added since comes LAST, in the order it was added.
/// </summary>
public class LedgerRecordShapeTests
{
    private static string[] ConstructorParameters(Type type) => type.GetConstructors().Single().GetParameters().Select(p => p.Name!).ToArray();

    [Fact]
    public void PeriodLedgerKeepsItsOriginalParameterOrder_AndTheNewCountsComeLast()
    {
        Assert.Equal(
            new[]
            {
                "Period", "IsCurrent", "Limit", "Carried", "Claimed", "Pending", "BookedAhead", "PastUnresolvedCount", "UnpricedTripDayCount", "Status", "Items",
                "StartedUnclaimedTripCount", "UnpricedShiftCount",
            },
            ConstructorParameters(typeof(PeriodLedger)));
    }

    [Fact]
    public void PoolTotalsKeepsItsOriginalParameterOrder_AndTheNewCountsComeLast()
    {
        Assert.Equal(
            new[] { "Limit", "Claimed", "Pending", "BookedAhead", "PastUnresolvedCount", "UnpricedTripDayCount", "Status", "StartedUnclaimedTripCount", "UnpricedShiftCount" },
            ConstructorParameters(typeof(PoolTotals)));
    }
}
