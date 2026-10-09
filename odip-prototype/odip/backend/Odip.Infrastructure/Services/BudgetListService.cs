using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The Budgets list (budget phase 2b): every active participant's pools for the funding period running now, from ONE call to the ledger for the whole organisation (a fixed number of queries
/// however many participants there are). It adds nothing of its own: a row is the ledger's figures for the pool's current period, and the order is the only decision made here.
///
/// A participant has rows when their current plan is running. A row also carries the NDIA's own word when it has refused a claim of the pool for want of funds (the same signal as the alerts and the
/// Funding tab, read for the whole organisation in a fixed number of queries), and ranks straight after Over. An NDIS-funded participant without one is listed apart as having no budget in force (nothing was recorded, or the plan has ended):
/// there is no figure for them and nothing ever warns about them. A participant whose funding is not the NDIS has no plan budget to record, so they are never listed as missing one.
/// Archived participants and drafts are left out, exactly as the participant alerts' aggregate leaves them out, so the dashboard's count and this list say the same thing.
/// </summary>
public sealed class BudgetListService
{
    private readonly OdipDbContext _db;
    private readonly BudgetLedgerService _ledger;
    private readonly NdiaRejectionReader _ndia;
    private readonly TimeProvider _clock;

    public BudgetListService(OdipDbContext db, BudgetLedgerService ledger, NdiaRejectionReader ndia, TimeProvider? clock = null)
    {
        _db = db;
        _ledger = ledger;
        _ndia = ndia;
        _clock = clock ?? TimeProvider.System;
    }

    public async Task<BudgetListDto> GetAsync(Guid tenantId, CancellationToken ct)
    {
        var people = await _db.Participants.AsNoTracking()
            .Where(p => p.TenantId == tenantId && p.IsActive && !p.IsDraft)
            .Select(p => new { p.Id, p.FundingSource })
            .ToListAsync(ct);
        var ledgers = await _ledger.ComputeAsync(tenantId, people.Select(p => p.Id).ToList(), ct);
        if (ledgers.Count == 0)
        {
            var approaching = await _db.BudgetSettings.AsNoTracking().Where(s => s.TenantId == tenantId).Select(s => (int?)s.ApproachingPercent).FirstOrDefaultAsync(ct) ?? BudgetSettings.DefaultApproachingPercent;
            return new BudgetListDto { AsOf = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct), ApproachingPercent = approaching };
        }

        // The NDIA's word on the pools of the plans running now, in a fixed number of queries whatever the number of participants (every ledger carries the same provider's today).
        var running = ledgers.Values.Where(l => l.Ledger is { PlanIsCurrent: true }).ToDictionary(l => l.ParticipantId, l => l.Ledger!.Plan);
        var ndia = await _ndia.ReadAsync(tenantId, running, ledgers.Values.First().Today, ct);

        var funding = people.ToDictionary(p => p.Id, p => p.FundingSource);
        var rows = new List<(BudgetListRowDto Row, int PoolPosition)>();
        var noBudget = new List<BudgetListNoBudgetDto>();
        foreach (var (participantId, ledger) in ledgers)
        {
            var added = 0;
            var plan = ledger.Ledger;
            if (plan is { PlanIsCurrent: true })
            {
                var severalCorePools = plan.Pools.Count(p => p.Pool.Kind == FundingPoolKind.CoreFlexible) > 1;
                foreach (var pool in plan.Pools)
                {
                    if (pool.Periods.FirstOrDefault(p => p.IsCurrent) is not { } period) continue;
                    rows.Add((new BudgetListRowDto
                    {
                        ParticipantId = participantId, ParticipantName = ledger.Name, PoolId = pool.Pool.Id, PoolName = BudgetText.PoolLabel(pool.Pool, severalCorePools), Kind = pool.Pool.Kind,
                        ManagementType = pool.Pool.ManagementType, PeriodStart = period.Period.PeriodStart, PeriodEnd = period.Period.PeriodEnd, Available = period.Available, Carried = period.Carried,
                        Used = period.Used, Remaining = period.Available - period.Used, BookedAhead = period.BookedAhead, Forecast = period.Forecast, Status = period.Status,
                        UnpricedShiftCount = period.UnpricedShiftCount, NdiaRejection = NdiaWordOn(ndia, participantId, pool.Pool.Id),
                    }, pool.Pool.Position));
                    added++;
                }
            }

            if (added == 0 && funding[participantId] == ParticipantFundingSource.Ndis)
                noBudget.Add(new BudgetListNoBudgetDto
                {
                    ParticipantId = participantId, ParticipantName = ledger.Name,
                    Reason = plan is { PlanIsCurrent: false } ? BudgetListNoBudgetReason.PlanEnded : BudgetListNoBudgetReason.NotRecorded,
                    PlanEnd = plan is { PlanIsCurrent: false } ? plan.Plan.PlanEnd : null,
                });
        }

        var first = ledgers.Values.First();
        return new BudgetListDto
        {
            AsOf = first.Today, ApproachingPercent = first.ApproachingPercent,
            Rows = rows.OrderBy(r => Rank(r.Row.Status, r.Row.NdiaRejection is not null)).ThenBy(r => r.Row.ParticipantName, StringComparer.OrdinalIgnoreCase).ThenBy(r => r.Row.ParticipantId).ThenBy(r => r.PoolPosition).Select(r => r.Row).ToList(),
            NoBudget = noBudget.OrderBy(n => n.ParticipantName, StringComparer.OrdinalIgnoreCase).ThenBy(n => n.ParticipantId).ToList(),
        };
    }

    /// <summary>The NDIA's word on one pool of one participant's plan, in the Funding tab's own shape; null when it has none.</summary>
    private static NdiaRejectionDto? NdiaWordOn(IReadOnlyDictionary<Guid, IReadOnlyDictionary<Guid, PoolNdiaRejection>> ndia, Guid participantId, Guid poolId) =>
        ndia.TryGetValue(participantId, out var pools) && pools.TryGetValue(poolId, out var note)
            ? new NdiaRejectionDto { Date = note.Date, Code = note.Code, ClaimId = note.ClaimId, ClaimReference = note.ClaimReference }
            : null;

    /// <summary>
    /// The order of risk: Over first, then a pool the NDIA has refused a claim of for want of funds (its word is as Critical as Over, whatever ODIP's arithmetic says, and a list that buried it under On
    /// track would be silent about the one case the feature exists to catch), then Forecast over, then Approaching, then On track.
    /// </summary>
    private static int Rank(BudgetStatus status, bool refusedByNdia) => status switch
    {
        BudgetStatus.Over => 0,
        _ when refusedByNdia => 1,
        BudgetStatus.ForecastOver => 2,
        BudgetStatus.Approaching => 3,
        BudgetStatus.OnTrack => 4,
        _ => 5,
    };
}
