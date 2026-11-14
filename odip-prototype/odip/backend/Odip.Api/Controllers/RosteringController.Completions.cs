using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Api.Rostering;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;
using Odip.Api.Services;

namespace Odip.Api.Controllers;

public partial class RosteringController
{
    // ══════════════════════════════════════════════════════════════
    // SHIFT COMPLETION REVIEW (design spec §2/§3)
    // ══════════════════════════════════════════════════════════════

    /// <summary>
    /// The review queue. status defaults to PendingReview; other ShiftStatus values let the
    /// queue show shifts in other states (e.g. Completed, for already-approved history). Only
    /// shifts with a current active ShiftCompletion row are included.
    ///
    /// Critique I2: this used to materialise every matching Shift/ShiftCompletion, sort in
    /// memory, then Skip/Take the in-memory list — paging only the response body, not the work.
    /// The orchestrator's ruling for the fix (see the review) was deliberately NOT "persist an
    /// IsOutlierVariance boolean at Finish" — that would encode the currently-configured
    /// organisation's shift review minutes as data and go stale the moment the threshold
    /// changed. Instead the outlier predicate is evaluated per-row in SQL, against the
    /// already-persisted VarianceMinutesStart/VarianceMinutesEnd columns and the live threshold,
    /// so both the sort and the Skip/Take run in the database.
    ///
    /// The one piece that stays out of SQL is the true timezone-converted RosteredStart (needs a
    /// per-row TimeZoneInfo call EF can't translate) — the ORDER BY tiebreak below uses the raw
    /// Shift.ServiceDate/Shift.StartTime instead. Within one IANA zone these are monotonic with
    /// the converted RosteredStart for any single calendar ServiceDate (a DST transition would
    /// have to fall inside the shift's own service day to diverge them), and every existing test
    /// fixture uses one zone, so the ordering this endpoint returns is unchanged; it only stops
    /// being byte-for-byte identical to the old in-memory sort in the DST-transition-day/
    /// multi-timezone-tenant edge case the old code could reach only because it fully
    /// materialised the timezone conversion for every row anyway.
    /// </summary>
    [HttpGet("completions")]
    public async Task<ActionResult<ApiResponse<PagedResult<CompletionQueueItemDto>>>> GetCompletions(
        [FromQuery] ShiftStatus? status, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default, [FromQuery] string? after = null)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);
        var statusFilter = status ?? ShiftStatus.PendingReview;
        // Keyset paging (the dashboard reads the whole queue while others decide rows): `after` is the last row's sort key, so a row decided between two
        // page requests cannot move another across the page edge the way OFFSET does. `page` is ignored when it is given.
        CompletionCursor? cursor = null;
        if (after is not null)
        {
            if (!CompletionCursor.TryParse(after, out var parsed))
                return BadRequest(ApiResponse<PagedResult<CompletionQueueItemDto>>.Fail("The cursor was not valid."));
            cursor = parsed;
        }

        // Only shifts with a current active completion (inner join, not a dictionary lookup after
        // the fact) — narrows the row set the ORDER BY/Skip/Take below has to work over.
        var joined =
            from s in _db.Shifts
            join c in _db.ShiftCompletions on s.Id equals c.ShiftId
            where s.Status == statusFilter && c.IsActive
            select new { Shift = s, Completion = c };

        if (from.HasValue) joined = joined.Where(x => x.Shift.ServiceDate >= from.Value);
        if (to.HasValue) joined = joined.Where(x => x.Shift.ServiceDate <= to.Value);

        // Outlier-first (critique P1 — "no signal for what actually needs attention"), then
        // chronological. Math.Abs(int) and the boolean comparison both translate to SQL; no
        // nullable column is involved here (VarianceMinutesStart/End are non-nullable ints), so
        // the Postgres-vs-EF-InMemory null-ordering trap the hardening PR hit elsewhere
        // (GetShiftCompletions' SubmittedAt sort) doesn't apply to this key.
        // The threshold is each shift's own organisation's (lowest-Id settings row, clamped, 15 with no row), read in the same query so the queue stays one SQL page.
        var withThreshold = joined.Select(x => new
        {
            x.Shift, x.Completion,
            Threshold = Math.Min(OrganisationRules.MaxVarianceReviewMinutes, Math.Max(OrganisationRules.MinVarianceReviewMinutes,
                _db.AppSettings.IgnoreQueryFilters(new[] { TenantFilter.Name }).Where(a => a.TenantId == x.Shift.TenantId).OrderBy(a => a.Id)
                    .Select(a => (int?)a.VarianceReviewMinutes).FirstOrDefault() ?? OrganisationRules.Default.VarianceReviewMinutes)),
        });
        var keyed = withThreshold.Select(x => new
        {
            x.Shift, x.Completion, x.Threshold,
            Outlier = Math.Abs(x.Completion.VarianceMinutesStart) > x.Threshold || Math.Abs(x.Completion.VarianceMinutesEnd) > x.Threshold,
        });
        // The whole queue, counted before the cursor window on purpose: the client wants the queue size, not the rest after the cursor.
        var totalCount = await keyed.CountAsync(ct);
        var windowed = keyed;
        if (cursor is { } cur)
        {
            var (cOutlier, cDate, cStart, cId) = (cur.Outlier, cur.ServiceDate, cur.StartTime, cur.ShiftId);
            // Outliers sort first: after an outlier row come later outliers by the date, start and id keys, then every non-outlier; after a non-outlier only later non-outliers.
            windowed = keyed.Where(x => (cOutlier && !x.Outlier)
                || (x.Outlier == cOutlier && (x.Shift.ServiceDate > cDate
                    || (x.Shift.ServiceDate == cDate && (x.Shift.StartTime > cStart
                        || (x.Shift.StartTime == cStart && x.Shift.Id.CompareTo(cId) > 0))))));
        }
        var ordered = windowed
            .OrderByDescending(x => x.Outlier)
            .ThenBy(x => x.Shift.ServiceDate)
            .ThenBy(x => x.Shift.StartTime)
            .ThenBy(x => x.Shift.Id);   // unique: tied rows must page in one order, or a row at a page edge is repeated and another never read

        // Narrow projection (critique P2 — "hydrates full graphs") applied AFTER Skip/Take, so
        // only the requested page's rows are ever materialised.
        var pageRows = await ordered
            .Skip(cursor is null ? (page - 1) * pageSize : 0)
            .Take(pageSize)
            .Select(x => new
            {
                x.Outlier, x.Threshold, x.Shift.Id, x.Shift.TenantId, x.Shift.ServiceDate, x.Shift.StartTime, x.Shift.EndTime, x.Shift.EndsNextDay, x.Shift.Status, x.Shift.ReturnCount, x.Shift.ParticipantId,
                ParticipantName = x.Shift.Participant != null ? x.Shift.Participant.FullName : string.Empty,
                StaffName = x.Shift.User != null ? x.Shift.User.FullName : string.Empty,
                CompletionId = x.Completion.Id, x.Completion.TimeZoneId, x.Completion.ActualStart, x.Completion.ActualEnd,
                x.Completion.VarianceMinutesStart, x.Completion.VarianceMinutesEnd, x.Completion.StartWasManual,
                TimesAdjusted = x.Completion.OriginalActualStart != null || x.Completion.OriginalActualEnd != null,
                x.Completion.ExtraTime,
            })
            .ToListAsync(ct);

        // Doses without an outcome and break minutes for the page's rows (bounded by the page size).
        var extras = await ShiftCompletionMapper.QueueExtrasAsync(
            _db,
            pageRows.Select(r => new ShiftCompletionMapper.QueueExtrasInput(
                r.Id, r.TenantId, r.CompletionId, r.ParticipantId, r.ServiceDate, r.StartTime, r.EndTime, r.EndsNextDay, r.ActualStart, r.ActualEnd)).ToList(),
            ct);

        var items = pageRows.Select(row =>
        {
            var rosteredShift = new Shift
            {
                ServiceDate = row.ServiceDate, StartTime = row.StartTime, EndTime = row.EndTime, EndsNextDay = row.EndsNextDay,
            };
            var (rosteredStartUtc, rosteredEndUtc) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(rosteredShift, row.TimeZoneId);
            var isOutlier = ShiftCompletionMapper.IsOutlierVariance(row.VarianceMinutesStart, row.VarianceMinutesEnd, row.Threshold);
            return new CompletionQueueItemDto(
                row.Id, row.CompletionId, row.ParticipantName, row.StaffName,
                row.ServiceDate, rosteredStartUtc, rosteredEndUtc, row.ActualStart, row.ActualEnd,
                row.VarianceMinutesStart, row.VarianceMinutesEnd, row.Status,
                row.TimeZoneId, isOutlier, row.Threshold, row.ReturnCount,
                extras[row.CompletionId].DosesWithoutOutcome, extras[row.CompletionId].BreakMinutes, row.StartWasManual, row.TimesAdjusted,
                extras[row.CompletionId].IncidentCount, extras[row.CompletionId].MissingDetails,
                ShiftCompletionMapper.IsOffRoster(row.VarianceMinutesStart, row.VarianceMinutesEnd, row.ActualEnd), row.ExtraTime);
        }).ToList();

        return Ok(ApiResponse<PagedResult<CompletionQueueItemDto>>.Ok(
            new PagedResult<CompletionQueueItemDto>
            {
                Items = items, Page = page, PageSize = pageSize, TotalCount = totalCount,
                NextCursor = pageRows.Count == 0 ? null : new CompletionCursor(pageRows[^1].Outlier, pageRows[^1].ServiceDate, pageRows[^1].StartTime, pageRows[^1].Id).ToString(),
            }));
    }

    /// <summary>The sort key of one queue row (outlier first, then date, start time and shift id), as the opaque `after` token of GetCompletions.</summary>
    private readonly record struct CompletionCursor(bool Outlier, DateOnly ServiceDate, TimeOnly StartTime, Guid ShiftId)
    {
        public override string ToString() => string.Join('|', Outlier ? "1" : "0", ServiceDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            StartTime.ToString("HH:mm:ss.fffffff", CultureInfo.InvariantCulture), ShiftId);

        public static bool TryParse(string value, out CompletionCursor cursor)
        {
            cursor = default;
            var parts = value.Split('|');
            if (parts.Length != 4 || parts[0] is not ("0" or "1")
                || !DateOnly.TryParseExact(parts[1], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
                || !TimeOnly.TryParseExact(parts[2], "HH:mm:ss.fffffff", CultureInfo.InvariantCulture, DateTimeStyles.None, out var start)
                || !Guid.TryParse(parts[3], out var id)) return false;
            cursor = new CompletionCursor(parts[0] == "1", date, start, id);
            return true;
        }
    }

    /// <summary>
    /// What became of the shifts a bulk run sent: their review status, for the dashboard to tell a row that was decided from one the paged queue read
    /// merely skipped. Tenant-scoped through the Shift query filter, like the queue; an id that is not the caller's is simply absent.
    /// </summary>
    [HttpGet("completions/statuses")]
    public async Task<ActionResult<ApiResponse<List<CompletionStatusDto>>>> GetCompletionStatuses([FromQuery] Guid[] shiftIds, CancellationToken ct = default)
    {
        if (shiftIds.Length > PagingParams.MaxPageSize)
            return BadRequest(ApiResponse<List<CompletionStatusDto>>.Fail($"Ask for at most {PagingParams.MaxPageSize} shifts at a time."));
        var rows = await _db.Shifts.Where(s => shiftIds.Contains(s.Id)).Select(s => new CompletionStatusDto(s.Id, s.Status)).ToListAsync(ct);
        return Ok(ApiResponse<List<CompletionStatusDto>>.Ok(rows));
    }

    /// <summary>
    /// The current active ShiftCompletion for one shift, or 404 if none exists. Deliverable 2
    /// reverse link: this is the one completion surface that populates
    /// <see cref="ShiftCompletionDto.Incidents"/> — the list endpoint below and Approve/Return
    /// leave it empty (see <see cref="ToShiftCompletionDtoAsync"/> remarks).
    /// </summary>
    [HttpGet("shifts/{id:guid}/completion")]
    public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> GetShiftCompletion(Guid id, CancellationToken ct)
    {
        var completion = await _db.ShiftCompletions
            .Where(c => c.ShiftId == id && c.IsActive)
            .FirstOrDefaultAsync(ct);
        if (completion is null)
            return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift completion not found.", ShiftErrorCodes.ShiftCompletionNotFound));

        var shiftReturnCount = await _db.Shifts.Where(s => s.Id == id).Select(s => s.ReturnCount).FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, shiftReturnCount, ct, includeIncidents: true)));
    }

    /// <summary>
    /// Every completion for one shift, active and inactive, newest first — the review history
    /// PR2's review page needs (critique P2: "the resubmitting worker sees ReturnCount and nothing
    /// about why" — this is the coordinator-side counterpart). Same 404 rule as
    /// GetShiftCompletion: no rows for this ShiftId (whether the shift itself doesn't exist, or it
    /// simply hasn't been started yet) 404s identically — this surface never distinguishes them.
    /// </summary>
    [HttpGet("shifts/{id:guid}/completions")]
    public async Task<ActionResult<ApiResponse<List<ShiftCompletionDto>>>> GetShiftCompletions(Guid id, CancellationToken ct)
    {
        var completions = await _db.ShiftCompletions
            .Where(c => c.ShiftId == id)
            // SubmittedAt is null while InProgress; Postgres sorts DESC NULLS FIRST, LINQ-to-Objects NULLS LAST — coalesce so the key is total.
            .OrderByDescending(c => c.SubmittedAt ?? c.StartedAt)
            .ThenByDescending(c => c.StartedAt)
            .ToListAsync(ct);
        if (completions.Count == 0)
            return NotFound(ApiResponse<List<ShiftCompletionDto>>.Fail("Shift completion not found.", ShiftErrorCodes.ShiftCompletionNotFound));

        // All rows share ShiftId == id, so ReturnCount is fetched once (critique M7) instead of
        // once per completion.
        var shiftReturnCount = await _db.Shifts.Where(s => s.Id == id).Select(s => s.ReturnCount).FirstOrDefaultAsync(ct);
        var dtos = new List<ShiftCompletionDto>();
        foreach (var c in completions)
            dtos.Add(await ShiftCompletionMapper.ToDtoAsync(_db, c, shiftReturnCount, ct));
        return Ok(ApiResponse<List<ShiftCompletionDto>>.Ok(dtos));
    }

    /// <summary>
    /// Office approves a PendingReview shift. 404 if no shift or no active ShiftCompletion; 409
    /// SHIFT_NOT_PENDING_REVIEW if not PendingReview. No notification here — only Finish and
    /// Return raise one (deferred to the notifications spec, out of scope for this PR).
    /// </summary>
    [HttpPost("shifts/{id:guid}/completion/approve")]
    public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> ApproveCompletion(Guid id, CancellationToken ct, [FromQuery] bool requireClean = false, [FromBody] ApproveCompletionDto? dto = null)
    {
        var reviewerId = ResolveCurrentUserId();
        if (reviewerId is null)
            return Unauthorized(ApiResponse<ShiftCompletionDto>.Fail(
                "Your session is missing a user identity. Sign in again.", "AUTH_USER_MISSING"));

        // The shift row is held from here to the save, so a coordinator's break toggle (same lock) is either already in what we read or waits and is refused.
        await using var rowLock = await ShiftRowLock.AcquireAsync(_db, id, ct);
        var (shift, completion, error) = await ResolvePendingReviewCompletionAsync(id, ct);
        if (error is not null) return error;
        // A shift finished "details later" waits for the worker: nothing is approved while a detail is missing, so pay and claims never read a half-filled one.
        if ((await ShiftCompletionMapper.MissingDetailsAsync(_db, [completion!.Id], ct))[completion.Id].Count > 0)
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail(DetailsMissingMessage, ShiftErrorCodes.ShiftDetailsMissing));
        // The dashboard's one tap asks for this: a flag that appeared since its queue read refuses rather than approves. The Completions page approves
        // a flagged shift deliberately, after its review, so it leaves this off.
        if (requireClean && (await ShiftCompletionMapper.ShiftsNeedingReviewAsync(_db, [(shift!, completion!)], ct)).Count > 0)
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail(NeedsReviewMessage, ShiftErrorCodes.ShiftNeedsReview));
        // The Approve dialog may carry the extra-time choice. No choice approves as before and leaves extra time Pending (held at rostered hours); a choice for a completion with none is ignored.
        ExtraTimeDecision? choice = null;
        if (dto?.ExtraTime is not null && !TryParseExtraTimeChoice(dto.ExtraTime, out choice))
            return BadRequest(ApiResponse<ShiftCompletionDto>.Fail(ExtraTimeChoiceMessage, ShiftErrorCodes.ShiftExtraTimeChoiceInvalid));

        var now = DateTime.UtcNow;
        completion!.ReviewedByUserId = reviewerId;
        completion.ReviewedAt = now;
        completion.ReviewOutcome = ReviewOutcome.Approved;
        if (choice is not null && completion.ExtraTime is not null) completion.ExtraTime = choice;
        completion.UpdatedAt = now;

        shift!.Status = ShiftStatus.Completed;
        shift.UpdatedAt = now;

        await EmploymentHeroTimesheets.EnqueueAsync(_db, shift.TenantId, [(shift, completion)], now, ct);
        await _db.SaveChangesAsync(ct);
        await rowLock.CommitAsync(ct);
        return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, shift.ReturnCount, ct)));
    }

    private const string DetailsMissingMessage = "This shift is waiting on the worker to add its details.";

    private const string ExtraTimeChoiceMessage = "Choose to approve or decline the extra time.";

    private static bool TryParseExtraTimeChoice(string? word, out ExtraTimeDecision? choice)
    {
        choice = word?.Trim().ToLowerInvariant() switch { "approve" => ExtraTimeDecision.Approved, "decline" => ExtraTimeDecision.Declined, _ => null };
        return choice is not null;
    }

    /// <summary>
    /// A coordinator decides, or changes, the extra time on a completion: "approve" pays the actual times, "decline" pays rostered hours. Allowed while the shift is
    /// PendingReview or Completed with an active completion; 404 otherwise, 409 SHIFT_NO_EXTRA_TIME when the completion has none, 409 SHIFT_EXTRA_TIME_TOO_OLD when a Completed shift is past the Employment Hero change window. Employment Hero is updated by the
    /// sender's change check (the paid window changes the line's hash), so nothing is sent from here. The reply carries the reference of the claim that
    /// still counts for the shift (W2 PR3): a claim is never re-billed, so a decision made after claiming does not change it.
    /// </summary>
    [HttpPost("shifts/{id:guid}/completion/extra-time")]
    public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> DecideExtraTime(Guid id, [FromBody] DecideExtraTimeDto dto, CancellationToken ct)
    {
        if (!TryParseExtraTimeChoice(dto.Decision, out var choice))
            return BadRequest(ApiResponse<ShiftCompletionDto>.Fail(ExtraTimeChoiceMessage, ShiftErrorCodes.ShiftExtraTimeChoiceInvalid));

        await using var rowLock = await ShiftRowLock.AcquireAsync(_db, id, ct);
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        var completion = shift is null ? null : await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == id && c.IsActive, ct);
        if (shift is null || completion is null || shift.Status is not (ShiftStatus.PendingReview or ShiftStatus.Completed))
            return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Completion not found.", ShiftErrorCodes.ShiftCompletionNotFound));
        if (completion.ExtraTime is null)
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail("This shift has no extra time to decide.", ShiftErrorCodes.ShiftNoExtraTime));
        // Employment Hero is only re-checked inside the change window, so an older decision would show in Payroll but never reach the timesheet.
        if (shift.Status == ShiftStatus.Completed && shift.ServiceDate < (await ShiftTodayAsync(shift, ct)).AddDays(-EmploymentHeroTimesheetSender.ChangeWindowDays))
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail("This shift is more than 62 days old, so Employment Hero can't be updated from here. Change its hours in Employment Hero.", ShiftErrorCodes.ShiftExtraTimeTooOld));

        completion.ExtraTime = choice;
        completion.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await rowLock.CommitAsync(ct);
        // A shift already on a claim is never billed again (W2 PR3), so a decision after the claim changes pay, not the claim: say which claim holds it.
        var claimReference = await _db.ClaimLineItems.Where(BudgetLedgerService.ClaimLineStillCounts).Where(l => l.ShiftId == id).Select(l => l.TripClaim.ClaimReference).FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<ShiftCompletionDto>.Ok((await ToShiftCompletionDtoAsync(completion, shift.ReturnCount, ct)) with { ClaimReference = claimReference }));
    }

    /// <summary>
    /// Staff set the four provider-travel values on a shift's ACTIVE completion (travel PR-A1): how staff add travel on a hand-made shift, or correct the
    /// worker's after-shift estimate. The body replaces all four. Allowed while the shift is PendingReview, or Completed with no claim line that still counts
    /// (<see cref="BudgetLedgerService.ClaimLineStillCounts"/>, so a Rejected or Cancelled claim frees it again); otherwise 409 (SHIFT_TRAVEL_ON_CLAIM names the
    /// claim). A returned row is history and is never edited. The audit interceptor records the change.
    /// </summary>
    [HttpPut("shifts/{id:guid}/completion/travel")]
    public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> EditCompletionTravel(Guid id, [FromBody] EditCompletionTravelDto dto, CancellationToken ct)
    {
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift is null)
            return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift not found."));
        if (PortalController.CheckTravel(dto.PreShiftTravelMinutes, dto.PreShiftTravelKilometres, dto.PostShiftTravelMinutes, dto.PostShiftTravelKilometres) is { } bad)
            return BadRequest(ApiResponse<ShiftCompletionDto>.Fail(bad.Message, bad.Code));
        if (shift.Status is not (ShiftStatus.PendingReview or ShiftStatus.Completed))
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail(
                "Travel can be changed only while a shift is awaiting review or completed.", ShiftErrorCodes.ShiftNotPendingReview));

        var completion = await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == id && c.IsActive, ct);
        if (completion is null)
            return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Completion not found."));

        // The claim generator reads this completion inside the same per-participant lock, so a claim is never made from travel that is half-changed (carry N1).
        try
        {
            await using var held = await RosterGenerationLock.AcquireAsync(_db, shift.ParticipantId, ct, scope: "claim-generate");
            var claimReference = await _db.ClaimLineItems
            .Where(l => l.ShiftId == id).Where(BudgetLedgerService.ClaimLineStillCounts)
            .Select(l => l.TripClaim.ClaimReference).FirstOrDefaultAsync(ct);
        if (claimReference is not null)
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail(
                $"This shift is on claim {claimReference}. Change its travel on the claim, or cancel the claim first.", ShiftErrorCodes.ShiftTravelOnClaim));

        completion.PreShiftTravelMinutes = PortalController.TravelMinutes(dto.PreShiftTravelMinutes);
        completion.PreShiftTravelKilometres = PortalController.TravelKm(dto.PreShiftTravelKilometres);
        completion.PostShiftTravelMinutes = PortalController.TravelMinutes(dto.PostShiftTravelMinutes);
        completion.PostShiftTravelKilometres = PortalController.TravelKm(dto.PostShiftTravelKilometres);
        completion.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, shift.ReturnCount, ct)));
        }
        catch (RosterBusyException busy)
        {
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail(busy.Message));
        }
    }

    /// <summary>
    /// Staff set whether one break was taken WITH the participant (paid, counted as worked) or on the worker's own (unpaid, deducted), while the shift is
    /// awaiting review (W9). 404 for a shift, or a break of that shift's active completion, that isn't there (another organisation's, an archived
    /// completion's); 409 SHIFT_NOT_PENDING_REVIEW otherwise. The shift row lock is the one Approve takes: it stops a lost edit and makes each side re-read the kind,
    /// but it does not prove the approver saw the latest kind. The audit interceptor records the change.
    /// </summary>
    [HttpPut("shifts/{id:guid}/completion/breaks/{breakId:guid}/kind")]
    public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> SetCompletionBreakKind(Guid id, Guid breakId, [FromBody] SetShiftBreakKindDto dto, CancellationToken ct)
    {
        await using var rowLock = await ShiftRowLock.AcquireAsync(_db, id, ct);
        var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == id, ct);
        if (shift is null)
            return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Shift not found."));
        if (shift.Status != ShiftStatus.PendingReview)
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail(
                "A break can be changed only while a shift is awaiting review.", ShiftErrorCodes.ShiftNotPendingReview));

        var completion = await _db.ShiftCompletions.FirstOrDefaultAsync(c => c.ShiftId == id && c.IsActive, ct);
        if (completion is null)
            return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Completion not found."));
        var brk = await _db.ShiftBreaks.FirstOrDefaultAsync(b => b.Id == breakId && b.ShiftCompletionId == completion.Id, ct);
        if (brk is null)
            return NotFound(ApiResponse<ShiftCompletionDto>.Fail("Break not found."));

        brk.WithParticipant = dto.WithParticipant;
        brk.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        await rowLock.CommitAsync(ct);
        return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, shift.ReturnCount, ct)));
    }

    /// <summary>
    /// Office returns a PendingReview shift to the worker for correction. Same 404/409 as
    /// Approve, plus 400 if reason is blank. Sets ReviewOutcome = Returned, IsActive = false
    /// (excluding this row from the "current" 1:1 without deleting it), increments
    /// Shift.ReturnCount, flips Shift.Status back to Published.
    /// </summary>
    [HttpPost("shifts/{id:guid}/completion/return")]
    public async Task<ActionResult<ApiResponse<ShiftCompletionDto>>> ReturnCompletion(
        Guid id, [FromBody] ReturnCompletionDto dto, CancellationToken ct)
    {
        var reviewerId = ResolveCurrentUserId();
        if (reviewerId is null)
            return Unauthorized(ApiResponse<ShiftCompletionDto>.Fail(
                "Your session is missing a user identity. Sign in again.", "AUTH_USER_MISSING"));

        var (shift, completion, error) = await ResolvePendingReviewCompletionAsync(id, ct);
        if (error is not null) return error;

        var trimmedReason = (dto.Reason ?? string.Empty).Trim(); // JSON null must not NRE
        if (trimmedReason.Length == 0)
            return BadRequest(ApiResponse<ShiftCompletionDto>.Fail("A return reason is required.", ShiftErrorCodes.ShiftReturnReasonRequired));
        if (trimmedReason.Length > 500)
            return BadRequest(ApiResponse<ShiftCompletionDto>.Fail("Return reason must be 500 characters or fewer.", ShiftErrorCodes.ShiftReturnReasonTooLong));

        // SHIFT_ALREADY_CLAIMED (design spec §3) — now reachable: PR 3's AddShiftClaims
        // migration gives ClaimLineItem a ShiftId, and ShiftClaimGenerationService can attach a
        // claim line to a Completed shift. A shift can only reach here (PendingReview) again via
        // an un-cancel + re-Start/Finish cycle, but defend the invariant regardless.
        var claimedLine = await _db.ClaimLineItems.FirstOrDefaultAsync(l => l.ShiftId == id, ct);
        if (claimedLine is not null)
        {
            var claimReference = await _db.TripClaims
                .Where(c => c.Id == claimedLine.TripClaimId)
                .Select(c => c.ClaimReference)
                .FirstOrDefaultAsync(ct);
            return Conflict(ApiResponse<ShiftCompletionDto>.Fail(
                $"This shift has already been claimed ({claimReference}).", ShiftErrorCodes.ShiftAlreadyClaimed));
        }

        var now = DateTime.UtcNow;
        completion!.ReviewedByUserId = reviewerId;
        completion.ReviewedAt = now;
        completion.ReviewOutcome = ReviewOutcome.Returned;
        completion.ReturnReason = trimmedReason;
        completion.IsActive = false;
        completion.UpdatedAt = now;

        shift!.Status = ShiftStatus.Published;
        shift.ReturnCount += 1;
        shift.UpdatedAt = now;

        // NotificationEventType.ShiftCompletionReturned — reserved by the notifications spec,
        // wired here now the shift-completion feature exists (design spec §5, sibling event).
        // Recipient is the worker (completion.SubmittedByUserId), not the reviewer.
        var returnedWorker = await _db.Users.FirstOrDefaultAsync(u => u.Id == completion.SubmittedByUserId, ct);
        if (returnedWorker is not null)
        {
            var participantName = await _db.Participants.Where(p => p.Id == shift.ParticipantId)
                .Select(p => (p.FirstName + " " + p.LastName).Trim()).FirstOrDefaultAsync(ct) ?? "a participant";
            await _notificationRaiser.RaiseAsync(
                Odip.Domain.Notifications.NotificationEventType.ShiftCompletionReturned, "ShiftCompletion", completion.Id,
                new[] { returnedWorker.Id },
                new Odip.Infrastructure.Notifications.Templates.ShiftCompletionReturnedPayload(
                    returnedWorker.Email, participantName, shift.ServiceDate, trimmedReason),
                ct);
        }

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ShiftCompletionDto>.Ok(await ToShiftCompletionDtoAsync(completion, shift.ReturnCount, ct)));
    }

    /// <summary>
    /// Approves up to 100 PendingReview shifts in one call (critique P3 — "no batch approve"; the
    /// queue previously had no way to clear a day's clean submissions at once). Each id follows
    /// exactly the single-approve rules via <see cref="ResolvePendingReviewCompletion"/> — a
    /// failure on one id doesn't abort the batch. Two bulk queries load every shift/completion the
    /// batch could need up front (critique M3 — this used to run
    /// ResolvePendingReviewCompletionAsync per id, up to 2N round-trips) instead of querying per
    /// id; the classification rules themselves are shared with the single-approve/return path via
    /// ResolvePendingReviewCompletion, so per-item results/codes are unchanged. One
    /// SaveChangesAsync at the end; overall response is always 200 even when some items failed,
    /// since the response body itself reports per-item outcome.
    /// </summary>
    [HttpPost("completions/approve-batch")]
    public async Task<ActionResult<ApiResponse<List<ApproveBatchResultDto>>>> ApproveBatch(
        [FromBody] ApproveBatchDto dto, CancellationToken ct)
    {
        if (dto.ShiftIds is null || dto.ShiftIds.Count == 0 || dto.ShiftIds.Count > 100)
            return BadRequest(ApiResponse<List<ApproveBatchResultDto>>.Fail(
                "Select between 1 and 100 shifts.", ShiftErrorCodes.ShiftBatchSizeInvalid));

        var reviewerId = ResolveCurrentUserId();
        if (reviewerId is null)
            return Unauthorized(ApiResponse<List<ApproveBatchResultDto>>.Fail(
                "Your session is missing a user identity. Sign in again.", "AUTH_USER_MISSING"));

        var now = DateTime.UtcNow;
        var results = new List<ApproveBatchResultDto>();
        var approved = new List<(Shift Shift, ShiftCompletion Completion)>();

        // De-dup: EF identity resolution would hand the second occurrence the already-approved tracked entity and report a false SHIFT_NOT_PENDING_REVIEW.
        var distinctIds = dto.ShiftIds.Distinct().ToList();

        // Hold every shift row (sorted, so two batches cannot deadlock) from before the reads to the save: the first lock opens the transaction, the rest join it.
        await using var rowLock = await ShiftRowLock.AcquireAsync(_db, distinctIds.Min(), ct);
        foreach (var lockedId in distinctIds.Order().Skip(1)) await ShiftRowLock.AcquireAsync(_db, lockedId, ct);

        // Two bulk queries instead of up to 2N round-trips (critique M3). completionsByShiftId is
        // a superset of what every id actually needs (it doesn't pre-filter on shift status), but
        // that's cheaper than querying per id and doesn't change the outcome below.
        var shiftsById = await _db.Shifts
            .Where(s => distinctIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, ct);
        var completionsByShiftId = await _db.ShiftCompletions
            .Where(c => distinctIds.Contains(c.ShiftId) && c.IsActive)
            .ToDictionaryAsync(c => c.ShiftId, ct);

        var resolved = distinctIds.Select(shiftId =>
        {
            shiftsById.TryGetValue(shiftId, out var shift);
            completionsByShiftId.TryGetValue(shiftId, out var completion);
            return (ShiftId: shiftId, Resolved: ResolvePendingReviewCompletion(shift, completion));
        }).ToList();
        // Clean only (the dashboard's Complete all): the queue's flags re-read now, in one pass for the batch; a flagged shift is skipped, never approved.
        // A shift waiting on the worker for its details is left out, with or without CleanOnly: one query for the batch.
        var missingById = await ShiftCompletionMapper.MissingDetailsAsync(_db,
            resolved.Where(r => r.Resolved.Error is null).Select(r => r.Resolved.Completion!.Id).ToList(), ct);
        var needsReview = dto.CleanOnly
            ? await ShiftCompletionMapper.ShiftsNeedingReviewAsync(_db,
                resolved.Where(r => r.Resolved.Error is null).Select(r => (r.Resolved.Shift!, r.Resolved.Completion!)).ToList(), ct)
            : new HashSet<Guid>();

        foreach (var (shiftId, (resolvedShift, resolvedCompletion, error)) in resolved)
        {
            if (error is not null)
            {
                var (code, message) = ExtractBatchFailure(error);
                results.Add(new ApproveBatchResultDto(shiftId, false, code, message));
                continue;
            }
            if (missingById[resolvedCompletion!.Id].Count > 0)
            {
                results.Add(new ApproveBatchResultDto(shiftId, false, ShiftErrorCodes.ShiftDetailsMissing, DetailsMissingMessage));
                continue;
            }
            if (needsReview.Contains(shiftId))
            {
                results.Add(new ApproveBatchResultDto(shiftId, false, ShiftErrorCodes.ShiftNeedsReview, NeedsReviewMessage));
                continue;
            }

            resolvedCompletion!.ReviewedByUserId = reviewerId;
            resolvedCompletion.ReviewedAt = now;
            resolvedCompletion.ReviewOutcome = ReviewOutcome.Approved;
            resolvedCompletion.UpdatedAt = now;

            resolvedShift!.Status = ShiftStatus.Completed;
            resolvedShift.UpdatedAt = now;

            approved.Add((resolvedShift, resolvedCompletion));
            results.Add(new ApproveBatchResultDto(shiftId, true, null, null));
        }

        foreach (var group in approved.GroupBy(p => p.Shift.TenantId))
            await EmploymentHeroTimesheets.EnqueueAsync(_db, group.Key, group.ToList(), now, ct);
        await _db.SaveChangesAsync(ct);
        await rowLock.CommitAsync(ct);
        return Ok(ApiResponse<List<ApproveBatchResultDto>>.Ok(results));
    }

    /// <summary>Maps a ShiftCompletion to its DTO — thin wrapper so this and PortalController's
    /// identical mapping need to stay in one place; see <see cref="ShiftCompletionMapper"/>.
    /// <paramref name="includeIncidents"/> forwards to the mapper's own parameter — only
    /// GetShiftCompletion passes true (see that method's remarks).</summary>
    private Task<ShiftCompletionDto> ToShiftCompletionDtoAsync(ShiftCompletion c, int shiftReturnCount, CancellationToken ct, bool includeIncidents = false)
        => ShiftCompletionMapper.ToDtoAsync(_db, c, shiftReturnCount, ct, includeIncidents);

    private const string NeedsReviewMessage = "This shift needs review now: open it on the Completions page.";
}
