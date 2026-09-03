using System.Text.RegularExpressions;
using Odip.Infrastructure.Services;
using Xunit;

namespace Odip.Tests.Services;

/// <summary>
/// PF-10.1 — totality + cross-language consistency coverage for
/// <see cref="ParticipantFieldEntryMap"/>, the backend mirror of
/// <c>frontend/src/lib/documentMapping.ts</c>'s <c>entryPhase</c> tag.
///
/// "Totality" (every wizard field has exactly one entry-owner) is covered by
/// <see cref="NoDuplicateFieldIds"/> plus <see cref="MatchesExpectedIntakeProfileSplit"/>.
/// "Consistent (frontend and backend agree)" is covered by
/// <see cref="AgreesWithFrontendDocumentMappingTs"/>, which reads
/// <c>documentMapping.ts</c>'s source text directly (same repo-relative-path-resolution style as
/// <c>BillingPrototypeTests.ResolveSeedJsonPath</c>) and cross-checks every field id + phase
/// against this file's hand-kept mirror — a structural drift between the two files (missing
/// field, extra field, or a flipped phase) fails this test loudly instead of silently.
/// </summary>
public class ParticipantFieldEntryMapTests
{
    [Fact]
    public void NoDuplicateFieldIds()
    {
        var ids = ParticipantFieldEntryMap.Entries.Select(e => e.FieldId).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
    }

    [Fact]
    public void EveryEntryHasAnIntakeOrProfilePhase()
    {
        foreach (var entry in ParticipantFieldEntryMap.Entries)
            Assert.True(entry.Phase is ParticipantFieldEntryPhase.Intake or ParticipantFieldEntryPhase.Profile);
    }

    [Fact]
    public void MatchesExpectedIntakeProfileSplit()
    {
        // 146 total fields as of this branch (PF-10.2 added communityAccessRiskItems +
        // overallCommunityAccessRiskRating, both Profile): 61 Intake / 85 Profile — mirrors
        // documentMapping.test.ts's equivalent frontend assertion. Expected to move if a future
        // branch adds/reallocates fields; exists to catch an accidental mass-reallocation.
        Assert.Equal(146, ParticipantFieldEntryMap.Entries.Count);
        Assert.Equal(61, ParticipantFieldEntryMap.Entries.Count(e => e.Phase == ParticipantFieldEntryPhase.Intake));
        Assert.Equal(85, ParticipantFieldEntryMap.Entries.Count(e => e.Phase == ParticipantFieldEntryPhase.Profile));
    }

    [Fact]
    public void AgreesWithFrontendDocumentMappingTs()
    {
        var tsPath = ResolveDocumentMappingTsPath();
        var tsSource = File.ReadAllText(tsPath);

        // documentMapping.ts always writes `entryPhase: '<phase>',` immediately before
        // `field: '<name>'` within the same object literal (either same line or the line above) —
        // see add-entry-phase.js's insertion shape. This regex captures exactly that adjacency.
        var matches = Regex.Matches(
            tsSource,
            @"entryPhase:\s*'(intake|profile)',\s*\r?\n?\s*field:\s*'([^']+)'");

        Assert.True(matches.Count > 0, $"Found no entryPhase/field pairs in {tsPath} — regex may be stale.");

        var tsEntries = new Dictionary<string, string>();
        foreach (Match m in matches)
        {
            var phase = m.Groups[1].Value;
            var field = m.Groups[2].Value;
            Assert.False(tsEntries.ContainsKey(field), $"Duplicate field '{field}' found in {tsPath}.");
            tsEntries[field] = phase;
        }

        var csEntries = ParticipantFieldEntryMap.Entries.ToDictionary(
            e => e.FieldId,
            e => e.Phase == ParticipantFieldEntryPhase.Intake ? "intake" : "profile");

        // Same field set, both directions.
        var onlyInTs = tsEntries.Keys.Except(csEntries.Keys).ToList();
        var onlyInCs = csEntries.Keys.Except(tsEntries.Keys).ToList();
        Assert.True(onlyInTs.Count == 0, $"Fields in documentMapping.ts missing from ParticipantFieldEntryMap: {string.Join(", ", onlyInTs)}");
        Assert.True(onlyInCs.Count == 0, $"Fields in ParticipantFieldEntryMap missing from documentMapping.ts: {string.Join(", ", onlyInCs)}");

        // Same phase for every field.
        var mismatched = csEntries
            .Where(kv => tsEntries.TryGetValue(kv.Key, out var tsPhase) && tsPhase != kv.Value)
            .Select(kv => $"{kv.Key}: backend={kv.Value}, frontend={tsEntries[kv.Key]}")
            .ToList();
        Assert.True(mismatched.Count == 0, $"entryPhase mismatch between backend and frontend: {string.Join("; ", mismatched)}");
    }

    private static string ResolveDocumentMappingTsPath()
    {
        var dir = AppContext.BaseDirectory;
        for (var i = 0; i < 10; i++)
        {
            var candidate = Path.Combine(dir, "frontend", "src", "lib", "documentMapping.ts");
            if (File.Exists(candidate))
                return candidate;
            dir = Path.GetFullPath(Path.Combine(dir, ".."));
        }

        throw new FileNotFoundException("Could not locate frontend/src/lib/documentMapping.ts via any known path.");
    }
}
