using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Rostering;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Catalogue;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Group activities (group activities D1-D8, PR1): one outing or session several participants attend together. Each participant is their own shift linked to the activity; the workers are rows on the
/// activity, never on those shifts. Gated like the rostering board it belongs to. Every write answers 409 GA_DISABLED while the organisation's switch is off, then takes the board lock, the
/// participant locks (ascending Guid), re-reads the activity and shifts under them and saves once, so a refusal saves nothing. Every id in a request is compared with the activity's TenantId
/// explicitly as well as through the query filter, because a SuperAdmin's filter is off.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/rostering/group-activities")]
public partial class GroupActivitiesController : ControllerBase
{
    private const int TitleMax = 200, LocationMax = 200, NotesMax = 2000, RoleMax = 100, ReasonMax = 2000, MinStaffMax = 20, MaxShiftsPerRequest = 20;
    private const int MaxListDays = 93, MaxSeriesDays = 400;
    private const string DefaultTitle = "Group activity";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly RosterAvailability _availability;
    private readonly GroupActivityReader _reader;
    private readonly RosterShiftGenerator _generator;
    private readonly Odip.Application.Interfaces.IObligationTaskService _obligationTasks;
    private readonly Odip.Application.Interfaces.INotificationRaiser _notificationRaiser;
    private readonly TimeProvider _clock;

    public GroupActivitiesController(OdipDbContext db, ICurrentTenant tenant, IStaffUnavailabilityQuery unavailabilityQuery,
        RosterShiftGenerator? generator = null, Odip.Application.Interfaces.IObligationTaskService? obligationTasks = null,
        Odip.Application.Interfaces.INotificationRaiser? notificationRaiser = null, TimeProvider? clock = null)
    {
        _db = db;
        _tenant = tenant;
        _generator = generator ?? new RosterShiftGenerator();
        _availability = new RosterAvailability(db, unavailabilityQuery);
        _reader = new GroupActivityReader(db, _availability);
        _obligationTasks = obligationTasks ?? new Odip.Infrastructure.Tasks.ObligationTaskService(db);
        _notificationRaiser = notificationRaiser ?? new Odip.Infrastructure.Notifications.NotificationRaiser(db);
        _clock = clock ?? TimeProvider.System;
    }

    // ── Refusals: the codes are message keys (plan section 6) ───────────────────────────────────────
    private static readonly Dictionary<string, (int Status, string Message)> Refusals = new()
    {
        ["GA_DISABLED"] = (409, DisabledMessage),
        ["GA_LIST_QUERY"] = (400, "Choose a from and to date (from first) and a valid status."),
        ["GA_NOT_FOUND"] = (404, "Group activity not found."),
        ["GA_CHOOSE_ORG"] = (400, "Choose an organisation first."),
        ["GA_TITLE"] = (400, "Give the activity a title of up to 200 characters."),
        ["GA_TIMES"] = (400, "The activity must end after it starts."),
        ["GA_STAFF_TIMES"] = (400, "The shift on the activity must end after it starts."),
        ["GA_TOO_LONG"] = (400, "That is too long."),
        ["GA_MIN_STAFF"] = (400, "Minimum staff must be between 0 and 20."),
        ["GA_ACTIVITY_LIB"] = (400, "Activity not found."),
        ["GA_LOCATION"] = (400, "Pick one of your service locations."),
        ["GA_STATUS"] = (400, "An activity can be set to Draft or Published here."),
        ["GA_MOVE_DAY"] = (400, "Remove the participants before moving the activity to another day."),
        ["GA_CANCELLED"] = (409, "This group activity is cancelled."),
        ["GA_STARTED"] = (409, "This group activity has started or finished, so it can't be changed here."),
        ["GA_SHIFTS_EMPTY"] = (400, "Choose between 1 and 20 shifts."),
        ["GA_SHIFT_NOT_FOUND"] = (404, "Shift not found."),
        ["GA_SHIFT_LOCKED"] = (409, "This shift has started, finished or been cancelled, so it can't join or leave an activity."),
        ["GA_SHIFT_OTHER_DAY"] = (400, "That shift is on another day."),
        ["GA_SHIFT_IN_OTHER"] = (409, "That shift is already in another group activity."),
        ["GA_PARTICIPANT_NOT_FOUND"] = (400, "Participant not found."),
        ["GA_PARTICIPANT_ARCHIVED"] = (400, "This participant is archived, so they can't join an activity."),
        ["GA_PARTICIPANT_IN"] = (409, "That participant is already in this activity."),
        ["GA_PARTICIPANT_NOT_IN"] = (404, "That participant isn't in this activity."),
        ["GA_NOT_READY"] = (400, ParticipantReadinessGate.NotReadyMessage),
        ["GA_RATIO"] = (400, "Choose a support ratio."),
        ["GA_RATIO_TWO_TO_ONE"] = (400, "To change a 2:1 participant, remove them and add them again."),
        ["GA_STAFF_NOT_FOUND"] = (400, "Staff member not found."),
        ["GA_STAFF_IN"] = (409, "That staff member is already on this activity."),
        ["GA_STAFF_ROW_NOT_FOUND"] = (404, "Staff row not found."),
        ["GA_STAFF_NOT_FINISHED"] = (409, "Record times before approving."),
        ["GA_STAFF_APPROVED"] = (409, "This shift is approved and can't be changed."),
        ["GA_STAFF_STARTED"] = (409, "This staff member has started, so they can't be removed. Record their times instead."),
        ["GA_NOT_PUBLISHED"] = (409, "Publish the activity first."),
        ["GA_BATCH_SIZE"] = (400, "Choose between 1 and 100 shifts."),
        ["GA_REASON"] = (400, "Enter a reason."),
        ["GA_ACTUALS_LONG"] = (409, "These times are over 24 hours. Record times first."),
        ["GA_ACTUALS_FUTURE"] = (400, "Times can't be in the future."),
        ["GA_BREAK"] = (400, "Enter both break times, or neither."),
        ["GA_BREAK_RANGE"] = (400, "The break must fall between the start and finish."),
        ["GA_NOT_STARTED"] = (409, "Mark attendance once the activity has started. Before then, remove the participant instead."),
        ["GA_ATTENDANCE_CLOSED"] = (409, RosteringController.AttendanceClosedMessage),
        ["GA_SERIES_INTERVAL"] = (400, "Repeats must be weekly, fortnightly or monthly."),
        ["GA_SERIES_END"] = (400, "Pick an end date on or after the activity date."),
        ["GA_SERIES_RANGE"] = (400, "Pick an end date within 400 days of the activity date."),
        ["GA_SERIES_SCOPE"] = (400, "Publish or change the status one activity at a time."),
        ["GA_SERIES_DATE"] = (400, "Change the date for this activity on its own."),
        [ShiftErrorCodes.ShiftClaimLocked] = (409, "This shift is on a claim, so it can't be reopened. Delete that claim first."),
    };

    public const string DisabledMessage = "Group activities are turned off for this organisation.";

    /// <summary>The switch, read by every group activity write (here and the worker's Start and Finish). Don't turn it off while an activity is InProgress: its staff could no longer finish.</summary>
    internal static Task<bool> FlagOnAsync(OdipDbContext db, Guid tenantId, CancellationToken ct) =>
        db.AppSettings.AsNoTracking().Where(s => s.TenantId == tenantId).Select(s => s.GroupActivitiesEnabled).FirstOrDefaultAsync(ct);

    /// <summary>A refusal raised anywhere under the locks: nothing is saved and the tracked changes are dropped.</summary>
    private sealed class Refusal(ActionResult result, string? code = null, string? message = null) : Exception
    {
        public ActionResult Result { get; } = result;
        /// <summary>The refusal's code and text when it came from <see cref="Deny"/>; null for a refusal that carries its own body (the 422 findings).</summary>
        public string? Code { get; } = code;
        public string? Text { get; } = message;
    }

    private ActionResult<ApiResponse<GroupActivityDto>> RefuseResult(string code, string? message = null) => RefuseResult<GroupActivityDto>(code, message);

    private ActionResult<ApiResponse<T>> RefuseResult<T>(string code, string? message = null)
    {
        var (status, text) = Refusals[code];
        var body = ApiResponse<T>.Fail(message ?? text, code);
        return status switch
        {
            404 => NotFound(body),
            409 => Conflict(body),
            _ => BadRequest(body),
        };
    }

    private Refusal Deny(string code, string? message = null) => new((ActionResult)RefuseResult(code, message).Result!, code, message ?? Refusals[code].Message);

    /// <summary>Runs one other occurrence's checks of a Series request; a refusal says which day it was ("Tue 8 Dec: ..."), its code and status unchanged.</summary>
    private async Task<T> OnOccurrenceAsync<T>(GroupActivity target, Func<Task<T>> work)
    {
        var day = target.ServiceDate.ToString("ddd d MMM", System.Globalization.CultureInfo.InvariantCulture);
        try { return await work(); }
        catch (Refusal r) when (r.Code is not null) { throw Deny(r.Code, $"{day}: {r.Text}"); }
        catch (Refusal r) when (r.Result is UnprocessableEntityObjectResult { Value: ApiResponse<List<RosterFindingDto>> { Errors: { Count: > 0 } errors } })
        {
            errors[0] = $"{day}: {errors[0]}";
            throw;
        }
    }

    private bool CallerIsAdmin => User?.IsInRole("Admin") == true || User?.IsInRole("SuperAdmin") == true;

    // ── Reads ───────────────────────────────────────────────────────────────────────────────────────

    /// <summary>The list page: one page of the organisation's activities in a date range (at most 93 days), Cancelled included unless a status is given. Refuses like the writes while the switch is off.</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<PagedResult<GroupActivityDto>>>> List(
        [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, [FromQuery] ShiftStatus? status, [FromQuery] int page = 1, [FromQuery] int pageSize = 25, CancellationToken ct = default)
    {
        if (_tenant.TenantId is not { } tenantId) return RefuseResult<PagedResult<GroupActivityDto>>("GA_CHOOSE_ORG");
        if (!await FlagOnAsync(_db, tenantId, ct)) return RefuseResult<PagedResult<GroupActivityDto>>("GA_DISABLED");
        if (from is not { } start || to is not { } end || end < start) return RefuseResult<PagedResult<GroupActivityDto>>("GA_LIST_QUERY");
        if (end.DayNumber - start.DayNumber >= MaxListDays) return RefuseResult<PagedResult<GroupActivityDto>>("GA_LIST_QUERY", $"Choose a range of {MaxListDays} days or fewer.");
        if (status is { } given && !Enum.IsDefined(given)) return RefuseResult<PagedResult<GroupActivityDto>>("GA_LIST_QUERY");
        (page, pageSize) = PagingParams.Clamp(page, pageSize, 100);
        var (items, total) = await _reader.ListAsync(tenantId, start, end, status, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<GroupActivityDto>>.Ok(new PagedResult<GroupActivityDto> { Items = items, TotalCount = total, Page = page, PageSize = pageSize }));
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<GroupActivityDto>>> Get(Guid id, CancellationToken ct)
    {
        var tenantId = _tenant.TenantId;
        if (!await _db.GroupActivities.AsNoTracking().AnyAsync(a => a.Id == id && (tenantId == null || a.TenantId == tenantId), ct)) return RefuseResult("GA_NOT_FOUND");
        return Ok(ApiResponse<GroupActivityDto>.Ok((await _reader.ReadAsync(id, ct))!));
    }

    // ── The write pipeline ──────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Every write: no tenant, then the switch, then the participant ids the write needs are read, the organisation's board lock and those participants' locks are taken (ascending Guid, as the agreement
    /// approval does), and only then does <paramref name="body"/> read what it changes. A <see cref="Refusal"/> or a busy lock answers without saving. Body saves once and returns Ok to commit.
    /// </summary>
    private Task<ActionResult<ApiResponse<GroupActivityDto>>> WriteAsync(
        Func<Guid, CancellationToken, Task<IEnumerable<Guid>>> participantsToLock,
        Func<Guid, CancellationToken, Task<ActionResult<ApiResponse<GroupActivityDto>>>> body, CancellationToken ct) => WriteAsync<GroupActivityDto>(participantsToLock, body, ct);

    /// <summary>The same pipeline for a write that answers with its own body (the staff review writes of GA PR3). A <see cref="Refusal"/> carries no typed body: the JSON shape is the same for every T.</summary>
    private async Task<ActionResult<ApiResponse<T>>> WriteAsync<T>(
        Func<Guid, CancellationToken, Task<IEnumerable<Guid>>> participantsToLock,
        Func<Guid, CancellationToken, Task<ActionResult<ApiResponse<T>>>> body, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return RefuseResult<T>("GA_CHOOSE_ORG");
        if (!await FlagOnAsync(_db, tenantId, ct)) return RefuseResult<T>("GA_DISABLED");
        try
        {
            await using var held = await RosterGenerationLock.AcquireAsync(_db, tenantId, ct, _generator.LockWait, scope: "roster-board");
            // Read after the board lock: every activity write holds it, so the set cannot change between this read and the locks below.
            var ids = (await participantsToLock(tenantId, ct)).Distinct().Order().ToList();
            // These join the board lock's transaction, so they need no disposing of their own.
            foreach (var id in ids) await RosterGenerationLock.AcquireAsync(_db, id, ct, _generator.LockWait);
            var result = await body(tenantId, ct);
            if (result.Result is OkObjectResult) await held.CommitAsync(ct);
            return result;
        }
        catch (Refusal refusal)
        {
            _db.ChangeTracker.Clear();
            return refusal.Result;
        }
        catch (RosterBusyException)
        {
            _db.ChangeTracker.Clear();
            return Conflict(ApiResponse<T>.Fail(RosterGenerationLock.RosterBoardBusyMessage));
        }
    }

    private static Task<IEnumerable<Guid>> None(Guid tenantId, CancellationToken ct) => Task.FromResult<IEnumerable<Guid>>([]);

    /// <summary>The participants on an activity's shifts (cancelled ones too: harmless to lock).</summary>
    private async Task<IEnumerable<Guid>> AttachedParticipantsAsync(Guid activityId, Guid tenantId, CancellationToken ct) =>
        await _db.Shifts.AsNoTracking().Where(s => s.GroupActivityId == activityId && s.TenantId == tenantId).Select(s => s.ParticipantId).ToListAsync(ct);

    private Func<Guid, CancellationToken, Task<IEnumerable<Guid>>> Attached(Guid activityId) => (t, ct) => AttachedParticipantsAsync(activityId, t, ct);

    /// <summary>For a Series request: the participants on the shifts of every not-cancelled activity of this one's series (just this one's when it has no series or the scope is Occurrence).</summary>
    private Func<Guid, CancellationToken, Task<IEnumerable<Guid>>> SeriesAttached(Guid activityId, GroupActivityScope? scope) => async (t, ct) =>
    {
        if (scope != GroupActivityScope.Series) return await AttachedParticipantsAsync(activityId, t, ct);
        var seriesId = await _db.GroupActivities.AsNoTracking().Where(a => a.Id == activityId && a.TenantId == t).Select(a => a.SeriesId).FirstOrDefaultAsync(ct);
        if (seriesId is null) return await AttachedParticipantsAsync(activityId, t, ct);
        var ids = await _db.GroupActivities.AsNoTracking().Where(a => a.TenantId == t && a.SeriesId == seriesId && (a.Id == activityId || a.Status != ShiftStatus.Cancelled)).Select(a => a.Id).ToListAsync(ct);
        return await _db.Shifts.AsNoTracking().Where(s => s.TenantId == t && s.GroupActivityId != null && ids.Contains(s.GroupActivityId.Value)).Select(s => s.ParticipantId).ToListAsync(ct);
    };

    private async Task<GroupActivity> LoadActivityAsync(Guid id, Guid tenantId, bool forChange, CancellationToken ct)
    {
        var activity = await _db.GroupActivities.Include(a => a.Staff).FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId, ct) ?? throw Deny("GA_NOT_FOUND");
        if (forChange) EnsureChangeable(activity);
        return activity;
    }

    private Refusal? StateRefusal(GroupActivity activity) => activity.Status switch
    {
        ShiftStatus.Cancelled => Deny("GA_CANCELLED"),
        ShiftStatus.InProgress or ShiftStatus.PendingReview or ShiftStatus.Completed => Deny("GA_STARTED"),
        _ => null,
    };

    /// <summary>Staff can be added or removed until the activity is cancelled or finished: an InProgress activity keeps its roster open (GA PR3).</summary>
    private void EnsureStaffChangeable(GroupActivity activity)
    {
        if (activity.Status is ShiftStatus.Cancelled or ShiftStatus.PendingReview or ShiftStatus.Completed) throw StateRefusal(activity) ?? Deny("GA_STARTED");
    }

    private void EnsureChangeable(GroupActivity activity)
    {
        if (StateRefusal(activity) is { } refusal) throw refusal;
    }

    /// <summary>The shifts on the activity that count (not cancelled), tracked, read under the locks.</summary>
    private Task<List<Shift>> AttachedShiftsAsync(GroupActivity activity, CancellationToken ct) =>
        _db.Shifts.Where(s => s.GroupActivityId == activity.Id && s.TenantId == activity.TenantId && s.Status != ShiftStatus.Cancelled).ToListAsync(ct);

    private async Task<ActionResult<ApiResponse<GroupActivityDto>>> SavedAsync(Guid activityId, CancellationToken ct)
    {
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<GroupActivityDto>.Ok((await _reader.ReadAsync(activityId, ct))!));
    }

    // ── Field checks ────────────────────────────────────────────────────────────────────────────────

    private static bool EndsBeforeStart(TimeOnly start, TimeOnly end, bool endsNextDay) => !endsNextDay && end <= start;

    /// <summary>The checks E2 and E4 share, in one order; returns the tidied title, location and notes.</summary>
    private async Task<(string Title, string? Location, string? Notes)> ValidateFieldsAsync(
        Guid tenantId, string? title, DateOnly _, TimeOnly start, TimeOnly end, bool endsNextDay, string? location, string? notes, int? minStaff, Guid? activityId, Guid? placeId,
        Guid? placeAlreadyOnActivity, CancellationToken ct)
    {
        var tidyTitle = title?.Trim() ?? string.Empty;
        if (tidyTitle.Length == 0 || tidyTitle.Length > TitleMax) throw Deny("GA_TITLE");
        if (EndsBeforeStart(start, end, endsNextDay)) throw Deny("GA_TIMES");
        var tidyLocation = Tidy(location);
        if (tidyLocation is { Length: > LocationMax }) throw Deny("GA_TOO_LONG", "Location can be up to 200 characters.");
        var tidyNotes = Tidy(notes);
        if (tidyNotes is { Length: > NotesMax }) throw Deny("GA_TOO_LONG", "Notes can be up to 2000 characters.");
        if (minStaff is < 0 or > MinStaffMax) throw Deny("GA_MIN_STAFF");
        if (activityId is { } libraryId && !await _db.Activities.AsNoTracking().AnyAsync(a => a.Id == libraryId && a.TenantId == tenantId, ct)) throw Deny("GA_ACTIVITY_LIB");
        if (placeId is { } place && place != placeAlreadyOnActivity
            && !await _db.ServiceLocations.AsNoTracking().AnyAsync(l => l.Id == place && l.TenantId == tenantId && l.IsActive, ct)) throw Deny("GA_LOCATION");
        return (tidyTitle, tidyLocation, tidyNotes);
    }

    private static string? Tidy(string? raw) => string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();

    // ── E2 create ───────────────────────────────────────────────────────────────────────────────────

    [HttpPost]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> Create([FromBody] CreateGroupActivityDto dto, CancellationToken ct) =>
        WriteAsync(None, async (tenantId, token) =>
        {
            var (title, location, notes) = await ValidateFieldsAsync(tenantId, dto.Title, dto.ServiceDate, dto.StartTime, dto.EndTime, dto.EndsNextDay, dto.Location, dto.Notes,
                dto.MinStaffRequired, dto.ActivityId, dto.ServiceLocationId, null, token);
            GroupActivity NewRow(DateOnly day, Guid? seriesId) => new()
            {
                Id = Guid.NewGuid(), TenantId = tenantId, ServiceDate = day, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
                Title = title, ActivityId = dto.ActivityId, Location = location, ServiceLocationId = dto.ServiceLocationId, Notes = notes, MinStaffRequired = dto.MinStaffRequired,
                Status = ShiftStatus.Draft, SeriesId = seriesId,
            };

            // Until without Repeats is ignored; with it, one series row and a Draft activity for each date, all saved together below.
            if (dto.Repeats is not { } repeats) { var one = NewRow(dto.ServiceDate, null); _db.GroupActivities.Add(one); return await SavedAsync(one.Id, token); }
            if (!Enum.IsDefined(repeats)) throw Deny("GA_SERIES_INTERVAL");
            if (dto.Until is not { } until || until < dto.ServiceDate) throw Deny("GA_SERIES_END");
            if (until.DayNumber - dto.ServiceDate.DayNumber > MaxSeriesDays) throw Deny("GA_SERIES_RANGE");
            var series = new GroupActivitySeries { Id = Guid.NewGuid(), TenantId = tenantId, Interval = repeats, StartDate = dto.ServiceDate, EndDate = until };
            _db.GroupActivitySeries.Add(series);
            var rows = GroupActivitySeriesDates.Occurrences(repeats, dto.ServiceDate, until).Select(day => NewRow(day, series.Id)).ToList();
            _db.GroupActivities.AddRange(rows);
            return await SavedAsync(rows[0].Id, token);
        }, ct);

    // ── E3 convert a shift into an activity ─────────────────────────────────────────────────────────

    [HttpPost("from-shift/{shiftId:guid}")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> FromShift(Guid shiftId, [FromBody] ConvertShiftDto dto, CancellationToken ct) =>
        WriteAsync(async (tenantId, token) => (await _db.Shifts.AsNoTracking().Where(s => s.Id == shiftId && s.TenantId == tenantId).Select(s => s.ParticipantId).ToListAsync(token)).AsEnumerable(),
            async (tenantId, token) =>
            {
                var title = Tidy(dto.Title) ?? DefaultTitle;
                if (title.Length > TitleMax) throw Deny("GA_TITLE");
                var shift = await _db.Shifts.FirstOrDefaultAsync(s => s.Id == shiftId && s.TenantId == tenantId, token) ?? throw Deny("GA_SHIFT_NOT_FOUND");
                if (shift.GroupActivityId is not null) throw Deny("GA_SHIFT_IN_OTHER");
                if (RosteringController.IsLockedForStaffChange(shift.Status)) throw Deny("GA_SHIFT_LOCKED");
                await EnsureParticipantCanJoinAsync(shift.ParticipantId, tenantId, token);
                var activity = new GroupActivity
                {
                    Id = Guid.NewGuid(), TenantId = tenantId, ServiceDate = shift.ServiceDate, StartTime = shift.StartTime, EndTime = shift.EndTime, EndsNextDay = shift.EndsNextDay,
                    Title = title, Location = shift.Location, ServiceLocationId = shift.ServiceLocationId,
                    Status = shift.Status == ShiftStatus.Published ? ShiftStatus.Published : ShiftStatus.Draft,
                };
                _db.GroupActivities.Add(activity);
                await AttachCoreAsync(activity, await WithSiblingsAsync([shift], token), dto.OverrideReason, dto.AcknowledgedFindingCodes, token);
                return await SavedAsync(activity.Id, token);
            }, ct);

    // ── E4 update ───────────────────────────────────────────────────────────────────────────────────

    /// <summary>Which field groups of an update to write. The opened activity takes all of them; another occurrence of a Series update takes only the groups the request changed on the opened one.</summary>
    private readonly record struct Touch(bool Times, bool Title, bool Activity, bool Place, bool Notes, bool MinStaff)
    {
        public static readonly Touch All = new(true, true, true, true, true, true);
        public bool Any => Times || Title || Activity || Place || Notes || MinStaff;
    }

    [HttpPut("{id:guid}")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> Update(Guid id, [FromBody] UpdateGroupActivityDto dto, CancellationToken ct) =>
        WriteAsync(SeriesAttached(id, dto.Scope), async (tenantId, token) =>
        {
            var activity = await LoadActivityAsync(id, tenantId, forChange: true, token);
            var (title, location, notes) = await ValidateFieldsAsync(tenantId, dto.Title, dto.ServiceDate, dto.StartTime, dto.EndTime, dto.EndsNextDay, dto.Location, dto.Notes,
                dto.MinStaffRequired, dto.ActivityId, dto.ServiceLocationId, activity.ServiceLocationId, token);
            if (dto.Status is not (ShiftStatus.Draft or ShiftStatus.Published)) throw Deny("GA_STATUS");
            // Any value but Series (an integer outside the enum too) acts as Occurrence; Series on a one-off acts as Occurrence.
            var series = dto.Scope == GroupActivityScope.Series && activity.SeriesId is not null;
            if (series && dto.Status != activity.Status) throw Deny("GA_SERIES_SCOPE");
            if (series && dto.ServiceDate != activity.ServiceDate) throw Deny("GA_SERIES_DATE");

            // What the request changes, read off the opened activity before it is written (the others only take these groups).
            var touch = new Touch(
                dto.StartTime != activity.StartTime || dto.EndTime != activity.EndTime || dto.EndsNextDay != activity.EndsNextDay,
                title != activity.Title, dto.ActivityId != activity.ActivityId,
                location != activity.Location || dto.ServiceLocationId != activity.ServiceLocationId,
                notes != activity.Notes, dto.MinStaffRequired != activity.MinStaffRequired);

            var publishing = activity.Status == ShiftStatus.Draft && dto.Status == ShiftStatus.Published;
            var attached = await ApplyFieldsAsync(activity, dto, dto.ServiceDate, dto.Status, (title, location, notes), Touch.All, true, token);
            // Decision 29: publishing the activity publishes its Draft shifts; un-publishing leaves them as they are.
            if (publishing) foreach (var s in attached.Where(s => s.Status == ShiftStatus.Draft)) (s.Status, s.UpdatedAt) = (ShiftStatus.Published, DateTime.UtcNow);

            if (series && touch.Any)
            {
                var today = await Odip.Infrastructure.Services.ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, token);
                var targets = await SeriesTargetsAsync(activity, today, token, includeStaff: true);
                foreach (var target in targets)
                    await OnOccurrenceAsync(target, async () => await ApplyFieldsAsync(target, dto, target.ServiceDate, target.Status, (title, location, notes), touch, false, token));
            }

            if (publishing)
            {
                // Save first so the notice reads the workers' final times; the outbox rows go out with the save below.
                await _db.SaveChangesAsync(token);
                var today = await Odip.Infrastructure.Services.ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, token);
                await PublishNotices.RaiseAsync(_db, _notificationRaiser, await PublishNotices.ActivityLinesAsync(_db, tenantId, [activity], today, token), token);
            }

            return await SavedAsync(activity.Id, token);
        }, ct);

    /// <summary>The other Draft and Published activities of the opened one's series dated on or after <paramref name="from"/>, in date order. Started and cancelled ones are never touched.</summary>
    private Task<List<GroupActivity>> SeriesTargetsAsync(GroupActivity opened, DateOnly from, CancellationToken ct, bool includeStaff)
    {
        IQueryable<GroupActivity> query = _db.GroupActivities;
        if (includeStaff) query = query.Include(a => a.Staff);
        return query.Where(a => a.TenantId == opened.TenantId && a.SeriesId == opened.SeriesId && a.Id != opened.Id && a.ServiceDate >= from
                                && (a.Status == ShiftStatus.Draft || a.Status == ShiftStatus.Published)).OrderBy(a => a.ServiceDate).ToListAsync(ct);
    }

    /// <summary>Writes the touched field groups of an update onto one activity, then its attached shifts' times and its workers' parts; returns the shifts that count. Saves nothing.</summary>
    private async Task<List<Shift>> ApplyFieldsAsync(GroupActivity activity, UpdateGroupActivityDto dto, DateOnly newDate, ShiftStatus newStatus,
        (string Title, string? Location, string? Notes) tidy, Touch touch, bool opened, CancellationToken token)
    {
        var attached = await AttachedShiftsAsync(activity, token);
        var dateChanged = newDate != activity.ServiceDate;
        if (dateChanged && attached.Count > 0) throw Deny("GA_MOVE_DAY");
        if (attached.Any(s => RosteringController.IsLockedForStaffChange(s.Status))) throw Deny("GA_SHIFT_LOCKED");

        var (oldStart, oldEnd, oldEndsNextDay) = (activity.StartTime, activity.EndTime, activity.EndsNextDay);
        var timesChanged = touch.Times && (dto.StartTime != oldStart || dto.EndTime != oldEnd || dto.EndsNextDay != oldEndsNextDay);
        activity.ServiceDate = newDate;
        if (touch.Times) (activity.StartTime, activity.EndTime, activity.EndsNextDay) = (dto.StartTime, dto.EndTime, dto.EndsNextDay);
        if (touch.Title) activity.Title = tidy.Title;
        if (touch.Place) (activity.Location, activity.ServiceLocationId) = (tidy.Location, dto.ServiceLocationId);
        if (touch.Notes) activity.Notes = tidy.Notes;
        if (touch.MinStaff) activity.MinStaffRequired = dto.MinStaffRequired;
        if (touch.Activity) activity.ActivityId = dto.ActivityId;
        (activity.Status, activity.UpdatedAt) = (newStatus, DateTime.UtcNow);
        // Merged onto another occurrence's own times, the result can end before it starts (the opened one was checked already).
        if (EndsBeforeStart(activity.StartTime, activity.EndTime, activity.EndsNextDay)) throw Deny("GA_TIMES");

        foreach (var shift in attached) SetTimes(shift, activity);

        // A worker whose part matched the old times follows the new ones; every worker whose times or day moved is judged again (decision 18).
        var rowsToJudge = new List<GroupActivityStaff>();
        foreach (var row in activity.Staff)
        {
            var followed = timesChanged && row.StartTime == oldStart && row.EndTime == oldEnd && row.EndsNextDay == oldEndsNextDay;
            if (followed) (row.StartTime, row.EndTime, row.EndsNextDay) = (activity.StartTime, activity.EndTime, activity.EndsNextDay);
            if (followed || dateChanged) rowsToJudge.Add(row);
        }

        if (rowsToJudge.Count > 0)
        {
            var participantIds = attached.Select(s => s.ParticipantId).Distinct().ToList();
            var snapshot = await LoadSnapshotAsync(activity, rowsToJudge.Select(r => r.UserId).ToList(), participantIds, token);
            foreach (var row in rowsToJudge)
                (row.OverrideReason, row.AcknowledgedFindingCodes) = Judge(snapshot, activity, participantIds, row, null, opened ? dto.OverrideReason : null, opened ? dto.AcknowledgedFindingCodes : null);
        }

        return attached;
    }

    // ── E5 cancel ───────────────────────────────────────────────────────────────────────────────────

    [HttpPost("{id:guid}/cancel")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> Cancel(Guid id, CancellationToken ct, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] GroupActivityScopeDto? dto = null) =>
        WriteAsync(SeriesAttached(id, dto?.Scope), async (tenantId, token) =>
        {
            var activity = await LoadActivityAsync(id, tenantId, forChange: false, token);
            // An already-cancelled one keeps today's early return, whatever the scope.
            if (activity.Status == ShiftStatus.Cancelled) return Ok(ApiResponse<GroupActivityDto>.Ok((await _reader.ReadAsync(id, token))!));
            EnsureChangeable(activity);
            await CancelOneAsync(activity, token);
            // This one's day onward, not today: the coordinator may be cancelling from an earlier occurrence.
            if (dto?.Scope == GroupActivityScope.Series && activity.SeriesId is not null)
                foreach (var target in await SeriesTargetsAsync(activity, activity.ServiceDate, token, includeStaff: false))
                    await OnOccurrenceAsync(target, async () => { await CancelOneAsync(target, token); return 0; });
            return await SavedAsync(activity.Id, token);
        }, ct);

    private async Task CancelOneAsync(GroupActivity activity, CancellationToken token)
    {
        var attached = await AttachedShiftsAsync(activity, token);
        if (attached.Any(s => RosteringController.IsLockedForStaffChange(s.Status))) throw Deny("GA_SHIFT_LOCKED");
        // The participants keep their own shifts. The staff rows stay for history and stop counting as busy (a cancelled activity is not read by RosterAvailability.ActivityStaffBusyAsync).
        // shortcut: a started or finished attached shift refuses the cancel; PR3 (completion) owns what a cancelled activity does to completed shifts.
        foreach (var shift in attached) await DetachAsync(shift, token);
        activity.Status = ShiftStatus.Cancelled;
        activity.CancelledAt = activity.UpdatedAt = DateTime.UtcNow;
    }

    // ── E6 attach shifts ────────────────────────────────────────────────────────────────────────────

    [HttpPost("{id:guid}/shifts")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> AttachShifts(Guid id, [FromBody] AttachShiftsDto dto, CancellationToken ct) =>
        WriteAsync(async (tenantId, token) =>
            {
                var requested = (dto.ShiftIds ?? []).Distinct().ToList();
                var mine = await AttachedParticipantsAsync(id, tenantId, token);
                var theirs = requested.Count == 0 ? [] : await _db.Shifts.AsNoTracking().Where(s => requested.Contains(s.Id) && s.TenantId == tenantId).Select(s => s.ParticipantId).ToListAsync(token);
                return mine.Concat(theirs);
            },
            async (tenantId, token) =>
            {
                var requested = (dto.ShiftIds ?? []).Distinct().ToList();
                if (requested.Count is 0 or > MaxShiftsPerRequest) throw Deny("GA_SHIFTS_EMPTY");
                var activity = await LoadActivityAsync(id, tenantId, forChange: true, token);
                var found = await _db.Shifts.Where(s => requested.Contains(s.Id) && s.TenantId == tenantId).ToListAsync(token);
                if (found.Count != requested.Count) throw Deny("GA_SHIFT_NOT_FOUND");
                var attached = await AttachedShiftsAsync(activity, token);
                var toAttach = new List<Shift>();
                foreach (var shift in found)
                {
                    if (shift.GroupActivityId == activity.Id) continue;
                    if (shift.GroupActivityId is not null) throw Deny("GA_SHIFT_IN_OTHER");
                    if (RosteringController.IsLockedForStaffChange(shift.Status)) throw Deny("GA_SHIFT_LOCKED");
                    if (shift.ServiceDate != activity.ServiceDate) throw Deny("GA_SHIFT_OTHER_DAY");
                    await EnsureParticipantCanJoinAsync(shift.ParticipantId, tenantId, token);
                    toAttach.Add(shift);
                }

                if (toAttach.Count == 0) return Ok(ApiResponse<GroupActivityDto>.Ok((await _reader.ReadAsync(id, token))!));
                var all = await WithSiblingsAsync(toAttach, token);
                // A participant already on the activity, or named twice other than as 2:1 siblings, cannot join again.
                var inAlready = attached.Select(s => s.ParticipantId).ToHashSet();
                if (all.Any(s => inAlready.Contains(s.ParticipantId)) || all.GroupBy(s => s.ParticipantId).Any(g => g.Count() > (g.First().Ratio == SupportRatio.TwoToOne ? 2 : 1)))
                    throw Deny("GA_PARTICIPANT_IN");
                await AttachCoreAsync(activity, all, dto.OverrideReason, dto.AcknowledgedFindingCodes, token);
                return await SavedAsync(activity.Id, token);
            }, ct);

    // ── E7 detach a shift ───────────────────────────────────────────────────────────────────────────

    [HttpDelete("{id:guid}/shifts/{shiftId:guid}")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> DetachShift(Guid id, Guid shiftId, CancellationToken ct) =>
        WriteAsync(Attached(id), async (tenantId, token) =>
        {
            var activity = await LoadActivityAsync(id, tenantId, forChange: true, token);
            var attached = await AttachedShiftsAsync(activity, token);
            var shift = attached.FirstOrDefault(s => s.Id == shiftId) ?? throw Deny("GA_SHIFT_NOT_FOUND");
            var leaving = shift.Ratio == SupportRatio.TwoToOne ? attached.Where(s => s.ParticipantId == shift.ParticipantId && s.Ratio == SupportRatio.TwoToOne).ToList() : [shift];
            if (leaving.Any(s => RosteringController.IsLockedForStaffChange(s.Status))) throw Deny("GA_SHIFT_LOCKED");
            foreach (var s in leaving) await DetachAsync(s, token);
            activity.UpdatedAt = DateTime.UtcNow;
            return await SavedAsync(activity.Id, token);
        }, ct);

    // ── E8 add a participant with a one-off shift ───────────────────────────────────────────────────

    [HttpPost("{id:guid}/participants")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> AddParticipant(Guid id, [FromBody] AddGroupParticipantDto dto, CancellationToken ct) =>
        WriteAsync(async (tenantId, token) => (await AttachedParticipantsAsync(id, tenantId, token)).Append(dto.ParticipantId),
            async (tenantId, token) =>
            {
                var activity = await LoadActivityAsync(id, tenantId, forChange: true, token);
                if (dto.ParticipantId == Guid.Empty) throw Deny("GA_PARTICIPANT_NOT_FOUND");
                await EnsureParticipantCanJoinAsync(dto.ParticipantId, tenantId, token);
                if (!Enum.IsDefined(dto.Ratio)) throw Deny("GA_RATIO");
                var attached = await AttachedShiftsAsync(activity, token);
                if (attached.Any(s => s.ParticipantId == dto.ParticipantId)) throw Deny("GA_PARTICIPANT_IN");
                if (!(await ParticipantReadiness.CheckAsync(_db, dto.ParticipantId, token)).Allowed) throw Deny("GA_NOT_READY");
                await CompatibilityGateAsync(activity, [dto.ParticipantId], token);
                // Two shifts for 2:1, one per worker; the reader counts the participant once.
                for (var i = 0; i < (dto.Ratio == SupportRatio.TwoToOne ? 2 : 1); i++)
                    _db.Shifts.Add(new Shift
                    {
                        Id = Guid.NewGuid(), TenantId = activity.TenantId, ParticipantId = dto.ParticipantId, ServiceDate = activity.ServiceDate, StartTime = activity.StartTime,
                        EndTime = activity.EndTime, EndsNextDay = activity.EndsNextDay, Ratio = dto.Ratio, NightType = SleepoverType.None,
                        Status = activity.Status == ShiftStatus.Published ? ShiftStatus.Published : ShiftStatus.Draft, GroupActivityId = activity.Id,
                        Location = activity.Location, ServiceLocationId = activity.ServiceLocationId, SupportGroupCode = CatalogueGroups.GroupActivitiesGroupCode,
                    });
                activity.UpdatedAt = DateTime.UtcNow;
                return await SavedAsync(activity.Id, token);
            }, ct);

    // ── E9 set a participant's ratio ────────────────────────────────────────────────────────────────

    [HttpPut("{id:guid}/participants/{participantId:guid}/ratio")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> SetRatio(Guid id, Guid participantId, [FromBody] SetGroupRatioDto dto, CancellationToken ct) =>
        WriteAsync(Attached(id), async (tenantId, token) =>
        {
            var activity = await LoadActivityAsync(id, tenantId, forChange: true, token);
            var shifts = (await AttachedShiftsAsync(activity, token)).Where(s => s.ParticipantId == participantId).ToList();
            if (shifts.Count == 0) throw Deny("GA_PARTICIPANT_NOT_IN");
            if (!Enum.IsDefined(dto.Ratio)) throw Deny("GA_RATIO");
            // shortcut: a 2:1 participant is two sibling shifts, so changing to or from 2:1 would mean adding or removing one (and a worker's place); remove and re-add them instead. Revisit if coordinators ask.
            if (dto.Ratio != shifts[0].Ratio && (dto.Ratio == SupportRatio.TwoToOne || shifts[0].Ratio == SupportRatio.TwoToOne)) throw Deny("GA_RATIO_TWO_TO_ONE");
            if (shifts.Any(s => RosteringController.IsLockedForStaffChange(s.Status))) throw Deny("GA_SHIFT_LOCKED");
            foreach (var shift in shifts) (shift.Ratio, shift.UpdatedAt) = (dto.Ratio, DateTime.UtcNow);
            return await SavedAsync(activity.Id, token);
        }, ct);

    // ── E13 attendance ─────────────────────────────────────────────────────────

    /// <summary>
    /// Marks a participant as didn't attend (their attached shifts are cancelled by the ordinary cancel rule) or undoes it, only while the activity is InProgress. The lock set is just this participant: a subset of
    /// approve's ascending lock of every activity participant, so it cannot deadlock. Then the shift rows (ascending), and for an undo the claim lock the shift PUT takes before it looks for a claim.
    /// </summary>
    [HttpPost("{id:guid}/participants/{participantId:guid}/attendance")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> SetAttendance(Guid id, Guid participantId, [FromBody] SetAttendanceDto dto, CancellationToken ct) =>
        WriteAsync((_, _) => Task.FromResult<IEnumerable<Guid>>([participantId]), async (tenantId, token) =>
        {
            var activity = await LoadActivityAsync(id, tenantId, forChange: false, token);
            EnsureAttendanceWindow(activity);
            if (await ApplyAttendanceAsync(_db, activity, participantId, dto.Attended, token) is { } no) throw Deny(no.Code, no.Message);
            return await SavedAsync(activity.Id, token);
        }, ct);

    /// <summary>Attendance is marked while the activity is InProgress: not before it starts, not once it has finished or been cancelled.</summary>
    internal static string? AttendanceWindowCode(GroupActivity activity) => activity.Status switch
    {
        ShiftStatus.Cancelled => "GA_CANCELLED",
        ShiftStatus.Completed => "GA_ATTENDANCE_CLOSED",
        ShiftStatus.Draft or ShiftStatus.Published => "GA_NOT_STARTED",
        _ => null,
    };

    private void EnsureAttendanceWindow(GroupActivity activity)
    {
        if (AttendanceWindowCode(activity) is { } code) throw Deny(code);
    }

    /// <summary>E13's body, shared with the worker's portal mark (ga-portal-attendance). Call it after the board and participant locks; it takes the shift row locks
    /// and, for an undo, the claim lock. It saves nothing. Returns the refusal (Code, and Message when it isn't the table's), or null when the caller may save.</summary>
    internal static async Task<(string Code, string? Message)?> ApplyAttendanceAsync(OdipDbContext db, GroupActivity activity, Guid participantId, bool attended, CancellationToken ct)
    {
        var shiftIds = await db.Shifts.AsNoTracking().Where(s => s.GroupActivityId == activity.Id && s.TenantId == activity.TenantId && s.ParticipantId == participantId).Select(s => s.Id).OrderBy(i => i).ToListAsync(ct);
        if (shiftIds.Count == 0) return ("GA_SHIFT_NOT_FOUND", null);
        foreach (var shiftId in shiftIds) await ShiftRowLock.AcquireAsync(db, shiftId, ct);   // joins the board lock's transaction
        await db.Entry(activity).ReloadAsync(ct);
        if (AttendanceWindowCode(activity) is { } closed) return (closed, null);   // an approval may have completed the activity while this waited
        var shifts = await db.Shifts.Where(s => shiftIds.Contains(s.Id)).ToListAsync(ct);
        var now = DateTime.UtcNow;

        if (shifts.Any(s => s.Status == ShiftStatus.Completed) || await db.ShiftCompletions.AsNoTracking().AnyAsync(c => shiftIds.Contains(c.ShiftId) && c.IsActive, ct)) return ("GA_ATTENDANCE_CLOSED", null);
        if (shifts.Any(s => s.Status is not (ShiftStatus.Published or ShiftStatus.Cancelled))) return ("GA_SHIFT_LOCKED", null);

        if (!attended)
        {
            foreach (var shift in shifts.Where(s => s.Status == ShiftStatus.Published)) { RosteringController.ApplyStatus(shift, ShiftStatus.Cancelled, now, ShiftCancellationReason.ParticipantDidNotAttend); shift.UpdatedAt = now; }
        }
        else if (shifts.Any(s => s.Status == ShiftStatus.Cancelled))
        {
            // Only a no-show can be undone: a shift cancelled through the board before the day was never marked, and reopening it could make a never-billable cancellation claimable.
            var zone = (await ProviderTimeZoneResolver.ResolveAsync(db, activity.TenantId, ct)).Zone;
            if (shifts.Any(s => s.Status == ShiftStatus.Cancelled && !GroupActivityReader.IsNoShow(s, zone))) return ("GA_SHIFT_LOCKED", null);
            // A no-show on a cancellation claim bills that claim, so it can't be reopened until the claim is deleted (the shift PUT's rule, taken under the same lock).
            await using var claimLock = await RosterGenerationLock.AcquireAsync(db, participantId, ct, scope: "claim-generate");
            var claim = await db.ClaimLineItems.AsNoTracking().Where(BudgetLedgerService.ClaimLineStillCounts).Where(l => l.ShiftId != null && shiftIds.Contains(l.ShiftId.Value))
                .Select(l => l.TripClaim.ClaimReference).FirstOrDefaultAsync(ct);
            if (claim is not null) return (ShiftErrorCodes.ShiftClaimLocked, $"This shift is on claim {claim}, so it can't be reopened or moved. Delete that claim first.");
            foreach (var shift in shifts.Where(s => s.Status == ShiftStatus.Cancelled)) { RosteringController.ApplyStatus(shift, ShiftStatus.Published, now); shift.UpdatedAt = now; }
        }
        return null;
    }

    /// <summary>A refusal code's status and text, for the portal's mark.</summary>
    internal static (int Status, string Message) RefusalFor(string code) => Refusals[code];

    // ── E10-E12 workers ─────────────────────────────────────────────────────────────────────────────

    [HttpPost("{id:guid}/staff")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> AddStaff(Guid id, [FromBody] AddGroupStaffDto dto, CancellationToken ct) =>
        WriteAsync(Attached(id), async (tenantId, token) =>
        {
            var activity = await LoadActivityAsync(id, tenantId, forChange: false, token);
            EnsureStaffChangeable(activity);   // GA PR3: staff may be added while the activity is InProgress, so a replacement worker can be rostered
            if (dto.StaffId == Guid.Empty) throw Deny("GA_STAFF_NOT_FOUND");
            var (start, end, endsNextDay) = StaffTimes(activity, dto);
            var role = TidyRole(dto.Role);
            CheckReasonLength(dto.OverrideReason);
            var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == dto.StaffId && u.TenantId == tenantId && u.IsActive, token) ?? throw Deny("GA_STAFF_NOT_FOUND");
            if (activity.Staff.Any(r => r.UserId == user.Id)) throw Deny("GA_STAFF_IN", $"{user.FirstName} is already on this activity.");
            var participantIds = (await AttachedShiftsAsync(activity, token)).Select(s => s.ParticipantId).Distinct().ToList();
            var row = new GroupActivityStaff { Id = Guid.NewGuid(), TenantId = activity.TenantId, GroupActivityId = activity.Id, UserId = user.Id, StartTime = start, EndTime = end, EndsNextDay = endsNextDay, Role = role };
            var snapshot = await LoadSnapshotAsync(activity, [user.Id], participantIds, token);
            (row.OverrideReason, row.AcknowledgedFindingCodes) = Judge(snapshot, activity, participantIds, row, null, dto.OverrideReason, dto.AcknowledgedFindingCodes);
            _db.GroupActivityStaff.Add(row);
            activity.UpdatedAt = DateTime.UtcNow;
            return await SavedAsync(activity.Id, token);
        }, ct);

    [HttpPut("{id:guid}/staff/{rowId:guid}")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> UpdateStaff(Guid id, Guid rowId, [FromBody] UpdateGroupStaffDto dto, CancellationToken ct) =>
        WriteAsync(Attached(id), async (tenantId, token) =>
        {
            var activity = await LoadActivityAsync(id, tenantId, forChange: true, token);
            var row = activity.Staff.FirstOrDefault(r => r.Id == rowId) ?? throw Deny("GA_STAFF_ROW_NOT_FOUND");
            if (EndsBeforeStart(dto.StartTime, dto.EndTime, dto.EndsNextDay)) throw Deny("GA_STAFF_TIMES");
            var role = TidyRole(dto.Role);
            CheckReasonLength(dto.OverrideReason);
            var participantIds = (await AttachedShiftsAsync(activity, token)).Select(s => s.ParticipantId).Distinct().ToList();
            (row.StartTime, row.EndTime, row.EndsNextDay, row.Role) = (dto.StartTime, dto.EndTime, dto.EndsNextDay, role);
            var snapshot = await LoadSnapshotAsync(activity, [row.UserId], participantIds, token);
            (row.OverrideReason, row.AcknowledgedFindingCodes) = Judge(snapshot, activity, participantIds, row, null, dto.OverrideReason, dto.AcknowledgedFindingCodes);
            activity.UpdatedAt = DateTime.UtcNow;
            return await SavedAsync(activity.Id, token);
        }, ct);

    [HttpDelete("{id:guid}/staff/{rowId:guid}")]
    public Task<ActionResult<ApiResponse<GroupActivityDto>>> RemoveStaff(Guid id, Guid rowId, CancellationToken ct) =>
        WriteAsync(Attached(id), async (tenantId, token) =>
        {
            var activity = await LoadActivityAsync(id, tenantId, forChange: false, token);
            EnsureStaffChangeable(activity);
            var row = activity.Staff.FirstOrDefault(r => r.Id == rowId) ?? throw Deny("GA_STAFF_ROW_NOT_FOUND");
            await using var rowLock = await GroupStaffRowLock.AcquireAsync(_db, row.Id, token);
            await _db.Entry(row).ReloadAsync(token);   // re-check under the row lock: an approval or a Finish may have landed first
            if (_db.Entry(row).State == EntityState.Detached) throw Deny("GA_STAFF_ROW_NOT_FOUND");   // another coordinator removed it first: reload drops a deleted row
            if (row.State == GroupStaffRowState.Approved) throw Deny("GA_STAFF_APPROVED");
            if (row.State != GroupStaffRowState.NotStarted) throw Deny("GA_STAFF_STARTED");   // a row with times stays; record its times instead
            var now = DateTime.UtcNow;
            _db.GroupActivityStaff.Remove(row);
            activity.UpdatedAt = now;
            // The last unapproved row going can complete the activity.
            var attached = await AttachedLockedAsync(activity, token);
            await GroupActivityCompletion.CompleteIfAllApprovedAsync(_db, activity, activity.Staff.Where(r => r.Id != rowId).ToList(), attached, CurrentUserId, now, token);
            return await SavedAsync(activity.Id, token);
        }, ct);

    // ── Shared pieces ───────────────────────────────────────────────────────────────────────────────

    private (TimeOnly Start, TimeOnly End, bool EndsNextDay) StaffTimes(GroupActivity activity, AddGroupStaffDto dto)
    {
        // Both given or neither (then the activity's); a worker may arrive before the activity starts, so the row's times may fall outside its window.
        if (dto.StartTime.HasValue != dto.EndTime.HasValue) throw Deny("GA_STAFF_TIMES");
        if (dto.StartTime is not { } start || dto.EndTime is not { } end) return (activity.StartTime, activity.EndTime, activity.EndsNextDay);
        if (EndsBeforeStart(start, end, dto.EndsNextDay)) throw Deny("GA_STAFF_TIMES");
        return (start, end, dto.EndsNextDay);
    }

    private string? TidyRole(string? raw)
    {
        var role = Tidy(raw);
        if (role is { Length: > RoleMax }) throw Deny("GA_TOO_LONG", "Role can be up to 100 characters.");
        return role;
    }

    private void CheckReasonLength(string? reason)
    {
        if (reason is { } r && r.Trim().Length > ReasonMax) throw Deny("GA_TOO_LONG", "The reason can be up to 2000 characters.");
    }

    private static void SetTimes(Shift shift, GroupActivity activity)
    {
        (shift.StartTime, shift.EndTime, shift.EndsNextDay, shift.UpdatedAt) = (activity.StartTime, activity.EndTime, activity.EndsNextDay, DateTime.UtcNow);
    }

    /// <summary>An existing, same-organisation participant who can receive services; else the matching refusal.</summary>
    private async Task EnsureParticipantCanJoinAsync(Guid participantId, Guid tenantId, CancellationToken ct)
    {
        var participant = await _db.Participants.AsNoTracking().FirstOrDefaultAsync(p => p.Id == participantId && p.TenantId == tenantId, ct) ?? throw Deny("GA_PARTICIPANT_NOT_FOUND");
        if (!Participant.CanReceiveServices(participant)) throw Deny("GA_PARTICIPANT_ARCHIVED");
    }

    /// <summary>Each chosen 2:1 shift brings its sibling (decision 11): the same participant, day and times, both 2:1, Draft or Published, not in an activity. Order is kept, no shift twice.</summary>
    private async Task<List<Shift>> WithSiblingsAsync(List<Shift> chosen, CancellationToken ct)
    {
        var all = new List<Shift>(chosen);
        foreach (var shift in chosen.Where(s => s.Ratio == SupportRatio.TwoToOne))
        {
            var siblings = await _db.Shifts.Where(s => s.Id != shift.Id && s.TenantId == shift.TenantId && s.ParticipantId == shift.ParticipantId && s.ServiceDate == shift.ServiceDate
                && s.StartTime == shift.StartTime && s.EndTime == shift.EndTime && s.EndsNextDay == shift.EndsNextDay && s.Ratio == SupportRatio.TwoToOne
                && (s.Status == ShiftStatus.Draft || s.Status == ShiftStatus.Published) && s.GroupActivityId == null).ToListAsync(ct);
            foreach (var sibling in siblings)
                if (all.All(s => s.Id != sibling.Id)) all.Add(sibling);
        }

        return all;
    }

    private async Task DetachAsync(Shift shift, CancellationToken ct)
    {
        shift.GroupActivityId = null;
        shift.UpdatedAt = DateTime.UtcNow;
        // Pattern times come back (decision 8); a one-off keeps the activity's times.
        if (shift.ShiftPatternId is { } patternId && await _db.ShiftPatterns.AsNoTracking().FirstOrDefaultAsync(p => p.Id == patternId && p.TenantId == shift.TenantId, ct) is { } pattern)
            (shift.StartTime, shift.EndTime, shift.EndsNextDay) = (pattern.StartTime, pattern.EndTime, pattern.EndsNextDay);
    }

    private async Task<RosterAvailability.Snapshot> LoadSnapshotAsync(GroupActivity activity, IReadOnlyList<Guid> userIds, IReadOnlyList<Guid> participantIds, CancellationToken ct)
    {
        var snapshot = await _availability.LoadAsync(userIds, participantIds, activity.ServiceDate, activity.ServiceDate, ct);
        // shortcut: no participant yet, so compatibility is unchecked; attach re-checks it (decision 17)
        if (participantIds.Count == 0) snapshot.AddParticipant(new Participant { Id = activity.Id, TenantId = activity.TenantId, IsActive = true });
        return snapshot;
    }

    /// <summary>The add-staff gate for one row (decision 15): the roster rules against each attached participant, merged by code, then Blocking refuses 422 and a warning needs the reason. Returns what to store on the row.</summary>
    private (string? Reason, string? Codes) Judge(RosterAvailability.Snapshot snapshot, GroupActivity activity, IReadOnlyList<Guid> participantIds, GroupActivityStaff row, Guid? leavingShiftId,
        string? reason, List<string>? acknowledgedCodes)
    {
        var findings = GroupActivityRules.CheckStaffPart(snapshot, activity, participantIds, row.Id, row.UserId, row.StartTime, row.EndTime, row.EndsNextDay, leavingShiftId, CallerIsAdmin);
        if (RosterGate.EvaluateFindings(findings, reason) is { } rejection) throw new Refusal(UnprocessableEntity(rejection));
        return RosterGate.ComputeOverride(findings, reason, acknowledgedCodes);
    }

    /// <summary>Joining participants must suit the workers already on the activity (decision 17): COMPATIBILITY_EXCLUDED only, because the other findings were judged when each worker was added.</summary>
    private async Task CompatibilityGateAsync(GroupActivity activity, IReadOnlyList<Guid> joiningParticipantIds, CancellationToken ct)
    {
        if (activity.Staff.Count == 0 || joiningParticipantIds.Count == 0) return;
        var snapshot = await LoadSnapshotAsync(activity, activity.Staff.Select(r => r.UserId).ToList(), joiningParticipantIds, ct);
        var excluded = new List<RosterFinding>();
        foreach (var row in activity.Staff)
            foreach (var finding in GroupActivityRules.CheckStaffPart(snapshot, activity, joiningParticipantIds, row.Id, row.UserId, row.StartTime, row.EndTime, row.EndsNextDay, null, CallerIsAdmin)
                         .Where(f => f.Code == RosterConflictService.CompatibilityExcluded))
                if (excluded.All(f => f.Code != finding.Code)) excluded.Add(finding);
        if (excluded.Count > 0) throw new Refusal(UnprocessableEntity(RosterGate.EvaluateFindings(excluded, null)!));
    }

    /// <summary>
    /// Attach (decision 1, 8, 10): the shifts (and their 2:1 siblings) join the activity at its times, and each shift's worker moves onto a staff row of the activity (unless already on it) judged by the
    /// add-staff gate with the shift they leave ignored. The shift keeps no worker. No notice goes to a moved worker.
    /// </summary>
    private async Task AttachCoreAsync(GroupActivity activity, List<Shift> shifts, string? overrideReason, List<string>? acknowledgedCodes, CancellationToken ct)
    {
        var existing = activity.Id == Guid.Empty ? [] : await AttachedShiftsAsync(activity, ct);
        var participantIds = existing.Concat(shifts).Select(s => s.ParticipantId).Distinct().ToList();
        await CompatibilityGateAsync(activity, shifts.Select(s => s.ParticipantId).Distinct().ToList(), ct);

        var movers = shifts.Where(s => s.UserId is not null).ToList();
        if (movers.Count > 0)
        {
            var userIds = movers.Select(s => s.UserId!.Value).Distinct().ToList();
            var active = await _db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id) && u.TenantId == activity.TenantId && u.IsActive).Select(u => u.Id).ToListAsync(ct);
            if (active.Count != userIds.Count) throw Deny("GA_STAFF_NOT_FOUND");
            var snapshot = await LoadSnapshotAsync(activity, userIds, participantIds, ct);
            foreach (var shift in movers)
            {
                var userId = shift.UserId!.Value;
                if (activity.Staff.All(r => r.UserId != userId))
                {
                    var row = new GroupActivityStaff { Id = Guid.NewGuid(), TenantId = activity.TenantId, GroupActivityId = activity.Id, UserId = userId, StartTime = activity.StartTime, EndTime = activity.EndTime, EndsNextDay = activity.EndsNextDay };
                    // shortcut: only the shift they leave is ignored, so a worker booked on two of the attached shifts at once is judged double-booked against the second; an Admin overrides it.
                    (row.OverrideReason, row.AcknowledgedFindingCodes) = Judge(snapshot, activity, participantIds, row, shift.Id, overrideReason, acknowledgedCodes);
                    _db.GroupActivityStaff.Add(row);
                    activity.Staff.Add(row);
                }

                shift.UserId = null;
                // The leave-cover task of this shift closes because nobody is "on" it any more; no notice goes to the worker (shortcut: PR3 decides what a moved worker is told).
                await _obligationTasks.CompleteByShiftAsync(shift.Id, TaskType.LeaveCoverage, ct);
            }
        }

        foreach (var shift in shifts)
        {
            shift.GroupActivityId = activity.Id;
            SetTimes(shift, activity);
        }
    }
}
