using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Moq;
using Odip.Api.Controllers;
using Odip.Api.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Tests.Catalogue;
using Odip.Tests.PlanPricing;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;
using static Odip.Tests.PlanPricing.PlanPricingTestSupport;

namespace Odip.Tests.Funding;

/// <summary>
/// <c>POST api/v1/participants/{id}/funding/agreement-check</c> (budget phase 2b): what an agreement would cost against what the participant's real pools have left. The agreement is priced IN PROCESS by
/// the plan pricing engine (the real 2026-27 catalogue, imported through the real importer), every priced line is placed on a pool and a funding period by the date it is delivered and the PACE
/// category of its item (the ledger's own placement), and each pool and period answers {agreement cost, remaining = available minus used, over by}. It never blocks anything: it is a question.
/// The fixed clock is 4 Oct 2026; the plan's pools run by the month (Oct, Nov, Dec), so an agreement from Mon 19 Oct to Sun 15 Nov has two Mondays and two Wednesdays in each of two periods
/// ($294.32 a four hour weekday block in NSW).
/// </summary>
public class AgreementCheckTests
{
    private static readonly DateOnly From = D(2026, 10, 19);
    private static readonly DateOnly To = D(2026, 11, 15);
    private const decimal Block = 294.32m;   // four hours at the weekday daytime rate in NSW, one participant
    private const decimal TwoBlocks = 588.64m;

    private static PlanBlock Mondays(string id = "mon") => PlanPricingTestSupport.Block(id, PlanSupportType.CommunityAccess, DayOfWeek.Monday, T(9), T(13));
    private static PlanBlock Wednesdays(string id = "wed") => PlanPricingTestSupport.Block(id, PlanSupportType.GroupActivity, DayOfWeek.Wednesday, T(9), T(13));

    private sealed class Arrangement : IDisposable
    {
        public LedgerKit Kit { get; }
        public AgreementCheckService Service { get; }
        public Participant Person { get; }

        public Arrangement(LedgerKit kit, Participant person)
        {
            Kit = kit;
            Person = person;
            Service = new AgreementCheckService(kit.Db, new PlanPricingService(kit.Db), kit.Ledger);
        }

        public void Dispose() => Kit.Dispose();

        public AgreementCheckController Controller(ICurrentTenant? tenant = null) => new(tenant ?? Kit.Tenant!, Service);
    }

    /// <summary>The real catalogue in a database of its own (a SuperAdmin's context imports it), with group activities moved to PACE category 9 (a capacity building category, so a plan can hold it as a stated pool of its own).</summary>
    private static async Task<Arrangement> ArrangeAsync(Guid? tenantId = null, string? database = null, bool groupActivitiesInCategory9 = true, PlanType planType = PlanType.PlanManaged)
    {
        database ??= Guid.NewGuid().ToString();
        await using (var admin = CatalogueImportTestSupport.CreateDb(database))
        {
            if (!await admin.SupportCatalogueItems.AnyAsync()) await CatalogueImportTestSupport.ImportAsync(admin, CatalogueFixtures.File2026_27);
            if (groupActivitiesInCategory9)
            {
                foreach (var row in admin.SupportCatalogueItems.Where(i => i.ItemNumber == "04_102_0136_6_1")) row.PaceSupportCategoryNumber = 9;
                await admin.SaveChangesAsync();
            }
        }

        var kit = LedgerKit.Create(tenantId, database);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        return new Arrangement(kit, kit.SeedParticipant(planType: planType));
    }

    private static PeriodSpec Month(int month, decimal amount, decimal? setAside = null) => new(D(2026, month, 1), D(2026, month, DateTime.DaysInMonth(2026, month)), amount, setAside);

    /// <summary>A plan for Oct to Dec 2026 by the month: Core and the stated Increased Social and Community Participation pool (category 9).</summary>
    private static FundingPlan TwoPoolPlan(Arrangement a) =>
        a.Kit.SeedPlan(a.Person, D(2026, 10, 1), D(2026, 12, 31),
            Core(PlanType.PlanManaged, Month(10, 600m), Month(11, 1000m), Month(12, 1000m)),
            Stated(9, PlanType.PlanManaged, Month(10, 300m), Month(11, 100m), Month(12, 100m)));

    private static AgreementCheckRequestDto Blocks(params PlanBlock[] blocks) => new() { Blocks = blocks.ToList(), PeriodFrom = From, PeriodTo = To };

    private static AgreementCheckDto Body(ActionResult<ApiResponse<AgreementCheckDto>> result, int status = 200)
    {
        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(status, objectResult.StatusCode ?? 200);
        var response = Assert.IsType<ApiResponse<AgreementCheckDto>>(objectResult.Value);
        return response.Data!;
    }

    private static List<string> Errors(ActionResult<ApiResponse<AgreementCheckDto>> result, int status)
    {
        var objectResult = Assert.IsAssignableFrom<ObjectResult>(result.Result);
        Assert.Equal(status, objectResult.StatusCode);
        return Assert.IsType<ApiResponse<AgreementCheckDto>>(objectResult.Value).Errors ?? new List<string>();
    }

    // ── The split ───────────────────────────────────────────────────────────

    [Fact]
    public async Task TheAgreementIsSplitByDateIntoEachPeriod_AndByPaceCategoryIntoEachPool()
    {
        using var a = await ArrangeAsync();
        TwoPoolPlan(a);
        var shift = a.Kit.SeedShift(a.Person, D(2026, 10, 2), ShiftStatus.Completed);
        a.Kit.SeedShiftClaim(a.Person, TripClaimStatus.Paid, 100m, shift);   // $100 of Core used in October

        var check = Body(await a.Controller().Check(a.Person.Id, Blocks(Mondays(), Wednesdays()), CancellationToken.None));

        Assert.True(check.HasBudget);
        Assert.Equal((From, To, D(2026, 10, 4)), (check.PeriodFrom, check.PeriodTo, check.AsOf));
        Assert.Equal(8 * Block, check.AgreementCost);   // four Mondays and four Wednesdays
        Assert.Equal(new[] { "Core", "Increased Social and Community Participation" }, check.Pools.Select(p => p.PoolName));

        var core = check.Pools[0];
        Assert.Equal(2 * TwoBlocks, core.AgreementCost);
        Assert.True(core.Over);
        Assert.Equal(TwoBlocks - 500m, core.OverBy);   // October is $88.64 over and November fits: the pool's whole shortfall
        Assert.Equal(new[] { D(2026, 10, 1), D(2026, 11, 1) }, core.Periods.Select(p => p.PeriodStart));
        Assert.Equal((TwoBlocks, 600m, 100m, 500m, TwoBlocks - 500m), Figures(core.Periods[0]));       // October: $588.64 against $500 left: over by $88.64
        Assert.Equal((TwoBlocks, 1000m, 0m, 1000m, 0m), Figures(core.Periods[1]));                     // November: October's $500 was spent by this agreement (it costs $588.64), so nothing rolls in; its own $1,000 is plenty
        Assert.True(core.Periods[0].IsCurrent);
        Assert.False(core.Periods[1].IsCurrent);

        var stated = check.Pools[1];
        Assert.True(stated.Over);
        Assert.Equal((TwoBlocks - 300m) + (TwoBlocks - 100m), stated.OverBy);   // over in both periods, and each overspend leaves nothing to carry
        Assert.Equal((TwoBlocks, 300m, 0m, 300m, TwoBlocks - 300m), Figures(stated.Periods[0]));
        Assert.Equal((TwoBlocks, 100m, 0m, 100m, TwoBlocks - 100m), Figures(stated.Periods[1]));      // its own $100: the $300 October had is spent by the agreement, and more
        Assert.Equal((0m, 0m), (check.NotInARecordedPool, check.OutsideThePlan));
    }

    private static (decimal Cost, decimal Available, decimal Used, decimal Remaining, decimal OverBy) Figures(AgreementCheckPeriodDto p) =>
        (p.AgreementCost, p.Available, p.Used, p.Remaining, p.OverBy);

    [Fact]
    public async Task APoolWithRoomIsWithin_AndTheSumsAreTheEnginesCentsToTheCent()
    {
        using var a = await ArrangeAsync();
        a.Kit.SeedPlan(a.Person, D(2026, 10, 1), D(2026, 12, 31), Core(PlanType.PlanManaged, Month(10, 5000m), Month(11, 5000m), Month(12, 5000m)));

        var check = Body(await a.Controller().Check(a.Person.Id, Blocks(Mondays()), CancellationToken.None));

        Assert.Null(check.NoBudgetReason);   // there is a budget
        var core = Assert.Single(check.Pools);
        Assert.False(core.Over);
        Assert.Equal(0m, core.OverBy);
        Assert.Equal(4 * Block, core.AgreementCost);
        Assert.Equal(new[] { Block * 2, Block * 2 }, core.Periods.Select(p => p.AgreementCost));
        Assert.All(core.Periods, p => Assert.Equal(0m, p.OverBy));
    }

    // ── The carry: money the agreement spends in one period is not there for the next ───────────────────────────────────────────────

    [Fact]
    public async Task ALaterPeriodDoesNotInheritMoneyTheSameAgreementSpendsInAnEarlierOne()
    {
        using var a = await ArrangeAsync();
        // October has exactly what the agreement costs there ($588.64, two Mondays) and November only $100 of its own. October's money would roll into November if nothing spent it, but the
        // agreement spends all of it, so November has $100 against its $588.64 (it read as $688.64 when October's money was counted twice).
        a.Kit.SeedPlan(a.Person, D(2026, 10, 1), D(2026, 12, 31), Core(PlanType.PlanManaged, Month(10, TwoBlocks), Month(11, 100m), Month(12, 1000m)));

        var core = Assert.Single(Body(await a.Controller().Check(a.Person.Id, Blocks(Mondays()), CancellationToken.None)).Pools);

        Assert.Equal((TwoBlocks, TwoBlocks, 0m, TwoBlocks, 0m), Figures(core.Periods[0]));
        Assert.Equal((TwoBlocks, 100m, 0m, 100m, TwoBlocks - 100m), Figures(core.Periods[1]));
        Assert.True(core.Over);
    }

    [Fact]
    public async Task WhatTheAgreementLeavesUnspentInAnEarlierPeriodStillRollsForward()
    {
        using var a = await ArrangeAsync();
        a.Kit.SeedPlan(a.Person, D(2026, 10, 1), D(2026, 12, 31), Core(PlanType.PlanManaged, Month(10, 1000m), Month(11, 100m), Month(12, 1000m)));

        var core = Assert.Single(Body(await a.Controller().Check(a.Person.Id, Blocks(Mondays()), CancellationToken.None)).Pools);

        var rolled = 1000m - TwoBlocks;   // October's $1,000 less the $588.64 the agreement spends there
        Assert.Equal((TwoBlocks, 100m + rolled, 0m, 100m + rolled, TwoBlocks - (100m + rolled)), Figures(core.Periods[1]));
    }

    [Fact]
    public async Task RemainingIsAvailableMinusUsed_NotMinusWhatIsBookedAhead()
    {
        using var a = await ArrangeAsync();
        a.Kit.SeedPlan(a.Person, D(2026, 10, 1), D(2026, 12, 31), Core(PlanType.PlanManaged, Month(10, 1000m), Month(11, 1000m), Month(12, 1000m)));
        a.Kit.SeedShift(a.Person, D(2026, 10, 6));   // booked ahead: $480 of the rostered 8 hours; it is not used yet, so it is not taken off what is left

        var check = Body(await a.Controller().Check(a.Person.Id, Blocks(Mondays()), CancellationToken.None));

        var october = check.Pools.Single().Periods[0];
        Assert.Equal((1000m, 0m, 1000m), (october.Available, october.Used, october.Remaining));
    }

    [Fact]
    public async Task WhatNoRecordedPoolCoversAndWhatFallsOutsideThePlanAreShown_NeverDropped()
    {
        using var a = await ArrangeAsync();
        // Core only (no pool for the category 9 group activities), and a plan that ends on 5 Nov, so the Mondays and Wednesdays after it fall outside.
        a.Kit.SeedPlan(a.Person, D(2026, 10, 1), D(2026, 11, 5), Core(PlanType.PlanManaged, Month(10, 5000m), new PeriodSpec(D(2026, 11, 1), D(2026, 11, 5), 5000m)));

        var check = Body(await a.Controller().Check(a.Person.Id, Blocks(Mondays(), Wednesdays()), CancellationToken.None));

        Assert.Equal(8 * Block, check.AgreementCost);
        var core = Assert.Single(check.Pools);
        Assert.Equal("Core", core.PoolName);
        Assert.Equal(new[] { 2 * Block, Block }, core.Periods.Select(p => p.AgreementCost));   // Mondays 19 and 26 Oct, and 2 Nov (the plan ends on the 5th)
        Assert.Equal(3 * Block, check.NotInARecordedPool);                                      // Wednesdays 21 and 28 Oct and 4 Nov: inside the plan's dates, in no pool of it
        Assert.Equal(2 * Block, check.OutsideThePlan);                                          // Monday 9 Nov and Wednesday 11 Nov: after the plan ended
    }

    // ── Nothing to compare with ─────────────────────────────────────────────

    [Fact]
    public async Task WithNoPlanThatIsRunning_TheAnswerIsThatThereIsNoBudget_AndNothingElse()
    {
        using var a = await ArrangeAsync();

        var none = Body(await a.Controller().Check(a.Person.Id, Blocks(Mondays()), CancellationToken.None));

        Assert.False(none.HasBudget);
        Assert.Empty(none.Pools);
        Assert.Null(none.PlanId);
        Assert.Equal((BudgetListNoBudgetReason.NotRecorded, (DateOnly?)null), (none.NoBudgetReason, none.PlanEnd));   // nothing was recorded

        // A plan that has not started is not one to compare with either, and reads as nothing recorded, as the Budgets list says it.
        a.Kit.SeedPlan(a.Person, D(2027, 1, 1), D(2027, 12, 31), Core(PlanType.PlanManaged, new PeriodSpec(D(2027, 1, 1), D(2027, 12, 31), 5000m)));   // not started
        var upcoming = Body(await a.Controller().Check(a.Person.Id, Blocks(Mondays()), CancellationToken.None));
        Assert.False(upcoming.HasBudget);
        Assert.Equal((BudgetListNoBudgetReason.NotRecorded, (DateOnly?)null), (upcoming.NoBudgetReason, upcoming.PlanEnd));

        // A plan that has ended says so, and when, so the bar can say "the recorded plan ended" instead of implying that none was ever recorded.
        a.Kit.SeedPlan(a.Person, D(2025, 7, 1), D(2026, 6, 30), Core(PlanType.PlanManaged, new PeriodSpec(D(2025, 7, 1), D(2026, 6, 30), 5000m)));   // ended
        var ended = Body(await a.Controller().Check(a.Person.Id, Blocks(Mondays()), CancellationToken.None));
        Assert.False(ended.HasBudget);
        Assert.Equal((BudgetListNoBudgetReason.PlanEnded, (DateOnly?)D(2026, 6, 30)), (ended.NoBudgetReason, ended.PlanEnd));
    }

    // ── A saved draft ───────────────────────────────────────────────────────

    private static ServiceAgreementDraft SavedDraft(Arrangement a, params PlanBlock[] blocks)
    {
        var draft = new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = a.Person.TenantId, ParticipantId = a.Person.Id, Version = 1, PlanStartDate = D(2026, 10, 1), PlanEndDate = D(2026, 12, 31),
            AgreementStartDate = From, AgreementEndDate = To, State = "NSW", ParticipantNameSnapshot = "Sophie Brown",
        };
        for (var i = 0; i < blocks.Length; i++)
            draft.Blocks.Add(new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, Position = i, BlockKey = blocks[i].Id, BlockJson = Odip.Infrastructure.Services.DraftJson.Write(blocks[i]) });
        a.Kit.Db.ServiceAgreementDrafts.Add(draft);
        a.Kit.Db.SaveChanges();
        return draft;
    }

    [Fact]
    public async Task ASavedDraftIsCheckedByItsId_ToTheSameAnswerAsItsBlocksSentDirectly()
    {
        using var a = await ArrangeAsync();
        TwoPoolPlan(a);
        var draft = SavedDraft(a, Mondays(), Wednesdays());

        var byId = Body(await a.Controller().Check(a.Person.Id, new AgreementCheckRequestDto { DraftId = draft.Id }, CancellationToken.None));
        var direct = Body(await a.Controller().Check(a.Person.Id, Blocks(Mondays(), Wednesdays()), CancellationToken.None));

        Assert.Equal(direct.AgreementCost, byId.AgreementCost);
        Assert.Equal(direct.Pools.SelectMany(p => p.Periods).Select(Figures), byId.Pools.SelectMany(p => p.Periods).Select(Figures));
    }

    [Fact]
    public async Task ADraftOfAnotherParticipantOrAnotherOrganisationIsNotFound()
    {
        var database = Guid.NewGuid().ToString();
        using var mine = await ArrangeAsync(LedgerKit.TenantA, database);
        using var theirs = await ArrangeAsync(LedgerKit.TenantB, database);
        TwoPoolPlan(mine);
        var theirDraft = SavedDraft(theirs, Mondays());
        var otherPerson = mine.Kit.SeedParticipant(first: "Other", last: "Person");
        var othersDraft = new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = LedgerKit.TenantA, ParticipantId = otherPerson.Id, Version = 1, AgreementStartDate = From, AgreementEndDate = To, State = "NSW", ParticipantNameSnapshot = "Other Person",
        };
        mine.Kit.Db.ServiceAgreementDrafts.Add(othersDraft);
        mine.Kit.Db.SaveChanges();

        Assert.Equal(404, StatusOf(await mine.Controller().Check(mine.Person.Id, new AgreementCheckRequestDto { DraftId = theirDraft.Id }, CancellationToken.None)));
        Assert.Equal(404, StatusOf(await mine.Controller().Check(mine.Person.Id, new AgreementCheckRequestDto { DraftId = othersDraft.Id }, CancellationToken.None)));
        Assert.Equal(404, StatusOf(await mine.Controller().Check(mine.Person.Id, new AgreementCheckRequestDto { DraftId = Guid.NewGuid() }, CancellationToken.None)));
    }

    private static int StatusOf(ActionResult<ApiResponse<AgreementCheckDto>> result) => Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode ?? 200;

    // ── Refusals, in words ──────────────────────────────────────────────────

    [Fact]
    public async Task TheRequestMustSayWhatToPrice_ExactlyOneWay()
    {
        using var a = await ArrangeAsync();
        TwoPoolPlan(a);
        var draft = SavedDraft(a, Mondays());
        var c = a.Controller();

        Assert.Equal(400, StatusOf(await c.Check(a.Person.Id, new AgreementCheckRequestDto(), CancellationToken.None)));
        Assert.Equal(400, StatusOf(await c.Check(a.Person.Id, new AgreementCheckRequestDto { Blocks = new List<PlanBlock> { Mondays() } }, CancellationToken.None)));   // no dates
        Assert.Equal(400, StatusOf(await c.Check(a.Person.Id, new AgreementCheckRequestDto { PeriodFrom = From, PeriodTo = To }, CancellationToken.None)));                // dates, no blocks
        Assert.Equal(400, StatusOf(await c.Check(a.Person.Id, new AgreementCheckRequestDto { DraftId = draft.Id, Blocks = new List<PlanBlock> { Mondays() }, PeriodFrom = From, PeriodTo = To }, CancellationToken.None)));
    }

    [Fact]
    public async Task ADatesProblem_IsRefusedWithTheQuotesOwnWords()
    {
        using var a = await ArrangeAsync();
        TwoPoolPlan(a);
        var c = a.Controller();

        Assert.Contains("ends before it starts", string.Join(" ", Errors(await c.Check(a.Person.Id, new AgreementCheckRequestDto { Blocks = new List<PlanBlock> { Mondays() }, PeriodFrom = To, PeriodTo = From }, CancellationToken.None), 400)));
        Assert.Contains("between the years", string.Join(" ", Errors(await c.Check(a.Person.Id, new AgreementCheckRequestDto { Blocks = new List<PlanBlock> { Mondays() }, PeriodFrom = D(1999, 1, 1), PeriodTo = D(1999, 2, 1) }, CancellationToken.None), 400)));
        Assert.Contains("longer than", string.Join(" ", Errors(await c.Check(a.Person.Id, new AgreementCheckRequestDto { Blocks = new List<PlanBlock> { Mondays() }, PeriodFrom = D(2026, 1, 1), PeriodTo = D(2028, 12, 31) }, CancellationToken.None), 400)));
        var tooMany = Enumerable.Range(0, PlanPricingEngine.MaxBlocks + 1).Select(i => Mondays($"b{i}")).ToList();
        Assert.Contains("at most", string.Join(" ", Errors(await c.Check(a.Person.Id, new AgreementCheckRequestDto { Blocks = tooMany, PeriodFrom = From, PeriodTo = To }, CancellationToken.None), 400)));
    }

    // ── Whose, and who may ask ──────────────────────────────────────────────

    [Fact]
    public async Task AnotherOrganisationsParticipant_IsNotFound()
    {
        var database = Guid.NewGuid().ToString();
        using var mine = await ArrangeAsync(LedgerKit.TenantA, database);
        using var theirs = await ArrangeAsync(LedgerKit.TenantB, database);
        TwoPoolPlan(theirs);

        Assert.Equal(404, StatusOf(await mine.Controller().Check(theirs.Person.Id, Blocks(Mondays()), CancellationToken.None)));
    }

    [Fact]
    public async Task AnotherOrganisationsMoneyNeverReachesTheComparison()
    {
        var database = Guid.NewGuid().ToString();
        using var mine = await ArrangeAsync(LedgerKit.TenantA, database);
        using var theirs = await ArrangeAsync(LedgerKit.TenantB, database);
        mine.Kit.SeedPlan(mine.Person, D(2026, 10, 1), D(2026, 12, 31), Core(PlanType.PlanManaged, Month(10, 5000m), Month(11, 5000m), Month(12, 5000m)));
        theirs.Kit.SeedPlan(theirs.Person, D(2026, 10, 1), D(2026, 12, 31), Core(PlanType.PlanManaged, Month(10, 1m), Month(11, 1m), Month(12, 1m)));
        var shift = theirs.Kit.SeedShift(theirs.Person, D(2026, 10, 2), ShiftStatus.Completed);
        theirs.Kit.SeedShiftClaim(theirs.Person, TripClaimStatus.Paid, 99999m, shift);

        var check = Body(await mine.Controller().Check(mine.Person.Id, Blocks(Mondays()), CancellationToken.None));

        var october = check.Pools.Single().Periods[0];
        Assert.Equal((5000m, 0m), (october.Available, october.Used));
    }

    [Fact]
    public async Task ASuperAdminWithNoOrganisation_IsToldToChooseOne()
    {
        using var a = await ArrangeAsync();
        var none = new Mock<ICurrentTenant>();
        none.Setup(t => t.TenantId).Returns((Guid?)null);
        none.Setup(t => t.IsSuperAdmin).Returns(true);

        Assert.Equal(400, StatusOf(await a.Controller(none.Object).Check(a.Person.Id, Blocks(Mondays()), CancellationToken.None)));
    }

    [Fact]
    public void OnlyTheThreeStaffRolesMayAsk_AndTheCheckSharesTheQuotesPermitsAndRateLimit()
    {
        var roles = typeof(AgreementCheckController).GetCustomAttribute<AuthorizeAttribute>()!.Roles!.Split(',').Select(r => r.Trim()).OrderBy(r => r, StringComparer.Ordinal);
        Assert.Equal(new[] { "Admin", "Coordinator", "SuperAdmin" }, roles);

        var check = typeof(AgreementCheckController).GetMethod(nameof(AgreementCheckController.Check))!;
        Assert.Equal(typeof(PlanQuoteConcurrencyFilter), check.GetCustomAttribute<ServiceFilterAttribute>()?.ServiceType);   // the same two permits per organisation as the quote: no third quote at once
        Assert.Equal("api", check.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        Assert.NotNull(check.GetCustomAttribute<RequestSizeLimitAttribute>());
        Assert.Equal("api/v1/participants/{participantId:guid}/funding", typeof(AgreementCheckController).GetCustomAttribute<RouteAttribute>()!.Template);
        Assert.Equal("agreement-check", check.GetCustomAttribute<HttpPostAttribute>()!.Template);
    }

    [Fact]
    public async Task TheCheckWritesNothing()
    {
        using var a = await ArrangeAsync();
        TwoPoolPlan(a);
        var before = (a.Kit.Db.TripClaims.Count(), a.Kit.Db.Shifts.Count(), a.Kit.Db.ServiceAgreementDrafts.Count(), a.Kit.Db.AuditLogs.Count());

        await a.Controller().Check(a.Person.Id, Blocks(Mondays(), Wednesdays()), CancellationToken.None);

        Assert.Equal(before, (a.Kit.Db.TripClaims.Count(), a.Kit.Db.Shifts.Count(), a.Kit.Db.ServiceAgreementDrafts.Count(), a.Kit.Db.AuditLogs.Count()));
        Assert.False(a.Kit.Db.ChangeTracker.HasChanges());
    }
}
