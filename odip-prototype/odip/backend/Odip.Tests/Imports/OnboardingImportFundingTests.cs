using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Funding;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Support;
using Xunit;
using static Odip.Tests.Imports.ImportTestSupport;

namespace Odip.Tests.Imports;

public class OnboardingImportFundingTests
{
    private const string Header = "NDIS number,First name,Last name,Date of birth,Plan start,Plan end,Support category,Managed by,Amount";

    // Three rows make Ava's plan (01 and 02 add into Core); the fourth names nobody in ODIP.
    private static readonly byte[] File = Csv(Header,
        "430000001,,,,01/07/2026,30/06/2027,01,Plan managed,1000",
        "430000001,,,,01/07/2026,30/06/2027,02,Plan managed,250.50",
        "430000001,,,,01/07/2026,30/06/2027,15,NDIA managed,5000",
        "430000009,,,,01/07/2026,30/06/2027,Core,Self managed,100");

    private static (OdipDbContext Db, Guid TenantId, Guid AvaId) WithAva()
    {
        var tenantId = Guid.NewGuid();
        var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var ava = new Participant { Id = Guid.NewGuid(), TenantId = tenantId, FirstName = "Ava", LastName = "Stone", NdisNumber = "430000001", DateOfBirth = new DateOnly(1990, 4, 3), IsActive = true };
        db.Participants.Add(ava);
        db.SaveChanges();
        return (db, tenantId, ava.Id);
    }

    [Fact]
    public async Task Preview_matches_groups_and_counts_plans_and_writes_nothing()
    {
        var (db, tenantId, _) = WithAva();
        using var scope = db;

        var preview = await Service(db, tenantId).PreviewAsync(ImportKind.FundingPlans, File, "budgets.csv", null, CancellationToken.None, Admin());

        Assert.Equal((3, 0, 1, 1), (preview.ReadyCount, preview.SkippedCount, preview.InvalidCount, preview.CreateCount));
        Assert.Equal(new[] { "Ava Stone", "Ava Stone", "Ava Stone", "NDIS 430000009" }, preview.Rows.Select(r => r.Name));
        Assert.Equal("No participant in ODIP has this NDIS number. Import or add them first.", preview.Rows[3].Reasons.Single());
        Assert.Empty(await db.FundingPlans.ToListAsync());
        Assert.Empty(await db.ImportBatches.ToListAsync());
    }

    [Fact]
    public async Task Commit_creates_one_plan_per_participant_and_period_with_evidence_Other_and_the_import_note()
    {
        var (db, tenantId, avaId) = WithAva();
        using var scope = db;

        var result = await Service(db, tenantId).CommitAsync(ImportKind.FundingPlans, File, "budgets.csv", null, null, "key-1", Admin(), CancellationToken.None);

        Assert.Equal((1, 0, 1), (result.CreatedCount, result.SkippedCount, result.FailedCount));
        var plan = await db.FundingPlans.Include(p => p.Pools).ThenInclude(p => p.Periods).SingleAsync();
        Assert.Equal((avaId, BudgetEvidenceSource.Other, 1, AdminId.ToString()), (plan.ParticipantId, plan.Evidence, plan.Revision, plan.CreatedBy));
        var today = await ProviderTimeZoneResolver.TodayAsync(db, TimeProvider.System, CancellationToken.None);
        Assert.Equal($"Imported from budgets.csv on {today.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}.", plan.Notes);
        Assert.Equal(new[] { (0, 1250.50m), (15, 5000m) }, plan.Pools.OrderBy(p => p.PaceCategory).Select(p => (p.PaceCategory, p.Periods.Single().PlanAmount)));
        var item = await db.ImportBatchItems.SingleAsync();
        Assert.Equal((nameof(FundingPlan), plan.Id), (item.EntityType, item.EntityId));
        Assert.Equal(ImportKind.FundingPlans, (await db.ImportBatches.SingleAsync()).Kind);
    }

    [Fact]
    public async Task Importing_the_same_file_again_refuses_the_plans_already_in_ODIP_and_overwrites_nothing()
    {
        var (db, tenantId, _) = WithAva();
        using var scope = db;
        var service = Service(db, tenantId);
        await service.CommitAsync(ImportKind.FundingPlans, File, "budgets.csv", null, null, "key-1", Admin(), CancellationToken.None);

        var again = await service.CommitAsync(ImportKind.FundingPlans, File, "budgets.csv", null, null, "key-2", Admin(), CancellationToken.None);

        Assert.Equal((0, 4), (again.CreatedCount, again.FailedCount));
        Assert.StartsWith("This participant already has a plan in ODIP from 1 Jul 2026 to 30 Jun 2027", again.Rows[0].Reasons.Single());
        Assert.Equal(1250.50m, await db.FundingPeriods.Where(p => p.FundingPool!.PaceCategory == 0).Select(p => p.PlanAmount).SingleAsync());
        Assert.Single(await db.FundingPlans.ToListAsync());
    }

    [Fact]
    public async Task A_participant_an_undone_import_archived_is_not_matched()
    {
        var tenantId = Guid.NewGuid();
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var service = Service(db, tenantId);
        var people = Csv("First name,Last name,NDIS number", "Ava,Stone,430000001");
        var first = await service.CommitAsync(ImportKind.Participants, people, "people.csv", null, ImportLanding.Active, "p-1", Admin(), CancellationToken.None);
        Assert.Empty((await service.UndoAsync(first.BatchId, Admin(), CancellationToken.None)).Blockers);
        await service.CommitAsync(ImportKind.Participants, people, "people-fixed.csv", null, ImportLanding.Active, "p-2", Admin(), CancellationToken.None);
        var live = await db.Participants.SingleAsync(p => p.IsActive);

        var result = await service.CommitAsync(ImportKind.FundingPlans, Csv(Header, "430000001,,,,01/07/2026,30/06/2027,Core,Self managed,100"),
            "budgets.csv", null, null, "f-1", Admin(), CancellationToken.None);

        Assert.Equal(1, result.CreatedCount);
        Assert.Equal(live.Id, (await db.FundingPlans.SingleAsync()).ParticipantId);
    }

    [Fact]
    public async Task Undo_deletes_the_plans_with_their_pools_and_periods_and_then_the_participants_can_be_undone()
    {
        var tenantId = Guid.NewGuid();
        using var db = TestDb.ForTenant(Guid.NewGuid().ToString(), tenantId);
        var service = Service(db, tenantId);
        var people = await service.CommitAsync(ImportKind.Participants, Csv("First name,Last name,NDIS number", "Ava,Stone,430000001"), "people.csv", null, ImportLanding.Active, "p-1", Admin(), CancellationToken.None);
        var funding = await service.CommitAsync(ImportKind.FundingPlans, File, "budgets.csv", null, null, "f-1", Admin(), CancellationToken.None);
        Assert.Equal("has a funding plan", (await service.UndoAsync(people.BatchId, Admin(), CancellationToken.None)).Blockers.Single().Reason);

        var outcome = await service.UndoAsync(funding.BatchId, Admin(), CancellationToken.None);

        Assert.Empty(outcome.Blockers);
        Assert.Equal((ImportKind.FundingPlans, "Ada Admin"), (outcome.Batch!.Kind, outcome.Batch.UndoneByName));
        Assert.Empty(await db.FundingPlans.ToListAsync());
        Assert.Empty(await db.FundingPools.ToListAsync());
        Assert.Empty(await db.FundingPeriods.ToListAsync());
        Assert.Empty((await service.UndoAsync(people.BatchId, Admin(), CancellationToken.None)).Blockers);
    }

    [Fact]
    public async Task Undo_is_refused_while_a_plan_was_changed_since_and_names_it()
    {
        var (db, tenantId, _) = WithAva();
        using var scope = db;
        var service = Service(db, tenantId);
        var result = await service.CommitAsync(ImportKind.FundingPlans, File, "budgets.csv", null, null, "key-1", Admin(), CancellationToken.None);
        var plan = await db.FundingPlans.SingleAsync();
        plan.Revision = 2;
        await db.SaveChangesAsync();

        var outcome = await service.UndoAsync(result.BatchId, Admin(), CancellationToken.None);

        Assert.Equal(new ImportUndoBlockerDto(plan.Id, "The plan for Ava Stone (1 Jul 2026 to 30 Jun 2027)", "was changed after the import"), outcome.Blockers.Single());
        Assert.Single(await db.FundingPlans.ToListAsync());
        Assert.Null((await db.ImportBatches.SingleAsync()).UndoneAt);
    }

    [Fact]
    public async Task A_plan_deleted_by_hand_since_the_import_does_not_stop_the_undo()
    {
        var (db, tenantId, avaId) = WithAva();
        using var scope = db;
        var service = Service(db, tenantId);
        var result = await service.CommitAsync(ImportKind.FundingPlans, File, "budgets.csv", null, null, "key-1", Admin(), CancellationToken.None);
        var planId = (await db.FundingPlans.SingleAsync()).Id;
        Assert.True(await new FundingPlanService(db, TimeProvider.System).DeleteAsync(tenantId, avaId, planId, CancellationToken.None));
        db.ChangeTracker.Clear();

        var outcome = await service.UndoAsync(result.BatchId, Admin(), CancellationToken.None);

        Assert.Empty(outcome.Blockers);
        Assert.NotNull(outcome.Batch!.UndoneAt);
    }
}
