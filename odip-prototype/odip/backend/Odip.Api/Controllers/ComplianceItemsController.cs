using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;
using Odip.Infrastructure.Tasks;

namespace Odip.Api.Controllers;

/// <summary>
/// The organisation's compliance dates (Settings > Compliance dates): registration, audits, insurance and key personnel checks. Admin, Coordinator and SuperAdmin read the list; only Admin and SuperAdmin add, change and delete.
/// Each save keeps the date's Admin task in step in the same SaveChanges (<see cref="ComplianceDueTasks"/>), and a delete closes it. Every query names the caller's tenant itself, because a SuperAdmin has no query filter.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/compliance-items")]
public class ComplianceItemsController : ControllerBase
{
    private const int MaxLabel = 120;
    private const int MaxReference = 100;
    private const int MaxNotes = 1000;
    private const string NotFoundMessage = "Compliance date not found";
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly TimeProvider _clock;
    public ComplianceItemsController(OdipDbContext db, ICurrentTenant tenant, TimeProvider? clock = null) { _db = db; _tenant = tenant; _clock = clock ?? TimeProvider.System; }

    private static ComplianceItemDto ToDto(ComplianceItem i, DateOnly today) => new()
    {
        Id = i.Id, Kind = i.Kind, Label = i.Label, ExpiresOn = i.ExpiresOn, Reference = i.Reference, Notes = i.Notes, DaysLeft = ComplianceDueTasks.DaysLeft(i.ExpiresOn, today),
    };

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ComplianceItemDto>>>> GetAll(CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<List<ComplianceItemDto>>.Fail("Choose an organisation first."));
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        var rows = await _db.ComplianceItems.Where(i => i.TenantId == tenantId).OrderBy(i => i.ExpiresOn).ThenBy(i => i.Label).ToListAsync(ct);
        return Ok(ApiResponse<List<ComplianceItemDto>>.Ok(rows.Select(i => ToDto(i, today)).ToList()));
    }

    [HttpPost]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<ActionResult<ApiResponse<ComplianceItemDto>>> Create([FromBody] SaveComplianceItemDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ComplianceItemDto>.Fail("Choose an organisation first."));
        if (FieldError(dto) is { } error) return BadRequest(ApiResponse<ComplianceItemDto>.Fail(error));
        var row = new ComplianceItem { Id = Guid.NewGuid(), TenantId = tenantId };
        Apply(row, dto);
        _db.ComplianceItems.Add(row);
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        await EnsureTaskAsync(row, today, tenantId, ct);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ComplianceItemDto>.Ok(ToDto(row, today)));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<ActionResult<ApiResponse<ComplianceItemDto>>> Update(Guid id, [FromBody] SaveComplianceItemDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ComplianceItemDto>.Fail("Choose an organisation first."));
        var row = await _db.ComplianceItems.FirstOrDefaultAsync(i => i.Id == id && i.TenantId == tenantId, ct);
        if (row == null) return NotFound(ApiResponse<ComplianceItemDto>.Fail(NotFoundMessage));
        if (FieldError(dto) is { } error) return BadRequest(ApiResponse<ComplianceItemDto>.Fail(error));
        var oldOn = row.ExpiresOn;
        Apply(row, dto);
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        // The task is keyed by the date: a moved date closes the old task and opens the new one (or none, while it is still past 90 days).
        if (oldOn != row.ExpiresOn) await new ObligationTaskService(_db, _clock).CompleteAsync(ComplianceDueTasks.SourceKey(row.Id, oldOn), ct);
        await EnsureTaskAsync(row, today, tenantId, ct);
        // Moving a date back onto one the move itself auto-closed reopens that task; a task a person ticked (AutoCompletedAt null) stays closed.
        if (oldOn != row.ExpiresOn) await ReopenAutoClosedAsync(ComplianceDueTasks.SourceKey(row.Id, row.ExpiresOn), ct);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ComplianceItemDto>.Ok(ToDto(row, today)));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<bool>.Fail("Choose an organisation first."));
        var row = await _db.ComplianceItems.FirstOrDefaultAsync(i => i.Id == id && i.TenantId == tenantId, ct);
        if (row == null) return NotFound(ApiResponse<bool>.Fail(NotFoundMessage));
        await new ObligationTaskService(_db, _clock).CompleteAsync(ComplianceDueTasks.SourceKey(row.Id, row.ExpiresOn), ct);
        _db.ComplianceItems.Remove(row);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    private async Task ReopenAutoClosedAsync(string sourceKey, CancellationToken ct)
    {
        var task = await _db.BookingTasks.FirstOrDefaultAsync(t => t.SourceKey == sourceKey, ct);
        if (task is not { Status: TaskItemStatus.Completed, AutoCompletedAt: not null }) return;
        task.Status = TaskItemStatus.NotStarted;
        task.CompletedDate = null;
        task.AutoCompletedAt = null;
        task.UpdatedAt = DateTime.UtcNow;
    }

    private async Task EnsureTaskAsync(ComplianceItem row, DateOnly today, Guid tenantId, CancellationToken ct)
    {
        if (ComplianceDueTasks.Spec(row, today, tenantId) is { } spec) await new ObligationTaskService(_db, _clock).EnsureAsync(spec, ct);
    }

    private static string? FieldError(SaveComplianceItemDto dto) =>
        !Enum.IsDefined(dto.Kind) ? "Choose a kind."
        : string.IsNullOrWhiteSpace(dto.Label) ? "Enter a name."
        : dto.Label.Trim().Length > MaxLabel ? "Use 120 characters or fewer for the name."
        : dto.ExpiresOn.Year is < 2000 or > 2100 ? "Use a date between 2000 and 2100."
        : dto.Reference?.Trim().Length > MaxReference ? "Use 100 characters or fewer for the reference."
        : dto.Notes?.Trim().Length > MaxNotes ? "Use 1000 characters or fewer for the notes."
        : null;

    private static void Apply(ComplianceItem row, SaveComplianceItemDto dto)
    {
        row.Kind = dto.Kind;
        row.Label = dto.Label.Trim();
        row.ExpiresOn = dto.ExpiresOn;
        row.Reference = string.IsNullOrWhiteSpace(dto.Reference) ? null : dto.Reference.Trim();
        row.Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim();
        row.UpdatedAt = DateTime.UtcNow;
    }
}
