using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// The provider's calendar date, for every signed-in role: provider settings are SuperAdmin, Admin and Coordinator only, so the screens a
/// SupportWorker or ReadOnly user opens (Today's routines) could not learn the provider's day from them. Only a date leaves; no tenant data.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/provider-today")]
public class ProviderTodayController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly TimeProvider _clock;

    public ProviderTodayController(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<ProviderTodayDto>>> Get(CancellationToken ct)
    {
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, _clock, ct);
        return Ok(ApiResponse<ProviderTodayDto>.Ok(new ProviderTodayDto(today.ToString("yyyy-MM-dd"))));
    }
}
