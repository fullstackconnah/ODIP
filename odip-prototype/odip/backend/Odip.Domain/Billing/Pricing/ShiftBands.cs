using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Pricing;

/// <summary>One stretch of a shift that sits in one rate band: the date it falls on, the day type the catalogue prices it as, the band's name, the elapsed minutes, and whether it is the sleepover window.</summary>
public sealed record ShiftBandPart(DateOnly Date, ClaimDayType DayType, string Band, int Minutes, bool Sleepover);

/// <summary>A shift cut into <see cref="Parts"/>, and whether it has a sleepover window (it crosses midnight, is 8 elapsed hours or more, and the worker may sleep).</summary>
public sealed record ShiftBandSplit(IReadOnlyList<ShiftBandPart> Parts, bool SleepoverQualified);

/// <summary>
/// How a rostered shift is cut into rate bands for a claim. It is the agreement engine's own split (<see cref="OccurrencePricer"/>: the band boundaries, the day changes, the 8-hour sleepover rule and elapsed
/// minutes on the nights the clocks change) and nothing of its money, so a shift claim and a plan quote cut a shift at the same minutes. Pure: the caller loads the holidays and the zone.
/// </summary>
public static class ShiftBands
{
    /// <param name="publicHolidays">The whole-day public holidays that apply where the participant is, any date (the shift can run into the day after its service date).</param>
    /// <param name="zone">The organisation's time zone, where the clocks change.</param>
    public static ShiftBandSplit Split(DateOnly serviceDate, TimeOnly start, TimeOnly end, bool workerMaySleep, IReadOnlySet<DateOnly> publicHolidays, TimeZoneInfo zone)
    {
        // The state is only a key into the calendar; every holiday is national here, because the caller has already picked the state's own. A new pricer per call: it caches the zone and the day bands.
        var calendar = new HolidayCalendar(publicHolidays.Select(d => new HolidayEntry(d, null, "Public holiday")));
        var pricer = new OccurrencePricer(new PlanPricingPolicy(), new PlanCatalogue(Array.Empty<SupportCatalogueItem>()), calendar, _ => zone);
        var block = new PlanBlock
        {
            Id = "shift", Start = start, End = end, Days = new[] { serviceDate.DayOfWeek }, WorkerMaySleep = workerMaySleep, Location = new PlanLocation { State = "VIC" },
        };
        var parts = pricer.Parts(block, serviceDate);
        return new ShiftBandSplit(parts, parts.Any(p => p.Sleepover));
    }
}
