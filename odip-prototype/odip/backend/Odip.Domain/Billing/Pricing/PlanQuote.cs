using System.Text.Json.Serialization;
using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Billing.Pricing;

/// <summary>What a person has to look at on a line. A line can carry several.</summary>
[Flags]
public enum PlannedLineFlags
{
    None = 0,
    /// <summary>A person must decide before the plan is approved: a public holiday nobody has ruled on, a band with no item, a sleepover that does not qualify, a catalogue gap.</summary>
    Review = 1,
    /// <summary>The line is priced at a public holiday item, so it costs more than the same support on an ordinary day.</summary>
    HolidayExposure = 2,
    /// <summary>The price or the rule behind the line is not confirmed for 2026-27 (the per-kilometre rate and travel time caps are 2025-26 values; some group divisor readings await NDIA).</summary>
    Provisional = 4,
}

/// <summary>What a line is, which decides how it is read: support hours, a sleepover, and the companions of the support.</summary>
public enum PlannedLineKind
{
    Support = 0,
    /// <summary>The Each item for a night the worker may sleep (01_010, or 01_206 in STA).</summary>
    Sleepover = 1,
    /// <summary>Active hours beyond the two a sleepover includes, priced hourly.</summary>
    SleepoverActiveHours = 2,
    /// <summary>The worker's travel time, claimed on the support item.</summary>
    ProviderTravelTime = 3,
    /// <summary>Provider travel kilometres, in dollars on the non-labour item.</summary>
    ProviderTravelCosts = 4,
    /// <summary>Activity-based transport (vehicle kilometres, tolls, parking), in dollars.</summary>
    ActivityTransport = 5,
    CentreCapital = 6,
    ParticipantAccommodation = 7,
    WorkerAccommodation = 8,
}

/// <summary>Why something could not be priced or was refused. Typed, so a screen can branch on it; the message says it in words.</summary>
public enum PlanFailureReason
{
    /// <summary>The request or a block breaks a rule (the message names it).</summary>
    InvalidInput = 0,
    /// <summary>The support's family needs a registration group the provider does not hold.</summary>
    RegistrationGroupNotHeld = 1,
    /// <summary>STA is set to the legacy per-day items, which the builder does not offer.</summary>
    StaLegacyNotSupported = 2,
    /// <summary>The catalogue has no item for this family, intensity and band at all: for example no Weekday Night item exists for community access or group activities. Never mapped to another family.</summary>
    NoItem = 3,
    /// <summary>No catalogue row is valid on the service date (the catalogue has not been imported for that period).</summary>
    CatalogueNotFound = 4,
    /// <summary>Two rows of one version are valid on the service date.</summary>
    CatalogueAmbiguous = 5,
    /// <summary>The item lists no price for the delivery zone, so it is not eligible for that loading.</summary>
    ZoneNotEligible = 6,
    /// <summary>The row has no price limit (a quotable item).</summary>
    CatalogueNotPriced = 7,
    /// <summary>The row's unit is not the one the line needs (hours, each, day): a price would be multiplied by the wrong quantity.</summary>
    UnexpectedUnit = 8,
    /// <summary>The block asks for a sleepover but its support type has no sleepover item.</summary>
    SleepoverNotAvailable = 9,
    /// <summary>The worker may sleep, but the window is not 8 hours or more across midnight, so the support is priced hourly.</summary>
    SleepoverNotQualifying = 10,
    /// <summary>Activity-based transport only goes with community and group supports.</summary>
    TransportNotAvailable = 11,
    /// <summary>Accommodation nights are an STA item.</summary>
    AccommodationNotAvailable = 12,
    /// <summary>The support item does not allow provider travel.</summary>
    TravelNotClaimable = 13,
    /// <summary>The clocks change inside an overnight window, so it is shorter or longer in elapsed hours than on the clock and whether it is a sleepover depends on how the 8 hours are counted (the engine counts elapsed hours).</summary>
    SleepoverClockChange = 14,
    /// <summary>26 December or 25 April, which the pricing schedule names as public holidays, falls in the period and the holiday calendar has no row for the state on that date: priced as an ordinary day and left for a person (Charge prices it as a holiday, Skip drops it).</summary>
    NamedDateNotInCalendar = 15,
    /// <summary>Two blocks of the quote are on at the same time on the same date, so the same participant's time would be priced twice. Two workers at once are one block with Workers = 2.</summary>
    BlocksOverlap = 16,
}

/// <summary>Why a line is priced the way it is: the rules applied, the catalogue row and the dates it was priced from, and the group arithmetic.</summary>
public sealed record PlannedLineTrace
{
    /// <summary>Stable rule ids, for example "bands:weekday-evening", "crossing:A", "group:floor(price*workers/participants)".</summary>
    public IReadOnlyList<string> Rules { get; init; } = Array.Empty<string>();
    /// <summary>One sentence in words: the band, the date, the zone, the group and the price basis.</summary>
    public string Why { get; init; } = string.Empty;
    public string? CatalogueVersion { get; init; }
    /// <summary>The start of the catalogue row that priced the line: the price basis date. The end of the row is left out on purpose: a later import end-dates the row, and a line for an earlier service date must not change.</summary>
    public DateOnly? PriceBasisFrom { get; init; }
    public string? SourceDocument { get; init; }
    public PriceZone Zone { get; init; }
    /// <summary>The catalogue maximum for (item, zone, service date), before the group fraction.</summary>
    public decimal? MaximumUnitPrice { get; init; }
    public int Workers { get; init; } = 1;
    public int ParticipantsPresent { get; init; } = 1;
    /// <summary>"A" or "B" on a support line: the crossing policy that produced it.</summary>
    public string? Policy { get; init; }
    public string? HolidayName { get; init; }
    /// <summary>Numbers of the owner questions (NDIS-CODES 11.3) this line depends on.</summary>
    public IReadOnlyList<int> OpenQuestions { get; init; } = Array.Empty<int>();
}

/// <summary>
/// One line of the plan for one occurrence: an item, a unit, a quantity, a price per unit (the maximum for the item, zone and service date, times
/// workers over participants present, floored to the cent), the total, the service date, what to look at, and why. A line that could not be priced
/// has no item code, a zero total, <see cref="Unpriced"/> set and the Review flag.
/// </summary>
public sealed record PlannedLine
{
    public string BlockId { get; init; } = string.Empty;
    public PlannedLineKind Kind { get; init; }
    public string? ItemCode { get; init; }
    /// <summary>H hour, E each, D day.</summary>
    public string Unit { get; init; } = "H";
    public decimal Qty { get; init; }
    public decimal UnitPrice { get; init; }
    public decimal Total { get; init; }
    /// <summary>The date the support starts, in the delivery state: the catalogue row valid on it prices the line.</summary>
    public DateOnly ServiceDate { get; init; }
    /// <summary>Local time the support starts and ends, on time-based lines.</summary>
    public TimeOnly? StartTime { get; init; }
    public DateOnly? EndDate { get; init; }
    public TimeOnly? EndTime { get; init; }
    public string Band { get; init; } = string.Empty;
    public ClaimDayType? DayType { get; init; }
    /// <summary>The budget category of the item (PACE number): 1 Assistance with Daily Life, 4 Social, Economic and Community Participation, 16 Home and Living.</summary>
    public int? PaceCategory { get; init; }
    public PlannedLineFlags Flags { get; init; }
    public PlanFailureReason? Unpriced { get; init; }
    /// <summary>The item's catalogue flag allows a short-notice cancellation claim (NDIS-CODES 8.1): the terms belong in the agreement.</summary>
    public bool ShortNoticeCancellationAllowed { get; init; }
    public PlannedLineTrace Trace { get; init; } = new();

    public bool IsPriced => ItemCode is not null && Unpriced is null;
    public bool Review => (Flags & PlannedLineFlags.Review) != 0;
    public bool HolidayExposure => (Flags & PlannedLineFlags.HolidayExposure) != 0;
    public bool Provisional => (Flags & PlannedLineFlags.Provisional) != 0;

    [JsonIgnore] public DateTime? StartLocal => StartTime is { } t ? ServiceDate.ToDateTime(t) : null;
    [JsonIgnore] public DateTime? EndLocal => EndTime is { } t && EndDate is { } d ? d.ToDateTime(t) : null;
}

/// <summary>Something a person has to look at, deduplicated: the same reason on the same block is one issue with a count and the first date it was met.</summary>
public sealed record PlanIssue(string BlockId, PlanFailureReason Reason, string Message, int Count, DateOnly? FirstDate);

/// <summary>A notice about the whole quote rather than one line, for example that the provider's registration groups have not been confirmed.</summary>
public sealed record PlanNotice(string Code, string Message, int? OpenQuestion);

/// <summary>An occurrence that met a public holiday in its delivery state, and what was decided and what it costs (NDIS-CODES 11.2 example 5).</summary>
public sealed record HolidayOccurrence(
    string BlockId, DateOnly Date, string HolidayName, string? State, HolidayDecision Decision, bool Skipped,
    decimal? AtHolidayRates, decimal? AtOrdinaryRates, decimal? Uplift);

/// <summary>An open question for the owner or the plan manager (NDIS-CODES 11.3) that the quote depends on and the engine flagged instead of guessing.</summary>
public sealed record OwnerQuestion(int Number, string Text);

public sealed record CategoryTotal(int PaceCategory, string Name, decimal Amount, decimal Hours);

public sealed record BlockTotal(string BlockId, decimal Amount, decimal SupportHours, int Occurrences, int SkippedOccurrences);

/// <summary>Totals of a quote, over every priced line.</summary>
public sealed record PlanTotals
{
    public decimal Amount { get; init; }
    /// <summary>Hours of support (support lines and the active hours of a sleepover), not travel time or centre hours.</summary>
    public decimal SupportHours { get; init; }
    public int LineCount { get; init; }
    public int UnpricedLines { get; init; }
    public int ReviewLines { get; init; }
    public int ProvisionalLines { get; init; }
    /// <summary>Occurrences that met a holiday, and what the holiday adds to the plan over the same support on an ordinary day.</summary>
    public int HolidayOccurrences { get; init; }
    public decimal HolidayUplift { get; init; }
    public IReadOnlyList<CategoryTotal> ByCategory { get; init; } = Array.Empty<CategoryTotal>();
    public IReadOnlyList<BlockTotal> ByBlock { get; init; } = Array.Empty<BlockTotal>();
}

/// <summary>What the engine prices: the blocks, the agreement period, the provider's settings, a catalogue snapshot and the holidays of the states involved.</summary>
public sealed record PlanQuoteRequest
{
    public IReadOnlyList<PlanBlock> Blocks { get; init; } = Array.Empty<PlanBlock>();
    /// <summary>The agreement period, first and last day included. An occurrence belongs to the period by the date it starts.</summary>
    public DateOnly PeriodFrom { get; init; }
    public DateOnly PeriodTo { get; init; }
    public PlanPricingPolicy Policy { get; init; } = PlanPricingPolicy.Default;
    /// <summary>Every catalogue row that can price a service in the period (the engine never writes to them).</summary>
    public IReadOnlyCollection<SupportCatalogueItem> Catalogue { get; init; } = Array.Empty<SupportCatalogueItem>();
    /// <summary>The synced public holidays and the override rows, as one list.</summary>
    public IReadOnlyCollection<HolidayEntry> Holidays { get; init; } = Array.Empty<HolidayEntry>();
    /// <summary>
    /// The (state, year) pairs the holiday list is known to cover (a year the feed has synced for that state, or for every state). The engine says so when the
    /// period reaches a year of a delivery state that is not here; null means it was not asked, and nothing is said.
    /// </summary>
    public IReadOnlyCollection<HolidayCoverage>? HolidayCoverage { get; init; }
    /// <summary>The date of the last holiday override row (the owner-maintained gaps and part-day holidays); the engine says so when the period runs past it. <see cref="DateOnly.MinValue"/> means there are none; null means it was not asked.</summary>
    public DateOnly? HolidayOverridesThrough { get; init; }
}

/// <summary>The result of pricing a set of blocks over a period.</summary>
public sealed record PlanQuote
{
    public DateOnly PeriodFrom { get; init; }
    public DateOnly PeriodTo { get; init; }
    public IReadOnlyList<PlannedLine> Lines { get; init; } = Array.Empty<PlannedLine>();
    public IReadOnlyList<PlanIssue> Issues { get; init; } = Array.Empty<PlanIssue>();
    public IReadOnlyList<PlanNotice> Notices { get; init; } = Array.Empty<PlanNotice>();
    public IReadOnlyList<HolidayOccurrence> HolidayOccurrences { get; init; } = Array.Empty<HolidayOccurrence>();
    public IReadOnlyList<OwnerQuestion> OpenQuestions { get; init; } = Array.Empty<OwnerQuestion>();
    public PlanTotals Totals { get; init; } = new();

    /// <summary>True while anything needs a person: an issue, or a line flagged Review. A plan in this state is not ready to approve.</summary>
    public bool NeedsReview => Issues.Count > 0 || Totals.ReviewLines > 0;
}

/// <summary>
/// The short-notice cancellation rule for disability support workers (NDIS-CODES 8.1 and 11.2 example 10): a participant who cancels with less than 7
/// days' notice may be billed up to 100% of the planned line, at the planned rate (a group line keeps its group rate, and the others in the group
/// are billed as though everyone attended). A program of support is exempt, and an item whose catalogue flag does not allow it never is. The terms
/// belong in the service agreement; this is only the ceiling the plan implies.
/// </summary>
public static class PlanCancellation
{
    public const int ShortNoticeDays = 7;

    public static decimal MaximumClaim(PlannedLine line, int noticeDays, bool programOfSupport = false)
    {
        ArgumentNullException.ThrowIfNull(line);
        return !programOfSupport && line.IsPriced && line.ShortNoticeCancellationAllowed && noticeDays < ShortNoticeDays ? line.Total : 0m;
    }
}

/// <summary>The questions of NDIS-CODES 11.3 that the engine can depend on (the others concern the owner's choices, which the provider settings hold).</summary>
public static class OwnerQuestions
{
    public static IReadOnlyList<OwnerQuestion> All { get; } = new[]
    {
        new OwnerQuestion(1, "Which registration groups does the provider hold (0107, 0104, 0125, 0136, 0115, 0108)? The builder assumes all six until somebody confirms."),
        new OwnerQuestion(2, "Group trips: bill under registration group 0125 or 0136, and does a hired holiday house count as a centre for Centre Capital Cost?"),
        new OwnerQuestion(3, "For each short-term accommodation participant: the legacy per-day items or the new hourly plus accommodation items, and what is the plan budget by category?"),
        new OwnerQuestion(4, "Crossing policy A (split) or B (higher of)? Are participants told?"),
        new OwnerQuestion(5, "Group divisor edge cases (NDIA, in writing): the sleepover and worker accommodation lines, two workers for several participants, and a headcount that changes during a support."),
        new OwnerQuestion(6, "Provider travel time caps and the per-kilometre rates for 2026-27 are not published: the 2025-26 values are used and marked provisional."),
        new OwnerQuestion(7, "Can intercity coach hire count as activity-based transport on a supported holiday, and how is worker accommodation recovered?"),
        new OwnerQuestion(8, "Part-day and regional public holidays, and Boxing Day and Anzac Day falling on a weekend: the override table is maintained by the owner."),
        new OwnerQuestion(9, "Cancellation terms: 7 days for disability support workers, 2 clear business days for others; programs of support."),
        new OwnerQuestion(10, "Self-managed and private participants: may an agreed price exceed the limit?"),
        new OwnerQuestion(11, "The price update expected after 1 December 2026, differentiated pricing from 1 January 2027, and the provider's registered status."),
        new OwnerQuestion(12, "Plan wording, and the provider's GST status."),
        new OwnerQuestion(13, "Overnight supports on the nights the clocks change: the builder counts elapsed hours for the 8 hour sleepover test, so a window of 8 hours on the clock is 7 hours the night the clocks go forward and is priced hourly (and a 7 hour window is a sleepover the night they go back). The schedule gives no example: which reading does NDIA apply?"),
        new OwnerQuestion(14, "Active hours of a sleepover that starts on a Saturday or a Sunday: the builder does not know when in the night they are worked, so it prices them at the rate of the day the sleepover starts. Hours worked after midnight may be at the next day's rate (Sunday's is higher than Saturday's, Monday's lower than Sunday's). Say when they are worked, or confirm that the day the sleepover starts decides."),
    };

    public static OwnerQuestion Get(int number) => All.Single(q => q.Number == number);
}
