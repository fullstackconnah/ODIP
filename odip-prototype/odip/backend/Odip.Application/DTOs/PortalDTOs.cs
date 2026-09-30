using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// STAFF PORTAL DTOs ("My Shifts") — purpose-built DTOs for the field-staff portal. Deliberately
// NOT the coordinator-scoped ShiftDto/MedicationDetailDto/etc — those carry fields (override
// reasons, findings, consent/prescriber detail, cross-tenant admin info) a support worker reading
// their own shift has no need to see. See PortalController.
//
// THE NEED-TO-KNOW RULE (shift package, decision D1). The portal returns what a support worker
// needs to do THIS shift safely and nothing more: the critical care facts (allergies and
// anaphylaxis, choking and diet, communication, behaviour-support essentials, HIDPA flags, the
// address), the participant's emergency contacts, the doses due in the shift window, the routines,
// the risks, and the previous worker's handover. It NEVER returns the NDIS number, plan or funding
// detail, or the full diagnoses, and it carries nothing about any participant other than the one on
// the caller's OWN shift. Anything new that goes into these DTOs needs to pass the same test:
// "does the worker need this, on this shift, to keep this person safe?"
//
// Absent data is explicit: a missing value is returned as null (never as an empty string or a
// made-up default) so the UI can say "Not recorded" instead of silently showing nothing.
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
/// equipment needs, free-text summaries. Excludes the NDIS number, plan, funding and full
/// diagnoses (see the need-to-know rule at the top of this file). The critical care facts live in
/// <see cref="PortalAtAGlanceDto"/> and the emergency contacts in <see cref="PortalEmergencyContactDto"/>.
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
    IReadOnlyList<PortalFinishBlockerDto> FinishBlockers,
    /// <summary>The provider's IANA time zone (e.g. "Australia/Sydney"). Every wall-clock time in this DTO
    /// (<c>startTime</c>, dose <c>scheduledAt</c>, routine <c>occursAt</c>) is in this zone; instants are UTC.</summary>
    string TimeZoneId,
    /// <summary>The critical care facts, in fixed groups, with explicit nulls for anything not recorded.</summary>
    PortalAtAGlanceDto AtAGlance,
    /// <summary>Active emergency contacts, first call first (priority, then primary).</summary>
    IReadOnlyList<PortalEmergencyContactDto> EmergencyContacts,
    /// <summary>Scheduled doses due in the shift's ROSTERED window (one calendar date, or two for an overnight shift), in
    /// time order, each with its state (Due / Overdue / Recorded), outcome and witness status. Overdue is judged in the
    /// provider's local time. Active medications only.</summary>
    IReadOnlyList<PortalDoseSlotDto> MedicationsDue,
    /// <summary>"As needed" medications: no schedule, so no slots - with indication, limits and the rolling 24-hour picture.</summary>
    IReadOnlyList<PortalPrnDto> Prn,
    /// <summary>Routines relevant to the shift window, matched on the server with overnight shifts handled (an after-midnight
    /// routine matches a 22:00-06:00 shift). Critical first, then in time order. <see cref="Routines"/> still carries
    /// every active routine, unfiltered.</summary>
    IReadOnlyList<PortalShiftRoutineDto> ShiftRoutines,
    /// <summary>The caller holds a current Medication Competency credential, so may record doses. The server enforces it
    /// on every administration (403 otherwise); this lets the UI explain instead of letting the worker tap and fail.</summary>
    bool CanRecordDoses,
    /// <summary>Plain-language reason when <see cref="CanRecordDoses"/> is false; null otherwise.</summary>
    string? CanRecordDosesReason,
    /// <summary>MEDICATION_COMPETENCY_MISSING | MEDICATION_COMPETENCY_EXPIRED | MEDICATION_COMPETENCY_UNVERIFIABLE; null when allowed.</summary>
    string? CanRecordDosesReasonCode);

// ── At a glance (need-to-know critical facts) ─────────────────────────────

/// <summary>
/// The critical care facts a worker must know before and during the shift, grouped as the package shows them. Every group is
/// always present; any field inside may be null = "Not recorded". Blank or whitespace-only text is normalised to null.
/// </summary>
public record PortalAtAGlanceDto(
    PortalAllergiesDto Allergies,
    PortalDietDto Diet,
    PortalCommunicationDto Communication,
    PortalBehaviourDto Behaviour,
    PortalHidpaDto Hidpa,
    PortalAddressDto Address);

public record PortalAllergiesDto(
    string? Detail,
    /// <summary>Tri-state on purpose: true = anaphylaxis risk, false = recorded as no risk, null = not recorded. Never coerce null to false.</summary>
    bool? IsAnaphylaxisRisk,
    string? ManagementNotes);

public record PortalDietDto(
    string? ChokingRiskDetail,
    string? PegRegimeDetail,
    string? ModifiedDietDetail,
    string? MealAssistanceDetail,
    /// <summary>How medication is best given alongside food.</summary>
    string? MedicationTricks);

public record PortalCommunicationDto(
    string? ExpressiveSkills,
    string? ReceptiveSkills,
    string? ReadingAbility,
    string? Aids);

public record PortalBehaviourDto(
    string? Triggers,
    string? EarlyWarningSigns,
    string? DeEscalationStrategies,
    string? WhatNotToDo,
    string? WhatHelpsMeCalmDown);

/// <summary>The HIDPA (high intensity daily personal activities) flags a worker must not miss. A flag that is not set is false -
/// the underlying data has no "not recorded" state for these.</summary>
public record PortalHidpaDto(bool Epilepsy, bool EnteralFeeding, bool Dysphagia);

public record PortalAddressDto(string? Street, string? Suburb, string? State, string? Postcode);

/// <summary>One emergency contact: who to call, and how.</summary>
public record PortalEmergencyContactDto(
    Guid Id,
    string Name,
    string? Relationship,
    string? Phone,
    string? Mobile,
    bool IsPrimary,
    /// <summary>1 = first call; null when no order was recorded (those sort after the ranked ones).</summary>
    int? PriorityOrder);

// ── Doses and routines in the shift window ─────────────────────────────────

/// <summary>Where a scheduled dose stands. <c>Overdue</c> = unrecorded and more than 60 minutes past its provider-local time.</summary>
public enum PortalDoseState
{
    Due,
    Overdue,
    Recorded,
}

/// <summary>One scheduled dose due in the shift window.</summary>
public record PortalDoseSlotDto(
    Guid MedicationId,
    string MedicationName,
    string? Strength,
    string DoseDescription,
    MedicationForm Form,
    MedicationRoute Route,
    string? Directions,
    MedicationSupportLevel SupportLevel,
    bool IsHighRisk,
    /// <summary>The slot as a provider-local wall-clock time (no zone suffix) - exactly what must be echoed back as
    /// <c>scheduledAt</c> when recording the dose.</summary>
    DateTime ScheduledAt,
    /// <summary>"08:00".</summary>
    string ScheduledTime,
    PortalDoseState State,
    /// <summary>Convenience: <c>State == Overdue</c>.</summary>
    bool IsOverdue,
    /// <summary>The recorded outcome, or null while nothing has been recorded for this slot.</summary>
    PortalDoseOutcomeDto? Outcome,
    PortalDoseWitnessDto Witness);

/// <summary>A recorded outcome for a dose.</summary>
public record PortalDoseOutcomeDto(
    Guid AdministrationId,
    /// <summary>Administered, Refused, Withheld, Missed (also how "not given this shift" is recorded, with its reason) or WrongMedication.</summary>
    MedicationAdministrationStatus Status,
    string RecordedByName,
    /// <summary>When the dose was given (UTC), for Administered records.</summary>
    DateTime? AdministeredAt,
    string? AdministeredAtTimeZone,
    /// <summary>When the record was made (UTC).</summary>
    DateTime RecordedAt,
    string? Reason,
    string? DoseGiven,
    string? Notes);

/// <summary>Whether a witness is needed for a dose and where that sign-off stands.</summary>
public record PortalDoseWitnessDto(
    /// <summary>High-risk medication: an administered dose needs a staff witness.</summary>
    bool Required,
    /// <summary>The witness sign-off state of the recorded dose; null while nothing is recorded.</summary>
    WitnessStatus? Status,
    string? WitnessName,
    DateTime? RequestedAt,
    DateTime? RespondedAt);

/// <summary>An "as needed" medication and what the worker needs to decide whether another dose is allowed.</summary>
public record PortalPrnDto(
    Guid MedicationId,
    string MedicationName,
    string? Strength,
    string DoseDescription,
    MedicationForm Form,
    MedicationRoute Route,
    string? Directions,
    MedicationSupportLevel SupportLevel,
    bool IsHighRisk,
    string? Indication,
    int? MaxDosesPer24h,
    int? MinIntervalMinutes,
    int DosesInLast24h,
    /// <summary>The most recent administered dose (UTC), or null.</summary>
    DateTime? LastDoseAt,
    /// <summary>The maximum in any rolling 24 hours has been reached (recording another needs an acknowledged limit breach).</summary>
    bool MaxDosesReached,
    /// <summary>When the minimum interval since the last dose has elapsed (UTC); null when there is no interval or it has already elapsed.</summary>
    DateTime? NextAvailableAt,
    /// <summary>The newest administered dose still awaiting its outcome ("was it effective?"), for
    /// <c>POST medications/administrations/{id}/outcome</c>.</summary>
    Guid? OutcomePendingAdministrationId);

/// <summary>A routine that applies inside the shift window.</summary>
public record PortalShiftRoutineDto(
    Guid Id,
    string Title,
    string Description,
    RoutineCategory Category,
    bool IsCritical,
    TimeOnly? StartTime,
    TimeOnly? EndTime,
    /// <summary>Provider-local start of the routine's first occurrence inside the window (clipped to the shift's start when it began
    /// earlier) - the time to group it under. Null for an untimed critical routine ("Anytime").</summary>
    DateTime? OccursAt,
    /// <summary>The occurrence falls on the day AFTER the shift's service date (an overnight shift's early hours).</summary>
    bool AfterMidnight);

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
