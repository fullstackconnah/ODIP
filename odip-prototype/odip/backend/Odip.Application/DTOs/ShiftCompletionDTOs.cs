using System.ComponentModel.DataAnnotations;
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
}

public record FinishShiftDto
{
    [Range(-90.0, 90.0)]
    public decimal? Latitude { get; init; }
    [Range(-180.0, 180.0)]
    public decimal? Longitude { get; init; }
    public bool GeolocationDeclined { get; init; }
    /// <summary>Supplied only on the manual-start path — Start was skipped, so Finish supplies the real ActualStart.</summary>
    public DateTime? ActualStart { get; init; }

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
}

/// <summary>
/// One break inside a shift. <see cref="Minutes"/> is whole minutes: for an ended break the time between
/// start and end, for a RUNNING break the time so far. Times are UTC instants.
/// </summary>
public record ShiftBreakDto(
    Guid Id,
    DateTime StartedAt,
    DateTime? EndedAt,
    bool IsRunning,
    int Minutes,
    DateTime? EditedAt,
    Guid CreatedByUserId);

/// <summary>
/// PUT portal/shifts/{id}/breaks/{breakId} body: the corrected times, as UTC instants (ISO 8601 with a Z;
/// an unsuffixed value is treated as UTC). <see cref="EndedAt"/> null keeps a RUNNING break running; an ended
/// break must keep an end. Only allowed while the shift is in progress (before Finish).
/// </summary>
public record EditShiftBreakDto
{
    public DateTime StartedAt { get; init; }
    public DateTime? EndedAt { get; init; }
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
    /// <summary>Whole minutes spent on breaks (a running break counts up to now).</summary>
    int BreakMinutes,
    /// <summary>Whole minutes worked: actual start to actual end (or now while in progress) minus breaks. Never negative.</summary>
    int NetWorkedMinutes,
    // ── Shift package: what the worker left at Finish ──
    /// <summary>The handover note left for the next worker; null when none was written.</summary>
    string? HandoverText,
    /// <summary>The worker confirmed "nothing to hand over".</summary>
    bool NothingToHandOver,
    /// <summary>The worker confirmed "nothing to note" instead of writing a shift note.</summary>
    bool NothingToNoteConfirmed);

/// <summary>Connection-map reverse link (Deliverable 2) summary row — one active IncidentReport
/// raised against a shift, as surfaced on <see cref="ShiftCompletionDto.Incidents"/>.</summary>
public record IncidentSummaryDto(Guid Id, string Title, IncidentSeverity Severity, IncidentStatus Status, DateTime IncidentDateTime);

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
    /// <summary>"As needed" doses administered between the actual start and end.</summary>
    IReadOnlyList<ReviewPrnDoseDto> PrnDoses,
    IReadOnlyList<ShiftNoteDto> Notes);

public record ReviewPrnDoseDto(
    Guid MedicationId,
    string MedicationName,
    string? Strength,
    string DoseDescription,
    PortalDoseOutcomeDto Outcome);

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
    int ReturnCount);

public record ReturnCompletionDto
{
    // F2: no [Required]/[StringLength] — RosteringController.ReturnCompletion's own empty-
    // check and 500-char cap own the entire reason-validation contract (both carry a SHIFT_*
    // code), so model-binding validation must not pre-empt either with a generic, code-less 400.
    public string Reason { get; init; } = string.Empty;
}

/// <summary>Batch-approve request (Task 8, critique P3 — "no batch approve"): 1-100 shift ids to approve in one call.</summary>
public record ApproveBatchDto(List<Guid> ShiftIds);

/// <summary>Per-item outcome for a batch-approve call. Code/Message are null on success, and also null for a not-found id (matching GetShiftCompletion's code-less 404).</summary>
public record ApproveBatchResultDto(Guid ShiftId, bool Approved, string? Code, string? Message);
