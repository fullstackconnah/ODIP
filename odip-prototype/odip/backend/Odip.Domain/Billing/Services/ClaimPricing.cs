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
/// The public holidays as the claim engines read them: a row with no state is national, a row with a state counts only for that state (matched without regard to case, so "NSW",
/// "nsw" and "Nsw" are one state - see <see cref="Normalise"/>), while the lookup itself is still the engines' own exact match on the normalised form. Loaded once and asked for per
/// state, so pricing many participants needs no query per participant.
/// </summary>
public sealed class HolidayCalendar
{
    private readonly List<(DateOnly Date, string? State)> _rows;
    private readonly Dictionary<string, IReadOnlySet<DateOnly>> _byState = new(StringComparer.Ordinal);

    public HolidayCalendar(IEnumerable<(DateOnly Date, string? State)> rows) =>
        _rows = rows.Select(r => (r.Date, r.State is null ? null : Normalise(r.State))).ToList();

    /// <summary>
    /// A state string as the rest of the pricing reads it: trimmed and upper-cased. The catalogue's price columns and the holiday calendar are both keyed by the upper-case
    /// abbreviation, but a state typed or imported any other way ("Nsw", " nsw ") used to fall through to the VIC price and to miss that state's public holidays. Normalising once,
    /// here at the boundary, is what keeps the ledger, the shift claim and the trip claim reading the same state.
    /// </summary>
    public static string Normalise(string? state) => state?.Trim().ToUpperInvariant() ?? string.Empty;

    /// <summary>The days that are public holidays where <paramref name="state"/> is: the national ones and that state's own.</summary>
    public IReadOnlySet<DateOnly> For(string state)
    {
        var wanted = Normalise(state);
        if (!_byState.TryGetValue(wanted, out var days))
            _byState[wanted] = days = _rows.Where(h => h.State == null || h.State == wanted).Select(h => h.Date).ToHashSet();
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
    /// <summary>
    /// The state a participant's shifts are priced in: their own address state, else the organisation's (the only geographic signal there is), else VIC. The state is normalised
    /// (<see cref="HolidayCalendar.Normalise"/>) so that the price column and the public-holiday calendar are always read with the same string: "Nsw" used to take the VIC price and miss
    /// that state's holidays, because only the price column upper-cased.
    /// </summary>
    public static string StateFor(string? participantState, string? providerState) =>
        string.IsNullOrWhiteSpace(participantState)
            ? string.IsNullOrWhiteSpace(providerState) ? "VIC" : HolidayCalendar.Normalise(providerState)
            : HolidayCalendar.Normalise(participantState);

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

/// <summary>
/// One stretch of a trip's days the catalogue has no row for: its day type, the days it covers, and the hours that stretch would have been claimed for (its active hours a day). This is
/// the "bucket, shown, never dropped" of a trip day the claim cannot bill - nothing here is priced, and no rate is invented for it. <see cref="From"/>/<see cref="To"/> are the
/// service dates, and <see cref="Hours"/> is what the claim would have asked for if a row had existed.
/// </summary>
public sealed record UnpricedTripDays(ClaimDayType DayType, DateOnly From, DateOnly To, int DayCount, decimal Hours)
{
    /// <summary>The days themselves, so a screen or a budget can name the gap by date rather than only by type.</summary>
    public IEnumerable<DateOnly> Dates
    {
        get { for (var d = From; d <= To; d = d.AddDays(1)) yield return d; }
    }
}

/// <summary>
/// The lines one booking's claim would have, the day types the catalogue had no row for (what stops a claim that ends up with no lines), and those stretches of days with the hours
/// each would have claimed. A day type alone cannot say how big the gap is, and a budget forecasting from this needs to know that: the unpriced stretches are how much of the trip is
/// invisible to the money.
/// </summary>
public sealed record TripBookingPrice(IReadOnlyList<PricedTripLine> Lines, IReadOnlySet<ClaimDayType> UnpricedDayTypes, IReadOnlyList<UnpricedTripDays> UnpricedDays)
{
    public TripBookingPrice(IReadOnlyList<PricedTripLine> lines, IReadOnlySet<ClaimDayType> unpricedDayTypes)
        : this(lines, unpricedDayTypes, Array.Empty<UnpricedTripDays>()) { }

    public decimal Total => Lines.Sum(l => l.TotalAmount);

    /// <summary>The active hours the trip's unpriced days would have claimed. Never a price: it is the measure of what the ledger cannot see.</summary>
    public decimal UnpricedHours => UnpricedDays.Sum(d => d.Hours);
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
        var unpricedDays = new List<UnpricedTripDays>();
        var activeHoursPerDay = _trip.ActiveHoursPerDay;
        var tripFirstDate = _trip.StartDate;
        var tripLastDate = _trip.EndDate;

        // A stretch of days the catalogue cannot bill: recorded with its dates and the hours it would have claimed, so the caller can say WHICH days are missing and how big
        // they are rather than only that a day type was (see TripBookingPrice.UnpricedDays).
        void MarkUnpriced(ClaimDayType dayType, DateOnly from, DateOnly to, int dayCount, decimal hours)
        {
            unpriced.Add(dayType);
            unpricedDays.Add(new UnpricedTripDays(dayType, from, to, dayCount, hours));
        }

        foreach (var group in _groups)
        {
            if (group.DayType != ClaimDayType.Weekday)
            {
                // Non-weekday: single line item
                var catItem = FindCatalogueItem(_items, group.DayType, isIntensive, group.From);
                if (catItem == null)
                {
                    MarkUnpriced(group.DayType, group.From, group.To, group.DayCount, group.DayCount * activeHoursPerDay);
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
                    else MarkUnpriced(ClaimDayType.Weekday, group.From, group.To, group.DayCount, totalDaytimeHours);
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
                    else
                    {
                        // The evening hours are on the trip's first day (after the departure) and on its last (before the return), and on no day between: those are the days no rate covers,
                        // not the whole stretch of weekdays the evening line spans when it is priced. Each is its own entry, so a date is named once and the days are counted as days.
                        if (firstDayEveningHours > 0) MarkUnpriced(ClaimDayType.WeekdayEvening, tripFirstDate, tripFirstDate, 1, firstDayEveningHours);
                        if (lastDayEveningHours > 0) MarkUnpriced(ClaimDayType.WeekdayEvening, tripLastDate, tripLastDate, 1, lastDayEveningHours);
                    }
                }
            }
        }

        return new TripBookingPrice(lines, unpriced, unpricedDays);
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
