using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Incidents;

/// <summary>
/// The single definition of an "Authorised" restrictive practice register entry (owner decision 2026-10-14): active, AND who authorised it
/// recorded, AND the date it was authorised recorded and not after <c>onDate</c>, and the authorisation end date (when set) not before it. The end date is inclusive:
/// a use on it is authorised, the next day is not. The register (status, medicine flag, alerts) judges on the organisation's today, so an authorisation
/// dated tomorrow is not yet in force (audit M14); an incident's use judges on the incident's own date (owner Q13, ruling 2026-10-31). Anything else reads "Not authorised". <c>IncidentsController</c>'s determination uses it,
/// and the register DTO's <c>IsAuthorised</c> carries the verdict to the wizard's badges and banner, so the browser never recomputes it.
/// Applied in memory to loaded rows, never inside a query, so EF InMemory and Npgsql cannot read it differently.
/// </summary>
public static class RestrictivePracticeAuthorisation
{
    public static bool IsAuthorised(RestrictivePractice practice, DateOnly onDate) =>
        practice.IsActive && !string.IsNullOrWhiteSpace(practice.AuthorisedBy) && practice.AuthorisationDate <= onDate
        && (practice.AuthorisationEndDate == null || onDate <= practice.AuthorisationEndDate);

    /// <summary>
    /// How the practice is used. A linked chemical entry follows its medicine (PRN gives Prn, anything else Routine) because the medicine form can change
    /// that and no sync hook covers it; the stored value counts only for an unlinked entry. The medicine must be loaded.
    /// </summary>
    public static RestrictivePracticeUseKind UseKindOf(RestrictivePractice practice) =>
        practice.RelatedMedicationId == null ? practice.UseKind
        : practice.RelatedMedication == null ? throw new InvalidOperationException("UseKindOf needs RelatedMedication loaded for a linked entry.")
        : practice.RelatedMedication.Type == MedicationType.Prn ? RestrictivePracticeUseKind.Prn : RestrictivePracticeUseKind.Routine;

    /// <summary>The type as it reads mid-sentence, e.g. in the task "Add physical restraint to Sophie Brown's restrictive practice register".</summary>
    public static string TypePhrase(RestrictivePracticeType type) => type switch
    {
        RestrictivePracticeType.Seclusion => "seclusion",
        RestrictivePracticeType.ChemicalRestraint => "chemical restraint",
        RestrictivePracticeType.MechanicalRestraint => "mechanical restraint",
        RestrictivePracticeType.PhysicalRestraint => "physical restraint",
        RestrictivePracticeType.EnvironmentalRestraint => "environmental restraint",
        _ => "an unclassified practice",
    };
}
