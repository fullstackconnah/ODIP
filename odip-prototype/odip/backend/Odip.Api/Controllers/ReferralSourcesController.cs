using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// The organisation's list of who refers people to it (Settings > Content > Referral sources), picked as "Referred by" on an enquiry. Anyone signed in with an organisation reads it;
/// Admin, Coordinator and SuperAdmin add, rename, hide and show. There is no delete: a hidden source keeps its label on the enquiries that have it.
/// Every query names the caller's tenant itself, because a SuperAdmin has no query filter.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/referral-sources")]
public class ReferralSourcesController : ControllerBase
{
    private const int MaxName = 100;
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    public ReferralSourcesController(OdipDbContext db, ICurrentTenant tenant) { _db = db; _tenant = tenant; }

    private static ReferralSourceDto ToDto(ReferralSource s) => new() { Id = s.Id, Name = s.Name, IsActive = s.IsActive };

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ReferralSourceDto>>>> GetAll(CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<List<ReferralSourceDto>>.Fail("Choose an organisation first."));
        var rows = await _db.ReferralSources.Where(s => s.TenantId == tenantId).OrderByDescending(s => s.IsActive).ThenBy(s => s.Name).ToListAsync(ct);
        return Ok(ApiResponse<List<ReferralSourceDto>>.Ok(rows.Select(ToDto).ToList()));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ReferralSourceDto>>> Create([FromBody] CreateReferralSourceDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ReferralSourceDto>.Fail("A tenant context is required."));
        if (NameError(dto.Name) is { } error) return BadRequest(ApiResponse<ReferralSourceDto>.Fail(error));
        var name = dto.Name.Trim();
        if (await TakenAsync(tenantId, name, null, ct)) return Conflict(ApiResponse<ReferralSourceDto>.Fail(Duplicate));
        var row = new ReferralSource { Id = Guid.NewGuid(), TenantId = tenantId, Name = name };
        _db.ReferralSources.Add(row);
        if (!await SavedAsync(ct)) return Conflict(ApiResponse<ReferralSourceDto>.Fail(Duplicate));
        return Ok(ApiResponse<ReferralSourceDto>.Ok(ToDto(row)));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ReferralSourceDto>>> Update(Guid id, [FromBody] UpdateReferralSourceDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ReferralSourceDto>.Fail("A tenant context is required."));
        var row = await _db.ReferralSources.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == tenantId, ct);
        if (row == null) return NotFound(ApiResponse<ReferralSourceDto>.Fail("Referral source not found"));
        if (NameError(dto.Name) is { } error) return BadRequest(ApiResponse<ReferralSourceDto>.Fail(error));
        var name = dto.Name.Trim();
        if (await TakenAsync(tenantId, name, id, ct)) return Conflict(ApiResponse<ReferralSourceDto>.Fail(Duplicate));
        row.Name = name; row.IsActive = dto.IsActive; row.UpdatedAt = DateTime.UtcNow;
        if (!await SavedAsync(ct)) return Conflict(ApiResponse<ReferralSourceDto>.Fail(Duplicate));
        return Ok(ApiResponse<ReferralSourceDto>.Ok(ToDto(row)));
    }

    private const string Duplicate = "That source is already on the list.";

    private static string? NameError(string? name) =>
        string.IsNullOrWhiteSpace(name) ? "Enter a name." : name.Trim().Length > MaxName ? "Use 100 characters or fewer." : null;

    /// <summary>Another row of this organisation already has the name, compared without case after trimming (the unique index is exact, so it is only the backstop).</summary>
    private Task<bool> TakenAsync(Guid tenantId, string name, Guid? exceptId, CancellationToken ct)
    {
        var lower = name.ToLower();
        return _db.ReferralSources.AnyAsync(s => s.TenantId == tenantId && (exceptId == null || s.Id != exceptId) && s.Name.ToLower() == lower, ct);
    }

    // Two adds of the same name racing past TakenAsync: the unique index refuses the second, which is the same answer.
    private async Task<bool> SavedAsync(CancellationToken ct)
    {
        try { await _db.SaveChangesAsync(ct); return true; }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" }) { return false; }
    }
}
