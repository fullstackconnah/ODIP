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
    /// <summary>The most blocks, days and dated occurrences one quote prices, so a request cannot ask for an unbounded amount of work or answer (20,000 is 54 blocks every day for a year).</summary>
    public const int MaxBlocks = 200, MaxPeriodDays = 800, MaxOccurrences = 20_000;

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
        else
        {
            var pricer = new OccurrencePricer(policy, new PlanCatalogue(request.Catalogue ?? Array.Empty<SupportCatalogueItem>()), new HolidayCalendar(request.Holidays ?? Array.Empty<HolidayEntry>()));
            var seen = new HashSet<string>(StringComparer.Ordinal);

            foreach (var block in blocks)
            {
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
                }

                lines.AddRange(blockLines);
                var priced = blockLines.Where(l => l.IsPriced).ToList();
                blockTotals.Add(new BlockTotal(id, priced.Sum(l => l.Total), SupportHours(priced), occurrences, skipped));
            }
        }

        return Assemble(request, lines, issues.ToList(), notices, holidayOccurrences, blockTotals);
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
            HolidayOccurrences = holidayOccurrences, OpenQuestions = questions, Totals = totals,
        };
    }

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

        public void Add(string blockId, PlanFailureReason reason, string message, DateOnly? date)
        {
            var key = (blockId, reason, message);
            if (!_index.TryGetValue(key, out var entry))
            {
                entry = new Entry { BlockId = blockId, Reason = reason, Message = message, First = date };
                _index[key] = entry;
                _entries.Add(entry);
            }
            entry.Count++;
        }

        public IReadOnlyList<PlanIssue> ToList() => _entries.Select(e => new PlanIssue(e.BlockId, e.Reason, e.Message, e.Count, e.First)).ToList();
    }
}
