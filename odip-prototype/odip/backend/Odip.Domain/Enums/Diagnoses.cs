namespace Odip.Domain.Enums;

/// <summary>
/// Curated diagnoses picklist (DIAG-01), sourced from the Master Data Dictionary's new "Diagnoses"
/// entry (SeedData/DataDictionarySeed.json, fieldId MED-016, domain "Health & Medical" — the same
/// domain as the existing free-text MED-001 "Diagnoses &amp; Medical Conditions" summary field,
/// which this supplements rather than replaces) — the spreadsheet is the source of truth for this
/// set, mirroring how <see cref="MobilitySupportOptions"/> is sourced from MOB-004.
///
/// Unlike <see cref="MobilitySupportOptions"/> (a genuinely closed picklist with no escape hatch),
/// <see cref="Entities.Participant.PrimaryDiagnosis"/> and <see cref="Entities.Participant.OtherDiagnoses"/>
/// are deliberately NOT validated against <see cref="All"/> server-side — the backlog item
/// (DIAG-01) explicitly requires an "Other — specify" escape hatch, and a real diagnosis is
/// open-ended in a way mobility-transfer methods aren't. <see cref="All"/> (plus the
/// <see cref="OtherSentinel"/> member) exists to drive the frontend's curated dropdown/checkbox UI
/// and as a documented reference set, not as a closed-set server validator; the entity fields
/// accept any non-blank, length-bounded string, letting a selected curated value and a typed
/// custom value round-trip identically (see ParticipantsController's ValidateDiagnoses for the
/// only server-side rule: non-blank, per-item length bound).
/// </summary>
public static class Diagnoses
{
    /// <summary>
    /// UI-only sentinel offered alongside the curated options: selecting it reveals a free-text
    /// "specify" input (mirrors the Gender/GenderSelfDescription "Other" pattern), and the typed
    /// text — not this literal string — is what gets stored. Never itself a valid stored value.
    /// </summary>
    public const string OtherSentinel = "Other — specify";

    /// <summary>The curated set, in the order the frontend renders them (alphabetical, common-first is not attempted).</summary>
    public static readonly IReadOnlyList<string> All = new[]
    {
        "Intellectual Disability",
        "Autism Spectrum Disorder",
        "Cerebral Palsy",
        "Down Syndrome",
        "Epilepsy",
        "Acquired Brain Injury",
        "Psychosocial Disability",
        "Vision Impairment",
        "Hearing Impairment",
        "Multiple Sclerosis",
        "Muscular Dystrophy",
        "Spina Bifida",
        "Stroke",
        "Dementia",
    };

    /// <summary>True iff <paramref name="value"/> is one of the curated <see cref="All"/> entries. Advisory only — see the type doc for why this is not enforced as a closed-set validator.</summary>
    public static bool IsCurated(string value) => All.Contains(value);
}
