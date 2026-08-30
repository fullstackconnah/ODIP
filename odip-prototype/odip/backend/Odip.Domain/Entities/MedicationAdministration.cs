using Odip.Domain.Enums;
using Odip.Domain.Interfaces;

namespace Odip.Domain.Entities;

/// <summary>
/// A single recorded dose event (or non-event — Refused/Withheld/Missed) against a
/// <see cref="ParticipantMedication"/>. Forms the Medication Administration Record (MAR).
/// </summary>
public class MedicationAdministration : ITenantEntity
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant? Tenant { get; set; }

    public Guid ParticipantMedicationId { get; set; }
    public ParticipantMedication? ParticipantMedication { get; set; }

    /// <summary>Denormalized from ParticipantMedication for fast MAR queries.</summary>
    public Guid ParticipantId { get; set; }
    public Participant? Participant { get; set; }

    public Guid? TripInstanceId { get; set; }
    public TripInstance? TripInstance { get; set; }

    /// <summary>Null for PRN doses, which have no fixed schedule.</summary>
    public DateTime? ScheduledAt { get; set; }

    /// <summary>Always stored as UTC. The client supplies its own local-clock instant (which
    /// already resolves to the correct UTC instant regardless of zone) via
    /// <see cref="Odip.Application.DTOs.CreateAdministrationDto.AdministeredAt"/>; when that's
    /// absent (no-JS-timestamp fallback) the server stamps <see cref="DateTime.UtcNow"/> instead.
    /// See <see cref="AdministeredAtTimeZone"/> for the zone that instant should be *displayed*
    /// in.</summary>
    public DateTime? AdministeredAt { get; set; }

    /// <summary>
    /// The IANA time zone (e.g. "Australia/Sydney") the client was in when it captured
    /// <see cref="AdministeredAt"/>, so the MAR/report/witness-queue UIs can render the dose time
    /// faithfully as it looked to the person who gave it — rather than reinterpreting the UTC
    /// instant in whichever zone the *viewing* browser happens to be in. Null for records with no
    /// client-supplied timestamp (no-JS fallback) or from before this field existed; UI falls back
    /// to the viewer's local zone in that case.
    /// </summary>
    public string? AdministeredAtTimeZone { get; set; }

    public MedicationAdministrationStatus Status { get; set; }
    public string? DoseGiven { get; set; }

    /// <summary>Set server-side from the recording user's resolved identity — never
    /// client-supplied. Resolved the same way as <see cref="WitnessUserId"/>'s self-witness check:
    /// <c>ICurrentTenant.ViewAsUserId</c> takes priority (SuperAdmin "view as" switching), falling
    /// back to the JWT's own subject claim. Falls back to raw JWT claims
    /// (<c>fullName</c>/<c>ClaimTypes.Name</c>) only when no user row can be resolved at all (e.g.
    /// a test constructing the controller with no HTTP context).</summary>
    public string RecordedByName { get; set; } = string.Empty;

    /// <summary>The resolved user who recorded this administration, when resolvable. Nullable
    /// because a small number of legacy/edge-case callers (see <see cref="RecordedByName"/> remarks)
    /// have no resolvable user id — <see cref="RecordedByName"/> is always populated regardless.</summary>
    public Guid? RecordedByUserId { get; set; }
    public User? RecordedByUser { get; set; }

    /// <summary>
    /// Kept populated for backward compatibility with existing reads/reports — mirrors
    /// <see cref="WitnessStaff"/>'s name when a staff witness is selected, or the legacy free-text
    /// witness name when one isn't (older/unmigrated callers).
    /// </summary>
    public string? WitnessName { get; set; }

    /// <summary>The user selected to witness this administration, if any. Only this user may
    /// approve/decline the resulting request.</summary>
    public Guid? WitnessUserId { get; set; }
    public User? WitnessUser { get; set; }

    public WitnessStatus WitnessStatus { get; set; } = WitnessStatus.NotRequired;
    public DateTime? WitnessRequestedAt { get; set; }
    public DateTime? WitnessRespondedAt { get; set; }

    /// <summary>Required when Status is not Administered (refused/withheld/missed/wrong
    /// medication — MED-03).</summary>
    public string? Reason { get; set; }

    public string? PrnReason { get; set; }
    public string? PrnOutcome { get; set; }
    public DateTime? PrnOutcomeAt { get; set; }

    /// <summary>True when this dose was recorded despite breaching the PRN max-doses/min-interval ceiling.</summary>
    public bool LimitBreachAcknowledged { get; set; }

    /// <summary>MED-03: also required (non-whitespace) when Status is WrongMedication — holds
    /// what was actually given instead of the prescribed medication. Optional for every other
    /// status.</summary>
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
