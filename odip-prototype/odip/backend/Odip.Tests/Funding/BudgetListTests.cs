using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Moq;
using Odip.Api.Controllers;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The Budgets list (budget phase 2b): <c>GET api/v1/funding/budgets</c>, one row for each participant and pool of the current plan, for the funding period running now, sorted by risk (Over, Forecast over,
/// Approaching, On track), and the NDIS-funded participants with no budget in force kept apart at the end. It is the ledger's own figures (one call for the whole organisation), money, and so for
/// SuperAdmin, Admin and Coordinator only. Fixed clock: 4 Oct 2026, the Oct to Dec quarter; a weekday community access hour is $60 in NSW.
/// </summary>
public class BudgetListTests
{
    private static BudgetsController ControllerFor(LedgerKit kit, Guid? tenantId = null)
    {
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns(tenantId ?? kit.TenantId);
        tenant.Setup(t => t.IsSuperAdmin).Returns(false);
        return new BudgetsController(tenant.Object, new BudgetListService(kit.Db, kit.Ledger, kit.Clock));
    }

    private static LedgerKit Arrange()
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        return kit;
    }

    private static FundingPlan OctoberPlan(LedgerKit kit, Participant participant, decimal quarter = 8000m, params PoolSpec[] more) =>
        kit.SeedPlan(participant, D(2026, 10, 1), D(2027, 6, 30), new[] { Core(PlanType.PlanManaged, Q(2, quarter), Q(3, quarter), Q(4, quarter)) }.Concat(more).ToArray());

    private static void Claim(LedgerKit kit, Participant participant, decimal amount, TripClaimStatus status = TripClaimStatus.Paid, string? itemCode = null)
    {
        var shift = kit.SeedShift(participant, D(2026, 10, 2), ShiftStatus.Completed);
        kit.SeedShiftClaim(participant, status, amount, shift, itemCode);
    }

    private static BudgetListDto Body(ActionResult<ApiResponse<BudgetListDto>> result)
    {
        var ok = Assert.IsType<OkObjectResult>(result.Result);
        var response = Assert.IsType<ApiResponse<BudgetListDto>>(ok.Value);
        Assert.True(response.Success);
        return response.Data!;
    }

    private static Task<ActionResult<ApiResponse<BudgetListDto>>> ListAsync(LedgerKit kit) => ControllerFor(kit).List(CancellationToken.None);

    // ── The rows ────────────────────────────────────────────────────────────

    [Fact]
    public async Task ARow_IsTheLedgersFiguresForThePeriodRunningNow_AndNothingElse()
    {
        using var kit = Arrange();
        var person = kit.SeedParticipant(first: "Sophie", last: "Brown");
        OctoberPlan(kit, person, 8000m);
        Claim(kit, person, 900m, TripClaimStatus.Submitted);                         // claimed
        Claim(kit, person, 300m, TripClaimStatus.Draft);                             // pending
        kit.SeedShift(person, D(2026, 10, 5));                                        // booked ahead: 8 h x $60

        var list = Body(await ListAsync(kit));

        var row = Assert.Single(list.Rows);
        Assert.Equal((person.Id, "Sophie Brown", "Core"), (row.ParticipantId, row.ParticipantName, row.PoolName));
        Assert.Equal((D(2026, 10, 1), D(2026, 12, 31)), (row.PeriodStart, row.PeriodEnd));
        Assert.Equal((8000m, 1200m, 480m, 1680m), (row.Available, row.Used, row.BookedAhead, row.Forecast));
        Assert.Equal(BudgetStatus.OnTrack, row.Status);
        Assert.Equal((D(2026, 10, 4), 80), (list.AsOf, list.ApproachingPercent));
    }

    // A shift the shift claim cannot price (a 1:3 group shift, a sleepover, a passive night) is $0 in every figure, so a forecast leaves it out. The row says how many, so the list does not
    // read as the whole picture (the Funding tab says the same in words: the ledger's UnpricedShiftCount).
    [Fact]
    public async Task ARowSaysHowManyShiftsOfItsPeriodAreNotPricedYet_AndNothingForAnotherPeriodOrAnotherPool()
    {
        using var kit = Arrange();
        kit.SeedItem("15_001", 15);
        var person = kit.SeedParticipant();
        OctoberPlan(kit, person, 8000m, Stated(15, PlanType.AgencyManaged, Q(2, 1000m), Q(3, 1000m), Q(4, 1000m)));
        foreach (var date in new[] { D(2026, 10, 6), D(2026, 10, 7) })
        {
            var group = kit.SeedShift(person, date);
            group.Ratio = SupportRatio.OneToThree;                                   // a group shift: not priced yet
        }
        var elsewhere = kit.SeedShift(person, D(2027, 1, 12));                       // another period, also a group shift
        elsewhere.Ratio = SupportRatio.OneToThree;
        kit.Db.SaveChanges();

        var rows = Body(await ListAsync(kit)).Rows.ToDictionary(r => r.PoolName);

        Assert.Equal(2, rows["Core"].UnpricedShiftCount);
        Assert.Equal(0, rows["Improved Daily Living Skills"].UnpricedShiftCount);
    }

    [Fact]
    public async Task ARowWithEveryShiftPriced_HasNoUnpricedShifts()
    {
        using var kit = Arrange();
        var person = kit.SeedParticipant();
        OctoberPlan(kit, person, 8000m);
        kit.SeedShift(person, D(2026, 10, 5));

        Assert.Equal(0, Assert.Single(Body(await ListAsync(kit)).Rows).UnpricedShiftCount);
    }

    [Fact]
    public async Task EachPoolOfAPlan_IsARowOfItsOwn_InPoolOrder()
    {
        using var kit = Arrange();
        kit.SeedItem("15_001", 15);
        var person = kit.SeedParticipant();
        OctoberPlan(kit, person, 8000m, Stated(15, PlanType.AgencyManaged, Q(2, 1000m), Q(3, 1000m), Q(4, 1000m)));
        Claim(kit, person, 900m, itemCode: "15_001");

        var rows = Body(await ListAsync(kit)).Rows;

        Assert.Equal(new[] { BudgetStatus.Approaching, BudgetStatus.OnTrack }, rows.Select(r => r.Status));   // sorted by risk: the stated pool is approaching
        Assert.Equal(new[] { "Improved Daily Living Skills", "Core" }, rows.Select(r => r.PoolName));
        Assert.Equal(new[] { FundingPoolKind.Stated, FundingPoolKind.CoreFlexible }, rows.Select(r => r.Kind));
    }

    [Fact]
    public async Task TwoCorePoolsOfOnePlan_AreToldApartByHowTheirMoneyIsManaged()
    {
        using var kit = Arrange();
        var person = kit.SeedParticipant();
        OctoberPlan(kit, person, 8000m, Core(PlanType.AgencyManaged, Q(2, 2000m), Q(3, 2000m), Q(4, 2000m)));

        var rows = Body(await ListAsync(kit)).Rows;

        Assert.Equal(new[] { "Core (plan managed)", "Core (agency managed)" }, rows.Select(r => r.PoolName));
    }

    [Fact]
    public async Task TheRows_AreSortedByRisk_ThenByName_NotByWhoWasAddedFirst()
    {
        using var kit = Arrange();
        var onTrack = kit.SeedParticipant(first: "Alma", last: "Fine");
        var over2 = kit.SeedParticipant(first: "Zed", last: "Over");
        var forecast = kit.SeedParticipant(first: "Ford", last: "Cast");
        var approaching = kit.SeedParticipant(first: "Appa", last: "Roach");
        var over1 = kit.SeedParticipant(first: "Olive", last: "Over");
        foreach (var p in new[] { onTrack, over2, forecast, approaching, over1 }) OctoberPlan(kit, p, 1000m);
        Claim(kit, onTrack, 100m);
        Claim(kit, over2, 1500m);
        Claim(kit, over1, 1100m);
        Claim(kit, approaching, 850m);
        kit.SeedShift(forecast, D(2026, 10, 5)); kit.SeedShift(forecast, D(2026, 10, 6)); kit.SeedShift(forecast, D(2026, 10, 7));   // three shifts of $480 against $1,000

        var rows = Body(await ListAsync(kit)).Rows;

        Assert.Equal(new[] { BudgetStatus.Over, BudgetStatus.Over, BudgetStatus.ForecastOver, BudgetStatus.Approaching, BudgetStatus.OnTrack }, rows.Select(r => r.Status));
        Assert.Equal(new[] { "Olive Over", "Zed Over", "Ford Cast", "Appa Roach", "Alma Fine" }, rows.Select(r => r.ParticipantName));
    }

    [Fact]
    public async Task TheAlertsAndTheListAgree_BecauseBothAreTheLedgersWord()
    {
        using var kit = Arrange();
        var person = kit.SeedParticipant();
        OctoberPlan(kit, person, 1000m);
        Claim(kit, person, 1500m);
        var source = new BudgetAlertSource(kit.Ledger, new NdiaRejectionReader(kit.Db, kit.Clock), kit.Tenant!);

        var alerts = await source.ForAsync(new[] { person.Id }, CancellationToken.None);
        var row = Assert.Single(Body(await ListAsync(kit)).Rows);

        Assert.Equal(BudgetStatus.Over, row.Status);
        Assert.Equal("budget-over", Assert.Single(alerts[person.Id]).Type);
    }

    // ── The participants with no budget in force ────────────────────────────

    [Fact]
    public async Task AnNdisParticipantWithNoPlanIsInTheTail_AndSoIsOneWhosePlanHasEnded()
    {
        using var kit = Arrange();
        var none = kit.SeedParticipant(first: "Nora", last: "None");
        var ended = kit.SeedParticipant(first: "Edna", last: "Ended");
        var upcoming = kit.SeedParticipant(first: "Una", last: "Upcoming");
        var running = kit.SeedParticipant(first: "Rae", last: "Running");
        kit.SeedPlan(ended, D(2025, 7, 1), D(2026, 6, 30), Core(PlanType.PlanManaged, new PeriodSpec(D(2025, 7, 1), D(2026, 6, 30), 5000m)));
        kit.SeedPlan(upcoming, D(2027, 1, 1), D(2027, 12, 31), Core(PlanType.PlanManaged, new PeriodSpec(D(2027, 1, 1), D(2027, 12, 31), 5000m)));
        OctoberPlan(kit, running);

        var list = Body(await ListAsync(kit));

        Assert.Equal(new[] { "Rae Running" }, list.Rows.Select(r => r.ParticipantName));
        Assert.Equal(new[] { "Edna Ended", "Nora None", "Una Upcoming" }, list.NoBudget.Select(n => n.ParticipantName));
        var endedEntry = list.NoBudget.Single(n => n.ParticipantId == ended.Id);
        Assert.Equal((BudgetListNoBudgetReason.PlanEnded, (DateOnly?)D(2026, 6, 30)), (endedEntry.Reason, endedEntry.PlanEnd));
        Assert.All(list.NoBudget.Where(n => n.ParticipantId != ended.Id), n => { Assert.Equal(BudgetListNoBudgetReason.NotRecorded, n.Reason); Assert.Null(n.PlanEnd); });
    }

    [Fact]
    public async Task AnOrganisationWithNoParticipants_StillSaysWhatDayItIs_AndNeverAnAllClear()
    {
        using var kit = Arrange();

        var list = Body(await ListAsync(kit));

        Assert.Equal((D(2026, 10, 4), 80), (list.AsOf, list.ApproachingPercent));
        Assert.Empty(list.Rows);
        Assert.Empty(list.NoBudget);
    }

    [Fact]
    public async Task AParticipantWhoseFundingIsNotTheNdis_HasNoBudgetToRecord_SoIsNeverInTheTail()
    {
        using var kit = Arrange();
        var privately = kit.SeedParticipant(first: "Priv", last: "Ate");
        privately.FundingSource = ParticipantFundingSource.Other;
        kit.Db.SaveChanges();

        var list = Body(await ListAsync(kit));

        Assert.Empty(list.Rows);
        Assert.Empty(list.NoBudget);
    }

    [Fact]
    public async Task ArchivedAndDraftParticipantsAreNotListed_AsTheAlertsAggregateDoesNotListThem()
    {
        using var kit = Arrange();
        var archived = kit.SeedParticipant(first: "Archie", last: "Gone");
        archived.IsActive = false;
        var draft = kit.SeedParticipant(first: "Dara", last: "Draft");
        draft.IsDraft = true;
        kit.Db.SaveChanges();
        OctoberPlan(kit, archived);
        OctoberPlan(kit, draft);

        var list = Body(await ListAsync(kit));

        Assert.Empty(list.Rows);
        Assert.Empty(list.NoBudget);
    }

    // ── Whose money, and who may see it ─────────────────────────────────────

    [Fact]
    public async Task AnotherOrganisationsParticipants_NeverAppear()
    {
        var database = Guid.NewGuid().ToString();
        using var mine = LedgerKit.Create(LedgerKit.TenantA, database);
        using var theirs = LedgerKit.Create(LedgerKit.TenantB, database);
        foreach (var kit in new[] { mine, theirs }) { kit.SeedProvider("NSW"); kit.EnsureCommunityAccessCatalogue(); }
        var own = mine.SeedParticipant(first: "Mina", last: "Mine");
        OctoberPlan(mine, own);
        var other = theirs.SeedParticipant(tenantId: LedgerKit.TenantB, first: "Theo", last: "Theirs");
        OctoberPlan(theirs, other);
        theirs.SeedParticipant(tenantId: LedgerKit.TenantB, first: "Noel", last: "Budget");

        var list = Body(await ListAsync(mine));

        Assert.Equal(new[] { "Mina Mine" }, list.Rows.Select(r => r.ParticipantName));
        Assert.Empty(list.NoBudget);
    }

    [Fact]
    public async Task ASuperAdminWhoHasNotChosenAnOrganisation_IsToldToChooseOne()
    {
        using var kit = Arrange();
        var tenant = new Mock<ICurrentTenant>();
        tenant.Setup(t => t.TenantId).Returns((Guid?)null);
        tenant.Setup(t => t.IsSuperAdmin).Returns(true);

        var result = await new BudgetsController(tenant.Object, new BudgetListService(kit.Db, kit.Ledger, kit.Clock)).List(CancellationToken.None);

        Assert.Equal(400, Assert.IsAssignableFrom<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public void OnlyTheThreeStaffRolesMayAsk_ReadsIncluded_AndTheRouteIsRateLimited()
    {
        var roles = typeof(BudgetsController).GetCustomAttribute<AuthorizeAttribute>()!.Roles!.Split(',').Select(r => r.Trim()).OrderBy(r => r, StringComparer.Ordinal);
        Assert.Equal(new[] { "Admin", "Coordinator", "SuperAdmin" }, roles);

        var list = typeof(BudgetsController).GetMethod(nameof(BudgetsController.List))!;
        Assert.Null(list.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Equal("api", list.GetCustomAttribute<EnableRateLimitingAttribute>()!.PolicyName);
        Assert.Equal("api/v1/funding/budgets", typeof(BudgetsController).GetCustomAttribute<RouteAttribute>()!.Template);
    }

    // ── Cost ────────────────────────────────────────────────────────────────

    private static async Task<int> QueriesForAsync(int participants)
    {
        using var kit = LedgerKit.Create(countQueries: true);
        kit.SeedProvider("NSW");
        kit.EnsureCommunityAccessCatalogue();
        var trip = kit.SeedTrip(D(2026, 10, 20), 2);
        for (var i = 0; i < participants; i++)
        {
            var participant = kit.SeedParticipant(first: "Person", last: $"No{i:00}");
            OctoberPlan(kit, participant, 1000m);
            Claim(kit, participant, 900m);
            kit.SeedShift(participant, D(2026, 10, 5));
            kit.SeedBooking(trip, participant);
        }

        var counter = LedgerQueryCounter.Start();
        var list = Body(await ListAsync(kit));
        Assert.Equal(participants, list.Rows.Count);
        return counter[0];
    }

    [Fact]
    public async Task TheList_AsksTheSameQuestions_ForThreeParticipantsAsForThirty()
    {
        Assert.Equal(await QueriesForAsync(3), await QueriesForAsync(30));
    }
}
