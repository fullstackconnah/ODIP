using System.Globalization;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>
/// What a reader of a revision the plan builder made must not miss, in one sentence each: a part of the plan that was not priced (so it is not in any total), public holiday shifts a person
/// has to decide before the agreement is approved, and a rate nobody has confirmed. From the pricing answer the revision stored when it was saved. Nothing for a revision typed by hand or one
/// priced in full. The PDF prints them; a total that leaves work out has to say so beside the total. Counted in shifts, the unit a coordinator thinks in, and said the way the plan builder's
/// own caption says it (frontend <c>totalsCaption</c>): the engine's counts of lines are shifts times items and mean nothing to a person reading a total.
/// </summary>
public static class DraftPricingCaveats
{
    /// <summary>
    /// The reasons that mean something a person asked for has no price: a line, or a part of one, is not in any total. A refusal (nothing at all priced from the block), a flag that is only for review
    /// and an overlap are something else. The same list as the screen's (frontend <c>lib/planQuote.ts</c>, LEFT_OUT).
    /// </summary>
    private static readonly HashSet<PlanFailureReason> LeftOut = new()
    {
        PlanFailureReason.NoItem, PlanFailureReason.CatalogueNotFound, PlanFailureReason.CatalogueAmbiguous, PlanFailureReason.ZoneNotEligible, PlanFailureReason.CatalogueNotPriced,
        PlanFailureReason.UnexpectedUnit, PlanFailureReason.SleepoverNotAvailable, PlanFailureReason.TransportNotAvailable, PlanFailureReason.AccommodationNotAvailable,
        PlanFailureReason.TravelNotClaimable, PlanFailureReason.SupportInSkippedHour,
    };

    public static IReadOnlyList<string> For(ServiceAgreementDraft draft)
    {
        if (string.IsNullOrWhiteSpace(draft.PricingJson)) return Array.Empty<string>();
        if (DraftJson.ReadQuote(draft.PricingJson) is not { } quote)
            return new[] { "What the pricing engine said about this revision could not be read, so the totals may be incomplete: check the plan before relying on them." };

        var caveats = new List<string>();
        var notPriced = ShiftsNotPriced(quote);
        if (notPriced > 0)
            caveats.Add(string.Create(CultureInfo.InvariantCulture, $"{(NotPricedIsLowerBound(quote) ? "At least " : string.Empty)}{Shifts(notPriced)} {(notPriced == 1 ? "has" : "have")} a part that is not priced, so that part is not in any total."));
        var holidays = quote.HolidayOccurrences.Count(occurrence => occurrence.Decision == HolidayDecision.Review && !occurrence.Skipped);
        if (holidays > 0)
            caveats.Add(string.Create(CultureInfo.InvariantCulture, $"{(holidays == 1 ? "1 public holiday shift is" : $"{holidays} public holiday shifts are")} priced at the holiday rate and still need{(holidays == 1 ? "s" : string.Empty)} a decision by a person before this agreement is approved."));
        if (quote.Totals.ProvisionalLines > 0)
            caveats.Add("Some lines use provisional rates that are not yet confirmed.");
        return caveats;
    }

    /// <summary>
    /// How many shifts have a part that is not priced. A shift can be short of several things (one issue each, counting the same shifts), so a block counts its largest, and the blocks add up: a figure
    /// that is never more than the truth (see <see cref="NotPricedIsLowerBound"/> for when it is less).
    /// </summary>
    public static int ShiftsNotPriced(PlanQuote quote) =>
        quote.Issues.Where(issue => LeftOut.Contains(issue.Reason)).GroupBy(issue => issue.BlockId).Sum(block => block.Max(issue => issue.Count));

    /// <summary>Whether the quote says some of a block's work has no price (one of the left-out reasons is held for it), so its figure is the part that could be priced and not the whole.</summary>
    public static bool LeavesOutPartOf(PlanQuote quote, string blockId) =>
        quote.Issues.Any(issue => string.Equals(issue.BlockId, blockId, StringComparison.Ordinal) && LeftOut.Contains(issue.Reason));

    /// <summary>
    /// Whether <see cref="ShiftsNotPriced"/> is a lower bound and not the count. A block with one such issue counts exactly the shifts it was met on. A block with several (two items missing, or two gaps in the
    /// catalogue) counts its largest, and the others may touch shifts that one did not, so "186 shifts" printed as the count overstated what is known: it is "at least 186". The same rule as the screen's
    /// (frontend <c>shiftsNotPricedAtLeast</c>).
    /// </summary>
    public static bool NotPricedIsLowerBound(PlanQuote quote) =>
        quote.Issues.Where(issue => LeftOut.Contains(issue.Reason)).GroupBy(issue => issue.BlockId).Any(block => block.Count() > 1);

    private static string Shifts(int count) => count == 1 ? "1 shift" : string.Create(CultureInfo.InvariantCulture, $"{count} shifts");
}
