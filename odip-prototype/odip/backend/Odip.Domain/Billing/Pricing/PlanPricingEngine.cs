using System.Globalization;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;

namespace Odip.Domain.Billing.Pricing;

/// <summary>
/// The plan builder's pricing engine (phase B): turns a participant's weekly support blocks and an agreement period into dated claim lines and
/// prices (NDIS-CODES 11.2). It is pure and deterministic: no clock, no database and no randomness, every input is on the request, so the same
/// request always gives the same quote, and a later catalogue import (new rows with later start dates) cannot change a line for an earlier
/// service date. Prices are never constants: each is the catalogue maximum for (item, zone, service date) found through the code classification
/// map and the date-effective lookup, times workers over participants present, floored to the cent.
/// </summary>
public static class PlanPricingEngine
{
    /// <summary>
    /// The most blocks, days, dated occurrences and estimated lines one quote prices, so a request under the body limit cannot ask for an unbounded amount of work
    /// or answer. 25,000 occurrences is 200 blocks of one weekday each over 800 days; the line estimate (<see cref="PlanBlock.MaxLinesPerOccurrence"/> an occurrence)
    /// is what bounds the answer: a block's headcount changes and companions make more lines per occurrence.
    /// </summary>
    public const int MaxBlocks = 200, MaxPeriodDays = 800, MaxOccurrences = 25_000, MaxEstimatedLines = 100_000;

    /// <summary>The years an agreement period may fall in: far inside what date arithmetic can hold, so an occurrence that ends the next day can never overflow.</summary>
    public const int FirstYear = 2000, LastYear = 2100;

    private static readonly ShiftPatternExpander Expander = new();

    private static readonly IReadOnlyDictionary<int, string> PaceNames = new Dictionary<int, string>
    {
        [1] = "Assistance with Daily Life",
        [2] = "Transport",
        [4] = "Assistance with Social, Economic and Community Participation",
        [16] = "Home and Living",
    };

    public static PlanQuote Quote(PlanQuoteRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var policy = request.Policy ?? PlanPricingPolicy.Default;
        var issues = new IssueLog();
        var notices = new List<PlanNotice>();
        var lines = new List<PlannedLine>();
        var holidayOccurrences = new List<HolidayOccurrence>();
        var blockTotals = new List<BlockTotal>();

        if (!policy.RegistrationGroupsConfirmed)
            notices.Add(new PlanNotice("registration-groups-not-confirmed",
                "The registration groups the provider holds have not been confirmed: the builder assumes all six (0107, 0104, 0125, 0136, 0115, 0108). Confirm them in the provider settings.", 1));

        var blocks = request.Blocks ?? Array.Empty<PlanBlock>();
        if (request.PeriodFrom > request.PeriodTo)
            issues.Add(string.Empty, PlanFailureReason.InvalidInput, "The agreement period ends before it starts.", null);
        else if (request.PeriodFrom.Year < FirstYear || request.PeriodTo.Year > LastYear)
            issues.Add(string.Empty, PlanFailureReason.InvalidInput, string.Create(CultureInfo.InvariantCulture, $"The agreement period must fall between the years {FirstYear} and {LastYear}."), null);
        else if (request.PeriodTo.DayNumber - request.PeriodFrom.DayNumber + 1 > MaxPeriodDays)
            issues.Add(string.Empty, PlanFailureReason.InvalidInput, string.Create(CultureInfo.InvariantCulture, $"The agreement period is longer than {MaxPeriodDays} days."), null);
        else if (blocks.Count > MaxBlocks)
            issues.Add(string.Empty, PlanFailureReason.InvalidInput, string.Create(CultureInfo.InvariantCulture, $"A quote prices at most {MaxBlocks} blocks."), null);
        else if (CountOccurrences(blocks, request.PeriodFrom, request.PeriodTo) > MaxOccurrences)
            issues.Add(string.Empty, PlanFailureReason.InvalidInput,
                string.Create(CultureInfo.InvariantCulture, $"The blocks and period make more than {MaxOccurrences:N0} dated occurrences: shorten the period or price fewer blocks."), null);
        else if (EstimateLines(blocks, request.PeriodFrom, request.PeriodTo) is var estimate && estimate > MaxEstimatedLines)
            issues.Add(string.Empty, PlanFailureReason.InvalidInput,
                string.Create(CultureInfo.InvariantCulture, $"The blocks and period would make about {estimate:N0} lines, more than the {MaxEstimatedLines:N0} one quote prices: shorten the period, price fewer blocks, or use fewer headcount changes."), null);
        else
        {
            var pricer = new OccurrencePricer(policy, new PlanCatalogue(request.Catalogue ?? Array.Empty<SupportCatalogueItem>()), new HolidayCalendar(request.Holidays ?? Array.Empty<HolidayEntry>()), request.ZoneLookup);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var states = new SortedSet<string>(StringComparer.Ordinal);
            var runsPastTheLastDay = false;
            var windows = new List<OccurrenceWindow>();

            for (var blockIndex = 0; blockIndex < blocks.Count; blockIndex++)
            {
                var block = blocks[blockIndex];
                if (block is null)
                {
                    issues.Add(string.Empty, PlanFailureReason.InvalidInput, "A block in the list is missing.", null);
                    continue;
                }

                // A block's id is a string the client chose and may be missing: every issue and total below is keyed on one that is never null.
                var id = block.Id ?? string.Empty;
                if (!seen.Add(id))
                {
                    issues.Add(id, PlanFailureReason.InvalidInput, $"Block '{id}': another block has the same id; ids must be unique in a quote.", null);
                    continue;
                }

                var messages = block.Validate();
                if (messages.Count > 0)
                {
                    foreach (var message in messages) issues.Add(id, PlanFailureReason.InvalidInput, message, null);
                    continue;
                }

                if (Refuse(block, policy) is { } refusal)
                {
                    issues.Add(id, refusal.Reason, refusal.Message, null);
                    continue;
                }

                states.Add(block.Location.State.Trim().ToUpperInvariant());
                runsPastTheLastDay |= block.EndsNextDay && block.Days.Contains(request.PeriodTo.DayOfWeek);

                var occurrences = 0;
                var skipped = 0;
                var blockLines = new List<PlannedLine>();
                foreach (var date in Dates(block, request.PeriodFrom, request.PeriodTo))
                {
                    var result = pricer.Price(block, date);
                    foreach (var (reason, message) in result.Issues) issues.Add(id, reason, message, date);

                    if (result.Holiday is { } holiday)
                    {
                        var state = holiday.State ?? block.Location.State.Trim().ToUpperInvariant();
                        if (result.Skipped)
                        {
                            holidayOccurrences.Add(new HolidayOccurrence(id, date, holiday.Name, state, block.OnPublicHoliday, true, null, null, null));
                            skipped++;
                            continue;
                        }

                        // What the same support costs on an ordinary day: the exposure the plan carries because of the holiday.
                        var atHoliday = result.PricedTotal;
                        var atOrdinary = pricer.Price(block, date, ignoreHolidays: true).PricedTotal;
                        holidayOccurrences.Add(new HolidayOccurrence(id, date, holiday.Name, state, block.OnPublicHoliday, false, atHoliday, atOrdinary, atHoliday - atOrdinary));
                    }

                    occurrences++;
                    blockLines.AddRange(result.Lines);
                    var windowStart = date.ToDateTime(block.Start);
                    windows.Add(new OccurrenceWindow(blockIndex, id, date, windowStart, windowStart.AddMinutes(block.DurationMinutes)));
                }

                lines.AddRange(blockLines);
                var priced = blockLines.Where(l => l.IsPriced).ToList();
                blockTotals.Add(new BlockTotal(id, priced.Sum(l => l.Total), SupportHours(priced), occurrences, skipped));
            }

            DetectOverlaps(windows, issues);
            AddHolidayNotices(notices, request, states, runsPastTheLastDay);
        }

        return Assemble(request, lines, issues.ToList(), notices, holidayOccurrences, blockTotals);
    }

    /// <summary>One priced occurrence of a block as the span of the clock it covers: what two blocks are compared on.</summary>
    private readonly record struct OccurrenceWindow(int BlockIndex, string BlockId, DateOnly Date, DateTime Start, DateTime End);

    /// <summary>
    /// Blocks that are on at the same time on the same date are each priced in full, so the same participant's hour would be billed under two items. NDIS-CODES 6
    /// lets a second worker's time be claimed only when both directly support the participant, which is one block with Workers = 2, so an overlap is a Review issue
    /// naming both blocks, once per pair of blocks with a count of the occurrences affected and the date of the first (the named block's own occurrence).
    /// Skipped occurrences and refused blocks are not in the list.
    /// </summary>
    private static void DetectOverlaps(List<OccurrenceWindow> windows, IssueLog issues)
    {
        windows.Sort((a, b) => a.Start != b.Start ? a.Start.CompareTo(b.Start) : a.BlockIndex.CompareTo(b.BlockIndex));
        var active = new List<OccurrenceWindow>();
        var pairs = new Dictionary<(int First, int Second), (string FirstId, string SecondId, int Count, DateOnly Date)>();
        foreach (var window in windows)
        {
            active.RemoveAll(other => other.End <= window.Start);
            foreach (var other in active)
            {
                if (other.BlockIndex == window.BlockIndex) continue;
                // The earlier block of the pair in the request is the one the issue is about.
                var (first, second) = other.BlockIndex < window.BlockIndex ? (other, window) : (window, other);
                var key = (first.BlockIndex, second.BlockIndex);
                pairs[key] = pairs.TryGetValue(key, out var seen) ? seen with { Count = seen.Count + 1 } : (first.BlockId, second.BlockId, 1, first.Date);
            }

            active.Add(window);
        }

        // One issue per pair of blocks, in request order, built once however many occurrences overlap.
        foreach (var (_, pair) in pairs.OrderBy(entry => entry.Key.First).ThenBy(entry => entry.Key.Second))
            issues.Add(pair.FirstId, PlanFailureReason.BlocksOverlap,
                $"Blocks '{pair.FirstId}' and '{pair.SecondId}' are on at the same time on the same day, so the same participant's time would be priced twice. For two workers at once use Workers = 2 on one block; otherwise move one of them.",
                pair.Date, pair.Count);
    }

    /// <summary>
    /// Says so when the holiday calendar cannot be trusted for the period: a year with no rows for a delivery state (the feed stops, or has not synced), or a period
    /// that runs past the last override row. Without rows the engine prices a holiday as an ordinary day, and that is a quiet error of 122% on a weekday.
    /// </summary>
    private static void AddHolidayNotices(List<PlanNotice> notices, PlanQuoteRequest request, IReadOnlyCollection<string> states, bool runsPastTheLastDay)
    {
        if (states.Count == 0) return;

        if (request.HolidayCoverage is { } coverage)
        {
            var lastYear = runsPastTheLastDay ? request.PeriodTo.AddDays(1).Year : request.PeriodTo.Year;   // an occurrence on the last day can end on the next
            var missing = new List<string>();
            foreach (var state in states)
                for (var year = request.PeriodFrom.Year; year <= lastYear; year++)
                    if (!coverage.Any(c => c.Year == year && (c.State is null || string.Equals(c.State.Trim(), state, StringComparison.OrdinalIgnoreCase))))
                        missing.Add(string.Create(CultureInfo.InvariantCulture, $"{state} {year}"));

            if (missing.Count > 0)
                notices.Add(new PlanNotice("holiday-calendar-missing",
                    $"The public holiday calendar has no rows for {string.Join(", ", missing)}: holidays in those years are priced as ordinary days until the calendar is synced or the days are added.", 8));
        }

        if (request.HolidayOverridesThrough is { } through && request.PeriodTo > through)
            notices.Add(new PlanNotice("holiday-overrides-end",
                through == DateOnly.MinValue
                    ? "There are no public holiday overrides stored: a part-day holiday, or Boxing Day or Anzac Day on a weekend, that the synced calendar leaves out is priced as an ordinary day."
                    : string.Create(CultureInfo.InvariantCulture, $"The public holiday overrides (the gaps in the synced calendar and the part-day holidays) run to {through:yyyy-MM-dd} and this period runs to {request.PeriodTo:yyyy-MM-dd}: a part-day holiday, or Boxing Day or Anzac Day on a weekend, after that date may be missing and is priced as an ordinary day."), 8));
    }

    // ── Refusing a block ──────────────────────────────────────────────────────────

    /// <summary>A block the provider's settings do not allow: legacy STA, or a family whose registration group the provider does not hold. Nothing is priced from it.</summary>
    private static (PlanFailureReason Reason, string Message)? Refuse(PlanBlock block, PlanPricingPolicy policy)
    {
        if (block.SupportType == PlanSupportType.StaSupport && !policy.StaUsesHourlyAndAccommodation)
            return (PlanFailureReason.StaLegacyNotSupported,
                $"Block '{block.Id}': short-term accommodation is set to the legacy per-day items, which the builder does not offer (they end on 30 June 2027). Use the hourly support items plus accommodation nights.");

        var group = OccurrencePricer.RegistrationGroupOf(block, policy);
        if (!policy.Holds(group))
        {
            var family = new ItemNeed(OccurrencePricer.FamilyOf(block, policy), block.Intensity, null, group).FamilyName;
            return (PlanFailureReason.RegistrationGroupNotHeld, $"Block '{block.Id}': {family} needs registration group {group}, which the provider does not hold.");
        }

        return null;
    }

    // ── Occurrences ───────────────────────────────────────────────────────────────

    /// <summary>The dates the block's days fall on inside the period, oldest first. The weekly expansion is the roster's own <see cref="ShiftPatternExpander"/>.</summary>
    private static List<DateOnly> Dates(PlanBlock block, DateOnly from, DateOnly to) =>
        block.Days.Where(day => Enum.IsDefined(day)).Distinct()
            .SelectMany(day => Expander.Occurrences(new ShiftPattern { DayOfWeek = day, EffectiveFrom = from, EffectiveTo = to, IsActive = true }, from, to))
            .Distinct()
            .OrderBy(date => date)
            .ToList();

    /// <summary>What the quote would produce at most: every valid block's dated occurrences times its own upper bound of lines. A block that fails validation prices nothing and adds nothing.</summary>
    private static long EstimateLines(IReadOnlyList<PlanBlock> blocks, DateOnly from, DateOnly to)
    {
        long total = 0;
        foreach (var block in blocks)
            if (block?.Days is not null && block.Validate().Count == 0)
                total += (long)Dates(block, from, to).Count * block.MaxLinesPerOccurrence;
        return total;
    }

    private static int CountOccurrences(IReadOnlyList<PlanBlock> blocks, DateOnly from, DateOnly to) =>
        blocks.Where(block => block?.Days is not null).Sum(block => Dates(block, from, to).Count);

    // ── Totals ────────────────────────────────────────────────────────────────────

    private static decimal SupportHours(IEnumerable<PlannedLine> priced) =>
        priced.Where(l => l.Kind is PlannedLineKind.Support or PlannedLineKind.SleepoverActiveHours && l.Unit == "H").Sum(l => l.Qty);

    private static PlanQuote Assemble(PlanQuoteRequest request, List<PlannedLine> lines, IReadOnlyList<PlanIssue> issues, List<PlanNotice> notices,
        List<HolidayOccurrence> holidayOccurrences, List<BlockTotal> blockTotals)
    {
        var priced = lines.Where(l => l.IsPriced).ToList();
        var byCategory = priced
            .GroupBy(l => l.PaceCategory ?? 0)
            .OrderBy(g => g.Key)
            .Select(g => new CategoryTotal(g.Key, g.Key == 0 ? "Category not stated" : PaceNames.TryGetValue(g.Key, out var name) ? name : $"Category {g.Key.ToString(CultureInfo.InvariantCulture)}",
                g.Sum(l => l.Total), SupportHours(g)))
            .ToList();

        var questions = lines.SelectMany(l => l.Trace.OpenQuestions)
            .Concat(notices.Where(n => n.OpenQuestion is not null).Select(n => n.OpenQuestion!.Value))
            .Distinct().OrderBy(n => n)
            .Select(OwnerQuestions.Get)
            .ToList();

        var totals = new PlanTotals
        {
            Amount = priced.Sum(l => l.Total),
            SupportHours = SupportHours(priced),
            LineCount = lines.Count,
            UnpricedLines = lines.Count(l => !l.IsPriced),
            ReviewLines = lines.Count(l => l.Review),
            ProvisionalLines = lines.Count(l => l.Provisional),
            HolidayOccurrences = holidayOccurrences.Count,
            HolidayUplift = holidayOccurrences.Sum(h => h.Uplift ?? 0m),
            ByCategory = byCategory,
            ByBlock = blockTotals,
        };

        return new PlanQuote
        {
            PeriodFrom = request.PeriodFrom, PeriodTo = request.PeriodTo, Lines = lines, Issues = issues, Notices = notices,
            HolidayOccurrences = holidayOccurrences, OpenQuestions = questions, Totals = totals, TimeBasis = TimeBasisOf(request.ZoneLookup),
        };
    }

    /// <summary>The clock the quote's hours are counted on: when even the fallback zone is not in the host's tz database every zone is the fixed +10:00.</summary>
    private static string TimeBasisOf(Func<string, TimeZoneInfo>? lookup) =>
        ReferenceEquals(ProviderLocalTime.ResolveZone(ProviderLocalTime.FallbackZoneId, lookup ?? TimeZoneInfo.FindSystemTimeZoneById), ProviderLocalTime.LastResortZone)
            ? PlanTimeBasis.FixedOffset
            : PlanTimeBasis.TzDatabase;

    /// <summary>Issues deduplicated as they arrive: the same reason and text on one block is one issue with a count and the first date it was met.</summary>
    private sealed class IssueLog
    {
        private sealed class Entry
        {
            public required string BlockId { get; init; }
            public required PlanFailureReason Reason { get; init; }
            public required string Message { get; init; }
            public int Count { get; set; }
            public DateOnly? First { get; init; }
        }

        private readonly Dictionary<(string, PlanFailureReason, string), Entry> _index = new();
        private readonly List<Entry> _entries = new();

        public void Add(string blockId, PlanFailureReason reason, string message, DateOnly? date, int times = 1)
        {
            var key = (blockId, reason, message);
            if (!_index.TryGetValue(key, out var entry))
            {
                entry = new Entry { BlockId = blockId, Reason = reason, Message = message, First = date };
                _index[key] = entry;
                _entries.Add(entry);
            }
            entry.Count += times;
        }

        public IReadOnlyList<PlanIssue> ToList() => _entries.Select(e => new PlanIssue(e.BlockId, e.Reason, e.Message, e.Count, e.First)).ToList();
    }
}
