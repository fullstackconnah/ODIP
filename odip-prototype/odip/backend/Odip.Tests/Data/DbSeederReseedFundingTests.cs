using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Xunit;

namespace Odip.Tests.Data;

/// <summary>
/// The dev reseed clears every table in foreign-key order before it seeds again. A participant's plan budget (budget phase 1) refers to the participant with a RESTRICT foreign key, so
/// a reseed of a database that held one used to fail at the participants' delete. InMemory enforces no foreign key, so what is checked here is that the plan, its pools and its periods
/// are in the delete list at all: with PostgreSQL the RESTRICT would refuse the participants while any plan remained. The deletes are their own method (<c>ClearAllDataAsync</c>) because
/// the seeding after them does not run on InMemory.
/// </summary>
public class DbSeederReseedFundingTests
{
    private static OdipDbContext CreateDb(string name)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>().UseInMemoryDatabase(name).Options;
        return new OdipDbContext(options, tenant.Object);
    }

    [Fact]
    public async Task ClearAllData_RemovesAParticipantsPlanBudget_ItsPoolsAndItsPeriods_WithTheParticipants()
    {
        var name = Guid.NewGuid().ToString();
        // The dev endpoint reseeds with a fresh request-scoped context, so the data is written by one context and cleared by another (a context that seeded it would still be tracking
        // every row it added, which is not what happens there).
        await using (var seeding = CreateDb(name))
            await SeedAPlanAsync(seeding);

        using var db = CreateDb(name);
        Assert.Equal((1, 1, 1), (await db.FundingPlans.CountAsync(), await db.FundingPools.CountAsync(), await db.FundingPeriods.CountAsync()));

        await DbSeeder.ClearAllDataAsync(db, CancellationToken.None);

        Assert.Empty(db.FundingPlans);
        Assert.Empty(db.FundingPools);
        Assert.Empty(db.FundingPeriods);
        Assert.Empty(db.Participants.IgnoreQueryFilters());   // the delete ran to the participants, which a Restrict key would have refused
    }

    private static async Task SeedAPlanAsync(OdipDbContext db)
    {
        await DbSeeder.SeedAsync(db, CancellationToken.None);
        var participant = await db.Participants.IgnoreQueryFilters().OrderBy(p => p.Id).FirstAsync();
        var plan = new FundingPlan
        {
            Id = Guid.NewGuid(), TenantId = participant.TenantId, ParticipantId = participant.Id, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30),
            Evidence = BudgetEvidenceSource.PlanCopy, Revision = 1, CreatedBy = "test", UpdatedBy = "test", CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow,
        };
        var pool = new FundingPool { Id = Guid.NewGuid(), TenantId = participant.TenantId, FundingPlanId = plan.Id, Kind = FundingPoolKind.CoreFlexible, ManagementType = PlanType.PlanManaged, Name = "Core (flexible)" };
        pool.Periods.Add(new FundingPeriod { Id = Guid.NewGuid(), TenantId = participant.TenantId, FundingPoolId = pool.Id, PeriodStart = plan.PlanStart, PeriodEnd = plan.PlanEnd, PlanAmount = 1000m });
        plan.Pools.Add(pool);
        db.FundingPlans.Add(plan);
        await db.SaveChangesAsync();
    }
}
