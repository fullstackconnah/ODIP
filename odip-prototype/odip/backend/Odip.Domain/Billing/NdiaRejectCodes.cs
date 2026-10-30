namespace Odip.Domain.Billing;

/// <summary>What the NDIA's reject codes mean for a provider: whether the line can simply be corrected and sent again, or a person has to decide first. Meanings are from the NDIA's own guidance.</summary>
public sealed record RejectCodeInfo(string Code, bool NeedsDecision, string Hint);

public static class NdiaRejectCodes
{
    private const string Unknown = "The NDIA gave a reason this app doesn't know yet. Read their message before sending it again.";
    private const string Plan = "The dates are outside the participant's plan. Check the dates.";
    private const string Price = "The price is over the price guide limit. Lower it to the limit.";
    private const string Double = "The NDIA already has a claim for this participant, item and dates. Check it isn't a double claim.";
    private const string Who = "The NDIA says this plan isn't NDIA-managed for this support. Check who pays.";
    private const string Budget = "There isn't enough left in the participant's budget. Talk to the participant or their support coordinator.";

    private static RejectCodeInfo Fix(string code, string hint) => new(code, false, hint);
    private static RejectCodeInfo Decide(string code, string hint) => new(code, true, hint);

    public static readonly IReadOnlyDictionary<string, RejectCodeInfo> All = new[]
    {
        Fix("C16", "The item isn't in the price guide on these dates. Check the item code and the dates."),
        Fix("C22", Plan), Fix("C28", Plan), Fix("V36", Plan),
        Fix("V26", "The dates cross two plans. Split the line at the end of the old plan."),
        Fix("C27", "The dates are in the future. Check the dates."),
        Fix("C38", Price), Fix("V31", Price),
        Fix("C30", "A cancellation needs a reason. Choose one, then send it again."),
        Fix("P05", "That reference was used too many times. Send it again: it gets a new reference."),
        Decide("V04", Double), Decide("P04", Double),
        Decide("V11", "You're not listed as one of this participant's providers. Ask them to add you in the portal."),
        Decide("V13", Who), Decide("V43", Who),
        Decide("V16", "The participant's plan has no funding for this item. Talk to the participant or their support coordinator."),
        Decide("V17", Budget), Decide("V18", Budget), Decide("V27", Budget), Decide("V28", Budget), Decide("P03", Budget),
        Decide("C15", "Your registration doesn't cover this item. Check your registration groups."),
        Decide("C39", "This claim is past the NDIA's time limit. It can't be sent again as it is."),
    }.ToDictionary(i => i.Code, StringComparer.Ordinal);

    /// <summary>The code's info, matched without regard to case. An unknown or blank code needs a decision: a person must read the NDIA's message.</summary>
    public static RejectCodeInfo For(string? code)
    {
        var key = code?.Trim().ToUpperInvariant() ?? "";
        return All.TryGetValue(key, out var info) ? info : new RejectCodeInfo(key, true, Unknown);
    }
}
