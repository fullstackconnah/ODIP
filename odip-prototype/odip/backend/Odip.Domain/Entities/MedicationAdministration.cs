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
    public DateTime? AdministeredAt { get; set; }

    public MedicationAdministrationStatus Status { get; set; }
    public string? DoseGiven { get; set; }

    /// <summary>Set server-side from the recording user's JWT claims — never client-supplied.</summary>
    public string RecordedByName { get; set; } = string.Empty;

    /// <summary>
    /// Kept populated for backward compatibility with existing reads/reports — mirrors
    /// <see cref="WitnessStaff"/>'s name when a staff witness is selected, or the legacy free-text
    /// witness name when one isn't (older/unmigrated callers).
    /// </summary>
    public string? WitnessName { get; set; }

    /// <summary>The staff member selected to witness this administration, if any. Only this staff
    /// member (via their own <c>User.StaffId</c>) may approve/decline the resulting request.</summary>
    public Guid? WitnessStaffId { get; set; }
    public Staff? WitnessStaff { get; set; }

    public WitnessStatus WitnessStatus { get; set; } = WitnessStatus.NotRequired;
    public DateTime? WitnessRequestedAt { get; set; }
    public DateTime? WitnessRespondedAt { get; set; }

    /// <summary>Required when Status is not Administered (refused/withheld/missed).</summary>
    public string? Reason { get; set; }

    public string? PrnReason { get; set; }
    public string? PrnOutcome { get; set; }
    public DateTime? PrnOutcomeAt { get; set; }

    /// <summary>True when this dose was recorded despite breaching the PRN max-doses/min-interval ceiling.</summary>
    public bool LimitBreachAcknowledged { get; set; }

    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
