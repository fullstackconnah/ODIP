using System.Diagnostics;
using Microsoft.Extensions.Caching.Memory;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Odip.Tests.Postgres;
using Xunit;
using Xunit.Abstractions;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The budget graph against a real PostgreSQL: what EF InMemory cannot show. The approved-revisions query (an Include of the blocks and a correlated EXISTS over the approvals) translates and
/// returns the right rows, the price-list probe's "no end date" branch translates, and the series agrees with the ledger off real numeric(18,2) columns. Skipped, never failed, without
/// POSTGRES_CONNECTION_STRING.
/// </summary>
public class BudgetSeriesPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    public BudgetSeriesPostgresTests(PostgresFixture pg) => _pg = pg;

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private async Task<LedgerKit> SetUpAsync()
    {
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", kit.Db.Database.ProviderName);
        return kit;
    }

    /// <summary>The service with the engine faked: $100 a Monday the revision covers, Core.</summary>
    internal static BudgetSeriesService FakedSeries(LedgerKit kit)
    {
        var series = new BudgetSeriesService(kit.Db, kit.Ledger, new PlanPricingService(kit.Db), new MemoryCache(new MemoryCacheOptions()));
        series.Quote = (_, _, from, to, _, _) =>
        {
            var lines = new List<PlannedLine>();
            for (var d = from; d <= to; d = d.AddDays(1))
                if (d.DayOfWeek == DayOfWeek.Monday) lines.Add(new PlannedLine { ItemCode = "04_TEST", Total = 100m, ServiceDate = d, PaceCategory = 4 });
            return Task.FromResult(new PlanQuote { PeriodFrom = from, PeriodTo = to, Lines = lines });
        };
        return series;
    }

    internal static ServiceAgreementDraft Revision(LedgerKit kit, Participant person, int version, DateOnly start, DateOnly end, bool approved = true, bool handTyped = false, params PlanBlock[] blocks)
    {
        var draft = new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = person.TenantId, ParticipantId = person.Id, Version = version, PlanStartDate = start, PlanEndDate = end,
            AgreementStartDate = start, AgreementEndDate = end, State = "NSW", ParticipantNameSnapshot = "Sophie Brown",
        };
        if (!handTyped)
        {
            if (blocks.Length == 0) blocks = [Odip.Tests.PlanPricing.PlanPricingTestSupport.Block("mon", PlanSupportType.CommunityAccess, DayOfWeek.Monday, new TimeOnly(9, 0), new TimeOnly(13, 0))];
            for (var i = 0; i < blocks.Length; i++)
                draft.Blocks.Add(new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, Position = i, BlockKey = blocks[i].Id, BlockJson = DraftJson.Write(blocks[i]) });
        }
        kit.Db.ServiceAgreementDrafts.Add(draft);
        if (approved)
            kit.Db.ServiceAgreementDraftApprovals.Add(new ServiceAgreementDraftApproval
            {
                Id = Guid.NewGuid(), TenantId = person.TenantId, DraftId = draft.Id, ParticipantId = person.Id, DraftVersion = version, ApprovedAt = FundingTestKit.Now.UtcDateTime, ApprovedByName = "Alex Admin",
            });
        kit.Db.SaveChanges();
        return draft;
    }

    private static Task<BudgetSeriesDto?> GetAsync(BudgetSeriesService series, LedgerKit kit, Participant person) =>
        series.GetAsync(kit.TenantId, person.Id, () => null!, CancellationToken.None);

    [SkippableFact(DisplayName = "Budget graph (PostgreSQL): the approved revisions with blocks are read in version order; waiting and hand-typed ones are not")]
    public async Task TheRevisionsQuery_ReturnsTheApprovedRevisionsWithBlocks_InVersionOrder()
    {
        RequirePostgres();
        using var kit = await SetUpAsync();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 2500m), Q(2, 2500m), Q(3, 2500m), Q(4, 2500m)));
        Revision(kit, person, 3, D(2027, 3, 1), D(2027, 6, 30));               // saved first, read third
        Revision(kit, person, 1, D(2026, 7, 1), D(2027, 6, 30));
        Revision(kit, person, 2, D(2026, 12, 1), D(2027, 6, 30));
        Revision(kit, person, 4, D(2027, 5, 1), D(2027, 6, 30), approved: false);
        Revision(kit, person, 5, D(2027, 4, 1), D(2027, 6, 30), handTyped: true);
        var series = FakedSeries(kit);

        var dto = (await series.GetAsync(kit.TenantId, person.Id, () => new Lease(), CancellationToken.None))!;

        Assert.Equal(BudgetExpectedStatus.Ok, dto.Expected.Status);
        Assert.Equal(new[] { D(2026, 12, 1), D(2027, 3, 1) }, dto.Expected.RevisionChanges);
    }

    [SkippableFact(DisplayName = "Budget graph (PostgreSQL): a price list with no end date counts for a later plan; a plan before every list has no pricing")]
    public async Task ThePriceListProbe_CountsAListWithNoEndDate()
    {
        RequirePostgres();
        using var kit = await SetUpAsync();
        Assert.Contains(kit.Db.SupportCatalogueItems, i => i.EffectiveTo == null);
        var later = kit.SeedParticipant(last: "Later");
        kit.SeedPlan(later, D(2026, 7, 1), D(2028, 6, 30), Core(PlanType.PlanManaged, new PeriodSpec(D(2026, 7, 1), D(2028, 6, 30), 9000m, null)));
        var earlier = kit.SeedParticipant(last: "Earlier");
        kit.SeedPlan(earlier, D(2024, 7, 1), D(2025, 6, 30), Core(PlanType.PlanManaged, new PeriodSpec(D(2024, 7, 1), D(2025, 6, 30), 9000m, null)));
        var series = FakedSeries(kit);

        Assert.Equal(BudgetChartStatus.Ok, (await GetAsync(series, kit, later))!.Chart);
        Assert.Equal(BudgetChartStatus.NoPricing, (await GetAsync(series, kit, earlier))!.Chart);
    }

    [SkippableFact(DisplayName = "Budget graph (PostgreSQL): today's used and the plan end's forecast are the ledger's, pool by pool")]
    public async Task TheSeriesAgreesWithTheLedger()
    {
        RequirePostgres();
        using var kit = await SetUpAsync();
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, Core(PlanType.PlanManaged, Q(1, 2500m), Q(2, 2500m), Q(3, 2500m), Q(4, 2500m)));
        kit.SeedShiftClaim(person, TripClaimStatus.Paid, 300.55m, kit.SeedShift(person, D(2026, 8, 3), ShiftStatus.Completed));
        kit.SeedShift(person, D(2026, 9, 21), ShiftStatus.Completed);
        kit.SeedShift(person, D(2026, 10, 8), ShiftStatus.Completed);
        kit.SeedShift(person, Today, ShiftStatus.Published);
        kit.SeedShift(person, D(2027, 3, 1), ShiftStatus.Published);

        var ledger = (await kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, CancellationToken.None))!;
        var dto = (await GetAsync(FakedSeries(kit), kit, person))!;

        var core = Assert.Single(ledger.Pools);
        foreach (var scope in dto.Scopes)
        {
            Assert.Equal(core.PlanTotal.Used, scope.Points.Last(p => p.Date == Today).Used);
            Assert.Equal(core.PlanTotal.Forecast, scope.Points[^1].UsedAndBooked);
        }
        Assert.True(core.PlanTotal.Forecast > core.PlanTotal.Used);
    }

    private sealed class Lease : IDisposable { public void Dispose() { } }
}

/// <summary>Runs alone, after the parallel classes, so the medians are the service's and not the suite's.</summary>
[CollectionDefinition(nameof(BudgetSeriesTimingPostgresTests), DisableParallelization = true)]
public class BudgetSeriesTimingCollection;

/// <summary>
/// Spec decision 5's measurement: the series beside the ledger on the heaviest plan the app allows (800 days, four pools, about 570 shifts, two approved revisions priced by the real engine
/// over the real 2026-27 catalogue). Cold is a new cache (both revisions quoted); warm is the same cache. The ceilings are loose so CI never flakes; the medians are printed.
/// </summary>
[Collection(nameof(BudgetSeriesTimingPostgresTests))]
public class BudgetSeriesTimingPostgresTests : IClassFixture<PostgresFixture>
{
    private readonly PostgresFixture _pg;
    private readonly ITestOutputHelper _output;
    public BudgetSeriesTimingPostgresTests(PostgresFixture pg, ITestOutputHelper output) => (_pg, _output) = (pg, output);

    private sealed class Lease : IDisposable { public void Dispose() { } }

    [SkippableFact(DisplayName = "Budget graph (PostgreSQL): the series on an 800-day plan, cold and warm, beside the ledger")]
    public async Task BudgetSeriesTiming_OnTheLongestPlan()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        await using (var admin = PostgresFixture.NewContext(_pg.ConnectionString!))
            await CatalogueImportTestSupport.ImportAsync(admin, CatalogueFixtures.File2026_27);
        var (db, tenantId) = await _pg.NewTenantContextAsync();
        using var kit = LedgerKit.Wrap(db, tenantId);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();

        var start = D(2026, 7, 1);
        var end = start.AddDays(FundingPlan.MaxPlanDays - 1);
        PeriodSpec Whole(decimal amount) => new(start, end, amount, null);
        var person = kit.SeedParticipant();
        kit.SeedPlan(person, start, end, Core(PlanType.PlanManaged, Whole(90000m)), Stated(7, PlanType.PlanManaged, Whole(5000m)), Stated(9, PlanType.PlanManaged, Whole(8000m)), Stated(15, PlanType.PlanManaged, Whole(6000m)));
        for (var i = 0; i < 570; i++)
        {
            var date = start.AddDays(i * 7 / 5);
            var shift = kit.SeedShift(person, date, date < Today ? ShiftStatus.Completed : ShiftStatus.Published);
            if (date < Today && i % 2 == 0) kit.SeedShiftClaim(person, TripClaimStatus.Paid, 432m, shift);
        }
        PlanBlock Block(string id, DayOfWeek day) => Odip.Tests.PlanPricing.PlanPricingTestSupport.Block(id, PlanSupportType.CommunityAccess, day, new TimeOnly(9, 0), new TimeOnly(13, 0));
        BudgetSeriesPostgresTests.Revision(kit, person, 1, start, end, blocks: [Block("mon", DayOfWeek.Monday), Block("wed", DayOfWeek.Wednesday)]);
        BudgetSeriesPostgresTests.Revision(kit, person, 2, D(2027, 7, 1), end, blocks: [Block("mon", DayOfWeek.Monday), Block("fri", DayOfWeek.Friday)]);

        static async Task<double> Median(Func<Task> run)
        {
            await run();   // warm-up
            var times = new List<double>();
            for (var i = 0; i < 3; i++)
            {
                var watch = Stopwatch.StartNew();
                await run();
                times.Add(watch.Elapsed.TotalMilliseconds);
            }
            return times.Order().ElementAt(1);
        }

        BudgetSeriesService Series(IMemoryCache cache) => new(kit.Db, kit.Ledger, new PlanPricingService(kit.Db), cache);
        var warmCache = new MemoryCache(new MemoryCacheOptions());
        var first = (await Series(warmCache).GetAsync(kit.TenantId, person.Id, () => new Lease(), CancellationToken.None))!;
        Assert.Equal(BudgetExpectedStatus.Ok, first.Expected.Status);
        Assert.Equal(5, first.Scopes.Count);

        var ledger = await Median(() => kit.Ledger.GetLedgerAsync(kit.TenantId, person.Id, CancellationToken.None));
        var cold = await Median(() => Series(new MemoryCache(new MemoryCacheOptions())).GetAsync(kit.TenantId, person.Id, () => new Lease(), CancellationToken.None));
        var warm = await Median(() => Series(warmCache).GetAsync(kit.TenantId, person.Id, () => new Lease(), CancellationToken.None));

        _output.WriteLine($"budget series timing: ledger median {ledger:0} ms, series cold median {cold:0} ms, series warm median {warm:0} ms");
        _output.WriteLine($"warm <= 2 x ledger + 250 ms: {warm:0} <= {2 * ledger + 250:0} -> {(warm <= 2 * ledger + 250 ? "yes" : "no")}");
        Assert.True(cold <= 10000, $"cold {cold:0} ms");
        Assert.True(warm <= 5000, $"warm {warm:0} ms");
        if (ledger > 200) Assert.True(warm <= 2 * ledger + 250, $"warm {warm:0} ms against ledger {ledger:0} ms");
    }
}
