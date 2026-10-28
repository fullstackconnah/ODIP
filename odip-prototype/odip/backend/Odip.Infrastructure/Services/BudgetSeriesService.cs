using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The budget graph's series (Funding tab). Budget, used and booked are read from the ledger's own items, placed with the ledger's own rule (<see cref="BudgetLedgerCalculator.Place"/>), so the
/// graph can never disagree with the pool cards: the today point is the pool's Used and the plan end its Forecast. The expected line re-prices the approved agreement revisions that have blocks
/// with the plan pricing engine (<see cref="PlanPricingService"/>), each one up to the day before the next one starts, clipped to the plan. Waiting drafts are never read.
///
/// The quote is the heavy part, so its reduction is cached per revision and price list (a revision never changes), and a miss takes one of the organisation's pricing permits, the plan
/// builder's: when none is free the expected line is "unavailable" and everything else still draws. Tenancy: the ledger reads the participant inside the tenant first (missing is null, a 404),
/// and the revisions are read inside the tenant.
/// </summary>
public sealed class BudgetSeriesService
{
    public const string WholePlanName = "The whole plan";
    private static readonly TimeSpan QuoteLifetime = TimeSpan.FromHours(1);

    private readonly OdipDbContext _db;
    private readonly BudgetLedgerService _ledger;
    private readonly IMemoryCache _cache;
    private readonly ILogger<BudgetSeriesService>? _log;

    public BudgetSeriesService(OdipDbContext db, BudgetLedgerService ledger, PlanPricingService pricing, IMemoryCache cache, ILogger<BudgetSeriesService>? log = null)
    {
        _db = db;
        _ledger = ledger;
        _cache = cache;
        _log = log;
        Quote = pricing.QuoteAsync;
    }

    /// <summary>The pricing call; a test swaps it to count or fail quotes.</summary>
    internal Func<Guid, IReadOnlyList<PlanBlock>, DateOnly, DateOnly, CancellationToken, string?, Task<PlanQuote>> Quote { get; set; }

    /// <summary>What one revision's quote comes to, ready to place: priced totals by day and PACE category, and how many lines had no price on each day.</summary>
    private sealed record QuoteReduction(IReadOnlyList<(DateOnly Date, int? PaceCategory, decimal Total)> Priced, IReadOnlyList<(DateOnly Date, int Count)> Unpriced);

    /// <param name="enterPricing">Takes one of the organisation's pricing permits for this request, or returns null when none is free. Called at most once, on the first cache miss.</param>
    public async Task<BudgetSeriesDto?> GetAsync(Guid tenantId, Guid participantId, Func<IDisposable?> enterPricing, CancellationToken ct)
    {
        var all = await _ledger.ComputeAsync(tenantId, new[] { participantId }, ct);
        if (!all.TryGetValue(participantId, out var ledger)) return null;

        var none = new BudgetSeriesDto { Chart = BudgetChartStatus.None, Today = ledger.Today };
        // Between plans is the Funding tab's own rule (an ended plan with the next one recorded): the tab shows the next plan's start, not the old plan.
        if (ledger.Ledger is not { } plan || plan.Pools.Count == 0 || (!plan.PlanIsCurrent && ledger.NextPlanStart is not null)) return none;

        var (start, end) = (plan.Plan.PlanStart, plan.Plan.PlanEnd);
        var answer = none with { PlanStart = start, PlanEnd = end, PlanIsCurrent = plan.PlanIsCurrent };
        if (!await _db.SupportCatalogueItems.AnyAsync(i => i.EffectiveFrom <= end && (i.EffectiveTo == null || i.EffectiveTo >= start), ct))
            return answer with { Chart = BudgetChartStatus.NoPricing };

        var (expected, covered, expectedLines) = await ExpectedAsync(tenantId, participantId, plan, enterPricing, ct);

        // The items each pool's totals sum: only those the ledger puts in a period of a pool. In no pool or outside the plan, they are in no scope, as they are in no pool total.
        var items = ledger.Items.Select(i => (Item: i, Place: BudgetLedgerCalculator.Place(plan.Plan, i))).Where(x => x.Place.Placement == LedgerPlacement.InPeriod)
            .Select(x => (x.Item, PoolId: x.Place.Pool!.Id)).ToList();

        BudgetSeriesScopeDto Scope(string key, string name, decimal limit, Func<Guid, bool> inScope)
        {
            var mine = items.Where(x => inScope(x.PoolId)).Select(x => x.Item).ToList();
            var line = BudgetSeries.Build(new BudgetSeriesInput
            {
                PlanStart = start, PlanEnd = end, Today = ledger.Today, PlanIsCurrent = plan.PlanIsCurrent, Limit = limit,
                Used = mine.Where(i => i.Group is LedgerGroup.Claimed or LedgerGroup.Pending).Select(i => new DatedAmount(i.Date, i.Amount)).ToList(),
                Booked = mine.Where(i => i.Group == LedgerGroup.BookedAhead).Select(i => new DatedAmount(i.Date, i.Amount)).ToList(),
                Covered = covered,
                Expected = expectedLines.Where(x => inScope(x.PoolId)).Select(x => x.Line).ToList(),
            });
            var unpriced = mine.Where(i => i.IsUnpricedShift).ToList();
            return new BudgetSeriesScopeDto
            {
                ScopeKey = key, Name = name, Limit = limit,
                Points = line.Points.Select(p => new BudgetSeriesPointDto { Date = p.Date, Budget = p.Budget, Used = p.Used, UsedAndBooked = p.UsedAndBooked, Expected = p.Expected, IsEdge = p.IsEdge }).ToList(),
                Summary = new BudgetSeriesSummaryDto
                {
                    Used = line.Summary.Used, EvenToDate = line.Summary.EvenToDate, AheadOfEven = line.Summary.AheadOfEven, Pace = line.Summary.Pace, PaceGapAtEnd = line.Summary.PaceGapAtEnd,
                    BookedEnd = line.Summary.BookedEnd, ExpectedEnd = line.Summary.ExpectedEnd, ExpectedEndDate = line.Summary.ExpectedEndDate, LeftAtEnd = line.Summary.LeftAtEnd,
                },
                UnpricedShiftCount = unpriced.Count,
                UnpricedShiftReasons = unpriced.SelectMany(i => i.NotPricedKinds).Distinct(StringComparer.Ordinal).Order(StringComparer.Ordinal).ToList(),
            };
        }

        var severalCore = plan.Pools.Count(p => p.Pool.Kind == FundingPoolKind.CoreFlexible) > 1;
        var scopes = new List<BudgetSeriesScopeDto> { Scope("plan", WholePlanName, plan.Pools.Sum(p => p.Total.Limit), _ => true) };
        scopes.AddRange(plan.Pools.Select(p => Scope(p.Pool.Id.ToString(), BudgetText.PoolLabel(p.Pool, severalCore), p.Total.Limit, id => id == p.Pool.Id)));

        return answer with { Chart = BudgetChartStatus.Ok, Expected = expected, Scopes = scopes };
    }

    private async Task<(BudgetExpectedDto Dto, IReadOnlyList<DayRange>? Covered, List<(Guid PoolId, DatedAmount Line)> Lines)> ExpectedAsync(
        Guid tenantId, Guid participantId, PlanLedger plan, Func<IDisposable?> enterPricing, CancellationToken ct)
    {
        var (planStart, planEnd) = (plan.Plan.PlanStart, plan.Plan.PlanEnd);
        var unavailable = (new BudgetExpectedDto { Status = BudgetExpectedStatus.Unavailable }, (IReadOnlyList<DayRange>?)null, new List<(Guid, DatedAmount)>());

        // Approved revisions with blocks, in version order (in memory: Npgsql drops an ORDER BY before some operators). A revision typed by hand has no blocks to re-price, covers no days and
        // cuts no other revision short.
        var revisions = (await _db.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks)
                .Where(d => d.TenantId == tenantId && d.ParticipantId == participantId && _db.ServiceAgreementDraftApprovals.Any(a => a.DraftId == d.Id))
                .ToListAsync(ct))
            .Where(d => d.Blocks.Count > 0).OrderBy(d => d.Version).ToList();

        var segments = new List<(ServiceAgreementDraft Draft, DayRange Days)>();
        for (var i = 0; i < revisions.Count; i++)
        {
            var later = revisions.Skip(i + 1).Select(r => r.AgreementStartDate).ToList();
            var segEnd = later.Count > 0 && later.Min().AddDays(-1) < revisions[i].AgreementEndDate ? later.Min().AddDays(-1) : revisions[i].AgreementEndDate;
            var from = revisions[i].AgreementStartDate > planStart ? revisions[i].AgreementStartDate : planStart;
            var to = segEnd < planEnd ? segEnd : planEnd;
            if (from <= to) segments.Add((revisions[i], new DayRange(from, to)));
        }
        if (segments.Count == 0) return (new BudgetExpectedDto { Status = BudgetExpectedStatus.NoAgreement }, null, new());

        var lists = await AgreementPriceLists.ListAsync(_db, ct);
        var priceStamp = string.Join("|", lists.Select(l => $"{l.Version}@{l.Start:yyyy-MM-dd}")) + "#" + await _db.SupportCatalogueItems.CountAsync(ct);
        var planType = await _db.Participants.AsNoTracking().Where(p => p.Id == participantId && p.TenantId == tenantId).Select(p => p.PlanType).FirstAsync(ct);

        var lines = new List<(Guid PoolId, DatedAmount Line)>();
        var unpricedLines = 0;
        IDisposable? lease = null;
        var asked = false;
        try
        {
            foreach (var (draft, days) in segments)
            {
                var key = ("budget-series-quote", tenantId, draft.Id, priceStamp);
                if (!_cache.TryGetValue(key, out QuoteReduction? reduction) || reduction is null)
                {
                    // One permit for the whole request, taken on the first miss.
                    if (!asked) { lease = enterPricing(); asked = true; }
                    if (lease is null) return unavailable;
                    reduction = await PriceAsync(tenantId, draft, ct);
                    if (reduction is null) return unavailable;
                    // shortcut: prices edited in place within a version, a public-holiday sync and a pricing-settings change keep the old quote for up to 1 hour; add an eviction signal from CatalogueImportService / settings save if users notice.
                    _cache.Set(key, reduction, QuoteLifetime);
                }

                foreach (var (date, category, total) in reduction.Priced.Where(p => p.Date >= days.Start && p.Date <= days.End))
                {
                    var place = BudgetLedgerCalculator.Place(plan.Plan, new LedgerItem
                    {
                        Kind = LedgerRowKind.FutureShift, Group = LedgerGroup.BookedAhead, Date = date, Amount = total, PaceCategory = category, PlanType = planType,
                    });
                    if (place.Placement == LedgerPlacement.InPeriod) lines.Add((place.Pool!.Id, new DatedAmount(date, total)));
                }
                unpricedLines += reduction.Unpriced.Where(u => u.Date >= days.Start && u.Date <= days.End).Sum(u => u.Count);
            }
        }
        finally
        {
            lease?.Dispose();
        }

        var covered = segments.Select(s => s.Days).ToList();
        var runs = BudgetSeries.Runs(covered);
        return (new BudgetExpectedDto
        {
            Status = BudgetExpectedStatus.Ok,
            StartsOn = runs[0].Start > planStart ? runs[0].Start : null,
            EndsOn = runs[^1].End < planEnd ? runs[^1].End : null,
            RevisionChanges = segments.Skip(1).Select(s => s.Days.Start).ToList(),
            UnpricedLineCount = unpricedLines,
        }, covered, lines);
    }

    /// <summary>One revision priced over its own dates, as the wizard and the approval price it. Null when the engine refused it or failed: the expected line is then all or nothing.</summary>
    private async Task<QuoteReduction?> PriceAsync(Guid tenantId, ServiceAgreementDraft draft, CancellationToken ct)
    {
        PlanQuote quote;
        try
        {
            var blocks = draft.Blocks.OrderBy(b => b.Position).Select(b => DraftJson.ReadBlock(b.BlockJson)).ToList();
            quote = await Quote(tenantId, blocks, draft.AgreementStartDate, draft.AgreementEndDate, ct, null);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log?.LogWarning(e, "The budget graph could not price agreement revision {DraftId}", draft.Id);
            return null;
        }
        if (quote.Lines.Count == 0 && quote.Issues.Any(i => i.Reason == PlanFailureReason.InvalidInput)) return null;

        return new QuoteReduction(
            quote.Lines.Where(l => l.IsPriced && l.Total > 0m).GroupBy(l => (l.ServiceDate, l.PaceCategory)).Select(g => (g.Key.ServiceDate, g.Key.PaceCategory, g.Sum(l => l.Total))).ToList(),
            quote.Lines.Where(l => !l.IsPriced).GroupBy(l => l.ServiceDate).Select(g => (g.Key, g.Count())).ToList());
    }
}
