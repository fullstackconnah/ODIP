using Microsoft.Extensions.Caching.Memory;
using Odip.Api.RateLimiting;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Services;
using Xunit;
using static Odip.Tests.Funding.LedgerKit;

namespace Odip.Tests.Funding;

/// <summary>
/// The budget graph's series (Funding tab): the ledger's own items placed by the ledger's own rule, and the approved agreement revisions that have blocks, re-priced. The quote is faked through
/// the service's seam: every Monday the agreement covers is one $100 line of Core (category 4), or $200 for a revision starting 1 Dec, so the expected line can be counted by hand. The plan is
/// 1 Jul 2026 to 30 Jun 2027 (Core $2,500 a quarter and Increased Social and Community Participation, category 9, $500 a quarter); today is 4 Oct 2026.
/// </summary>
public class BudgetSeriesServiceTests
{
    private static readonly DateOnly PlanStart = D(2026, 7, 1);
    private static readonly DateOnly PlanEnd = D(2027, 6, 30);

    private sealed class Arrangement : IDisposable
    {
        public LedgerKit Kit { get; }
        public Participant Person { get; }
        public BudgetSeriesService Service { get; }
        public IMemoryCache Cache { get; }
        public int Quotes;
        public int Entries;
        /// <summary>Lines with no price the fake quote adds, by revision start.</summary>
        public Dictionary<DateOnly, DateOnly[]> UnpricedOn { get; } = new();
        public Func<DateOnly, DateOnly, Task>? DuringQuote;

        public Arrangement(LedgerKit kit, Participant person, IMemoryCache? cache = null)
        {
            Kit = kit;
            Person = person;
            Cache = cache ?? new MemoryCache(new MemoryCacheOptions());
            Service = new BudgetSeriesService(kit.Db, kit.Ledger, new PlanPricingService(kit.Db), Cache);
            Service.Quote = async (_, _, from, to, _, _) =>
            {
                Quotes++;
                if (DuringQuote is not null) await DuringQuote(from, to);
                var rate = from >= D(2026, 12, 1) ? 200m : 100m;
                var lines = Mondays(from, to).Select(d => new PlannedLine { ItemCode = "04_TEST", Total = rate, ServiceDate = d, PaceCategory = 4 }).ToList();
                lines.AddRange(UnpricedOn.GetValueOrDefault(from, []).Select(d => new PlannedLine { ServiceDate = d, PaceCategory = 4, Unpriced = PlanFailureReason.NoItem }));
                return new PlanQuote { PeriodFrom = from, PeriodTo = to, Lines = lines };
            };
        }

        public Task<BudgetSeriesDto?> GetAsync(Func<IDisposable?>? enter = null) =>
            Service.GetAsync(Kit.TenantId, Person.Id, enter ?? (() => { Entries++; return new Lease(); }), CancellationToken.None);

        public void Dispose() => Kit.Dispose();
    }

    private sealed class Lease : IDisposable { public void Dispose() { } }

    private static Arrangement Arrange(bool catalogue = true, PlanType planType = PlanType.PlanManaged)
    {
        var kit = LedgerKit.Create();
        kit.SeedProvider("NSW");
        if (catalogue) kit.EnsureCommunityAccessCatalogue();
        return new Arrangement(kit, kit.SeedParticipant(planType: planType));
    }

    private static FundingPlan YearPlan(Arrangement a) => a.Kit.SeedPlan(a.Person,
        Core(PlanType.PlanManaged, Q(1, 2500m), Q(2, 2500m), Q(3, 2500m), Q(4, 2500m)),
        Stated(9, PlanType.PlanManaged, Q(1, 500m), Q(2, 500m), Q(3, 500m), Q(4, 500m)));

    private static IEnumerable<DateOnly> Mondays(DateOnly from, DateOnly to)
    {
        for (var d = from; d <= to; d = d.AddDays(1)) if (d.DayOfWeek == DayOfWeek.Monday) yield return d;
    }

    /// <summary>A saved agreement revision; approved unless said otherwise, with one block unless typed by hand.</summary>
    private static ServiceAgreementDraft Revision(Arrangement a, int version, DateOnly start, DateOnly end, bool approved = true, bool handTyped = false)
    {
        var draft = new ServiceAgreementDraft
        {
            Id = Guid.NewGuid(), TenantId = a.Person.TenantId, ParticipantId = a.Person.Id, Version = version, PlanStartDate = PlanStart, PlanEndDate = PlanEnd,
            AgreementStartDate = start, AgreementEndDate = end, State = "NSW", ParticipantNameSnapshot = "Sophie Brown",
        };
        if (!handTyped)
        {
            var block = Odip.Tests.PlanPricing.PlanPricingTestSupport.Block("mon", PlanSupportType.CommunityAccess, DayOfWeek.Monday, new TimeOnly(9, 0), new TimeOnly(13, 0));
            draft.Blocks.Add(new ServiceAgreementDraftBlock { Id = Guid.NewGuid(), DraftId = draft.Id, Position = 0, BlockKey = block.Id, BlockJson = DraftJson.Write(block) });
        }
        a.Kit.Db.ServiceAgreementDrafts.Add(draft);
        if (approved)
            a.Kit.Db.ServiceAgreementDraftApprovals.Add(new ServiceAgreementDraftApproval
            {
                Id = Guid.NewGuid(), TenantId = a.Person.TenantId, DraftId = draft.Id, ParticipantId = a.Person.Id, DraftVersion = version, ApprovedAt = FundingTestKit.Now.UtcDateTime, ApprovedByName = "Alex Admin",
            });
        a.Kit.Db.SaveChanges();
        return draft;
    }

    private static BudgetSeriesPointDto At(BudgetSeriesScopeDto scope, DateOnly date) => scope.Points.Last(p => p.Date == date);

    // ── 10: the graph never disagrees with the pool cards ──────────────────────

    [Fact]
    public async Task TheTodayPointIsEachPoolsUsed_AndThePlanEndItsForecast_WithPendingAheadAndBookedToday()
    {
        using var a = Arrange();
        YearPlan(a);
        var paid = a.Kit.SeedShift(a.Person, D(2026, 8, 3), ShiftStatus.Completed);
        a.Kit.SeedShiftClaim(a.Person, TripClaimStatus.Paid, 300m, paid);
        var submitted = a.Kit.SeedShift(a.Person, D(2026, 9, 7), ShiftStatus.Completed);
        a.Kit.SeedShiftClaim(a.Person, TripClaimStatus.Submitted, 120m, submitted);
        a.Kit.SeedShift(a.Person, D(2026, 9, 21), ShiftStatus.Completed);           // delivered, not claimed: pending
        a.Kit.SeedShift(a.Person, D(2026, 10, 8), ShiftStatus.Completed);           // marked done ahead of its date: pending, dated after today
        a.Kit.SeedShift(a.Person, Today, ShiftStatus.Published);                     // booked ahead, dated today
        a.Kit.SeedShift(a.Person, D(2026, 11, 2), ShiftStatus.Published);
        a.Kit.SeedShift(a.Person, D(2027, 3, 1), ShiftStatus.Published);

        var ledger = (await a.Kit.Ledger.ComputeAsync(a.Kit.TenantId, new[] { a.Person.Id }, CancellationToken.None))[a.Person.Id];
        Assert.Contains(ledger.Items, i => i.Group == LedgerGroup.Pending && i.Date > Today);
        Assert.Contains(ledger.Items, i => i.Group == LedgerGroup.BookedAhead && i.Date == Today);
        var pools = ledger.Ledger!.Pools;

        var series = (await a.GetAsync())!;
        Assert.Equal(BudgetChartStatus.Ok, series.Chart);
        Assert.Equal((PlanStart, PlanEnd, Today, true), (series.PlanStart, series.PlanEnd, series.Today, series.PlanIsCurrent));
        Assert.Equal(new[] { "plan", pools[0].Pool.Id.ToString(), pools[1].Pool.Id.ToString() }, series.Scopes.Select(s => s.ScopeKey));
        Assert.Equal(new[] { BudgetSeriesService.WholePlanName, "Core", "Increased Social and Community Participation" }, series.Scopes.Select(s => s.Name));

        var expected = new[] { (Limit: pools.Sum(p => p.Total.Limit), Used: pools.Sum(p => p.Total.Used), Forecast: pools.Sum(p => p.Total.Forecast)) }
            .Concat(pools.Select(p => (p.Total.Limit, p.Total.Used, p.Total.Forecast))).ToList();
        Assert.True(expected[1].Forecast > expected[1].Used);
        for (var i = 0; i < series.Scopes.Count; i++)
        {
            var scope = series.Scopes[i];
            Assert.Equal(expected[i].Limit, scope.Limit);
            Assert.Equal(expected[i].Used, At(scope, Today).Used);
            Assert.Equal(expected[i].Used, scope.Summary.Used);
            Assert.Equal(expected[i].Forecast, scope.Points[^1].UsedAndBooked);
            Assert.Equal(expected[i].Limit, scope.Points[^1].Budget);
        }
    }

    [Fact]
    public async Task ACancelledShiftCountsNothing()
    {
        using var a = Arrange();
        YearPlan(a);
        a.Kit.SeedShift(a.Person, D(2026, 11, 2), ShiftStatus.Cancelled);
        a.Kit.SeedShift(a.Person, D(2026, 8, 3), ShiftStatus.Cancelled);

        var plan = (await a.GetAsync())!.Scopes[0];
        Assert.Equal(0m, plan.Summary.Used);
        Assert.All(plan.Points.Where(p => p.UsedAndBooked is not null), p => Assert.Equal(0m, p.UsedAndBooked));
    }

    // ── 12-14: no chart, no pricing, an ended plan ─────────────────────────────

    [Fact]
    public async Task NoChart_WithNoPlan_APlanWithNoPools_BetweenPlans_OrFundedAnotherWay_AndNothingIsPriced()
    {
        using (var a = Arrange())
        {
            Revision(a, 1, PlanStart, PlanEnd);
            var none = (await a.GetAsync())!;
            Assert.Equal(BudgetChartStatus.None, none.Chart);
            Assert.Equal(Today, none.Today);
            Assert.Empty(none.Scopes);
            Assert.Equal(0, a.Quotes);
        }
        using (var a = Arrange())
        {
            a.Kit.SeedPlan(a.Person);
            Assert.Equal(BudgetChartStatus.None, (await a.GetAsync())!.Chart);
        }
        using (var a = Arrange())
        {
            a.Kit.SeedPlan(a.Person, D(2025, 7, 1), D(2026, 6, 30), Core(PlanType.PlanManaged, Q(1, 100m, year: 2025)));
            a.Kit.SeedPlan(a.Person, D(2026, 11, 1), D(2027, 10, 31), Core(PlanType.PlanManaged, new PeriodSpec(D(2026, 11, 1), D(2027, 10, 31), 100m, null)));
            Assert.Equal(BudgetChartStatus.None, (await a.GetAsync())!.Chart);
        }
        using (var a = Arrange())
        {
            YearPlan(a);
            Revision(a, 1, PlanStart, PlanEnd);
            a.Person.FundingSource = ParticipantFundingSource.Other;
            a.Kit.Db.SaveChanges();
            Assert.Equal(BudgetChartStatus.None, (await a.GetAsync())!.Chart);
            Assert.Equal(0, a.Quotes);
        }
    }

    [Fact]
    public async Task NoPriceListInEffectOnAnyDayOfThePlan_IsNoPricing_AndNothingIsQuoted()
    {
        using var a = Arrange(catalogue: false);
        a.Kit.SeedCommunityAccessCatalogue(D(2025, 7, 1), D(2026, 6, 30), "2025-26");
        YearPlan(a);
        Revision(a, 1, PlanStart, PlanEnd);

        var series = (await a.GetAsync())!;
        Assert.Equal(BudgetChartStatus.NoPricing, series.Chart);
        Assert.Equal((PlanStart, PlanEnd), (series.PlanStart, series.PlanEnd));
        Assert.Empty(series.Scopes);
        Assert.Equal((0, 0), (a.Quotes, a.Entries));
    }

    [Fact]
    public async Task AnEndedPlanWithNothingAfterIt_Draws_WithNoBookedLine()
    {
        using var a = Arrange(catalogue: false);
        a.Kit.SeedCommunityAccessCatalogue(D(2025, 7, 1), null, "2025-26");
        a.Kit.SeedPlan(a.Person, D(2025, 7, 1), D(2026, 6, 30), Core(PlanType.PlanManaged, Q(1, 1000m, year: 2025), Q(2, 1000m, year: 2025), Q(3, 1000m, year: 2025), Q(4, 1000m, year: 2025)));

        var series = (await a.GetAsync())!;
        Assert.Equal(BudgetChartStatus.Ok, series.Chart);
        Assert.False(series.PlanIsCurrent);
        Assert.All(series.Scopes, s => Assert.All(s.Points, p => Assert.Null(p.UsedAndBooked)));
        Assert.Equal(4000m, series.Scopes[0].Summary.LeftAtEnd);
    }

    // ── 15-17: the agreement revisions, stitched ───────────────────────────────

    [Fact]
    public async Task EachApprovedRevisionRunsToTheDayBeforeTheNextOneStarts_AndAWaitingRevisionChangesNothing()
    {
        using var a = Arrange();
        YearPlan(a);
        Revision(a, 1, PlanStart, PlanEnd);
        Revision(a, 2, D(2026, 12, 1), D(2027, 6, 30));
        Revision(a, 3, D(2027, 2, 1), D(2027, 6, 30), approved: false);

        var series = (await a.GetAsync())!;
        Assert.Equal(BudgetExpectedStatus.Ok, series.Expected.Status);
        Assert.Equal(new[] { D(2026, 12, 1) }, series.Expected.RevisionChanges);
        Assert.Null(series.Expected.StartsOn);
        Assert.Null(series.Expected.EndsOn);

        var toNov = 100m * Mondays(PlanStart, D(2026, 11, 30)).Count();
        var fromDec = 200m * Mondays(D(2026, 12, 1), PlanEnd).Count();
        var plan = series.Scopes[0];
        Assert.Equal(toNov, At(plan, D(2026, 12, 1)).Expected);   // the week ending Tue 1 Dec: no Monday of December yet, and revision 1's December Mondays are never counted
        Assert.Equal(toNov + 200m, At(plan, D(2026, 12, 8)).Expected);
        Assert.Equal(toNov + fromDec, plan.Summary.ExpectedEnd);
        Assert.Equal(toNov + fromDec, series.Scopes[1].Summary.ExpectedEnd);   // all Core
        Assert.Equal(0m, series.Scopes[2].Summary.ExpectedEnd);
        Assert.Equal(2, a.Quotes);
        Assert.Equal(1, a.Entries);
    }

    [Fact]
    public async Task NoApprovedRevisionWithBlocks_IsNoAgreement_AndAHandTypedRevisionCutsNoOtherShort()
    {
        using (var a = Arrange())
        {
            YearPlan(a);
            Revision(a, 1, PlanStart, PlanEnd, approved: false);
            Assert.Equal(BudgetExpectedStatus.NoAgreement, (await a.GetAsync())!.Expected.Status);
        }
        using (var a = Arrange())
        {
            YearPlan(a);
            Revision(a, 1, PlanStart, PlanEnd, handTyped: true);
            var series = (await a.GetAsync())!;
            Assert.Equal(BudgetExpectedStatus.NoAgreement, series.Expected.Status);
            Assert.All(series.Scopes[0].Points, p => Assert.Null(p.Expected));
            Assert.Equal(0, a.Quotes);
        }
        using (var a = Arrange())
        {
            YearPlan(a);
            Revision(a, 1, PlanStart, PlanEnd);
            Revision(a, 2, D(2026, 12, 1), PlanEnd, handTyped: true);
            var series = (await a.GetAsync())!;
            Assert.Equal(BudgetExpectedStatus.Ok, series.Expected.Status);
            Assert.Empty(series.Expected.RevisionChanges);
            Assert.Equal(100m * Mondays(PlanStart, PlanEnd).Count(), series.Scopes[0].Summary.ExpectedEnd);
            Assert.Equal(PlanEnd, series.Scopes[0].Summary.ExpectedEndDate);
        }
    }

    [Fact]
    public async Task AnAgreementShorterThanThePlan_SaysWhereItStartsAndEnds_AndOneOutsideThePlanIsNoAgreement()
    {
        using var a = Arrange();
        YearPlan(a);
        Revision(a, 1, D(2026, 8, 1), D(2027, 3, 31));

        var series = (await a.GetAsync())!;
        Assert.Equal((D(2026, 8, 1), D(2027, 3, 31)), (series.Expected.StartsOn, series.Expected.EndsOn));
        Assert.Null(At(series.Scopes[0], D(2026, 7, 28)).Expected);
        Assert.Equal(0m, At(series.Scopes[0], D(2026, 7, 31)).Expected);
        Assert.Null(At(series.Scopes[0], D(2027, 4, 6)).Expected);

        using var b = Arrange();
        YearPlan(b);
        Revision(b, 1, D(2027, 7, 1), D(2027, 12, 31));
        Assert.Equal(BudgetExpectedStatus.NoAgreement, (await b.GetAsync())!.Expected.Status);
    }

    // ── 18: unavailable, all or nothing ────────────────────────────────────────

    [Fact]
    public async Task NoPricingPermit_OrAQuoteThatFails_IsUnavailable_AndTheOtherLinesStillDraw()
    {
        using var a = Arrange();
        YearPlan(a);
        Revision(a, 1, PlanStart, PlanEnd);

        var busy = (await a.GetAsync(() => null))!;
        Assert.Equal(BudgetChartStatus.Ok, busy.Chart);
        Assert.Equal(BudgetExpectedStatus.Unavailable, busy.Expected.Status);
        Assert.All(busy.Scopes[0].Points, p => Assert.Null(p.Expected));
        Assert.NotNull(At(busy.Scopes[0], Today).Used);
        Assert.Equal(0, a.Quotes);

        a.Service.Quote = (_, _, _, _, _, _) => throw new InvalidOperationException("the engine fell over");
        Assert.Equal(BudgetExpectedStatus.Unavailable, (await a.GetAsync())!.Expected.Status);

        a.Service.Quote = (_, _, from, to, _, _) => Task.FromResult(new PlanQuote { PeriodFrom = from, PeriodTo = to, Issues = [new PlanIssue("mon", PlanFailureReason.InvalidInput, "bad", 1, null)] });
        Assert.Equal(BudgetExpectedStatus.Unavailable, (await a.GetAsync())!.Expected.Status);
    }

    [Fact]
    public async Task OneRevisionThatFails_MakesTheWholeLineUnavailable()
    {
        using var a = Arrange();
        YearPlan(a);
        Revision(a, 1, PlanStart, PlanEnd);
        Revision(a, 2, D(2026, 12, 1), PlanEnd);
        var real = a.Service.Quote;
        a.Service.Quote = (t, b, from, to, ct, v) => from == PlanStart ? real(t, b, from, to, ct, v) : throw new InvalidOperationException("no");

        var series = (await a.GetAsync())!;
        Assert.Equal(BudgetExpectedStatus.Unavailable, series.Expected.Status);
        Assert.Empty(series.Expected.RevisionChanges);
        Assert.All(series.Scopes[0].Points, p => Assert.Null(p.Expected));
    }

    [Fact]
    public async Task OnePricingPermitAtMostPerRequest_TakenOnTheFirstMiss_AndGivenBackAfter()
    {
        using var limiter = new PlanQuoteConcurrencyLimiter();
        using var a = Arrange();
        YearPlan(a);
        Revision(a, 1, PlanStart, PlanEnd);
        Revision(a, 2, D(2026, 12, 1), PlanEnd);
        var key = "tenant:" + a.Kit.TenantId.ToString("N");
        var secondFree = new List<bool>();
        a.DuringQuote = (_, _) =>
        {
            using var other = limiter.TryEnter(key);
            secondFree.Add(other.IsAcquired);
            return Task.CompletedTask;
        };

        var series = (await a.GetAsync(() =>
        {
            a.Entries++;
            var lease = limiter.TryEnter(key);
            if (lease.IsAcquired) return lease;
            lease.Dispose();
            return null;
        }))!;

        Assert.Equal(BudgetExpectedStatus.Ok, series.Expected.Status);
        Assert.Equal(1, a.Entries);
        Assert.Equal(new[] { true, true }, secondFree);   // both cold revisions priced under one permit, so the other one stayed free
        using var first = limiter.TryEnter(key);
        using var second = limiter.TryEnter(key);
        Assert.True(first.IsAcquired && second.IsAcquired);   // the permit was given back
    }

    // ── 19: the quote cache ────────────────────────────────────────────────────

    [Fact]
    public async Task ARevisionIsQuotedOnce_UntilANewPriceListArrives()
    {
        using var a = Arrange();
        YearPlan(a);
        Revision(a, 1, PlanStart, PlanEnd);

        var first = (await a.GetAsync())!;
        var second = (await a.GetAsync())!;
        Assert.Equal((1, 1), (a.Quotes, a.Entries));   // the hit takes no permit
        Assert.Equal(first.Scopes[0].Summary.ExpectedEnd, second.Scopes[0].Summary.ExpectedEnd);

        a.Kit.SeedCommunityAccessCatalogue(D(2027, 7, 1), null, "2027-28");
        await a.GetAsync();
        Assert.Equal((2, 2), (a.Quotes, a.Entries));
    }

    // ── 20 and the unpriced agreement lines ────────────────────────────────────

    [Fact]
    public async Task ShiftsTheClaimCannotPrice_AreCountedWithTheirReasons_InTheirOwnScope()
    {
        using var a = Arrange();
        YearPlan(a);
        foreach (var date in new[] { D(2026, 10, 6), D(2026, 10, 7) })
            a.Kit.SeedShift(a.Person, date).Ratio = SupportRatio.OneToThree;
        a.Kit.Db.SaveChanges();

        var series = (await a.GetAsync())!;
        Assert.Equal(2, series.Scopes[0].UnpricedShiftCount);
        Assert.Equal(2, series.Scopes[1].UnpricedShiftCount);
        Assert.Equal(0, series.Scopes[2].UnpricedShiftCount);
        Assert.NotEmpty(series.Scopes[0].UnpricedShiftReasons);
        Assert.Equal(series.Scopes[0].UnpricedShiftReasons, series.Scopes[0].UnpricedShiftReasons.Distinct().Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task AgreementLinesWithNoPrice_AreCountedOnlyInsideTheDaysTheirRevisionDraws()
    {
        using var a = Arrange();
        YearPlan(a);
        Revision(a, 1, PlanStart, PlanEnd);
        Revision(a, 2, D(2026, 12, 1), PlanEnd);
        a.UnpricedOn[PlanStart] = [D(2026, 7, 6), D(2026, 8, 3), D(2027, 1, 4)];   // the last is after revision 2 takes over
        a.UnpricedOn[D(2026, 12, 1)] = [D(2027, 2, 1)];

        var series = (await a.GetAsync())!;
        Assert.Equal(3, series.Expected.UnpricedLineCount);
        Assert.Equal(100m * Mondays(PlanStart, D(2026, 11, 30)).Count() + 200m * Mondays(D(2026, 12, 1), PlanEnd).Count(), series.Scopes[0].Summary.ExpectedEnd);

        a.UnpricedOn.Clear();
        a.Cache.Dispose();
        using var fresh = new Arrangement(a.Kit, a.Person);
        Assert.Equal(0, (await fresh.GetAsync())!.Expected.UnpricedLineCount);
    }
}
