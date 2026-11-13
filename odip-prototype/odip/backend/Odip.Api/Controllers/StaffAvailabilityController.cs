using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Interfaces;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/staff-availability")]
public class StaffAvailabilityController : ControllerBase
{
    private readonly OdipDbContext _db;
    public StaffAvailabilityController(OdipDbContext db) => _db = db;

    /// <summary>StaffAvailability has no organisation column or query filter: a row is the caller's only if its user is (Users is tenant-filtered).</summary>
    private IQueryable<StaffAvailability> TenantAvailabilities() =>
        _db.StaffAvailabilities.Where(a => _db.Users.Any(u => u.Id == a.UserId));

    /// <summary>
    /// §4.4 same-tenant validation for the availability record's staff/user ref (required, not
    /// nullable, on this DTO): must resolve to an active User — same-tenant scoping comes for
    /// free from _db.Users' ambient OdipDbContext query filter.
    /// </summary>
    private Task<bool> IsValidStaffRefAsync(Guid userId, CancellationToken ct) =>
        _db.Users.AnyAsync(u => u.Id == userId && u.IsActive, ct);

    [HttpGet]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<StaffAvailabilityDto>>>> GetAll(
        [FromQuery] Guid? userId, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to, CancellationToken ct)
    {
        // StaffAvailability is not a tenant-scoped entity (no ITenantEntity, no HasQueryFilter),
        // so scope rows to the caller's tenant by joining through the filtered Users set —
        // same-tenant scoping comes for free from _db.Users' ambient OdipDbContext query filter.
        // StaffAvailability is not a tenant-scoped entity (no ITenantEntity, no HasQueryFilter),
        // so scope rows to the caller's tenant by joining through the filtered Users set —
        // same-tenant scoping comes for free from _db.Users' ambient OdipDbContext query filter.
        var query = _db.StaffAvailabilities.Where(a => _db.Users.Any(u => u.Id == a.UserId)).AsQueryable();
        if (userId.HasValue) query = query.Where(a => a.UserId == userId.Value);
        if (from.HasValue) query = query.Where(a => a.EndDateTime >= from.Value.ToDateTime(TimeOnly.MinValue));
        if (to.HasValue) query = query.Where(a => a.StartDateTime <= to.Value.ToDateTime(TimeOnly.MaxValue));

        var items = await query
            .OrderByDescending(a => a.StartDateTime)
            .Select(a => new StaffAvailabilityDto
            {
                Id = a.Id, StaffId = a.UserId, StartDateTime = a.StartDateTime,
                EndDateTime = a.EndDateTime, AvailabilityType = a.AvailabilityType,
                IsRecurring = a.IsRecurring, RecurrenceNotes = a.RecurrenceNotes, Notes = a.Notes
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<StaffAvailabilityDto>>.Ok(items));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAvailabilityDto>>> Create([FromBody] CreateStaffAvailabilityDto dto, CancellationToken ct)
    {
        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAvailabilityDto>.Fail("Staff member not found."));

        var a = new StaffAvailability
        {
            Id = Guid.NewGuid(), UserId = dto.StaffId, StartDateTime = dto.StartDateTime,
            EndDateTime = dto.EndDateTime, AvailabilityType = dto.AvailabilityType,
            IsRecurring = dto.IsRecurring, RecurrenceNotes = dto.RecurrenceNotes, Notes = dto.Notes
        };
        _db.StaffAvailabilities.Add(a);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<StaffAvailabilityDto>.Ok(new StaffAvailabilityDto
        {
            Id = a.Id, StaffId = a.UserId, StartDateTime = a.StartDateTime,
            EndDateTime = a.EndDateTime, AvailabilityType = a.AvailabilityType,
            IsRecurring = a.IsRecurring, RecurrenceNotes = a.RecurrenceNotes, Notes = a.Notes
        }));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<StaffAvailabilityDto>>> Update(Guid id, [FromBody] UpdateStaffAvailabilityDto dto, CancellationToken ct)
    {
        var a = await TenantAvailabilities().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<StaffAvailabilityDto>.Fail("Availability not found"));

        if (!await IsValidStaffRefAsync(dto.StaffId, ct))
            return BadRequest(ApiResponse<StaffAvailabilityDto>.Fail("Staff member not found."));

        a.StartDateTime = dto.StartDateTime; a.EndDateTime = dto.EndDateTime;
        a.AvailabilityType = dto.AvailabilityType; a.IsRecurring = dto.IsRecurring;
        a.RecurrenceNotes = dto.RecurrenceNotes; a.Notes = dto.Notes; a.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<StaffAvailabilityDto>.Ok(new StaffAvailabilityDto
        {
            Id = a.Id, StaffId = a.UserId, StartDateTime = a.StartDateTime,
            EndDateTime = a.EndDateTime, AvailabilityType = a.AvailabilityType,
            IsRecurring = a.IsRecurring, RecurrenceNotes = a.RecurrenceNotes, Notes = a.Notes
        }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var a = await TenantAvailabilities().FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a == null) return NotFound(ApiResponse<bool>.Fail("Availability not found"));
        _db.StaffAvailabilities.Remove(a);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }
}
