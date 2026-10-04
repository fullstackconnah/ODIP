using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Services;

/// <summary>
/// The price limit a catalogue row carries for a delivery state, as both claim engines read it: the eight state columns by their name, "REMOTE" and "VERYREMOTE" (or "VERY REMOTE") for the
/// loadings, and VIC for anything else. One copy, shared by the trip claim engine, the shift claim engine and the budget ledger, so the three can never price a state differently.
/// </summary>
public static class CatalogueStatePrice
{
    public static decimal For(SupportCatalogueItem item, string state) =>
        state.ToUpperInvariant() switch
        {
            "ACT" => item.PriceLimit_ACT,
            "NSW" => item.PriceLimit_NSW,
            "NT" => item.PriceLimit_NT,
            "QLD" => item.PriceLimit_QLD,
            "SA" => item.PriceLimit_SA,
            "TAS" => item.PriceLimit_TAS,
            "WA" => item.PriceLimit_WA,
            "REMOTE" => item.PriceLimit_Remote,
            "VERYREMOTE" or "VERY REMOTE" => item.PriceLimit_VeryRemote,
            _ => item.PriceLimit_VIC,
        };
}

/// <summary>
/// The public holidays as the claim engines read them: a row with no state is national, a row with a state counts only for that state (an exact, case-sensitive match, as the engines' own
/// query always made it). Loaded once and asked for per state, so pricing many participants needs no query per participant.
/// </summary>
public sealed class HolidayCalendar
{
    private readonly List<(DateOnly Date, string? State)> _rows;
    private readonly Dictionary<string, IReadOnlySet<DateOnly>> _byState = new(StringComparer.Ordinal);

    public HolidayCalendar(IEnumerable<(DateOnly Date, string? State)> rows) => _rows = rows.ToList();

    /// <summary>The days that are public holidays where <paramref name="state"/> is: the national ones and that state's own.</summary>
    public IReadOnlySet<DateOnly> For(string state)
    {
        if (!_byState.TryGetValue(state, out var days))
            _byState[state] = days = _rows.Where(h => h.State == null || h.State == state).Select(h => h.Date).ToHashSet();
        return days;
    }
}

/// <summary>What a rostered shift is priced at: the catalogue row, the day type, the hours and the price. <see cref="TotalAmount"/> is hours x unit price, unrounded, as the claim line carries it.</summary>
public sealed record ShiftPrice(SupportCatalogueItem CatalogueItem, ClaimDayType DayType, decimal Hours, decimal UnitPrice, decimal TotalAmount);

/// <summary>
/// The one definition of what a rostered shift costs: the shift claim engine prices the claim line of a completed shift with it, and the budget ledger prices every shift that is not
/// claimed yet with it, so an estimate is exactly what the claim will say. It is the engine's own rule and nothing more: only the community access group is priced (the engine has never
/// claimed any other), by the row valid on the SERVICE date for the day type (a public holiday, else Saturday, else Sunday, else a weekday) and the participant's intensity, at the price for
/// the participant's own state (else the organisation's), for the ROSTERED hours. Pure: the caller loads the rows and the holidays.
/// </summary>
public static class ShiftPriceEstimator
{
    /// <summary>The state a participant's shifts are priced in: their own address state, else the organisation's (the only geographic signal there is), else VIC.</summary>
    public static string StateFor(string? participantState, string? providerState) =>
        string.IsNullOrWhiteSpace(participantState) ? providerState ?? "VIC" : participantState;

    /// <summary>The price of one shift, or null when no row of the group is valid on its date for its day type (the claim engine leaves such a shift out, and the ledger counts it as $0).</summary>
    public static ShiftPrice? Price(
        IReadOnlyList<SupportCatalogueItem> communityAccessItems, DateOnly serviceDate, decimal durationHours, bool isIntensive, string state, IReadOnlySet<DateOnly> publicHolidays)
    {
        var dayType = DayTypeResolver.Resolve(serviceDate, publicHolidays);
        var item = EffectiveCatalogueResolver.FindForDay(communityAccessItems, dayType, isIntensive, serviceDate);
        if (item == null) return null;

        var unitPrice = CatalogueStatePrice.For(item, state);
        return new ShiftPrice(item, dayType, durationHours, unitPrice, durationHours * unitPrice);
    }
}

/// <summary>One day of a trip, as the trip claim engine reads it: its date and whether the trip's own itinerary marks it a public holiday.</summary>
public sealed record TripPricingDay(DateOnly Date, bool IsPublicHoliday);

/// <summary>What the trip claim engine needs to know about a trip: its dates, its days, and the times and hours the claim is worked out from (the overrides already applied).</summary>
public sealed record TripPricingInput(
    DateOnly StartDate, int DurationDays, IReadOnlyList<TripPricingDay> Days, TimeOnly DepartureTime, TimeOnly ReturnTime, decimal ActiveHoursPerDay)
{
    public DateOnly EndDate => StartDate.AddDays(DurationDays - 1);
}

/// <summary>One line of a trip claim as the engine builds it for one booking: the row it is priced from, the day type, the stretch of days, the hours and the price.</summary>
public sealed record PricedTripLine(SupportCatalogueItem CatalogueItem, ClaimDayType DayType, DateOnly From, DateOnly To, decimal Hours, decimal UnitPrice, decimal TotalAmount);

/// <summary>The lines one booking's claim would have, and the day types the catalogue had no row for (what stops a claim that ends up with no lines).</summary>
public sealed record TripBookingPrice(IReadOnlyList<PricedTripLine> Lines, IReadOnlySet<ClaimDayType> UnpricedDayTypes)
{
    public decimal Total => Lines.Sum(l => l.TotalAmount);
}

/// <summary>
/// The trip claim engine's per-booking line computation, extracted so the preview, the generated claim and the budget ledger's "booked ahead" are one rule: the trip's days are grouped by
/// day type (a stretch of same-type days that the same catalogue rows price stays one line), the hours of a group are its days x the active hours a day, the first day's hours after 20:00
/// (from the departure time) and the last day's (from the return time) are split off the weekday group and priced at the evening row, and the price is the one for the state. Pure: the
/// caller loads the trip, the group's catalogue rows and the holidays, and builds one estimator per trip and asks it for each booking (standard or intensive support).
/// </summary>
public sealed class TripPriceEstimator
{
    private static readonly TimeOnly EveningThreshold = new(20, 0);

    private readonly TripPricingInput _trip;
    private readonly IReadOnlyList<SupportCatalogueItem> _items;
    private readonly string _state;
    private readonly List<DayGroup> _groups;

    /// <param name="groupItems">Every row of the trip's activity group, history included: each stretch of days is priced by the rows valid on ITS dates.</param>
    /// <param name="publicHolidays">The holidays that apply in <paramref name="state"/> (see <see cref="HolidayCalendar.For"/>).</param>
    /// <param name="state">The state the claim is priced in: the organisation's.</param>
    public TripPriceEstimator(TripPricingInput trip, IReadOnlyList<SupportCatalogueItem> groupItems, IReadOnlySet<DateOnly> publicHolidays, string state)
    {
        _trip = trip;
        _items = groupItems;
        _state = state;
        _groups = GroupDaysByType(trip.Days.OrderBy(d => d.Date).ToList(), publicHolidays, (date, dayType) => PriceEpochOn(groupItems, dayType, date));
    }

    public TripBookingPrice Price(bool isIntensive)
    {
        var lines = new List<PricedTripLine>();
        var unpriced = new SortedSet<ClaimDayType>();
        var activeHoursPerDay = _trip.ActiveHoursPerDay;
        var tripFirstDate = _trip.StartDate;
        var tripLastDate = _trip.EndDate;

        foreach (var group in _groups)
        {
            if (group.DayType != ClaimDayType.Weekday)
            {
                // Non-weekday: single line item
                var catItem = FindCatalogueItem(_items, group.DayType, isIntensive, group.From);
                if (catItem == null)
                {
                    unpriced.Add(group.DayType);
                    continue;
                }

                var hours = group.DayCount * activeHoursPerDay;
                var unitPrice = CatalogueStatePrice.For(catItem, _state);
                lines.Add(new PricedTripLine(catItem, group.DayType, group.From, group.To, hours, unitPrice, hours * unitPrice));
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
                    if (_trip.DepartureTime >= EveningThreshold)
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
                        var daytimeEndMinutes = _trip.DepartureTime.ToTimeSpan().TotalMinutes + (double)activeHoursPerDay * 60;
                        var eveningThresholdMinutes = EveningThreshold.ToTimeSpan().TotalMinutes;
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
                    if (_trip.ReturnTime > EveningThreshold)
                    {
                        var minutesAfterThreshold = (_trip.ReturnTime - EveningThreshold).TotalMinutes;
                        lastDayEveningHours = Math.Round((decimal)minutesAfterThreshold / 60m, 2);
                    }
                }

                var totalEveningHours = firstDayEveningHours + lastDayEveningHours;
                var totalDaytimeHours = Math.Max(0, totalWeekdayHours - totalEveningHours);

                // Create weekday daytime line item
                if (totalDaytimeHours > 0)
                {
                    var catItem = FindCatalogueItem(_items, ClaimDayType.Weekday, isIntensive, group.From);
                    if (catItem != null)
                    {
                        var unitPrice = CatalogueStatePrice.For(catItem, _state);
                        lines.Add(new PricedTripLine(catItem, ClaimDayType.Weekday, group.From, group.To, totalDaytimeHours, unitPrice, totalDaytimeHours * unitPrice));
                    }
                    else unpriced.Add(ClaimDayType.Weekday);
                }

                // Create weekday evening line item
                if (totalEveningHours > 0)
                {
                    var catItem = FindCatalogueItem(_items, ClaimDayType.WeekdayEvening, isIntensive, group.From);
                    if (catItem != null)
                    {
                        var unitPrice = CatalogueStatePrice.For(catItem, _state);
                        lines.Add(new PricedTripLine(catItem, ClaimDayType.WeekdayEvening, group.From, group.To, totalEveningHours, unitPrice, totalEveningHours * unitPrice));
                    }
                    else unpriced.Add(ClaimDayType.WeekdayEvening);
                }
            }
        }

        return new TripBookingPrice(lines, unpriced);
    }

    /// <summary>The row to price a stretch of days from: the one valid on its first day (every day of a group picks the same rows, see <see cref="PriceEpochOn"/>).</summary>
    private static SupportCatalogueItem? FindCatalogueItem(IReadOnlyList<SupportCatalogueItem> items, ClaimDayType dayType, bool isIntensive, DateOnly serviceDate) =>
        EffectiveCatalogueResolver.FindForDay(items, dayType, isIntensive, serviceDate);

    /// <summary>
    /// The rows a stretch of days can be priced from on <paramref name="date"/>, as one string: what <see cref="FindCatalogueItem"/> returns for the day type, for a
    /// standard and for an intensive participant (a trip can hold both), and for a weekday also the evening row (the first and last day's hours after 20:00 are
    /// priced from it). Two consecutive same-type days with the same epoch are priced by the same rows and stay one line; a stretch that crosses a change in
    /// one of those rows would otherwise be one line at one price, so it is split there. A change to a row none of its lines can read (the Saturday price,
    /// for a weekday run) does not split it.
    /// </summary>
    private static string PriceEpochOn(IReadOnlyList<SupportCatalogueItem> items, ClaimDayType dayType, DateOnly date)
    {
        var dayTypes = dayType == ClaimDayType.Weekday ? new[] { ClaimDayType.Weekday, ClaimDayType.WeekdayEvening } : new[] { dayType };
        return string.Join(",", dayTypes.SelectMany(t => new[] { false, true },
            (t, intensive) => FindCatalogueItem(items, t, intensive, date)?.Id.ToString("N") ?? "-"));
    }

    private static List<DayGroup> GroupDaysByType(List<TripPricingDay> days, IReadOnlySet<DateOnly> publicHolidays, Func<DateOnly, ClaimDayType, string> priceEpochOf)
    {
        var result = new List<DayGroup>();
        DayGroup? current = null;

        foreach (var day in days)
        {
            var dayType = DayTypeResolver.Resolve(day.Date, day.IsPublicHoliday || publicHolidays.Contains(day.Date));
            var epoch = priceEpochOf(day.Date, dayType);

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

    private sealed class DayGroup
    {
        public ClaimDayType DayType { get; set; }
        public DateOnly From { get; set; }
        public DateOnly To { get; set; }
        public int DayCount { get; set; }
        /// <summary>The rows the group's lines can be priced from, the same on every day of the group (see <see cref="PriceEpochOn"/>).</summary>
        public string PriceEpoch { get; set; } = string.Empty;
    }
}
