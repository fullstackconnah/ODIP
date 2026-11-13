using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
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
    // SHIFT PATTERNS
    // ══════════════════════════════════════════════════════════════

    /// <summary>List patterns, optionally filtered by participant.</summary>
    [HttpGet("patterns")]
    public async Task<ActionResult<ApiResponse<List<ShiftPatternDto>>>> GetPatterns(
        [FromQuery] Guid? participantId, CancellationToken ct)
    {
        var query = _db.ShiftPatterns.Include(p => p.Participant).Include(p => p.DefaultUser).AsQueryable();
        if (participantId.HasValue) query = query.Where(p => p.ParticipantId == participantId.Value);

        var patterns = await query.OrderBy(p => p.DayOfWeek).ThenBy(p => p.StartTime).ToListAsync(ct);
        var versions = await SourceVersionsAsync(patterns, ct);
        return Ok(ApiResponse<List<ShiftPatternDto>>.Ok(patterns.Select(p => ToPatternDto(p, versions)).ToList()));
    }

    /// <summary>Get a single pattern.</summary>
    [HttpGet("patterns/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftPatternDto>>> GetPatternById(Guid id, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.Include(p => p.Participant).Include(p => p.DefaultUser)
            .FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<ShiftPatternDto>.Fail("Pattern not found."));

        return Ok(ApiResponse<ShiftPatternDto>.Ok(ToPatternDto(pattern, await SourceVersionsAsync(new[] { pattern }, ct))));
    }

    /// <summary>Create a weekly-recurring shift pattern. Not roster-checked — generation checks its own candidates via <c>POST /shifts/check</c> if the frontend chooses to.</summary>
    [HttpPost("patterns")]
    public async Task<ActionResult<ApiResponse<ShiftPatternDto>>> CreatePattern(
        [FromBody] CreateShiftPatternDto dto, CancellationToken ct)
    {
        // An end before the start would save a pattern that makes nothing.
        if (dto.EffectiveTo < dto.EffectiveFrom) return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Choose an end date on or after the start date."));
        // A pattern makes shifts, so it needs a length like one (phase 3 review, N2): a pattern with none would make shifts the budget cannot price.
        if (Shift.HoursBetween(dto.StartTime, dto.EndTime, dto.EndsNextDay) <= 0m) return BadRequest(ApiResponse<ShiftPatternDto>.Fail(ShiftEndsBeforeItStartsMessage, ShiftNoLengthCode));
        if (!(await ParticipantReadiness.CheckAsync(_db, dto.ParticipantId, ct)).Allowed)
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail(ParticipantReadinessGate.NotReadyMessage));
        if (dto.DefaultStaffId.HasValue && !await _db.Users.AnyAsync(s => s.Id == dto.DefaultStaffId.Value && s.IsActive, ct))
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Staff member not found."));
        if (dto.DefaultStaffId.HasValue && await MarkedNoRefusalAsync(dto.ParticipantId, dto.DefaultStaffId.Value, ct) is { } markedNo)
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail(markedNo));
        var supportCode = SupportTypeCheck.Tidy(dto.SupportGroupCode);
        var providerToday = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        if (await SupportTypeCheck.RefusalAsync(_db, supportCode, dto.EffectiveFrom > providerToday ? dto.EffectiveFrom : providerToday, ct) is { } supportRefusal)
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail(supportRefusal));

        var pattern = new ShiftPattern
        {
            Id = Guid.NewGuid(), TenantId = await _db.Participants.Where(p => p.Id == dto.ParticipantId).Select(p => p.TenantId).FirstAsync(ct),
            ParticipantId = dto.ParticipantId, DefaultUserId = dto.DefaultStaffId,
            DayOfWeek = dto.DayOfWeek, StartTime = dto.StartTime, EndTime = dto.EndTime, EndsNextDay = dto.EndsNextDay,
            Ratio = dto.Ratio, NightType = dto.NightType, EffectiveFrom = dto.EffectiveFrom, EffectiveTo = dto.EffectiveTo,
            IsActive = dto.IsActive, Notes = dto.Notes, SupportGroupCode = supportCode
        };
        _db.ShiftPatterns.Add(pattern);
        await _db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetPatternById), new { id = pattern.Id },
            ApiResponse<ShiftPatternDto>.Ok(await LoadPatternDtoAsync(pattern.Id, ct)));
    }

    /// <summary>
    /// Update a pattern's definition. Does not touch shifts already generated from it. A pattern an approved agreement made keeps the agreement's participant, day, times, ratio, night type and
    /// dates: a change to any of them is a 409 <c>agreement-pattern</c> naming the revision, because it is a change to the agreement (POST .../pattern-change saves it as a new revision for
    /// approval). Its default staff, notes and active are the coordinator's own and save here.
    /// </summary>
    [HttpPut("patterns/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftPatternDto>>> UpdatePattern(
        Guid id, [FromBody] UpdateShiftPatternDto dto, CancellationToken ct)
    {
        if (dto.EffectiveTo < dto.EffectiveFrom) return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Choose an end date on or after the start date."));
        var participantId = await _db.ShiftPatterns.Where(p => p.Id == id).Select(p => (Guid?)p.ParticipantId).FirstOrDefaultAsync(ct);
        if (participantId is null) return NotFound(ApiResponse<ShiftPatternDto>.Fail("Pattern not found."));
        // REV281B: the regular is a concurrency token, so a change must not commit between a generation's load and its save: queue behind the participant's generation lock, as the generators do.
        RosterGenerationLock lockTaken;
        try { lockTaken = await RosterGenerationLock.AcquireAsync(_db, participantId.Value, ct, _generator.LockWait); }
        catch (RosterBusyException busy) { return Conflict(ApiResponse<ShiftPatternDto>.Fail(busy.Message)); }
        await using var held = lockTaken;
        var pattern = await _db.ShiftPatterns.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<ShiftPatternDto>.Fail("Pattern not found."));

        // The rule is for times somebody is setting now, as for a shift: an edit that leaves the times alone (deactivating a pattern saved before the rule) is never refused.
        var timesChanged = dto.StartTime != pattern.StartTime || dto.EndTime != pattern.EndTime || dto.EndsNextDay != pattern.EndsNextDay;
        if (timesChanged && Shift.HoursBetween(dto.StartTime, dto.EndTime, dto.EndsNextDay) <= 0m) return BadRequest(ApiResponse<ShiftPatternDto>.Fail(ShiftEndsBeforeItStartsMessage, ShiftNoLengthCode));
        if (pattern.SourceDraftId is { } source && ChangesTheAgreement(pattern, dto)) return AgreementPatternConflict(source, AgreementPatternEditMessage);

        if (!(await ParticipantReadiness.CheckAsync(_db, dto.ParticipantId, ct)).Allowed)
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail(ParticipantReadinessGate.NotReadyMessage));
        if (dto.DefaultStaffId.HasValue && !await _db.Users.AnyAsync(s => s.Id == dto.DefaultStaffId.Value && s.IsActive, ct))
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail("Staff member not found."));
        if (dto.DefaultStaffId.HasValue && (dto.DefaultStaffId != pattern.DefaultUserId || dto.ParticipantId != pattern.ParticipantId) && await MarkedNoRefusalAsync(dto.ParticipantId, dto.DefaultStaffId.Value, ct) is { } markedNo)
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail(markedNo));

        // The support type is billing, not the agreement's schedule, so an agreement pattern takes it here. A PUT that leaves it out keeps the stored one; a pattern's type is judged on its start, or today when it started earlier.
        var oldSupportCode = pattern.SupportGroupCode;
        var supportCode = dto.HasSupportGroupCode ? SupportTypeCheck.Tidy(dto.SupportGroupCode) : oldSupportCode;
        var supportChanged = supportCode != oldSupportCode;
        var providerToday = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        if (supportChanged && await SupportTypeCheck.RefusalAsync(_db, supportCode, dto.EffectiveFrom > providerToday ? dto.EffectiveFrom : providerToday, ct) is { } supportRefusal)
            return BadRequest(ApiResponse<ShiftPatternDto>.Fail(supportRefusal));

        pattern.ParticipantId = dto.ParticipantId; pattern.DefaultUserId = dto.DefaultStaffId;
        pattern.DayOfWeek = dto.DayOfWeek; pattern.StartTime = dto.StartTime; pattern.EndTime = dto.EndTime;
        pattern.EndsNextDay = dto.EndsNextDay; pattern.Ratio = dto.Ratio; pattern.NightType = dto.NightType;
        pattern.EffectiveFrom = dto.EffectiveFrom; pattern.EffectiveTo = dto.EffectiveTo; pattern.IsActive = dto.IsActive;
        pattern.Notes = dto.Notes;
        pattern.SupportGroupCode = supportCode;
        // The next weeks already on the roster follow the pattern: its upcoming Draft and Published shifts that still carry the old type (none of them can be claimed yet). A shift given its own type, or started, finished or past, is left alone.
        if (supportChanged)
            foreach (var upcoming in await _db.Shifts.Where(s => s.ShiftPatternId == id && (s.Status == ShiftStatus.Draft || s.Status == ShiftStatus.Published) && s.ServiceDate >= providerToday && s.SupportGroupCode == oldSupportCode).ToListAsync(ct))
                upcoming.SupportGroupCode = supportCode;

        // DefaultUserId is a concurrency token (REV281B): a regular changed since this load is the stale-board 409, not a silent overwrite.
        try { await _db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Conflict(ApiResponse<ShiftPatternDto>.Fail(PatternChangedMessage)); }
        await held.CommitAsync(ct);
        return Ok(ApiResponse<ShiftPatternDto>.Ok(await LoadPatternDtoAsync(pattern.Id, ct)));
    }

    /// <summary>The code of the 409 that refuses a change only the agreement can make; the screen reads it with <c>data.draftId</c>.</summary>
    public const string AgreementPatternCode = "agreement-pattern";

    private const string AgreementPatternEditMessage = "This pattern comes from a service agreement. Its day, times, ratio, night type, dates and participant are the agreement's: change it through the agreement, which saves a new revision for approval. Default staff, notes and active can be changed here.";
    private const string AgreementPatternDeleteMessage = "This pattern comes from a service agreement, so it ends through the agreement: save a new revision without it and approve that. To stop it making shifts now, switch it off.";

    /// <summary>The fields an agreement sets on a pattern it made. A change to any of them is a change to the agreement.</summary>
    private static bool ChangesTheAgreement(ShiftPattern pattern, CreateShiftPatternDto dto) =>
        dto.ParticipantId != pattern.ParticipantId || dto.DayOfWeek != pattern.DayOfWeek || dto.StartTime != pattern.StartTime || dto.EndTime != pattern.EndTime
        || dto.EndsNextDay != pattern.EndsNextDay || dto.Ratio != pattern.Ratio || dto.NightType != pattern.NightType || dto.EffectiveFrom != pattern.EffectiveFrom || dto.EffectiveTo != pattern.EffectiveTo;

    /// <summary>The 409 for a change only the agreement can make: the revision whose approval made the pattern, for the screen to open.</summary>
    private ConflictObjectResult AgreementPatternConflict(Guid draftId, string message) => Conflict(new ApiResponse<AgreementPatternConflictDto>
    {
        Success = false, Data = new AgreementPatternConflictDto { DraftId = draftId }, Errors = new List<string> { message }, Code = AgreementPatternCode,
    });

    /// <summary>Delete a pattern. Shifts already generated from it are left in place (provenance only, no cascade). A pattern an agreement made is refused (409 <c>agreement-pattern</c>): it ends through a revision.</summary>
    [HttpDelete("patterns/{id:guid}")]
    public async Task<ActionResult<ApiResponse<bool>>> DeletePattern(Guid id, CancellationToken ct)
    {
        var pattern = await _db.ShiftPatterns.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<bool>.Fail("Pattern not found."));
        if (pattern.SourceDraftId is { } source) return AgreementPatternConflict(source, AgreementPatternDeleteMessage);

        _db.ShiftPatterns.Remove(pattern);
        // The regular is a concurrency token, so a SetRegular that commits between the load and the delete makes this a 409 (reload and delete again), not a 500.
        try { await _db.SaveChangesAsync(ct); }
        catch (DbUpdateConcurrencyException) { return Conflict(ApiResponse<bool>.Fail(PatternChangedMessage)); }
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>
    /// Materialise a pattern into concrete Draft shifts across [from, to] through <see cref="RosterShiftGenerator"/>, the one place that does it (the approval of an agreement revision and the
    /// daily top-up use it too). Idempotent: any date in range that already carries a shift with this pattern's Id is skipped rather than duplicated, so running the same range twice in a
    /// row creates nothing the second time; so is a day the pattern's agreement plan skips for a public holiday, and concurrent calls for one participant take turns.
    /// </summary>
    [HttpPost("patterns/{id:guid}/generate")]
    public async Task<ActionResult<ApiResponse<GeneratePatternResultDto>>> GeneratePattern(
        Guid id, [FromQuery] DateOnly from, [FromQuery] DateOnly to, CancellationToken ct)
    {
        // A mistyped year would build hundreds of thousands of shifts under the board lock: refuse before the load and any lock.
        if (to < from) return BadRequest(ApiResponse<GeneratePatternResultDto>.Fail("Choose an end date on or after the start date."));
        if (to.DayNumber - from.DayNumber > 400) return BadRequest(ApiResponse<GeneratePatternResultDto>.Fail("Choose a date range of 400 days or less."));
        // Not tracked: the generator takes the participant lock and then loads the pattern tracked, and a tracked copy read here would be returned to it stale (a SetRegular committing in between would make its save a concurrency 500).
        var pattern = await _db.ShiftPatterns.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id, ct);
        if (pattern == null) return NotFound(ApiResponse<GeneratePatternResultDto>.Fail("Pattern not found."));
        if (!(await ParticipantReadiness.CheckAsync(_db, pattern.ParticipantId, ct)).Allowed)
            return BadRequest(ApiResponse<GeneratePatternResultDto>.Fail(ParticipantReadinessGate.NotReadyMessage));

        try
        {
            // A person's own window: it only moves how far the pattern has been generated when it joins on to what was covered (or, when nothing was yet, to the first day the top-up would make: the provider's today),
            // so the daily top-up can still fill a gap before it.
            var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
            // The board's lock order, as Start week: the organisation's board lock first, so a plain create for the same worker is taken in turn with this; the generator's participant lock joins that transaction, so the board lock commits.
            ShiftGeneration generated;
            await using (var held = await RosterBoardLockAsync(ct))
            {
                generated = await _generator.GenerateAsync(_db, pattern.ParticipantId, new[] { pattern.Id }, from, to, ct, onlyWhenContiguous: true, providerToday: today, availability: _availability);
                await held.CommitAsync(ct);
            }
            if (pattern.SourceDraftId != null) await MarkWeeksStartedAsync(pattern.TenantId, generated.MadeShifts, ct);
            var warnings = await BudgetWarningsAsync(pattern.ParticipantId, generated.MadeShifts, ct);
            return Ok(ApiResponse<GeneratePatternResultDto>.Ok(new GeneratePatternResultDto { Created = generated.Created, Skipped = generated.Skipped, BudgetWarnings = warnings }));
        }
        catch (RosterBusyException busy)
        {
            return Conflict(ApiResponse<GeneratePatternResultDto>.Fail(busy.Message));
        }
    }

    /// <summary>
    /// L10: a Generate from an agreement pattern that made shifts in a week nobody has started starts it (a hand-made pattern's marks nothing), so the board no longer offers Start there. Saved after the generation's own commit, one week at a time:
    /// a Start that wins the unique row for a week makes it started anyway.
    /// </summary>
    private async Task MarkWeeksStartedAsync(Guid tenantId, IReadOnlyList<Shift> made, CancellationToken ct)
    {
        var weeks = made.Select(s => RosterWeek.MondayOf(s.ServiceDate)).Distinct().ToList();
        if (weeks.Count == 0) return;
        var started = await _db.RosterWeeks.Where(w => w.TenantId == tenantId && weeks.Contains(w.WeekStart)).Select(w => w.WeekStart).ToListAsync(ct);
        foreach (var monday in weeks.Except(started))
        {
            var week = _db.RosterWeeks.Add(new RosterWeek { Id = Guid.NewGuid(), TenantId = tenantId, WeekStart = monday, StartedAt = _clock.GetUtcNow().UtcDateTime, StartedByUserId = ResolveCurrentUserId() });
            try { await _db.SaveChangesAsync(ct); }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation }) { week.State = EntityState.Detached; }
        }
    }

    /// <summary>What a pattern edit or delete made on an out-of-date page is refused with (409): UpdatePattern and DeletePattern when the regular changed under them.</summary>
    private const string PatternChangedMessage = "This pattern changed after you opened it. Reload and try again.";
}
