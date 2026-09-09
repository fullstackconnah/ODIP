using Microsoft.EntityFrameworkCore;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Api.Rostering;

/// <summary>
/// Maps a <see cref="ShiftCompletion"/> to its DTO, resolving submitter/reviewer display names
/// and the "is this outlier variance" queue signal — shared by
/// <see cref="Odip.Api.Controllers.PortalController"/> (Start/Finish/detail) and
/// <see cref="Odip.Api.Controllers.RosteringController"/> (completions list/detail/approve/
/// return) so the two controllers can't drift. Same pattern as <see cref="RosterGate"/>.
/// </summary>
public static class ShiftCompletionMapper
{
    /// <summary>
    /// True when either variance leg exceeds the configured review threshold (critique P1 —
    /// "the coordinator's review queue has no signal for what actually needs attention").
    /// </summary>
    public static bool IsOutlierVariance(int varianceMinutesStart, int varianceMinutesEnd, int thresholdMinutes) =>
        Math.Abs(varianceMinutesStart) > thresholdMinutes || Math.Abs(varianceMinutesEnd) > thresholdMinutes;

    /// <summary>
    /// <paramref name="shiftReturnCount"/> is the owning Shift's ReturnCount, supplied by the
    /// caller rather than queried here (critique M7 — this used to re-query Shifts per
    /// completion, an N+1 when a caller maps many completions for the same shift). Every caller
    /// already holds the Shift or can fetch it once.
    /// </summary>
    public static async Task<ShiftCompletionDto> ToDtoAsync(OdipDbContext db, ShiftCompletion c, int varianceReviewMinutes, int shiftReturnCount, CancellationToken ct)
    {
        var submittedBy = await db.Users.FirstOrDefaultAsync(u => u.Id == c.SubmittedByUserId, ct);
        User? reviewedBy = c.ReviewedByUserId.HasValue
            ? await db.Users.FirstOrDefaultAsync(u => u.Id == c.ReviewedByUserId.Value, ct)
            : null;

        return new ShiftCompletionDto(
            c.Id, c.ShiftId, c.ActualStart, c.ActualEnd, c.TimeZoneId, c.GeolocationDeclined, c.StartWasManual,
            c.SubmittedByUserId, submittedBy?.FullName ?? string.Empty,
            c.StartedAt, c.SubmittedAt,
            c.ReviewedByUserId, reviewedBy?.FullName, c.ReviewedAt, c.ReviewOutcome, c.ReturnReason,
            c.VarianceMinutesStart, c.VarianceMinutesEnd,
            IsOutlierVariance(c.VarianceMinutesStart, c.VarianceMinutesEnd, varianceReviewMinutes),
            varianceReviewMinutes, shiftReturnCount);
    }
}
