using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>The budget side of an import: one ledger, one estimate, every shift of a period over the line flagged. Fixtures as ShiftBudgetCheckTests: NSW weekdays at $60 an hour, so 9 to 5 is $480; clock 4 Oct 2026.</summary>
public class ShiftBudgetBatchTests : IDisposable
{
    private static readonly DateOnly Mon12Oct = new(2026, 10, 12);
    private readonly LedgerKit _kit = LedgerKit.Create();

    public void Dispose() => _kit.Dispose();

    private Participant Seed(decimal october, bool withPlan = true)
    {
        _kit.SeedProvider("NSW");
        _kit.SeedCommunityAccessCatalogue();
        var participant = _kit.SeedParticipant(PlanType.PlanManaged);
        if (withPlan) _kit.SeedPlan(participant, LedgerKit.Core(PlanType.PlanManaged, LedgerKit.Q(2, october), LedgerKit.Q(3, 5000m)));
        return participant;
    }

    private ShiftBudgetCheck Service() => new(_kit.Db, _kit.Ledger);

    private static ShiftSpec Day(DateOnly date) => new(date, new TimeOnly(9, 0), new TimeOnly(17, 0), false, SupportRatio.OneToOne, SleepoverType.None);

    private async Task<IReadOnlyList<BudgetOver?>> ForecastAsync(Participant participant, params DateOnly[] dates)
    {
        var ledgers = await _kit.Ledger.ComputeAsync(participant.TenantId, [participant.Id], default);
        return await Service().ForecastOverAsync(participant.TenantId, participant.Id, dates.Select(Day).ToList(), ledgers.GetValueOrDefault(participant.Id), default);
    }

    [Fact]
    public async Task ForecastOver_ThreeShiftsCrossTheLine_AllThreeFlagged()
    {
        var participant = Seed(october: 1000m);

        var over = await ForecastAsync(participant, Mon12Oct, Mon12Oct.AddDays(1), Mon12Oct.AddDays(2));

        Assert.All(over, o => Assert.Equal(("Core (flexible)", 440m, false, 1440m), (o!.PoolName, o.OverBy, o.AlreadyOver, o.Added)));
    }

    [Fact]
    public async Task ForecastOver_PeriodAlreadyOver_SaysSoAndWhatTheBatchAdds()
    {
        var participant = Seed(october: 1000m);
        _kit.SeedShift(participant, Mon12Oct);
        _kit.SeedShift(participant, Mon12Oct.AddDays(1));
        _kit.SeedShift(participant, Mon12Oct.AddDays(2));   // $1,440 booked ahead already

        var over = await ForecastAsync(participant, Mon12Oct.AddDays(3));

        var one = Assert.Single(over)!;
        Assert.Equal((920m, true, 480m), (one.OverBy, one.AlreadyOver, one.Added));
    }

    [Fact]
    public async Task ForecastOver_UnderAvailable_ReturnsNulls()
    {
        var participant = Seed(october: 5000m);

        Assert.All(await ForecastAsync(participant, Mon12Oct, Mon12Oct.AddDays(1)), o => Assert.Null(o));
    }

    [Fact]
    public async Task ForecastOver_NoPlan_ReturnsNulls()
    {
        var participant = Seed(october: 1000m, withPlan: false);

        Assert.All(await ForecastAsync(participant, Mon12Oct), o => Assert.Null(o));
    }

    [Fact]
    public async Task ForecastOver_AgreesWithSingleCheck()
    {
        var participant = Seed(october: 1000m);
        _kit.SeedShift(participant, Mon12Oct);
        _kit.SeedShift(participant, Mon12Oct.AddDays(1));
        var date = Mon12Oct.AddDays(2);

        var single = await Service().CheckAsync(new ShiftBudgetRequest(participant.TenantId, participant.Id, null, date, new TimeOnly(9, 0), new TimeOnly(17, 0), false, SupportRatio.OneToOne, SleepoverType.None, null, true), default);
        var batch = Assert.Single(await ForecastAsync(participant, date))!;

        Assert.Equal(single.Findings.Single(f => f.Code == BudgetFindingCodes.ForecastOver).Budget!.OverBy, batch.OverBy);
    }
}
