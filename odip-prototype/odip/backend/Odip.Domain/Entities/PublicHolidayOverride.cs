namespace Odip.Domain.Entities;

/// <summary>
/// A public holiday the synced feed gets wrong or leaves out, maintained by the owner and read by the plan builder's pricing engine AFTER the synced
/// <see cref="PublicHoliday"/> rows (NDIS-CODES 5.3). Like PublicHoliday it is global (no tenant): a state's calendar is the same for every provider.
/// A whole-day row has no times. A part-day row (SA and NT from 19:00 on Christmas Eve and New Year's Eve, QLD from 18:00 on Christmas Eve) has a
/// start and an end: the end is exclusive and a missing end means midnight, a missing start the start of the day.
/// </summary>
public class PublicHolidayOverride
{
    public Guid Id { get; set; }
    public DateOnly Date { get; set; }
    /// <summary>The state or territory (ACT, NSW, NT, QLD, SA, TAS, VIC, WA); null is a national holiday.</summary>
    public string? State { get; set; }
    public string Name { get; set; } = string.Empty;
    /// <summary>Part-day holidays only: the first minute of the holiday.</summary>
    public TimeOnly? StartTime { get; set; }
    /// <summary>Part-day holidays only: the end (exclusive). Null with a start time runs to midnight.</summary>
    public TimeOnly? EndTime { get; set; }
    /// <summary>Where the row comes from (a document and the reason it is here).</summary>
    public string Source { get; set; } = string.Empty;
}
