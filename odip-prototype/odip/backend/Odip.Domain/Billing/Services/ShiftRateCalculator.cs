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

            var hours = (decimal)(segmentEnd - cursor).TotalHours;
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
        var candidates = timeBands.BoundariesOn(date)
            .Append(date.AddDays(1));

        var next = candidates
            .Select(boundary => LocalBoundaryToUtc(boundary, timeZone))
            .Where(boundary => boundary > cursorUtc)
            .DefaultIfEmpty(DateTime.MaxValue)
            .Min();

        if (next == DateTime.MaxValue)
            throw new ShiftRateCalculationException("Unable to determine the next local shift boundary.");
        return next;
    }

    private static DateTime LocalBoundaryToUtc(DateTime localBoundary, TimeZoneInfo timeZone)
    {
        // A skipped local boundary (for example 02:00 at spring-forward) takes effect at the
        // first real local instant after it. At fall-back, select the first occurrence so the
        // local daypart changes when it first appears, rather than an hour late.
        while (timeZone.IsInvalidTime(localBoundary))
            localBoundary = localBoundary.AddMinutes(1);

        if (timeZone.IsAmbiguousTime(localBoundary))
        {
            var firstOffset = timeZone.GetAmbiguousTimeOffsets(localBoundary).Max();
            return DateTime.SpecifyKind(localBoundary - firstOffset, DateTimeKind.Utc);
        }

        return TimeZoneInfo.ConvertTimeToUtc(localBoundary, timeZone);
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
