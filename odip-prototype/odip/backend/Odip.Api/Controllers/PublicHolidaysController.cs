using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/public-holidays")]
public class PublicHolidaysController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly IPublicHolidaySyncService _syncService;

    public PublicHolidaysController(OdipDbContext db, IPublicHolidaySyncService syncService)
    {
        _db = db;
        _syncService = syncService;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<PublicHolidayDto>>>> GetAll(
        [FromQuery] int? year, [FromQuery] string? state, CancellationToken ct)
    {
        var query = _db.PublicHolidays.AsQueryable();
        if (year.HasValue) query = query.Where(h => h.Date.Year == year.Value);
        if (!string.IsNullOrEmpty(state)) query = query.Where(h => h.State == null || h.State == state);

        var items = await query.OrderBy(h => h.Date)
            .Select(h => new PublicHolidayDto { Id = h.Id, Date = h.Date, Name = h.Name, State = h.State })
            .ToListAsync(ct);

        return Ok(ApiResponse<List<PublicHolidayDto>>.Ok(items));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<PublicHolidayDto>>> Create(
        [FromBody] CreatePublicHolidayDto dto, CancellationToken ct)
    {
        var holiday = new PublicHoliday { Id = Guid.NewGuid(), Date = dto.Date, Name = dto.Name, State = dto.State };
        _db.PublicHolidays.Add(holiday);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<PublicHolidayDto>.Ok(
            new PublicHolidayDto { Id = holiday.Id, Date = holiday.Date, Name = holiday.Name, State = holiday.State }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var h = await _db.PublicHolidays.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (h == null) return NotFound(ApiResponse<bool>.Fail("Holiday not found"));
        _db.PublicHolidays.Remove(h);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("sync")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<SyncResultDto>>> Sync(
        [FromBody] SyncHolidaysDto dto, CancellationToken ct)
    {
        var fromYear = dto.FromYear ?? DateTime.UtcNow.Year;
        var toYear = dto.ToYear ?? DateTime.UtcNow.Year + 1;

        if (fromYear < 2000)
            return BadRequest(new { message = "fromYear must be 2000 or later." });
        if (toYear < fromYear)
            return BadRequest(new { message = "toYear must be greater than or equal to fromYear." });
        if (toYear - fromYear > 9)
            return BadRequest(new { message = "Year range must be 10 years or fewer." });

        var result = await _syncService.SyncAsync(fromYear, toYear, ct);

        return Ok(ApiResponse<SyncResultDto>.Ok(new SyncResultDto
        {
            YearsProcessed = result.YearsProcessed,
            HolidaysAdded = result.HolidaysAdded,
            HolidaysUpdated = result.HolidaysUpdated,
            Errors = result.Errors
        }));
    }
}
