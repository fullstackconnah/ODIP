using System.Globalization;
using System.Linq.Expressions;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Services;

/// <summary>
/// Pure, fail-closed calculation of actual UTC shift instants. This is deliberately not a claim
/// writer: callers supply their approved IANA time zone, code/group mapping, state-scoped holiday
/// set, time bands, and catalogue snapshot, then decide separately whether a quotation may be
/// presented. Day classification is local to the supplied zone; elapsed duration is always UTC.
/// </summary>
public sealed class ShiftRateCalculator
{
    private static readonly HashSet<string> KnownStates = new(StringComparer.Ordinal)
    {
        "ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA", "REMOTE", "VERYREMOTE"
    };

    public ShiftRateQuote Calculate(ShiftRateRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateRequest(request);

        var timeZone = ResolveTimeZone(request.TimeZoneId);
        var timeBands = request.TimeBands!;
        var segments = new List<ShiftRateSegment>();
        var cursor = request.ActualStart;
        while (cursor < request.ActualEnd)
        {
            var localCursor = TimeZoneInfo.ConvertTimeFromUtc(cursor, timeZone);
            var date = DateOnly.FromDateTime(localCursor);
            var segmentEnd = NextLocalBoundaryUtc(localCursor, cursor, timeBands, timeZone);
            if (segmentEnd > request.ActualEnd)
                segmentEnd = request.ActualEnd;

            var dayType = DayTypeResolver.Resolve(date, request.PublicHolidays!);
            var timeBand = timeBands.GetBand(localCursor.TimeOfDay);
            var key = new ShiftRateBandKey(dayType, timeBand);
            if (!request.SupportItems!.TryGetValue(key, out var mapping) || !mapping.IsValid)
                throw new ShiftRateCalculationException($"No valid explicit support-item mapping is configured for {dayType}/{timeBand}.");

            var item = EffectiveCatalogueResolver.Resolve(
                request.CatalogueItems!, mapping, dayType, date);
            var unitRate = GetRateForState(item, request.ServiceState);
            if (unitRate <= 0m)
                throw new ShiftRateCalculationException($"Catalogue item '{item.ItemNumber}' has no available positive rate for state '{request.ServiceState}'.");

            var hours = (segmentEnd.Ticks - cursor.Ticks) / (decimal)TimeSpan.TicksPerHour;
            if (hours <= 0m)
                throw new ShiftRateCalculationException("Shift segmentation produced a non-positive duration.");

            segments.Add(new ShiftRateSegment(
                cursor,
                segmentEnd,
                date,
                dayType,
                timeBand,
                item.ItemNumber,
                item.CatalogueVersion,
                item.EffectiveFrom,
                item.EffectiveTo,
                unitRate,
                hours,
                hours * unitRate));
            cursor = segmentEnd;
        }

        return new ShiftRateQuote(segments, segments.Sum(s => s.Amount));
    }

    private static void ValidateRequest(ShiftRateRequest request)
    {
        if (request.ActualStart >= request.ActualEnd)
            throw new ShiftRateCalculationException("Actual shift end must be after start.");
        if (request.ActualStart.Kind != DateTimeKind.Utc || request.ActualEnd.Kind != DateTimeKind.Utc)
            throw new ShiftRateCalculationException("Actual shift start and end must be UTC instants.");
        if (string.IsNullOrWhiteSpace(request.TimeZoneId))
            throw new ShiftRateCalculationException("An IANA service time zone is required.");
        if (!request.TimeZoneId.Contains('/', StringComparison.Ordinal) || request.TimeZoneId != request.TimeZoneId.Trim())
            throw new ShiftRateCalculationException("Service time zone must be an exact IANA identifier, such as 'Australia/Sydney'.");
        if (string.IsNullOrWhiteSpace(request.ServiceState))
            throw new ShiftRateCalculationException("A service location state is required.");
        if (!KnownStates.Contains(NormalizeState(request.ServiceState)))
            throw new ShiftRateCalculationException($"Unknown service location state '{request.ServiceState}'.");
        if (request.PublicHolidays is null)
            throw new ShiftRateCalculationException("A state-scoped public-holiday set is required.");
        if (request.TimeBands is null)
            throw new ShiftRateCalculationException("Configured AM/PM/evening time boundaries are required.");
        request.TimeBands.Validate();
        if (request.SupportItems is null || request.SupportItems.Count == 0)
            throw new ShiftRateCalculationException("Explicit support item group/code mappings are required.");
        if (request.CatalogueItems is null)
            throw new ShiftRateCalculationException("A catalogue snapshot is required.");
    }

    private static TimeZoneInfo ResolveTimeZone(string timeZoneId)
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (TimeZoneNotFoundException)
        {
            throw new ShiftRateCalculationException($"Unknown IANA service time zone '{timeZoneId}'.");
        }
        catch (InvalidTimeZoneException)
        {
            throw new ShiftRateCalculationException($"Invalid IANA service time zone '{timeZoneId}'.");
        }
    }

    private static DateTime NextLocalBoundaryUtc(
        DateTime localCursor,
        DateTime cursorUtc,
        ShiftRateTimeBands timeBands,
        TimeZoneInfo timeZone)
    {
        var date = localCursor.Date;
        var nextLocalBoundary = timeBands.BoundariesOn(date)
            .Append(date.AddDays(1))
            .SelectMany(boundary => LocalBoundaryToUtc(boundary, timeZone))
            .Where(boundary => boundary > cursorUtc)
            .DefaultIfEmpty(DateTime.MaxValue)
            .Min();

        if (nextLocalBoundary == DateTime.MaxValue)
            throw new ShiftRateCalculationException("Unable to determine the next local shift boundary.");

        // The local clock can move backwards between configured boundaries. The offset change is
        // itself a rate boundary: it can return the local time to an earlier daypart.
        var offsetTransition = NextUtcOffsetTransition(cursorUtc, nextLocalBoundary, timeZone);
        return offsetTransition < nextLocalBoundary ? offsetTransition : nextLocalBoundary;
    }

    private static IEnumerable<DateTime> LocalBoundaryToUtc(DateTime localBoundary, TimeZoneInfo timeZone)
    {
        // A skipped local boundary (for example 02:00 at spring-forward) takes effect at the
        // first real local instant after it. At fall-back, both occurrences are candidates: the
        // first one may already be past the cursor while the repeated one is still ahead.
        while (timeZone.IsInvalidTime(localBoundary))
            localBoundary = localBoundary.AddMinutes(1);

        if (timeZone.IsAmbiguousTime(localBoundary))
        {
            foreach (var offset in timeZone.GetAmbiguousTimeOffsets(localBoundary))
                yield return DateTime.SpecifyKind(localBoundary - offset, DateTimeKind.Utc);
            yield break;
        }

        yield return TimeZoneInfo.ConvertTimeToUtc(localBoundary, timeZone);
    }

    private static DateTime NextUtcOffsetTransition(DateTime startUtc, DateTime limitUtc, TimeZoneInfo timeZone)
    {
        var offset = timeZone.GetUtcOffset(startUtc);
        var lower = startUtc;
        var upper = startUtc;

        while (upper < limitUtc)
        {
            lower = upper;
            upper = upper.AddHours(1);
            if (upper > limitUtc)
                upper = limitUtc;

            if (timeZone.GetUtcOffset(upper) != offset)
                return FindOffsetTransition(lower, upper, offset, timeZone);
        }

        return DateTime.MaxValue;
    }

    private static DateTime FindOffsetTransition(DateTime lower, DateTime upper, TimeSpan lowerOffset, TimeZoneInfo timeZone)
    {
        while (upper.Ticks - lower.Ticks > 1)
        {
            var midpoint = new DateTime(lower.Ticks + ((upper.Ticks - lower.Ticks) / 2), DateTimeKind.Utc);
            if (timeZone.GetUtcOffset(midpoint) == lowerOffset)
                lower = midpoint;
            else
                upper = midpoint;
        }

        return upper;
    }

    internal static decimal GetRateForState(SupportCatalogueItem item, string state) => NormalizeState(state) switch
    {
        "ACT" => item.PriceLimit_ACT,
        "NSW" => item.PriceLimit_NSW,
        "NT" => item.PriceLimit_NT,
        "QLD" => item.PriceLimit_QLD,
        "SA" => item.PriceLimit_SA,
        "TAS" => item.PriceLimit_TAS,
        "VIC" => item.PriceLimit_VIC,
        "WA" => item.PriceLimit_WA,
        "REMOTE" => item.PriceLimit_Remote,
        "VERYREMOTE" => item.PriceLimit_VeryRemote,
        _ => throw new ShiftRateCalculationException($"Unknown service location state '{state}'.")
    };

    internal static string NormalizeState(string state) => state.Trim().ToUpperInvariant().Replace(" ", string.Empty);
}

/// <summary>Resolves exactly one active, date-effective catalogue row for an explicit mapping.</summary>
public static class EffectiveCatalogueResolver
{
    public static SupportCatalogueItem Resolve(
        IEnumerable<SupportCatalogueItem> catalogueItems,
        SupportItemMapping mapping,
        ClaimDayType dayType,
        DateOnly serviceDate)
    {
        ArgumentNullException.ThrowIfNull(catalogueItems);
        if (!mapping.IsValid)
            throw new ShiftRateCalculationException("Support item mapping must include a group id and a non-blank item code.");

        var matches = catalogueItems.Where(item =>
            item.IsActive &&
            item.ActivityGroupId == mapping.ActivityGroupId &&
            string.Equals(item.ItemNumber, mapping.ItemCode, StringComparison.Ordinal) &&
            item.DayType == dayType &&
            item.EffectiveFrom <= serviceDate &&
            (!item.EffectiveTo.HasValue || item.EffectiveTo.Value >= serviceDate)).ToList();

        return matches.Count switch
        {
            1 => matches[0],
            0 => throw new ShiftRateCalculationException(
                $"No active date-effective catalogue item exists for code '{mapping.ItemCode}' on {serviceDate:yyyy-MM-dd} ({dayType})."),
            _ => throw new ShiftRateCalculationException(
                $"Ambiguous overlapping catalogue rows exist for code '{mapping.ItemCode}' on {serviceDate:yyyy-MM-dd} ({dayType}).")
        };
    }

    /// <summary>
    /// Whether a catalogue row prices a service on <paramref name="date"/>: the date is inside the row's own window (EffectiveFrom to EffectiveTo, open-ended when
    /// EffectiveTo is null, both days included), and the row has not been withdrawn by hand. IsActive is not "valid today": an import end-dates the rows a
    /// newer catalogue supersedes and marks them inactive, yet each is still the right row for the service dates inside its window, and a service that
    /// happened before a December price set must keep the price of its own date. So an inactive row is valid when it has an end date (history), and
    /// is valid on no date when it is both inactive and open-ended (an import always end-dates what it deactivates, so only a hand edit leaves that).
    /// This is the one definition of "valid on a date": the lookup, both claim engines and the agreement draft use it, as a method here and as
    /// <see cref="ValidOn"/> inside a database query.
    /// </summary>
    public static bool IsValidOn(SupportCatalogueItem item, DateOnly date) =>
        item.EffectiveFrom <= date
        && (!item.EffectiveTo.HasValue || item.EffectiveTo.Value >= date)
        && (item.IsActive || item.EffectiveTo.HasValue);

    /// <summary><see cref="IsValidOn"/> as an expression, for a query that must filter in the database (a unit test pins that the two agree).</summary>
    public static Expression<Func<SupportCatalogueItem, bool>> ValidOn(DateOnly date) =>
        item => item.EffectiveFrom <= date
            && (item.EffectiveTo == null || item.EffectiveTo >= date)
            && (item.IsActive || item.EffectiveTo != null);

    /// <summary>
    /// The row a claim engine prices a service from, by day type and intensity rather than by code: among the rows of <paramref name="groupItems"/> valid on
    /// <paramref name="serviceDate"/> (<see cref="IsValidOn"/>), the exact match for the day type and intensity, else any row of the day type (an intensive
    /// participant with no intensive item is priced from the standard one, as the engines always did). Null when no row is valid that day: the caller leaves
    /// the line out, as it always did for a day type the catalogue lacks, rather than price it from a row that did not apply. If two rows are valid (old
    /// imports could leave a one-day overlap) the newer version wins, so the choice never depends on row order.
    /// </summary>
    public static SupportCatalogueItem? FindForDay(IEnumerable<SupportCatalogueItem> groupItems, ClaimDayType dayType, bool isIntensive, DateOnly serviceDate)
    {
        ArgumentNullException.ThrowIfNull(groupItems);
        var valid = groupItems.Where(i => i.DayType == dayType && IsValidOn(i, serviceDate)).ToList();
        return Newest(valid.Where(i => i.IsIntensive == isIntensive)) ?? Newest(valid);

        static SupportCatalogueItem? Newest(IEnumerable<SupportCatalogueItem> rows) =>
            rows.OrderByDescending(i => i.EffectiveFrom).ThenByDescending(i => i.IsActive)
                .ThenBy(i => i.ItemNumber, StringComparer.Ordinal).ThenBy(i => i.Id).FirstOrDefault();
    }

    /// <summary>
    /// The date-effective lookup: the single catalogue row for <paramref name="itemCode"/> that is valid on <paramref name="serviceDate"/> (see
    /// <see cref="IsValidOn"/>), and its price for <paramref name="zone"/>, or a typed failure (none, ambiguous, zone not eligible, not priced). The code is
    /// matched exactly, registration group included, because the same digits mean different items in different groups. Pure: callers load the rows
    /// (see <c>FindCatalogueItemAsync</c> for the database path).
    /// </summary>
    public static CatalogueLookupResult Find(IEnumerable<SupportCatalogueItem> catalogueItems, string itemCode, DateOnly serviceDate, PriceZone zone)
    {
        ArgumentNullException.ThrowIfNull(catalogueItems);
        var code = itemCode?.Trim() ?? string.Empty;
        var date = serviceDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        var matches = code.Length == 0
            ? new List<SupportCatalogueItem>()
            : catalogueItems.Where(item => string.Equals(item.ItemNumber, code, StringComparison.Ordinal) && IsValidOn(item, serviceDate)).ToList();

        if (matches.Count == 0)
            return CatalogueLookupResult.Fail(CatalogueLookupFailure.NotFound, null, $"No catalogue row for '{code}' is valid on {date}.");
        if (matches.Count > 1)
            return CatalogueLookupResult.Fail(CatalogueLookupFailure.Ambiguous, null,
                $"{matches.Count.ToString(CultureInfo.InvariantCulture)} catalogue rows for '{code}' are valid on {date}: the catalogue has overlapping versions of this item.");

        var item = matches[0];
        if (item.PriceNational is null)
            return CatalogueLookupResult.Fail(CatalogueLookupFailure.NotPriced, item, $"'{code}' has no price limit on {date} (a quotable item, or a row with no National price).");

        var price = zone switch
        {
            PriceZone.National => item.PriceNational,
            PriceZone.Remote => item.PriceRemote,
            PriceZone.VeryRemote => item.PriceVeryRemote,
            _ => throw new ArgumentOutOfRangeException(nameof(zone), zone, "Unknown price zone.")
        };
        return price is null
            ? CatalogueLookupResult.Fail(CatalogueLookupFailure.ZoneNotEligible, item, $"'{code}' lists no {zone} price on {date}, so it is not eligible for that loading.")
            : CatalogueLookupResult.Success(item, price.Value);
    }
}

/// <summary>Why <see cref="EffectiveCatalogueResolver.Find"/> returned no price.</summary>
public enum CatalogueLookupFailure
{
    /// <summary>No row for the code is valid on the service date (an unknown code, a date before the first catalogue, or after the last row ended).</summary>
    NotFound = 0,
    /// <summary>More than one row for the code is valid on the service date: overlapping versions, which an import never leaves behind.</summary>
    Ambiguous = 1,
    /// <summary>One row is valid but lists no price for the zone: the item is not eligible for Remote / Very Remote loading.</summary>
    ZoneNotEligible = 2,
    /// <summary>One row is valid but has no National price: a quotable item (claimable only if a stated plan item), or a row written before zone prices existed.</summary>
    NotPriced = 3
}

/// <summary>The outcome of a date-effective lookup. <see cref="Item"/> is set whenever exactly one row was valid, including the two price failures; <see cref="Price"/> only on success.</summary>
public sealed record CatalogueLookupResult
{
    public SupportCatalogueItem? Item { get; init; }
    public decimal? Price { get; init; }
    public CatalogueLookupFailure? Failure { get; init; }
    public string? Message { get; init; }

    public bool Found => Failure is null;

    internal static CatalogueLookupResult Success(SupportCatalogueItem item, decimal price) => new() { Item = item, Price = price };
    internal static CatalogueLookupResult Fail(CatalogueLookupFailure failure, SupportCatalogueItem? item, string message) => new() { Failure = failure, Item = item, Message = message };
}

public enum ShiftTimeBand { Night, Am, Pm, Evening }

public sealed record ShiftRateTimeBands(TimeOnly? AmStartsAt, TimeOnly? PmStartsAt, TimeOnly? EveningStartsAt)
{
    internal void Validate()
    {
        if (!AmStartsAt.HasValue || !PmStartsAt.HasValue || !EveningStartsAt.HasValue)
            throw new ShiftRateCalculationException("Configured AM, PM, and evening boundaries are all required.");
        if (AmStartsAt.Value == TimeOnly.MinValue ||
            !(AmStartsAt.Value < PmStartsAt.Value && PmStartsAt.Value < EveningStartsAt.Value))
            throw new ShiftRateCalculationException("Time boundaries must be strictly ordered after midnight: AM, PM, evening.");
    }

    internal ShiftTimeBand GetBand(TimeSpan time) =>
        time < AmStartsAt!.Value.ToTimeSpan() ? ShiftTimeBand.Night :
        time < PmStartsAt!.Value.ToTimeSpan() ? ShiftTimeBand.Am :
        time < EveningStartsAt!.Value.ToTimeSpan() ? ShiftTimeBand.Pm :
        ShiftTimeBand.Evening;

    internal IEnumerable<DateTime> BoundariesOn(DateTime date)
    {
        yield return date + AmStartsAt!.Value.ToTimeSpan();
        yield return date + PmStartsAt!.Value.ToTimeSpan();
        yield return date + EveningStartsAt!.Value.ToTimeSpan();
    }
}

public sealed record SupportItemMapping(Guid ActivityGroupId, string ItemCode)
{
    public bool IsValid => ActivityGroupId != Guid.Empty && !string.IsNullOrWhiteSpace(ItemCode);
}

public readonly record struct ShiftRateBandKey(ClaimDayType DayType, ShiftTimeBand TimeBand);

public sealed record ShiftRateRequest(
    DateTime ActualStart,
    DateTime ActualEnd,
    string TimeZoneId,
    string ServiceState,
    IReadOnlySet<DateOnly>? PublicHolidays,
    ShiftRateTimeBands? TimeBands,
    IReadOnlyDictionary<ShiftRateBandKey, SupportItemMapping>? SupportItems,
    IReadOnlyCollection<SupportCatalogueItem>? CatalogueItems);

public sealed record ShiftRateSegment(
    DateTime Start,
    DateTime End,
    DateOnly ServiceDate,
    ClaimDayType DayType,
    ShiftTimeBand TimeBand,
    string SupportItemCode,
    string CatalogueVersion,
    DateOnly EffectiveFrom,
    DateOnly? EffectiveTo,
    decimal UnitRate,
    decimal Hours,
    decimal Amount);

public sealed record ShiftRateQuote(IReadOnlyList<ShiftRateSegment> Segments, decimal TotalAmount);

public sealed class ShiftRateCalculationException : InvalidOperationException
{
    public ShiftRateCalculationException(string message) : base(message) { }
}
