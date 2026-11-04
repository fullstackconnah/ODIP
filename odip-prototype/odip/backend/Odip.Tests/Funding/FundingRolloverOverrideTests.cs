using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Xunit;
using static Odip.Tests.Funding.FundingTestKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The rolled-over amount typed into a funding plan (budget rollover): it is saved with the period, read back, cleared by saving null, and every change is written to the audit log by the
/// existing interceptor (FundingPeriod is an audited entity), because a typed amount can lift a hard limit.
/// </summary>
public class FundingRolloverOverrideTests
{
    private static SaveFundingPlanDto PlanWithRollover(decimal? rollover, int revision = 0)
    {
        var periods = Quarters();
        periods[1] = periods[1] with { RolloverOverride = rollover };
        return Plan(Core(periods: periods)) with { Revision = revision };
    }

    private static decimal? RolloverOf(FundingPlanDto plan, int period) => plan.Pools.Single().Periods[period].RolloverOverride;

    [Fact]
    public async Task ARolloverIsSavedAndReadBack_AndSavingNullClearsIt()
    {
        using var kit = Create(TenantA);
        var participant = kit.SeedParticipant();

        var created = Body(await kit.Controller.CreatePlan(participant.Id, PlanWithRollover(500.25m), CancellationToken.None), StatusCodes.Status201Created);
        Assert.Equal(new decimal?[] { null, 500.25m, null, null }, Enumerable.Range(0, 4).Select(i => RolloverOf(created, i)));

        var cleared = Body(await kit.Controller.UpdatePlan(participant.Id, created.Id, PlanWithRollover(null, created.Revision), CancellationToken.None));
        Assert.All(Enumerable.Range(0, 4), i => Assert.Null(RolloverOf(cleared, i)));
    }

    [Fact]
    public async Task ASaveThatLeavesTheRolloverOut_ErasesIt_BecauseTheSaveReplacesThePlan()
    {
        // The editor always sends the field back, so an editor round-trip keeps it; a caller that builds the body without it clears it.
        using var kit = Create(TenantA);
        var participant = kit.SeedParticipant();
        var created = Body(await kit.Controller.CreatePlan(participant.Id, PlanWithRollover(500m), CancellationToken.None), StatusCodes.Status201Created);

        var again = Body(await kit.Controller.UpdatePlan(participant.Id, created.Id, Plan(Core()) with { Revision = created.Revision }, CancellationToken.None));

        Assert.Null(RolloverOf(again, 1));
    }

    [Fact]
    public async Task ARolloverOnTheFirstPeriod_IsRefusedBeforeAnythingIsSaved()
    {
        using var kit = Create(TenantA);
        var participant = kit.SeedParticipant();
        var periods = Quarters();
        periods[0] = periods[0] with { RolloverOverride = 100m };

        var result = await kit.Controller.CreatePlan(participant.Id, Plan(Core(periods: periods)), CancellationToken.None);

        Assert.Equal(StatusCodes.Status400BadRequest, Assert.IsAssignableFrom<Microsoft.AspNetCore.Mvc.ObjectResult>(result.Result).StatusCode);
        Assert.Empty(kit.Db.FundingPlans);
    }

    [Fact]
    public async Task ChangingTheRollover_WritesAnAuditRowWithTheOldAndNewValue()
    {
        using var kit = Create(TenantA);
        var participant = kit.SeedParticipant();
        var created = Body(await kit.Controller.CreatePlan(participant.Id, PlanWithRollover(null), CancellationToken.None), StatusCodes.Status201Created);
        kit.Db.AuditLogs.RemoveRange(kit.Db.AuditLogs.ToList());
        await kit.Db.SaveChangesAsync();

        var set = Body(await kit.Controller.UpdatePlan(participant.Id, created.Id, PlanWithRollover(500m, created.Revision), CancellationToken.None));
        var rows = await kit.Db.AuditLogs.Where(a => a.EntityType == "FundingPeriod" && a.Changes.Contains("RolloverOverride")).ToListAsync();
        var setRow = Assert.Single(rows);
        Assert.Contains("500", setRow.Changes, StringComparison.Ordinal);

        kit.Db.AuditLogs.RemoveRange(kit.Db.AuditLogs.ToList());
        await kit.Db.SaveChangesAsync();
        Body(await kit.Controller.UpdatePlan(participant.Id, created.Id, PlanWithRollover(null, set.Revision), CancellationToken.None));
        var clearRow = Assert.Single(await kit.Db.AuditLogs.Where(a => a.EntityType == "FundingPeriod" && a.Changes.Contains("RolloverOverride")).ToListAsync());
        Assert.Contains("500", clearRow.Changes, StringComparison.Ordinal);
        Assert.NotEqual(setRow.Id, clearRow.Id);
    }
}
