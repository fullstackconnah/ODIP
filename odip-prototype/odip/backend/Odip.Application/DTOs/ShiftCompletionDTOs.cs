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
    int ReturnCount,
    // Connection-map reverse link (Deliverable 2): active incidents raised against this shift —
    // populated on the RosteringController.GetShiftCompletion DETAIL endpoint only; every other
    // caller of ShiftCompletionMapper.ToDtoAsync gets an empty list (see the mapper's
    // includeIncidents parameter).
    IReadOnlyList<IncidentSummaryDto> Incidents);

/// <summary>Connection-map reverse link (Deliverable 2) summary row — one active IncidentReport
/// raised against a shift, as surfaced on <see cref="ShiftCompletionDto.Incidents"/>.</summary>
public record IncidentSummaryDto(Guid Id, string Title, IncidentSeverity Severity, IncidentStatus Status, DateTime IncidentDateTime);

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
