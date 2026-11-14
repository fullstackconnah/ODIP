using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

public partial class PortalController
{
    // ══════════════════════════════════════════════════════════════
    // SHIFT NOTES (NOTES-01)
    // ══════════════════════════════════════════════════════════════
    //
    // Committed by owner instruction despite the backlog doc's "potential feature" label. There
    // is no shift-completion transition in this domain for the assigned worker to hang note
    // creation off — ShiftStatus.Completed exists as an enum value but nothing anywhere in
    // RosteringController or this controller ever sets it, so a note attaches to the shift
    // directly rather than gating on a completion event the product doesn't actually have.

    /// <summary>
    /// Notes on one of the caller's own shifts, newest first. Same 404-indistinguishable
    /// ownership scoping as <see cref="GetShiftDetail"/> — not linked, shift not found, and
    /// shift-belongs-to-someone-else all 404 identically.
    /// </summary>
    [HttpGet("shifts/{id:guid}/notes")]
    public async Task<ActionResult<ApiResponse<List<ShiftNoteDto>>>> GetShiftNotes(Guid id, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<List<ShiftNoteDto>>.Fail("Shift not found."));

        var ownsShift = await NotableShifts(staffId.Value).AnyAsync(s => s.Id == id, ct);
        if (!ownsShift)
            return NotFound(ApiResponse<List<ShiftNoteDto>>.Fail("Shift not found."));

        var notes = await _db.ShiftNotes
            .Where(n => n.ShiftId == id)
            .OrderByDescending(n => n.CreatedAt)
            .ToListAsync(ct);

        var incidentIds = await GetIncidentIdsByShiftNoteIdsAsync(notes.Select(n => n.Id).ToList(), ct);
        return Ok(ApiResponse<List<ShiftNoteDto>>.Ok(
            notes.Select(n => ToShiftNoteDto(n, LookupIncidentId(incidentIds, n.Id))).ToList()));
    }

    /// <summary>Creates a note on one of the caller's own shifts. Same ownership scoping as <see cref="GetShiftNotes"/>.</summary>
    [HttpPost("shifts/{id:guid}/notes")]
    public async Task<ActionResult<ApiResponse<ShiftNoteDto>>> CreateShiftNote(
        Guid id, [FromBody] CreateShiftNoteDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Shift not found."));

        var shiftTenantId = await NotableShifts(staffId.Value).Where(s => s.Id == id)
            .Select(s => (Guid?)s.TenantId).FirstOrDefaultAsync(ct);
        if (shiftTenantId is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Shift not found."));

        // A re-sent queued note: the same id from the same author on this shift is already saved (no rescan, no second task). Any other row
        // with that id is not ours to describe.
        if (dto.Id is { } noteId && await FindNoteForReplayAsync(noteId, id, staffId.Value, ct) is { } replay)
            return replay;

        var now = NowUtc;
        if (dto.CreatedAt is { } createdIn && ClientTimeError(ClientTimeRules.Check(ShiftBreakRules.ToUtc(createdIn), now, null)) is { } lateNote)
            return BadRequest(ApiResponse<ShiftNoteDto>.Fail(lateNote.Message, lateNote.Code));

        var note = new ShiftNote
        {
            Id = dto.Id is { } clientId && clientId != Guid.Empty ? clientId : Guid.NewGuid(),
            TenantId = shiftTenantId.Value,   // the shift's organisation: an unscoped SuperAdmin has no current tenant to stamp it from
            ShiftId = id,
            AuthorUserId = staffId.Value,
            AuthorName = GetCallerName(),
            Body = dto.Body.Trim(),
        };
        // Both stamps are the phone's time, else UpdatedAt would default to now and the note would read "edited".
        if (dto.CreatedAt is { } at) note.CreatedAt = note.UpdatedAt = ShiftBreakRules.ToUtc(at);
        // NOTES-02: scan at save time — client-advisory + server-recorded, never blocking.
        note.FlaggedCategories = ShiftNoteKeywordScanner.Scan(note.Body);
        _db.ShiftNotes.Add(note);

        // Item 9 of the connection map: a flagged note raises a FlaggedNoteFollowUp obligation
        // task — "decide whether an incident is needed".
        await RaiseOrCompleteFlaggedNoteTaskAsync(note, ct);

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (dto.Id is { } racedId && ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // A concurrent send of the same queued note won the insert: answer as the replay it is.
            _db.ChangeTracker.Clear();
            return await FindNoteForReplayAsync(racedId, id, staffId.Value, ct) ?? throw ex;
        }

        // A brand-new note can't already be referenced by an incident.
        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note, incidentId: null)));
    }

    /// <summary>The 200 (same shift, same author) or 409 (any other row) for a note id that already exists; null when the id is free.</summary>
    private async Task<ActionResult<ApiResponse<ShiftNoteDto>>?> FindNoteForReplayAsync(Guid noteId, Guid shiftId, Guid staffId, CancellationToken ct)
    {
        var existing = await _db.ShiftNotes.IgnoreQueryFilters([TenantFilter.Name]).FirstOrDefaultAsync(n => n.Id == noteId, ct);
        if (existing is null) return null;
        if (existing.ShiftId != shiftId || existing.AuthorUserId != staffId)
            return Conflict(ApiResponse<ShiftNoteDto>.Fail("This note can't be saved.", ShiftErrorCodes.ShiftNoteIdConflict));
        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(existing, incidentId: null)));
    }

    /// <summary>
    /// Author-only edit of one of the caller's own shift notes — no delete anywhere (compliance-
    /// adjacent record). Not linked, note not found, and note authored by someone else all 404
    /// identically, per the class's ownership convention.
    /// </summary>
    [HttpPut("notes/{noteId:guid}")]
    public async Task<ActionResult<ApiResponse<ShiftNoteDto>>> UpdateShiftNote(
        Guid noteId, [FromBody] UpdateShiftNoteDto dto, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        var note = await FindOwnNoteAsync(noteId, staffId.Value, ct);
        if (note is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        var newBody = dto.Body.Trim();
        // NOTES-02: re-scan on every edit. If the flagged-category set actually changes, clear
        // any prior dismissal — see ShiftNote.FlagsAcknowledgedAt remarks on why a stale dismissal
        // must not silently suppress the prompt for newly-introduced flagged content.
        var newFlags = ShiftNoteKeywordScanner.Scan(newBody);
        if (newFlags != note.FlaggedCategories)
            note.FlagsAcknowledgedAt = null;

        note.Body = newBody;
        note.FlaggedCategories = newFlags;
        note.UpdatedAt = DateTime.UtcNow;

        // Item 9: an edit may introduce or change the flagged categories — raise/refresh the
        // FlaggedNoteFollowUp task. (If flags cleared to None, the existing task — if any — is
        // simply left for the incident-created/acknowledge-flags completion paths.)
        await RaiseOrCompleteFlaggedNoteTaskAsync(note, ct);

        await _db.SaveChangesAsync(ct);

        var incidentId = await _db.IncidentReports
            .Where(i => i.IsActive && i.ShiftNoteId == note.Id)
            .OrderByDescending(i => i.CreatedAt)
            .Select(i => (Guid?)i.Id)
            .FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note, incidentId)));
    }

    /// <summary>The shifts whose notes the caller may read and write: their own, plus the non-cancelled participant shifts of a group activity they are rostered on (GA PR3). A removed worker loses it at once, as their row is gone.</summary>
    private IQueryable<Shift> NotableShifts(Guid staffId) => _db.Shifts.Where(Shift.VisibleToWorker).Where(s => s.UserId == staffId
        || (s.GroupActivityId != null && s.Status != ShiftStatus.Cancelled && _db.GroupActivityStaff.Any(r => r.GroupActivityId == s.GroupActivityId && r.UserId == staffId)));

    /// <summary>The caller's own note, unless its shift is a Draft: a Draft is invisible to the worker (L1), so an open edit of an older note stops there too. Missing, not-yours and Draft are one 404.</summary>
    private Task<ShiftNote?> FindOwnNoteAsync(Guid noteId, Guid staffId, CancellationToken ct)
    {
        // Hoisted out of the predicate: a static Expression inside a nested subquery is unproven on Npgsql.
        var visible = _db.Shifts.Where(Shift.VisibleToWorker);
        return _db.ShiftNotes.FirstOrDefaultAsync(n => n.Id == noteId && n.AuthorUserId == staffId && visible.Any(s => s.Id == n.ShiftId), ct);
    }

    /// <summary>
    /// NOTES-02: dismisses the "consider filing an incident report?" prompt for one of the
    /// caller's own flagged notes. Persisted server-side (see <see cref="ShiftNote.FlagsAcknowledgedAt"/>
    /// remarks) rather than client-only, so the dismissal survives across devices/sessions. Same
    /// author-only, 404-indistinguishable ownership scoping as <see cref="UpdateShiftNote"/>.
    /// Idempotent — acknowledging an already-acknowledged (or never-flagged) note simply
    /// re-stamps the timestamp rather than erroring.
    /// </summary>
    [HttpPost("notes/{noteId:guid}/acknowledge-flags")]
    public async Task<ActionResult<ApiResponse<ShiftNoteDto>>> AcknowledgeShiftNoteFlags(Guid noteId, CancellationToken ct)
    {
        var staffId = await ResolveCurrentStaffIdAsync(ct);
        if (staffId is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        var note = await FindOwnNoteAsync(noteId, staffId.Value, ct);
        if (note is null)
            return NotFound(ApiResponse<ShiftNoteDto>.Fail("Note not found."));

        note.FlagsAcknowledgedAt = DateTime.UtcNow;

        // Item 9: acknowledging the flags closes the FlaggedNoteFollowUp task — the coordinator
        // has now made the "does this need an incident?" call, even if the answer was no.
        await _obligationTasks.CompleteAsync($"flagged-note:{note.Id}", ct);

        await _db.SaveChangesAsync(ct);

        var incidentId = await _db.IncidentReports
            .Where(i => i.IsActive && i.ShiftNoteId == note.Id)
            .OrderByDescending(i => i.CreatedAt)
            .Select(i => (Guid?)i.Id)
            .FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<ShiftNoteDto>.Ok(ToShiftNoteDto(note, incidentId)));
    }

    /// <summary>
    /// Item 9 of the connection map: raises (or, if one already exists and is still open,
    /// refreshes) the FlaggedNoteFollowUp task when this note is currently flagged. Deliberately
    /// does NOT complete an existing task when the note's flags clear back to None on an edit —
    /// per spec, only an incident being filed against this note (IncidentsController.Create) or
    /// the coordinator acknowledging the flags closes it. Shared by CreateShiftNote/UpdateShiftNote.
    /// </summary>
    private async Task RaiseOrCompleteFlaggedNoteTaskAsync(ShiftNote note, CancellationToken ct)
    {
        if (note.FlaggedCategories != ShiftNoteFlagCategory.None)
        {
            var categories = string.Join(", ", ShiftNoteKeywordVocabulary.ToCategoryNames(note.FlaggedCategories));
            await _obligationTasks.EnsureAsync(new Odip.Application.Interfaces.ObligationTaskSpec(
                SourceKey: $"flagged-note:{note.Id}",
                Type: TaskType.FlaggedNoteFollowUp,
                Title: $"Flagged shift note ({categories}) — decide whether an incident is needed",
                DueDate: (await ProviderTimeZoneResolver.TodayAsync(_db, note.TenantId, _clock, ct)).AddDays(1),
                LinkTo: "/incidents?view=flagged-notes",
                ShiftNoteId: note.Id, ShiftId: note.ShiftId, TenantId: note.TenantId), ct);
        }
    }

    /// <summary>Dictionary&lt;Guid, Guid&gt;.GetValueOrDefault returns Guid.Empty (not null) for a
    /// missing key, which would wrongly stand in for "no incident" — this is the null-correct
    /// lookup every incident-id-map read in this class uses instead.</summary>
    private static Guid? LookupIncidentId(Dictionary<Guid, Guid> map, Guid key) =>
        map.TryGetValue(key, out var incidentId) ? incidentId : null;
}
