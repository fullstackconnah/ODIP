using Odip.Domain.Enums;

namespace Odip.Domain.Entities;

/// <summary>
/// NDIS reportable incident — tracks incidents during trips,
/// including mandatory QSC escalation within 24 hours for critical incidents.
/// </summary>
public class IncidentReport
{
    public Guid Id { get; set; }

    /// <summary>
    /// Business-stream the incident occurred under (INC-01) — same value set as
    /// <see cref="Participant.ServiceStreams"/>, single-selected rather than combined. Defaults
    /// to <see cref="ServiceStreams.None"/> for incidents predating this field (no backfill).
    /// Selecting <see cref="ServiceStreams.Trip"/> is what makes <see cref="TripInstanceId"/>
    /// meaningful in the UI, but the two are independent at the data layer.
    /// </summary>
    public ServiceStreams ServiceType { get; set; } = ServiceStreams.None;

    // Trip context — optional (INC-01): only incidents against the Trip service stream link to
    // an actual TripInstance. Was a required FK before INC-01; existing rows keep their value.
    public Guid? TripInstanceId { get; set; }
    public TripInstance? TripInstance { get; set; }

    // Optional participant/staff links
    public Guid? ParticipantBookingId { get; set; }
    public ParticipantBooking? ParticipantBooking { get; set; }
    public Guid? InvolvedParticipantId { get; set; }
    public Participant? InvolvedParticipant { get; set; }
    public Guid? InvolvedUserId { get; set; }
    public User? InvolvedUser { get; set; }

    // Reporting user
    public Guid ReportedByUserId { get; set; }
    public User ReportedByUser { get; set; } = null!;

    // Incident details
    public IncidentType IncidentType { get; set; }

    /// <summary>Required specify text when <see cref="IncidentType"/> is <see cref="Enums.IncidentType.Other"/> (INC-02).</summary>
    public string? OtherTypeSpecify { get; set; }

    /// <summary>
    /// INC-04: required when <see cref="IncidentType"/> is <see cref="Enums.IncidentType.RestrictivePracticeUse"/> —
    /// which of the register's 6 categories was used, same value set as
    /// <see cref="RestrictivePractice.Type"/>. Null for every other incident type.
    /// </summary>
    public RestrictivePracticeType? RestrictivePracticeType { get; set; }

    /// <summary>
    /// INC-05: the specific register entry this incident was matched against, when the
    /// coordinator/support worker picked one from the involved participant's active practices of
    /// <see cref="RestrictivePracticeType"/>. Optional even on an RP incident — the participant may
    /// have no matching entry (that's exactly the unauthorised case), or the reporter may not have
    /// linked one. Tenant-scoped like every other <see cref="Entities.RestrictivePractice"/> FK.
    /// </summary>
    public Guid? RestrictivePracticeId { get; set; }
    public RestrictivePractice? RestrictivePractice { get; set; }

    /// <summary>
    /// IN-4: free-text description of the restrictive practice actually used, captured ONLY when
    /// the reporter did not link one of the involved participant's approved/active register
    /// entries above (<see cref="RestrictivePracticeId"/> null). Mutually exclusive with
    /// <see cref="RestrictivePracticeId"/> — enforced client-side (the wizard step's own
    /// superRefine) and server-side (<see cref="Api.Controllers.IncidentsController"/> 400s a
    /// request carrying both). <b>Recording this text NEVER creates or updates a row in
    /// <see cref="Entities.RestrictivePractice"/> — there is no code path anywhere, on Create or
    /// Update, that inserts into the participant's register from this field.</b> It exists purely
    /// so an incident can capture what happened even when it wasn't one of the participant's
    /// approved practices, without ever silently approving/registering that practice as a side
    /// effect.
    /// </summary>
    public string? UnapprovedRestrictivePracticeDetails { get; set; }

    /// <summary>
    /// INC-04: the authorised-vs-unauthorised determination, computed once at Create from whether
    /// the involved participant had an ACTIVE register entry of <see cref="RestrictivePracticeType"/>
    /// at that moment — true = authorised (a matching active entry existed), false = unauthorised
    /// (no matching active entry — reportable-incident territory), null = not determinable (not an
    /// RP incident, or no participant was selected). Deliberately frozen at creation and never
    /// recomputed by Update: an incident's authorised/unauthorised finding is a fact about what the
    /// register looked like at the time, not a live join that should silently change if the
    /// register is edited later or if the incident's own participant/type fields are corrected
    /// after the fact. The Update flow can still display it and let the fields it derived from be
    /// edited, but the stored determination itself only ever changes by creating a fresh incident.
    /// </summary>
    public bool? IsRestrictivePracticeAuthorised { get; set; }
    public IncidentSeverity Severity { get; set; }
    public IncidentStatus Status { get; set; } = IncidentStatus.Draft;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    // When/where
    public DateTime IncidentDateTime { get; set; }
    public string? Location { get; set; }

    // Immediate response
    public string? ImmediateActionsTaken { get; set; }
    public bool WereEmergencyServicesCalled { get; set; }
    public string? EmergencyServicesDetails { get; set; }

    // Witness/evidence
    public string? WitnessNames { get; set; }
    public string? WitnessStatements { get; set; }

    /// <summary>
    /// IN-5: recorded injuries when <see cref="IncidentType"/> is <see cref="Enums.IncidentType.Injury"/> —
    /// see <see cref="IncidentInjury"/> for the full-replace-on-Update contract.
    /// </summary>
    public List<IncidentInjury> Injuries { get; set; } = new();

    // QSC compliance
    public QscReportingStatus QscReportingStatus { get; set; } = QscReportingStatus.NotRequired;
    public DateTime? QscReportedAt { get; set; }
    public string? QscReferenceNumber { get; set; }

    // Review/resolution
    public Guid? ReviewedByUserId { get; set; }
    public User? ReviewedByUser { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewNotes { get; set; }
    public string? CorrectiveActions { get; set; }
    public DateTime? ResolvedAt { get; set; }

    // Notifications
    public bool FamilyNotified { get; set; }
    public DateTime? FamilyNotifiedAt { get; set; }
    public bool SupportCoordinatorNotified { get; set; }
    public DateTime? SupportCoordinatorNotifiedAt { get; set; }

    // Standard fields
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
