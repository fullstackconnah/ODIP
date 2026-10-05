using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public class ClaimGenerationService
{
    private readonly OdipDbContext _db;
    private readonly BudgetLedgerService? _ledger;
    private readonly ICurrentTenant? _tenant;

    /// <param name="ledger">When given, a preview says what the claim does to each participant's budget (a warning only: nothing here is ever blocked by it).</param>
    public ClaimGenerationService(OdipDbContext db, BudgetLedgerService? ledger = null, ICurrentTenant? tenant = null)
    {
        _db = db;
        _ledger = ledger;
        _tenant = tenant;
    }

    /// <summary>
    /// The tenant a caller may be shown money for: the caller's own, and only when the trip actually belongs to it. A SuperAdmin who has
    /// not chosen an organisation to view as keeps <c>IsSuperAdmin == true</c>, which is the first term of every tenant-filtered query, so a
    /// foreign trip resolves — and the trip's own tenant id would then decide whose budgets get computed (budget security audit F-1).
    /// </summary>
    private Guid? MoneyTenantIdFor(Guid recordTenantId) =>
        _tenant?.TenantId is { } tenantId && tenantId == recordTenantId ? tenantId : null;

    // ─── Preview (no persistence, no status checks) ────────────────────

    public async Task<ClaimPreviewResponseDto> PreviewClaimAsync(
        Guid tripInstanceId, ClaimPreviewRequestDto? overrides, CancellationToken ct = default)
    {
        var (lineItems, context) = await CalculateClaimAsync(tripInstanceId, overrides, ct);

        // Each line is a part of its booking's claim: the booking stops being "booked ahead" and its lines take its place, under the participant's plan type or the booking's own.
        // Worked out under the CALLER's tenant, so a caller who has not chosen an organisation is shown no budget rather than another
        // organisation's. A null block is the honest "no figure here", not a missing feature: the preview is a warning about a budget nobody may see.
        var moneyTenantId = MoneyTenantIdFor(context.TenantId);
        var budget = _ledger == null || moneyTenantId is not { } forMoney
            ? null
            : await _ledger.EffectOfLinesAsync(
                forMoney,
                lineItems.Select(l => new ClaimEffectLine(
                    l.Booking.ParticipantId, l.From, PaceCategories.Of(l.CatalogueItem), l.Booking.PlanTypeOverride ?? l.Booking.Participant.PlanType, l.TotalAmount, ShiftId: null, BookingId: l.Booking.Id)).ToList(),
                ct);

        return new ClaimPreviewResponseDto
        {
            Budget = budget,
            DepartureTime = context.DepartureTime,
            ReturnTime = context.ReturnTime,
            ActiveHoursPerDay = context.ActiveHoursPerDay,
            StaffCount = context.StaffCount,
            State = context.State,
            ConfirmedParticipantCount = context.ConfirmedParticipantCount,
            TotalAmount = lineItems.Sum(l => l.TotalAmount),
            LineItems = lineItems.Select(l => new ClaimPreviewLineItemDto
            {
                ParticipantName = l.Booking.Participant?.FullName ?? string.Empty,
                NdisNumber = l.Booking.Participant?.NdisNumber ?? string.Empty,
                SupportItemCode = l.CatalogueItem.ItemNumber,
                DayTypeLabel = l.DayType.ToString(),
                DayType = l.DayType,
                SupportsDeliveredFrom = l.From,
                SupportsDeliveredTo = l.To,
                Hours = l.Hours,
                UnitPrice = l.UnitPrice,
                TotalAmount = l.TotalAmount
            }).ToList()
        };
    }

    // ─── Generate (persists claim, validates status) ───────────────────

    public async Task<TripClaim> GenerateDraftClaimAsync(
        Guid tripInstanceId, GenerateClaimRequestDto? overrides = null, CancellationToken ct = default)
    {
        // Convert to preview request for shared calculation
        var previewOverrides = overrides == null ? null : new ClaimPreviewRequestDto
        {
            DepartureTime = overrides.DepartureTime,
            ReturnTime = overrides.ReturnTime,
            ActiveHoursPerDay = overrides.ActiveHoursPerDay
        };

        // Load trip separately for status checks (CalculateClaimAsync also loads it, but we need it here for validation)
        var trip = await _db.TripInstances
            .Include(t => t.TripDays)
            .Include(t => t.Bookings).ThenInclude(b => b.Participant)
            .Include(t => t.StaffAssignments)
            .FirstOrDefaultAsync(t => t.Id == tripInstanceId, ct)
            ?? throw new InvalidOperationException("Trip not found.");

        if (trip.Status != TripStatus.Completed)
            throw new InvalidOperationException("Claims can only be generated for completed trips.");

        if (await _db.TripClaims.AnyAsync(c => c.TripInstanceId == tripInstanceId && c.Status != TripClaimStatus.Rejected, ct))
            throw new InvalidOperationException("An active claim already exists for this trip.");

        var (lineItems, context) = await CalculateClaimInternalAsync(trip, previewOverrides, ct);

        // A claim with no lines is never saved. The preview still returns the empty list (it shows what the engine would do), but a Draft claim with no lines and
        // a total of 0 would block the trip behind "an active claim already exists" until someone rejected it, so generating says why nothing could be built.
        if (lineItems.Count == 0)
            throw new InvalidOperationException(NoLinesReason(trip, context));

        // Persist confirmed times back to trip
        if (overrides?.DepartureTime != null) trip.DepartureTime = overrides.DepartureTime;
        if (overrides?.ReturnTime != null) trip.ReturnTime = overrides.ReturnTime;
        if (overrides?.ActiveHoursPerDay != null) trip.ActiveHoursPerDay = overrides.ActiveHoursPerDay.Value;

        var settings = await _db.ProviderSettings.FirstOrDefaultAsync(ct)
            ?? throw new InvalidOperationException("Provider settings are not configured.");

        var claimReference = BuildClaimReference(trip);
        var claim = new TripClaim
        {
            Id = Guid.NewGuid(),
            TripInstanceId = tripInstanceId,
            Status = TripClaimStatus.Draft,
            ClaimReference = claimReference,
            CreatedAt = DateTime.UtcNow
        };
        _db.TripClaims.Add(claim);

        var gstCode = settings.GSTRegistered ? GSTCode.P1 : GSTCode.P2;
        var claimLineItems = new List<ClaimLineItem>();

        foreach (var calc in lineItems)
        {
            claimLineItems.Add(new ClaimLineItem
            {
                Id = Guid.NewGuid(),
                TripClaimId = claim.Id,
                ParticipantBookingId = calc.Booking.Id,
                SupportItemCode = calc.CatalogueItem.ItemNumber,
                DayType = calc.DayType,
                SupportsDeliveredFrom = calc.From,
                SupportsDeliveredTo = calc.To,
                Hours = calc.Hours,
                UnitPrice = calc.UnitPrice,
                TotalAmount = calc.TotalAmount,
                GSTCode = calc.GSTCode,
                ClaimType = ClaimType.Standard,
                Status = ClaimLineItemStatus.Draft
            });
        }

        // Set bookings to InClaim
        var processedBookingIds = new HashSet<Guid>();
        foreach (var calc in lineItems)
        {
            if (processedBookingIds.Add(calc.Booking.Id))
                calc.Booking.ClaimStatus = ClaimStatus.InClaim;
        }

        _db.ClaimLineItems.AddRange(claimLineItems);
        claim.TotalAmount = claimLineItems.Sum(l => l.TotalAmount);

        await _db.SaveChangesAsync(ct);
        return claim;
    }

    // ─── Shared calculation engine ─────────────────────────────────────

    private async Task<(List<LineItemCalc> lineItems, ClaimCalcContext context)> CalculateClaimAsync(
        Guid tripInstanceId, ClaimPreviewRequestDto? overrides, CancellationToken ct)
    {
        var trip = await _db.TripInstances
            .Include(t => t.TripDays)
            .Include(t => t.Bookings).ThenInclude(b => b.Participant)
            .Include(t => t.StaffAssignments)
            .FirstOrDefaultAsync(t => t.Id == tripInstanceId, ct)
            ?? throw new InvalidOperationException("Trip not found.");

        return await CalculateClaimInternalAsync(trip, overrides, ct);
    }

    private async Task<(List<LineItemCalc> lineItems, ClaimCalcContext context)> CalculateClaimInternalAsync(
        TripInstance trip, ClaimPreviewRequestDto? overrides, CancellationToken ct)
    {
        var settings = await _db.ProviderSettings.FirstOrDefaultAsync(ct)
            ?? throw new InvalidOperationException("Provider settings are not configured. Please configure them in Settings before generating claims.");

        // Resolve effective parameters
        var departureTime = overrides?.DepartureTime ?? trip.DepartureTime ?? new TimeOnly(8, 0);
        var returnTime = overrides?.ReturnTime ?? trip.ReturnTime ?? new TimeOnly(18, 0);
        var activeHoursPerDay = overrides?.ActiveHoursPerDay ?? trip.ActiveHoursPerDay;
        var state = settings.State ?? "VIC";

        // Resolve activity group
        var activityGroupId = trip.DefaultActivityGroupId;
        if (activityGroupId == null)
        {
            var defaultGroup = await _db.SupportActivityGroups
                .FirstOrDefaultAsync(g => g.GroupCode == "GRP_COMMUNITY_ACCESS", ct)
                ?? throw new InvalidOperationException("No activity group is configured. Please import the support catalogue in Settings first.");
            activityGroupId = defaultGroup.Id;
        }

        var confirmedBookings = trip.Bookings
            .Where(b => b.BookingStatus == BookingStatus.Confirmed)
            .ToList();

        if (!confirmedBookings.Any())
            throw new InvalidOperationException("No confirmed bookings found on this trip.");

        // Load public holidays using provider state
        var tripEnd = trip.StartDate.AddDays(trip.DurationDays - 1);
        var publicHolidays = (await _db.PublicHolidays
            .Where(h => h.Date >= trip.StartDate && h.Date <= tripEnd && (h.State == null || h.State == state))
            .Select(h => h.Date)
            .ToListAsync(ct))
            .ToHashSet();

        // Load catalogue items: every row of the group, history included. Each stretch of days is priced by the rows valid on ITS dates
        // (EffectiveCatalogueResolver.IsValidOn), so an import that end-dates a row (a December price set) cannot reprice a trip that ended before it.
        var catalogueItems = await _db.SupportCatalogueItems
            .Where(i => i.ActivityGroupId == activityGroupId)
            .ToListAsync(ct);

        if (!catalogueItems.Any())
            throw new InvalidOperationException("No support catalogue items found. Please import the NDIS Support Catalogue in Settings before generating claims.");

        // A trip dated wholly before the earliest catalogue row (a June trip with only the 2026-27 file imported) has no row to price from on any day. Say so:
        // returning no lines would save an empty Draft claim, and the "active claim already exists" check would then block the trip until someone deleted it.
        // A trip that only partly precedes the catalogue is still claimed for the days that have a row.
        var tripDates = trip.TripDays.Select(d => d.Date).ToList();
        if (tripDates.Count > 0 && !tripDates.Any(date => catalogueItems.Any(i => EffectiveCatalogueResolver.IsValidOn(i, date))))
            throw new InvalidOperationException(FormattableString.Invariant(
                $"No catalogue row covers this trip's dates ({trip.StartDate:dd/MM/yyyy} to {tripEnd:dd/MM/yyyy}). Import the catalogue for that period first."));

        var confirmedStaffCount = trip.StaffAssignments.Count(s => s.Status == AssignmentStatus.Confirmed);
        var gstCode = settings.GSTRegistered ? GSTCode.P1 : GSTCode.P2;

        var context = new ClaimCalcContext
        {
            TenantId = trip.TenantId,
            DepartureTime = departureTime,
            ReturnTime = returnTime,
            ActiveHoursPerDay = activeHoursPerDay,
            StaffCount = confirmedStaffCount,
            State = state,
            ConfirmedParticipantCount = confirmedBookings.Count,
            ConfirmedWithNdisNumberCount = confirmedBookings.Count(b => b.Participant != null && !string.IsNullOrWhiteSpace(b.Participant.NdisNumber)),
            TripDayCount = trip.TripDays.Count
        };

        // The per-booking line computation is the shared estimator's, so this claim, its preview and the budget ledger's "booked ahead" are one rule.
        var estimator = new TripPriceEstimator(
            new TripPricingInput(trip.StartDate, trip.DurationDays, trip.TripDays.Select(d => new TripPricingDay(d.Date, d.IsPublicHoliday)).ToList(), departureTime, returnTime, activeHoursPerDay),
            catalogueItems, publicHolidays, state);

        var lineItems = new List<LineItemCalc>();

        foreach (var booking in confirmedBookings)
        {
            if (booking.Participant == null || string.IsNullOrWhiteSpace(booking.Participant.NdisNumber))
                continue;

            var price = estimator.Price(booking.Participant.IsIntensiveSupport);
            foreach (var line in price.Lines)
            {
                lineItems.Add(new LineItemCalc
                {
                    Booking = booking,
                    CatalogueItem = line.CatalogueItem,
                    DayType = line.DayType,
                    From = line.From,
                    To = line.To,
                    Hours = line.Hours,
                    UnitPrice = line.UnitPrice,
                    TotalAmount = line.TotalAmount,
                    GSTCode = gstCode
                });
            }
            foreach (var dayType in price.UnpricedDayTypes) context.UnpricedDayTypes.Add(dayType);
        }

        return (lineItems, context);
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    /// <summary>Why a trip ended up with no claim lines, for the person generating the claim: the first cause that applies, most basic first.</summary>
    private static string NoLinesReason(TripInstance trip, ClaimCalcContext context)
    {
        if (context.TripDayCount == 0)
            return "This trip has no days recorded, so there is nothing to claim. Check the trip's dates, then generate the claim again.";
        if (context.ConfirmedWithNdisNumberCount == 0)
            return "None of the trip's confirmed participants has an NDIS number, so no claim lines could be built. Add the NDIS number to each participant, then generate the claim again.";
        if (context.UnpricedDayTypes.Count > 0)
        {
            var tripEnd = trip.StartDate.AddDays(trip.DurationDays - 1);
            return FormattableString.Invariant(
                $"No catalogue item prices this trip's {string.Join(", ", context.UnpricedDayTypes)} days ({trip.StartDate:dd/MM/yyyy} to {tripEnd:dd/MM/yyyy}), so no claim lines could be built. Import the catalogue for that period first.");
        }
        return "No claim lines could be built for this trip. Check its active hours per day and its departure and return times, then generate the claim again.";
    }

    private static string BuildClaimReference(TripInstance trip)
    {
        var code = trip.TripCode ?? trip.Id.ToString("N")[..8].ToUpper();
        var date = DateTime.UtcNow.ToString("yyyyMMdd");
        var raw = $"TC-{code}-{date}";
        return raw.Length > 50 ? raw[..50] : raw;
    }

    // ─── Internal types ────────────────────────────────────────────────

    private class ClaimCalcContext
    {
        public Guid TenantId { get; set; }
        public TimeOnly DepartureTime { get; set; }
        public TimeOnly ReturnTime { get; set; }
        public decimal ActiveHoursPerDay { get; set; }
        public int StaffCount { get; set; }
        public string State { get; set; } = "VIC";
        public int ConfirmedParticipantCount { get; set; }
        /// <summary>How many of the confirmed participants have an NDIS number: only they get lines.</summary>
        public int ConfirmedWithNdisNumberCount { get; set; }
        /// <summary>How many days the trip has (rows in TripDays): none means nothing can be priced.</summary>
        public int TripDayCount { get; set; }
        /// <summary>Day types a line was wanted for but no catalogue item was valid on its dates (what stops the claim when it ends up with no lines).</summary>
        public SortedSet<ClaimDayType> UnpricedDayTypes { get; } = new();
    }

    private class LineItemCalc
    {
        public ParticipantBooking Booking { get; set; } = null!;
        public SupportCatalogueItem CatalogueItem { get; set; } = null!;
        public ClaimDayType DayType { get; set; }
        public DateOnly From { get; set; }
        public DateOnly To { get; set; }
        public decimal Hours { get; set; }
        public decimal UnitPrice { get; set; }
        public decimal TotalAmount { get; set; }
        public GSTCode GSTCode { get; set; }
    }
}
