using Moq;
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
/// The budget alerts through <see cref="ParticipantAlertsService"/> over a real (InMemory) ledger (budget phase 2b): claims, shifts and rejected claims in, alerts out. The clock is the funding
/// tests' fixed 4 Oct 2026 (a Sunday, in the Oct to Dec quarter), the provider is in NSW, and a weekday community access hour costs $60 there. The other tests of this service (<c>ParticipantAlertsServiceTests</c>)
/// build the service without a budget source, so they keep seeing no budget alert at all.
/// </summary>
public class ParticipantBudgetAlertsTests
{
    private sealed class Setup : IDisposable
    {
        public LedgerKit Kit { get; }
        public ParticipantAlertsService Service { get; }

        public Setup(LedgerKit kit, ICurrentTenant? tenant = null)
        {
            Kit = kit;
            kit.SeedProvider("NSW");
            kit.EnsureCommunityAccessCatalogue();
            Service = new ParticipantAlertsService(kit.Db, kit.Clock, new BudgetAlertSource(kit.Ledger, new NdiaRejectionReader(kit.Db, kit.Clock), tenant ?? kit.Tenant!));
        }

        public static Setup Create(Guid? tenantId = null, string? database = null, DateTimeOffset? now = null, bool countQueries = false) =>
            new(LedgerKit.Create(tenantId, database, now, countQueries));

        public void Dispose() => Kit.Dispose();

        public async Task<List<ParticipantAlertDto>> AlertsAsync(Guid participantId) => (await Service.GetAlertsAsync(participantId)).Single().Alerts;

        public async Task<List<ParticipantAlertDto>> BudgetAlertsAsync(Guid participantId) =>
            (await AlertsAsync(participantId)).Where(a => a.Type.StartsWith("budget-", StringComparison.Ordinal)).ToList();
    }

    /// <summary>A plan that begins in the current quarter (1 Oct 2026 to 30 Jun 2027) with a Core pool of <paramref name="quarter"/> dollars a quarter, so exactly that much is available now.</summary>
    private static FundingPlan OctoberPlan(LedgerKit kit, Participant participant, decimal quarter = 8000m, params PoolSpec[] more)
    {
        var plan = kit.SeedPlan(participant, D(2026, 10, 1), D(2027, 6, 30), new[] { Core(PlanType.PlanManaged, Q(2, quarter), Q(3, quarter), Q(4, quarter)) }.Concat(more).ToArray());
        // Recorded in September, before any rejection of these tests: a plan recorded AFTER a rejection ends its alert, and the tests that mean that say so.
        plan.CreatedAt = new DateTime(2026, 9, 20, 0, 0, 0, DateTimeKind.Utc);
        kit.Db.SaveChanges();
        return plan;
    }

    private static TripClaim ClaimOf(LedgerKit kit, Participant participant, TripClaimStatus status, decimal amount, DateOnly date, string? itemCode = null)
    {
        var shift = kit.SeedShift(participant, date, ShiftStatus.Completed);
        return kit.SeedShiftClaim(participant, status, amount, shift, itemCode);
    }

    private static TripClaim RejectedClaim(LedgerKit kit, Participant participant, string? code, DateOnly date, DateTime? rejectedAt = null, string? itemCode = null)
    {
        var claim = ClaimOf(kit, participant, TripClaimStatus.Rejected, 400m, date, itemCode);
        claim.RejectionCode = code;
        claim.RejectedDate = rejectedAt ?? FundingTestKit.Now.UtcDateTime;
        kit.Db.SaveChanges();
        return claim;
    }

    // ── The status alerts ───────────────────────────────────────────────────

    [Fact]
    public async Task Over_ByClaimedMoney_RaisesTheCriticalAlert_AndOnlyForTheParticipantWhoIsOver()
    {
        using var s = Setup.Create();
        var over = s.Kit.SeedParticipant(first: "Olive", last: "Over");
        var fine = s.Kit.SeedParticipant(first: "Finn", last: "Fine");
        OctoberPlan(s.Kit, over, 8000m);
        OctoberPlan(s.Kit, fine, 8000m);
        ClaimOf(s.Kit, over, TripClaimStatus.Paid, 9000m, D(2026, 10, 2));
        ClaimOf(s.Kit, fine, TripClaimStatus.Paid, 500m, D(2026, 10, 2));

        var all = await s.Service.GetAlertsAsync(participantId: null, activeOnly: true);

        var alert = Assert.Single(all.Single(p => p.ParticipantId == over.Id).Alerts);
        Assert.Equal(("budget-over", AlertSeverity.Critical, "funding"), (alert.Type, alert.Severity, alert.DeepLinkTab));
        Assert.Equal("Core is $1,000 over this period's $8,000 (to 31 Dec 2026)", alert.Message);
        Assert.Empty(all.Single(p => p.ParticipantId == fine.Id).Alerts);
        Assert.Equal(1, all.Single(p => p.ParticipantId == over.Id).CriticalCount);
    }

    [Fact]
    public async Task ForecastOver_ByRosteredShifts_RaisesTheWarning_NamingWhatTheBookedShiftsWouldAdd()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 1000m);
        foreach (var day in new[] { 5, 6, 7 }) s.Kit.SeedShift(participant, D(2026, 10, day));   // three weekday shifts of 8 hours: $60 an hour in NSW is $480 each, $1,440 booked

        var alert = Assert.Single(await s.BudgetAlertsAsync(participant.Id));

        Assert.Equal(("budget-forecast-over", AlertSeverity.Warning), (alert.Type, alert.Severity));
        Assert.Equal("Booked shifts would take Core $440 over this period's $1,000 by 31 Dec 2026", alert.Message);
    }

    // The fix round's ledger counts the shifts the shift claim cannot price (a group shift, a sleepover) in the period, and every figure leaves them out; the alert says so, from a real ledger.
    [Fact]
    public async Task AStatusAlert_SaysTheFiguresLeaveOutTheShiftsThatAreNotPricedYet_FromARealLedger()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 1000m);
        foreach (var day in new[] { 5, 6, 7 }) s.Kit.SeedShift(participant, D(2026, 10, day));    // $1,440 booked: forecast over by $440
        var group = s.Kit.SeedShift(participant, D(2026, 10, 8));
        group.Ratio = SupportRatio.OneToThree;                                                     // a group shift: $0 in every figure
        s.Kit.Db.SaveChanges();

        var alert = Assert.Single(await s.BudgetAlertsAsync(participant.Id));

        Assert.Equal("budget-forecast-over", alert.Type);
        Assert.Equal("Booked shifts would take Core $440 over this period's $1,000 by 31 Dec 2026. 1 shift in this period is not priced yet, so this leaves it out", alert.Message);
    }

    [Fact]
    public async Task Approaching_ByClaimedMoney_RaisesTheWarning()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 1000m);
        ClaimOf(s.Kit, participant, TripClaimStatus.Submitted, 850m, D(2026, 10, 2));

        var alert = Assert.Single(await s.BudgetAlertsAsync(participant.Id));

        Assert.Equal(("budget-approaching", AlertSeverity.Warning, "Core is at 85% of this period's $1,000 (to 31 Dec 2026)"), (alert.Type, alert.Severity, alert.Message));
    }

    [Fact]
    public async Task ThePercentageComesFromTheOrganisationsSetting()
    {
        using var s = Setup.Create();
        s.Kit.Db.BudgetSettings.Add(new BudgetSettings { Id = Guid.NewGuid(), TenantId = LedgerKit.TenantA, ApproachingPercent = 90 });
        s.Kit.Db.SaveChanges();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 1000m);
        ClaimOf(s.Kit, participant, TripClaimStatus.Submitted, 850m, D(2026, 10, 2));

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task EachPool_IsWatchedOnItsOwn_AndOnlyTheWorstStatusOfEachIsRaised()
    {
        using var s = Setup.Create();
        s.Kit.SeedItem("15_001", 15);
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m, Stated(15, PlanType.PlanManaged, Q(2, 1000m), Q(3, 1000m), Q(4, 1000m)));
        ClaimOf(s.Kit, participant, TripClaimStatus.Paid, 9000m, D(2026, 10, 2));                               // Core: over
        ClaimOf(s.Kit, participant, TripClaimStatus.Paid, 900m, D(2026, 10, 3), itemCode: "15_001");            // the stated pool: approaching
        s.Kit.SeedShift(participant, D(2026, 10, 5));                                                            // and booked ahead against Core too, which changes nothing: over already

        var alerts = await s.BudgetAlertsAsync(participant.Id);

        Assert.Equal(new[] { "budget-over", "budget-approaching" }, alerts.Select(a => a.Type));
        Assert.Equal("Improved Daily Living Skills is at 90% of this period's $1,000 (to 31 Dec 2026)", alerts[1].Message);
    }

    // ── Nothing to say ──────────────────────────────────────────────────────

    [Fact]
    public async Task WithNoPlanRecorded_ThereIsNoBudgetAlert_HoweverMuchIsClaimed()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        ClaimOf(s.Kit, participant, TripClaimStatus.Paid, 99999m, D(2026, 10, 2));
        s.Kit.SeedShift(participant, D(2026, 10, 5));

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task APlanThatHasNotStartedYet_HasNoBudgetAlert()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        s.Kit.SeedPlan(participant, D(2027, 1, 1), D(2027, 12, 31), Core(PlanType.PlanManaged, new PeriodSpec(D(2027, 1, 1), D(2027, 12, 31), 100m)));
        ClaimOf(s.Kit, participant, TripClaimStatus.Paid, 5000m, D(2026, 10, 2));

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task APlanThatHasEnded_HasNoBudgetAlert_BecauseNoPeriodIsRunning()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        s.Kit.SeedPlan(participant, D(2025, 7, 1), D(2026, 6, 30), Core(PlanType.PlanManaged, new PeriodSpec(D(2025, 7, 1), D(2026, 6, 30), 100m)));
        ClaimOf(s.Kit, participant, TripClaimStatus.Paid, 5000m, D(2026, 5, 2));

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task TheAggregate_LeavesOutArchivedAndDraftParticipants_AsItAlwaysHas()
    {
        using var s = Setup.Create();
        var archived = s.Kit.SeedParticipant(first: "Archie", last: "Gone");
        archived.IsActive = false;
        var draft = s.Kit.SeedParticipant(first: "Dara", last: "Draft");
        draft.IsDraft = true;
        s.Kit.Db.SaveChanges();
        foreach (var participant in new[] { archived, draft })
        {
            OctoberPlan(s.Kit, participant, 100m);
            ClaimOf(s.Kit, participant, TripClaimStatus.Paid, 5000m, D(2026, 10, 2));
        }

        var all = await s.Service.GetAlertsAsync(participantId: null, activeOnly: true);

        Assert.Empty(all);
    }

    [Fact]
    public async Task ASingleParticipantsAlerts_IncludeTheirBudgetAlerts_EvenIfArchived()
    {
        using var s = Setup.Create();
        var archived = s.Kit.SeedParticipant();
        archived.IsActive = false;
        s.Kit.Db.SaveChanges();
        OctoberPlan(s.Kit, archived, 100m);
        ClaimOf(s.Kit, archived, TripClaimStatus.Paid, 5000m, D(2026, 10, 2));

        Assert.Equal("budget-over", Assert.Single(await s.BudgetAlertsAsync(archived.Id)).Type);
    }

    // ── Whether a budget is in force at all ─────────────────────────────────

    // The dashboard must not say "all clear" about budgets nobody has recorded: no alert cannot tell "nothing is at risk" from "no budget is recorded", so the aggregate says who has a plan running.
    [Fact]
    public async Task TheAggregateSaysWhoseBudgetIsInForce_APlanRunningNowAndNobodyElse_WhetherOrNotAnythingIsAtRisk()
    {
        using var s = Setup.Create();
        var running = s.Kit.SeedParticipant(first: "Ron", last: "Running");
        s.Kit.SeedParticipant(first: "Nora", last: "None");
        var ended = s.Kit.SeedParticipant(first: "Edna", last: "Ended");
        var upcoming = s.Kit.SeedParticipant(first: "Una", last: "Upcoming");
        OctoberPlan(s.Kit, running, 8000m);   // on track: no alert, and still a budget in force
        s.Kit.SeedPlan(ended, D(2025, 7, 1), D(2026, 6, 30), Core(PlanType.PlanManaged, new PeriodSpec(D(2025, 7, 1), D(2026, 6, 30), 5000m)));
        s.Kit.SeedPlan(upcoming, D(2027, 1, 1), D(2027, 12, 31), Core(PlanType.PlanManaged, new PeriodSpec(D(2027, 1, 1), D(2027, 12, 31), 5000m)));

        var all = await s.Service.GetAlertsAsync(participantId: null, activeOnly: true);

        Assert.Equal(
            new[] { ("Edna Ended", false), ("Nora None", false), ("Ron Running", true), ("Una Upcoming", false) },
            all.OrderBy(p => p.ParticipantName, StringComparer.Ordinal).Select(p => (p.ParticipantName, p.BudgetInForce)));
        Assert.All(all, p => Assert.Empty(p.Alerts));
    }

    [Fact]
    public async Task TheSingleRouteSaysItToo_AndAServiceBuiltWithoutABudgetSourceSaysNobodyHasOne()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m);

        Assert.True((await s.Service.GetAlertsAsync(participant.Id)).Single().BudgetInForce);
        Assert.False((await new ParticipantAlertsService(s.Kit.Db, s.Kit.Clock).GetAlertsAsync(participant.Id)).Single().BudgetInForce);   // built the way the older tests build it
    }

    // ── The order they come in ──────────────────────────────────────────────

    // The banner shows three alerts and "+N more" behind them, so the worse warning must come first: the alerts used to sort by type name, which put "approaching" ahead of "forecast over".
    [Fact]
    public async Task TheBudgetAlertsOfOneParticipantComeWorseFirst_ForecastOverBeforeApproaching_NotInTheOrderOfTheirNames()
    {
        using var s = Setup.Create();
        s.Kit.SeedItem("15_001", 15);
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 1000m, Stated(15, PlanType.AgencyManaged, Q(2, 1000m), Q(3, 1000m), Q(4, 1000m)));
        foreach (var day in new[] { 5, 6, 7 }) s.Kit.SeedShift(participant, D(2026, 10, day));   // three shifts of $480 against Core's $1,000: forecast over
        ClaimOf(s.Kit, participant, TripClaimStatus.Paid, 850m, D(2026, 10, 2), "15_001");        // 85% of the stated pool's $1,000: approaching

        var alerts = await s.BudgetAlertsAsync(participant.Id);

        Assert.Equal(new[] { "budget-forecast-over", "budget-approaching" }, alerts.Select(a => a.Type));
    }

    // ── Whose money ─────────────────────────────────────────────────────────

    [Fact]
    public async Task AnotherOrganisationsParticipantsAndClaims_NeverReachTheAlerts()
    {
        var database = Guid.NewGuid().ToString();
        using var mine = Setup.Create(LedgerKit.TenantA, database);
        using var theirs = Setup.Create(LedgerKit.TenantB, database);
        var mineOk = mine.Kit.SeedParticipant(first: "Mina", last: "Mine");
        OctoberPlan(mine.Kit, mineOk, 8000m);
        ClaimOf(mine.Kit, mineOk, TripClaimStatus.Paid, 100m, D(2026, 10, 2));
        var other = theirs.Kit.SeedParticipant(tenantId: LedgerKit.TenantB, first: "Theo", last: "Theirs");
        theirs.Kit.SeedPlan(other, D(2026, 10, 1), D(2027, 6, 30), Core(PlanType.PlanManaged, Q(2, 100m), Q(3, 100m), Q(4, 100m)));
        ClaimOf(theirs.Kit, other, TripClaimStatus.Paid, 5000m, D(2026, 10, 2));
        RejectedClaim(theirs.Kit, other, "V27", D(2026, 10, 2));

        var all = await mine.Service.GetAlertsAsync(participantId: null, activeOnly: true);

        var only = Assert.Single(all);
        Assert.Equal(mineOk.Id, only.ParticipantId);
        Assert.Empty(only.Alerts);
    }

    [Fact]
    public async Task ASuperAdminWhoHasNotChosenAnOrganisation_GetsNoBudgetAlerts_AndNoError()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 100m);
        ClaimOf(s.Kit, participant, TripClaimStatus.Paid, 5000m, D(2026, 10, 2));
        var none = new Mock<ICurrentTenant>();
        none.Setup(t => t.TenantId).Returns((Guid?)null);
        none.Setup(t => t.IsSuperAdmin).Returns(true);
        var service = new ParticipantAlertsService(s.Kit.Db, s.Kit.Clock, new BudgetAlertSource(s.Kit.Ledger, new NdiaRejectionReader(s.Kit.Db, s.Kit.Clock), none.Object));

        var result = (await service.GetAlertsAsync(participant.Id)).Single();

        Assert.DoesNotContain(result.Alerts, a => a.Type.StartsWith("budget-", StringComparison.Ordinal));
    }

    // ── The NDIA's own signal ───────────────────────────────────────────────

    [Fact]
    public async Task ANdiaRejectionForWantOfFunds_RaisesTheCriticalAlert_ForThePoolOfTheClaimsLines()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m);
        RejectedClaim(s.Kit, participant, "V27", D(2026, 10, 2));

        var alert = Assert.Single(await s.BudgetAlertsAsync(participant.Id));

        Assert.Equal(("budget-ndia-exhausted", AlertSeverity.Critical, "funding"), (alert.Type, alert.Severity, alert.DeepLinkTab));
        Assert.Equal("NDIA rejected a claim for Core on 4 Oct 2026: not enough funds in the funding period (V27)", alert.Message);
    }

    [Theory]
    [InlineData("V17")]
    [InlineData("V18")]
    [InlineData("V27")]
    [InlineData("V28")]
    public async Task EachOfTheFourFundsCodes_RaisesIt(string code)
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m);
        RejectedClaim(s.Kit, participant, code, D(2026, 10, 2));

        var alert = Assert.Single(await s.BudgetAlertsAsync(participant.Id));

        Assert.Equal("budget-ndia-exhausted", alert.Type);
        Assert.EndsWith($"({code})", alert.Message);
    }

    [Theory]
    [InlineData("V16")]
    [InlineData("C16 dates")]
    [InlineData(null)]
    public async Task ARejectionThatIsNotAboutFunds_RaisesNothing(string? code)
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m);
        RejectedClaim(s.Kit, participant, code, D(2026, 10, 2));

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task TheDayIsTheProvidersCalendarDay_NotTheUtcDate()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m);
        // 20:00 UTC on 3 Oct is 06:00 or 07:00 on 4 Oct in Sydney, whichever side of the clocks changing that night the host puts it on.
        RejectedClaim(s.Kit, participant, "V28", D(2026, 10, 2), rejectedAt: new DateTime(2026, 10, 3, 20, 0, 0, DateTimeKind.Utc));

        Assert.Equal("NDIA rejected a claim for Core on 4 Oct 2026: not enough funds in the funding period (V28)", Assert.Single(await s.BudgetAlertsAsync(participant.Id)).Message);
    }

    [Fact]
    public async Task OnlyAClaimThatIsStillRejected_Counts()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m);
        var claim = RejectedClaim(s.Kit, participant, "V27", D(2026, 10, 2));
        claim.Status = TripClaimStatus.Submitted;   // resubmitted: the code is left on the row by a careless write, but the claim is no longer rejected
        s.Kit.Db.SaveChanges();

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task ItStopsWhenALaterFundingPeriodStarts()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m);
        RejectedClaim(s.Kit, participant, "V27", D(2026, 12, 20));   // the rejected claim is for work in the Oct to Dec quarter

        s.Kit.Clock.Set(new DateTimeOffset(2026, 12, 31, 3, 0, 0, TimeSpan.Zero));   // 31 Dec, 14:00 in Sydney: the quarter's last day
        Assert.Single(await s.BudgetAlertsAsync(participant.Id));

        s.Kit.Clock.Set(new DateTimeOffset(2027, 1, 1, 3, 0, 0, TimeSpan.Zero));     // the next quarter has started
        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task ARejectionForAnEarlierPeriodThanTheOneRunningIsHistory()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        s.Kit.SeedPlan(participant, D(2026, 7, 1), D(2027, 6, 30), Core(PlanType.PlanManaged, Q(1, 8000m), Q(2, 8000m), Q(3, 8000m), Q(4, 8000m)));
        RejectedClaim(s.Kit, participant, "V27", D(2026, 8, 14));   // a July to September claim, refused now

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task ItStopsWhenANewPlanIsRecorded_ThatStartsAfterTheClaimsWork()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        // The old plan ran to 3 Oct, the NDIA's new plan starts on 4 Oct: the claim is for 2 Oct, the old plan's.
        s.Kit.SeedPlan(participant, D(2026, 7, 1), D(2026, 10, 3), Core(PlanType.PlanManaged, new PeriodSpec(D(2026, 7, 1), D(2026, 10, 3), 8000m)));
        RejectedClaim(s.Kit, participant, "V27", D(2026, 10, 2));
        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));   // the new plan is not recorded yet: the old one has ended, so no period is running

        s.Kit.SeedPlan(participant, D(2026, 10, 4), D(2027, 10, 3), Core(PlanType.PlanManaged, new PeriodSpec(D(2026, 10, 4), D(2027, 10, 3), 8000m)));

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task ItStopsWhenAPlanIsRecordedAfterTheRejection_EvenOneWithTheSameDates()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        var plan = OctoberPlan(s.Kit, participant, 8000m);
        RejectedClaim(s.Kit, participant, "V27", D(2026, 10, 2), rejectedAt: FundingTestKit.Now.UtcDateTime.AddDays(-1));
        plan.CreatedAt = FundingTestKit.Now.UtcDateTime.AddDays(-5);
        s.Kit.Db.SaveChanges();
        Assert.Single(await s.BudgetAlertsAsync(participant.Id));   // the plan the claim was refused against is still the plan

        plan.CreatedAt = FundingTestKit.Now.UtcDateTime;   // the plan was recorded again (a variation) after the rejection
        s.Kit.Db.SaveChanges();

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task ALineThatFitsNoRecordedPool_RaisesNothing()
    {
        using var s = Setup.Create();
        s.Kit.SeedItem("15_001", 15);
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m);   // no category 15 pool
        RejectedClaim(s.Kit, participant, "V27", D(2026, 10, 2), itemCode: "15_001");

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task ALineDatedBeforeThePlan_RaisesNothing()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m);
        RejectedClaim(s.Kit, participant, "V27", D(2026, 9, 20));

        Assert.Empty(await s.BudgetAlertsAsync(participant.Id));
    }

    [Fact]
    public async Task TheStatedPoolOfTheClaimsLinesIsTheOneNamed_AndCoreIsLeftAlone()
    {
        using var s = Setup.Create();
        s.Kit.SeedItem("15_001", 15);
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m, Stated(15, PlanType.PlanManaged, Q(2, 1000m), Q(3, 1000m), Q(4, 1000m)));
        RejectedClaim(s.Kit, participant, "V18", D(2026, 10, 2), itemCode: "15_001");

        var alert = Assert.Single(await s.BudgetAlertsAsync(participant.Id));

        Assert.Equal("NDIA rejected a claim for Improved Daily Living Skills on 4 Oct 2026: not enough funds in the plan (V18)", alert.Message);
    }

    [Fact]
    public async Task OfSeveralRejections_TheLatestOneIsTheOneSaid()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        OctoberPlan(s.Kit, participant, 8000m);
        RejectedClaim(s.Kit, participant, "V17", D(2026, 10, 1), rejectedAt: new DateTime(2026, 10, 2, 1, 0, 0, DateTimeKind.Utc));
        RejectedClaim(s.Kit, participant, "V28", D(2026, 10, 2), rejectedAt: new DateTime(2026, 10, 3, 1, 0, 0, DateTimeKind.Utc));

        var alert = Assert.Single(await s.BudgetAlertsAsync(participant.Id));

        Assert.Equal("NDIA rejected a claim for Core on 3 Oct 2026: not enough funds in the funding period (V28)", alert.Message);
    }

    [Fact]
    public async Task ATripClaimIsReachedThroughItsBooking_ForEachParticipantItCovers()
    {
        using var s = Setup.Create();
        var one = s.Kit.SeedParticipant(first: "Una", last: "One");
        var two = s.Kit.SeedParticipant(first: "Duo", last: "Two");
        OctoberPlan(s.Kit, one, 8000m);
        OctoberPlan(s.Kit, two, 8000m);
        var trip = s.Kit.SeedTrip(D(2026, 10, 2), 1);
        var booking = s.Kit.SeedBooking(trip, one);
        var (claim, _) = s.Kit.SeedTripClaim(trip, booking, TripClaimStatus.Rejected, 300m, D(2026, 10, 2));
        claim.RejectionCode = "V28";
        claim.RejectedDate = FundingTestKit.Now.UtcDateTime;
        s.Kit.Db.SaveChanges();

        Assert.Equal("budget-ndia-exhausted", Assert.Single(await s.BudgetAlertsAsync(one.Id)).Type);
        Assert.Empty(await s.BudgetAlertsAsync(two.Id));
    }

    // ── The Funding tab's note ──────────────────────────────────────────────

    [Fact]
    public async Task TheFundingTabsNote_IsThePoolsActiveRejection_AndEndsWithTheAlert()
    {
        using var s = Setup.Create();
        var participant = s.Kit.SeedParticipant();
        var plan = OctoberPlan(s.Kit, participant, 8000m);
        var claim = RejectedClaim(s.Kit, participant, "V27", D(2026, 12, 20));
        var reader = new NdiaRejectionReader(s.Kit.Db, s.Kit.Clock);

        var note = Assert.Single(await reader.ForParticipantAsync(LedgerKit.TenantA, participant.Id, CancellationToken.None));

        Assert.Equal(plan.Pools.Single().Id, note.Key);
        Assert.Equal((new DateOnly(2026, 10, 4), "V27", claim.Id, claim.ClaimReference), (note.Value.Date, note.Value.Code, note.Value.ClaimId, note.Value.ClaimReference));

        s.Kit.Clock.Set(new DateTimeOffset(2027, 1, 1, 3, 0, 0, TimeSpan.Zero));
        Assert.Empty(await reader.ForParticipantAsync(LedgerKit.TenantA, participant.Id, CancellationToken.None));
    }

    [Fact]
    public async Task TheNote_IsAskedOfAParticipantOfTheOrganisation_AndOnlyOfIt()
    {
        var database = Guid.NewGuid().ToString();
        using var mine = Setup.Create(LedgerKit.TenantA, database);
        using var theirs = Setup.Create(LedgerKit.TenantB, database);
        var other = theirs.Kit.SeedParticipant(tenantId: LedgerKit.TenantB);
        theirs.Kit.SeedPlan(other, D(2026, 10, 1), D(2027, 6, 30), Core(PlanType.PlanManaged, Q(2, 100m), Q(3, 100m), Q(4, 100m)));
        RejectedClaim(theirs.Kit, other, "V27", D(2026, 10, 2));
        var reader = new NdiaRejectionReader(mine.Kit.Db, mine.Kit.Clock);

        Assert.Empty(await reader.ForParticipantAsync(LedgerKit.TenantA, other.Id, CancellationToken.None));
        Assert.Empty(await reader.ForParticipantAsync(LedgerKit.TenantB, other.Id, CancellationToken.None));   // even named for them: the context is mine, and the filter is the context's
    }
}
