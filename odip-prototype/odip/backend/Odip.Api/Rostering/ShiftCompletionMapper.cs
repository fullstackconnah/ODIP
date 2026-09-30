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
    /// Clamp bounds for the "Rostering:VarianceReviewMinutes" config key (critique M6). A
    /// configured 0 would flag every non-zero variance as an outlier, defeating the review
    /// queue's whole signal; a negative value is nonsensical for a minutes threshold. 240 (4
    /// hours) is the ceiling: a shift-punctuality "needs review" signal that only fires past a
    /// 4-hour variance is no longer useful for any shift length this domain schedules, so a
    /// configured value above it can only be a misconfiguration, never a deliberate policy
    /// choice.
    /// </summary>
    public const int MinVarianceReviewMinutes = 1;
    public const int MaxVarianceReviewMinutes = 240;

    /// <summary>Clamps a configured (or default) variance-review threshold into the sane range above.</summary>
    public static int ClampVarianceReviewMinutes(int configured) =>
        Math.Clamp(configured, MinVarianceReviewMinutes, MaxVarianceReviewMinutes);

    /// <summary>
    /// True when either variance leg exceeds the configured review threshold (critique P1 —
    /// "the coordinator's review queue has no signal for what actually needs attention").
    /// </summary>
    public static bool IsOutlierVariance(int varianceMinutesStart, int varianceMinutesEnd, int thresholdMinutes) =>
        Math.Abs(varianceMinutesStart) > thresholdMinutes || Math.Abs(varianceMinutesEnd) > thresholdMinutes;

    /// <summary>
    /// The CompletionQueueItemDto projection shared by StaffController's staff-overview endpoint
    /// (item 12 — RecentCompletions, filtered by staff and unbounded on status). NOTE:
    /// RosteringController.GetCompletions (the coordinator's review queue) does NOT use this —
    /// it runs its own outlier predicate/ordering/Skip-Take entirely in SQL (critique I2) rather
    /// than materialising every matching shift and paging in memory the way this helper does.
    /// Callers own their own filtering (via <paramref name="shiftQuery"/>), sort and paging —
    /// this only builds one DTO per shift that has an active ShiftCompletion.
    /// </summary>
    public static async Task<List<CompletionQueueItemDto>> BuildQueueItemsAsync(
        OdipDbContext db, IQueryable<Shift> shiftQuery, int varianceReviewMinutes, CancellationToken ct)
    {
        var shiftRows = await shiftQuery
            .Select(s => new
            {
                s.Id, s.ServiceDate, s.StartTime, s.EndTime, s.EndsNextDay, s.Status, s.ReturnCount,
                ParticipantName = s.Participant != null ? s.Participant.FullName : string.Empty,
                StaffName = s.User != null ? s.User.FullName : string.Empty,
            })
            .ToListAsync(ct);
        var shiftIds = shiftRows.Select(s => s.Id).ToList();

        var completionsByShiftId = await db.ShiftCompletions
            .Where(c => shiftIds.Contains(c.ShiftId) && c.IsActive)
            .ToDictionaryAsync(c => c.ShiftId, ct);

        var items = new List<CompletionQueueItemDto>();
        foreach (var row in shiftRows)
        {
            if (!completionsByShiftId.TryGetValue(row.Id, out var completion)) continue;
            var rosteredShift = new Shift
            {
                ServiceDate = row.ServiceDate, StartTime = row.StartTime, EndTime = row.EndTime, EndsNextDay = row.EndsNextDay,
            };
            var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(rosteredShift, completion.TimeZoneId);
            var isOutlier = IsOutlierVariance(completion.VarianceMinutesStart, completion.VarianceMinutesEnd, varianceReviewMinutes);
            items.Add(new CompletionQueueItemDto(
                row.Id, completion.Id, row.ParticipantName, row.StaffName,
                row.ServiceDate, rosteredStartUtc, rosteredEndUtc, completion.ActualStart, completion.ActualEnd,
                completion.VarianceMinutesStart, completion.VarianceMinutesEnd, row.Status,
                completion.TimeZoneId, isOutlier, varianceReviewMinutes, row.ReturnCount));
        }
        return items;
    }

    /// <summary>
    /// <paramref name="shiftReturnCount"/> is the owning Shift's ReturnCount, supplied by the
    /// caller rather than queried here (critique M7 — this used to re-query Shifts per
    /// completion, an N+1 when a caller maps many completions for the same shift). Every caller
    /// already holds the Shift or can fetch it once.
    /// </summary>
    /// <param name="includeIncidents">
    /// Deliverable 2 reverse link: when true, runs one extra query for the shift's active
    /// incidents and populates <see cref="ShiftCompletionDto.Incidents"/>. Defaults to false —
    /// only RosteringController's completion DETAIL endpoint (GetShiftCompletion) opts in; every
    /// other caller (the completions list, Approve/Return, PortalController's own detail) gets an
    /// empty list rather than paying for the extra query.
    /// </param>
    public static async Task<ShiftCompletionDto> ToDtoAsync(
        OdipDbContext db, ShiftCompletion c, int varianceReviewMinutes, int shiftReturnCount, CancellationToken ct,
        bool includeIncidents = false, DateTime? nowUtc = null)
    {
        var now = nowUtc ?? DateTime.UtcNow;
        var submittedBy = await db.Users.FirstOrDefaultAsync(u => u.Id == c.SubmittedByUserId, ct);
        User? reviewedBy = c.ReviewedByUserId.HasValue
            ? await db.Users.FirstOrDefaultAsync(u => u.Id == c.ReviewedByUserId.Value, ct)
            : null;

        IReadOnlyList<IncidentSummaryDto> incidents = Array.Empty<IncidentSummaryDto>();
        if (includeIncidents)
        {
            incidents = await db.IncidentReports
                .Where(i => i.ShiftId == c.ShiftId && i.IsActive)
                .OrderByDescending(i => i.IncidentDateTime)
                .Select(i => new IncidentSummaryDto(i.Id, i.Title, i.Severity, i.Status, i.IncidentDateTime))
                .ToListAsync(ct);
        }

        // Breaks and net worked time (the shift package). A running break counts up to `now`.
        var breaks = await db.ShiftBreaks
            .Where(b => b.ShiftCompletionId == c.Id)
            .OrderBy(b => b.StartedAt)
            .ToListAsync(ct);
        var (_, breakMinutes, netMinutes) = ShiftBreakRules.NetWorked(c.ActualStart, c.ActualEnd, now, breaks);

        return new ShiftCompletionDto(
            c.Id, c.ShiftId, c.ActualStart, c.ActualEnd, c.TimeZoneId, c.GeolocationDeclined, c.StartWasManual,
            c.SubmittedByUserId, submittedBy?.FullName ?? string.Empty,
            c.StartedAt, c.SubmittedAt,
            c.ReviewedByUserId, reviewedBy?.FullName, c.ReviewedAt, c.ReviewOutcome, c.ReturnReason,
            c.VarianceMinutesStart, c.VarianceMinutesEnd,
            IsOutlierVariance(c.VarianceMinutesStart, c.VarianceMinutesEnd, varianceReviewMinutes),
            varianceReviewMinutes, shiftReturnCount, incidents,
            breaks.Select(b => ToBreakDto(b, now)).ToList(), breakMinutes, netMinutes);
    }

    /// <summary>Maps a break; a running break's minutes are the time so far (up to <paramref name="nowUtc"/>).</summary>
    public static ShiftBreakDto ToBreakDto(ShiftBreak b, DateTime nowUtc)
    {
        var end = b.EndedAt ?? nowUtc;
        var minutes = end > b.StartedAt ? ShiftBreakRules.WholeMinutes(end - b.StartedAt) : 0;
        return new ShiftBreakDto(b.Id, b.StartedAt, b.EndedAt, b.IsRunning, minutes, b.EditedAt, b.CreatedByUserId);
    }
}
