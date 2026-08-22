namespace Odip.Domain.Rostering.Services;

/// <summary>
/// Materialises a <see cref="ShiftPattern"/> into the concrete dates it covers in a given
/// window. Pure and idempotent by construction — calling it twice for overlapping ranges
/// returns overlapping dates, so generation callers are responsible for skipping any date that
/// already carries a <see cref="Shift"/> with the pattern's Id.
/// </summary>
public sealed class ShiftPatternExpander
{
    /// <summary>
    /// Every date matching <paramref name="pattern"/>'s <see cref="ShiftPattern.DayOfWeek"/>
    /// inside the intersection of [<paramref name="from"/>, <paramref name="to"/>] and
    /// [<see cref="ShiftPattern.EffectiveFrom"/>, <see cref="ShiftPattern.EffectiveTo"/>].
    /// Returns no dates when the pattern is inactive.
    /// </summary>
    public IReadOnlyList<DateOnly> Occurrences(ShiftPattern pattern, DateOnly from, DateOnly to)
    {
        ArgumentNullException.ThrowIfNull(pattern);

        var results = new List<DateOnly>();
        if (!pattern.IsActive || from > to)
            return results;

        var rangeStart = from > pattern.EffectiveFrom ? from : pattern.EffectiveFrom;
        var rangeEnd = pattern.EffectiveTo.HasValue && pattern.EffectiveTo.Value < to ? pattern.EffectiveTo.Value : to;

        if (rangeStart > rangeEnd)
            return results;

        var offsetToFirstMatch = ((int)pattern.DayOfWeek - (int)rangeStart.DayOfWeek + 7) % 7;
        var current = rangeStart.AddDays(offsetToFirstMatch);

        while (current <= rangeEnd)
        {
            results.Add(current);
            current = current.AddDays(7);
        }

        return results;
    }
}
