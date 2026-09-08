using System.ComponentModel.DataAnnotations;
using Odip.Domain.Rostering;

namespace Odip.Application.DTOs;

// ══════════════════════════════════════════════════════════════
// SHIFT COMPLETION DTOs (design spec §2) — Portal (start/finish) and Rostering
// (completions list/detail/approve/return) share this shape.
// ══════════════════════════════════════════════════════════════

public record StartShiftDto
{
    public decimal? Latitude { get; init; }
    public decimal? Longitude { get; init; }
    public bool GeolocationDeclined { get; init; }
}

public record FinishShiftDto
{
    public decimal? Latitude { get; init; }
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
    int ReturnCount);

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
    // F2: no [Required]/MinimumLength — RosteringController.ReturnCompletion's own
    // IsNullOrWhiteSpace guard owns the empty-reason contract (400 with its existing
    // message/code), so model-binding validation must not pre-empt it with a generic 400.
    [StringLength(2000)]
    public string Reason { get; init; } = string.Empty;
}
