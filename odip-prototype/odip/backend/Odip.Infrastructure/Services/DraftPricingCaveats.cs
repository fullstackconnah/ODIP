using System.Globalization;
using Odip.Domain.Entities;

namespace Odip.Infrastructure.Services;

/// <summary>
/// What a reader of a revision the plan builder made must not miss, in one sentence each: a part of the plan that was not priced (so it is not in any total), lines a person has to look at
/// before the agreement is approved, and lines that rest on a rate nobody has confirmed. From the pricing answer the revision stored when it was saved. Nothing for a revision typed by hand
/// or one priced in full. The PDF prints them; a total that leaves work out has to say so beside the total.
/// </summary>
public static class DraftPricingCaveats
{
    public static IReadOnlyList<string> For(ServiceAgreementDraft draft)
    {
        if (string.IsNullOrWhiteSpace(draft.PricingJson)) return Array.Empty<string>();
        if (DraftJson.ReadQuote(draft.PricingJson) is not { } quote)
            return new[] { "What the pricing engine said about this revision could not be read, so the totals may be incomplete: check the plan before relying on them." };

        var caveats = new List<string>();
        var totals = quote.Totals;
        if (totals.UnpricedLines > 0)
            caveats.Add(string.Create(CultureInfo.InvariantCulture, $"{Lines(totals.UnpricedLines)} {(totals.UnpricedLines == 1 ? "is" : "are")} not priced (the catalogue has no price for {(totals.UnpricedLines == 1 ? "it" : "them")}) and {(totals.UnpricedLines == 1 ? "is" : "are")} not in any total."));
        if (totals.ReviewLines > 0)
            caveats.Add(string.Create(CultureInfo.InvariantCulture, $"{Lines(totals.ReviewLines)} need{(totals.ReviewLines == 1 ? "s" : string.Empty)} review by a person before this agreement is approved (for example a public holiday nobody has decided)."));
        if (totals.ProvisionalLines > 0)
            caveats.Add(string.Create(CultureInfo.InvariantCulture, $"{Lines(totals.ProvisionalLines)} use{(totals.ProvisionalLines == 1 ? "s" : string.Empty)} provisional rates that are not yet confirmed."));
        return caveats;
    }

    private static string Lines(int count) => count == 1 ? "1 shift line" : string.Create(CultureInfo.InvariantCulture, $"{count} shift lines");
}
