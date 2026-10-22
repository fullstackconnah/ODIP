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
        var saved = await EmploymentHeroStaffSync.UnderSyncLockAsync(_db, tenantId, async () =>
        {
            var conn = await _db.EmploymentHeroConnections.FirstOrDefaultAsync(c => c.TenantId == tenantId, ct);
            var previousBusiness = conn?.BusinessId ?? await _db.EmploymentHeroSyncLogs.Where(l => l.TenantId == tenantId)
                .OrderByDescending(l => l.StartedAt).Select(l => l.BusinessId).FirstOrDefaultAsync(ct);
            // EH employee ids belong to one business. Links made against another business would match unrelated people.
            if (previousBusiness is not null && previousBusiness != businessId) await ForgetLinksAsync(tenantId, ct);

            if (conn is null) _db.EmploymentHeroConnections.Add(conn = new EmploymentHeroConnection { Id = Guid.NewGuid(), TenantId = tenantId });
            (conn.ApiKeyCiphertext, conn.ApiKeyNonce) = _keys.Protect(apiKey, tenantId);
            conn.BusinessId = businessId;
            var name = (business.Name ?? "").Trim();
            conn.BusinessName = name.Length > 200 ? name[..200] : name;
            conn.ConnectedAt = _clock.GetUtcNow().UtcDateTime;
            conn.ConnectedById = Guid.TryParse(User.FindFirst(ClaimTypes.NameIdentifier)?.Value, out var userId) ? userId : null;
            conn.ConnectedByName = User.FindFirst("fullName")?.Value ?? User.Identity?.Name ?? "An Admin";
            conn.LastSyncError = null;
            // Never the key itself in AuditLog: only that it changed, and who changed it.
            _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(EmploymentHeroConnection), conn.Id, "API key", null, "changed", User));
            await _db.SaveChangesAsync(ct);
        }, ct);
        if (!saved) return Conflict(ApiResponse<EmploymentHeroStatusDto>.Fail(EmploymentHeroStaffSync.BusyMessage));
        return Ok(ApiResponse<EmploymentHeroStatusDto>.Ok(await StatusAsync(tenantId, ct)));
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

    /// <summary>Sync now: the half-hourly run, for this organisation only. A failed run shows on the card as LastSyncError, not as an HTTP error.</summary>
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

    private async Task ForgetLinksAsync(Guid tenantId, CancellationToken ct)
    {
        foreach (var u in await _db.Users.Where(u => u.TenantId == tenantId && u.ExternalPayrollId != null).ToListAsync(ct)) u.ExternalPayrollId = null;
        _db.EmploymentHeroAttentions.RemoveRange(await _db.EmploymentHeroAttentions.Where(a => a.TenantId == tenantId).ToListAsync(ct));
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
        return new EmploymentHeroStatusDto(_keys.IsConfigured, conn is not null, conn?.BusinessId, conn?.BusinessName, conn?.ConnectedAt, conn?.ConnectedByName,
            conn?.LastSyncAt, conn?.LastSyncError, linked, notLinked, attention);
    }
}
