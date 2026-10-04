using Odip.Domain.Enums;

namespace Odip.Domain.Funding;

/// <summary>
/// One thing that costs a participant's budget, or may: a line of a claim that counts, a completed shift nobody has claimed, a shift never resolved, a rostered shift, a confirmed
/// trip booking. It carries what the ledger needs to place it (its date, its PACE category, how the money is managed) and what a screen shows for it. Plain data: the
/// service that loads the records decides what is an item and what it costs; <see cref="BudgetLedgerCalculator"/> places and adds them up.
/// </summary>
public sealed record LedgerItem
{
    public required LedgerRowKind Kind { get; init; }
    public required LedgerGroup Group { get; init; }
    /// <summary>The service date: the claim line's SupportsDeliveredFrom, the shift's ServiceDate, or the trip's start date. A budget period is found by this date, never by when anything was claimed.</summary>
    public required DateOnly Date { get; init; }
    public required decimal Amount { get; init; }
    /// <summary>The PACE category (1 to 21) of the catalogue item valid on the date; null when none could be found, which shows the item as "Not in a recorded pool".</summary>
    public int? PaceCategory { get; init; }
    /// <summary>How the money behind this item is managed: the participant's plan type, or the booking's override. It picks between two Core (flexible) pools.</summary>
    public PlanType PlanType { get; init; }

    /// <summary>The claim line, shift or booking itself.</summary>
    public Guid Id { get; init; }
    public Guid? ClaimId { get; init; }
    public Guid? ShiftId { get; init; }
    public Guid? BookingId { get; init; }

    public string Description { get; init; } = string.Empty;
    /// <summary>The record's own status, as its name: the claim's, the shift's or the booking's.</summary>
    public string Status { get; init; } = string.Empty;
    /// <summary>Where the record can be opened: an in-app path.</summary>
    public string Link { get; init; } = string.Empty;
    /// <summary>Something worth saying about the figure (an item no catalogue rate covers is counted as $0), or null.</summary>
    public string? Note { get; init; }
}

/// <summary>Where an item landed.</summary>
public enum LedgerPlacement
{
    /// <summary>In a period of a recorded pool.</summary>
    InPeriod = 0,
    /// <summary>Its date is in the plan but no recorded pool covers its category: shown as "Not in a recorded pool", never dropped.</summary>
    NotInAPool = 1,
    /// <summary>Its date is outside the plan's dates (or every period of its pool): shown as "Outside the plan dates", never dropped.</summary>
    OutsideThePlan = 2,
}

public readonly record struct LedgerPlace(LedgerPlacement Placement, FundingPool? Pool, FundingPeriod? Period);

/// <summary>One funding period of one pool with its figures. <see cref="Available"/>, <see cref="Used"/> and <see cref="Forecast"/> are derived, so they cannot disagree with their parts.</summary>
public sealed record PeriodLedger(
    FundingPeriod Period, bool IsCurrent, decimal Limit, decimal Carried, decimal Claimed, decimal Pending, decimal BookedAhead, int PastUnresolvedCount, BudgetStatus Status,
    IReadOnlyList<LedgerItem> Items)
{
    /// <summary>The limit plus what earlier periods of the plan left unspent (rolled over, not confirmed: somebody else may have used it).</summary>
    public decimal Available => Limit + Carried;
    public decimal Used => Claimed + Pending;
    public decimal Forecast => Used + BookedAhead;
}

/// <summary>The same sums over a whole pool: every period's limit, claimed, pending and booked ahead, against the sum of the limits. Nothing carries: it is movement inside the pool.</summary>
public sealed record PoolTotals(decimal Limit, decimal Claimed, decimal Pending, decimal BookedAhead, int PastUnresolvedCount, BudgetStatus Status)
{
    public decimal Available => Limit;
    public decimal Used => Claimed + Pending;
    public decimal Forecast => Used + BookedAhead;
}

public sealed record PoolLedger(FundingPool Pool, bool HasSetAside, IReadOnlyList<PeriodLedger> Periods, PoolTotals Total);

public sealed record PlanLedger(
    FundingPlan Plan, DateOnly AsOf, bool PlanIsCurrent, IReadOnlyList<PoolLedger> Pools, IReadOnlyList<LedgerItem> NotInAPool, IReadOnlyList<LedgerItem> OutsideThePlan);

/// <summary>
/// The budget ledger's arithmetic (budget feature, phase 2a), pure: a plan, today, the "approaching" percentage and the items go in, and the figures of every pool and period come out.
/// Nothing is stored. The rules are the brief's:
/// <list type="bullet">
/// <item><b>Limit</b> is the period's set-aside when the pool has set-asides, else its plan amount. <b>Carried</b> is what the pool's earlier periods left unspent, chained:
///   max(0, available - used) of the period before. Nothing carries across plans (a ledger is one plan's).</item>
/// <item><b>Used</b> = claimed + pending; <b>Forecast</b> = used + booked ahead.</item>
/// <item><b>Status</b>, the worst that applies: Over (used above available, so a period with nothing available and anything used is over), Forecast over, Approaching (used at or above
///   the percentage of available), else On track.</item>
/// <item><b>Placement.</b> A date outside the plan is "Outside the plan dates". Categories 1 to 4 go to a Core (flexible) pool (the one under the item's management type when the plan
///   holds two, else the first); any other category goes to the stated pool of that category. No such pool is "Not in a recorded pool". The period is the one holding the service date, ends included.</item>
/// </list>
/// </summary>
public static class BudgetLedgerCalculator
{
    /// <summary>
    /// The plan the figures are about: the one whose dates include <paramref name="today"/>; with none, the latest plan that has started. Null when no plan has started (an upcoming plan is
    /// not a current one: there is nothing to spend against yet).
    /// </summary>
    public static FundingPlan? CurrentPlanOf(IEnumerable<FundingPlan> plans, DateOnly today)
    {
        var started = plans.Where(p => p.PlanStart <= today).ToList();
        return started.FirstOrDefault(p => today <= p.PlanEnd) ?? started.OrderByDescending(p => p.PlanStart).FirstOrDefault();
    }

    /// <summary>
    /// The worst status that applies. Money is compared exactly (decimals, and the percentage as used x 100 against percent x available, so 80% of $8,000 is $6,400 to the cent): no rounding
    /// decides a status. A period with nothing available and anything used is Over; nothing available and nothing used is On track until something is booked against it.
    /// </summary>
    public static BudgetStatus StatusOf(decimal available, decimal used, decimal forecast, int approachingPercent)
    {
        if (used > available) return BudgetStatus.Over;
        if (forecast > available) return BudgetStatus.ForecastOver;
        if (available > 0 && used * 100m >= approachingPercent * available) return BudgetStatus.Approaching;
        return BudgetStatus.OnTrack;
    }

    /// <summary>The pool an item of this category and management type belongs to in the plan, or null when the plan records none.</summary>
    public static FundingPool? PoolFor(FundingPlan plan, int? paceCategory, PlanType planType)
    {
        if (paceCategory is not { } category) return null;
        var core = PaceCategories.Find(category)?.InCoreFlexiblePool == true;
        var candidates = plan.Pools
            .Where(pool => core ? pool.Kind == FundingPoolKind.CoreFlexible : pool.Kind == FundingPoolKind.Stated && pool.PaceCategory == category)
            .OrderBy(pool => pool.Position)
            .ToList();
        return candidates.FirstOrDefault(pool => pool.ManagementType == planType) ?? candidates.FirstOrDefault();
    }

    public static LedgerPlace Place(FundingPlan plan, LedgerItem item)
    {
        if (item.Date < plan.PlanStart || item.Date > plan.PlanEnd) return new LedgerPlace(LedgerPlacement.OutsideThePlan, null, null);
        var pool = PoolFor(plan, item.PaceCategory, item.PlanType);
        if (pool is null) return new LedgerPlace(LedgerPlacement.NotInAPool, null, null);
        var period = pool.Periods.OrderBy(p => p.PeriodStart).FirstOrDefault(p => p.PeriodStart <= item.Date && item.Date <= p.PeriodEnd);
        return period is null ? new LedgerPlace(LedgerPlacement.OutsideThePlan, pool, null) : new LedgerPlace(LedgerPlacement.InPeriod, pool, period);
    }

    public static PlanLedger Compute(FundingPlan plan, DateOnly today, int approachingPercent, IEnumerable<LedgerItem> items)
    {
        var byPeriod = new Dictionary<FundingPeriod, List<LedgerItem>>(ReferenceEqualityComparer.Instance);
        var notInAPool = new List<LedgerItem>();
        var outside = new List<LedgerItem>();
        foreach (var item in items)
        {
            var place = Place(plan, item);
            switch (place.Placement)
            {
                case LedgerPlacement.InPeriod:
                    if (!byPeriod.TryGetValue(place.Period!, out var held)) byPeriod[place.Period!] = held = new List<LedgerItem>();
                    held.Add(item);
                    break;
                case LedgerPlacement.NotInAPool: notInAPool.Add(item); break;
                default: outside.Add(item); break;
            }
        }

        var pools = plan.Pools.OrderBy(pool => pool.Position).ThenBy(pool => pool.Id).Select(pool => PoolOf(pool, today, approachingPercent, byPeriod)).ToList();
        return new PlanLedger(plan, today, plan.PlanStart <= today && today <= plan.PlanEnd, pools, Ordered(notInAPool), Ordered(outside));
    }

    private static PoolLedger PoolOf(FundingPool pool, DateOnly today, int approachingPercent, Dictionary<FundingPeriod, List<LedgerItem>> byPeriod)
    {
        var hasSetAside = pool.Periods.Any(p => p.SetAside is not null);
        var periods = new List<PeriodLedger>();
        var carried = 0m;
        foreach (var period in pool.Periods.OrderBy(p => p.PeriodStart))
        {
            var held = Ordered(byPeriod.TryGetValue(period, out var list) ? list : new List<LedgerItem>());
            var limit = hasSetAside ? period.SetAside ?? period.PlanAmount : period.PlanAmount;
            var claimed = held.Where(i => i.Group == LedgerGroup.Claimed).Sum(i => i.Amount);
            var pending = held.Where(i => i.Group == LedgerGroup.Pending).Sum(i => i.Amount);
            var booked = held.Where(i => i.Group == LedgerGroup.BookedAhead).Sum(i => i.Amount);
            var available = limit + carried;
            var used = claimed + pending;
            periods.Add(new PeriodLedger(
                period, period.PeriodStart <= today && today <= period.PeriodEnd, limit, carried, claimed, pending, booked, held.Count(i => i.Kind == LedgerRowKind.PastShift),
                StatusOf(available, used, used + booked, approachingPercent), held));
            carried = Math.Max(0m, available - used);   // what this period leaves unspent rolls into the next, and chains
        }

        var totalLimit = periods.Sum(p => p.Limit);
        var totalClaimed = periods.Sum(p => p.Claimed);
        var totalPending = periods.Sum(p => p.Pending);
        var totalBooked = periods.Sum(p => p.BookedAhead);
        var total = new PoolTotals(
            totalLimit, totalClaimed, totalPending, totalBooked, periods.Sum(p => p.PastUnresolvedCount),
            StatusOf(totalLimit, totalClaimed + totalPending, totalClaimed + totalPending + totalBooked, approachingPercent));
        return new PoolLedger(pool, hasSetAside, periods, total);
    }

    /// <summary>The order every list of rows is shown in, whatever order the records were loaded in: claimed, then pending, then booked ahead; by date; then by what it is.</summary>
    public static IReadOnlyList<LedgerItem> Ordered(IEnumerable<LedgerItem> items) =>
        items.OrderBy(i => i.Group).ThenBy(i => i.Date).ThenBy(i => i.Kind).ThenBy(i => i.Description, StringComparer.Ordinal).ThenBy(i => i.Id).ToList();
}
