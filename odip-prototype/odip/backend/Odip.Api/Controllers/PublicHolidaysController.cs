using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Application.Interfaces;
using Odip.Domain.Billing.Pricing;
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

    // The table is global: every tenant's quotes and claims read the same rows, and a row decides whether a day is priced at the public holiday
    // rate (+122% on a weekday). So adding, deleting and syncing are the SuperAdmin's, not any tenant's Admin (review M6 of plan builder phase B).
    [HttpPost]
    [Authorize(Roles = "SuperAdmin")]
    public async Task<ActionResult<ApiResponse<PublicHolidayDto>>> Create(
        [FromBody] CreatePublicHolidayDto dto, CancellationToken ct)
    {
        // A row only prices a day if its state is one the engine can match: one of the eight codes, in capitals (no state is a holiday in every state).
        string? state = null;
        if (dto.State is not null)
        {
            state = dto.State.Trim().ToUpperInvariant();
            if (!HolidayCalendar.StateCodes.Contains(state))
                return BadRequest(ApiResponse<PublicHolidayDto>.Fail(
                    $"State must be one of {string.Join(", ", HolidayCalendar.StateCodes)}, or left out for a holiday in every state."));
        }

        var holiday = new PublicHoliday { Id = Guid.NewGuid(), Date = dto.Date, Name = dto.Name, State = state };
        _db.PublicHolidays.Add(holiday);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<PublicHolidayDto>.Ok(
            new PublicHolidayDto { Id = holiday.Id, Date = holiday.Date, Name = holiday.Name, State = holiday.State }));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> Delete(Guid id, CancellationToken ct)
    {
        var h = await _db.PublicHolidays.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (h == null) return NotFound(ApiResponse<bool>.Fail("Holiday not found"));
        _db.PublicHolidays.Remove(h);
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    [HttpPost("sync")]
    [Authorize(Roles = "SuperAdmin")]
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
