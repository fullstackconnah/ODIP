using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Rostering;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// A worker starts and finishes their own row on a group activity (GA PR3). A row that is not the caller's, on another organisation, or on a Draft activity answers 404 "Shift not found." exactly
/// as one that doesn't exist. Order of checks: the row, the switch, Cancelled, the row's state, the input, then the locks (the board lock only when this call starts the activity, then the row lock),
/// a re-read, and the state switch again under the locks so two taps can't both write. A refusal saves nothing. Live only: nothing here is queued offline.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/portal/activity-staff")]
public class PortalActivityShiftsController : ControllerBase
{
    private const string ShiftNotFoundMessage = "Shift not found.";
    private const string NotStartedMessage = "Start this shift before you finish it.";
    private const string StartTimeMessage = "Enter a start time in the last 24 hours.";
    private static readonly TimeSpan MaxTypedStartAge = TimeSpan.FromHours(24);

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly TimeProvider _clock;
    private readonly Odip.Application.Interfaces.INotificationRaiser _notificationRaiser;

    public PortalActivityShiftsController(OdipDbContext db, ICurrentTenant tenant, TimeProvider clock, Odip.Application.Interfaces.INotificationRaiser notificationRaiser)
    {
        _notificationRaiser = notificationRaiser;
        _db = db;
        _tenant = tenant;
        _clock = clock;
    }

    private ActionResult<ApiResponse<PortalActivityShiftDto>> Refuse(int status, string message, string? code = null)
    {
        var body = ApiResponse<PortalActivityShiftDto>.Fail(message, code);
        return status switch { 404 => NotFound(body), 409 => Conflict(body), _ => BadRequest(body) };
    }

    private async Task<Guid?> StaffIdAsync(CancellationToken ct)
    {
        var claim = User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
        Guid? own = Guid.TryParse(claim, out var parsed) ? parsed : null;
        var userId = _tenant.ViewAsUserId ?? own;
        return userId is { } id && await _db.Users.AnyAsync(u => u.Id == id && u.IsActive, ct) ? id : null;
    }

    private Task<GroupActivityStaff?> LoadRowAsync(Guid rowId, Guid staffId, CancellationToken ct) =>
        _db.GroupActivityStaff.Include(r => r.GroupActivity).FirstOrDefaultAsync(r => r.Id == rowId && r.UserId == staffId, ct);

    /// <summary>The refusal for this row's activity or state, or null when the call may go on. <paramref name="replay"/> is true when the row is already where the call would put it.</summary>
    private async Task<(ActionResult<ApiResponse<PortalActivityShiftDto>>? Refusal, bool Replay)> GateAsync(GroupActivityStaff? row, bool finishing, CancellationToken ct)
    {
        if (row?.GroupActivity is not { } activity || activity.Status == ShiftStatus.Draft) return (Refuse(404, ShiftNotFoundMessage), false);
        if (!await GroupActivitiesController.FlagOnAsync(_db, row.TenantId, ct)) return (Refuse(409, GroupActivitiesController.DisabledMessage, "GA_DISABLED"), false);
        // The flag is read on every write: do not turn it off while an activity is InProgress, its staff could not Finish until it is back on (GA PR3).
        if (activity.Status == ShiftStatus.Cancelled) return (Refuse(409, "This group activity is cancelled.", "GA_CANCELLED"), false);
        return row.State switch
        {
            GroupStaffRowState.Approved => (Refuse(409, "This shift has already been reviewed and completed.", ShiftErrorCodes.ShiftAlreadyCompleted), false),
            GroupStaffRowState.Finished when !finishing => (Refuse(409, "This shift has already been finished and is waiting for review.", ShiftErrorCodes.ShiftAlreadyFinished), false),
            GroupStaffRowState.Finished => (null, true),
            GroupStaffRowState.Started when !finishing => (null, true),
            _ => (null, false),
        };
    }

    private async Task<ActionResult<ApiResponse<PortalActivityShiftDto>>> AnswerAsync(GroupActivityStaff row, CancellationToken ct) =>
        Ok(ApiResponse<PortalActivityShiftDto>.Ok((await PortalActivityShifts.ToDtosAsync(_db, [row], ct))[0]));

    [HttpPost("{rowId:guid}/start")]
    public async Task<ActionResult<ApiResponse<PortalActivityShiftDto>>> Start(Guid rowId, [FromBody] StartActivityShiftDto dto, CancellationToken ct)
    {
        if (await StaffIdAsync(ct) is not { } staffId) return Refuse(404, ShiftNotFoundMessage);
        var row = await LoadRowAsync(rowId, staffId, ct);
        var (early, replay) = await GateAsync(row, finishing: false, ct);
        if (early is not null) return early;
        if (replay) return await AnswerAsync(row!, ct);

        try
        {
            await using var board = await RosterGenerationLock.AcquireAsync(_db, row!.TenantId, ct, RosterGenerationLock.DefaultWait, scope: "roster-board");
            await using var rowLock = await GroupStaffRowLock.AcquireAsync(_db, row.Id, ct);
            await _db.Entry(row).ReloadAsync(ct);
            if (_db.Entry(row).State == EntityState.Detached) return Refuse(404, ShiftNotFoundMessage);   // removed while we waited for the lock
            await _db.Entry(row.GroupActivity!).ReloadAsync(ct);
            (early, replay) = await GateAsync(row, finishing: false, ct);
            if (early is not null) return early;
            if (replay) return await AnswerAsync(row, ct);

            var activity = row.GroupActivity!;
            var now = _clock.GetUtcNow().UtcDateTime;
            var rowShift = RowShift(activity, row);
            var timeZoneId = (await ProviderTimeZoneResolver.ForShiftAsync(_db, rowShift, ct)).Id;
            var (rosteredStartUtc, _) = ShiftVarianceCalculator.ResolveRosteredTimesUtc(rowShift, timeZoneId);
            var earliest = rosteredStartUtc.AddMinutes(-PortalController.EarliestStartLeadMinutes);
            if (now < earliest) return Refuse(409, PortalController.TooEarlyMessage(earliest, timeZoneId), ShiftErrorCodes.ShiftStartTooEarly);

            // The coordinates live only in dto: the check's answer and distance are saved, never a latitude or longitude.
            var place = activity.ServiceLocationId is { } placeId
                ? await _db.ServiceLocations.AsNoTracking().FirstOrDefaultAsync(l => l.Id == placeId && l.TenantId == row.TenantId, ct)
                : null;
            // shortcut: no reason prompt after an off-site Start; add one if coordinators ask why
            var check = LocationCheck.Evaluate(place, dto.Latitude, dto.Longitude, dto.AccuracyMetres, dto.GeolocationDeclined, queued: false);
            row.ActualStart = now;
            row.StartedAt = now;
            row.TimeZoneId = timeZoneId;
            row.LocationCheck = check.Status;
            row.LocationDistanceMetres = check.DistanceMetres;
            if (activity.Status == ShiftStatus.Published) { activity.Status = ShiftStatus.InProgress; activity.UpdatedAt = now; }
            await RaiseFinishedAsync(row, activity, ct);
            await _db.SaveChangesAsync(ct);
            await board.CommitAsync(ct);
            return await AnswerAsync(row, ct);
        }
        catch (RosterBusyException)
        {
            _db.ChangeTracker.Clear();
            return Refuse(409, RosterGenerationLock.RosterBoardBusyMessage);
        }
    }

    [HttpPost("{rowId:guid}/finish")]
    public async Task<ActionResult<ApiResponse<PortalActivityShiftDto>>> Finish(Guid rowId, [FromBody] FinishActivityShiftDto dto, CancellationToken ct)
    {
        if (await StaffIdAsync(ct) is not { } staffId) return Refuse(404, ShiftNotFoundMessage);
        var row = await LoadRowAsync(rowId, staffId, ct);
        var (early, replay) = await GateAsync(row, finishing: true, ct);
        if (early is not null) return early;
        if (replay) return await AnswerAsync(row!, ct);
        if (row!.State == GroupStaffRowState.NotStarted && dto.ActualStart is null) return Refuse(409, NotStartedMessage, ShiftErrorCodes.ShiftNotInProgress);

        var now = _clock.GetUtcNow().UtcDateTime;
        DateTime? typedStart = dto.ActualStart is { } t ? ShiftBreakRules.ToUtc(t) : null;
        if (row.State == GroupStaffRowState.NotStarted && (typedStart >= now || typedStart < now - MaxTypedStartAge)) return Refuse(400, StartTimeMessage, "GA_TIMES");
        if ((dto.BreakStart is null) != (dto.BreakEnd is null)) return Refuse(400, "Enter both break times, or neither.", "GA_BREAK");

        try
        {
            // A Finish on a row that was never started also starts the activity, so it takes the board lock first; every other Finish needs only the row.
            await using var board = row.State == GroupStaffRowState.NotStarted && row.GroupActivity!.Status == ShiftStatus.Published
                ? await RosterGenerationLock.AcquireAsync(_db, row.TenantId, ct, RosterGenerationLock.DefaultWait, scope: "roster-board")
                : null;
            await using var rowLock = await GroupStaffRowLock.AcquireAsync(_db, row.Id, ct);
            await _db.Entry(row).ReloadAsync(ct);
            if (_db.Entry(row).State == EntityState.Detached) return Refuse(404, ShiftNotFoundMessage);   // removed while we waited for the lock
            await _db.Entry(row.GroupActivity!).ReloadAsync(ct);
            (early, replay) = await GateAsync(row, finishing: true, ct);
            if (early is not null) return early;
            if (replay) return await AnswerAsync(row, ct);
            if (row.State == GroupStaffRowState.NotStarted && dto.ActualStart is null) return Refuse(409, NotStartedMessage, ShiftErrorCodes.ShiftNotInProgress);

            var activity = row.GroupActivity!;
            var start = row.ActualStart ?? typedStart!.Value;
            if (now <= start) return Refuse(400, StartTimeMessage, "GA_TIMES");
            DateTime? breakStart = dto.BreakStart is { } b0 ? ShiftBreakRules.ToUtc(b0) : null;
            DateTime? breakEnd = dto.BreakEnd is { } b1 ? ShiftBreakRules.ToUtc(b1) : null;
            if (breakStart is { } bs && breakEnd is { } be && (bs < start || be > now || be <= bs)) return Refuse(400, "The break must fall between the start and finish.", "GA_BREAK_RANGE");

            if (row.ActualStart is null)
            {
                row.ActualStart = start;
                row.StartedAt = now;
                row.TimeZoneId = (await ProviderTimeZoneResolver.ForShiftAsync(_db, RowShift(activity, row), ct)).Id;
            }
            row.ActualEnd = now;
            row.SubmittedAt = now;
            row.BreakStartedAt = breakStart;
            row.BreakEndedAt = breakEnd;
            if (activity.Status == ShiftStatus.Published) { activity.Status = ShiftStatus.InProgress; activity.UpdatedAt = now; }
            await _db.SaveChangesAsync(ct);
            if (board is not null) await board.CommitAsync(ct); else await rowLock.CommitAsync(ct);
            return await AnswerAsync(row, ct);
        }
        catch (RosterBusyException)
        {
            _db.ChangeTracker.Clear();
            return Refuse(409, RosterGenerationLock.RosterBoardBusyMessage);
        }
    }

    /// <summary>Tells every active Admin and Coordinator of the organisation the hours are ready for review, in the Finish's own save (the audience and event of a shift's Finish).</summary>
    private async Task RaiseFinishedAsync(GroupActivityStaff row, GroupActivity activity, CancellationToken ct)
    {
        var workerName = await _db.Users.Where(u => u.Id == row.UserId).Select(u => (u.FirstName + " " + u.LastName).Trim()).FirstOrDefaultAsync(ct) ?? "A staff member";
        var recipients = await _db.Users.Where(u => u.TenantId == row.TenantId && u.IsActive && (u.Role == UserRole.Admin || u.Role == UserRole.Coordinator)).ToListAsync(ct);
        foreach (var recipient in recipients)
            await _notificationRaiser.RaiseAsync(Odip.Domain.Notifications.NotificationEventType.ShiftCompletionPendingReview, "GroupActivityStaff", row.Id, new[] { recipient.Id },
                new Odip.Infrastructure.Notifications.Templates.ShiftCompletionPendingReviewPayload(recipient.Email, workerName, activity.Title, activity.ServiceDate, activity.Title), ct);
    }

    /// <summary>A transient shift with the row's own planned times at the activity's place, for the zone and the rostered window. Never attached to the context.</summary>
    private static Shift RowShift(GroupActivity a, GroupActivityStaff r) => new()
    {
        Id = r.Id, TenantId = r.TenantId, ServiceDate = a.ServiceDate, StartTime = r.StartTime, EndTime = r.EndTime, EndsNextDay = r.EndsNextDay, ServiceLocationId = a.ServiceLocationId,
    };
}
