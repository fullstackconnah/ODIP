using System.Globalization;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Domain.Billing.Pricing;

/// <summary>What pricing one occurrence of a block produced.</summary>
internal sealed class OccurrenceResult
{
    public List<PlannedLine> Lines { get; } = new();
    public List<(PlanFailureReason Reason, string Message)> Issues { get; } = new();
    /// <summary>The first public holiday the occurrence touches (any hour of it), null when it meets none.</summary>
    public HolidayEntry? Holiday { get; set; }
    /// <summary>The block's decision is Skip and the occurrence meets a holiday: nothing is priced.</summary>
    public bool Skipped { get; set; }

    public decimal PricedTotal => Lines.Where(l => l.IsPriced).Sum(l => l.Total);
}

/// <summary>Money and quantity arithmetic of the engine. Every price is floored to the cent so a line can never exceed the legal maximum.</summary>
internal static class PlanMoney
{
    public static decimal FloorToCent(decimal value) => Math.Floor(value * 100m) / 100m;

    /// <summary>The maximum for the item x workers / participants present, floored to the cent (NDIS-CODES 6 and 11.2 step 6).</summary>
    public static decimal GroupPrice(decimal maximum, int workers, int participants) => FloorToCent(maximum * workers / participants);

    public static decimal Hours(int minutes) => Math.Round(minutes / 60m, 4, MidpointRounding.AwayFromZero);

    public static decimal LineTotal(decimal unitPrice, int minutes) => FloorToCent(unitPrice * minutes / 60m);
}

/// <summary>
/// Prices one dated occurrence of a block (NDIS-CODES 11.2 steps 2 to 8): resolves the delivery state's holidays, splits the occurrence into
/// supports at the band boundaries, the day changes, a changing headcount and a sleepover, applies the crossing policy, prices each support from the
/// catalogue row valid on its service date, and adds the companion lines. It reads no clock and no database, so the same input is always the same output.
/// </summary>
internal sealed class OccurrencePricer
{
    private const int SleepoverMinutes = 8 * 60;
    // The two STA accommodation items share one family in the classification map; their sequences (NDIS-CODES 11.1) tell them apart.
    private const string ParticipantNightSequence = "250", WorkerNightSequence = "251";

    private readonly PlanPricingPolicy _policy;
    private readonly PlanCatalogue _catalogue;
    private readonly HolidayCalendar _calendar;
    private readonly Dictionary<string, TimeZoneInfo> _zones = new(StringComparer.Ordinal);
    private readonly Dictionary<(DateOnly Date, string State, bool Ignore), IReadOnlyList<DaySpan>> _spans = new();
    private readonly Dictionary<(ItemNeed Need, DateOnly Date, PriceZone Zone), ItemChoice> _choices = new();

    public OccurrencePricer(PlanPricingPolicy policy, PlanCatalogue catalogue, HolidayCalendar calendar)
    {
        _policy = policy;
        _catalogue = catalogue;
        _calendar = calendar;
    }

    // ── What a block needs from the catalogue ─────────────────────────────────────

    internal static SupportFamily FamilyOf(PlanBlock block, PlanPricingPolicy policy) => block.SupportType switch
    {
        PlanSupportType.PersonalCare => SupportFamily.PersonalCare,
        PlanSupportType.CommunityAccess => SupportFamily.CommunityAccess,
        PlanSupportType.GroupActivity => policy.GroupOutings == GroupOutingFamily.CommunityAccess ? SupportFamily.CommunityAccess : SupportFamily.GroupActivity,
        _ => SupportFamily.StaSupport,
    };

    /// <summary>The registration group the block's support items sit in: high intensity is RG 0104 whatever the family.</summary>
    internal static string RegistrationGroupOf(PlanBlock block, PlanPricingPolicy policy) => FamilyOf(block, policy) switch
    {
        SupportFamily.PersonalCare => block.Intensity == SupportIntensity.HighIntensity ? "0104" : "0107",
        SupportFamily.CommunityAccess => block.Intensity == SupportIntensity.HighIntensity ? "0104" : "0125",
        SupportFamily.GroupActivity => block.Intensity == SupportIntensity.HighIntensity ? "0104" : "0136",
        _ => "0115",
    };

    private ItemNeed SupportNeed(PlanBlock block, ClaimDayType dayType) =>
        new(FamilyOf(block, _policy), block.Intensity, dayType, RegistrationGroupOf(block, _policy));

    // ── Context ───────────────────────────────────────────────────────────────────

    private sealed class Occurrence
    {
        public required PlanBlock Block { get; init; }
        public required DateOnly Date { get; init; }
        public required string State { get; init; }
        public required TimeZoneInfo Zone { get; init; }
        public required DateTime Start { get; init; }
        public required DateTime End { get; init; }
        public required bool IgnoreHolidays { get; init; }
        public required List<(DateTime At, int Participants)> Headcount { get; init; }
        public OccurrenceResult Result { get; } = new();
        /// <summary>Every line of the occurrence needs a person (a worker who may sleep in a window that is not a sleepover).</summary>
        public bool ReviewAll { get; set; }
        /// <summary>The priced hourly support lines with their catalogue rows, which the companion lines are priced against.</summary>
        public List<(PlannedLine Line, ItemChoice Choice)> Support { get; } = new();
        public PriceZone PriceZone => Block.Location.Zone;
    }

    private sealed record Piece(DateTime Start, DateTime End, bool Sleepover);

    private sealed record Segment(DateTime Start, DateTime End, DaySpan Span, int Participants, int Minutes, int WallMinutes);

    // ── The occurrence ────────────────────────────────────────────────────────────

    public OccurrenceResult Price(PlanBlock block, DateOnly date, bool ignoreHolidays = false)
    {
        var state = block.Location.State.Trim().ToUpperInvariant();
        var start = date.ToDateTime(block.Start);
        var end = (block.EndsNextDay ? date.AddDays(1) : date).ToDateTime(block.End);

        var headcount = block.Changes
            .Select(c => (At: start.AddMinutes(block.OffsetFromStart(c.From)), c.ParticipantsPresent))
            .OrderBy(c => c.At)
            .ToList();
        var occ = new Occurrence { Block = block, Date = date, State = state, Zone = ZoneOf(state), Start = start, End = end, IgnoreHolidays = ignoreHolidays, Headcount = headcount };

        if (!ignoreHolidays)
        {
            occ.Result.Holiday = FirstHoliday(occ, start, end);
            if (occ.Result.Holiday is not null && block.OnPublicHoliday == HolidayDecision.Skip)
            {
                occ.Result.Skipped = true;
                return occ.Result;
            }
        }

        var sleepover = PlanSleepover(occ);
        var pieces = new List<Piece>();
        if (sleepover is { } window)
        {
            if (window.Start > start) pieces.Add(new Piece(start, window.Start, false));
            pieces.Add(new Piece(window.Start, window.End, true));
            if (end > window.End) pieces.Add(new Piece(window.End, end, false));
        }
        else
        {
            pieces.Add(new Piece(start, end, false));
        }

        foreach (var piece in pieces)
        {
            if (piece.Sleepover) PriceSleepover(occ, piece);
            else PriceHourlyPiece(occ, piece);
        }

        AddCentreCapital(occ);
        AddProviderTravel(occ);
        AddActivityTransport(occ);
        AddAccommodation(occ);

        if (occ.ReviewAll)
            for (var i = 0; i < occ.Result.Lines.Count; i++)
                occ.Result.Lines[i] = occ.Result.Lines[i] with { Flags = occ.Result.Lines[i].Flags | PlannedLineFlags.Review };
        return occ.Result;
    }

    // ── Time ──────────────────────────────────────────────────────────────────────

    private TimeZoneInfo ZoneOf(string state)
    {
        if (!_zones.TryGetValue(state, out var zone))
            _zones[state] = zone = ProviderLocalTime.ResolveZone(StateTimeZoneMap.Resolve(state));
        return zone;
    }

    /// <summary>Elapsed minutes between two wall-clock readings in the delivery zone: an hour is added or lost on the two nights a year the clocks change.</summary>
    private static int RealMinutes(DateTime from, DateTime to, TimeZoneInfo zone) =>
        (int)Math.Round((ProviderLocalTime.LocalToUtc(to, zone) - ProviderLocalTime.LocalToUtc(from, zone)).TotalMinutes);

    private IReadOnlyList<DaySpan> Spans(DateOnly date, string state, bool ignoreHolidays)
    {
        var key = (date, state, ignoreHolidays);
        if (!_spans.TryGetValue(key, out var spans))
            _spans[key] = spans = DayBands.For(date, ignoreHolidays ? Array.Empty<HolidayEntry>() : _calendar.On(date, state));
        return spans;
    }

    private static DateTime LastDay(DateTime end) => end.TimeOfDay == TimeSpan.Zero ? end.Date.AddDays(-1) : end.Date;

    private HolidayEntry? FirstHoliday(Occurrence occ, DateTime from, DateTime to)
    {
        for (var day = from.Date; day <= LastDay(to); day = day.AddDays(1))
            foreach (var span in Spans(DateOnly.FromDateTime(day), occ.State, false))
                if (span.IsHoliday && day.AddMinutes(span.FromMinute) < to && day.AddMinutes(span.ToMinute) > from)
                    return span.Holiday;
        return null;
    }

    private bool TouchesHoliday(Occurrence occ, DateTime from, DateTime to) => !occ.IgnoreHolidays && FirstHoliday(occ, from, to) is not null;

    private static DateTime NextAtOrAfter(DateTime from, TimeOnly time)
    {
        var candidate = from.Date + time.ToTimeSpan();
        return candidate < from ? candidate.AddDays(1) : candidate;
    }

    private static DateTime NextAfter(DateTime from, TimeOnly time)
    {
        var candidate = from.Date + time.ToTimeSpan();
        return candidate <= from ? candidate.AddDays(1) : candidate;
    }

    private static int ParticipantsAt(Occurrence occ, DateTime at)
    {
        var participants = occ.Block.ParticipantsPresent;
        foreach (var change in occ.Headcount)
            if (change.At <= at) participants = change.Participants;
        return participants;
    }

    // ── Sleepover ─────────────────────────────────────────────────────────────────

    /// <summary>The window that is a sleepover (starts before and ends after midnight, 8 hours or more, the worker may sleep), or null. A worker who may sleep in a window that is not one leaves the support priced hourly and the occurrence for review.</summary>
    private (DateTime Start, DateTime End)? PlanSleepover(Occurrence occ)
    {
        var block = occ.Block;
        if (!block.WorkerMaySleep) return null;

        var from = block.SleepoverWindow is { } window ? NextAtOrAfter(occ.Start, window.From) : occ.Start;
        var to = block.SleepoverWindow is { } window2 ? NextAfter(from, window2.To) : occ.End;
        var midnight = from.Date.AddDays(1);
        var crosses = from < midnight && to > midnight;
        var real = RealMinutes(from, to, occ.Zone);

        if (crosses && real >= SleepoverMinutes) return (from, to);
        if (crosses && (to - from).TotalMinutes >= SleepoverMinutes)
            return null;   // 8 hours on the clock but fewer elapsed: the night the clocks change. Priced hourly, and not worth a person's time.

        occ.Result.Issues.Add((PlanFailureReason.SleepoverNotQualifying,
            $"Block '{block.Id}': the worker may sleep, but the window is not 8 hours or more across midnight, so it is priced hourly."));
        occ.ReviewAll = true;
        return null;
    }

    private void PriceSleepover(Occurrence occ, Piece piece)
    {
        var block = occ.Block;
        var date = DateOnly.FromDateTime(piece.Start);
        var times = (Start: TimeOnly.FromDateTime(piece.Start), EndDate: DateOnly.FromDateTime(piece.End), End: TimeOnly.FromDateTime(piece.End));
        PlannedLine Unpriced(PlanFailureReason reason, string message) => UnpricedLine(occ, PlannedLineKind.Sleepover, "Sleepover", date, piece.Start, piece.End, 1m, "E", reason, message, null);

        if (block.SupportType is PlanSupportType.CommunityAccess or PlanSupportType.GroupActivity)
        {
            const string notAvailable = "Community access and group activities have no sleepover item. Add a personal-care or short-term-accommodation block for the night: it is not mapped to another family.";
            AddUnpriced(occ, Unpriced(PlanFailureReason.SleepoverNotAvailable, notAvailable), notAvailable);
            return;
        }

        var need = new ItemNeed(SupportFamily.Sleepover, SupportIntensity.Standard, null, block.SupportType == PlanSupportType.PersonalCare ? "0107" : "0115");
        var choice = Choose(need, date, occ.PriceZone);
        if (!choice.Found) { AddUnpriced(occ, Unpriced(choice.Failure!.Value, choice.Message!), IssueText(need, choice)); return; }
        if (!UnitIs(choice, "E")) { AddUnpriced(occ, Unpriced(PlanFailureReason.UnexpectedUnit, UnitMessage(choice, "each")), UnitMessage(choice, "each")); return; }

        var participants = ParticipantsAt(occ, piece.Start);
        var unitPrice = PlanMoney.GroupPrice(choice.Price, block.Workers, participants);
        var rules = new List<string> { "sleepover:each-item", "price:catalogue-by-service-date" };
        var questions = new List<int>();
        var flags = PlannedLineFlags.None;
        if (block.Workers != 1 || participants != 1)
        {
            // Whether the group divisor applies to a sleepover is not stated anywhere (NDIS-CODES 4.4): applied, and said so.
            rules.Add("group:floor(price*workers/participants)");
            flags |= PlannedLineFlags.Provisional;
            questions.Add(5);
        }
        if (block.OnPublicHoliday == HolidayDecision.Review && TouchesHoliday(occ, piece.Start, piece.End)) flags |= PlannedLineFlags.Review;

        var real = RealMinutes(piece.Start, piece.End, occ.Zone);
        occ.Result.Lines.Add(new PlannedLine
        {
            BlockId = block.Id, Kind = PlannedLineKind.Sleepover, ItemCode = choice.Row!.ItemNumber, Unit = "E", Qty = 1m,
            UnitPrice = unitPrice, Total = PlanMoney.FloorToCent(unitPrice), ServiceDate = date,
            StartTime = times.Start, EndDate = times.EndDate, EndTime = times.End,
            Band = "Sleepover", PaceCategory = PaceOf(choice.Row), Flags = flags, ShortNoticeCancellationAllowed = AllowsCancellation(choice.Row),
            Trace = TraceOf(occ, choice, rules, questions, null, participants,
                $"Sleepover, {Hours(real)} h from {Clock(piece.Start)} to {Clock(piece.End)} on {Day(date)}: the worker may sleep, so one Each item covers the night, including up to 2 hours of active support; {GroupText(block.Workers, participants)}; {Basis(choice)}."),
        });

        var active = block.SleepoverActiveHours;
        if (active > 2m) PriceSleepoverActiveHours(occ, piece, date, (int)Math.Round((active - 2m) * 60m, MidpointRounding.AwayFromZero), participants);
    }

    /// <summary>The third and later active hours of a sleepover: at the Saturday rate on a weekday, or at the rate of the day on a Saturday, Sunday or public holiday (NDIS-CODES 4.1).</summary>
    private void PriceSleepoverActiveHours(Occurrence occ, Piece piece, DateOnly date, int minutes, int participants)
    {
        var block = occ.Block;
        var dayType = DayTypeOfDate(occ, date) switch
        {
            ClaimDayType.PublicHoliday => ClaimDayType.PublicHoliday,
            ClaimDayType.Sunday => ClaimDayType.Sunday,
            _ => ClaimDayType.Saturday,
        };
        var need = SupportNeed(block, dayType);
        var choice = Choose(need, date, occ.PriceZone);
        PlannedLine Unpriced(PlanFailureReason reason, string message) => UnpricedLine(occ, PlannedLineKind.SleepoverActiveHours, "Sleepover active hours", date, null, null, PlanMoney.Hours(minutes), "H", reason, message, dayType);
        if (!choice.Found) { AddUnpriced(occ, Unpriced(choice.Failure!.Value, choice.Message!), IssueText(need, choice)); return; }
        if (!UnitIs(choice, "H")) { AddUnpriced(occ, Unpriced(PlanFailureReason.UnexpectedUnit, UnitMessage(choice, "hourly")), UnitMessage(choice, "hourly")); return; }

        var unitPrice = PlanMoney.GroupPrice(choice.Price, block.Workers, participants);
        var rules = new List<string> { "sleepover:active-hours-beyond-2", "price:catalogue-by-service-date" };
        var flags = PlannedLineFlags.None;
        if (dayType == ClaimDayType.PublicHoliday)
        {
            flags |= PlannedLineFlags.HolidayExposure;
            if (block.OnPublicHoliday == HolidayDecision.Review) flags |= PlannedLineFlags.Review;
        }
        if (block.Workers != 1 || participants != 1) rules.Add("group:floor(price*workers/participants)");

        occ.Result.Lines.Add(new PlannedLine
        {
            BlockId = block.Id, Kind = PlannedLineKind.SleepoverActiveHours, ItemCode = choice.Row!.ItemNumber, Unit = "H", Qty = PlanMoney.Hours(minutes),
            UnitPrice = unitPrice, Total = PlanMoney.LineTotal(unitPrice, minutes), ServiceDate = date,
            Band = "Sleepover active hours", DayType = dayType, PaceCategory = PaceOf(choice.Row), Flags = flags, ShortNoticeCancellationAllowed = AllowsCancellation(choice.Row),
            Trace = TraceOf(occ, choice, rules, Array.Empty<int>(), null, participants,
                $"Active hours beyond the 2 a sleepover includes, priced at the {BandName(dayType)} rate ({(dayType == ClaimDayType.Saturday && date.DayOfWeek is not DayOfWeek.Saturday ? "Saturday rates apply on a weekday" : "the rate of the day")}) on {Day(date)}; {GroupText(block.Workers, participants)}; {Basis(choice)}."),
        });
    }

    private ClaimDayType DayTypeOfDate(Occurrence occ, DateOnly date)
    {
        var spans = Spans(date, occ.State, occ.IgnoreHolidays);
        if (spans.Any(s => s.IsHoliday && s.Holiday!.IsWholeDay)) return ClaimDayType.PublicHoliday;
        return date.DayOfWeek switch { DayOfWeek.Saturday => ClaimDayType.Saturday, DayOfWeek.Sunday => ClaimDayType.Sunday, _ => ClaimDayType.Weekday };
    }

    // ── Hourly supports ───────────────────────────────────────────────────────────

    private List<Segment> Split(Occurrence occ, DateTime from, DateTime to)
    {
        var segments = new List<Segment>();
        for (var day = from.Date; day <= LastDay(to); day = day.AddDays(1))
        {
            foreach (var span in Spans(DateOnly.FromDateTime(day), occ.State, occ.IgnoreHolidays))
            {
                var lo = Max(day.AddMinutes(span.FromMinute), from);
                var hi = Min(day.AddMinutes(span.ToMinute), to);
                if (hi <= lo) continue;

                var cuts = occ.Headcount.Select(c => c.At).Where(at => at > lo && at < hi).OrderBy(at => at).Append(hi);
                var cursor = lo;
                foreach (var cut in cuts)
                {
                    segments.Add(new Segment(cursor, cut, span, ParticipantsAt(occ, cursor), RealMinutes(cursor, cut, occ.Zone), (int)(cut - cursor).TotalMinutes));
                    cursor = cut;
                }
            }
        }

        return segments;
    }

    private static DateTime Max(DateTime a, DateTime b) => a > b ? a : b;
    private static DateTime Min(DateTime a, DateTime b) => a < b ? a : b;

    private sealed record Priced(Segment Segment, ItemChoice Choice, decimal UnitPrice, PlannedLine Line);

    private void PriceHourlyPiece(Occurrence occ, Piece piece)
    {
        var block = occ.Block;
        var segments = Split(occ, piece.Start, piece.End);
        var crossing = segments.Count > 1;
        var results = new List<(Segment Segment, Priced? Priced, PlannedLine? Unpriced, string? IssueText)>();

        foreach (var segment in segments)
        {
            var date = DateOnly.FromDateTime(segment.Start);
            var need = SupportNeed(block, segment.Span.DayType);
            var choice = Choose(need, date, occ.PriceZone);
            if (!choice.Found)
            {
                results.Add((segment, null, UnpricedSegment(occ, segment, date, choice.Failure!.Value, WithNightHint(choice, segment)), WithNightHint(IssueText(need, choice), choice, segment)));
                continue;
            }
            if (!UnitIs(choice, "H"))
            {
                results.Add((segment, null, UnpricedSegment(occ, segment, date, PlanFailureReason.UnexpectedUnit, UnitMessage(choice, "hourly")), UnitMessage(choice, "hourly")));
                continue;
            }

            var unitPrice = PlanMoney.GroupPrice(choice.Price, block.Workers, segment.Participants);
            results.Add((segment, new Priced(segment, choice, unitPrice, SegmentLine(occ, segment, choice, unitPrice, crossing)), null, null));
        }

        // Crossing policy B: one worker delivers the whole support and the headcount never changes, so the higher of the amounts applies to all
        // of it. Only when every part has an item: a gap is for a person, not for the engine to price around.
        var allPriced = results.All(r => r.Priced is not null);
        if (crossing && allPriced && _policy.Crossing == CrossingPolicy.HigherOf && block.Workers == 1 && block.Changes.Count == 0
            && TryMerge(occ, piece, results.Select(r => r.Priced!).ToList()) is { } merged)
        {
            occ.Result.Lines.Add(merged.Line);
            occ.Support.Add(merged);
            return;
        }

        // Policy B was asked for but does not apply (more than one worker, a changing headcount, or a part with no item): the parts stay split, and say so.
        var bNotApplicable = crossing && _policy.Crossing == CrossingPolicy.HigherOf;
        foreach (var (_, priced, unpriced, issueText) in results)
        {
            if (priced is not null)
            {
                var line = bNotApplicable
                    ? priced.Line with { Trace = priced.Line.Trace with { Rules = priced.Line.Trace.Rules.Append("crossing:B-not-applicable").ToList() } }
                    : priced.Line;
                occ.Result.Lines.Add(line);
                occ.Support.Add((line, priced.Choice));
            }
            else
            {
                AddUnpriced(occ, unpriced!, issueText!);
            }
        }
    }

    /// <summary>
    /// Crossing policy B: one support delivered by one worker is priced at the higher of its parts and claimed on ONE service date, the day it starts, so
    /// every part is priced from the catalogue row valid on that date. That is the rule that stops a later price import changing a support that started
    /// before it. Null when a part cannot be priced at that date: the parts then stay split and a person decides.
    /// </summary>
    private (PlannedLine Line, ItemChoice Choice)? TryMerge(Occurrence occ, Piece piece, IReadOnlyList<Priced> parts)
    {
        var block = occ.Block;
        var startDate = DateOnly.FromDateTime(piece.Start);
        var atStart = new List<(Priced Part, ItemChoice Choice, decimal Unit)>();
        foreach (var part in parts)
        {
            var choice = Choose(SupportNeed(block, part.Segment.Span.DayType), startDate, occ.PriceZone);
            if (!choice.Found || !UnitIs(choice, "H")) return null;
            atStart.Add((part, choice, PlanMoney.GroupPrice(choice.Price, block.Workers, part.Segment.Participants)));
        }

        var best = atStart.OrderByDescending(p => p.Unit).First();
        var minutes = parts.Sum(p => p.Segment.Minutes);
        var flags = parts.Aggregate(PlannedLineFlags.None, (all, p) => all | p.Line.Flags);
        var questions = parts.SelectMany(p => p.Line.Trace.OpenQuestions).Distinct().OrderBy(q => q).ToList();
        var line = SegmentLine(occ, best.Part.Segment, best.Choice, best.Unit, crossing: false);
        var summary = string.Join(" and ", atStart.Select(p => $"{p.Part.Segment.Span.Band} at ${Money(p.Unit)}"));
        var merged = line with
        {
            Qty = PlanMoney.Hours(minutes), Total = PlanMoney.LineTotal(best.Unit, minutes), ServiceDate = startDate,
            StartTime = TimeOnly.FromDateTime(piece.Start), EndDate = DateOnly.FromDateTime(piece.End), EndTime = TimeOnly.FromDateTime(piece.End),
            Flags = flags,
            Trace = line.Trace with
            {
                Rules = line.Trace.Rules.Append("crossing:B").ToList(), Policy = "B", OpenQuestions = questions,
                Why = $"Crossing policy B: one worker delivers the whole support from {Clock(piece.Start)} to {Clock(piece.End)} starting {Day(startDate)}, so the higher of its parts ({summary}, as priced on its service date) applies to all of it: {best.Part.Segment.Span.Band}; {Basis(best.Choice)}.",
            },
        };
        return (merged, best.Choice);
    }

    private PlannedLine SegmentLine(Occurrence occ, Segment segment, ItemChoice choice, decimal unitPrice, bool crossing)
    {
        var block = occ.Block;
        var date = DateOnly.FromDateTime(segment.Start);
        var span = segment.Span;
        var rules = new List<string> { "bands:" + Slug(span.Band), "price:catalogue-by-service-date" };
        var questions = new List<int>();
        var flags = PlannedLineFlags.None;

        if (span.IsHoliday)
        {
            flags |= PlannedLineFlags.HolidayExposure;
            if (block.OnPublicHoliday == HolidayDecision.Review) flags |= PlannedLineFlags.Review;
            if (span.Holiday!.IsWholeDay) rules.Add("holiday:state-calendar");
            else
            {
                // The research assumes the public holiday rate applies only inside the declared hours (NDIS-CODES 5.3): applied, and said so.
                rules.Add("holiday:part-day");
                flags |= PlannedLineFlags.Provisional;
                questions.Add(8);
            }
        }

        if (block.Workers != 1 || segment.Participants != 1) rules.Add("group:floor(price*workers/participants)");
        if (block.Changes.Count > 0)
        {
            rules.Add("headcount:segment");
            flags |= PlannedLineFlags.Provisional;
            questions.Add(5);
        }
        if (segment.Minutes != segment.WallMinutes) rules.Add("clock-change:elapsed-hours");
        if (crossing) rules.Add("crossing:A");

        return new PlannedLine
        {
            BlockId = block.Id, Kind = PlannedLineKind.Support, ItemCode = choice.Row!.ItemNumber, Unit = "H",
            Qty = PlanMoney.Hours(segment.Minutes), UnitPrice = unitPrice, Total = PlanMoney.LineTotal(unitPrice, segment.Minutes), ServiceDate = date,
            StartTime = TimeOnly.FromDateTime(segment.Start), EndDate = DateOnly.FromDateTime(segment.End), EndTime = TimeOnly.FromDateTime(segment.End),
            Band = span.Band, DayType = span.DayType, PaceCategory = PaceOf(choice.Row), Flags = flags, ShortNoticeCancellationAllowed = AllowsCancellation(choice.Row),
            Trace = TraceOf(occ, choice, rules, questions, span.Holiday?.Name, segment.Participants,
                $"{span.Band} ({BandRule(span)}) on {Day(date)}, {Clock(segment.Start)} to {Clock(segment.End)}; {GroupText(block.Workers, segment.Participants)}; {Basis(choice)}.",
                crossing ? "A" : null),
        };
    }

    private PlannedLine UnpricedSegment(Occurrence occ, Segment segment, DateOnly date, PlanFailureReason reason, string message) =>
        UnpricedLine(occ, PlannedLineKind.Support, segment.Span.Band, date, segment.Start, segment.End, PlanMoney.Hours(segment.Minutes), "H", reason, message, segment.Span.DayType);

    // ── Companions ────────────────────────────────────────────────────────────────

    private void AddCentreCapital(Occurrence occ)
    {
        var block = occ.Block;
        if (block.Setting != PlanSetting.Centre || block.SupportType is not (PlanSupportType.CommunityAccess or PlanSupportType.GroupActivity)) return;
        var minutes = occ.Support.Where(s => s.Line.Kind == PlannedLineKind.Support).Sum(s => (int)Math.Round(s.Line.Qty * 60m));
        if (minutes == 0) return;

        var date = occ.Date;
        var need = new ItemNeed(SupportFamily.CentreCapital, null, null, block.Intensity == SupportIntensity.HighIntensity ? "0104" : "0136");
        var choice = Choose(need, date, occ.PriceZone);
        if (!choice.Found) { occ.Result.Issues.Add((choice.Failure!.Value, IssueText(need, choice))); return; }
        if (!UnitIs(choice, "H")) { occ.Result.Issues.Add((PlanFailureReason.UnexpectedUnit, UnitMessage(choice, "hourly"))); return; }

        // Per participant per hour of the primary support: not divided by the group (NDIS-CODES 6, "What is not divided by group size").
        occ.Result.Lines.Add(new PlannedLine
        {
            BlockId = block.Id, Kind = PlannedLineKind.CentreCapital, ItemCode = choice.Row!.ItemNumber, Unit = "H", Qty = PlanMoney.Hours(minutes),
            UnitPrice = choice.Price, Total = PlanMoney.LineTotal(choice.Price, minutes), ServiceDate = date,
            Band = "Centre capital", PaceCategory = PaceOf(choice.Row), Flags = PlannedLineFlags.None, ShortNoticeCancellationAllowed = AllowsCancellation(choice.Row),
            Trace = TraceOf(occ, choice, new[] { "centre-capital:per-participant-hour", "price:catalogue-by-service-date" }, Array.Empty<int>(), null, block.ParticipantsPresent,
                $"Centre capital cost: the support is delivered in a centre, claimed for each participant for each hour of the primary support and not divided by the group; {Basis(choice)}."),
        });
    }

    private void AddProviderTravel(Occurrence occ)
    {
        var block = occ.Block;
        if (block.Travel is not { Claim: true } travel || !_policy.ClaimProviderTravel) return;

        var basis = occ.Support.FirstOrDefault();
        if (basis.Line is null)
        {
            occ.Result.Issues.Add((PlanFailureReason.TravelNotClaimable, $"Block '{block.Id}': there is no priced support hour to claim provider travel against."));
            return;
        }

        // The travel is claimed on the occurrence's own date at the rate of the primary support's item: the band of its first support hour, priced from
        // the row valid on THAT date (the first support hour can fall after midnight, in a later price version, and a later import must not change it).
        var rate = Choose(SupportNeed(block, basis.Line.DayType!.Value), occ.Date, occ.PriceZone);
        if (!rate.Found || !UnitIs(rate, "H")) rate = basis.Choice;
        if (rate.Row!.ProviderTravel != CatalogueClaimFlag.Yes)
        {
            occ.Result.Issues.Add((PlanFailureReason.TravelNotClaimable, $"Block '{block.Id}': {rate.Row.ItemNumber} does not allow provider travel."));
            return;
        }

        var cap = TravelCapMinutes(block.Location);
        var perLeg = cap is { } c ? Math.Min(travel.MinutesEachWay, c) : travel.MinutesEachWay;
        var legs = travel.ReturnToBase ? 2 : 1;
        var claimable = perLeg * legs;
        var sharing = travel.ParticipantsSharing;
        var questions = new List<int>();
        var flags = PlannedLineFlags.None;
        if (_policy.TravelRatesProvisional)
        {
            flags |= PlannedLineFlags.Provisional;
            questions.Add(6);
        }
        if (sharing > 1) questions.Add(5);   // the rate basis for dividing travel time across a group is unclear (NDIS-CODES 6)

        var support = basis.Line;
        var capRule = cap is null ? "travel:no-cap" : $"travel:time-cap-{cap.Value.ToString(CultureInfo.InvariantCulture)}";
        if (claimable > 0)
        {
            var qtyMinutes = (decimal)claimable / sharing;
            occ.Result.Lines.Add(new PlannedLine
            {
                BlockId = block.Id, Kind = PlannedLineKind.ProviderTravelTime, ItemCode = support.ItemCode, Unit = "H",
                Qty = Math.Round(qtyMinutes / 60m, 4, MidpointRounding.AwayFromZero), UnitPrice = rate.Price,
                Total = PlanMoney.FloorToCent(rate.Price * qtyMinutes / 60m), ServiceDate = occ.Date,
                Band = "Provider travel", DayType = support.DayType, PaceCategory = support.PaceCategory,
                Flags = flags | (support.Flags & PlannedLineFlags.HolidayExposure) | (support.Flags & PlannedLineFlags.Review),
                ShortNoticeCancellationAllowed = false,
                Trace = TraceOf(occ, rate, new[] { capRule, "travel:same-item-as-support", "price:catalogue-by-service-date" }, questions, support.Trace.HolidayName, sharing,
                    $"Provider travel on {support.ItemCode}: {travel.MinutesEachWay} minutes each way{(cap is { } k && travel.MinutesEachWay > k ? $" capped at {k}" : string.Empty)}, {(legs == 2 ? "there and back" : "one way")}, {claimable} minutes in all{(sharing > 1 ? $" shared by {sharing} participants" : string.Empty)}{(_policy.TravelRatesProvisional ? "; the time cap and rate are 2025-26 values" : string.Empty)}; {Basis(rate)}."),
            });
        }

        if (travel.KmEachWay > 0m)
        {
            var need = new ItemNeed(SupportFamily.ProviderTravel, null, null, rate.Row.RegistrationGroup ?? RegistrationGroupOf(block, _policy),
                CategoryPrefix: rate.Row.ItemNumber.Split('_')[0]);
            var dollars = PlanMoney.FloorToCent(travel.KmEachWay * legs * _policy.KmRateStandard / sharing);
            AddDollarLine(occ, need, PlannedLineKind.ProviderTravelCosts, "Provider travel costs", dollars, flags & PlannedLineFlags.Provisional, questions,
                new[] { "travel:km", "price:catalogue-by-service-date" },
                $"Provider travel kilometres: {Number(travel.KmEachWay)} km {(legs == 2 ? "each way" : "one way")} at ${Money(_policy.KmRateStandard)} a kilometre{(sharing > 1 ? $", shared by {sharing} participants" : string.Empty)}, claimed in dollars on the non-labour item{(_policy.TravelRatesProvisional ? "; the rate is a 2025-26 value" : string.Empty)}");
        }
    }

    private void AddActivityTransport(Occurrence occ)
    {
        var block = occ.Block;
        if (block.Transport is not { } transport || (transport.Km <= 0m && transport.Tolls <= 0m && transport.Parking <= 0m)) return;
        if (block.SupportType is not (PlanSupportType.CommunityAccess or PlanSupportType.GroupActivity))
        {
            occ.Result.Issues.Add((PlanFailureReason.TransportNotAvailable, $"Block '{block.Id}': activity-based transport only goes with community access and group activities."));
            return;
        }

        var rate = transport.Vehicle == VehicleKind.Accessible ? _policy.KmRateAccessible : _policy.KmRateStandard;
        var dollars = PlanMoney.FloorToCent((transport.Km * rate + transport.Tolls + transport.Parking) / transport.ParticipantsSharing);
        var provisional = transport.Km > 0m && _policy.TravelRatesProvisional;
        var need = new ItemNeed(SupportFamily.ActivityBasedTransport, null, null, RegistrationGroupOf(block, _policy));
        AddDollarLine(occ, need, PlannedLineKind.ActivityTransport, "Activity-based transport", dollars, provisional ? PlannedLineFlags.Provisional : PlannedLineFlags.None,
            provisional ? new[] { 6 } : Array.Empty<int>(),
            new[] { "abt:vehicle-costs", "price:catalogue-by-service-date" },
            $"Activity-based transport: {Number(transport.Km)} km in a {transport.Vehicle.ToString().ToLowerInvariant()} vehicle at ${Money(rate)} a kilometre plus tolls ${Money(transport.Tolls)} and parking ${Money(transport.Parking)} at cost{(transport.ParticipantsSharing > 1 ? $", shared by {transport.ParticipantsSharing} participants" : string.Empty)}; the worker's time in the vehicle stays on the support item{(provisional ? "; the kilometre rate is a 2025-26 value" : string.Empty)}");
    }

    /// <summary>A line claimed in dollars at $1.00 (provider travel costs, activity-based transport).</summary>
    private void AddDollarLine(Occurrence occ, ItemNeed need, PlannedLineKind kind, string band, decimal dollars, PlannedLineFlags flags, IReadOnlyList<int> questions, IReadOnlyList<string> rules, string what)
    {
        if (dollars <= 0m) return;
        var choice = Choose(need, occ.Date, occ.PriceZone);
        if (!choice.Found) { occ.Result.Issues.Add((choice.Failure!.Value, IssueText(need, choice))); return; }
        if (!UnitIs(choice, "E")) { occ.Result.Issues.Add((PlanFailureReason.UnexpectedUnit, UnitMessage(choice, "each"))); return; }

        var qty = PlanMoney.FloorToCent(dollars / choice.Price);
        occ.Result.Lines.Add(new PlannedLine
        {
            BlockId = occ.Block.Id, Kind = kind, ItemCode = choice.Row!.ItemNumber, Unit = "E", Qty = qty, UnitPrice = choice.Price,
            Total = PlanMoney.FloorToCent(qty * choice.Price), ServiceDate = occ.Date, Band = band, PaceCategory = PaceOf(choice.Row), Flags = flags,
            Trace = TraceOf(occ, choice, rules, questions, null, occ.Block.ParticipantsPresent, $"{what}; {Basis(choice)}."),
        });
    }

    private void AddAccommodation(Occurrence occ)
    {
        var block = occ.Block;
        if (block.Accommodation is not { Nights: > 0 } accommodation) return;
        if (block.SupportType != PlanSupportType.StaSupport)
        {
            occ.Result.Issues.Add((PlanFailureReason.AccommodationNotAvailable, $"Block '{block.Id}': accommodation nights are a short-term accommodation item. Use a short-term accommodation block."));
            return;
        }

        AddNights(occ, ParticipantNightSequence, PlannedLineKind.ParticipantAccommodation, "Accommodation (participant)", accommodation.Nights, 1, 1,
            $"Participant accommodation: {accommodation.Nights} night(s), standard accommodation with no extra inclusions, per participant");
        if (accommodation.WorkerOnSite)
            AddNights(occ, WorkerNightSequence, PlannedLineKind.WorkerAccommodation, "Accommodation (support worker)", accommodation.Nights, block.Workers, block.ParticipantsPresent,
                $"Support worker accommodation: {accommodation.Nights} night(s) because a support worker must stay on site, {GroupText(block.Workers, block.ParticipantsPresent)}");
    }

    private void AddNights(Occurrence occ, string sequence, PlannedLineKind kind, string band, int nights, int workers, int participants, string what)
    {
        var need = new ItemNeed(SupportFamily.StaAccommodation, null, null, "0115", Sequence: sequence);
        var choice = Choose(need, occ.Date, occ.PriceZone);
        if (!choice.Found) { occ.Result.Issues.Add((choice.Failure!.Value, IssueText(need, choice))); return; }
        if (!UnitIs(choice, "D")) { occ.Result.Issues.Add((PlanFailureReason.UnexpectedUnit, UnitMessage(choice, "per day"))); return; }

        var unitPrice = PlanMoney.GroupPrice(choice.Price, workers, participants);
        var divided = workers != 1 || participants != 1;
        occ.Result.Lines.Add(new PlannedLine
        {
            BlockId = occ.Block.Id, Kind = kind, ItemCode = choice.Row!.ItemNumber, Unit = "D", Qty = nights, UnitPrice = unitPrice,
            Total = PlanMoney.FloorToCent(unitPrice * nights), ServiceDate = occ.Date, Band = band, PaceCategory = PaceOf(choice.Row),
            Flags = divided ? PlannedLineFlags.Provisional : PlannedLineFlags.None,
            Trace = TraceOf(occ, choice, divided ? new[] { "sta:accommodation-night", "group:floor(price*workers/participants)", "price:catalogue-by-service-date" } : new[] { "sta:accommodation-night", "price:catalogue-by-service-date" },
                divided ? new[] { 5 } : Array.Empty<int>(), null, participants, $"{what}; {Basis(choice)}."),
        });
    }

    /// <summary>The travel time a provider may claim each way: 30 minutes in MM1-3, 60 in MM4-5, no cap in MM6-7 (2025-26 rules, NDIS-CODES 7). National with no level given is read as MM1-3, the stricter.</summary>
    private static int? TravelCapMinutes(PlanLocation location) => location.Zone switch
    {
        PriceZone.National => location.Mm is 4 or 5 ? 60 : 30,
        _ => null,
    };

    // ── Selection and text ────────────────────────────────────────────────────────

    private ItemChoice Choose(ItemNeed need, DateOnly date, PriceZone zone)
    {
        if (!_policy.Holds(need.RegistrationGroup))
            return ItemChoice.Fail(PlanFailureReason.RegistrationGroupNotHeld, $"The provider does not hold registration group {need.RegistrationGroup}, which {need.FamilyName} needs.");

        var key = (need, date, zone);
        if (!_choices.TryGetValue(key, out var choice))
            _choices[key] = choice = _catalogue.Find(need, date, zone);
        return choice;
    }

    private static bool UnitIs(ItemChoice choice, string unit) => string.Equals(choice.Row?.Unit?.Trim(), unit, StringComparison.OrdinalIgnoreCase);

    private static string UnitMessage(ItemChoice choice, string wanted) =>
        $"{choice.Row!.ItemNumber} is claimed per '{choice.Row.Unit}', not {wanted}: it cannot be priced as a {wanted} line.";

    private static string WithNightHint(ItemChoice choice, Segment segment) => WithNightHint(choice.Message!, choice, segment);

    private static string WithNightHint(string message, ItemChoice choice, Segment segment) =>
        choice.Failure == PlanFailureReason.NoItem && segment.Span.DayType == ClaimDayType.WeekdayNight
            ? $"{message} A weekday night support has no item in this family, and it is not mapped to another family: a person must decide how it is claimed."
            : message;

    private static string IssueText(ItemNeed need, ItemChoice choice) => choice.Failure switch
    {
        PlanFailureReason.RegistrationGroupNotHeld => choice.Message!,
        PlanFailureReason.NoItem => $"The catalogue has no item for {need.Describe()}.",
        PlanFailureReason.CatalogueNotFound => $"No catalogue row for {need.Describe()} is valid for part of the period. Import the catalogue for that period.",
        PlanFailureReason.ZoneNotEligible => $"{ItemOf(need, choice)} lists no price for the remote or very remote loading, so it is not eligible for it.",
        PlanFailureReason.CatalogueNotPriced => $"{ItemOf(need, choice)} has no price limit (a quotable item, or a row with no National price).",
        PlanFailureReason.CatalogueAmbiguous => $"The catalogue holds {ItemOf(need, choice)} more than once for the same date, or more than one item for it.",
        _ => choice.Message ?? "The catalogue could not price this line.",
    };

    /// <summary>The code of the row the failure is about, or the need when no single row was found. Either is free of dates, so one gap in fifty weeks is one issue.</summary>
    private static string ItemOf(ItemNeed need, ItemChoice choice) => choice.Row?.ItemNumber ?? need.Describe();

    private static int? PaceOf(SupportCatalogueItem row) => row.PaceSupportCategoryNumber ?? row.SupportCategoryNumber;

    private static bool AllowsCancellation(SupportCatalogueItem row) => row.ShortNoticeCancellation == CatalogueClaimFlag.Yes;

    /// <summary>Adds a line that could not be priced and the issue it stands for. The issue text carries no date, so the same gap in fifty occurrences is one issue with a count.</summary>
    private void AddUnpriced(Occurrence occ, PlannedLine line, string issueText)
    {
        occ.Result.Lines.Add(line);
        occ.Result.Issues.Add((line.Unpriced!.Value, issueText));
    }

    private PlannedLine UnpricedLine(Occurrence occ, PlannedLineKind kind, string band, DateOnly date, DateTime? start, DateTime? end, decimal qty, string unit,
        PlanFailureReason reason, string message, ClaimDayType? dayType) => new()
    {
        BlockId = occ.Block.Id, Kind = kind, ItemCode = null, Unit = unit, Qty = qty, UnitPrice = 0m, Total = 0m, ServiceDate = date,
        StartTime = start is { } s ? TimeOnly.FromDateTime(s) : null,
        EndDate = end is { } e ? DateOnly.FromDateTime(e) : null,
        EndTime = end is { } e2 ? TimeOnly.FromDateTime(e2) : null,
        Band = band, DayType = dayType, Flags = PlannedLineFlags.Review, Unpriced = reason,
        Trace = new PlannedLineTrace
        {
            Rules = new[] { "unpriced:" + Slug(reason.ToString()) }, Why = message, Zone = occ.PriceZone, Workers = occ.Block.Workers, ParticipantsPresent = ParticipantsAt(occ, start ?? occ.Start),
        },
    };

    private PlannedLineTrace TraceOf(Occurrence occ, ItemChoice choice, IReadOnlyList<string> rules, IReadOnlyList<int> questions, string? holidayName, int participants, string why, string? policy = null) => new()
    {
        Rules = rules, Why = why, CatalogueVersion = choice.Row!.CatalogueVersion, PriceBasisFrom = choice.Row.EffectiveFrom,
        SourceDocument = choice.Row.SourceDocument, Zone = occ.PriceZone, MaximumUnitPrice = choice.Price, Workers = occ.Block.Workers, ParticipantsPresent = participants,
        Policy = policy, HolidayName = holidayName, OpenQuestions = questions.Distinct().OrderBy(q => q).ToList(),
    };

    private static string Slug(string text) => text.ToLowerInvariant().Replace(' ', '-');

    private static string Basis(ItemChoice choice) =>
        $"catalogue {choice.Row!.CatalogueVersion}, price from {choice.Row.EffectiveFrom.ToString("d MMM yyyy", CultureInfo.InvariantCulture)} ({choice.Row.ItemNumber}, ${Money(choice.Price)} a unit maximum)";

    private static string GroupText(int workers, int participants) =>
        workers == 1 && participants == 1 ? "one worker for one participant" : $"{workers} worker(s) for {participants} participant(s), each paying floor(maximum x {workers} / {participants})";

    private static string Day(DateOnly date) => date.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture);

    private static string Clock(DateTime time) => time.ToString("HH:mm", CultureInfo.InvariantCulture);

    private static string Money(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);

    private static string Number(decimal value) => value.ToString("0.##", CultureInfo.InvariantCulture);

    private static string Hours(int minutes) => (minutes / 60m).ToString("0.##", CultureInfo.InvariantCulture);

    private static string BandName(ClaimDayType dayType) => dayType switch
    {
        ClaimDayType.PublicHoliday => DayBands.PublicHoliday,
        ClaimDayType.Sunday => DayBands.Sunday,
        ClaimDayType.Saturday => DayBands.Saturday,
        ClaimDayType.WeekdayEvening => DayBands.WeekdayEvening,
        ClaimDayType.WeekdayNight => DayBands.WeekdayNight,
        _ => DayBands.WeekdayDaytime,
    };

    private static string BandRule(DaySpan span) => span.DayType switch
    {
        ClaimDayType.Weekday => "Mon-Fri 06:00-20:00",
        ClaimDayType.WeekdayEvening => "Mon-Fri 20:00-24:00",
        ClaimDayType.WeekdayNight => "Mon-Fri 00:00-06:00",
        ClaimDayType.Saturday => "the whole day",
        ClaimDayType.Sunday => "the whole day",
        _ => span.Holiday is { IsWholeDay: false } part
            ? $"public holiday hours of {part.Name}"
            : $"public holiday: {span.Holiday?.Name}",
    };
}
