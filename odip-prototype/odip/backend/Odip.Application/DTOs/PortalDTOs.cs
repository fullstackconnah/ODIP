using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// STAFF PORTAL DTOs ("My Shifts") — purpose-built, minimal-surface DTOs for the field-staff
// portal. Deliberately NOT the coordinator-scoped ShiftDto/MedicationDetailDto/etc — those
// carry fields (override reasons, findings, consent/prescriber detail, cross-tenant admin
// info) a support worker reading their own shift has no need to see. See PortalController.
// ══════════════════════════════════════════════════════════════

/// <summary>One of the caller's own rostered <see cref="Odip.Domain.Rostering.Shift"/> rows, list-shaped for the "My Shifts" week view.</summary>
public record PortalShiftSummaryDto(
    Guid Id,
    Guid ParticipantId,
    string ParticipantName,
    DateOnly ServiceDate,
    TimeOnly StartTime,
    TimeOnly EndTime,
    bool EndsNextDay,
    decimal DurationHours,
    SupportRatio Ratio,
    SleepoverType NightType,
    ShiftStatus Status,
    string? Notes);

/// <summary>One of the caller's own upcoming trip staffing assignments — included in the shifts list when cheap; see brief.</summary>
public record PortalTripAssignmentSummaryDto(
    Guid Id,
    Guid TripInstanceId,
    string? TripCode,
    string TripName,
    DateOnly AssignmentStart,
    DateOnly AssignmentEnd,
    bool IsDriver,
    AssignmentStatus Status);

/// <summary>
/// Response of GET /api/v1/portal/my-shifts. Post staff/user unification there is no separate
/// "not linked" state — every User IS its own staff identity — so a caller with no shifts (or
/// whose identity somehow can't be resolved) simply gets empty lists here, with no special
/// messaging payload.
/// </summary>
public record PortalShiftsResponseDto(
    List<PortalShiftSummaryDto> Shifts,
    List<PortalTripAssignmentSummaryDto> TripAssignments);

/// <summary>
/// Participant fields a support worker needs on shift — support/risk flags, mobility and
/// equipment needs, free-text summaries. Deliberately excludes NDIS/plan/funding/contact
/// detail that isn't shift-relevant.
/// </summary>
public record PortalParticipantSummaryDto(
    Guid Id,
    string FullName,
    bool IsHighSupport,
    bool IsIntensiveSupport,
    bool HasRestrictivePracticeFlag,
    SupportRatio SupportRatio,
    OvernightSupportType OvernightSupport,
    bool MobilityAidWheelchair,
    bool MobilityAidWalker,
    List<string> MobilitySupportOptions,
    bool RequiresHiLoBed,
    bool RequiresHoist,
    bool RequiresShowerChair,
    bool RequiresCommode,
    bool RequiresStandingMachine,
    string? MobilityNotes,
    string? EquipmentRequirements,
    string? TransportRequirements,
    string? MedicalSummary,
    string? BehaviourRiskSummary);

/// <summary>
/// An active medication chart entry, summarised for the portal — enough for a support worker
/// to recognise what's due and any special handling required, without the full clinical detail
/// (consent, prescriber, pharmacy, restrictive-practice authorisation refs) MedicationDetailDto carries.
/// </summary>
public record PortalMedicationSummaryDto(
    Guid Id,
    string Name,
    string? Strength,
    string? DoseDescription,
    MedicationType Type,
    string? TimesOfDay,
    bool IsHighRisk,
    bool IsPsychotropic,
    bool IsChemicalRestraint,
    DrugSchedule DrugSchedule,
    MedicationSupportLevel SupportLevel,
    string? PrnIndication);

/// <summary>
/// Response of GET /api/v1/portal/shifts/{id} — everything a support worker needs for one
/// shift: the shift itself, a participant summary, that participant's active routines (reuses
/// <see cref="ParticipantRoutineDto"/> from Task 2 — the frontend's existing
/// getRelevantRoutines() filters these down to the shift window), the participant's active risk
/// entries (INTAKE-09, reuses <see cref="ParticipantRiskEntryDto"/> — unlike routines these are
/// not shift-window filtered, since a risk applies regardless of time of day), and an
/// active-medications summary.
/// </summary>
public record PortalShiftDetailDto(
    Guid Id,
    DateOnly ServiceDate,
    TimeOnly StartTime,
    TimeOnly EndTime,
    bool EndsNextDay,
    decimal DurationHours,
    SupportRatio Ratio,
    SleepoverType NightType,
    ShiftStatus Status,
    string? Notes,
    PortalParticipantSummaryDto Participant,
    List<ParticipantRoutineDto> Routines,
    List<ParticipantRiskEntryDto> RiskEntries,
    List<PortalMedicationSummaryDto> Medications,
    ShiftCompletionDto? Completion,
    int ReturnCount,
    string? LastReturnReason,
    /// <summary>Breaks taken in the shift's active completion, oldest first (empty before Start). The same list rides on
    /// <c>completion.breaks</c>; it is repeated here so the package header can show a running break without reaching
    /// into the completion.</summary>
    IReadOnlyList<ShiftBreakDto> Breaks,
    /// <summary>The latest handover for this participant from a PREVIOUS shift (the most recent submitted-or-approved
    /// completion's), or null when there has never been one. The next worker marks it read
    /// (<c>POST portal/shifts/{id}/handover/ack</c>).</summary>
    PortalHandoverDto? Handover,
    /// <summary>The last 3 holders of this participant (most recent first, INCLUDING the handover's author): name and
    /// shift date only - a custody trail, never the text.</summary>
    IReadOnlyList<PortalHandoverTrailEntryDto> HandoverTrail,
    /// <summary>What still blocks Finish right now (only while InProgress; empty otherwise): doses in the shift window
    /// with no outcome, and a running break. Finish rejects with 422 SHIFT_FINISH_BLOCKED while this is non-empty.</summary>
    IReadOnlyList<PortalFinishBlockerDto> FinishBlockers);

/// <summary>
/// The latest handover for a participant, as the next worker sees it. <see cref="Text"/> is null when the author wrote
/// none (<see cref="NothingToHandOver"/> says whether they said so explicitly). The read state is the CALLER's.
/// </summary>
public record PortalHandoverDto(
    Guid CompletionId,
    string? Text,
    bool NothingToHandOver,
    Guid AuthorUserId,
    string AuthorName,
    /// <summary>The service date of the shift the handover came from.</summary>
    DateOnly ShiftDate,
    /// <summary>When the author finished the shift (UTC).</summary>
    DateTime SubmittedAt,
    /// <summary>True when there is text to read (a blank or "nothing to hand over" handover needs no acknowledgement).</summary>
    bool RequiresAcknowledgement,
    /// <summary>The caller has marked this handover as read.</summary>
    bool IsRead,
    DateTime? ReadAt);

/// <summary>One holder in the custody trail: who worked the participant, and on which shift date.</summary>
public record PortalHandoverTrailEntryDto(Guid CompletionId, string WorkerName, DateOnly ShiftDate);

/// <summary>POST portal/shifts/{id}/handover/ack body. <see cref="CompletionId"/> (optional) names the handover the worker
/// believes they read; if a newer one has arrived since, the call is 409 SHIFT_HANDOVER_CHANGED and nothing is recorded.</summary>
public record AcknowledgeHandoverDto
{
    public Guid? CompletionId { get; init; }
}

/// <summary>One thing that must be cleared before Finish. <see cref="Code"/> is DOSE_OUTCOME_MISSING or BREAK_RUNNING.</summary>
public record PortalFinishBlockerDto(
    string Code,
    string Message,
    Guid? MedicationId,
    string? MedicationName,
    /// <summary>For a dose: the provider-local slot time (no zone suffix).</summary>
    DateTime? ScheduledAt);

/// <summary>
/// A medication administration OR an incident report (IN-7) awaiting (or already given) the
/// caller's staff-witness sign-off — GET /api/v1/portal/witness-requests unions both sources into
/// one list, ordered by CreatedAt, discriminated by <see cref="SourceType"/> ("Medication" |
/// "Incident"). Deliberately non-breaking for the two existing consumers (AppLayout's sidebar
/// badge, PortalShiftsPage's badge) — both only ever read <c>.length</c>, never an individual
/// field, so widening every medication-only/incident-only field to nullable here costs them
/// nothing. Approve/decline for a medication row stays on the original bodiless
/// <c>/portal/witness-requests/{id}/approve|decline</c> endpoints; an incident row uses the new
/// <c>/portal/incident-witness-requests/{id}/approve|decline</c> endpoints, which additionally
/// accept an optional witness statement.
/// </summary>
public record PortalWitnessRequestDto(
    Guid Id,
    string SourceType,
    Guid ParticipantId,
    string ParticipantName,
    Guid? MedicationId,
    string? MedicationName,
    string? Strength,
    string? DoseDescription,
    string? DoseGiven,
    Guid? IncidentReportId,
    string? IncidentTitle,
    IncidentType? IncidentType,
    IncidentSeverity? IncidentSeverity,
    /// <summary>"Recorded by" for a medication row, "Reported by" for an incident row.</summary>
    string RecordedByName,
    DateTime? AdministeredAt,
    string? AdministeredAtTimeZone,
    DateTime? IncidentDateTime,
    WitnessStatus WitnessStatus,
    DateTime? WitnessRespondedAt,
    DateTime CreatedAt);

/// <summary>IN-7: optional witness statement supplied at approve/decline time — see
/// <see cref="Odip.Domain.Entities.IncidentWitness.StatementText"/>. Never overwrites a
/// previously-typed statement with null when omitted.</summary>
public record PortalRespondIncidentWitnessRequestDto(string? StatementText);
