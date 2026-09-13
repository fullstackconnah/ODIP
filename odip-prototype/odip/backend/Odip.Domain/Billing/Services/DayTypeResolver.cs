using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Services;

/// <summary>
/// Shared day-type classification used by both the claims engine and rostering: public holiday
/// takes priority over the day of week, then Saturday, then Sunday, then a plain weekday. Moved
/// out of <c>ClaimGenerationService.ResolveDayType</c> (connection-map item 8) so rostering can
/// classify a candidate shift's date the same way a claim would, without duplicating the rule.
/// </summary>
public static class DayTypeResolver
{
    /// <summary>Resolve a date's <see cref="ClaimDayType"/> given a pre-computed public-holiday flag.</summary>
    public static ClaimDayType Resolve(DateOnly date, bool isPublicHoliday)
    {
        if (isPublicHoliday) return ClaimDayType.PublicHoliday;
        return date.DayOfWeek switch
        {
            DayOfWeek.Saturday => ClaimDayType.Saturday,
            DayOfWeek.Sunday => ClaimDayType.Sunday,
            _ => ClaimDayType.Weekday
        };
    }

    /// <summary>Resolve a date's <see cref="ClaimDayType"/> by checking membership in a public-holiday set.</summary>
    public static ClaimDayType Resolve(DateOnly date, IReadOnlySet<DateOnly> publicHolidays) =>
        Resolve(date, publicHolidays.Contains(date));
}
