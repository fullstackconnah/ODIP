namespace Odip.Domain.Funding;

/// <summary>
/// The codes the NDIA gives when it refuses a claim because the money is not there (budget feature, phase 2b). A provider cannot see a participant's budget in the NDIA portal, so a rejection with one of
/// these is the only direct sign that a pool is empty. V17 and V18 say there is not enough in the plan; V27 and V28 say there is not enough in the funding period (the second of each pair is for flexible
/// funds, the first for stated funds). Whoever marks a claim Rejected may record the code, or any other code the NDIA gave, as free text.
/// </summary>
public static class NdiaRejectionCodes
{
    /// <summary>The longest a stored code may be.</summary>
    public const int MaxLength = 10;

    /// <summary>The four codes that mean the funds ran out, in capitals as they are stored (so a query can match them exactly).</summary>
    public static readonly string[] NotEnoughFunds = { "V17", "V18", "V27", "V28" };

    /// <summary>
    /// The code as it is kept: trimmed, nothing at all when nothing is left, and in capitals when it is one of the four funds codes (typed in any case), else exactly as typed. It does not check the
    /// length or the characters: the caller refuses those with a message of its own.
    /// </summary>
    public static string? Normalise(string? typed)
    {
        var code = typed?.Trim();
        if (string.IsNullOrEmpty(code)) return null;
        return NotEnoughFunds.FirstOrDefault(known => string.Equals(known, code, StringComparison.OrdinalIgnoreCase)) ?? code;
    }

    /// <summary>Whether the code says the NDIA has no more funds to pay from (V17, V18, V27 or V28), whatever its case.</summary>
    public static bool MeansNotEnoughFunds(string? code) => Normalise(code) is { } normalised && NotEnoughFunds.Contains(normalised, StringComparer.Ordinal);
}
