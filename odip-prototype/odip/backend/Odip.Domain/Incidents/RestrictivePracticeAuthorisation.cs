using Odip.Domain.Entities;
using Odip.Domain.Enums;

namespace Odip.Domain.Incidents;

/// <summary>
/// The single definition of an "Authorised" restrictive practice register entry (owner decision 2026-10-14): active, AND who authorised it
/// recorded, AND the date it was authorised recorded and not after <c>today</c> (the organisation's calendar date, so an authorisation
/// dated tomorrow is not yet in force; audit M14). Anything else reads "Not authorised". <c>IncidentsController</c>'s determination uses it,
/// and the register DTO's <c>IsAuthorised</c> carries the verdict to the wizard's badges and banner, so the browser never recomputes it.
/// Applied in memory to loaded rows, never inside a query, so EF InMemory and Npgsql cannot read it differently.
/// </summary>
public static class RestrictivePracticeAuthorisation
{
    public static bool IsAuthorised(RestrictivePractice practice, DateOnly today) =>
        practice.IsActive && !string.IsNullOrWhiteSpace(practice.AuthorisedBy) && practice.AuthorisationDate <= today;

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
