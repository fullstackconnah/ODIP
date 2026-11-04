using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// The organisation's saved places (Settings > Organisation > Service locations): a name, a map pin, a check-in distance and an optional time zone, picked on a shift.
/// Anyone signed in with an organisation reads the list; Admin, Coordinator and SuperAdmin add, change and archive. There is no delete: an archived place stays on the shifts that have it.
/// Every query names the caller's tenant itself, because a SuperAdmin has no query filter.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/service-locations")]
public class ServiceLocationsController : ControllerBase
{
    private const int MaxName = 100;
    private const int MaxAddress = 300;
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    public ServiceLocationsController(OdipDbContext db, ICurrentTenant tenant) { _db = db; _tenant = tenant; }

    private const string Duplicate = "That place is already on the list.";

    private static ServiceLocationDto ToDto(ServiceLocation l) => new()
    {
        Id = l.Id, Name = l.Name, Address = l.Address, Latitude = l.Latitude, Longitude = l.Longitude,
        RadiusMetres = l.RadiusMetres, TimeZoneId = l.TimeZoneId, IsActive = l.IsActive,
    };

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ServiceLocationDto>>>> GetAll(CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<List<ServiceLocationDto>>.Fail("Choose an organisation first."));
        var rows = await _db.ServiceLocations.Where(l => l.TenantId == tenantId).OrderByDescending(l => l.IsActive).ThenBy(l => l.Name).ToListAsync(ct);
        return Ok(ApiResponse<List<ServiceLocationDto>>.Ok(rows.Select(ToDto).ToList()));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ServiceLocationDto>>> Create([FromBody] SaveServiceLocationDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ServiceLocationDto>.Fail("A tenant context is required."));
        if (FieldError(dto) is { } error) return BadRequest(ApiResponse<ServiceLocationDto>.Fail(error));
        var name = dto.Name.Trim();
        if (await TakenAsync(tenantId, name, null, ct)) return Conflict(ApiResponse<ServiceLocationDto>.Fail(Duplicate));
        var row = new ServiceLocation { Id = Guid.NewGuid(), TenantId = tenantId };
        Apply(row, dto);
        _db.ServiceLocations.Add(row);
        if (!await SavedAsync(ct)) return Conflict(ApiResponse<ServiceLocationDto>.Fail(Duplicate));
        return Ok(ApiResponse<ServiceLocationDto>.Ok(ToDto(row)));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ServiceLocationDto>>> Update(Guid id, [FromBody] SaveServiceLocationDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ServiceLocationDto>.Fail("A tenant context is required."));
        var row = await _db.ServiceLocations.FirstOrDefaultAsync(l => l.Id == id && l.TenantId == tenantId, ct);
        if (row == null) return NotFound(ApiResponse<ServiceLocationDto>.Fail("Service location not found"));
        if (FieldError(dto) is { } error) return BadRequest(ApiResponse<ServiceLocationDto>.Fail(error));
        // An archived place keeps its name free for a new one, so only an active place is held to a unique name.
        if (row.IsActive && await TakenAsync(tenantId, dto.Name.Trim(), id, ct)) return Conflict(ApiResponse<ServiceLocationDto>.Fail(Duplicate));
        Apply(row, dto);
        if (!await SavedAsync(ct)) return Conflict(ApiResponse<ServiceLocationDto>.Fail(Duplicate));
        return Ok(ApiResponse<ServiceLocationDto>.Ok(ToDto(row)));
    }

    [HttpPost("{id:guid}/archive")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ServiceLocationDto>>> Archive(Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ServiceLocationDto>.Fail("A tenant context is required."));
        var row = await _db.ServiceLocations.FirstOrDefaultAsync(l => l.Id == id && l.TenantId == tenantId, ct);
        if (row == null) return NotFound(ApiResponse<ServiceLocationDto>.Fail("Service location not found"));
        row.IsActive = false;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ServiceLocationDto>.Ok(ToDto(row)));
    }

    private static string? FieldError(SaveServiceLocationDto dto) =>
        string.IsNullOrWhiteSpace(dto.Name) ? "Enter a name."
        : dto.Name.Trim().Length > MaxName ? "Use 100 characters or fewer for the name."
        : dto.Address?.Trim().Length > MaxAddress ? "Use 300 characters or fewer for the address."
        : dto.Latitude is null || dto.Longitude is null ? "Pick the place on the map."
        : dto.Latitude is < -90m or > 90m ? "Latitude must be between -90 and 90."
        : dto.Longitude is < -180m or > 180m ? "Longitude must be between -180 and 180."
        : dto.RadiusMetres is < 50 or > 2000 ? "Use a check-in distance from 50 to 2000 metres."
        : !string.IsNullOrWhiteSpace(dto.TimeZoneId) && !StateTimeZoneMap.Zones.Contains(dto.TimeZoneId.Trim()) ? "Pick one of the Australian time zones."
        : null;

    private static void Apply(ServiceLocation row, SaveServiceLocationDto dto)
    {
        row.Name = dto.Name.Trim();
        row.Address = string.IsNullOrWhiteSpace(dto.Address) ? null : dto.Address.Trim();
        row.Latitude = dto.Latitude!.Value;   // FieldError refused a missing pin
        row.Longitude = dto.Longitude!.Value;
        row.RadiusMetres = dto.RadiusMetres;
        row.TimeZoneId = string.IsNullOrWhiteSpace(dto.TimeZoneId) ? null : dto.TimeZoneId.Trim();
        row.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Another active place of this organisation already has the name, compared without case after trimming (the unique index is exact, so it is only the backstop).</summary>
    private Task<bool> TakenAsync(Guid tenantId, string name, Guid? exceptId, CancellationToken ct)
    {
        var lower = name.ToLower();
        return _db.ServiceLocations.AnyAsync(l => l.TenantId == tenantId && l.IsActive && (exceptId == null || l.Id != exceptId) && l.Name.ToLower() == lower, ct);
    }

    // Two adds of the same name racing past TakenAsync: the unique index refuses the second, which is the same answer.
    private async Task<bool> SavedAsync(CancellationToken ct)
    {
        try { await _db.SaveChangesAsync(ct); return true; }
        catch (DbUpdateException e) when (e.InnerException is PostgresException { SqlState: "23505" }) { return false; }
    }
}
