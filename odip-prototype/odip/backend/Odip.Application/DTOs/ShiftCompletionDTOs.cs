using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Odip.Application.Serialization;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// SHIFT COMPLETION DTOs (design spec §2) — Portal (start/finish) and Rostering
// (completions list/detail/approve/return) share this shape.
// ══════════════════════════════════════════════════════════════

public record StartShiftDto
{
    [Range(-90.0, 90.0)]
    public decimal? Latitude { get; init; }
    [Range(-180.0, 180.0)]
    public decimal? Longitude { get; init; }
    public bool GeolocationDeclined { get; init; }
    /// <summary>The phone's reported accuracy in metres. A double with no range, so any number binds; the server clamps it (never a 400 on Start).</summary>
    public double? AccuracyMetres { get; init; }
    /// <summary>Why there is no fix, typed before Start. Trimmed and cut to 300 by the server (never a 400 on Start).</summary>
    public string? LocationReason { get; init; }
    /// <summary>Why the start is more than 5 minutes off roster (optional). Trimmed and cut to 500 by the server (never a 400 on Start).</summary>
    public string? StartTimeReason { get; init; }
    /// <summary>When the phone recorded the tap, if it was sent late (UTC). Null: the server clock stamps it.</summary>
    public DateTime? StartedAt { get; init; }
}

/// <summary>POST portal/shifts/{id}/location-reason body: why the worker started away from the place. Text only, never a coordinate.</summary>
public record LocationReasonDto
{
    public string? Reason { get; init; }
}

/// <summary>Start Break body. Optional as a whole: an old client posts none.</summary>
public record StartBreakDto
{
    /// <summary>The client's id for the break, so a re-sent request is a no-op.</summary>
    public Guid? BreakId { get; init; }
    public DateTime? StartedAt { get; init; }
}

public record EndBreakDto
{
    public DateTime? EndedAt { get; init; }
}

public record FinishShiftDto
{
    [Range(-90.0, 90.0)]
    public decimal? Latitude { get; init; }
    [Range(-180.0, 180.0)]
    public decimal? Longitude { get; init; }
    public bool GeolocationDeclined { get; init; }
    /// <summary>
    /// On the manual-start path (a Published shift), the real ActualStart. While the shift is in progress, the worker's corrected start:
    /// within 15 minutes of the stamped start (compared to the minute), with a reason. Null keeps the stamp.
    /// </summary>
    public DateTime? ActualStart { get; init; }

    /// <summary>Why the finish is more than 5 minutes off roster (optional). Trimmed and cut to 500 by the server (never a 400); a re-Finish replaces it.</summary>
    public string? FinishTimeReason { get; init; }
    /// <summary>Why the start is off roster, asked at Finish when Start was skipped or the start was moved. Saved only when the completion has no start reason yet.</summary>
    public string? StartTimeReason { get; init; }

    /// <summary>
    /// The handover note for the next worker (max 2000 chars; blank is allowed - the handover is prompted but
    /// optional). Stored on the completion and shown to the participant's next worker.
    /// </summary>
    [StringLength(2000)]
    public string? HandoverText { get; init; }

    /// <summary>"Nothing to hand over", confirmed explicitly. Mutually exclusive with a non-blank <see cref="HandoverText"/> (400 SHIFT_HANDOVER_CONFLICT).</summary>
    public bool NothingToHandOver { get; init; }

    /// <summary>
    /// "Nothing to note", confirmed explicitly. Lets Finish proceed when the shift has no notes (otherwise
    /// 409 SHIFT_NOTE_REQUIRED, unchanged). Stored on the completion only when there really are no notes.
    /// </summary>
    public bool NothingToNote { get; init; }

    /// <summary>The worker's corrected end, a UTC instant: at most 15 minutes before the Finish instant (compared to the minute), and no more than
    /// the 5-minute clock-skew allowance after it. Null keeps the Finish instant.</summary>
    public DateTime? ActualEnd { get; init; }

    /// <summary>Why either time moved: required when one did; at most 500 characters (checked by the action, with a code).</summary>
    public string? TimeAdjustmentReason { get; init; }

    /// <summary>Kilometres driven with the participant, 0 to 2,000; stored to one decimal place. Null when not given. A double, not a decimal,
    /// so any number in the body binds and an out-of-range one gets the action's coded refusal, never an uncoded model-binding 400.</summary>
    public double? Kilometres { get; init; }

    // Provider travel (travel PR-A1): optional, doubles for the same reason as Kilometres. Minutes are whole, 0 to 480; kilometres 0 to 2,000, stored to one decimal place.
    /// <summary>Minutes of the trip to the participant, before the shift.</summary>
    public double? PreShiftTravelMinutes { get; init; }
    /// <summary>Kilometres of the trip before the shift.</summary>
    public double? PreShiftTravelKilometres { get; init; }
    /// <summary>Minutes of the trip after the shift.</summary>
    public double? PostShiftTravelMinutes { get; init; }
    /// <summary>Kilometres of the trip after the shift.</summary>
    public double? PostShiftTravelKilometres { get; init; }

    /// <summary>"Anything to report?": true, false, or null when skipped. Informational only.</summary>
    public bool? AnythingToReport { get; init; }

    /// <summary>When the phone recorded the tap, if it was sent late (UTC). Null: the server clock stamps it.</summary>
    public DateTime? FinishedAt { get; init; }
}

/// <summary>
/// One break inside a shift. <see cref="Minutes"/> is whole minutes: for an ended break the time between
/// start and end, for a RUNNING break the time so far. Times are UTC instants.
/// </summary>
public record ShiftBreakDto(
    Guid Id,
    DateTime StartedAt,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? EndedAt,
    bool IsRunning,
    int Minutes,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? EditedAt,
    Guid CreatedByUserId,
    bool WithParticipant = false);

/// <summary>
/// PUT portal/shifts/{id}/breaks/{breakId} body: the corrected times, as UTC instants (ISO 8601 with a Z;
/// an unsuffixed value is treated as UTC). <see cref="EndedAt"/> null keeps a RUNNING break running; an ended
/// break must keep an end. Only allowed while the shift is in progress (before Finish).
/// </summary>
public record EditShiftBreakDto
{
    public DateTime StartedAt { get; init; }
    public DateTime? EndedAt { get; init; }

    /// <summary>Who the break was with. Null keeps the stored value, so a cached older client never flips it.</summary>
    public bool? WithParticipant { get; init; }
}

/// <summary>PUT rostering/shifts/{id}/completion/breaks/{breakId}/kind body: a coordinator sets whether the worker ate with the participant.</summary>
public record SetShiftBreakKindDto
{
    public bool WithParticipant { get; init; }
}

public record ShiftCompletionDto(
    Guid Id,
    Guid ShiftId,
    DateTime ActualStart,
    DateTime? ActualEnd,
    string TimeZoneId,
    bool GeolocationDeclined,
    bool StartWasManual,
    Guid SubmittedByUserId,
    string SubmittedByName,
    DateTime StartedAt,
    DateTime? SubmittedAt,
    Guid? ReviewedByUserId,
    string? ReviewedByName,
    DateTime? ReviewedAt,
    ReviewOutcome? ReviewOutcome,
    string? ReturnReason,
    int VarianceMinutesStart,
    int VarianceMinutesEnd,
    bool IsOutlierVariance,
    int VarianceReviewMinutes,
    int ShiftReturnCount,
    // Connection-map reverse link (Deliverable 2): active incidents raised against this shift —
    // populated on the RosteringController.GetShiftCompletion DETAIL endpoint only; every other
    // caller of ShiftCompletionMapper.ToDtoAsync gets an empty list (see the mapper's
    // includeIncidents parameter).
    IReadOnlyList<IncidentSummaryDto> Incidents,
    // ── Shift package: breaks and net worked time. Billing stays on ROSTERED hours; these are a record. ──
    /// <summary>Breaks taken during this completion, oldest first.</summary>
    IReadOnlyList<ShiftBreakDto> Breaks,
    /// <summary>Whole minutes spent on UNPAID breaks, those the worker took on their own (a running break counts up to now). A break with the participant is paid and counts as worked.</summary>
    int BreakMinutes,
    /// <summary>Whole minutes worked: actual start to actual end (or now while in progress) minus breaks. Never negative.</summary>
    int NetWorkedMinutes,
    // ── Shift package: what the worker left at Finish ──
    /// <summary>The handover note left for the next worker; null when none was written.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? HandoverText,
    /// <summary>The worker confirmed "nothing to hand over".</summary>
    bool NothingToHandOver,
    /// <summary>The worker confirmed "nothing to note" instead of writing a shift note.</summary>
    bool NothingToNoteConfirmed,
    // My shifts redesign: what the worker confirmed at Finish (owner decisions 2 to 4).
    /// <summary>True when the worker moved either actual time at Finish; the originals below then hold the stamps.</summary>
    bool TimesAdjusted,
    /// <summary>The server's start stamp when the worker moved the start; null otherwise.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? OriginalActualStart,
    /// <summary>The Finish instant when the worker moved the end; null otherwise.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] DateTime? OriginalActualEnd,
    /// <summary>Why the worker moved a time; null when nothing moved.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? TimeAdjustmentReason,
    /// <summary>Kilometres driven with the participant, one decimal place; null when not given.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] decimal? Kilometres,
    /// <summary>Provider travel before the shift: whole minutes and kilometres (one decimal place); null when not given. Not <see cref="Kilometres"/>.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? PreShiftTravelMinutes,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] decimal? PreShiftTravelKilometres,
    /// <summary>Provider travel after the shift, to base or home; null when not given.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? PostShiftTravelMinutes,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] decimal? PostShiftTravelKilometres,
    /// <summary>"Anything to report?" at Finish: true, false, or null when skipped.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] bool? AnythingToReport,
    /// <summary>The worker sent a time recorded offline; the review page marks it.</summary>
    bool SentFromOffline,
    // ── Location check at Start: the answer only, never where the phone was ──
    /// <summary>Null when the shift was not checked (rows before the check, a manual start).</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] LocationCheckStatus? LocationCheck = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? LocationDistanceMetres = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] int? LocationAccuracyMetres = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? LocationReason = null,
    // ── Early or late Start and Finish: the reasons, and whether each side is more than 5 minutes off the roster ──
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? StartTimeReason = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? FinishTimeReason = null,
    bool OffRosterStart = false,
    bool OffRosterFinish = false,
    /// <summary>Null: no extra time. Pending and Declined are held at rostered hours in Employment Hero; Approved sends the actual times.</summary>
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] ExtraTimeDecision? ExtraTime = null);

/// <summary>Connection-map reverse link (Deliverable 2) summary row — one active IncidentReport
/// raised against a shift, as surfaced on <see cref="ShiftCompletionDto.Incidents"/>.</summary>
public record IncidentSummaryDto(Guid Id, string Title, IncidentSeverity Severity, IncidentStatus Status, [property: WallClock] DateTime IncidentDateTime);

/// <summary>
/// Everything a coordinator needs to review one submitted shift in a single payload: the completion (times, variance,
/// breaks, net worked minutes, handover, "nothing to note" confirmation, incidents), every scheduled dose in the rostered
/// window with its outcome, PRN doses given during the shift, and the shift notes. Returned by
/// <c>GET rostering/shifts/{id}/completion/review</c>; the Approve / Return endpoints are unchanged.
/// </summary>
public record ShiftCompletionReviewDto(
    ShiftCompletionDto Completion,
    string ParticipantName,
    string StaffName,
    DateOnly ServiceDate,
    /// <summary>The provider's IANA zone; scheduled dose times are wall-clock values in it.</summary>
    string TimeZoneId,
    /// <summary>Scheduled doses due in the rostered window, in time order. A slot whose <c>outcome</c> is null had nothing recorded.</summary>
    IReadOnlyList<PortalDoseSlotDto> Doses,
    /// <summary>"As needed" (PRN) doses the submitting worker administered between the actual start and end.</summary>
    IReadOnlyList<ReviewPrnDoseDto> PrnDoses,
    IReadOnlyList<ShiftNoteDto> Notes,
    /// <summary>The routines matched to the rostered window, with the worker's tick state on this completion (<c>isChecked</c>, <c>checkedAt</c>,
    /// <c>checkedByName</c>): critical first, then in time order. An unticked routine is one the worker did not tick off.</summary>
    IReadOnlyList<PortalShiftRoutineDto> Routines);

public record ReviewPrnDoseDto(
    Guid MedicationId,
    string MedicationName,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] string? Strength,
    string DoseDescription,
    PortalDoseOutcomeDto Outcome);

/// <summary>One shift's review status, for confirming what became of a row that is no longer in the queue.</summary>
public record CompletionStatusDto(Guid ShiftId, ShiftStatus Status);

public record CompletionQueueItemDto(
    Guid ShiftId,
    Guid CompletionId,
    string ParticipantName,
    string StaffName,
    DateOnly ServiceDate,
    DateTime RosteredStart,
    DateTime RosteredEnd,
    DateTime ActualStart,
    DateTime? ActualEnd,
    int VarianceMinutesStart,
    int VarianceMinutesEnd,
    ShiftStatus Status,
    string TimeZoneId,
    bool IsOutlierVariance,
    int VarianceReviewMinutes,
    int ReturnCount,
    /// <summary>How many scheduled doses in the shift's ROSTERED window have no outcome recorded (Administered, Refused, Withheld, Missed and
    /// WrongMedication all count as an outcome; a superseded record is history). Lets the review queue flag "doses without outcome" without
    /// opening each shift; the review (<c>GET rostering/shifts/{id}/completion/review</c>) lists them.</summary>
    int DosesWithoutOutcome,
    /// <summary>Total minutes of UNPAID breaks on the completion (the same figure as <c>ShiftCompletionDto.breakMinutes</c>).</summary>
    int BreakMinutes,
    /// <summary>True when the worker never pressed Start and supplied the start time when finishing (the manual-start path). That path skips the
    /// dose checklist (a Published shift has no route to record a dose), so the queue can flag such a row for a closer look without opening it;
    /// the same flag is on <c>ShiftCompletionDto.startWasManual</c>.</summary>
    bool StartWasManual,
    /// <summary>True when the worker moved the start or end at Finish, so the queue can say "Times adjusted by the worker" without opening the row.</summary>
    bool TimesAdjusted,
    /// <summary>How many active incidents are linked to the shift: the rows the completion review's <c>incidents</c> list shows (ShiftId and IsActive), so a row the
    /// queue calls clean is one whose review lists no incident. No default value: an unknown count must never read as "no incident".</summary>
    int IncidentCount,
    /// <summary>True when the start, or a set finish, is more than 5 minutes off the roster (<c>ShiftTimeRules.OffRosterMinutes</c>); a flagged row needs review.</summary>
    bool OffRoster = false,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.Never)] ExtraTimeDecision? ExtraTime = null);

/// <summary>Optional body of POST rostering/shifts/{id}/completion/approve. <c>ExtraTime</c> is "approve" (pay the actual time) or "decline" (pay rostered hours); absent leaves any extra time Pending.</summary>
public record ApproveCompletionDto(string? ExtraTime = null);

/// <summary>Body of POST rostering/shifts/{id}/completion/extra-time: "approve" or "decline".</summary>
public record DecideExtraTimeDto(string? Decision);

/// <summary>Body of PUT rostering/shifts/{id}/completion/travel: replaces all four travel values (an omitted one is cleared). Doubles, so an out-of-range
/// number gets the action's coded refusal, never an uncoded model-binding 400 (the FinishShiftDto precedent).</summary>
public record EditCompletionTravelDto
{
    public double? PreShiftTravelMinutes { get; init; }
    public double? PreShiftTravelKilometres { get; init; }
    public double? PostShiftTravelMinutes { get; init; }
    public double? PostShiftTravelKilometres { get; init; }
}

public record ReturnCompletionDto
{
    // F2: no [Required]/[StringLength] — RosteringController.ReturnCompletion's own empty-
    // check and 500-char cap own the entire reason-validation contract (both carry a SHIFT_*
    // code), so model-binding validation must not pre-empt either with a generic, code-less 400.
    public string Reason { get; init; } = string.Empty;
}

/// <summary>Batch-approve request (Task 8, critique P3 — "no batch approve"): 1-100 shift ids to approve in one call.</summary>
/// <param name="CleanOnly">The dashboard's: re-check the review queue's flags at approval time and skip a flagged shift (SHIFT_NEEDS_REVIEW). The Completions page approves flagged shifts deliberately, so it leaves this off.</param>
public record ApproveBatchDto(List<Guid> ShiftIds, bool CleanOnly = false);

/// <summary>Per-item outcome for a batch-approve call. Code/Message are null on success, and also null for a not-found id (matching GetShiftCompletion's code-less 404).</summary>
public record ApproveBatchResultDto(Guid ShiftId, bool Approved, string? Code, string? Message);
