using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

/// <summary>
/// Generates draft "Kind == Shift" <see cref="TripClaim"/>s from Completed, unclaimed
/// <see cref="Shift"/>s for one participant over a date range (shift-completion design spec
/// §2/§3, delivery PR 3). Deliberately a separate file from <see cref="ClaimGenerationService"/>
/// — the trip path carries <c>ClaimPreviewRequestDto</c> overrides for departure/return/
/// active-hours that have no shift equivalent, and mixing the two would force every trip call
/// site to reason about shift-only parameters.
///
/// Billing is against ROSTERED hours (<see cref="Shift.DurationHours"/>), never
/// <c>ShiftCompletion</c>'s clocked times — the office already accepted any variance at
/// Approve time, so re-deriving hours here would silently relitigate that decision.
///
/// TripClaim/ClaimLineItem are NOT ITenantEntity (standing ruling) — every query here is scoped
/// through the tenant-filtered Participants/Shifts sets, never queried directly by a caller-
/// supplied id alone.
/// </summary>
public class ShiftClaimGenerationService
{
    private readonly OdipDbContext _db;
    private readonly BudgetLedgerService? _ledger;
    private readonly ICurrentTenant? _tenant;

    /// <param name="ledger">When given, a preview says what the claim does to the participant's budget (a warning only: nothing here is ever blocked by it).</param>
    public ShiftClaimGenerationService(OdipDbContext db, BudgetLedgerService? ledger = null, ICurrentTenant? tenant = null)
    {
        _db = db;
        _ledger = ledger;
        _tenant = tenant;
    }

    /// <summary>The caller's own tenant, and only when the participant belongs to it — see <see cref="ClaimGenerationService"/>.</summary>
    private Guid? MoneyTenantIdFor(Guid recordTenantId) =>
        _tenant?.TenantId is { } tenantId && tenantId == recordTenantId ? tenantId : null;

    public async Task<ShiftClaimPreviewResponseDto> PreviewAsync(
        Guid participantId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        var (lineItems, participant) = await CalculateAsync(participantId, from, to, ct);

        // The budget effect is worked out from the same lines the claim would have: each is the shift it replaces in the participant's "pending" (a completed shift nobody has claimed is already counted).
        // Under the CALLER's tenant, never the participant's own: a SuperAdmin with no organisation chosen resolves other organisations'
        // participants, and the participant's own id would hand out their whole funding position (budget security audit F-1).
        var moneyTenantId = MoneyTenantIdFor(participant.TenantId);
        var budget = _ledger == null || moneyTenantId is not { } forMoney
            ? null
            : await _ledger.EffectOfLinesAsync(
                forMoney,
                lineItems.Select(l => new ClaimEffectLine(participant.Id, l.Shift.ServiceDate, PaceCategories.Of(l.CatalogueItem), participant.PlanType, l.TotalAmount, ShiftId: l.Shift.Id, BookingId: null)).ToList(),
                ct);

        return new ShiftClaimPreviewResponseDto
        {
            Budget = budget,
            TotalAmount = lineItems.Sum(l => l.TotalAmount),
            LineItems = lineItems.Select(l => new ShiftClaimPreviewLineItemDto
            {
                ShiftId = l.Shift.Id,
                ServiceDate = l.Shift.ServiceDate,
                DayTypeLabel = l.DayType.ToString(),
                DayType = l.DayType,
                SupportItemCode = l.CatalogueItem.ItemNumber,
                Hours = l.Hours,
                UnitPrice = l.UnitPrice,
                TotalAmount = l.TotalAmount
            }).ToList()
        };
    }

    public async Task<TripClaim> GenerateDraftClaimAsync(
        Guid participantId, DateOnly from, DateOnly to, CancellationToken ct = default)
    {
        var (lineItems, participant) = await CalculateAsync(participantId, from, to, ct);

        var settings = await _db.ProviderSettings.FirstOrDefaultAsync(ct)
            ?? throw new InvalidOperationException("Provider settings are not configured.");

        var gstCode = settings.GSTRegistered ? GSTCode.P1 : GSTCode.P2;

        var claim = new TripClaim
        {
            Id = Guid.NewGuid(),
            Kind = ClaimKind.Shift,
            ParticipantId = participantId,
            PeriodFrom = from,
            PeriodTo = to,
            Status = TripClaimStatus.Draft,
            ClaimReference = BuildClaimReference(participant),
            CreatedAt = DateTime.UtcNow
        };
        _db.TripClaims.Add(claim);

        var claimLineItems = lineItems.Select(l => new ClaimLineItem
        {
            Id = Guid.NewGuid(),
            TripClaimId = claim.Id,
            ShiftId = l.Shift.Id,
            ParticipantBookingId = null,
            SupportItemCode = l.CatalogueItem.ItemNumber,
            DayType = l.DayType,
            SupportsDeliveredFrom = l.Shift.ServiceDate,
            SupportsDeliveredTo = l.Shift.ServiceDate,
            Hours = l.Hours,
            UnitPrice = l.UnitPrice,
            TotalAmount = l.TotalAmount,
            GSTCode = gstCode,
            ClaimType = ClaimType.Standard,
            Status = ClaimLineItemStatus.Draft
        }).ToList();

        _db.ClaimLineItems.AddRange(claimLineItems);
        claim.TotalAmount = claimLineItems.Sum(l => l.TotalAmount);

        await _db.SaveChangesAsync(ct);
        return claim;
    }

    // ─── Shared calculation ──────────────────────────────────────────────

    private async Task<(List<ShiftLineCalc> LineItems, Participant Participant)> CalculateAsync(
        Guid participantId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        // Participants is ITenantEntity-filtered — a participantId that doesn't resolve under
        // the caller's tenant (including one that belongs to a different tenant entirely)
        // surfaces identically to "no such participant", never a different code path.
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == participantId, ct)
            ?? throw new InvalidOperationException("Participant not found.");

        // Shifts is ITenantEntity-filtered too, so this is inherently tenant-scoped. Completed +
        // not yet claimed (no ClaimLineItem references this ShiftId), mirroring TripInstance's
        // "no active claim already exists" check in ClaimGenerationService.GenerateDraftClaimAsync
        // but at the line-item level, since a date range spans many independent shifts.
        var shifts = await _db.Shifts
            .Where(s => s.ParticipantId == participantId
                && s.Status == ShiftStatus.Completed
                && s.ServiceDate >= from && s.ServiceDate <= to
                && !_db.ClaimLineItems.Any(l => l.ShiftId == s.Id))
            .OrderBy(s => s.ServiceDate)
            .ToListAsync(ct);

        if (shifts.Count == 0)
            throw new InvalidOperationException("No completed, unclaimed shifts found in this date range.");

        // Participant.AddressState with a fallback to ProviderSettings.State — the only
        // geographic signal that exists on the tenant today (Region is free-text prose).
        // ShiftPriceEstimator.StateFor normalises the case, so "Nsw" prices in NSW's column
        // and finds NSW's holidays here exactly as the budget ledger's estimate does
        // (one rule for both, so the claim and the estimate cannot drift apart).
        var providerState = string.IsNullOrWhiteSpace(participant.AddressState) ? (await _db.ProviderSettings.FirstOrDefaultAsync(ct))?.State : null;
        var state = ShiftPriceEstimator.StateFor(participant.AddressState, providerState);

        // HolidayCalendar.For normalises the state's case too, so the holiday rows match however
        // they are written ("NSW", "nsw", or with spaces around them). The query keeps the same
        // clause as the engines have always used; the state it compares against is already the
        // normalised one, and a row written in another case is normalised in memory by
        // HolidayCalendar further down.
        var publicHolidays = (await _db.PublicHolidays
            .Where(h => h.Date >= from && h.Date <= to && (h.State == null || h.State == state))
            .Select(h => h.Date)
            .ToListAsync(ct))
            .ToHashSet();

        // Only the community access group is priced from here. It is the only group that existed when this engine picked "the first active item for the
        // day type", and the catalogue now also holds personal care, sleepover, STA, travel and every other family: an item of those must never be
        // "the first Weekday item" (ClaimGenerationService is already scoped to one group). GRP_COMMUNITY_ACCESS holds exactly the RG 0125 standard
        // and ICBS items, one valid row per day type and intensity on any date.
        // Every row of the group is loaded, history included, because each shift is priced by the row valid on ITS service date: an import that
        // end-dates a row (a December price set) must not reprice a shift that happened before it and has not been claimed yet.
        var catalogueItems = await _db.SupportCatalogueItems
            .Where(i => i.ActivityGroup.GroupCode == CatalogueGroups.CommunityAccessGroupCode)
            .ToListAsync(ct);

        var lineItems = new List<ShiftLineCalc>();
        foreach (var shift in shifts)
        {
            // The one pricing rule, shared with the budget ledger so an estimate is exactly what this claim will say.
            var price = ShiftPriceEstimator.Price(catalogueItems, shift.ServiceDate, shift.DurationHours, participant.IsIntensiveSupport, state, publicHolidays);
            if (price == null) continue;

            lineItems.Add(new ShiftLineCalc
            {
                Shift = shift,
                CatalogueItem = price.CatalogueItem,
                DayType = price.DayType,
                Hours = price.Hours,
                UnitPrice = price.UnitPrice,
                TotalAmount = price.TotalAmount
            });
        }

        if (lineItems.Count == 0)
        {
            // Nothing priced because no row of the group is valid on any of these dates (the catalogue starts after them): say so, the same way the trip engine does.
            // Shifts that have a row for their date but not for their day type still read as nothing to claim, as they always did.
            if (!shifts.Any(s => catalogueItems.Any(i => EffectiveCatalogueResolver.IsValidOn(i, s.ServiceDate))))
                throw new InvalidOperationException(FormattableString.Invariant(
                    $"No catalogue row covers these shifts' dates ({shifts[0].ServiceDate:dd/MM/yyyy} to {shifts[^1].ServiceDate:dd/MM/yyyy}). Import the catalogue for that period first."));
            throw new InvalidOperationException("No completed, unclaimed shifts found in this date range.");
        }

        return (lineItems, participant);
    }

    // ─── Helpers ─

    private static string BuildClaimReference(Participant participant)
    {
        var code = !string.IsNullOrWhiteSpace(participant.NdisNumber)
            ? participant.NdisNumber
            : participant.Id.ToString("N")[..8].ToUpper();
        var date = DateTime.UtcNow.ToString("yyyyMMdd");
        var raw = $"TC-{code}-{date}";
        return raw.Length > 50 ? raw[..50] : raw;
    }

    private class ShiftLineCalc
    {
        public Shift Shift { get; set; } = null!;
        public SupportCatalogueItem CatalogueItem { get; set; } = null!;
        public ClaimDayType DayType { get; set; }
        public decimal Hours { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal TotalAmount { get; set; }
    }
}
