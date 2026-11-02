using Microsoft.EntityFrameworkCore;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>A shift (or an agreement occurrence that has no shift yet) to read travel for: its id, and the pattern it came from. Either may be null; a hand-made shift has no pattern.</summary>
public sealed record ShiftRef(Guid? ShiftId, Guid? ShiftPatternId);

/// <summary>What the organisation allows and the rows travel is priced from: its own switch, its kilometre rate, and the kilometre ("_799_") rows of the catalogue.</summary>
public sealed record ShiftTravelPolicy(bool OrgClaims, decimal KmRate, IReadOnlyList<SupportCatalogueItem> TravelRows);

/// <summary>
/// Where the claim, the budget ledger and the roster estimate read a shift's travel from (travel plan D5): once the worker's completion is submitted, the legs they recorded (zero legs if they recorded none: no
/// fallback to the forecast); until then the agreement block's forecast; a hand-made future shift forecasts none. Only an ACTIVE, SUBMITTED completion counts (a returned one is history, an unsubmitted one is a
/// draft). Money: every query filters on the caller's organisation by hand (F-10), so a crafted id never reads another organisation's completion, pattern or agreement draft.
/// </summary>
public static class ShiftTravelSource
{
    public static async Task<ShiftTravelPolicy> PolicyAsync(OdipDbContext db, Guid tenantId, CancellationToken ct)
    {
        var settings = await db.PlanPricingSettings.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
        var policy = PlanPricingPolicy.From(settings);
        var rows = policy.ClaimProviderTravel
            ? await db.SupportCatalogueItems.AsNoTracking()
                .Where(i => i.ActivityGroup.GroupCode == CatalogueGroups.ProviderTravelGroupCode && i.Unit == "E" && i.ItemNumber.Contains(ShiftTravelPricer.KmItemMarker)).ToListAsync(ct)
            : new List<SupportCatalogueItem>();
        return new ShiftTravelPolicy(policy.ClaimProviderTravel, policy.KmRateStandard, rows);
    }

    /// <summary>The travel of each shift, in the order asked; null when the organisation does not claim travel or the shift has none to claim. A shift with a submitted completion always has an entry, however empty.</summary>
    public static async Task<IReadOnlyList<ShiftTravelInput?>> ForShiftsAsync(OdipDbContext db, Guid tenantId, ShiftTravelPolicy policy, IReadOnlyList<ShiftRef> refs, CancellationToken ct)
    {
        if (!policy.OrgClaims || refs.Count == 0) return refs.Select(_ => (ShiftTravelInput?)null).ToList();

        var shiftIds = refs.Where(r => r.ShiftId is not null).Select(r => r.ShiftId!.Value).Distinct().ToList();
        var actuals = shiftIds.Count == 0
            ? new Dictionary<Guid, ShiftCompletionTravel>()
            : (await db.ShiftCompletions.AsNoTracking()
                .Where(c => c.TenantId == tenantId && shiftIds.Contains(c.ShiftId) && c.IsActive && c.SubmittedAt != null)
                .Select(c => new ShiftCompletionTravel(c.ShiftId, c.PreShiftTravelMinutes, c.PreShiftTravelKilometres, c.PostShiftTravelMinutes, c.PostShiftTravelKilometres)).ToListAsync(ct))
                .GroupBy(c => c.ShiftId).ToDictionary(g => g.Key, g => g.First());

        var patternIds = refs.Where(r => r.ShiftPatternId is not null).Select(r => r.ShiftPatternId!.Value).Distinct().ToList();
        var (blocks, agreementIds) = await BlocksAsync(db, tenantId, patternIds, ct);

        return refs.Select(r =>
        {
            blocks.TryGetValue(r.ShiftPatternId ?? Guid.Empty, out var block);
            var named = agreementIds.Contains(r.ShiftPatternId ?? Guid.Empty);   // only an agreement pattern is gated by its block; one whose block cannot be read claims nothing, never everything
            if (r.ShiftId is { } id && actuals.TryGetValue(id, out var actual))
            {
                var travel = block?.Travel;
                return new ShiftTravelInput(
                    new TravelLeg(actual.PreMinutes ?? 0, actual.PreKm ?? 0m), new TravelLeg(actual.PostMinutes ?? 0, actual.PostKm ?? 0m),
                    named ? block?.Location : null, SharingOf(block), !named || travel is { Claim: true }, !named || travel is { ReturnToBase: true });
            }
            if (block?.Travel is not { Claim: true } forecast) return null;
            var leg = new TravelLeg(forecast.MinutesEachWay, forecast.KmEachWay);
            return new ShiftTravelInput(leg, forecast.ReturnToBase ? leg : new TravelLeg(0, 0m), block.Location, SharingOf(block), true, forecast.ReturnToBase);
        }).ToList();
    }

    private static int SharingOf(PlanBlock? block) => block is null ? 1 : Math.Max(1, block.Travel?.ParticipantsSharing ?? block.ParticipantsPresent);

    /// <summary>The agreement block each pattern was made from, read only through the caller's own patterns and drafts.</summary>
    private static async Task<(Dictionary<Guid, PlanBlock> Blocks, HashSet<Guid> AgreementIds)> BlocksAsync(OdipDbContext db, Guid tenantId, List<Guid> patternIds, CancellationToken ct)
    {
        var result = new Dictionary<Guid, PlanBlock>();
        if (patternIds.Count == 0) return (result, new HashSet<Guid>());

        var patterns = await db.ShiftPatterns.AsNoTracking()
            .Where(p => p.TenantId == tenantId && patternIds.Contains(p.Id))
            .Select(p => new { p.Id, p.SourceDraftId, p.SourceBlockKey }).ToListAsync(ct);
        var agreementIds = patterns.Where(p => p.SourceDraftId != null).Select(p => p.Id).ToHashSet();
        var agreement = patterns.Where(p => p.SourceDraftId != null && p.SourceBlockKey != null).Select(p => new { p.Id, DraftId = p.SourceDraftId!.Value, Key = p.SourceBlockKey! }).ToList();
        if (agreement.Count == 0) return (result, agreementIds);

        var draftIds = agreement.Select(p => p.DraftId).Distinct().ToList();
        var json = await (from b in db.ServiceAgreementDraftBlocks.AsNoTracking()
                          join d in db.ServiceAgreementDrafts.AsNoTracking() on b.DraftId equals d.Id
                          where d.TenantId == tenantId && draftIds.Contains(d.Id)
                          select new { b.DraftId, b.BlockKey, b.BlockJson }).ToListAsync(ct);
        var byKey = json.GroupBy(b => (b.DraftId, b.BlockKey)).ToDictionary(g => g.Key, g => g.First().BlockJson);
        foreach (var p in agreement)
        {
            if (!byKey.TryGetValue((p.DraftId, p.Key), out var text)) continue;
            try { result[p.Id] = DraftJson.ReadBlock(text); }
            catch (System.Text.Json.JsonException) { /* an unreadable block claims nothing */ }
        }
        return (result, agreementIds);
    }

    private sealed record ShiftCompletionTravel(Guid ShiftId, int? PreMinutes, decimal? PreKm, int? PostMinutes, decimal? PostKm);
}
