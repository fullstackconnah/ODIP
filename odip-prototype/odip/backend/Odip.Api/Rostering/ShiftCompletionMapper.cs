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

    /// <param name="includeIncidents">
    /// Deliverable 2 reverse link: when true, runs one extra query for the shift's active
    /// incidents and populates <see cref="ShiftCompletionDto.Incidents"/>. Defaults to false —
    /// only RosteringController's completion DETAIL endpoint (GetShiftCompletion) opts in; every
    /// other caller (the completions list, Approve/Return, PortalController's own detail) gets an
    /// empty list rather than paying for the extra query.
    /// </param>
    public static async Task<ShiftCompletionDto> ToDtoAsync(
        OdipDbContext db, ShiftCompletion c, int varianceReviewMinutes, CancellationToken ct, bool includeIncidents = false)
    {
        var submittedBy = await db.Users.FirstOrDefaultAsync(u => u.Id == c.SubmittedByUserId, ct);
        User? reviewedBy = c.ReviewedByUserId.HasValue
            ? await db.Users.FirstOrDefaultAsync(u => u.Id == c.ReviewedByUserId.Value, ct)
            : null;
        var shift = await db.Shifts.FirstOrDefaultAsync(s => s.Id == c.ShiftId, ct);

        IReadOnlyList<IncidentSummaryDto> incidents = Array.Empty<IncidentSummaryDto>();
        if (includeIncidents)
        {
            incidents = await db.IncidentReports
                .Where(i => i.ShiftId == c.ShiftId && i.IsActive)
                .OrderByDescending(i => i.IncidentDateTime)
                .Select(i => new IncidentSummaryDto(i.Id, i.Title, i.Severity, i.Status, i.IncidentDateTime))
                .ToListAsync(ct);
        }

        return new ShiftCompletionDto(
            c.Id, c.ShiftId, c.ActualStart, c.ActualEnd, c.TimeZoneId, c.GeolocationDeclined, c.StartWasManual,
            c.SubmittedByUserId, submittedBy?.FullName ?? string.Empty,
            c.StartedAt, c.SubmittedAt,
            c.ReviewedByUserId, reviewedBy?.FullName, c.ReviewedAt, c.ReviewOutcome, c.ReturnReason,
            c.VarianceMinutesStart, c.VarianceMinutesEnd,
            IsOutlierVariance(c.VarianceMinutesStart, c.VarianceMinutesEnd, varianceReviewMinutes),
            varianceReviewMinutes, shift?.ReturnCount ?? 0, incidents);
    }
}
