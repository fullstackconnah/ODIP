using System.Globalization;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>One row of the schedule of supports on the agreement PDF, in the words the PDF prints.</summary>
public sealed record ScheduleRow(string Days, string Time, string Support, string Ratio, string State, string HoursAWeek, string Cost);

/// <summary>
/// The weekly schedule of an agreement revision as the PDF prints it: one row for each support the revision was saved with, read from its stored blocks and its stored pricing (so the
/// PDF says what was priced when the revision was saved, not what the catalogue says now). The words are the screen's: "Mon to Fri", "09:00 to 13:00", "22:00 to 06:00 (ends the next day)",
/// "1:3". <see cref="Unreadable"/> counts the supports whose stored text could not be read: they are not rows, and the PDF says some are missing.
/// </summary>
public sealed record AgreementSchedule(IReadOnlyList<ScheduleRow> Rows, int Unreadable)
{
    public const string NotPriced = "Not priced";

    private static readonly string[] ShortDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    public static AgreementSchedule Of(ServiceAgreementDraft draft)
    {
        var quote = DraftJson.ReadQuote(draft.PricingJson);
        var rows = new List<ScheduleRow>();
        var unreadable = 0;
        foreach (var stored in draft.Blocks.OrderBy(x => x.Position))
        {
            var entry = DraftJson.ToDto(stored);
            if (entry.Unreadable) { unreadable++; continue; }
            var block = entry.Block;
            rows.Add(new ScheduleRow(
                DaysText(block.Days), TimeText(block), ServiceAgreementDraftService.SupportTypeLabel(block.SupportType), RatioText(block),
                string.IsNullOrWhiteSpace(block.Location?.State) ? draft.State : block.Location.State.Trim().ToUpperInvariant(),
                HoursText(block), CostText(CostOf(draft, quote, stored.BlockKey))));
        }

        return new AgreementSchedule(rows, unreadable);
    }

    /// <summary>The sentence above the table: the routine is weekly, from the agreement's first day to its last.</summary>
    public static string Repeats(ServiceAgreementDraft draft) =>
        string.Create(CultureInfo.InvariantCulture, $"Repeats every week from {draft.AgreementStartDate:dd MMM yyyy} to {draft.AgreementEndDate:dd MMM yyyy}.");

    /// <summary>"Mon, Wed, Fri"; a run of three or more days is a range ("Mon to Fri"), a shorter one is listed; all seven are "Every day". Monday first, as the week is drawn on the screen.</summary>
    public static string DaysText(IEnumerable<DayOfWeek>? days)
    {
        var slots = (days ?? []).Where(day => Enum.IsDefined(day)).Select(day => ((int)day + 6) % 7).Distinct().Order().ToList();
        if (slots.Count == 0) return "No days";
        if (slots.Count == 7) return "Every day";

        var parts = new List<string>();
        for (var start = 0; start < slots.Count;)
        {
            var end = start;
            while (end + 1 < slots.Count && slots[end + 1] == slots[end] + 1) end++;
            parts.Add(end - start >= 2
                ? $"{ShortDays[slots[start]]} to {ShortDays[slots[end]]}"
                : string.Join(", ", slots.Skip(start).Take(end - start + 1).Select(slot => ShortDays[slot])));
            start = end + 1;
        }

        return string.Join(", ", parts);
    }

    /// <summary>"09:00 to 13:00", or "22:00 to 06:00 (ends the next day)": the end is on the next day when it is not after the start.</summary>
    public static string TimeText(PlanBlock block) =>
        $"{block.Start.ToString("HH:mm", CultureInfo.InvariantCulture)} to {block.End.ToString("HH:mm", CultureInfo.InvariantCulture)}{(block.EndsNextDay ? " (ends the next day)" : string.Empty)}";

    /// <summary>Workers to participants present: "1:1", "2:1", "1:3".</summary>
    public static string RatioText(PlanBlock block) => string.Create(CultureInfo.InvariantCulture, $"{block.Workers}:{block.ParticipantsPresent}");

    /// <summary>The hours of support the routine asks for in an ordinary week: the length of a shift on the clock times the days it is on (a sleepover counts its whole night). No more than two decimals, no trailing zero.</summary>
    public static string HoursText(PlanBlock block)
    {
        var days = (block.Days ?? []).Where(day => Enum.IsDefined(day)).Distinct().Count();
        return decimal.Round(block.DurationMinutes * days / 60m, 2, MidpointRounding.AwayFromZero).ToString("0.##", CultureInfo.InvariantCulture);
    }

    /// <summary>The support's total over the agreement: its line in the revision's stored answer, else the lines it was saved with. Null when nothing was priced from it.</summary>
    private static decimal? CostOf(ServiceAgreementDraft draft, PlanQuote? quote, string blockKey)
    {
        var stored = quote?.Totals.ByBlock.FirstOrDefault(total => string.Equals(total.BlockId, blockKey, StringComparison.Ordinal));
        var amount = stored?.Amount ?? draft.Lines.Where(line => string.Equals(line.BlockKey, blockKey, StringComparison.Ordinal)).Sum(line => line.Total ?? 0m);
        return amount > 0m ? amount : null;
    }

    /// <summary>"$1,240.50", or "Not priced": a support nothing could be priced from has no cost yet, which is not the same as costing nothing.</summary>
    private static string CostText(decimal? amount) => amount is { } cost ? "$" + cost.ToString("N2", CultureInfo.InvariantCulture) : NotPriced;
}
