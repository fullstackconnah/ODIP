using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>One shift to be priced: when it is, how long, and the support it gives. Plain data, so a source of prices needs no entity.</summary>
public sealed record ShiftSpec(DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, bool EndsNextDay, SupportRatio Ratio, SleepoverType NightType, string? SupportGroupCode = null);

/// <summary>What a shift is estimated to cost, or why it cannot be: nothing is ever invented for a shift the estimator cannot price.</summary>
public abstract record ShiftCostEstimate
{
    /// <summary>Priced the way ODIP will claim it: the shift's parts, one for each date and PACE category it is billed under (<see cref="ShiftPriceEstimator.PartsOf"/>), which sum to <see cref="Amount"/>.</summary>
    public sealed record Priced(IReadOnlyList<ShiftCostPart> Parts) : ShiftCostEstimate
    {
        public decimal Amount => Parts.Sum(p => p.Amount);
    }

    /// <summary>The estimator cannot price this shift. <see cref="Reason"/> reads after "Budget not checked:" so it starts in lower case and has no full stop.</summary>
    public sealed record NotPriced(string Reason) : ShiftCostEstimate;
}

/// <summary>
/// Where the budget check gets the price of a shift: the ONE seam to the shift estimator, so the check never prices a shift a second way and a shift the estimator cannot price (it returns
/// <see cref="ShiftCostEstimate.NotPriced"/>) is never checked, never blocked. Everything about one participant in one call, so the catalogue and the holidays are read once however many shifts are asked about.
/// </summary>
public interface IShiftCostSource
{
    /// <returns>One estimate for each of <paramref name="shifts"/>, in the same order.</returns>
    Task<IReadOnlyList<ShiftCostEstimate>> EstimateAsync(Guid tenantId, Guid participantId, IReadOnlyList<ShiftSpec> shifts, CancellationToken ct);
}

/// <summary>
/// The shift estimator as the ledger and the shift claim engine run it (<see cref="ShiftPriceEstimator"/>): the community access row valid on the service date for the day type and the participant's intensity,
/// at the price for the participant's own state (else the organisation's), for the rostered hours. A shift no row covers is <see cref="ShiftCostEstimate.NotPriced"/>, not $0.
/// </summary>
public sealed class LedgerShiftCostSource : IShiftCostSource
{
    private readonly OdipDbContext _db;
    private readonly BudgetLedgerService _ledger;

    public LedgerShiftCostSource(OdipDbContext db, BudgetLedgerService ledger)
    {
        _db = db;
        _ledger = ledger;
    }

    public async Task<IReadOnlyList<ShiftCostEstimate>> EstimateAsync(Guid tenantId, Guid participantId, IReadOnlyList<ShiftSpec> shifts, CancellationToken ct)
    {
        if (shifts.Count == 0) return Array.Empty<ShiftCostEstimate>();

        var person = await _db.Participants.AsNoTracking().Where(p => p.TenantId == tenantId && p.Id == participantId)
            .Select(p => new { p.IsIntensiveSupport, p.AddressState }).FirstOrDefaultAsync(ct);
        if (person is null) return shifts.Select(_ => (ShiftCostEstimate)new ShiftCostEstimate.NotPriced("the participant was not found")).ToList();

        var providerState = await _db.ProviderSettings.AsNoTracking().Where(s => s.TenantId == tenantId).Select(s => s.State).FirstOrDefaultAsync(ct);
        // Each shift is priced from its own support type's rows (community access when it has none), as the claim and the ledger price it.
        var groupCodes = shifts.Select(s => s.SupportGroupCode ?? CatalogueGroups.CommunityAccessGroupCode).Distinct().ToList();
        // Night hours of a group with no night row take the personal care night row, and a sleepover is the flat sleepover item.
        groupCodes.AddRange(new[] { CatalogueGroups.PersonalCareGroupCode, CatalogueGroups.SleepoverGroupCode });
        var catalogue = await _ledger.CatalogueQuery(Array.Empty<Guid>(), Array.Empty<string>(), groupCodes).ToListAsync(ct);
        var rowsByGroup = catalogue.GroupBy(row => row.GroupCode).ToDictionary(g => g.Key, g => g.Select(row => row.Item).Where(i => i.Unit == "H").ToList());
        var sleepoverRows = catalogue.Where(row => row.GroupCode == CatalogueGroups.SleepoverGroupCode && row.Item.Unit == "E").Select(row => row.Item).ToList();
        var personalCareRows = rowsByGroup.GetValueOrDefault(CatalogueGroups.PersonalCareGroupCode) ?? new List<SupportCatalogueItem>();
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct)).Zone;

        var from = shifts.Min(s => s.ServiceDate);
        var to = shifts.Max(s => s.ServiceDate);
        // The one holiday loader the quote, both claim engines and the ledger read through, so a day the override table makes a holiday is priced here as the ledger prices it.
        // A shift on the last day runs past midnight into the next, so the holidays are read one day further.
        var holidays = PublicHolidayLoader.WholeDayCalendarOf(await PublicHolidayLoader.LoadAsync(_db, from, to.AddDays(1), includePartDay: false, ct));
        var state = ShiftPriceEstimator.StateFor(person.AddressState, providerState);

        return shifts.Select(shift =>
        {
            var groupRows = rowsByGroup.GetValueOrDefault(shift.SupportGroupCode ?? CatalogueGroups.CommunityAccessGroupCode) ?? new List<SupportCatalogueItem>();
            var outcome = ShiftPriceEstimator.Price(new ShiftRateRows(groupRows, personalCareRows, sleepoverRows), shift.SupportGroupCode, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.Ratio, shift.NightType,
                person.IsIntensiveSupport, state, holidays.For(state), zone);
            return outcome.IsPriced
                ? (ShiftCostEstimate)new ShiftCostEstimate.Priced(ShiftPriceEstimator.PartsOf(outcome))
                : new ShiftCostEstimate.NotPriced(outcome.NotPricedBecause ?? "the estimator has no price for it");
        }).ToList();
    }
}

/// <summary>
/// One shift to check. <paramref name="TargetStatus"/> is the status it would be saved with (null: the shift's own, or a new Draft). <paramref name="CallerIsAdmin"/> is an Admin or SuperAdmin. There is no
/// pattern link on the request: only a link the SERVER set on a saved shift counts (the phase 3 review, C3).
/// </summary>
public sealed record ShiftBudgetRequest(
    Guid TenantId, Guid ParticipantId, Guid? ExistingShiftId, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, bool EndsNextDay, SupportRatio Ratio, SleepoverType NightType,
    ShiftStatus? TargetStatus, bool CallerIsAdmin, string? SupportGroupCode = null);

/// <summary>A shift of an import batch whose budget period is over once the whole batch is counted: the pool, how far over the period would be, whether it was over before the batch, and what the batch adds to it.</summary>
public sealed record BudgetOver(string PoolName, decimal OverBy, bool AlreadyOver, decimal Added);

/// <summary>What the check found: the findings (none when the participant has no plan, the pool cannot be mapped, or the shift cannot be priced) and, when it could not price, why.</summary>
public sealed record ShiftBudgetOutcome(IReadOnlyList<RosterFinding> Findings, string? NotCheckedReason = null)
{
    public static readonly ShiftBudgetOutcome Quiet = new(Array.Empty<RosterFinding>());

    /// <summary>The informational line for a shift that was not checked: "Budget not checked: sleepover shifts are not priced yet." Not a finding: it blocks nothing and is never stored.</summary>
    public string? Note => NotCheckedReason is null ? null : $"Budget not checked: {NotCheckedReason.TrimEnd('.')}.";
}

/// <summary>
/// The budget check of one shift on the roster (budget phase 3): the participant's ledger as it is, with this shift counted in (a new shift) or its old cost replaced by its new one (an edit), and the rules of
/// <see cref="ShiftBudgetAssessor"/> over the pool and period it lands in.
/// <list type="bullet">
/// <item><b>Quiet</b> (no finding, never blocked) when: the participant has no plan that has started; the shift lands in no recorded pool or outside the plan's dates; the estimator cannot price it; it is being
///   cancelled; or it has already started or finished. Delivered work, claims and agreements are never touched by this.</item>
/// <item><b>Raises</b> is judged in the shift's own pool and period: the new cost against what the old version already put there. Moving a shift into a tighter period raises that period, which is what stops
///   a hard limit being walked round by creating a shift in a free period and moving it.</item>
/// <item><b>One-off</b> is judged from the saved shift's pattern link, the one the server set when it generated the shift; a new shift has none, and a link a request names is never read. A request cannot dodge the limit by naming one.</item>
/// </list>
/// The ledger and the estimator are called, never reimplemented: the figures are the ledger's, the price is the estimator's.
/// </summary>
public sealed class ShiftBudgetCheck
{
    private readonly OdipDbContext _db;
    private readonly BudgetLedgerService _ledger;
    private readonly IShiftCostSource _costs;

    public ShiftBudgetCheck(OdipDbContext db, BudgetLedgerService ledger, IShiftCostSource? costs = null)
    {
        _db = db;
        _ledger = ledger;
        _costs = costs ?? new LedgerShiftCostSource(db, ledger);
    }

    private sealed record Saved(Guid ParticipantId, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, bool EndsNextDay, SupportRatio Ratio, SleepoverType NightType, ShiftStatus Status, Guid? ShiftPatternId, string? SupportGroupCode);

    public async Task<ShiftBudgetOutcome> CheckAsync(ShiftBudgetRequest request, CancellationToken ct)
    {
        var saved = request.ExistingShiftId is { } id
            ? await _db.Shifts.AsNoTracking().Where(s => s.TenantId == request.TenantId && s.Id == id)
                .Select(s => new Saved(s.ParticipantId, s.ServiceDate, s.StartTime, s.EndTime, s.EndsNextDay, s.Ratio, s.NightType, s.Status, s.ShiftPatternId, s.SupportGroupCode)).FirstOrDefaultAsync(ct)
            : null;

        // Never blocked, in any mode: a shift on its way to Cancelled costs nothing, and one that has started or finished is delivered work.
        var target = request.TargetStatus ?? saved?.Status ?? ShiftStatus.Draft;
        if (target is ShiftStatus.Cancelled or ShiftStatus.InProgress or ShiftStatus.PendingReview or ShiftStatus.Completed) return ShiftBudgetOutcome.Quiet;
        if (saved?.Status is ShiftStatus.InProgress or ShiftStatus.PendingReview or ShiftStatus.Completed) return ShiftBudgetOutcome.Quiet;

        var ledgers = await _ledger.ComputeAsync(request.TenantId, new[] { request.ParticipantId }, ct);
        if (!ledgers.TryGetValue(request.ParticipantId, out var participantLedger) || participantLedger.Ledger is null) return ShiftBudgetOutcome.Quiet;
        var plan = participantLedger.Ledger.Plan;

        // The saved version only counts when it is this participant's and in the ledger (a Cancelled one is not).
        var oldCounts = saved is { Status: ShiftStatus.Draft or ShiftStatus.Published } s && s.ParticipantId == request.ParticipantId;
        var specs = new List<ShiftSpec> { new(request.ServiceDate, request.StartTime, request.EndTime, request.EndsNextDay, request.Ratio, request.NightType, request.SupportGroupCode) };
        if (oldCounts) specs.Add(new ShiftSpec(saved!.ServiceDate, saved.StartTime, saved.EndTime, saved.EndsNextDay, saved.Ratio, saved.NightType, saved.SupportGroupCode));
        var estimates = await _costs.EstimateAsync(request.TenantId, request.ParticipantId, specs, ct);

        // A shift the estimator cannot price has no cost to check: no finding, never blocked, and the line says so.
        if (estimates[0] is not ShiftCostEstimate.Priced priced) return new ShiftBudgetOutcome(Array.Empty<RosterFinding>(), ((ShiftCostEstimate.NotPriced)estimates[0]).Reason);

        var planType = await _db.Participants.AsNoTracking().Where(p => p.TenantId == request.TenantId && p.Id == request.ParticipantId).Select(p => p.PlanType).FirstAsync(ct);
        var newItems = ItemsFor(request.ServiceDate, priced, planType, request.ExistingShiftId, target, participantLedger.Today, "This shift");
        // The place checked is the largest part that lands in a period of a recorded pool (the first on a tie); a part outside the plan's dates is the claim's to flag, not a reason to skip the part inside them.
        var places = newItems.Select(item => BudgetLedgerCalculator.Place(plan, item)).ToList();
        var checkedAt = -1;
        for (var i = 0; i < newItems.Count; i++)
            if (places[i].Placement == LedgerPlacement.InPeriod && (checkedAt < 0 || newItems[i].Amount > newItems[checkedAt].Amount)) checkedAt = i;
        if (checkedAt < 0) return ShiftBudgetOutcome.Quiet;   // no recorded pool, or outside the plan's dates: nothing to check against
        var place = places[checkedAt];
        // This shift's cost in the checked pool and period: its parts that land there.
        var thisShift = Enumerable.Range(0, newItems.Count).Where(i => SamePlace(places[i], place)).Sum(i => newItems[i].Amount);

        // What the saved version already put into THIS pool and period (an unpriced saved version put nothing the new one can be measured against).
        var oldInPlace = 0m;
        if (oldCounts && estimates[1] is ShiftCostEstimate.Priced oldPriced)
            oldInPlace = ItemsFor(saved!.ServiceDate, oldPriced, planType, request.ExistingShiftId, saved.Status, participantLedger.Today, "This shift").Where(item => SamePlace(BudgetLedgerCalculator.Place(plan, item), place)).Sum(item => item.Amount);
        var raises = thisShift > oldInPlace;

        // The ledger with the change: the saved version's own items out (the ledger priced them, whatever the estimate above says), the new ones in.
        var without = participantLedger.Items.Where(i => request.ExistingShiftId is null || i.ShiftId != request.ExistingShiftId).ToList();
        var after = BudgetLedgerCalculator.Compute(plan, participantLedger.Today, participantLedger.ApproachingPercent, without.Concat(newItems));
        var period = after.Pools.First(p => p.Pool.Id == place.Pool!.Id).Periods.First(p => p.Period.Id == place.Period!.Id);
        // Booked ahead BEFORE this shift (its parts are booked ahead when its day is today or later), so used + booked ahead + this shift is the forecast the panel prints.
        var bookedAheadBefore = period.BookedAhead - (newItems[checkedAt].Group == LedgerGroup.BookedAhead ? thisShift : 0m);
        // Used BEFORE this shift too: a shift dated before today is Pending, so the ledger's Used already holds it. Without this the rows repeat it ("This shift" beside a Used that includes it) and "already over" can
        // read true for a period that only this shift took over (phase 3 review, N3).
        var usedBefore = period.Used - (newItems[checkedAt].Group == LedgerGroup.Pending ? thisShift : 0m);
        var figures = new BudgetFindingFigures(
            place.Pool!.Name, period.Period.PeriodStart, period.Period.PeriodEnd, period.Available, usedBefore, period.Forecast, thisShift, bookedAheadBefore, period.UnpricedShiftCount);

        var mode = await _db.BudgetSettings.AsNoTracking().Where(b => b.TenantId == request.TenantId).Select(b => (BudgetLimitMode?)b.Mode).FirstOrDefaultAsync(ct) ?? BudgetSettings.DefaultMode;
        var oneOff = !await IsRoutineAsync(request, saved?.ShiftPatternId, ct);
        var findings = ShiftBudgetAssessor.Assess(figures, new ShiftBudgetContext(mode, participantLedger.ApproachingPercent, oneOff, raises, request.CallerIsAdmin));
        return new ShiftBudgetOutcome(findings);
    }

    /// <summary>
    /// The budget side of an import, in one pass: every shift is priced in one estimator call and appended to the participant's ledger as a booked-ahead item, the ledger is computed once, and each shift whose period
    /// then forecasts over what is available gets that period's <see cref="BudgetOver"/> (null otherwise: no plan, no pool, outside the plan's dates, or the estimator cannot price it). The caller computes the ledgers
    /// once for all its participants. Same figures as <see cref="CheckAsync"/>, whose forecast it agrees with for a single shift.
    /// </summary>
    public async Task<IReadOnlyList<BudgetOver?>> ForecastOverAsync(Guid tenantId, Guid participantId, IReadOnlyList<ShiftSpec> shifts, ParticipantLedger? ledger, CancellationToken ct)
    {
        var result = new BudgetOver?[shifts.Count];
        if (shifts.Count == 0 || ledger?.Ledger is null) return result;
        var plan = ledger.Ledger.Plan;
        var estimates = await _costs.EstimateAsync(tenantId, participantId, shifts, ct);
        var planType = await _db.Participants.AsNoTracking().Where(p => p.TenantId == tenantId && p.Id == participantId).Select(p => p.PlanType).FirstAsync(ct);

        var placed = new List<(int Index, LedgerItem Item, LedgerPlace Place)>();
        for (var i = 0; i < shifts.Count; i++)
        {
            if (estimates[i] is not ShiftCostEstimate.Priced priced) continue;
            foreach (var item in ItemsFor(shifts[i].ServiceDate, priced, planType, null, ShiftStatus.Draft, ledger.Today, "This shift"))
            {
                var place = BudgetLedgerCalculator.Place(plan, item);
                if (place.Placement == LedgerPlacement.InPeriod) placed.Add((i, item, place));
            }
        }
        if (placed.Count == 0) return result;

        var after = BudgetLedgerCalculator.Compute(plan, ledger.Today, ledger.ApproachingPercent, ledger.Items.Concat(placed.Select(p => p.Item)));
        foreach (var (index, _, place) in placed)
        {
            if (result[index] is not null) continue;   // a shift is flagged by its first part that forecasts over
            var period = after.Pools.First(p => p.Pool.Id == place.Pool!.Id).Periods.First(p => p.Period.Id == place.Period!.Id);
            if (period.Forecast <= period.Available) continue;
            var added = placed.Where(p => p.Place.Period!.Id == place.Period!.Id).Sum(p => p.Item.Amount);
            result[index] = new BudgetOver(place.Pool!.Name, period.Forecast - period.Available, period.Forecast - added > period.Available, added);
        }
        return result;
    }

    /// <summary>
    /// Made from a pattern: only the saved shift's own link counts, the one the server set when it generated the shift (the roster panel never sends one, and a link a request names is dropped before it gets
    /// here). It must be a pattern of THIS participant, so a shift moved to someone else is a one-off for them.
    /// </summary>
    private async Task<bool> IsRoutineAsync(ShiftBudgetRequest request, Guid? savedPatternId, CancellationToken ct) =>
        request.ExistingShiftId is not null && savedPatternId is { } pattern
        && await _db.ShiftPatterns.AsNoTracking().AnyAsync(p => p.Id == pattern && p.ParticipantId == request.ParticipantId, ct);

    private static bool SamePlace(LedgerPlace a, LedgerPlace b) =>
        a.Placement == LedgerPlacement.InPeriod && b.Placement == LedgerPlacement.InPeriod && a.Pool!.Id == b.Pool!.Id && a.Period!.Id == b.Period!.Id;

    /// <summary>
    /// The ledger items a shift is, as <see cref="BudgetLedgerService"/> would make them: one for each part of it (date and PACE category), booked ahead from today or pending once the shift's day has passed unresolved.
    /// Kind and group come from the shift's service date; only the part's own date places it in a period. The parts share one key (the saved shift's, else one made here) so a shift counts once wherever it is counted.
    /// </summary>
    internal static List<LedgerItem> ItemsFor(DateOnly serviceDate, ShiftCostEstimate.Priced price, PlanType planType, Guid? shiftId, ShiftStatus status, DateOnly today, string description)
    {
        var past = serviceDate < today;
        var key = shiftId ?? Guid.NewGuid();
        return price.Parts.Select(part => new LedgerItem
        {
            Kind = past ? LedgerRowKind.PastShift : LedgerRowKind.FutureShift, Group = past ? LedgerGroup.Pending : LedgerGroup.BookedAhead, Date = part.Date, Amount = part.Amount,
            PaceCategory = part.PaceCategory, PlanType = planType, Id = key, ShiftId = key, Description = description, Status = status.ToString(),
        }).ToList();
    }
}
