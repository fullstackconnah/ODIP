using System.Globalization;
using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>The outcome of a check: the answer, or every reason it was refused (400), or that the participant or the draft is not the caller's (404).</summary>
public sealed record AgreementCheckResult(AgreementCheckDto? Check, IReadOnlyList<string> Errors, string? NotFoundMessage = null)
{
    public static AgreementCheckResult Answer(AgreementCheckDto check) => new(check, Array.Empty<string>());
    public static AgreementCheckResult Refused(params string[] errors) => new(null, errors);
    public static AgreementCheckResult Missing(string message) => new(null, Array.Empty<string>(), message);
}

/// <summary>
/// The agreement budget bar's check (budget phase 2b). The agreement is priced IN PROCESS by the plan pricing engine through <see cref="PlanPricingService"/> (the same engine, catalogue, holidays and
/// the organisation's own settings as the plan builder's quote; no HTTP call to itself), and every priced line is placed on a pool and a funding period of the participant's current plan with the
/// ledger's own rule, <see cref="BudgetLedgerCalculator.Place"/>: the period is the line's service date, the pool is found by the PACE category of the item the engine priced it with and by how the
/// participant's money is managed. For each pool and period the agreement touches the answer is {agreement cost, available, used, remaining = available - used, over by}: each period's limit and
/// used are the ledger's, and what carries from one period to the next is the ledger's own rule with the agreement taken off as it goes (<see cref="AgreementCarry"/>), so a later period never
/// counts money the same agreement spends in an earlier one. With no agreement in the earlier periods the available is the ledger's own figure.
///
/// A question, not a gate: nothing is written, and nothing in the answer blocks a save or an approval. With no plan running now there is nothing to compare with, and the answer is just that (the
/// agreement is not even priced). What no recorded pool covers and what falls outside the plan's dates are shown as sums of their own, never dropped. Tenancy: the participant, and the draft when
/// one is named, are read inside the tenant, so another organisation's id is "not found".
/// </summary>
public sealed class AgreementCheckService
{
    private readonly OdipDbContext _db;
    private readonly PlanPricingService _pricing;
    private readonly BudgetLedgerService _ledger;

    public AgreementCheckService(OdipDbContext db, PlanPricingService pricing, BudgetLedgerService ledger)
    {
        _db = db;
        _pricing = pricing;
        _ledger = ledger;
    }

    public async Task<AgreementCheckResult> CheckAsync(Guid tenantId, Guid participantId, AgreementCheckRequestDto request, CancellationToken ct)
    {
        var person = await _db.Participants.AsNoTracking().Where(p => p.Id == participantId && p.TenantId == tenantId).Select(p => new { p.PlanType }).FirstOrDefaultAsync(ct);
        if (person is null) return AgreementCheckResult.Missing(FundingPlanService.ParticipantNotFound);

        // What to price: a saved draft's own blocks and dates, or the blocks and dates sent. Exactly one of the two.
        IReadOnlyList<PlanBlock> blocks;
        DateOnly from, to;
        if (request.DraftId is { } draftId)
        {
            if (request.Blocks is not null || request.PeriodFrom is not null || request.PeriodTo is not null)
                return AgreementCheckResult.Refused("Send either the id of a saved draft or the blocks with the agreement dates, not both.");

            var draft = await _db.ServiceAgreementDrafts.AsNoTracking().Include(d => d.Blocks)
                .FirstOrDefaultAsync(d => d.Id == draftId && d.ParticipantId == participantId && d.TenantId == tenantId, ct);
            if (draft is null) return AgreementCheckResult.Missing("That draft was not found for this participant.");

            blocks = draft.Blocks.OrderBy(b => b.Position).Select(b => DraftJson.ReadBlock(b.BlockJson)).ToList();
            (from, to) = (draft.AgreementStartDate, draft.AgreementEndDate);
        }
        else
        {
            if (request.Blocks is null || request.PeriodFrom is null || request.PeriodTo is null)
                return AgreementCheckResult.Refused("Send the draft's blocks with the agreement's first and last day, or the id of a saved draft.");

            blocks = request.Blocks;
            (from, to) = (request.PeriodFrom.Value, request.PeriodTo.Value);
        }

        if (from > to) return AgreementCheckResult.Refused("The agreement period ends before it starts.");
        if (from.Year < PlanPricingEngine.FirstYear || to.Year > PlanPricingEngine.LastYear)
            return AgreementCheckResult.Refused(string.Create(CultureInfo.InvariantCulture, $"The agreement period must fall between the years {PlanPricingEngine.FirstYear} and {PlanPricingEngine.LastYear}."));
        if (to.DayNumber - from.DayNumber + 1 > PlanPricingEngine.MaxPeriodDays)
            return AgreementCheckResult.Refused(string.Create(CultureInfo.InvariantCulture, $"The agreement period is longer than {PlanPricingEngine.MaxPeriodDays} days."));
        if (blocks.Count > PlanPricingEngine.MaxBlocks)
            return AgreementCheckResult.Refused(string.Create(CultureInfo.InvariantCulture, $"An agreement check prices at most {PlanPricingEngine.MaxBlocks} blocks."));

        var ledgers = await _ledger.ComputeAsync(tenantId, new[] { participantId }, ct);
        var ledger = ledgers[participantId];
        if (ledger.Ledger is not { PlanIsCurrent: true } plan)
        {
            // The same two reasons as the Budgets list: no plan that has started is recorded, or the one there is has ended.
            var ended = ledger.Ledger is { PlanIsCurrent: false } endedPlan ? endedPlan.Plan : null;
            return AgreementCheckResult.Answer(new AgreementCheckDto
            {
                HasBudget = false, AsOf = ledger.Today, PeriodFrom = from, PeriodTo = to,
                NoBudgetReason = ended is null ? BudgetListNoBudgetReason.NotRecorded : BudgetListNoBudgetReason.PlanEnded, PlanEnd = ended?.PlanEnd,
            });
        }

        var quote = await _pricing.QuoteAsync(tenantId, blocks, from, to, ct);

        // Each priced line goes where the ledger would put it. A line with no price contributes nothing (the bar already says the agreement is not fully priced).
        var byPeriod = new Dictionary<Guid, decimal>();
        decimal total = 0m, notInAPool = 0m, outside = 0m;
        foreach (var line in quote.Lines.Where(l => l.IsPriced && l.Total > 0m))
        {
            total += line.Total;
            var place = BudgetLedgerCalculator.Place(plan.Plan, new LedgerItem
            {
                Kind = LedgerRowKind.FutureShift, Group = LedgerGroup.BookedAhead, Date = line.ServiceDate, Amount = line.Total, PaceCategory = line.PaceCategory, PlanType = person.PlanType,
            });
            switch (place.Placement)
            {
                case LedgerPlacement.InPeriod: byPeriod[place.Period!.Id] = byPeriod.GetValueOrDefault(place.Period.Id) + line.Total; break;
                case LedgerPlacement.NotInAPool: notInAPool += line.Total; break;
                default: outside += line.Total; break;
            }
        }

        var severalCorePools = plan.Pools.Count(p => p.Pool.Kind == FundingPoolKind.CoreFlexible) > 1;
        var pools = new List<AgreementCheckPoolDto>();
        foreach (var pool in plan.Pools)
        {
            if (!pool.Periods.Any(p => byPeriod.ContainsKey(p.Period.Id))) continue;

            // Walk ALL the pool's periods in date order, the ones the agreement does not touch too: their unspent money carries on, and what the agreement spends in an earlier period is not there
            // for a later one (AgreementCarry). Only the periods the agreement touches are answered.
            var ordered = pool.Periods.OrderBy(p => p.Period.PeriodStart).ToList();
            var walk = AgreementCarry.Walk(ordered[0].Carried, ordered.Select(p => new AgreementCarry.PeriodInput(p.Limit, p.Used, byPeriod.GetValueOrDefault(p.Period.Id))).ToList());
            var periods = new List<AgreementCheckPeriodDto>();
            for (var i = 0; i < ordered.Count; i++)
            {
                var p = ordered[i];
                if (!byPeriod.TryGetValue(p.Period.Id, out var cost)) continue;
                periods.Add(new AgreementCheckPeriodDto
                {
                    PeriodId = p.Period.Id, PeriodStart = p.Period.PeriodStart, PeriodEnd = p.Period.PeriodEnd, IsCurrent = p.IsCurrent, AgreementCost = cost,
                    Available = walk[i].Available, Used = p.Used, Remaining = walk[i].Remaining, OverBy = walk[i].OverBy,
                });
            }

            pools.Add(new AgreementCheckPoolDto
            {
                PoolId = pool.Pool.Id, PoolName = BudgetText.PoolLabel(pool.Pool, severalCorePools), Kind = pool.Pool.Kind, ManagementType = pool.Pool.ManagementType,
                AgreementCost = periods.Sum(p => p.AgreementCost), Over = periods.Any(p => p.OverBy > 0m), OverBy = periods.Sum(p => p.OverBy), Periods = periods,
            });
        }

        return AgreementCheckResult.Answer(new AgreementCheckDto
        {
            HasBudget = true, PlanId = plan.Plan.Id, PlanStart = plan.Plan.PlanStart, PlanEnd = plan.Plan.PlanEnd, AsOf = ledger.Today, PeriodFrom = from, PeriodTo = to,
            AgreementCost = total, Pools = pools, NotInARecordedPool = notInAPool, OutsideThePlan = outside,
        });
    }
}
