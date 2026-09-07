namespace Odip.Domain.Rostering.Services;

/// <summary>
/// Materialises a <see cref="RecurringUnavailability"/> rule into the concrete dates it covers
/// in a given window. Mirrors <see cref="ShiftPatternExpander.Occurrences"/> exactly, minus the
/// <c>IsActive</c> check — this entity has no such flag; a rule is either not yet decided
/// (Pending, and callers must filter that out themselves — this type does no status filtering)
/// or decided.
/// </summary>
public sealed class RecurringUnavailabilityExpander
{
    /// <summary>
    /// Every date matching <paramref name="rule"/>'s <see cref="RecurringUnavailability.DayOfWeek"/>
    /// inside the intersection of [<paramref name="from"/>, <paramref name="to"/>] and
    /// [<see cref="RecurringUnavailability.EffectiveFrom"/>, <see cref="RecurringUnavailability.EffectiveTo"/>].
    /// </summary>
    public IReadOnlyList<DateOnly> Occurrences(RecurringUnavailability rule, DateOnly from, DateOnly to)
    {
        ArgumentNullException.ThrowIfNull(rule);

        var results = new List<DateOnly>();
        if (from > to)
            return results;

        var rangeStart = from > rule.EffectiveFrom ? from : rule.EffectiveFrom;
        var rangeEnd = rule.EffectiveTo.HasValue && rule.EffectiveTo.Value < to ? rule.EffectiveTo.Value : to;

        if (rangeStart > rangeEnd)
            return results;

        var offsetToFirstMatch = ((int)rule.DayOfWeek - (int)rangeStart.DayOfWeek + 7) % 7;
        var current = rangeStart.AddDays(offsetToFirstMatch);

        while (current <= rangeEnd)
        {
            results.Add(current);
            current = current.AddDays(7);
        }

        return results;
    }
}
