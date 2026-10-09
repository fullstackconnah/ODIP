using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>A shift that is about to be made, or has just been: when it is, how long, and the support it gives. <see cref="ShiftId"/> is set for a shift already saved, so the ledger's own copy of it is not counted twice.</summary>
public sealed record PlannedShift(Guid? ShiftId, DateOnly ServiceDate, TimeOnly StartTime, TimeOnly EndTime, bool EndsNextDay, SupportRatio Ratio, SleepoverType NightType)
{
    public static PlannedShift Of(Shift shift) => new(shift.Id, shift.ServiceDate, shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.Ratio, shift.NightType);
}

/// <summary>
/// What a batch of shifts, or one confirmed trip booking, does to a participant's budget (budget phase 3), as warnings: for each pool and funding period the action puts money into, whether the forecast with it
/// is above what is available. Never a reason to refuse anything, in any mode: the shifts are made and the booking is confirmed whatever this says.
/// <list type="bullet">
/// <item><b>Shifts</b> are priced by the one estimator (<see cref="IShiftCostSource"/>) and counted into the participant's ledger as booked ahead (or pending once their day has passed), exactly as the ledger would count them
///   once saved; those already saved are taken out of the ledger first, so the same call works before a save (the approval's preview) and after one (Generate, the daily top-up).</item>
/// <item><b>A booking</b> is already in the ledger once it is confirmed (its trip priced the way the trip claim will be), so its effect is read from the ledger as it stands.</item>
/// </list>
/// A shift the estimator cannot price adds nothing and says nothing; a participant with no plan that has started, a shift outside the plan's dates or in no recorded pool, and a period the action adds nothing
/// to, are all absent from the answer. The answer for a participant who is not in the organisation is empty.
/// </summary>
public sealed class ShiftBudgetEffect
{
    private readonly BudgetLedgerService _ledger;
    private readonly IShiftCostSource _costs;
    private readonly OdipDbContext _db;

    public ShiftBudgetEffect(OdipDbContext db, BudgetLedgerService ledger, IShiftCostSource? costs = null)
    {
        _db = db;
        _ledger = ledger;
        _costs = costs ?? new LedgerShiftCostSource(db, ledger);
    }

    public async Task<List<BudgetWarningDto>> ForShiftsAsync(Guid tenantId, Guid participantId, IReadOnlyList<PlannedShift> planned, CancellationToken ct)
    {
        if (planned.Count == 0) return new List<BudgetWarningDto>();

        var ledgers = await _ledger.ComputeAsync(tenantId, new[] { participantId }, ct);
        if (!ledgers.TryGetValue(participantId, out var participantLedger) || participantLedger.Ledger is null) return new List<BudgetWarningDto>();
        var plan = participantLedger.Ledger.Plan;

        var estimates = await _costs.EstimateAsync(tenantId, participantId, planned.Select(p => new ShiftSpec(p.ServiceDate, p.StartTime, p.EndTime, p.EndsNextDay, p.Ratio, p.NightType)).ToList(), ct);
        var planType = await _db.Participants.AsNoTracking().Where(p => p.TenantId == tenantId && p.Id == participantId).Select(p => p.PlanType).FirstAsync(ct);

        var added = new List<LedgerItem>();
        for (var i = 0; i < planned.Count; i++)
        {
            if (estimates[i] is not ShiftCostEstimate.Priced priced) continue;   // nothing to count, nothing to say
            var past = planned[i].ServiceDate < participantLedger.Today;
            added.Add(new LedgerItem
            {
                Kind = past ? LedgerRowKind.PastShift : LedgerRowKind.FutureShift, Group = past ? LedgerGroup.Pending : LedgerGroup.BookedAhead, Date = planned[i].ServiceDate, Amount = priced.Amount,
                PaceCategory = priced.PaceCategory, PlanType = planType, Id = planned[i].ShiftId ?? Guid.Empty, ShiftId = planned[i].ShiftId, Description = "A new shift", Status = ShiftStatus.Draft.ToString(),
            });
        }
        if (added.Count == 0) return new List<BudgetWarningDto>();

        var saved = planned.Where(p => p.ShiftId is not null).Select(p => p.ShiftId!.Value).ToHashSet();
        var without = participantLedger.Items.Where(i => i.ShiftId is not { } id || !saved.Contains(id));
        var after = BudgetLedgerCalculator.Compute(plan, participantLedger.Today, participantLedger.ApproachingPercent, without.Concat(added));
        return Warnings(plan, after, added, "shift");
    }

    public async Task<List<BudgetWarningDto>> ForBookingAsync(Guid tenantId, Guid participantId, Guid bookingId, CancellationToken ct)
    {
        var ledgers = await _ledger.ComputeAsync(tenantId, new[] { participantId }, ct);
        if (!ledgers.TryGetValue(participantId, out var participantLedger) || participantLedger.Ledger is null) return new List<BudgetWarningDto>();

        var items = participantLedger.Items.Where(i => i.BookingId == bookingId).ToList();
        if (items.Count == 0) return new List<BudgetWarningDto>();
        // The bulk confirm of several bookings lists their warnings together, so each says whose pool it is.
        return Warnings(participantLedger.Ledger.Plan, participantLedger.Ledger, items, "booking").Select(w => w with { ParticipantName = participantLedger.Name }).ToList();
    }

    /// <summary>One warning for each pool and period that <paramref name="added"/> put money into and the forecast of which is now above what is available.</summary>
    private static List<BudgetWarningDto> Warnings(FundingPlan plan, PlanLedger ledger, IReadOnlyList<LedgerItem> added, string noun)
    {
        var warnings = new List<(BudgetWarningDto Warning, int PoolPosition)>();
        foreach (var group in added.Select(i => (Item: i, Place: BudgetLedgerCalculator.Place(plan, i))).Where(x => x.Place.Placement == LedgerPlacement.InPeriod)
                     .GroupBy(x => (Pool: x.Place.Pool!.Id, Period: x.Place.Period!.Id)))
        {
            var cost = group.Sum(x => x.Item.Amount);
            var count = group.Select(x => x.Item.ShiftId ?? x.Item.BookingId ?? Guid.NewGuid()).Distinct().Count();
            if (cost <= 0m) continue;   // it added no money here (an unpriced booking): nothing to warn about

            var period = ledger.Pools.First(p => p.Pool.Id == group.Key.Pool).Periods.First(p => p.Period.Id == group.Key.Period);
            if (period.Forecast <= period.Available) continue;

            var pool = group.First().Place.Pool!;
            var figures = new BudgetFindingFigures(pool.Name, period.Period.PeriodStart, period.Period.PeriodEnd, period.Available, period.Used, period.Forecast, cost);
            var subject = count == 1 ? $"This {noun} takes" : string.Create(CultureInfo.InvariantCulture, $"These {count} {noun}s take");
            warnings.Add((new BudgetWarningDto
            {
                PoolName = pool.Name, PeriodStart = figures.PeriodStart, PeriodEnd = figures.PeriodEnd, Available = figures.Available, Used = figures.Used, Forecast = figures.Forecast, Added = cost,
                OverBy = figures.OverBy, Count = count,
                Message = $"{subject} {pool.Name} to {ShiftBudgetAssessor.Money(figures.Forecast)} of {ShiftBudgetAssessor.Money(figures.Available)} for {ShiftBudgetAssessor.Period(figures)}, {ShiftBudgetAssessor.Money(figures.OverBy)} over.",
            }, pool.Position));
        }

        return warnings.OrderBy(w => w.PoolPosition).ThenBy(w => w.Warning.PeriodStart).Select(w => w.Warning).ToList();
    }
}
