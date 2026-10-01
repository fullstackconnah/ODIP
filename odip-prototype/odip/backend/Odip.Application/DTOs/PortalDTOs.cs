using System.Text.Json.Serialization;
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
// the risks, and the previous worker's handover. The shift-package DTOs NEVER return the NDIS
// number, plan or funding detail, or the structured diagnoses (primary / other), and they carry
// nothing about any participant other than the one on the caller's OWN shift. (The older
// PortalParticipantSummaryDto.MedicalSummary is coordinator-authored free text that predates this
// rule and is unchanged; it can mention a condition in the coordinator's own words.) Anything new
// that goes into these DTOs needs to pass the same test: "does the worker need this, on this shift,
// to keep this person safe?"
//
// Absent data is explicit: a missing value is returned as null (never as an empty string or a
// made-up default) so the UI can say "Not recorded" instead of silently showing nothing. The API
// serialises with DefaultIgnoreCondition = WhenWritingNull (Program.cs), which would DROP a null
// member from the JSON altogether, so every nullable member of the shift-package records carries
// [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)]: the key is always present, and a
// null means "not recorded". ShiftPackageWireContractTests pins that for every such record.
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
    /// <summary>The latest handover for this participant: the submitted-or-approved completion of the most recent shift that
    /// STARTED BEFORE this one (shift chronology, not submission time), or null when there has never been one. The next worker
    /// marks it read (<c>POST portal/shifts/{id}/handover/ack</c>). Also null when the shift's status withholds sensitive information
    /// (see <see cref="SensitiveInfoWithheldReason"/>).</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] PortalHandoverDto? Handover,
    /// <summary>The last 3 holders of this participant (most recent first, INCLUDING the handover's author): name and
    /// shift date only - a custody trail, never the text.</summary>
    IReadOnlyList<PortalHandoverTrailEntryDto> HandoverTrail,
    /// <summary>What still blocks Finish right now (only while InProgress; empty otherwise): a running break, and the doses in the
    /// shift's rostered window that have COME DUE (their time has arrived) and have no outcome - but only for a worker who can record
    /// doses (<see cref="CanRecordDoses"/>); a worker without a current Medication Competency is never blocked on a dose they could
    /// not record. A dose still ahead is handed over, not blocked. Finish rejects with 422 SHIFT_FINISH_BLOCKED while this is
    /// non-empty; the list is computed by the same rule the server applies at Finish.</summary>
    IReadOnlyList<PortalFinishBlockerDto> FinishBlockers,
    /// <summary>The provider's IANA time zone (e.g. "Australia/Sydney"). Every wall-clock time in this DTO
    /// (<c>startTime</c>, dose <c>scheduledAt</c>, routine <c>occursAt</c>) is in this zone; instants are UTC.</summary>
    string TimeZoneId,
    /// <summary>The critical care facts, in fixed groups, with explicit nulls for anything not recorded.</summary>
    PortalAtAGlanceDto AtAGlance,
    /// <summary>Active emergency contacts, first call first (priority, then primary). Explicit null when the shift's status withholds sensitive
    /// information (anything but Published or InProgress): see <see cref="SensitiveInfoWithheldReason"/>.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] IReadOnlyList<PortalEmergencyContactDto>? EmergencyContacts,
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
    /// <summary>Whether the caller may record doses, per the provider Medication Competency mode. With a current credential: true. Without
    /// one: in ENFORCE mode false (the server answers 403 on every administration; this lets the UI explain instead of letting the worker
    /// tap and fail), in WARN mode (the default) still TRUE - the dose is recorded and FLAGGED, and <see cref="CanRecordDosesReason"/>
    /// carries the warning to show.</summary>
    bool CanRecordDoses,
    /// <summary>Null with a current credential. Otherwise plain language: the refusal reason when <see cref="CanRecordDoses"/> is false
    /// (Enforce), or the warning "Medication Competency not current — this record will be flagged" when it is true (Warn).</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? CanRecordDosesReason,
    /// <summary>MEDICATION_COMPETENCY_MISSING | MEDICATION_COMPETENCY_EXPIRED | MEDICATION_COMPETENCY_UNVERIFIABLE whenever the credential is
    /// not current (in both modes: <see cref="CanRecordDoses"/> says whether it blocks); null with a current credential.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? CanRecordDosesReasonCode,
    /// <summary>NEED-TO-KNOW BY SHIFT STATUS. The participant's handover, emergency contacts and address are returned ONLY for a shift that is
    /// Published or InProgress - the shifts a worker still has to do. For any other status (PendingReview, Completed, Cancelled, Draft)
    /// <c>handover</c>, <c>emergencyContacts</c> and <c>atAGlance.address</c> are explicit null (and <c>handoverTrail</c> is empty), and this
    /// says why in plain language so the UI can explain instead of showing an unexplained gap. Null when nothing is withheld. The other
    /// at-a-glance care facts (allergies, diet, communication, behaviour, HIDPA) are unaffected.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? SensitiveInfoWithheldReason);

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
    /// <summary>The participant's address. Explicit null when the shift's status withholds sensitive information (see
    /// <see cref="PortalShiftDetailDto.SensitiveInfoWithheldReason"/>); its fields are individually null when not recorded.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] PortalAddressDto? Address);

public record PortalAllergiesDto(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Detail,
    /// <summary>Tri-state on purpose: true = anaphylaxis risk, false = recorded as no risk, null = not recorded. Never coerce null to false.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] bool? IsAnaphylaxisRisk,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? ManagementNotes);

public record PortalDietDto(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? ChokingRiskDetail,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? PegRegimeDetail,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? ModifiedDietDetail,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? MealAssistanceDetail,
    /// <summary>How medication is best given alongside food.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? MedicationTricks);

public record PortalCommunicationDto(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? ExpressiveSkills,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? ReceptiveSkills,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? ReadingAbility,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Aids);

public record PortalBehaviourDto(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Triggers,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? EarlyWarningSigns,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? DeEscalationStrategies,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? WhatNotToDo,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? WhatHelpsMeCalmDown);

/// <summary>The HIDPA (high intensity daily personal activities) flags a worker must not miss. A flag that is not set is false -
/// the underlying data has no "not recorded" state for these.</summary>
public record PortalHidpaDto(bool Epilepsy, bool EnteralFeeding, bool Dysphagia);

public record PortalAddressDto(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Street,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Suburb,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? State,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Postcode);

/// <summary>One emergency contact: who to call, and how.</summary>
public record PortalEmergencyContactDto(
    Guid Id,
    string Name,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Relationship,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Phone,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Mobile,
    bool IsPrimary,
    /// <summary>1 = first call; null when no order was recorded (those sort after the ranked ones).</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? PriorityOrder);

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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Strength,
    string DoseDescription,
    MedicationForm Form,
    MedicationRoute Route,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Directions,
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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] PortalDoseOutcomeDto? Outcome,
    PortalDoseWitnessDto Witness);

/// <summary>A recorded outcome for a dose.</summary>
public record PortalDoseOutcomeDto(
    Guid AdministrationId,
    /// <summary>Administered, Refused, Withheld, Missed (also how "not given this shift" is recorded, with its reason) or WrongMedication.</summary>
    MedicationAdministrationStatus Status,
    string RecordedByName,
    /// <summary>When the dose was given (UTC), for Administered records.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? AdministeredAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? AdministeredAtTimeZone,
    /// <summary>When the record was made (UTC).</summary>
    DateTime RecordedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Reason,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? DoseGiven,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Notes,
    /// <summary>True when the recorder did not hold a current Medication Competency (provider Warn mode): flagged for the coordinator.</summary>
    bool RecordedWithoutCompetency);

/// <summary>Whether a witness is needed for a dose and where that sign-off stands.</summary>
public record PortalDoseWitnessDto(
    /// <summary>High-risk medication: an administered dose needs a staff witness.</summary>
    bool Required,
    /// <summary>The witness sign-off state of the recorded dose; null while nothing is recorded.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] WitnessStatus? Status,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? WitnessName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? RequestedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? RespondedAt);

/// <summary>An "as needed" medication and what the worker needs to decide whether another dose is allowed.</summary>
public record PortalPrnDto(
    Guid MedicationId,
    string MedicationName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Strength,
    string DoseDescription,
    MedicationForm Form,
    MedicationRoute Route,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Directions,
    MedicationSupportLevel SupportLevel,
    bool IsHighRisk,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Indication,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? MaxDosesPer24h,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? MinIntervalMinutes,
    int DosesInLast24h,
    /// <summary>The most recent administered dose (UTC), or null.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? LastDoseAt,
    /// <summary>The maximum in any rolling 24 hours has been reached (recording another needs an acknowledged limit breach).</summary>
    bool MaxDosesReached,
    /// <summary>When the minimum interval since the last dose has elapsed (UTC); null when there is no interval or it has already elapsed.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? NextAvailableAt,
    /// <summary>The newest administered dose still awaiting its outcome ("was it effective?"), for
    /// <c>POST medications/administrations/{id}/outcome</c>.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] Guid? OutcomePendingAdministrationId);

/// <summary>A routine that applies inside the shift window.</summary>
public record PortalShiftRoutineDto(
    Guid Id,
    string Title,
    string Description,
    RoutineCategory Category,
    bool IsCritical,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] TimeOnly? StartTime,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] TimeOnly? EndTime,
    /// <summary>Provider-local start of the routine's first occurrence inside the window (clipped to the shift's start when it began
    /// earlier) - the time to group it under. Null for an untimed critical routine ("Anytime").</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? OccursAt,
    /// <summary>The occurrence falls on the day AFTER the shift's service date (an overnight shift's early hours).</summary>
    bool AfterMidnight,
    /// <summary>The worker ticked this routine done (persisted on the shift's completion: <c>POST portal/shifts/{id}/routines/{routineId}/check</c>).</summary>
    bool IsChecked,
    /// <summary>When it was ticked (UTC); explicit null when it is not.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? CheckedAt,
    /// <summary>Who ticked it; explicit null when it is not.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? CheckedByName);

/// <summary>
/// The latest handover for a participant, as the next worker sees it. <see cref="Text"/> is null when the author wrote
/// none (<see cref="NothingToHandOver"/> says whether they said so explicitly). The read state is the CALLER's.
/// </summary>
public record PortalHandoverDto(
    Guid CompletionId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Text,
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
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? ReadAt);

/// <summary>One holder in the custody trail: who worked the participant, and on which shift date.</summary>
public record PortalHandoverTrailEntryDto(Guid CompletionId, string WorkerName, DateOnly ShiftDate);

/// <summary>POST portal/shifts/{id}/handover/ack body. <see cref="CompletionId"/> (optional) names the handover the worker
/// believes they read; if a newer one has arrived since, the call is 409 SHIFT_HANDOVER_CHANGED and nothing is recorded.</summary>
public record AcknowledgeHandoverDto
{
    public Guid? CompletionId { get; init; }
}

/// <summary>One thing that must be cleared before Finish. <see cref="Code"/> is DOSE_OUTCOME_MISSING (a dose whose time has
/// arrived has no outcome) or BREAK_RUNNING (<see cref="MedicationId"/>, <see cref="MedicationName"/> and <see cref="ScheduledAt"/>
/// are then explicit nulls).</summary>
public record PortalFinishBlockerDto(
    string Code,
    string Message,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] Guid? MedicationId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? MedicationName,
    /// <summary>For a dose: the provider-local slot time (no zone suffix).</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? ScheduledAt);

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
