using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Services;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Funding;

/// <summary>
/// The budget queries that must translate to PostgreSQL SQL, checked against the NPGSQL provider's translation and not only EF InMemory (which evaluates any LINQ in memory and
/// would stay green if one of these stopped translating). <c>ToQueryString</c> only builds SQL; nothing connects, so this needs no database. The behaviour of the same queries on a
/// real server is in <see cref="FundingPostgresTests"/>.
/// </summary>
public class FundingSqlTests
{
    private static OdipDbContext NpgsqlDb()
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);
        var options = new DbContextOptionsBuilder<OdipDbContext>()
            .UseNpgsql("Host=localhost;Database=odip_sql_translation_test;Username=postgres;Password=postgres")
            .Options;
        return new OdipDbContext(options, tenant.Object);
    }

    private static readonly DateOnly Today = new(2026, 10, 4);

    [Fact]
    public void FundingRecorded_TranslatesToAnExistsOverTheParticipantsPlans_ComparedOnTheDateColumn()
    {
        using var db = NpgsqlDb();

        var sql = ParticipantReadinessGate.FundingRecordedParticipants(db, Today).ToQueryString();

        Assert.Contains("\"FundingPlans\"", sql);
        Assert.Contains("EXISTS", sql);
        Assert.Contains("\"PlanEnd\" >=", sql);
        Assert.Contains("\"FundingSource\"", sql);
    }

    [Fact]
    public void FundingMissing_TranslatesToANotExists_ForTheNdisFundedOnly()
    {
        using var db = NpgsqlDb();

        var sql = ParticipantReadinessGate.FundingMissingParticipants(db, Today).ToQueryString();

        Assert.Contains("NOT EXISTS", sql);
        Assert.Contains("\"FundingPlans\"", sql);
        Assert.Contains("\"FundingSource\" = 0", sql);   // Ndis, compared as the stored integer
    }

    [Fact]
    public void TheOverlapQuery_TranslatesToAnInclusiveDateRangeTest_ThatSkipsThePlanBeingReplaced()
    {
        using var db = NpgsqlDb();
        var service = new FundingPlanService(db, TimeProvider.System);

        var sql = service.PlansOverlapping(Guid.NewGuid(), Guid.NewGuid(), new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30), exceptPlanId: Guid.NewGuid()).ToQueryString();

        Assert.Contains("\"FundingPlans\"", sql);
        Assert.Matches(@"\w+\.""PlanStart"" <= ", sql);           // the plan starts on or before the new plan's last day
        Assert.Matches(@"<= \w+\.""PlanEnd""", sql);              // and ends on or after its first day: inclusive at both ends
        Assert.Contains("\"ParticipantId\" =", sql);
        Assert.Contains("\"Id\" <>", sql);
    }

    [Fact]
    public void TheOverlapQuery_WithNoPlanToSkip_TranslatesWithoutTheExclusion()
    {
        using var db = NpgsqlDb();
        var service = new FundingPlanService(db, TimeProvider.System);

        var sql = service.PlansOverlapping(Guid.NewGuid(), Guid.NewGuid(), new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30), exceptPlanId: null).ToQueryString();

        Assert.Matches(@"<= \w+\.""PlanEnd""", sql);
        Assert.DoesNotContain("\"Id\" <>", sql);
    }

    [Fact]
    public void TheBillingHintQuery_TranslatesToTheActiveNdisRoutesWithABudgetAboveZero()
    {
        using var db = NpgsqlDb();
        var service = new FundingPlanService(db, TimeProvider.System);

        var sql = service.HintSources(Guid.NewGuid(), Guid.NewGuid()).ToQueryString();

        Assert.Contains("\"FundingSources\"", sql);
        Assert.Contains("\"IsActive\"", sql);
        Assert.Contains("\"Budget\" > 0.0", sql);
        Assert.Contains("\"RouteType\"", sql);
    }
}
