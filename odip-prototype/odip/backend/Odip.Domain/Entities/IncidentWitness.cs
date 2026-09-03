using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// IN-7: one witness on an <see cref="IncidentReport"/> — a genuine one-to-many (an incident can
/// have many witnesses, unlike <see cref="MedicationAdministration"/> which only ever has one),
/// reusing the exact same <see cref="Enums.WitnessStatus"/> approval mechanism the medication
/// witness flow established: nominated at record time, discovered pull-based by the nominated
/// user on the portal's witness-approvals page, and approved/declined only by the named
/// <see cref="WitnessUserId"/>.
///
/// A single list holds BOTH kinds of row: a staff witness (<see cref="WitnessUserId"/> set — has
/// something to approve) and a free-text external witness (<see cref="WitnessUserId"/> null —
/// <see cref="WitnessStatus"/> is <see cref="Enums.WitnessStatus.NotRequired"/>, nothing for
/// anyone to approve). <see cref="WitnessName"/> is always populated regardless of which path —
/// same "always populated" convention as <see cref="MedicationAdministration.WitnessName"/>.
///
/// No <c>TenantId</c>/<c>ITenantEntity</c> — mirrors <see cref="IncidentReport"/> itself (and
/// <see cref="IncidentInjury"/>), which has neither; same-tenant scoping comes transitively
/// through the parent <see cref="IncidentReport"/> FK.
///
/// Update (edit mode) is NOT a straightforward full-replace like <see cref="IncidentInjury"/> —
/// a row already <see cref="Enums.WitnessStatus.Approved"/> or <see cref="Enums.WitnessStatus.Declined"/>
/// carries state the reporter does not own (the witness's own response) and must survive a
/// resubmit of the full witnesses list untouched. See
/// <see cref="Api.Controllers.IncidentsController.Update"/> for the id-matched
/// preserve-already-responded-rows logic this requires.
/// </summary>
public class IncidentWitness
{
    public Guid Id { get; set; }

    public Guid IncidentReportId { get; set; }
    public IncidentReport IncidentReport { get; set; } = null!;

    /// <summary>Set when a staff user was nominated — drives the approval workflow below. Null
    /// for a free-text/external witness, who has nothing to approve.</summary>
    public Guid? WitnessUserId { get; set; }
    public User? WitnessUser { get; set; }

    /// <summary>Always populated: the nominated staff member's name (denormalised) or the typed
    /// free-text name — same "always populated regardless of path" convention as
    /// <see cref="MedicationAdministration.WitnessName"/>.</summary>
    public string WitnessName { get; set; } = string.Empty;

    public WitnessStatus WitnessStatus { get; set; } = WitnessStatus.NotRequired;
    public DateTime? WitnessRequestedAt { get; set; }
    public DateTime? WitnessRespondedAt { get; set; }

    /// <summary>
    /// NEW beyond the medication precedent (backlog: "offer a witness statement optionally").
    /// Populated by the witness themself when they respond (approve or decline) via the portal —
    /// never by the reporter at incident creation/edit time.
    /// </summary>
    public string? StatementText { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
