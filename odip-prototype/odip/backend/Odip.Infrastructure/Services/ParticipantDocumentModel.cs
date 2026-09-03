namespace Odip.Infrastructure.Services;

/// <summary>
/// DOC-01 — the plain, framework-agnostic model the Intake Form and Participant Profile PDFs are
/// composed into before rendering. Deliberately POCO: no EF Core (<c>Odip.Infrastructure.Data</c>)
/// and no QuestPDF types anywhere in this file, so <see cref="ParticipantDocumentComposer"/> can be
/// unit-tested against a hand-built <c>Participant</c> with zero database/rendering infrastructure,
/// and <see cref="ParticipantDocumentRenderer"/> can be unit-tested (or swapped) against a hand-built
/// model with no EF/QuestPDF entanglement either.
/// </summary>
/// <summary>
/// PF-10.6 — the three trailing parameters are only populated by
/// <see cref="ParticipantDocumentComposer.ComposeClientOverview"/> (null for the Intake Form /
/// Participant Profile, which have no per-trip header). <see cref="ParticipantDocumentRenderer"/>
/// renders the "TRIP | DATE | GROUP" header line only when <see cref="TripName"/> is non-null,
/// so the two existing documents' header layout is unchanged. When Client Overview is generated
/// with no trip context (e.g. from the Participant detail page), the composer still sets these to
/// the placeholder string (blank, not omitted) rather than leaving them null — see
/// ComposeClientOverview's own doc comment.
/// </summary>
public sealed record ParticipantDocumentModel(
    string Title,
    string ParticipantFullName,
    string? NdisNumber,
    DateTime GeneratedAtUtc,
    IReadOnlyList<ParticipantDocumentSection> Sections,
    string? TripName = null,
    string? TripDate = null,
    string? TripGroup = null);

/// <summary>
/// One wizard-step-family grouping (e.g. "Participant Details", "Medical") in the composed
/// document. Only included in a <see cref="ParticipantDocumentModel"/> when it ends up with at
/// least one field or table for that particular document — see
/// <see cref="ParticipantDocumentComposer"/>'s section-dropping rule.
/// </summary>
public sealed record ParticipantDocumentSection(
    string Heading,
    IReadOnlyList<ParticipantDocumentField> Fields,
    IReadOnlyList<ParticipantDocumentTable> Tables);

/// <summary>
/// A single label/value row. <see cref="Value"/> is always a pre-formatted display string — an
/// empty/null source value renders as <see cref="ParticipantDocumentValueFormatting.EmptyPlaceholder"/>
/// ("—") rather than blank, baked in by whatever helper produced this record (see
/// <see cref="ParticipantDocumentValueFormatting"/>).
/// </summary>
public sealed record ParticipantDocumentField(string Label, string Value);

/// <summary>
/// A structured grid (e.g. Contacts, Health Conditions, Consents, ADL Assessments, Checklist
/// Items, Risk Entries) — column headers plus pre-formatted row cells, ready for direct QuestPDF
/// table rendering with no further lookups.
/// </summary>
public sealed record ParticipantDocumentTable(
    string Heading,
    IReadOnlyList<string> Columns,
    IReadOnlyList<IReadOnlyList<string>> Rows);

/// <summary>
/// Shared value->display-string helpers used by <see cref="ParticipantDocumentComposer"/> for both
/// scalar fields and table cells, so every empty/null value renders identically across the whole
/// document ("—", never a blank cell) regardless of which code path produced it.
/// </summary>
public static class ParticipantDocumentValueFormatting
{
    public const string EmptyPlaceholder = "—";

    /// <summary>Any nullable/blank string collapses to the em-dash placeholder.</summary>
    public static string OrPlaceholder(string? value) =>
        string.IsNullOrWhiteSpace(value) ? EmptyPlaceholder : value;

    /// <summary>Tri-state bool -> Yes/No/placeholder (placeholder for null, i.e. "not yet answered").</summary>
    public static string YesNoOrPlaceholder(bool? value) =>
        value switch { true => "Yes", false => "No", null => EmptyPlaceholder };

    /// <summary>Non-nullable bool -> Yes/No (no placeholder case — always answered).</summary>
    public static string YesNo(bool value) => value ? "Yes" : "No";
}
