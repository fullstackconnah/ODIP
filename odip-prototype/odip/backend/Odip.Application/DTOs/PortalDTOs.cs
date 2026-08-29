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
/// Response of GET /api/v1/portal/my-shifts. <see cref="IsLinked"/> false means the caller's
/// User row has a null StaffId — an explicit, never-500 "not linked" payload the frontend
/// renders as guidance rather than an empty/broken shift list.
/// </summary>
public record PortalShiftsResponseDto(
    bool IsLinked,
    Guid? StaffId,
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
/// getRelevantRoutines() filters these down to the shift window), and an active-medications
/// summary.
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
    List<PortalMedicationSummaryDto> Medications);
