using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Incidents;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>Its own controller so the manager-only gate is a class attribute (IncidentsController is plain [Authorize]): any other role gets a 403, never an empty list.</summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/incidents")]
public class IncidentTrendController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public IncidentTrendController(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    /// <summary>Incidents and restrictive practice uses by month (N7): the provider's last 6 months, this month last.</summary>
    [HttpGet("trend")]
    public async Task<ActionResult<ApiResponse<IncidentTrendDto>>> GetTrend(CancellationToken ct)
    {
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        return Ok(ApiResponse<IncidentTrendDto>.Ok(new IncidentTrendDto { Today = today, Months = await IncidentTrend.MonthsAsync(_db, today, ct) }));
    }
}
