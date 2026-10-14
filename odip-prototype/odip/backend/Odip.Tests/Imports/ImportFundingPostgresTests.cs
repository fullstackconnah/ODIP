using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Postgres;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

/// <summary>
/// The funding plans import against a real PostgreSQL. FundingPlanLock runs inside the import's own transaction (InMemory has neither), the
/// matching and overlap queries translate, and undo deletes with its cascade.
/// </summary>
public class ImportFundingPostgresTests : IClassFixture<PostgresFixture>
{
    private const string Header = "NDIS number,Plan start,Plan end,Support category,Managed by,Amount";
    private readonly PostgresFixture _pg;
    public ImportFundingPostgresTests(PostgresFixture pg) => _pg = pg;

    private OdipDbContext Open(Guid tenantId) => new(new DbContextOptionsBuilder<OdipDbContext>().UseNpgsql(_pg.ConnectionString).Options, Tenant(tenantId));

    /// <summary>A new organisation with Ava and Ben, whose NDIS numbers (9 digits, as the import needs) belong to this test alone.</summary>
    private async Task<(Guid TenantId, Guid Ava, string AvaNdis, Guid Ben, string BenNdis)> SetUpAsync()
    {
        var (setup, tenantId) = await _pg.NewTenantContextAsync();
        await using (setup)
        {
            var ava = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ava", LastName = "Stone", NdisNumber = $"4{Random.Shared.Next(10_000_000, 100_000_000)}", IsActive = true };
            var ben = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ben", LastName = "Lee", NdisNumber = $"5{Random.Shared.Next(10_000_000, 100_000_000)}", IsActive = true };
            setup.Participants.AddRange(ava, ben);
            await setup.SaveChangesAsync();
            return (tenantId, ava.Id, ava.NdisNumber, ben.Id, ben.NdisNumber);
        }
    }

    private static SaveFundingPlanDto CorePlan(DateOnly start, DateOnly end, decimal amount) => new()
    {
        PlanStart = start, PlanEnd = end, Evidence = BudgetEvidenceSource.PlanCopy,
        Pools = [new SaveFundingPoolDto { Kind = FundingPoolKind.CoreFlexible, ManagementType = PlanType.SelfManaged,
            Periods = [new SaveFundingPeriodDto { PeriodStart = start, PeriodEnd = end, PlanAmount = amount }] }],
    };

    [SkippableFact]
    public async Task The_commit_waits_for_a_plan_save_in_flight_then_imports_on_Postgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, ava, avaNdis, _, _) = await SetUpAsync();
        await using var holder = new NpgsqlConnection(_pg.ConnectionString);
        await holder.OpenAsync();
        // What an in-flight save on the Funding tab holds (FundingPlanLock), taken BEFORE the import starts.
        await using var held = await holder.BeginTransactionAsync();
        await using (var command = new NpgsqlCommand("SELECT \"Id\" FROM \"Participants\" WHERE \"Id\" = @id FOR NO KEY UPDATE", holder, held))
        {
            command.Parameters.AddWithValue("id", ava);
            await command.ExecuteScalarAsync();
        }

        await using var db = Open(tenantId);
        var import = Task.Run(() => Service(db, tenantId).CommitAsync(ImportKind.FundingPlans, Csv(Header, $"{avaNdis},01/07/2026,30/06/2027,Core,Self managed,100"),
            "budgets.csv", null, null, $"k-{Guid.NewGuid():N}", Admin(), CancellationToken.None));
        await Task.Delay(1500);
        Assert.False(import.IsCompleted, "the import wrote a plan while the participant's row was held: it does not take FundingPlanLock");
        await held.CommitAsync();

        var result = await import.WaitAsync(TimeSpan.FromSeconds(30));

        Assert.Equal(1, result.CreatedCount);
        await using var check = Open(tenantId);
        Assert.Equal(1, await check.FundingPlans.CountAsync(f => f.ParticipantId == ava));
    }

    [SkippableFact]
    public async Task A_plan_saved_while_the_import_waits_refuses_that_plan_and_the_rest_import_on_Postgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, ava, avaNdis, ben, benNdis) = await SetUpAsync();
        // A coordinator's save on the Funding tab, in flight: it holds Ava's row and has written a plan it has not committed yet. The import's own
        // planning cannot see that plan, so Ava's rows reach CreateAsync, which must wait for the row and then refuse the overlap.
        await using var coordinator = Open(tenantId);
        await using var tx = await coordinator.Database.BeginTransactionAsync();
        var manual = await new FundingPlanService(coordinator, TimeProvider.System)
            .CreateAsync(tenantId, ava, CorePlan(new DateOnly(2026, 7, 1), new DateOnly(2027, 6, 30), 500m), "coordinator", CancellationToken.None);
        Assert.NotNull(manual.Plan);

        await using var db = Open(tenantId);
        var import = Task.Run(() => Service(db, tenantId).CommitAsync(ImportKind.FundingPlans,
            Csv(Header, $"{avaNdis},01/01/2027,31/12/2027,Core,Plan managed,100", $"{benNdis},01/07/2026,30/06/2027,15,NDIA managed,200"),
            "budgets.csv", null, null, $"k-{Guid.NewGuid():N}", Admin(), CancellationToken.None));
        await Task.Delay(1500);
        Assert.False(import.IsCompleted, "the import should be waiting for Ava's row");
        await tx.CommitAsync();

        var result = await import.WaitAsync(TimeSpan.FromSeconds(30));

        Assert.Equal((1, 1), (result.CreatedCount, result.FailedCount));
        Assert.Equal("This plan (1 Jan 2027 to 31 Dec 2027) overlaps the plan that runs 1 Jul 2026 to 30 Jun 2027. Change the dates, or edit that plan.", result.Rows[0].Reasons.Single());
        await using var check = Open(tenantId);
        Assert.Equal(new[] { 500m }, await check.FundingPlans.Where(f => f.ParticipantId == ava).SelectMany(f => f.Pools).SelectMany(p => p.Periods).Select(p => p.PlanAmount).ToListAsync());
        Assert.Equal(1, await check.FundingPlans.CountAsync(f => f.ParticipantId == ben));
        Assert.True(await check.ImportBatches.AnyAsync(b => b.Id == result.BatchId && b.CreatedCount == 1));
    }

    [SkippableFact]
    public async Task A_participant_of_another_organisation_is_never_matched_on_Postgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantA, _, _, _, _) = await SetUpAsync();
        var (_, avaOfB, ndisOfB, _, _) = await SetUpAsync();
        await using var db = Open(tenantA);
        var service = Service(db, tenantA);
        var file = Csv(Header, $"{ndisOfB},01/07/2026,30/06/2027,Core,Self managed,100");

        var preview = await service.PreviewAsync(ImportKind.FundingPlans, file, "budgets.csv", null, CancellationToken.None, Admin());
        var result = await service.CommitAsync(ImportKind.FundingPlans, file, "budgets.csv", null, null, $"k-{Guid.NewGuid():N}", Admin(), CancellationToken.None);

        Assert.Equal("No participant in ODIP has this NDIS number. Import or add them first.", preview.Rows.Single().Reasons.Single());
        Assert.Equal((0, 1), (result.CreatedCount, result.FailedCount));
        await using var unfiltered = PostgresFixture.NewContext(_pg.ConnectionString);
        Assert.False(await unfiltered.FundingPlans.IgnoreQueryFilters().AnyAsync(f => f.ParticipantId == avaOfB));
    }

    [SkippableFact]
    public async Task Undo_deletes_the_plans_with_their_pools_and_periods_and_a_changed_plan_is_named_on_Postgres()
    {
        Skip.IfNot(_pg.Available, "POSTGRES_CONNECTION_STRING is not set - no PostgreSQL to test against.");
        var (tenantId, ava, avaNdis, ben, benNdis) = await SetUpAsync();
        await using var db = Open(tenantId);
        var service = Service(db, tenantId);
        var first = await service.CommitAsync(ImportKind.FundingPlans, Csv(Header, $"{avaNdis},01/07/2026,30/06/2027,01,Plan managed,100", $"{avaNdis},01/07/2026,30/06/2027,15,Plan managed,50"),
            "budgets.csv", null, null, $"k-{Guid.NewGuid():N}", Admin(), CancellationToken.None);
        var second = await service.CommitAsync(ImportKind.FundingPlans, Csv(Header, $"{benNdis},01/07/2026,30/06/2027,Core,Self managed,100"),
            "ben.csv", null, null, $"k-{Guid.NewGuid():N}", Admin(), CancellationToken.None);
        await using (var edit = Open(tenantId))
        {
            (await edit.FundingPlans.SingleAsync(f => f.ParticipantId == ben)).Revision = 2;
            await edit.SaveChangesAsync();
        }
        db.ChangeTracker.Clear();

        var undone = await service.UndoAsync(first.BatchId, Admin(), CancellationToken.None);
        var refused = await service.UndoAsync(second.BatchId, Admin(), CancellationToken.None);

        Assert.Empty(undone.Blockers);
        var blocker = refused.Blockers.Single();
        Assert.Equal("The plan for Ben Lee (1 Jul 2026 to 30 Jun 2027) was changed after the import", $"{blocker.Name} {blocker.Reason}");
        await using var check = Open(tenantId);
        Assert.False(await check.FundingPlans.AnyAsync(f => f.ParticipantId == ava));
        Assert.False(await check.FundingPools.AnyAsync(p => p.FundingPlan!.ParticipantId == ava));
        Assert.True(await check.FundingPlans.AnyAsync(f => f.ParticipantId == ben));
    }
}
