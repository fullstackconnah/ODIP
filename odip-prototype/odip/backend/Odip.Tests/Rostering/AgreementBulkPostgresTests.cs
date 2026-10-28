using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Domain.Entities;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Medications;
using Odip.Tests.Postgres;
using Xunit;
using Xunit.Abstractions;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;
using static Odip.Tests.Rostering.ApprovalTestSupport;

namespace Odip.Tests.Rostering;

/// <summary>Agreements PR B on PostgreSQL (B-T16): the three actions once each, the pinned catalogue query, the latest-revision read, and the time 25 reprices take against the 40 s batch budget.</summary>
public class AgreementBulkPostgresTests : IClassFixture<PostgresFixture>
{
    private const string Code = "04_104_0125_6_1";
    private readonly PostgresFixture _pg;
    private readonly ITestOutputHelper _output;
    public AgreementBulkPostgresTests(PostgresFixture pg, ITestOutputHelper output) { _pg = pg; _output = output; }

    private void RequirePostgres() => Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");

    private static OdipDbContext Open(string connectionString, Guid tenantId)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return PostgresFixture.NewContext(connectionString, tenant.Object);
    }

    /// <summary>A migrated scratch database with the December catalogue, one organisation, and <paramref name="count"/> participants each on an approved weekday agreement and a plan covering a year.</summary>
    private async Task<(string ConnectionString, Guid TenantId, List<Guid> Participants)> SetUpAsync(int count, DateOnly start, DateOnly end)
    {
        var connectionString = await _pg.CreateDatabaseAsync();
        await using (var migrate = PostgresFixture.NewContext(connectionString)) await migrate.Database.MigrateAsync();
        await using (var admin = PostgresFixture.NewContext(connectionString)) await ImportDecemberPriceSetAsync(admin, c => c == Code);
        var (setup, tenantId) = await _pg.NewTenantContextAsync(connectionString);
        var ids = new List<Guid>();
        await using (setup)
        {
            setup.ProviderSettings.Add(new ProviderSettings { Id = Guid.NewGuid(), TenantId = tenantId, OrganisationName = "Provider", State = "NSW", BSB = "062000", AccountNumber = "12345678" });
            for (var i = 0; i < count; i++)
            {
                var p = setup.Participants.Add(new Participant { Id = Guid.NewGuid(), FirstName = "Amy", LastName = $"Ng{i}", NdisNumber = $"4310{i:D7}", DateOfBirth = new DateOnly(1990, 1, 2), IsActive = true }).Entity;
                ids.Add(p.Id);
                setup.FundingPlans.Add(new FundingPlan { Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = p.Id, PlanStart = new DateOnly(2026, 7, 1), PlanEnd = new DateOnly(2027, 6, 30), CreatedAt = DateTime.UtcNow, UpdatedAt = DateTime.UtcNow });
            }
            await setup.SaveChangesAsync();
        }
        foreach (var id in ids)
        {
            await using var db = Open(connectionString, tenantId);
            var draft = BuildRevision(tenantId, id, 1, new[] { WeekdayBlock() }, start, end);
            db.ServiceAgreementDrafts.Add(draft);
            await db.SaveChangesAsync();
            await MarkApprovedAsync(db, draft);
        }
        return (connectionString, tenantId, ids);
    }

    private static Task<List<BulkItem>> RunAsync(string cs, Guid tenantId, string action, List<Guid> ids, DateOnly? end = null, PriceListRef? list = null)
    {
        var db = Open(cs, tenantId);
        return new AgreementBulkService(db, clock: FakeClock.AtUtc(2026, 10, 10, 2, 0)).RunAsync(tenantId, action, ids, end, list, Admin, "admin", CancellationToken.None);
    }

    private static async Task<PriceListRef> DecemberListAsync(string cs, Guid tenantId)
    {
        await using var db = Open(cs, tenantId);
        return (await AgreementPriceLists.ListAsync(db, CancellationToken.None)).Single(l => l.Version.StartsWith("2026-27 ("));
    }

    [SkippableFact]
    public async Task TheThreeActions_OnePerAgreement_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, ids) = await SetUpAsync(3, new DateOnly(2026, 10, 12), new DateOnly(2026, 12, 20));
        var list = await DecemberListAsync(cs, tenantId);

        var renew = Assert.Single(await RunAsync(cs, tenantId, "renew", ids.GetRange(0, 1)));
        var extend = Assert.Single(await RunAsync(cs, tenantId, "extend", ids.GetRange(1, 1), end: new DateOnly(2027, 1, 3)));
        var reprice = Assert.Single(await RunAsync(cs, tenantId, "reprice", ids.GetRange(2, 1), list: list));

        Assert.All(new[] { renew, extend, reprice }, i => Assert.Equal("Created", i.Outcome));
        Assert.Equal(new DateOnly(2026, 12, 21), renew.After!.Start);
        Assert.Equal(new DateOnly(2027, 1, 3), extend.After!.End);
        Assert.Equal(new DateOnly(2026, 12, 1), reprice.Before!.Start);
        Assert.True(reprice.After!.Total > reprice.Before!.Total);                       // the pinned old list is cheaper than the current one
        await using var db = Open(cs, tenantId);
        Assert.Equal(new[] { 1, 2 }, await db.ServiceAgreementDrafts.AsNoTracking().Where(d => d.ParticipantId == ids[2]).OrderBy(d => d.Version).Select(d => d.Version).ToListAsync());
        var latest = (await AgreementRevisions.LatestAsync(db, tenantId, new[] { ids[2] }, CancellationToken.None))[ids[2]];
        Assert.Equal(2, (latest.Waiting ?? latest.Current)!.Version);
    }

    [SkippableFact]
    public async Task TwentyFiveReprices_FitTheBatchBudget_OnPostgres()
    {
        RequirePostgres();
        var (cs, tenantId, ids) = await SetUpAsync(AgreementBulkService_Cap, new DateOnly(2026, 10, 12), new DateOnly(2026, 12, 20));
        var list = await DecemberListAsync(cs, tenantId);

        var watch = Stopwatch.StartNew();
        var items = await RunAsync(cs, tenantId, "reprice", ids, list: list);
        watch.Stop();

        _output.WriteLine($"25 reprices: {watch.Elapsed.TotalSeconds:F1} s");
        Assert.All(items, i => Assert.Equal("Created", i.Outcome));
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(20), $"25 reprices took {watch.Elapsed.TotalSeconds:F1} s (budget 40 s, half kept as headroom).");
    }

    private const int AgreementBulkService_Cap = 25;
}
