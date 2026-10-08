using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Services;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>One shift to be priced: when it is, how long, and the support it gives. Plain data, so a source of prices needs no entity.</summary>
public sealed record ShiftSpec(DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, bool EndsNextDay, SupportRatio Ratio, SleepoverType NightType);

/// <summary>What a shift is estimated to cost, or why it cannot be: nothing is ever invented for a shift the estimator cannot price.</summary>
public abstract record ShiftCostEstimate
{
    /// <summary>Priced the way ODIP will claim it, in dollars, with the PACE category it is billed under (null when the row carries none).</summary>
    public sealed record Priced(decimal Amount, int? PaceCategory) : ShiftCostEstimate;

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
        var communityAccess = (await _ledger.CatalogueQuery(Array.Empty<Guid>(), Array.Empty<string>()).ToListAsync(ct))
            .Where(row => row.GroupCode == CatalogueGroups.CommunityAccessGroupCode).Select(row => row.Item).ToList();

        var from = shifts.Min(s => s.ServiceDate);
        var to = shifts.Max(s => s.ServiceDate);
        var holidayRows = await _db.PublicHolidays.AsNoTracking().Where(h => h.Date >= from && h.Date <= to).Select(h => new { h.Date, h.State }).ToListAsync(ct);
        var holidays = new HolidayCalendar(holidayRows.Select(h => (h.Date, h.State)));
        var state = ShiftPriceEstimator.StateFor(person.AddressState, providerState);

        return shifts.Select(shift =>
        {
            var hours = Shift.HoursBetween(shift.StartTime, shift.EndTime, shift.EndsNextDay);
            var price = ShiftPriceEstimator.Price(communityAccess, shift.ServiceDate, hours, person.IsIntensiveSupport, state, holidays.For(state));
            return price is null
                ? (ShiftCostEstimate)new ShiftCostEstimate.NotPriced(string.Create(CultureInfo.InvariantCulture, $"no catalogue rate covers {shift.ServiceDate:d MMM yyyy}"))
                : new ShiftCostEstimate.Priced(price.TotalAmount, PaceCategories.Of(price.CatalogueItem));
        }).ToList();
    }
}

/// <summary>
/// One shift to check. <paramref name="TargetStatus"/> is the status it would be saved with (null: the shift's own, or a new Draft); <paramref name="RequestedPatternId"/> is the pattern the request names, which
/// counts only for a new shift and only when it is a pattern of this participant. <paramref name="CallerIsAdmin"/> is an Admin or SuperAdmin.
/// </summary>
public sealed record ShiftBudgetRequest(
    Guid TenantId, Guid ParticipantId, Guid? ExistingShiftId, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, bool EndsNextDay, SupportRatio Ratio, SleepoverType NightType,
    ShiftStatus? TargetStatus, Guid? RequestedPatternId, bool CallerIsAdmin);

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
/// <item><b>One-off</b> is judged from the saved shift's pattern link; a new shift counts as routine only if the pattern it names is a pattern of this participant. A request cannot dodge the limit by naming one.</item>
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

    private sealed record Saved(Guid ParticipantId, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, bool EndsNextDay, SupportRatio Ratio, SleepoverType NightType, ShiftStatus Status, Guid? ShiftPatternId);

    public async Task<ShiftBudgetOutcome> CheckAsync(ShiftBudgetRequest request, CancellationToken ct)
    {
        var saved = request.ExistingShiftId is { } id
            ? await _db.Shifts.AsNoTracking().Where(s => s.TenantId == request.TenantId && s.Id == id)
                .Select(s => new Saved(s.ParticipantId, s.ServiceDate, s.StartTime, s.EndTime, s.EndsNextDay, s.Ratio, s.NightType, s.Status, s.ShiftPatternId)).FirstOrDefaultAsync(ct)
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
        var specs = new List<ShiftSpec> { new(request.ServiceDate, request.StartTime, request.EndTime, request.EndsNextDay, request.Ratio, request.NightType) };
        if (oldCounts) specs.Add(new ShiftSpec(saved!.ServiceDate, saved.StartTime, saved.EndTime, saved.EndsNextDay, saved.Ratio, saved.NightType));
        var estimates = await _costs.EstimateAsync(request.TenantId, request.ParticipantId, specs, ct);

        // A shift the estimator cannot price has no cost to check: no finding, never blocked, and the line says so.
        if (estimates[0] is not ShiftCostEstimate.Priced priced) return new ShiftBudgetOutcome(Array.Empty<RosterFinding>(), ((ShiftCostEstimate.NotPriced)estimates[0]).Reason);

        var planType = await _db.Participants.AsNoTracking().Where(p => p.TenantId == request.TenantId && p.Id == request.ParticipantId).Select(p => p.PlanType).FirstAsync(ct);
        var newItem = ItemFor(request.ServiceDate, priced, planType, request.ExistingShiftId, target, participantLedger.Today);
        var place = BudgetLedgerCalculator.Place(plan, newItem);
        if (place.Placement != LedgerPlacement.InPeriod) return ShiftBudgetOutcome.Quiet;   // no recorded pool, or outside the plan's dates: nothing to check against

        // What the saved version already put into THIS pool and period (an unpriced saved version put nothing the new one can be measured against).
        var oldInPlace = 0m;
        if (oldCounts && estimates[1] is ShiftCostEstimate.Priced oldPriced)
        {
            var oldPlace = BudgetLedgerCalculator.Place(plan, ItemFor(saved!.ServiceDate, oldPriced, planType, request.ExistingShiftId, saved.Status, participantLedger.Today));
            if (oldPlace.Placement == LedgerPlacement.InPeriod && oldPlace.Pool!.Id == place.Pool!.Id && oldPlace.Period!.Id == place.Period!.Id) oldInPlace = oldPriced.Amount;
        }
        var raises = priced.Amount > oldInPlace;

        // The ledger with the change: the saved version's own item out (the ledger priced it, whatever the estimate above says), the new one in.
        var without = participantLedger.Items.Where(i => request.ExistingShiftId is null || i.ShiftId != request.ExistingShiftId).ToList();
        var after = BudgetLedgerCalculator.Compute(plan, participantLedger.Today, participantLedger.ApproachingPercent, without.Append(newItem));
        var period = after.Pools.First(p => p.Pool.Id == place.Pool!.Id).Periods.First(p => p.Period.Id == place.Period!.Id);
        var figures = new BudgetFindingFigures(place.Pool!.Name, period.Period.PeriodStart, period.Period.PeriodEnd, period.Available, period.Used, period.Forecast, priced.Amount);

        var mode = await _db.BudgetSettings.AsNoTracking().Where(b => b.TenantId == request.TenantId).Select(b => (BudgetLimitMode?)b.Mode).FirstOrDefaultAsync(ct) ?? BudgetSettings.DefaultMode;
        var oneOff = !await IsRoutineAsync(request, saved?.ShiftPatternId, ct);
        var findings = ShiftBudgetAssessor.Assess(figures, new ShiftBudgetContext(mode, participantLedger.ApproachingPercent, oneOff, raises, request.CallerIsAdmin));
        return new ShiftBudgetOutcome(findings);
    }

    /// <summary>Made from a pattern: the saved shift's own link when it exists (the roster panel never sends one), else the one a new shift names; either must be a pattern of this participant.</summary>
    private async Task<bool> IsRoutineAsync(ShiftBudgetRequest request, Guid? savedPatternId, CancellationToken ct)
    {
        var patternId = request.ExistingShiftId is not null ? savedPatternId : request.RequestedPatternId;
        return patternId is { } pattern && await _db.ShiftPatterns.AsNoTracking().AnyAsync(p => p.Id == pattern && p.ParticipantId == request.ParticipantId, ct);
    }

    /// <summary>The ledger item a shift is, as <see cref="BudgetLedgerService"/> would make it: booked ahead from today, or pending once its day has passed unresolved.</summary>
    private static LedgerItem ItemFor(DateOnly date, ShiftCostEstimate.Priced price, PlanType planType, Guid? shiftId, ShiftStatus status, DateOnly today)
    {
        var past = date < today;
        return new LedgerItem
        {
            Kind = past ? LedgerRowKind.PastShift : LedgerRowKind.FutureShift, Group = past ? LedgerGroup.Pending : LedgerGroup.BookedAhead, Date = date, Amount = price.Amount,
            PaceCategory = price.PaceCategory, PlanType = planType, Id = shiftId ?? Guid.Empty, ShiftId = shiftId, Description = "This shift", Status = status.ToString(),
        };
    }
}
