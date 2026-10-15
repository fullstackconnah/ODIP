using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// The NDIA's "the funds ran out" signal (budget phase 2b): the claims it refused with V17, V18, V27 or V28, placed on the pools of the participant's current plan. A provider cannot see a
/// participant's budget in the NDIA portal, so such a rejection is the only direct sign that a pool is empty; it feeds the <c>budget-ndia-exhausted</c> alert and the note on the Funding tab.
///
/// A rejection is placed the way the ledger places everything: each line of the claim lands on a pool and a funding period by the service date of the line and the PACE category of the catalogue
/// item valid on that day (<see cref="BudgetLedgerCalculator.Place"/>, the one rule), so a claim that spans two pools signals both. It is ACTIVE for a pool until the story that caused it moves on:
/// <list type="bullet">
/// <item>the funding period its lines belong to has ended (a later period has started, with its own money), so only a rejection for the period running now is active;</item>
/// <item>or a new plan has been recorded: a plan record made AFTER the rejection ends it, and so does a plan that no longer holds the lines' dates (the new plan took over).</item>
/// </list>
/// A line that fits no recorded pool, or is dated outside the plan, signals nothing: there is no pool to say it about.
///
/// Tenancy and cost: TripClaim and ClaimLineItem have no tenant column, so claims are reached only through the shifts and bookings of the participants it is asked about, and a shift or trip of
/// another organisation is refused by its own tenant column as well. The reads are a fixed number of queries however many participants are asked about.
/// </summary>
public sealed class NdiaRejectionReader
{
    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public NdiaRejectionReader(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>One line of a claim the NDIA refused for want of funds, with what it takes to place it on a pool.</summary>
    public sealed record RejectedLineRow(
        Guid ClaimId, string ClaimReference, string Code, DateTime RejectedDate, string ItemCode, DateOnly Date, Guid ParticipantId, PlanType ParticipantPlanType, PlanType? BookingPlanType);

    /// <summary>
    /// The lines of claims that are Rejected with one of the four funds codes, reached through the given participants' shifts and trip bookings (and only those, inside the tenant). A query of its own
    /// so that a test can show it translates to SQL (EF InMemory would evaluate any LINQ in memory).
    /// </summary>
    public IQueryable<RejectedLineRow> RejectedLinesQuery(Guid tenantId, IReadOnlyCollection<Guid> participantIds) =>
        _db.ClaimLineItems.AsNoTracking()
            .Where(l => l.TripClaim.Status == TripClaimStatus.Rejected && l.TripClaim.RejectedDate != null
                && l.TripClaim.RejectionCode != null && NdiaRejectionCodes.NotEnoughFunds.Contains(l.TripClaim.RejectionCode)
                && ((l.Shift != null && l.Shift.TenantId == tenantId && participantIds.Contains(l.Shift.ParticipantId))
                    || (l.ParticipantBooking != null && l.ParticipantBooking.TripInstance.TenantId == tenantId && participantIds.Contains(l.ParticipantBooking.ParticipantId))))
            .Select(l => new RejectedLineRow(
                l.TripClaimId, l.TripClaim.ClaimReference, l.TripClaim.RejectionCode!, l.TripClaim.RejectedDate!.Value, l.SupportItemCode, l.SupportsDeliveredFrom,
                l.Shift != null ? l.Shift.ParticipantId : l.ParticipantBooking!.ParticipantId,
                l.Shift != null ? l.Shift.Participant!.PlanType : l.ParticipantBooking!.Participant!.PlanType,
                l.ParticipantBooking != null ? l.ParticipantBooking.PlanTypeOverride : null));

    /// <summary>
    /// The active signal of each pool of ONE participant's current plan, by pool id: the Funding tab's note. Empty when the participant is not in the organisation, has no plan that has started, or
    /// their plan is not running.
    /// </summary>
    public async Task<IReadOnlyDictionary<Guid, PoolNdiaRejection>> ForParticipantAsync(Guid tenantId, Guid participantId, CancellationToken ct)
    {
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        var plans = await _db.FundingPlans.AsNoTracking()
            .Include(p => p.Pools).ThenInclude(p => p.Periods)
            .AsSplitQuery()
            .Where(p => p.TenantId == tenantId && p.ParticipantId == participantId)
            .ToListAsync(ct);
        var current = BudgetLedgerCalculator.CurrentPlanOf(plans, today);
        if (current is null || today > current.PlanEnd) return new Dictionary<Guid, PoolNdiaRejection>();

        var found = await ReadAsync(tenantId, new Dictionary<Guid, FundingPlan> { [participantId] = current }, today, ct);
        return found.TryGetValue(participantId, out var pools) ? pools : new Dictionary<Guid, PoolNdiaRejection>();
    }

    /// <summary>
    /// The active signal of each pool of each given plan, by participant and then pool: for the alerts of every participant at once, in a fixed number of queries. <paramref name="currentPlans"/> holds
    /// each participant's plan that is running on <paramref name="today"/> (the provider's calendar day), with its pools and periods loaded; a participant with no active signal is absent.
    /// </summary>
    public async Task<IReadOnlyDictionary<Guid, IReadOnlyDictionary<Guid, PoolNdiaRejection>>> ReadAsync(
        Guid tenantId, IReadOnlyDictionary<Guid, FundingPlan> currentPlans, DateOnly today, CancellationToken ct)
    {
        var result = new Dictionary<Guid, IReadOnlyDictionary<Guid, PoolNdiaRejection>>();
        if (currentPlans.Count == 0) return result;

        var ids = currentPlans.Keys.ToList();
        var rows = await RejectedLinesQuery(tenantId, ids).ToListAsync(ct);
        if (rows.Count == 0) return result;

        var codes = rows.Select(r => r.ItemCode).Distinct().ToList();
        var catalogue = (await _db.SupportCatalogueItems.AsNoTracking().Where(i => codes.Contains(i.ItemNumber)).ToListAsync(ct))
            .GroupBy(i => i.ItemNumber, StringComparer.Ordinal)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.Ordinal);
        var state = await _db.ProviderSettings.AsNoTracking().Where(s => s.TenantId == tenantId).Select(s => s.State).FirstOrDefaultAsync(ct);
        var zone = ProviderTimeZoneResolver.FromState(state).Zone;

        var latest = new Dictionary<(Guid Participant, Guid Pool), (PoolNdiaRejection Rejection, DateTime At)>();
        foreach (var row in rows)
        {
            var plan = currentPlans[row.ParticipantId];

            // A plan recorded after the rejection is a new plan: whatever the NDIA said was about the money of the plan as it stood.
            if (row.RejectedDate < plan.CreatedAt) continue;

            var item = new LedgerItem
            {
                Kind = LedgerRowKind.ClaimLine, Group = LedgerGroup.Claimed, Date = row.Date, Amount = 0m, PaceCategory = CategoryOf(catalogue, row.ItemCode, row.Date),
                PlanType = row.BookingPlanType ?? row.ParticipantPlanType,
            };
            var place = BudgetLedgerCalculator.Place(plan, item);
            if (place.Placement != LedgerPlacement.InPeriod) continue;

            // Only the funding period running now: a later one, with its own money, has begun once this one has ended.
            if (today < place.Period!.PeriodStart || today > place.Period.PeriodEnd) continue;

            var at = DateTime.SpecifyKind(row.RejectedDate, DateTimeKind.Utc);
            var key = (row.ParticipantId, place.Pool!.Id);
            if (latest.TryGetValue(key, out var held) && (held.At > at || (held.At == at && string.CompareOrdinal(held.Rejection.ClaimReference, row.ClaimReference) >= 0))) continue;
            latest[key] = (new PoolNdiaRejection(place.Pool.Id, row.ClaimId, row.ClaimReference, ProviderLocalTime.TodayIn(at, zone), row.Code), at);
        }

        foreach (var group in latest.GroupBy(kv => kv.Key.Participant))
            result[group.Key] = group.ToDictionary(kv => kv.Key.Pool, kv => kv.Value.Rejection);
        return result;
    }

    /// <summary>The PACE category of the catalogue row a claim line's item code names on its service date: the row valid that day (the newest version when two overlap), else none (the ledger's own rule).</summary>
    private static int? CategoryOf(Dictionary<string, List<SupportCatalogueItem>> catalogue, string itemCode, DateOnly date)
    {
        if (!catalogue.TryGetValue(itemCode, out var rows)) return null;
        var row = rows.Where(r => EffectiveCatalogueResolver.IsValidOn(r, date))
            .OrderByDescending(r => r.EffectiveFrom).ThenByDescending(r => r.IsActive).ThenBy(r => r.Id).FirstOrDefault();
        return row is null ? null : PaceCategories.Of(row);
    }
}
