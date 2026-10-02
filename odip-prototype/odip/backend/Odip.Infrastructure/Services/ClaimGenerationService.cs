using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Infrastructure.Services;

public class ClaimGenerationService
{
    private readonly OdipDbContext _db;

    public ClaimGenerationService(OdipDbContext db) => _db = db;

    // ─── Preview (no persistence, no status checks) ────────────────────

    public async Task<ClaimPreviewResponseDto> PreviewClaimAsync(
        Guid tripInstanceId, ClaimPreviewRequestDto? overrides, CancellationToken ct = default)
    {
        var (lineItems, context) = await CalculateClaimAsync(tripInstanceId, overrides, ct);

        return new ClaimPreviewResponseDto
        {
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
            DepartureTime = departureTime,
            ReturnTime = returnTime,
            ActiveHoursPerDay = activeHoursPerDay,
            StaffCount = confirmedStaffCount,
            State = state,
            ConfirmedParticipantCount = confirmedBookings.Count
        };

        var dayGroups = GroupDaysByType(trip.TripDays.OrderBy(d => d.Date).ToList(), publicHolidays, date => PriceEpochOn(catalogueItems, date));
        var tripFirstDate = trip.StartDate;
        var tripLastDate = tripEnd;
        var eveningThreshold = new TimeOnly(20, 0);

        var lineItems = new List<LineItemCalc>();

        foreach (var booking in confirmedBookings)
        {
            if (booking.Participant == null || string.IsNullOrWhiteSpace(booking.Participant.NdisNumber))
                continue;

            var isIntensive = booking.Participant.IsIntensiveSupport;

            foreach (var group in dayGroups)
            {
                if (group.DayType != ClaimDayType.Weekday)
                {
                    // Non-weekday: single line item
                    var catItem = FindCatalogueItem(catalogueItems, group.DayType, isIntensive, group.From);
                    if (catItem == null) continue;

                    var hours = group.DayCount * activeHoursPerDay;
                    var unitPrice = GetPriceForState(catItem, state);
                    lineItems.Add(new LineItemCalc
                    {
                        Booking = booking,
                        CatalogueItem = catItem,
                        DayType = group.DayType,
                        From = group.From,
                        To = group.To,
                        Hours = hours,
                        UnitPrice = unitPrice,
                        TotalAmount = hours * unitPrice,
                        GSTCode = gstCode
                    });
                }
                else
                {
                    // Weekday: potentially split into daytime + evening
                    var totalWeekdayHours = group.DayCount * activeHoursPerDay;
                    decimal firstDayEveningHours = 0;
                    decimal lastDayEveningHours = 0;

                    // Check if first trip day is in this group
                    if (tripFirstDate >= group.From && tripFirstDate <= group.To)
                    {
                        if (departureTime >= eveningThreshold)
                        {
                            // All hours on the first day are evening
                            firstDayEveningHours = activeHoursPerDay;
                        }
                        else
                        {
                            // Use raw minute arithmetic rather than TimeOnly.AddHours: TimeOnly wraps
                            // modulo 24h, so an overnight activity window (e.g. 18:00 + 8h) would
                            // otherwise land back at 02:00 and compare as "before" the evening
                            // threshold instead of past it.
                            var daytimeEndMinutes = departureTime.ToTimeSpan().TotalMinutes + (double)activeHoursPerDay * 60;
                            var eveningThresholdMinutes = eveningThreshold.ToTimeSpan().TotalMinutes;
                            if (daytimeEndMinutes > eveningThresholdMinutes)
                            {
                                // Minutes from 20:00 to end (possibly past midnight) are evening
                                var minutesAfterThreshold = daytimeEndMinutes - eveningThresholdMinutes;
                                firstDayEveningHours = Math.Round((decimal)minutesAfterThreshold / 60m, 2);
                            }
                        }
                    }

                    // Check if last trip day is in this group
                    if (tripLastDate >= group.From && tripLastDate <= group.To && tripLastDate != tripFirstDate)
                    {
                        if (returnTime > eveningThreshold)
                        {
                            var minutesAfterThreshold = (returnTime - eveningThreshold).TotalMinutes;
                            lastDayEveningHours = Math.Round((decimal)minutesAfterThreshold / 60m, 2);
                        }
                    }

                    var totalEveningHours = firstDayEveningHours + lastDayEveningHours;
                    var totalDaytimeHours = Math.Max(0, totalWeekdayHours - totalEveningHours);

                    // Create weekday daytime line item
                    if (totalDaytimeHours > 0)
                    {
                        var catItem = FindCatalogueItem(catalogueItems, ClaimDayType.Weekday, isIntensive, group.From);
                        if (catItem != null)
                        {
                            var unitPrice = GetPriceForState(catItem, state);
                            lineItems.Add(new LineItemCalc
                            {
                                Booking = booking,
                                CatalogueItem = catItem,
                                DayType = ClaimDayType.Weekday,
                                From = group.From,
                                To = group.To,
                                Hours = totalDaytimeHours,
                                UnitPrice = unitPrice,
                                TotalAmount = totalDaytimeHours * unitPrice,
                                GSTCode = gstCode
                            });
                        }
                    }

                    // Create weekday evening line item
                    if (totalEveningHours > 0)
                    {
                        var catItem = FindCatalogueItem(catalogueItems, ClaimDayType.WeekdayEvening, isIntensive, group.From);
                        if (catItem != null)
                        {
                            var unitPrice = GetPriceForState(catItem, state);
                            lineItems.Add(new LineItemCalc
                            {
                                Booking = booking,
                                CatalogueItem = catItem,
                                DayType = ClaimDayType.WeekdayEvening,
                                From = group.From,
                                To = group.To,
                                Hours = totalEveningHours,
                                UnitPrice = unitPrice,
                                TotalAmount = totalEveningHours * unitPrice,
                                GSTCode = gstCode
                            });
                        }
                    }
                }
            }
        }

        return (lineItems, context);
    }

    // ─── Helpers ────────────────────────────────────────────────────────

    /// <summary>The row to price a stretch of days from: the one valid on its first day (every day of a group shares the same valid rows, see <see cref="PriceEpochOn"/>).</summary>
    private static SupportCatalogueItem? FindCatalogueItem(
        List<SupportCatalogueItem> items, ClaimDayType dayType, bool isIntensive, DateOnly serviceDate) =>
        EffectiveCatalogueResolver.FindForDay(items, dayType, isIntensive, serviceDate);

    /// <summary>
    /// Which catalogue rows are valid on a date, as one string: two days with the same epoch are priced by the same rows. A stretch of consecutive
    /// same-type days that crosses a price change would otherwise be one line at one price; it is split where the epoch changes instead.
    /// </summary>
    private static string PriceEpochOn(List<SupportCatalogueItem> items, DateOnly date) =>
        string.Join(",", items.Where(i => EffectiveCatalogueResolver.IsValidOn(i, date)).Select(i => i.Id).Order());

    private static string BuildClaimReference(TripInstance trip)
    {
        var code = trip.TripCode ?? trip.Id.ToString("N")[..8].ToUpper();
        var date = DateTime.UtcNow.ToString("yyyyMMdd");
        var raw = $"TC-{code}-{date}";
        return raw.Length > 50 ? raw[..50] : raw;
    }

    private static List<DayGroup> GroupDaysByType(List<TripDay> days, HashSet<DateOnly> publicHolidays, Func<DateOnly, string> priceEpochOf)
    {
        var result = new List<DayGroup>();
        DayGroup? current = null;

        foreach (var day in days)
        {
            var dayType = DayTypeResolver.Resolve(day.Date, day.IsPublicHoliday || publicHolidays.Contains(day.Date));
            var epoch = priceEpochOf(day.Date);

            if (current == null || current.DayType != dayType || current.To.AddDays(1) != day.Date || current.PriceEpoch != epoch)
            {
                current = new DayGroup { DayType = dayType, From = day.Date, To = day.Date, DayCount = 1, PriceEpoch = epoch };
                result.Add(current);
            }
            else
            {
                current.To = day.Date;
                current.DayCount++;
            }
        }

        return result;
    }

    private static decimal GetPriceForState(SupportCatalogueItem item, string state) =>
        state.ToUpperInvariant() switch
        {
            "ACT" => item.PriceLimit_ACT,
            "NSW" => item.PriceLimit_NSW,
            "NT"  => item.PriceLimit_NT,
            "QLD" => item.PriceLimit_QLD,
            "SA"  => item.PriceLimit_SA,
            "TAS" => item.PriceLimit_TAS,
            "WA"  => item.PriceLimit_WA,
            "REMOTE" => item.PriceLimit_Remote,
            "VERYREMOTE" or "VERY REMOTE" => item.PriceLimit_VeryRemote,
            _ => item.PriceLimit_VIC
        };

    // ─── Internal types ────────────────────────────────────────────────

    private class ClaimCalcContext
    {
        public TimeOnly DepartureTime { get; set; }
        public TimeOnly ReturnTime { get; set; }
        public decimal ActiveHoursPerDay { get; set; }
        public int StaffCount { get; set; }
        public string State { get; set; } = "VIC";
        public int ConfirmedParticipantCount { get; set; }
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

    private class DayGroup
    {
        public ClaimDayType DayType { get; set; }
        public DateOnly From { get; set; }
        public DateOnly To { get; set; }
        public int DayCount { get; set; }
        /// <summary>The catalogue rows valid on every day of the group (see <see cref="ClaimGenerationService.PriceEpochOn"/>).</summary>
        public string PriceEpoch { get; set; } = string.Empty;
    }
}
