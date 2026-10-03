using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Xunit;
using static Odip.Tests.Funding.FundingTestKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The plan budget endpoints against the real service, the real tenant filter and the real audit interceptor (InMemory): what a save stores, what it refuses and
/// how, the revision and overlap 409s, delete, apply-dates, the Billing hint, and that no other organisation's participant or plan can be reached.
/// </summary>
public class ParticipantFundingControllerTests
{
    // ── Reading ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task Plans_OfAParticipantWithNone_IsAnEmptyList_AndCarriesTheProfilePlanDates()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant(planStart: D(2026, 7, 1), planEnd: D(2027, 6, 30));

        var body = Body(await kit.Controller.Plans(participant.Id, CancellationToken.None));

        Assert.Empty(body.Plans);
        Assert.Equal((D(2026, 7, 1), D(2027, 6, 30)), (body.ProfilePlanDates.Start, body.ProfilePlanDates.End));
    }

    [Fact]
    public async Task Plans_AreNewestFirst_WithPoolsAndPeriodsInOrder_AndPoolTotalsAreTheSumOfThePeriods()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        var older = await kit.CreatePlanAsync(participant.Id, Plan(
            Core(periods: Quarters(2500m, setAside: 1000m)),
            Stated(15, periods: Quarters(500m))));
        var newer = await kit.CreatePlanAsync(participant.Id, NextYearsPlan());

        var body = Body(await kit.Controller.Plans(participant.Id, CancellationToken.None));

        Assert.Equal(new[] { newer.Id, older.Id }, body.Plans.Select(p => p.Id));
        var pools = body.Plans[1].Pools;
        Assert.Equal(new[] { FundingPoolKind.CoreFlexible, FundingPoolKind.Stated }, pools.Select(p => p.Kind));
        Assert.Equal(new[] { 0, 1 }, pools.Select(p => p.Position));
        Assert.Equal(10_000m, pools[0].PlanTotal);
        Assert.Equal(4_000m, pools[0].SetAsideTotal);
        Assert.Equal(2_000m, pools[1].PlanTotal);
        Assert.Null(pools[1].SetAsideTotal);   // no set-aside on the pool: the limit is the plan amount
        Assert.Equal(new[] { D(2026, 7, 1), D(2026, 10, 1), D(2027, 1, 1), D(2027, 4, 1) }, pools[0].Periods.Select(p => p.PeriodStart));
    }

    [Fact]
    public async Task Plans_OfAnotherTenantsParticipant_Is404_AndNothingOfTheirsIsReturned()
    {
        var database = Guid.NewGuid().ToString();
        using var other = Create(TenantB, database: database);
        var theirs = other.SeedParticipant(TenantB);
        await other.CreatePlanAsync(theirs.Id);
        using var mine = Create(TenantA, database: database);

        var result = await mine.Controller.Plans(theirs.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
    }

    /// <summary>The errors of whichever ApiResponse of T a failure carries.</summary>
    private static List<string> ErrorsOf(object? response) =>
        Assert.IsType<List<string>>(response!.GetType().GetProperty(nameof(ApiResponse<object>.Errors))!.GetValue(response));

    // ── Creating ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Create_StoresThePlanItsPoolsAndItsPeriods_AndAnswers201WithThePlan()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();

        var result = await kit.Controller.CreatePlan(participant.Id, Plan(), CancellationToken.None);

        var plan = Body(result, StatusCodes.Status201Created);
        Assert.Equal(1, plan.Revision);
        Assert.Equal(participant.Id, plan.ParticipantId);
        Assert.Equal((D(2026, 7, 1), D(2027, 6, 30), D(2027, 5, 1), 3), (plan.PlanStart, plan.PlanEnd, plan.ReassessmentDate, plan.PeriodLengthMonths));
        Assert.Equal((BudgetEvidenceSource.PlanCopy, D(2026, 9, 20), "Priya Coordinator"), (plan.Evidence, plan.ConfirmedOn, plan.ConfirmedByName));
        Assert.Equal(FundingTestKit.Now.UtcDateTime, plan.CreatedAt);
        Assert.Equal(plan.CreatedAt, plan.UpdatedAt);
        Assert.Equal(2, plan.Pools.Count);
        Assert.Equal("Core (flexible)", plan.Pools[0].Name);                 // the pool the plan prints no name for takes the category's name
        Assert.Equal("Improved Daily Living Skills", plan.Pools[1].Name);
        Assert.Equal(15, plan.Pools[1].PaceCategory);
        Assert.Equal(PlanType.AgencyManaged, plan.Pools[1].ManagementType);

        var stored = await kit.Db.FundingPlans.Include(p => p.Pools).ThenInclude(p => p.Periods).SingleAsync();
        Assert.Equal((FundingTestKit.UserId.ToString(), FundingTestKit.UserId.ToString()), (stored.CreatedBy, stored.UpdatedBy));
        Assert.All(stored.Pools, pool => Assert.Equal(TenantA, pool.TenantId));
        Assert.All(stored.Pools.SelectMany(p => p.Periods), period => Assert.Equal(TenantA, period.TenantId));
        Assert.Equal(8, stored.Pools.Sum(p => p.Periods.Count));
    }

    [Fact]
    public async Task Create_ForADraftParticipant_Works_BecauseIntakeRecordsTheBudgetBeforeTheProfileIsDone()
    {
        using var kit = Create();
        var draft = kit.SeedParticipant(isDraft: true);

        Body(await kit.Controller.CreatePlan(draft.Id, Plan(), CancellationToken.None), StatusCodes.Status201Created);
    }

    [Fact]
    public async Task Create_WithAnInvalidBody_Is400WithEveryReasonInErrors_AndWritesNothing()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        var broken = Plan(Stated(2), Stated(18)) with { PeriodLengthMonths = 2, Evidence = null };

        var result = await kit.Controller.CreatePlan(participant.Id, broken, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        var response = Assert.IsType<ApiResponse<FundingPlanDto>>(bad.Value);
        Assert.False(response.Success);
        Assert.True(response.Errors!.Count >= 4);
        Assert.Contains(response.Errors, e => e.Contains("Recurring Transport (18)", StringComparison.Ordinal));
        Assert.Empty(kit.Db.FundingPlans);
        Assert.Empty(kit.Db.FundingPools);
    }

    [Fact]
    public async Task Create_OverlappingAnotherPlanOfTheParticipant_Is409NamingTheClashingPlan_AndWritesNothing()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        var existing = await kit.CreatePlanAsync(participant.Id);   // 1 Jul 2026 to 30 Jun 2027
        var overlapping = NextYearsPlan() with
        {
            PlanStart = D(2027, 6, 1), PlanEnd = D(2028, 5, 31),
            Pools = new List<SaveFundingPoolDto>
            {
                Core(periods: new()
                {
                    Period(D(2027, 6, 1), D(2027, 8, 31), 100m), Period(D(2027, 9, 1), D(2027, 11, 30), 100m),
                    Period(D(2027, 12, 1), D(2028, 2, 29), 100m), Period(D(2028, 3, 1), D(2028, 5, 31), 100m),
                }),
            },
        };

        var result = await kit.Controller.CreatePlan(participant.Id, overlapping, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        var response = Assert.IsType<ApiResponse<FundingPlanOverlapDto>>(conflict.Value);
        Assert.Equal("funding-plan-overlap", response.Code);
        Assert.Equal((existing.Id, D(2026, 7, 1), D(2027, 6, 30)), (response.Data!.ConflictingPlanId, response.Data.ConflictingPlanStart, response.Data.ConflictingPlanEnd));
        Assert.Contains("1 Jul 2026 to 30 Jun 2027", Assert.Single(response.Errors!));
        Assert.Equal(1, await kit.Db.FundingPlans.CountAsync());
    }

    [Fact]
    public async Task Create_APlanThatStartsTheDayAfterAnotherEnds_IsNotAnOverlap_AndTheSameDatesForAnotherParticipantAreFine()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        var someoneElse = kit.SeedParticipant();
        await kit.CreatePlanAsync(participant.Id);

        await kit.CreatePlanAsync(participant.Id, NextYearsPlan());   // starts 1 Jul 2027, the day after the first ends
        await kit.CreatePlanAsync(someoneElse.Id);                    // the same dates as the first, for a different person

        Assert.Equal(3, await kit.Db.FundingPlans.CountAsync());
    }

    [Fact]
    public async Task Create_ForAnotherTenantsParticipant_Is404_AndWritesNothing()
    {
        var database = Guid.NewGuid().ToString();
        using var other = Create(TenantB, database: database);
        var theirs = other.SeedParticipant(TenantB);
        using var mine = Create(TenantA, database: database);

        var result = await mine.Controller.CreatePlan(theirs.Id, Plan(), CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Empty(await other.Db.FundingPlans.ToListAsync());
    }

    [Fact]
    public async Task EveryEndpoint_RefusesASuperAdminWhoHasNotChosenAnOrganisation()
    {
        using var kit = Create(isSuperAdmin: true, role: "SuperAdmin");
        var id = Guid.NewGuid();

        var results = new IActionResult?[]
        {
            (await kit.Controller.Plans(id, default)).Result,
            (await kit.Controller.CreatePlan(id, Plan(), default)).Result,
            (await kit.Controller.UpdatePlan(id, Guid.NewGuid(), Plan() with { Revision = 1 }, default)).Result,
            (await kit.Controller.DeletePlan(id, Guid.NewGuid(), default)).Result,
            (await kit.Controller.ApplyDatesToProfile(id, Guid.NewGuid(), default)).Result,
            (await kit.Controller.BillingSourcesHint(id, default)).Result,
        };

        foreach (var result in results)
        {
            var bad = Assert.IsType<BadRequestObjectResult>(result);
            Assert.Contains("Choose an organisation", Assert.Single(ErrorsOf(bad.Value)), StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Create_AuditsThePlanEachPoolAndEachPeriod_WithTheActor()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();

        await kit.CreatePlanAsync(participant.Id);

        var rows = await kit.Db.AuditLogs.ToListAsync();
        Assert.Equal(1, rows.Count(r => r.EntityType == nameof(FundingPlan)));
        Assert.Equal(2, rows.Count(r => r.EntityType == nameof(FundingPool)));
        Assert.Equal(8, rows.Count(r => r.EntityType == nameof(FundingPeriod)));
        Assert.All(rows, row => Assert.Equal((AuditAction.Created, FundingTestKit.UserId), (row.Action, row.ChangedById)));
        var periodRow = rows.First(r => r.EntityType == nameof(FundingPeriod));
        Assert.Contains("PlanAmount", periodRow.Changes, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Create_TwoPoolsForTheSameCategoryAndManagement_Is400_TheDatabaseNeverSeesTheDuplicate()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();

        var result = await kit.Controller.CreatePlan(participant.Id, Plan(Core(PlanType.PlanManaged), Core(PlanType.PlanManaged)), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains(Assert.IsType<ApiResponse<FundingPlanDto>>(bad.Value).Errors!, e => e.Contains("twice", StringComparison.Ordinal));
    }

    // ── Replacing ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Update_ReplacesThePlanFields_KeepsTheRowsThatMatch_AddsAndRemovesTheRest_AndBumpsTheRevision()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        var created = await kit.CreatePlanAsync(participant.Id);   // Core (plan managed) + stated 15 (agency managed)
        kit.ClearAudit();
        kit.Clock.Set(FundingTestKit.Now.AddHours(2));

        var edited = Plan(
            Core(PlanType.PlanManaged, periods: Quarters(2200m, setAside: 1100m)),   // same pool, new amounts
            Stated(9, PlanType.PlanManaged))                                         // a new pool; the stated 15 pool goes
            with { Revision = 1, Notes = "Updated after the plan manager's statement.", Evidence = BudgetEvidenceSource.PlanManager };
        var result = await kit.Controller.UpdatePlan(participant.Id, created.Id, edited, CancellationToken.None);

        var updated = Body(result);
        Assert.Equal(2, updated.Revision);
        Assert.Equal(created.CreatedAt, updated.CreatedAt);
        Assert.Equal(FundingTestKit.Now.AddHours(2).UtcDateTime, updated.UpdatedAt);
        Assert.Equal((BudgetEvidenceSource.PlanManager, "Updated after the plan manager's statement."), (updated.Evidence, updated.Notes));
        Assert.Equal(new[] { 0, 9 }, updated.Pools.Select(p => p.PaceCategory));
        // The matching pool and its periods keep their ids, so a later phase's references and the audit history stay attached.
        Assert.Equal(created.Pools[0].Id, updated.Pools[0].Id);
        Assert.Equal(created.Pools[0].Periods.Select(p => p.Id), updated.Pools[0].Periods.Select(p => p.Id));
        Assert.Equal(8_800m, updated.Pools[0].PlanTotal);
        Assert.Equal(4_400m, updated.Pools[0].SetAsideTotal);
        Assert.DoesNotContain(created.Pools[1].Id, updated.Pools.Select(p => p.Id));

        Assert.Equal(2, await kit.Db.FundingPools.CountAsync());
        Assert.Equal(8, await kit.Db.FundingPeriods.CountAsync());   // the removed pool's periods went with it
        // An edit is audited as what changed: the plan's Notes/Evidence/Revision, the kept pool's periods, and the removed and added rows.
        var rows = await kit.Db.AuditLogs.ToListAsync();
        Assert.Contains(rows, r => r.EntityType == nameof(FundingPlan) && r.Action == AuditAction.Updated && r.Changes.Contains("Revision", StringComparison.Ordinal));
        Assert.Equal(4, rows.Count(r => r.EntityType == nameof(FundingPeriod) && r.Action == AuditAction.Updated));
        Assert.Equal(1, rows.Count(r => r.EntityType == nameof(FundingPool) && r.Action == AuditAction.Deleted));
        Assert.Equal(4, rows.Count(r => r.EntityType == nameof(FundingPeriod) && r.Action == AuditAction.Deleted));
        Assert.Equal(1, rows.Count(r => r.EntityType == nameof(FundingPool) && r.Action == AuditAction.Created));
    }

    [Fact]
    public async Task Update_ChangingThePlanDatesAndThePeriodLength_RewritesThePeriods_AndTheOldStartsDoNotCollide()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        var created = await kit.CreatePlanAsync(participant.Id, Plan(Core()));
        // The plan now starts a fortnight later and has no funding periods: one period for the whole plan.
        var edited = Plan(Core(periods: new() { Period(D(2026, 7, 15), D(2027, 6, 30), 8000m) })) with { Revision = 1, PlanStart = D(2026, 7, 15), PeriodLengthMonths = null };

        var updated = Body(await kit.Controller.UpdatePlan(participant.Id, created.Id, edited, CancellationToken.None));

        Assert.Null(updated.PeriodLengthMonths);
        var period = Assert.Single(Assert.Single(updated.Pools).Periods);
        Assert.Equal((D(2026, 7, 15), D(2027, 6, 30), 8000m), (period.PeriodStart, period.PeriodEnd, period.PlanAmount));
        Assert.Equal(1, await kit.Db.FundingPeriods.CountAsync());
    }

    [Fact]
    public async Task Update_WithAStaleRevision_Is409WithTheCurrentRevision_AndChangesNothing()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        var created = await kit.CreatePlanAsync(participant.Id);
        Body(await kit.Controller.UpdatePlan(participant.Id, created.Id, Plan() with { Revision = 1, Notes = "Somebody else saved first." }, CancellationToken.None));

        var stale = await kit.Controller.UpdatePlan(participant.Id, created.Id, Plan() with { Revision = 1, Notes = "My stale change." }, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(stale.Result);
        var response = Assert.IsType<ApiResponse<FundingRevisionConflictDto>>(conflict.Value);
        Assert.Equal("funding-revision-conflict", response.Code);
        Assert.Equal(2, response.Data!.CurrentRevision);
        Assert.Equal("Somebody else saved first.", (await kit.Db.FundingPlans.SingleAsync()).Notes);
    }

    [Fact]
    public async Task Update_WithoutARevision_Is400_ASaveMustSaySoWhatItWasMadeFrom()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        var created = await kit.CreatePlanAsync(participant.Id);

        var result = await kit.Controller.UpdatePlan(participant.Id, created.Id, Plan() with { Revision = null }, CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result.Result);
        Assert.Contains(Assert.IsType<ApiResponse<FundingPlanDto>>(bad.Value).Errors!, e => e.Contains("revision", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task Update_ToDatesThatOverlapAnotherPlan_Is409_ButKeepingItsOwnDatesIsNotAnOverlapWithItself()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        var first = await kit.CreatePlanAsync(participant.Id);
        var second = await kit.CreatePlanAsync(participant.Id, NextYearsPlan());

        Body(await kit.Controller.UpdatePlan(participant.Id, first.Id, Plan() with { Revision = 1, Notes = "same dates, new notes" }, CancellationToken.None));

        var intoTheFirst = NextYearsPlan() with
        {
            Revision = 1, PlanStart = D(2027, 6, 30), PlanEnd = D(2028, 6, 29),
            Pools = new List<SaveFundingPoolDto>
            {
                Core(periods: new()
                {
                    Period(D(2027, 6, 30), D(2027, 9, 29), 1m), Period(D(2027, 9, 30), D(2027, 12, 29), 1m),
                    Period(D(2027, 12, 30), D(2028, 3, 29), 1m), Period(D(2028, 3, 30), D(2028, 6, 29), 1m),
                }),
            },
        };
        var result = await kit.Controller.UpdatePlan(participant.Id, second.Id, intoTheFirst, CancellationToken.None);

        var conflict = Assert.IsType<ConflictObjectResult>(result.Result);
        Assert.Equal(first.Id, Assert.IsType<ApiResponse<FundingPlanOverlapDto>>(conflict.Value).Data!.ConflictingPlanId);
    }

    [Fact]
    public async Task Update_RoutedThroughTheWrongParticipantOrAnotherTenant_Is404()
    {
        var database = Guid.NewGuid().ToString();
        using var mine = Create(TenantA, database: database);
        var a = mine.SeedParticipant();
        var b = mine.SeedParticipant();
        var plan = await mine.CreatePlanAsync(a.Id);
        using var other = Create(TenantB, database: database);

        Assert.IsType<NotFoundObjectResult>((await mine.Controller.UpdatePlan(b.Id, plan.Id, Plan() with { Revision = 1 }, CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await other.Controller.UpdatePlan(a.Id, plan.Id, Plan() with { Revision = 1 }, CancellationToken.None)).Result);
        Assert.Equal(1, (await mine.Db.FundingPlans.SingleAsync()).Revision);
    }

    // ── Deleting ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Delete_RemovesThePlanItsPoolsAndItsPeriods_AndAuditsEach()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        var created = await kit.CreatePlanAsync(participant.Id);
        kit.ClearAudit();

        var result = await kit.Controller.DeletePlan(participant.Id, created.Id, CancellationToken.None);

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Empty(kit.Db.FundingPlans);
        Assert.Empty(kit.Db.FundingPools);
        Assert.Empty(kit.Db.FundingPeriods);
        var rows = await kit.Db.AuditLogs.ToListAsync();
        Assert.All(rows, row => Assert.Equal(AuditAction.Deleted, row.Action));
        Assert.Equal((1, 2, 8), (rows.Count(r => r.EntityType == nameof(FundingPlan)), rows.Count(r => r.EntityType == nameof(FundingPool)), rows.Count(r => r.EntityType == nameof(FundingPeriod))));
    }

    [Fact]
    public async Task Delete_OfAPlanThatIsNotThere_OrOfAnotherTenant_Is404()
    {
        var database = Guid.NewGuid().ToString();
        using var mine = Create(TenantA, database: database);
        var participant = mine.SeedParticipant();
        var plan = await mine.CreatePlanAsync(participant.Id);
        using var other = Create(TenantB, database: database);

        Assert.IsType<NotFoundObjectResult>((await mine.Controller.DeletePlan(participant.Id, Guid.NewGuid(), CancellationToken.None)).Result);
        Assert.IsType<NotFoundObjectResult>((await other.Controller.DeletePlan(participant.Id, plan.Id, CancellationToken.None)).Result);
        Assert.Equal(1, await mine.Db.FundingPlans.CountAsync());
    }

    // ── Apply the plan's dates to the profile ───────────────────────────────

    [Fact]
    public async Task ApplyDates_SetsTheProfilesPlanDates_AuditsTheParticipantChange_AndOnlyWhenAsked()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant(planStart: D(2026, 1, 1), planEnd: D(2026, 12, 31));
        var created = await kit.CreatePlanAsync(participant.Id);   // 1 Jul 2026 to 30 Jun 2027

        // Recording the plan never touches the profile on its own.
        Assert.Equal((D(2026, 1, 1), D(2026, 12, 31)), ((await kit.Db.Participants.SingleAsync()).PlanStartDate, (await kit.Db.Participants.SingleAsync()).PlanEndDate));
        kit.ClearAudit();

        var result = Body(await kit.Controller.ApplyDatesToProfile(participant.Id, created.Id, CancellationToken.None));

        Assert.Equal((D(2026, 7, 1), D(2027, 6, 30), true), (result.Start, result.End, result.Changed));
        var stored = await kit.Db.Participants.SingleAsync();
        Assert.Equal((D(2026, 7, 1), D(2027, 6, 30)), (stored.PlanStartDate, stored.PlanEndDate));
        var audit = Assert.Single(await kit.Db.AuditLogs.ToListAsync());
        Assert.Equal((nameof(Odip.Domain.Entities.Participant), AuditAction.Updated, FundingTestKit.UserId), (audit.EntityType, audit.Action, audit.ChangedById));
        Assert.Contains("PlanStartDate", audit.Changes, StringComparison.Ordinal);
        Assert.Contains("PlanEndDate", audit.Changes, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ApplyDates_WhenTheProfileAlreadyMatches_ChangesNothingAndAuditsNothing()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant(planStart: D(2026, 7, 1), planEnd: D(2027, 6, 30));
        var created = await kit.CreatePlanAsync(participant.Id);
        kit.ClearAudit();

        var result = Body(await kit.Controller.ApplyDatesToProfile(participant.Id, created.Id, CancellationToken.None));

        Assert.False(result.Changed);
        Assert.Empty(await kit.Db.AuditLogs.ToListAsync());
    }

    [Fact]
    public async Task ApplyDates_ForAnotherTenantsPlan_Is404_AndTheirProfileIsUntouched()
    {
        var database = Guid.NewGuid().ToString();
        using var theirs = Create(TenantB, database: database);
        var participant = theirs.SeedParticipant(planStart: D(2026, 1, 1), planEnd: D(2026, 12, 31));
        var plan = await theirs.CreatePlanAsync(participant.Id);
        using var mine = Create(TenantA, database: database);

        var result = await mine.Controller.ApplyDatesToProfile(participant.Id, plan.Id, CancellationToken.None);

        Assert.IsType<NotFoundObjectResult>(result.Result);
        Assert.Equal(D(2026, 1, 1), (await theirs.Db.Participants.SingleAsync()).PlanStartDate);
    }

    // ── The Billing hint ────────────────────────────────────────────────────

    private static FundingSource Source(Guid tenantId, Guid participantId, FundingRouteType route, decimal? budget, DateOnly? start = null, DateOnly? end = null, bool active = true, string? category = null) => new()
    {
        Id = Guid.NewGuid(), TenantId = tenantId, ParticipantId = participantId, RouteType = route, Budget = budget, PlanStartDate = start, PlanEndDate = end, IsActive = active, BudgetCategory = category,
    };

    [Fact]
    public async Task Hint_SumsTheActiveNdisSourcesWithABudget_AndReportsTheirDatesRowsAndTheBiggestManagementType_ChangingNothing()
    {
        using var kit = Create();
        var participant = kit.SeedParticipant();
        kit.Db.FundingSources.AddRange(
            Source(TenantA, participant.Id, FundingRouteType.PlanManaged, 20_000m, D(2026, 7, 1), D(2027, 6, 30), category: "Core - Social & Community Participation"),
            Source(TenantA, participant.Id, FundingRouteType.AgencyManaged, 5_000.5m, D(2026, 8, 1), D(2027, 8, 1)),
            Source(TenantA, participant.Id, FundingRouteType.SelfManaged, 100m),                     // no dates of its own
            Source(TenantA, participant.Id, FundingRouteType.PlanManaged, 9_999m, active: false),   // inactive
            Source(TenantA, participant.Id, FundingRouteType.Private, 7_000m),                     // not NDIS money
            Source(TenantA, participant.Id, FundingRouteType.BusinessToBusiness, 7_000m),
            Source(TenantA, participant.Id, FundingRouteType.PlanManaged, null),                   // no budget
            Source(TenantA, participant.Id, FundingRouteType.PlanManaged, 0m));
        kit.Db.SaveChanges();
        var before = JsonSerializer.Serialize(await kit.Db.FundingSources.OrderBy(f => f.Id).Select(f => new { f.Id, f.Budget, f.IsActive, f.RouteType }).ToListAsync());
        kit.ClearAudit();

        var hint = Body(await kit.Controller.BillingSourcesHint(participant.Id, CancellationToken.None));

        Assert.Equal(25_100.5m, hint.Total);
        Assert.Equal((D(2026, 7, 1), D(2027, 8, 1)), (hint.PlanStart, hint.PlanEnd));
        Assert.Equal(PlanType.PlanManaged, hint.ManagementType);
        Assert.Equal(3, hint.Rows.Count);
        Assert.Contains(hint.Rows, r => r.BudgetCategory == "Core - Social & Community Participation" && r.Budget == 20_000m && r.RouteType == FundingRouteType.PlanManaged);
        // Read-only: nothing was written, audit included, and the Billing rows are as they were.
        Assert.Empty(await kit.Db.AuditLogs.ToListAsync());
        Assert.Equal(before, JsonSerializer.Serialize(await kit.Db.FundingSources.OrderBy(f => f.Id).Select(f => new { f.Id, f.Budget, f.IsActive, f.RouteType }).ToListAsync()));
    }

    [Fact]
    public async Task Hint_WithNothingToStartFrom_HasNoRows_AndAnotherOrganisationsSourcesAreNeverSeen()
    {
        var database = Guid.NewGuid().ToString();
        using var theirs = Create(TenantB, database: database);
        var theirParticipant = theirs.SeedParticipant(TenantB);
        theirs.Db.FundingSources.Add(Source(TenantB, theirParticipant.Id, FundingRouteType.PlanManaged, 50_000m));
        theirs.Db.SaveChanges();
        using var mine = Create(TenantA, database: database);
        var participant = mine.SeedParticipant();
        mine.Db.FundingSources.Add(Source(TenantA, participant.Id, FundingRouteType.Private, 3_000m));
        mine.Db.SaveChanges();

        var empty = Body(await mine.Controller.BillingSourcesHint(participant.Id, CancellationToken.None));

        Assert.Empty(empty.Rows);
        Assert.Equal(0m, empty.Total);
        Assert.IsType<NotFoundObjectResult>((await mine.Controller.BillingSourcesHint(theirParticipant.Id, CancellationToken.None)).Result);
    }
}
