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
    IReadOnlyList<ShiftBreakDto> Breaks);

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
