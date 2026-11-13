using System.ComponentModel.DataAnnotations;
using Odip.Application.Serialization;
using Odip.Domain.Enums;
namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// INCIDENT REPORT DTOs
// ══════════════════════════════════════════════════════════════

public record IncidentListDto
{
    public Guid Id { get; init; }
    public ServiceStreams ServiceType { get; init; }
    public Guid? TripInstanceId { get; init; }
    public string? TripName { get; init; }
    public IncidentType IncidentType { get; init; }
    /// <summary>Required (both ends) when <see cref="IncidentType"/> is <see cref="IncidentType.Other"/> (INC-02).</summary>
    public string? OtherTypeSpecify { get; init; }
    public IncidentSeverity Severity { get; init; }
    public IncidentStatus Status { get; init; }
    public string Title { get; init; } = string.Empty;
    [WallClock]
    public DateTime IncidentDateTime { get; init; }
    public string? Location { get; init; }
    public string? ReportedByName { get; init; }
    public Guid? InvolvedParticipantId { get; init; }
    public string? InvolvedParticipantName { get; init; }
    public QscReportingStatus QscReportingStatus { get; init; }
    public bool IsOverdue24h { get; init; }
    public DateTime CreatedAt { get; init; }
    /// <summary>Connection-map source link (Deliverable 1): the medication administration this incident was filed from, if any.</summary>
    public Guid? MedicationAdministrationId { get; init; }
    /// <summary>Connection-map source link (Deliverable 1): the shift this incident was filed from, if any.</summary>
    public Guid? ShiftId { get; init; }
    /// <summary>Connection-map source link (Deliverable 1): the shift note this incident was filed from, if any.</summary>
    public Guid? ShiftNoteId { get; init; }
}

public record IncidentDetailDto : IncidentListDto
{
    public Guid? ParticipantBookingId { get; init; }
    public Guid? InvolvedStaffId { get; init; }
    public string? InvolvedStaffName { get; init; }
    public Guid ReportedByStaffId { get; init; }
    /// <summary>INC-04: which of the register's 6 categories was used. Null unless <see cref="IncidentListDto.IncidentType"/> is <see cref="IncidentType.RestrictivePracticeUse"/>.</summary>
    public RestrictivePracticeType? RestrictivePracticeType { get; init; }
    /// <summary>INC-05: the linked register entry, if the reporter picked one of the involved participant's authorised practices.</summary>
    public Guid? RestrictivePracticeId { get; init; }
    public string? RestrictivePracticeDescription { get; init; }
    public DateOnly? RestrictivePracticeReviewDate { get; init; }
    /// <summary>IN-4: see <see cref="Entities.IncidentReport.UnapprovedRestrictivePracticeDetails"/>. Detail-only, mirrors <see cref="RestrictivePracticeId"/>'s own detail-only placement.</summary>
    public string? UnapprovedRestrictivePracticeDetails { get; init; }
    /// <summary>
    /// INC-04: true = an active register entry of <see cref="RestrictivePracticeType"/> existed for
    /// the involved participant at creation (authorised); false = none did (unauthorised —
    /// reportable-incident territory); null = not determinable (not an RP incident, or no
    /// participant selected). Frozen at creation — see the entity XML doc for why Update never
    /// recomputes this.
    /// </summary>
    public bool? IsRestrictivePracticeAuthorised { get; init; }
    /// <summary>Whether an authorised use departed from the behaviour support plan; null for legacy, unauthorised or undeterminable uses.</summary>
    public bool? RestrictivePracticeUseVaried { get; init; }
    public string Description { get; init; } = string.Empty;
    public string? ImmediateActionsTaken { get; init; }
    public bool WereEmergencyServicesCalled { get; init; }
    public string? EmergencyServicesDetails { get; init; }
    public EmergencyService EmergencyServices { get; init; }
    public string? PoliceOfficerName { get; init; }
    public string? AmbulanceOfficerName { get; init; }
    public string? FireOfficerName { get; init; }
    public string? PoliceReference { get; init; }
    public string? AmbulanceReference { get; init; }
    public string? FireReference { get; init; }
    public string? WitnessNames { get; init; }
    public string? WitnessStatements { get; init; }
    /// <summary>IN-5: recorded injuries, populated only when <see cref="IncidentListDto.IncidentType"/> is <see cref="IncidentType.Injury"/> (empty list otherwise).</summary>
    public List<IncidentInjuryDto> Injuries { get; init; } = new();
    /// <summary>IN-7: witnesses — staff (approvable) and free-text external witnesses in one list. See <see cref="Entities.IncidentWitness"/>.</summary>
    public List<IncidentWitnessDto> Witnesses { get; init; } = new();
    [WallClock]
    public DateTime? QscReportedAt { get; init; }
    public string? QscReferenceNumber { get; init; }
    /// <summary>When the provider became aware (an INSTANT): the stored value, or CreatedAt on a legacy row. The Commission deadline counts from it.</summary>
    public DateTime? AwareAt { get; init; }
    public ReportableClass ReportableClass { get; init; }
    public string? ReportableClassReason { get; init; }
    /// <summary>When the Commission must be told (an INSTANT). Null while the class is None.</summary>
    public DateTime? NotifyDueAt { get; init; }
    /// <summary>When the 5-day detailed report is due (an INSTANT). Within24h only.</summary>
    public DateTime? DetailedReportDueAt { get; init; }
    public bool DueCountedWithoutHolidays { get; init; }
    [WallClock]
    public DateTime? CommissionDetailedReportedAt { get; init; }
    public bool CommissionFinalReportRequested { get; init; }
    [WallClock]
    public DateTime? CommissionFinalReportedAt { get; init; }
    /// <summary>The provider zone (IANA id) the due lines and the Compliance step are shown in.</summary>
    public string TimeZoneId { get; init; } = string.Empty;
    public Guid? ReviewedByStaffId { get; init; }
    public string? ReviewedByName { get; set; }
    public DateTime? ReviewedAt { get; init; }
    public string? ReviewNotes { get; init; }
    public string? CorrectiveActions { get; init; }
    public DateTime? ResolvedAt { get; init; }
    public bool FamilyNotified { get; init; }
    [WallClock]
    public DateTime? FamilyNotifiedAt { get; init; }
    public bool SupportCoordinatorNotified { get; init; }
    [WallClock]
    public DateTime? SupportCoordinatorNotifiedAt { get; init; }
    public DateTime UpdatedAt { get; init; }

    /// <summary>Populated only when <see cref="IncidentListDto.MedicationAdministrationId"/> is set.</summary>
    public IncidentMedicationContextDto? MedicationContext { get; init; }
    /// <summary>Populated only when <see cref="IncidentListDto.ShiftId"/> is set.</summary>
    public IncidentShiftContextDto? ShiftContext { get; init; }
    /// <summary>Populated only when <see cref="IncidentListDto.ShiftNoteId"/> is set.</summary>
    public IncidentShiftNoteContextDto? ShiftNoteContext { get; init; }
}

/// <summary>Connection-map (Deliverable 1): summary of the medication administration an incident was filed from, for <see cref="IncidentDetailDto.MedicationContext"/>.</summary>
public record IncidentMedicationContextDto
{
    public Guid MedicationAdministrationId { get; init; }
    public string MedicationName { get; init; } = string.Empty;
    public MedicationAdministrationStatus Status { get; init; }
    public DateTime? AdministeredAt { get; init; }
    public string? RecordedByName { get; init; }
}

/// <summary>Connection-map (Deliverable 1): summary of the shift an incident was filed from, for <see cref="IncidentDetailDto.ShiftContext"/>.</summary>
public record IncidentShiftContextDto
{
    public Guid ShiftId { get; init; }
    public DateOnly Date { get; init; }
    public TimeOnly StartTime { get; init; }
    public TimeOnly EndTime { get; init; }
    public string ParticipantName { get; init; } = string.Empty;
    public string? StaffName { get; init; }
}

/// <summary>Connection-map (Deliverable 1): summary of the shift note an incident was filed from, for <see cref="IncidentDetailDto.ShiftNoteContext"/>.</summary>
public record IncidentShiftNoteContextDto
{
    public Guid ShiftNoteId { get; init; }
    public string Excerpt { get; init; } = string.Empty;
    // NOTES-02/connection-map: category names, same ShiftNoteKeywordVocabulary.ToCategoryNames-
    // produced shape as ShiftNoteDto.FlaggedCategories — not the raw [Flags] enum.
    public IReadOnlyList<string> FlaggedCategories { get; init; } = Array.Empty<string>();
    public DateTime CreatedAt { get; init; }
}

public record CreateIncidentDto
{
    /// <summary>Business stream the incident occurred under (INC-01). Defaults to <see cref="ServiceStreams.None"/>.</summary>
    public ServiceStreams ServiceType { get; init; } = ServiceStreams.None;
    /// <summary>Only meaningful (and validated server-side) when <see cref="ServiceType"/> is <see cref="ServiceStreams.Trip"/>.</summary>
    public Guid? TripInstanceId { get; init; }
    public Guid? ParticipantBookingId { get; init; }
    public Guid? InvolvedParticipantId { get; init; }
    public Guid? InvolvedStaffId { get; init; }
    [Required]
    public Guid ReportedByStaffId { get; init; }
    public IncidentType IncidentType { get; init; }
    /// <summary>Required (server-validated) when <see cref="IncidentType"/> is <see cref="IncidentType.Other"/> (INC-02).</summary>
    [StringLength(500)]
    public string? OtherTypeSpecify { get; init; }
    /// <summary>INC-04: required (server-validated) when <see cref="IncidentType"/> is <see cref="IncidentType.RestrictivePracticeUse"/> — same 6-value set as the participant register.</summary>
    public RestrictivePracticeType? RestrictivePracticeType { get; init; }
    /// <summary>INC-05: optional link to one of the involved participant's register entries. Must belong to <see cref="InvolvedParticipantId"/> and match <see cref="RestrictivePracticeType"/> (server-validated).</summary>
    public Guid? RestrictivePracticeId { get; init; }
    /// <summary>
    /// IN-4: free-text description of the restrictive practice actually used, when it was NOT one
    /// of the participant's approved/active register entries. Mutually exclusive with
    /// <see cref="RestrictivePracticeId"/> — a request setting both is rejected 400 (see
    /// <see cref="IncidentsController.ValidateServiceTypeAndIncidentType"/>). Never causes a
    /// <see cref="Entities.RestrictivePractice"/> row to be created or updated — see
    /// <see cref="Entities.IncidentReport.UnapprovedRestrictivePracticeDetails"/>'s doc.
    /// </summary>
    [StringLength(2000)]
    public string? UnapprovedRestrictivePracticeDetails { get; init; }
    /// <summary>
    /// "This use was not authorised": the linked register entry was used without (or outside) its authorisation. When true the incident is
    /// stored Unauthorised (<see cref="Entities.IncidentReport.IsRestrictivePracticeAuthorised"/> = false) and keeps its link. Create also
    /// stores Unauthorised whenever the linked entry is Not authorised, whatever this says. On Update it can only ever lower the frozen
    /// determination to false, never raise it.
    /// </summary>
    public bool UsedWithoutAuthorisation { get; init; }
    /// <summary>Create only; Update ignores it (UpdateIncidentDto inherits it). Whether an authorised use departed from the behaviour support plan. Stored only when the use is authorised; null (unanswered) is reportable.</summary>
    public bool? RestrictivePracticeUseVaried { get; init; }
    public IncidentSeverity Severity { get; init; }
    [Required, StringLength(300, MinimumLength = 1)]
    public string Title { get; init; } = string.Empty;
    [Required, StringLength(10000, MinimumLength = 1)]
    public string Description { get; init; } = string.Empty;
    [WallClock]
    public DateTime IncidentDateTime { get; init; }
    [StringLength(300)]
    public string? Location { get; init; }
    [StringLength(4000)]
    public string? ImmediateActionsTaken { get; init; }
    public bool WereEmergencyServicesCalled { get; init; }
    [StringLength(2000)]
    public string? EmergencyServicesDetails { get; init; }
    /// <summary>Null = not sent (a client from before services existed): Update leaves the stored services and their names and references alone.</summary>
    public EmergencyService? EmergencyServices { get; init; }
    [StringLength(100)]
    public string? PoliceOfficerName { get; init; }
    [StringLength(100)]
    public string? AmbulanceOfficerName { get; init; }
    [StringLength(100)]
    public string? FireOfficerName { get; init; }
    [StringLength(50)]
    public string? PoliceReference { get; init; }
    [StringLength(50)]
    public string? AmbulanceReference { get; init; }
    [StringLength(50)]
    public string? FireReference { get; init; }
    [StringLength(1000)]
    public string? WitnessNames { get; init; }
    [StringLength(4000)]
    public string? WitnessStatements { get; init; }
    /// <summary>
    /// IN-5: repeatable injury rows, backing the frontend <c>BodyDiagram</c> component. Only
    /// meaningful (server-validated as non-empty) when <see cref="IncidentType"/> is
    /// <see cref="Enums.IncidentType.Injury"/> — see <see cref="IncidentsController.ValidateServiceTypeAndIncidentType"/>.
    /// Update full-replaces the persisted collection with this list every time (see
    /// <see cref="Entities.IncidentInjury"/>'s type doc).
    /// </summary>
    public List<CreateIncidentInjuryDto> Injuries { get; init; } = new();

    /// <summary>
    /// IN-7: repeatable witness rows — staff (<see cref="CreateIncidentWitnessDto.WitnessUserId"/>
    /// set) and free-text external witnesses coexist in this one list. On Create every row is
    /// inserted fresh. On Update, a row whose <see cref="CreateIncidentWitnessDto.Id"/> matches an
    /// existing persisted witness has its already-set approval state preserved (see
    /// <see cref="IncidentsController.Update"/>) — only a row with no <see cref="CreateIncidentWitnessDto.Id"/>
    /// is treated as newly added.
    /// </summary>
    public List<CreateIncidentWitnessDto> Witnesses { get; init; } = new();

    /// <summary>One key per form session, sent again on every retry of the same submit. The server stores it trimmed and, when it has already saved an incident with this key for the same reporter, returns that incident instead of making a second one. Absent or blank means no de-duplication.</summary>
    [StringLength(100)]
    public string? IdempotencyKey { get; init; }

    /// <summary>Connection-map source link (Deliverable 1): set when this incident is being filed from a specific medication administration. Server-validated to exist (same-tenant scoped) when non-null.</summary>
    public Guid? MedicationAdministrationId { get; init; }
    /// <summary>Connection-map source link (Deliverable 1): set when this incident is being filed from a specific shift. Server-validated to exist (same-tenant scoped) when non-null.</summary>
    public Guid? ShiftId { get; init; }
    /// <summary>Connection-map source link (Deliverable 1): set when this incident is being filed from a specific shift note. Server-validated to exist (same-tenant scoped) when non-null.</summary>
    public Guid? ShiftNoteId { get; init; }
}

/// <summary>IN-5: one submitted injury row — see <see cref="Entities.IncidentInjury"/>.</summary>
public record CreateIncidentInjuryDto
{
    public BodyRegion Region { get; init; }
    public InjuryType InjuryType { get; init; }
    [StringLength(2000)]
    public string Description { get; init; } = string.Empty;
}

/// <summary>IN-5: one persisted injury row, as returned by <c>GET /incidents/{id}</c>.</summary>
public record IncidentInjuryDto
{
    public Guid Id { get; init; }
    public BodyRegion Region { get; init; }
    public InjuryType InjuryType { get; init; }
    public string Description { get; init; } = string.Empty;
}

/// <summary>
/// IN-7: one submitted witness row. <see cref="Id"/> is null/omitted for a newly-added witness
/// (Create, or a row added during an edit) and set to an existing <see cref="Entities.IncidentWitness.Id"/>
/// when the frontend is echoing back an already-persisted row on Update — see
/// <see cref="IncidentsController.Update"/> for why that distinction matters (preserving an
/// already-responded row's approval state rather than resetting it to Pending).
/// </summary>
public record CreateIncidentWitnessDto
{
    public Guid? Id { get; init; }
    /// <summary>Set for a staff witness — must resolve to an active User, and must not equal the
    /// incident's own ReportedByStaffId (self-witness is rejected, mirroring the medication
    /// witness flow's own rule). Null for a free-text/external witness.</summary>
    public Guid? WitnessUserId { get; init; }
    [Required, StringLength(300, MinimumLength = 1)]
    public string WitnessName { get; init; } = string.Empty;
}

/// <summary>IN-7: one persisted witness row, as returned by <c>GET /incidents/{id}</c>.</summary>
public record IncidentWitnessDto
{
    public Guid Id { get; init; }
    public Guid? WitnessUserId { get; init; }
    public string WitnessName { get; init; } = string.Empty;
    /// <summary>True when this is a staff witness (<see cref="WitnessUserId"/> set) — drives the
    /// frontend's Staff/External type badge.</summary>
    public bool IsStaffWitness { get; init; }
    public WitnessStatus WitnessStatus { get; init; }
    public DateTime? WitnessRequestedAt { get; init; }
    public DateTime? WitnessRespondedAt { get; init; }
    /// <summary>Optional, supplied by the witness themself at approval/decline time — see <see cref="Entities.IncidentWitness.StatementText"/>.</summary>
    public string? StatementText { get; init; }
}

public record UpdateIncidentDto : CreateIncidentDto
{
    /// <summary>The UpdatedAt the editor's form was loaded from; a different stored one is a 409. Null skips the check (restore, older clients).</summary>
    public DateTime? ExpectedUpdatedAt { get; init; }
    public IncidentStatus Status { get; init; }
    /// <summary>Ignored: the status is derived from the class and the report date. Kept so older clients do not get a 400.</summary>
    public QscReportingStatus QscReportingStatus { get; init; }
    [WallClock]
    public DateTime? QscReportedAt { get; init; }
    public string? QscReferenceNumber { get; init; }
    /// <summary>When the provider became aware, typed in the provider zone. Null keeps the stored value.</summary>
    [WallClock]
    public DateTime? AwareAtLocal { get; init; }
    /// <summary>Null keeps the stored class and reason.</summary>
    public ReportableClass? ReportableClass { get; init; }
    public string? ReportableClassReason { get; init; }
    // Full-replace like QscReportedAt: an omitted date clears.
    [WallClock]
    public DateTime? CommissionDetailedReportedAt { get; init; }
    /// <summary>Null keeps the stored flag.</summary>
    public bool? CommissionFinalReportRequested { get; init; }
    [WallClock]
    public DateTime? CommissionFinalReportedAt { get; init; }
    public bool FamilyNotified { get; init; }
    [WallClock]
    public DateTime? FamilyNotifiedAt { get; init; }
    public bool SupportCoordinatorNotified { get; init; }
    [WallClock]
    public DateTime? SupportCoordinatorNotifiedAt { get; init; }
}

/// <summary>The Admin review of an incident. The reviewer is the caller and the date is the server clock; neither is read from the body.</summary>
public record RecordIncidentReviewDto
{
    public string ReviewNotes { get; init; } = string.Empty;
    public string? CorrectiveActions { get; init; }
    public IncidentStatus Status { get; init; }
}

/// <summary>One change of an incident status, read from the audit trail (never the review text).</summary>
public record IncidentStatusChangeDto(DateTime At, string? ByName, IncidentStatus? From, IncidentStatus To);
