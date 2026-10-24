using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Integrations;
using Odip.Domain.Rostering;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Settings → Integrations → Employment Hero, for an organisation's Admin (or a SuperAdmin viewing as the organisation).
/// The API key is write-only:
/// - it arrives in a request body and is checked with one EH call;
/// - it is stored encrypted (IntegrationKeyProtector);
/// - it is never sent back, logged or audited: the audit row says only that it changed, and who changed it.
/// What a sync does: EmploymentHeroStaffSync.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin,SuperAdmin")]
[Route("api/v1/integrations/employment-hero")]
public class EmploymentHeroController : ControllerBase
{
    public const string ChooseOrganisation = "Choose an organisation to view as first: an integration belongs to one organisation.";
    public const string LinkOwnAccountMessage = "Ask another Admin to link your own account.";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly IntegrationKeyProtector _keys;
    private readonly EmploymentHeroClient _client;
    private readonly EmploymentHeroStaffSync _sync;
    private readonly TimeProvider _clock;

    public EmploymentHeroController(OdipDbContext db, ICurrentTenant tenant, IntegrationKeyProtector keys, EmploymentHeroClient client, EmploymentHeroStaffSync sync, TimeProvider? clock = null)
    {
        _db = db;
        _tenant = tenant;
        _keys = keys;
        _client = client;
        _sync = sync;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>The organisation this request works in. A SuperAdmin must be viewing as one; unscoped, the query filters would read every organisation.</summary>
    private Guid? TenantId => !_tenant.IsSuperAdmin && _tenant.TenantId is { } id ? id : null;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<EmploymentHeroStatusDto>>> Status(CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail(ChooseOrganisation));
        return Ok(ApiResponse<EmploymentHeroStatusDto>.Ok(await StatusAsync(tenantId, ct)));
    }

    /// <summary>The businesses the pasted key can see, for the picker. Nothing is stored.</summary>
    [HttpPost("businesses")]
    public async Task<ActionResult<ApiResponse<List<EmploymentHeroBusinessDto>>>> Businesses([FromBody] EmploymentHeroKeyDto dto, CancellationToken ct)
    {
        if (KeyRefusal(dto.ApiKey) is { } refusal) return refusal;
        try
        {
            var businesses = await _client.ListBusinessesAsync(dto.ApiKey!.Trim(), ct);
            return Ok(ApiResponse<List<EmploymentHeroBusinessDto>>.Ok(businesses.OrderBy(b => b.Name, StringComparer.OrdinalIgnoreCase)
                .Select(b => new EmploymentHeroBusinessDto(b.Id.ToString(CultureInfo.InvariantCulture), b.Name)).ToList()));
        }
        catch (EmploymentHeroException ex)
        {
            return Refused(ex);
        }
    }

    /// <summary>Connects, or reconnects, the organisation. One EH call proves the key and the business, then the key is stored encrypted.</summary>
    [HttpPost]
    public async Task<ActionResult<ApiResponse<EmploymentHeroStatusDto>>> Connect([FromBody] EmploymentHeroConnectDto dto, CancellationToken ct)
    {
        if (KeyRefusal(dto.ApiKey) is { } refusal) return refusal;
        if (string.IsNullOrWhiteSpace(dto.BusinessId)) return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail("Choose the Employment Hero business."));
        var tenantId = TenantId!.Value;
        var apiKey = dto.ApiKey!.Trim();
        EhBusiness business;
        try
        {
            business = await _client.GetBusinessAsync(apiKey, dto.BusinessId.Trim(), ct);
        }
        catch (EmploymentHeroException ex)
        {
            return Refused(ex);
        }

        var businessId = business.Id.ToString(CultureInfo.InvariantCulture);
        // Under the sync lock, read before anything else: a run in flight finishes (or sees the new business and skips) before the links change here.
        bool saved;
        try
        {
            saved = await EmploymentHeroStaffSync.UnderSyncLockAsync(_db, tenantId, async () =>
            {
                var conn = await _db.EmploymentHeroConnections.FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
                var previousBusiness = conn?.BusinessId ?? await _db.EmploymentHeroSyncLogs.Where(l => l.TenantId == tenantId)
                    .OrderByDescending(l => l.StartedAt).Select(l => l.BusinessId).FirstOrDefaultAsync(ct);
                // EH employee ids belong to one business. Links made against another business would match unrelated people.
                if (previousBusiness is not null && previousBusiness != businessId) await ForgetLinksAsync(tenantId, ct);

                // The timesheet cutoff: a key rotation or a disconnect and reconnect (same business) keeps it, so shifts since the first connect stay in range.
                var newConnection = previousBusiness != businessId;
                var firstConnected = conn is null && !newConnection ? await FirstConnectedAsync(tenantId, businessId, ct) : null;
                if (conn is null) _db.EmploymentHeroConnections.Add(conn = new EmploymentHeroConnection { Id = Guid.NewGuid(), TenantId = tenantId });
                (conn.ApiKeyCiphertext, conn.ApiKeyNonce) = _keys.Protect(apiKey, tenantId);
                conn.BusinessId = businessId;
                var name = (business.Name ?? "").Trim();
                conn.BusinessName = name.Length > 200 ? name[..200] : name;
                if (newConnection || conn.ConnectedAt == default) conn.ConnectedAt = firstConnected ?? _clock.GetUtcNow().UtcDateTime;
                conn.ConnectedById = Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId) ? userId : null;
                conn.ConnectedByName = User.FindFirst("fullName")?.Value ?? User.Identity?.Name ?? "An Admin";
                conn.LastSyncError = null;
                // Never the key itself in AuditLog: only that it changed, and who changed it.
                _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(EmploymentHeroConnection), conn.Id, "API key", null, "changed", User));
                await _db.SaveChangesAsync(ct);
            }, ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // A drain kept claiming rows: the same "busy" as a held lock, and the transaction rolled back.
            return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.BusyMessage));
        }
        if (!saved) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.BusyMessage));
        return Ok(ApiResponse<EmploymentHeroStatusDto>.Ok(await StatusAsync(tenantId, ct)));
    }

    /// <summary>When this business was first connected in its latest stint, from the oldest thing the connection left behind (a sync log or a queued line). Only what is newer than the last sync log of any other business counts: lines sent to that business must not be queued again. Null if it left nothing.</summary>
    private async Task<DateTime?> FirstConnectedAsync(Guid tenantId, string businessId, CancellationToken ct)
    {
        var since = await _db.EmploymentHeroSyncLogs.Where(l => l.TenantId == tenantId && l.BusinessId != businessId).Select(l => (DateTime?)l.StartedAt).MaxAsync(ct);
        var log = await _db.EmploymentHeroSyncLogs.Where(l => l.TenantId == tenantId && l.BusinessId == businessId && (since == null || l.StartedAt > since)).Select(l => (DateTime?)l.StartedAt).MinAsync(ct);
        var queued = await _db.EmploymentHeroOutbox.Where(r => r.TenantId == tenantId && (since == null || r.CreatedAt > since)).Select(r => (DateTime?)r.CreatedAt).MinAsync(ct);
        return log is null ? queued : queued is null ? log : log < queued ? log : queued;
    }

    /// <summary>Disconnects the organisation. The connection, its key and the Needs-attention items are deleted, and syncing stops. Staff keep their links, so reconnecting to the same business relinks them without duplicates.</summary>
    [HttpDelete]
    public async Task<ActionResult<ApiResponse<EmploymentHeroStatusDto>>> Disconnect(CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail(ChooseOrganisation));
        // Under the sync lock, so a run in flight never commits its links and items after the disconnect.
        var done = await EmploymentHeroStaffSync.UnderSyncLockAsync(_db, tenantId, async () =>
        {
            var conn = await _db.EmploymentHeroConnections.FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
            if (conn is null) return;
            _db.EmploymentHeroConnections.Remove(conn);
            _db.EmploymentHeroAttentions.RemoveRange(await _db.EmploymentHeroAttentions.Where(a => a.TenantId == tenantId).ToListAsync(ct));
            _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(EmploymentHeroConnection), conn.Id, "Connection", "connected", "disconnected", User));
            await _db.SaveChangesAsync(ct);
        }, ct);
        if (!done) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.BusyMessage));
        return Ok(ApiResponse<EmploymentHeroStatusDto>.Ok(await StatusAsync(tenantId, ct)));
    }

    /// <summary>The work types ODIP may send hours under, read live from EH (pay categories only; leave and shift conditions are not offered).</summary>
    [HttpGet("work-types")]
    public async Task<ActionResult<ApiResponse<List<EmploymentHeroWorkTypeDto>>>> WorkTypes(CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<List<EmploymentHeroWorkTypeDto>>.Fail(ChooseOrganisation));
        if (await SavedKeyAsync(tenantId, ct) is not { } saved) return Conflict(ApiResponse<List<EmploymentHeroWorkTypeDto>>.Fail(EmploymentHeroStaffSync.KeyUnreadableMessage));
        try
        {
            return Ok(ApiResponse<List<EmploymentHeroWorkTypeDto>>.Ok(await ListWorkTypesAsync(saved, ct)));
        }
        catch (EmploymentHeroException ex)
        {
            return Refused(ex);
        }
    }

    private async Task<List<EmploymentHeroWorkTypeDto>> ListWorkTypesAsync((string BusinessId, string Key) saved, CancellationToken ct) =>
        (await _client.ListWorkTypesAsync(saved.Key, saved.BusinessId, ct))
            .Select(w => new EmploymentHeroWorkTypeDto(w.Id.ToString(CultureInfo.InvariantCulture), (w.Name ?? "").Trim()))
            .OrderBy(w => w.Name, StringComparer.OrdinalIgnoreCase).ToList();

    /// <summary>
    /// Saves the four work types (audited, one row per changed field). Shifts waiting on a mapping that haven't been tried are sent on the next tick;
    /// a claimed row (Attempts above 0) is the drain's, so it is left alone.
    /// </summary>
    [HttpPut("work-types")]
    public async Task<ActionResult<ApiResponse<EmploymentHeroStatusDto>>> SaveWorkTypes([FromBody] EmploymentHeroWorkTypesDto dto, CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail(ChooseOrganisation));
        if (await SavedKeyAsync(tenantId, ct) is not { } saved) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.KeyUnreadableMessage));
        List<EmploymentHeroWorkTypeDto> live;
        try
        {
            live = await ListWorkTypesAsync(saved, ct);
        }
        catch (EmploymentHeroException ex)
        {
            return StatusCode(ex.Failure is EmploymentHeroFailure.KeyRefused or EmploymentHeroFailure.BusinessNotFound ? 400 : 503, ApiResponse<EmploymentHeroStatusDto>.Fail(ex.Message));
        }

        string? Clean(string? id) => string.IsNullOrWhiteSpace(id) ? null : id.Trim();
        var chosen = new[] { Clean(dto.Standard), Clean(dto.ActiveNight), Clean(dto.PassiveNight), Clean(dto.Sleepover) };
        if (chosen.Any(id => id is not null && live.All(w => w.Id != id)))
            return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail("That work type isn't in Employment Hero any more. Pick again."));

        string Name(string? id) => id is null ? "not set" : live.FirstOrDefault(w => w.Id == id)?.Name ?? id;
        for (var attempt = 0; ; attempt++)
        {
            var conn = await _db.EmploymentHeroConnections.FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
            if (conn is null) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail("Connect Employment Hero first."));
            var fields = new[]
            {
                ("day and evening shifts", conn.WorkTypeStandard, chosen[0]), ("active nights", conn.WorkTypeActiveNight, chosen[1]),
                ("passive nights", conn.WorkTypePassiveNight, chosen[2]), ("sleepovers", conn.WorkTypeSleepover, chosen[3]),
            };
            foreach (var (label, was, now) in fields.Where(f => f.Item2 != f.Item3))
                _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(EmploymentHeroConnection), conn.Id, $"Employment Hero work type: {label}", Name(was), Name(now), User));
            (conn.WorkTypeStandard, conn.WorkTypeActiveNight, conn.WorkTypePassiveNight, conn.WorkTypeSleepover) = (chosen[0], chosen[1], chosen[2], chosen[3]);
            var at = _clock.GetUtcNow().UtcDateTime;
            foreach (var row in await _db.EmploymentHeroOutbox.Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Timesheet
                         && r.Status == EmploymentHeroOutboxStatus.Pending && r.Attempts == 0).ToListAsync(ct))
            {
                row.NextAttemptAt = at;
                row.UpdatedAt = EmploymentHeroTimesheetSender.Stamp(row.UpdatedAt, at);
            }
            try
            {
                await _db.SaveChangesAsync(ct);
                break;
            }
            catch (DbUpdateConcurrencyException ex) when (attempt == 0)
            {
                // A drain claimed one of those rows between the read and the save: reload what collided and go round once more.
                foreach (var entry in ex.Entries) await entry.ReloadAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.BusyMessage));
            }
        }
        return Ok(ApiResponse<EmploymentHeroStatusDto>.Ok(await StatusAsync(tenantId, ct)));
    }

    /// <summary>Sync now: the half-hourly run, for this organisation only. A failed run shows on the card as LastSyncError, not as an HTTP error.</summary>
    /// <summary>The leave categories ODIP may send leave under, read live from EH.</summary>
    [HttpGet("leave-categories")]
    public async Task<ActionResult<ApiResponse<List<EmploymentHeroLeaveCategoryDto>>>> LeaveCategories(CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<List<EmploymentHeroLeaveCategoryDto>>.Fail(ChooseOrganisation));
        if (await SavedKeyAsync(tenantId, ct) is not { } saved) return Conflict(ApiResponse<List<EmploymentHeroLeaveCategoryDto>>.Fail(EmploymentHeroStaffSync.KeyUnreadableMessage));
        try
        {
            return Ok(ApiResponse<List<EmploymentHeroLeaveCategoryDto>>.Ok(await ListLeaveCategoriesAsync(saved, ct)));
        }
        catch (EmploymentHeroException ex)
        {
            return Refused(ex);
        }
    }

    private async Task<List<EmploymentHeroLeaveCategoryDto>> ListLeaveCategoriesAsync((string BusinessId, string Key) saved, CancellationToken ct) =>
        (await _client.ListLeaveCategoriesAsync(saved.Key, saved.BusinessId, ct))
            .Select(c => new EmploymentHeroLeaveCategoryDto(c.Id.ToString(CultureInfo.InvariantCulture), (c.Name ?? "").Trim()))
            .OrderBy(c => c.Name, StringComparer.Ordinal).ToList();

    /// <summary>
    /// Saves the four leave categories (audited, one row per changed field). Leave waiting for a category that hasn't been tried is sent on the next tick;
    /// a claimed row (Attempts above 0) is the drain's. Leave already sent is left alone: its hash has no category.
    /// </summary>
    [HttpPut("leave-categories")]
    public async Task<ActionResult<ApiResponse<EmploymentHeroStatusDto>>> SaveLeaveCategories([FromBody] EmploymentHeroLeaveCategoriesDto dto, CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail(ChooseOrganisation));
        if (await SavedKeyAsync(tenantId, ct) is not { } saved) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.KeyUnreadableMessage));
        List<EmploymentHeroLeaveCategoryDto> live;
        try
        {
            live = await ListLeaveCategoriesAsync(saved, ct);
        }
        catch (EmploymentHeroException ex)
        {
            return StatusCode(ex.Failure is EmploymentHeroFailure.KeyRefused or EmploymentHeroFailure.BusinessNotFound ? 400 : 503, ApiResponse<EmploymentHeroStatusDto>.Fail(ex.Message));
        }

        string? Clean(string? id) => string.IsNullOrWhiteSpace(id) ? null : id.Trim();
        var chosen = new[] { Clean(dto.Annual), Clean(dto.Sick), Clean(dto.Personal), Clean(dto.Other) };
        if (chosen.Any(id => id is not null && live.All(c => c.Id != id)))
            return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail("That leave category isn't in Employment Hero any more. Pick again."));

        string Name(string? id) => id is null ? "not set" : live.FirstOrDefault(c => c.Id == id)?.Name ?? id;
        for (var attempt = 0; ; attempt++)
        {
            var conn = await _db.EmploymentHeroConnections.FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
            if (conn is null) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail("Connect Employment Hero first."));
            var fields = new[]
            {
                ("annual leave", conn.LeaveCategoryAnnual, chosen[0]), ("sick leave", conn.LeaveCategorySick, chosen[1]),
                ("personal leave", conn.LeaveCategoryPersonal, chosen[2]), ("other leave", conn.LeaveCategoryOther, chosen[3]),
            };
            foreach (var (label, was, now) in fields.Where(f => f.Item2 != f.Item3))
                _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(EmploymentHeroConnection), conn.Id, $"Employment Hero leave category: {label}", Name(was), Name(now), User));
            (conn.LeaveCategoryAnnual, conn.LeaveCategorySick, conn.LeaveCategoryPersonal, conn.LeaveCategoryOther) = (chosen[0], chosen[1], chosen[2], chosen[3]);
            var at = _clock.GetUtcNow().UtcDateTime;
            foreach (var row in await _db.EmploymentHeroOutbox.Where(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Leave
                         && r.Status == EmploymentHeroOutboxStatus.Pending && r.Attempts == 0).ToListAsync(ct))
            {
                row.NextAttemptAt = at;
                row.UpdatedAt = EmploymentHeroTimesheetSender.Stamp(row.UpdatedAt, at);
            }
            try
            {
                await _db.SaveChangesAsync(ct);
                break;
            }
            catch (DbUpdateConcurrencyException ex) when (attempt == 0)
            {
                foreach (var entry in ex.Entries) await entry.ReloadAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.BusyMessage));
            }
        }
        return Ok(ApiResponse<EmploymentHeroStatusDto>.Ok(await StatusAsync(tenantId, ct)));
    }

    public const string RetryCollisionMessage = "This leave is being sent right now. Try again in a minute.";

    /// <summary>
    /// Try again on a leave (or leave cancel) ODIP gave up on. Pending now; a leave EH may already hold keeps Attempts at 1, so the next claim (2) looks for it by its marker first.
    /// </summary>
    [HttpPost("leave/{id:guid}/retry")]
    public async Task<ActionResult<ApiResponse<EmploymentHeroStatusDto>>> RetryLeave(Guid id, CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail(ChooseOrganisation));
        var row = await _db.EmploymentHeroOutbox.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId
            && (r.Kind == EmploymentHeroOutboxKind.Leave || r.Kind == EmploymentHeroOutboxKind.LeaveCancel)
            && (r.Status == EmploymentHeroOutboxStatus.Failed || r.Status == EmploymentHeroOutboxStatus.NeedsAttention), ct);
        if (row is null) return NotFound(ApiResponse<EmploymentHeroStatusDto>.Fail("That leave isn't waiting for a retry."));
        var at = _clock.GetUtcNow().UtcDateTime;
        row.Attempts = row.ExternalId is null && row.Attempts > 0 ? 1 : 0;
        (row.Status, row.NextAttemptAt, row.LastError) = (EmploymentHeroOutboxStatus.Pending, at, null);
        row.UpdatedAt = EmploymentHeroTimesheetSender.Stamp(row.UpdatedAt, at);
        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(RetryCollisionMessage));
        }
        return Ok(ApiResponse<EmploymentHeroStatusDto>.Ok(await StatusAsync(tenantId, ct)));
    }

    [HttpPost("sync")]
    public async Task<ActionResult<ApiResponse<EmploymentHeroStatusDto>>> SyncNow(CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail(ChooseOrganisation));
        var result = await _sync.RunAsync(_db, tenantId, ct);
        if (result.Outcome == EmploymentHeroSyncOutcome.NotConnected) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail("Connect Employment Hero first."));
        if (result.Outcome == EmploymentHeroSyncOutcome.Busy) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.BusyMessage));
        return Ok(ApiResponse<EmploymentHeroStatusDto>.Ok(await StatusAsync(tenantId, ct)));
    }

    /// <summary>The Link picker: the current EH employees nobody in this organisation is linked to (an ended record would be archived at the next sync). Read live from EH; nothing is stored.</summary>
    [HttpGet("employees")]
    public async Task<ActionResult<ApiResponse<List<EmploymentHeroEmployeeDto>>>> UnlinkedEmployees(CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<List<EmploymentHeroEmployeeDto>>.Fail(ChooseOrganisation));
        if (await SavedKeyAsync(tenantId, ct) is not { } saved) return Conflict(ApiResponse<List<EmploymentHeroEmployeeDto>>.Fail(EmploymentHeroStaffSync.KeyUnreadableMessage));
        List<EhEmployee> employees;
        try
        {
            employees = await _client.ListEmployeesAsync(saved.Key, saved.BusinessId, ct);
        }
        catch (EmploymentHeroException ex)
        {
            return Refused(ex);
        }

        var linkedUsers = await _db.Users.Where(u => u.TenantId == tenantId && u.ExternalPayrollId != null)
            .Select(u => new { u.Id, u.ExternalPayrollId, u.LastLoginAt }).ToListAsync(ct);
        var movable = await AddedBySyncAsync(linkedUsers.Where(u => u.LastLoginAt == null).Select(u => u.Id).ToList(), ct);
        var linked = linkedUsers.Where(u => !movable.Contains(u.Id)).Select(u => u.ExternalPayrollId!).ToHashSet();
        var bySync = linkedUsers.Where(u => movable.Contains(u.Id)).Select(u => u.ExternalPayrollId!).ToHashSet();
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        return Ok(ApiResponse<List<EmploymentHeroEmployeeDto>>.Ok(employees
            .Where(e => !EmploymentHeroStaffSync.IsLeaver(e, today))
            .Select(e => new EmploymentHeroEmployeeDto(e.Id.ToString(CultureInfo.InvariantCulture), $"{e.FirstName} {e.Surname}".Trim(), e.EmailAddress))
            .Where(e => !linked.Contains(e.Id))
            .Select(e => e with { AddedBySync = bySync.Contains(e.Id) })
            .OrderBy(e => e.Name, StringComparer.OrdinalIgnoreCase).ToList()));
    }

    /// <summary>Links a waiting ODIP staff member (a NotLinked item) to an EH employee. The next sync brings EH's details over, since EH is the master. Audited as the Admin.</summary>
    [HttpPost("attention/{id:guid}/link")]
    public async Task<ActionResult<ApiResponse<EmploymentHeroStatusDto>>> Link(Guid id, [FromBody] EmploymentHeroLinkDto dto, CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail(ChooseOrganisation));
        var employeeId = dto.EmployeeId?.Trim();
        if (string.IsNullOrEmpty(employeeId)) return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail("Choose the Employment Hero employee."));
        var item = await _db.EmploymentHeroAttentions.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId && a.Kind == EmploymentHeroAttentionKind.NotLinked, ct);
        var person = item?.UserId is { } userId ? await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId, ct) : null;
        if (item is null || person is null) return NotFound(ApiResponse<EmploymentHeroStatusDto>.Fail("That item is no longer waiting. Refresh the page."));
        // My payslips shows a person the payslips of the EH employee they are linked to, so the link needs a second person behind it.
        if (Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var callerId) && callerId == person.Id)
            return StatusCode(403, ApiResponse<EmploymentHeroStatusDto>.Fail(LinkOwnAccountMessage));
        if (person.ExternalPayrollId is not null) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail($"{person.FullName} is already linked."));
        var holder = await _db.Users.FirstOrDefaultAsync(u => u.TenantId == tenantId && u.ExternalPayrollId == employeeId, ct);
        // The first sync may have added this person a second time (another name or email). While that duplicate has never signed in, Link takes the id from it.
        if (holder is not null && (holder.LastLoginAt is not null || (await AddedBySyncAsync([holder.Id], ct)).Count == 0))
            return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail("That Employment Hero employee is already linked to someone in ODIP."));
        if (await SavedKeyAsync(tenantId, ct) is not { } saved) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.KeyUnreadableMessage));
        EhEmployee employee;
        try
        {
            employee = await _client.GetEmployeeAsync(saved.Key, saved.BusinessId, employeeId, ct);
        }
        catch (EmploymentHeroException ex)
        {
            return Refused(ex);
        }
        // The next sync would archive a current person linked to an ended record.
        if (EmploymentHeroStaffSync.IsLeaver(employee, await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct)))
            return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail("Employment Hero has ended that employee's employment, so they can't be linked. Choose their current record."));

        bool linkedNow;
        try
        {
            // One transaction under the sync lock, audited as the Admin: the duplicate gives up the id and is archived, then the person takes it.
            linkedNow = await EmploymentHeroStaffSync.UnderSyncLockAsync(_db, tenantId, async () =>
            {
                if (holder is not null)
                {
                    holder.ExternalPayrollId = null;
                    holder.IsActive = false;
                    // The address stays unique even on an archived row, so it would block the person's own sync (EH's email is the duplicate's). Never signed in, so nothing relies on it.
                    holder.Email = $"{holder.Username}@placeholder.local";
                    await _db.SaveChangesAsync(ct);   // first, on its own: the payroll-id index allows one holder at a time
                }
                person.ExternalPayrollId = employeeId;
                _db.EmploymentHeroAttentions.Remove(item);
                await _db.SaveChangesAsync(ct);
            }, ct);
        }
        catch (DbUpdateException)
        {
            // The sync linked this EH employee between the check above and this save, and the payroll-id index refused the second link.
            return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail("That Employment Hero employee is already linked to someone in ODIP."));
        }
        if (!linkedNow) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.BusyMessage));
        return Ok(ApiResponse<EmploymentHeroStatusDto>.Ok(await StatusAsync(tenantId, ct)));
    }

    /// <summary>
    /// Leave unlinked, or Dismiss. The item is hidden for as long as its problem lasts, and the sync keeps it dismissed. Once dismissed, an unlinked
    /// person's namesake in EH is no longer held back, so it is created at the next sync.
    /// </summary>
    [HttpPost("attention/{id:guid}/dismiss")]
    public async Task<ActionResult<ApiResponse<EmploymentHeroStatusDto>>> Dismiss(Guid id, CancellationToken ct)
    {
        if (TenantId is not { } tenantId) return BadRequest(ApiResponse<EmploymentHeroStatusDto>.Fail(ChooseOrganisation));
        var item = await _db.EmploymentHeroAttentions.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId, ct);
        if (item is null) return NotFound(ApiResponse<EmploymentHeroStatusDto>.Fail("That item is no longer waiting. Refresh the page."));
        item.DismissedAt ??= _clock.GetUtcNow().UtcDateTime;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<EmploymentHeroStatusDto>.Ok(await StatusAsync(tenantId, ct)));
    }

    /// <summary>Of these users, the ones the sync itself created: their Created audit row names it. Never signed in, they are the duplicates Link may repair.</summary>
    private async Task<HashSet<Guid>> AddedBySyncAsync(List<Guid> userIds, CancellationToken ct) =>
        userIds.Count == 0 ? new() : (await _db.AuditLogs
            .Where(a => a.EntityType == nameof(User) && a.Action == AuditAction.Created && a.ChangedByName == EmploymentHeroStaffSync.ActorName && userIds.Contains(a.EntityId))
            .Select(a => a.EntityId).ToListAsync(ct)).ToHashSet();

    /// <summary>The organisation's business and its key, decrypted. Null when the organisation is not connected, or this server can't read the key.</summary>
    private async Task<(string BusinessId, string Key)?> SavedKeyAsync(Guid tenantId, CancellationToken ct)
    {
        var conn = await _db.EmploymentHeroConnections.AsNoTracking().FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
        var key = conn is null ? null : _keys.Unprotect(conn.ApiKeyCiphertext, conn.ApiKeyNonce, tenantId);
        return conn is null || key is null ? null : (conn.BusinessId, key);
    }

    /// <summary>Why this request can't use a pasted key: there is no organisation, the server has no master key, or no key was pasted.</summary>
    private ActionResult? KeyRefusal(string? apiKey)
    {
        if (TenantId is null) return BadRequest(ApiResponse<bool>.Fail(ChooseOrganisation));
        if (!_keys.IsConfigured) return Conflict(ApiResponse<bool>.Fail(IntegrationKeyProtector.NotConfiguredMessage));
        if (string.IsNullOrWhiteSpace(apiKey)) return BadRequest(ApiResponse<bool>.Fail("Paste the API key from Employment Hero."));
        return null;
    }

    /// <summary>A failed EH call, in its own words. A wrong key or business is the Admin's to fix (400); an unreachable or busy EH is not (503).</summary>
    private ObjectResult Refused(EmploymentHeroException ex) =>
        StatusCode(ex.Failure is EmploymentHeroFailure.KeyRefused or EmploymentHeroFailure.BusinessNotFound ? 400 : 503, ApiResponse<bool>.Fail(ex.Message));

    /// <summary>
    /// A different business: links, Needs-attention items and the whole timesheet queue (every Kind, including leave rows PR 3 adds) go, because their EH ids belong to the old business.
    /// The rule "every outbox query names Kind == Timesheet" has this one exception. It saves on its own, and a drain that claimed a row meanwhile gets one retry.
    /// </summary>
    private async Task ForgetLinksAsync(Guid tenantId, CancellationToken ct)
    {
        for (var attempt = 0; ; attempt++)
        {
            foreach (var u in await _db.Users.Where(u => u.TenantId == tenantId && u.ExternalPayrollId != null).ToListAsync(ct)) u.ExternalPayrollId = null;
            _db.EmploymentHeroAttentions.RemoveRange(await _db.EmploymentHeroAttentions.Where(a => a.TenantId == tenantId).ToListAsync(ct));
            _db.EmploymentHeroOutbox.RemoveRange(await _db.EmploymentHeroOutbox.Where(r => r.TenantId == tenantId).ToListAsync(ct));
            foreach (var l in await _db.LeaveRequests.Where(l => l.TenantId == tenantId && l.ExternalLeaveId != null).ToListAsync(ct)) l.ExternalLeaveId = null;
            try
            {
                await _db.SaveChangesAsync(ct);
                return;
            }
            catch (DbUpdateConcurrencyException ex) when (attempt == 0)
            {
                foreach (var entry in ex.Entries) await entry.ReloadAsync(ct);
            }
        }
    }

    private async Task<EmploymentHeroStatusDto> StatusAsync(Guid tenantId, CancellationToken ct)
    {
        var conn = await _db.EmploymentHeroConnections.AsNoTracking().FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
        var staff = _db.Users.Where(u => u.TenantId == tenantId && u.IsActive && u.Role != UserRole.SuperAdmin);
        var linked = await staff.CountAsync(u => u.ExternalPayrollId != null, ct);
        var notLinked = await staff.CountAsync(u => u.ExternalPayrollId == null, ct);
        var attention = conn is null
            ? new List<EmploymentHeroAttentionDto>()
            : await _db.EmploymentHeroAttentions.AsNoTracking().Where(a => a.TenantId == tenantId && a.DismissedAt == null)
                .OrderBy(a => a.Kind).ThenBy(a => a.Name)
                .Select(a => new EmploymentHeroAttentionDto(a.Id, a.Kind, a.UserId, a.ExternalEmployeeId, a.Name, a.Reason)).ToListAsync(ct);
        var queued = await _db.EmploymentHeroOutbox.CountAsync(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Timesheet, ct);
        var sent = await _db.EmploymentHeroOutbox.CountAsync(r => r.TenantId == tenantId && r.Kind == EmploymentHeroOutboxKind.Timesheet && r.Status == EmploymentHeroOutboxStatus.Sent, ct);
        var (leaveSent, leaveWaiting, leaveProblems) = await LeaveCardAsync(tenantId, conn is not null, ct);
        return new EmploymentHeroStatusDto(_keys.IsConfigured, conn is not null, conn?.BusinessId, conn?.BusinessName, conn?.ConnectedAt, conn?.ConnectedByName,
            conn?.LastSyncAt, conn?.LastSyncError, linked, notLinked, attention, sent, queued - sent,
            new EmploymentHeroWorkTypesDto(conn?.WorkTypeStandard, conn?.WorkTypeActiveNight, conn?.WorkTypePassiveNight, conn?.WorkTypeSleepover),
            leaveSent, leaveWaiting, new EmploymentHeroLeaveCategoriesDto(conn?.LeaveCategoryAnnual, conn?.LeaveCategorySick, conn?.LeaveCategoryPersonal, conn?.LeaveCategoryOther), leaveProblems);
    }

    /// <summary>
    /// The leave half of the card. Sent counts a Leave row unless the leave's cancel went through (N1); waiting is Approved leave still to send plus cancels still to send;
    /// problems are the rows that need a person (or a category), for leave that ended less than 62 days ago (N2). Every query names the organisation and its Kind.
    /// </summary>
    private async Task<(int Sent, int Waiting, List<EmploymentHeroLeaveProblemDto> Problems)> LeaveCardAsync(Guid tenantId, bool connected, CancellationToken ct)
    {
        if (!connected) return (0, 0, []);
        var zone = (await ProviderTimeZoneResolver.ResolveAsync(_db, tenantId, ct)).Zone;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(_clock.GetUtcNow().UtcDateTime, zone));
        var rows = await _db.EmploymentHeroOutbox.AsNoTracking()
            .Where(r => r.TenantId == tenantId && (r.Kind == EmploymentHeroOutboxKind.Leave || r.Kind == EmploymentHeroOutboxKind.LeaveCancel)).ToListAsync(ct);
        var cancelByLeave = rows.Where(r => r.Kind == EmploymentHeroOutboxKind.LeaveCancel).ToDictionary(r => r.EntityId);
        var leaveIds = rows.Select(r => r.EntityId).Distinct().ToList();
        var leaves = await _db.LeaveRequests.AsNoTracking().Where(l => l.TenantId == tenantId && leaveIds.Contains(l.Id))
            .Select(l => new { l.Id, l.LeaveType, l.StartDate, l.EndDate, l.Status, Name = l.User != null ? l.User.FirstName + " " + l.User.LastName : "" }).ToListAsync(ct);
        var byId = leaves.ToDictionary(l => l.Id);

        var sent = 0;
        var waiting = 0;
        var problems = new List<(DateOnly Start, EmploymentHeroLeaveProblemDto Dto)>();
        foreach (var r in rows)
        {
            if (!byId.TryGetValue(r.EntityId, out var leave)) continue;
            var cancelling = r.Kind == EmploymentHeroOutboxKind.LeaveCancel;
            // The cancel row speaks for a cancelled leave; a Leave row of leave that is no longer Approved says nothing.
            if (!cancelling && (cancelByLeave.ContainsKey(r.EntityId) || leave.Status != LeaveStatus.Approved)) continue;
            if (r.Status == EmploymentHeroOutboxStatus.Sent)
            {
                if (!cancelling) sent++;
                continue;
            }
            var heldForCategory = !cancelling && r.Status == EmploymentHeroOutboxStatus.Pending && EmploymentHeroLeave.IsWaiting(r.LastError);
            if (r.Status == EmploymentHeroOutboxStatus.Pending) waiting++;
            if (leave.EndDate < today.AddDays(-62)) continue;
            if (r.Status is EmploymentHeroOutboxStatus.Failed or EmploymentHeroOutboxStatus.NeedsAttention || heldForCategory)
            {
                var reason = r.LastError ?? "";
                if (r.Status == EmploymentHeroOutboxStatus.Failed)
                    reason += $" ODIP tries again at {TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(r.NextAttemptAt, DateTimeKind.Utc), zone).ToString("h:mm tt", CultureInfo.InvariantCulture).ToLowerInvariant()}.";
                problems.Add((leave.StartDate, new EmploymentHeroLeaveProblemDto(r.Id, leave.Id, leave.Name.Trim(), leave.LeaveType, leave.StartDate, leave.EndDate, cancelling, heldForCategory, reason)));
            }
        }
        return (sent, waiting, problems.OrderBy(p => p.Start).ThenBy(p => p.Dto.Name, StringComparer.Ordinal).Select(p => p.Dto).ToList());
    }
}
