using System.Text.RegularExpressions;

namespace Odip.Domain.Rostering;

/// <summary>
/// Incident-suggestive keyword categories a <see cref="ShiftNote"/> body can trip (NOTES-02).
/// Stored as bit flags on <see cref="ShiftNote.FlaggedCategories"/> so a single note can trip more
/// than one category at once (e.g. "she slipped reaching for her tablets" trips both Falls and
/// Medication). Same "[Flags] enum, plain int column, no HasConversion" storage idiom as
/// <see cref="Odip.Domain.Enums.ServiceStreams"/> — nothing extra needed in OdipDbContext.
/// </summary>
[Flags]
public enum ShiftNoteFlagCategory
{
    None = 0,
    Falls = 1 << 0,
    Medication = 1 << 1,
    Injury = 1 << 2,
    BehaviourOfConcern = 1 << 3,
}

/// <summary>
/// The keyword vocabulary NOTES-02's scanner (<see cref="ShiftNoteKeywordScanner"/>) matches
/// shift-note bodies against — one word/stem list per non-<see cref="ShiftNoteFlagCategory.None"/>
/// category. This is a STARTING HEURISTIC, not a clinical or NLP-grade classifier: plain
/// case-insensitive, word-boundary, prefix ("stem") matching only, deliberately simple and meant
/// to be edited/extended as real usage shows gaps. Expect both false positives and false negatives
/// (anything phrased without one of these words) — the product intent is a client-advisory nudge
/// toward filing an incident report, never an authoritative determination, so both are an
/// acceptable trade-off for staying simple and auditable. Verified false-positive examples worth
/// knowing before editing this list further:
/// <list type="bullet">
/// <item><description>"no harm done" trips BehaviourOfConcern via the "harm" stem.</description></item>
/// <item><description>"pillow"/"pillowcase" trip Medication via the "pill" stem.</description></item>
/// <item><description>"tumble dryer" trips Falls via the "tumble" stem.</description></item>
/// <item><description>"tablet" meaning the device (not medication) trips Medication via the "tablet" stem.</description></item>
/// </list>
///
/// The keyword/stem lists here are BACKEND-ONLY BY DESIGN — the frontend never re-implements this
/// scan (see <see cref="ShiftNoteKeywordScanner"/>'s remarks) and only ever renders the category
/// names the server already computed, so it has no load-bearing need for the words themselves.
/// Only the CATEGORY TAXONOMY (the four <see cref="ShiftNoteFlagCategory"/> names + display
/// labels) is mirrored on the frontend, at frontend/src/lib/shiftNoteKeywords.ts, for the portal
/// banner text and the coordinator's roster-slide-over badge. There is no shared codegen between
/// the two stacks in this prototype, so even that smaller taxonomy is a manually maintained
/// parallel pair, not a single generated source — see that file's own header comment. Each side
/// only checks its OWN internal completeness: <see cref="Odip.Tests.Rostering.ShiftNoteKeywordVocabularyTests"/>
/// here (which does still cover this file's stem lists, since they're real here), shiftNoteKeywords.test.ts
/// there (which only covers the category/label taxonomy, since that's all that file carries).
/// Neither test can see across the language boundary, so a change on one side that isn't mirrored
/// on the other is NOT caught automatically — that's a known, documented limitation of not having
/// shared codegen, not an oversight. Editing a stem list here (adding/removing a word) needs no
/// frontend change at all; only adding/removing/renaming a whole CATEGORY does.
/// </summary>
public static class ShiftNoteKeywordVocabulary
{
    /// <summary>Every non-<see cref="ShiftNoteFlagCategory.None"/> single-bit member, in declaration order — the set <see cref="Stems"/> must cover exactly.</summary>
    public static readonly IReadOnlyList<ShiftNoteFlagCategory> Categories = new[]
    {
        ShiftNoteFlagCategory.Falls,
        ShiftNoteFlagCategory.Medication,
        ShiftNoteFlagCategory.Injury,
        ShiftNoteFlagCategory.BehaviourOfConcern,
    };

    public static readonly IReadOnlyDictionary<ShiftNoteFlagCategory, IReadOnlyList<string>> Stems =
        new Dictionary<ShiftNoteFlagCategory, IReadOnlyList<string>>
        {
            [ShiftNoteFlagCategory.Falls] = new[] { "fall", "fell", "slip", "stumble", "collapse", "tumble" },
            [ShiftNoteFlagCategory.Medication] = new[] { "medicat", "dos", "tablet", "pill", "prn", "overdose", "pharmacy" },
            [ShiftNoteFlagCategory.Injury] = new[] { "injur", "wound", "bruis", "bleed", "bled", "lacerat", "fracture", "sprain", "burn", "scald" },
            [ShiftNoteFlagCategory.BehaviourOfConcern] = new[] { "aggress", "agitat", "meltdown", "outburst", "abscond", "restrain", "seclusion", "distress", "harm" },
        };

    /// <summary>Expands a combined flags value into its member category names (e.g. "Falls", "Medication") — the wire shape <see cref="Application.DTOs.ShiftNoteDto.FlaggedCategories"/> uses, in <see cref="Categories"/> declaration order.</summary>
    public static IReadOnlyList<string> ToCategoryNames(ShiftNoteFlagCategory flags) =>
        Categories.Where(c => flags.HasFlag(c)).Select(c => c.ToString()).ToList();
}

/// <summary>
/// Scans a <see cref="ShiftNote.Body"/> for <see cref="ShiftNoteKeywordVocabulary"/> matches
/// (NOTES-02). Case-insensitive, word-boundary, prefix ("stem") matching — e.g. the "fall" stem
/// matches "fall", "falls", "falling" and "fallen" alike — via one compiled regex per category,
/// built once at type-init. No NLP, no external service call: see
/// <see cref="ShiftNoteKeywordVocabulary"/>'s own remarks for why that's a deliberate simplicity
/// trade-off, not an oversight. Server-side only — the frontend never re-implements this scan; it
/// only renders whatever <see cref="ShiftNote.FlaggedCategories"/> the server already computed and
/// stored at save time (create or edit — see <c>PortalController.CreateShiftNote</c>/<c>UpdateShiftNote</c>).
/// </summary>
public static class ShiftNoteKeywordScanner
{
    private static readonly IReadOnlyDictionary<ShiftNoteFlagCategory, Regex> Patterns =
        ShiftNoteKeywordVocabulary.Stems.ToDictionary(
            kv => kv.Key,
            kv => new Regex($@"\b(?:{string.Join("|", kv.Value.Select(Regex.Escape))})\w*\b",
                RegexOptions.IgnoreCase | RegexOptions.Compiled));

    /// <summary>Every category whose stem list matches somewhere in <paramref name="body"/>, OR'd together. <see cref="ShiftNoteFlagCategory.None"/> for no matches, or a null/empty/whitespace-only body.</summary>
    public static ShiftNoteFlagCategory Scan(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return ShiftNoteFlagCategory.None;

        var result = ShiftNoteFlagCategory.None;
        foreach (var (category, pattern) in Patterns)
        {
            if (pattern.IsMatch(body)) result |= category;
        }
        return result;
    }
}
