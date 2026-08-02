using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
[Route("api/v1/settings")]
public class SettingsController : ControllerBase
{
    private readonly OdipDbContext _db;
    public SettingsController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<AppSettingsDto>>> Get(CancellationToken ct)
    {
        var s = await _db.AppSettings.FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<AppSettingsDto>.Ok(new AppSettingsDto
        {
            QualificationWarningDays = s?.QualificationWarningDays ?? 30
        }));
    }

    [HttpPut]
    public async Task<ActionResult<ApiResponse<AppSettingsDto>>> Update(
        [FromBody] UpdateAppSettingsDto dto, CancellationToken ct)
    {
        var s = await _db.AppSettings.FirstOrDefaultAsync(ct);
        if (s == null)
        {
            s = new AppSettings { QualificationWarningDays = dto.QualificationWarningDays };
            _db.AppSettings.Add(s);
        }
        else
        {
            s.QualificationWarningDays = dto.QualificationWarningDays;
        }
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<AppSettingsDto>.Ok(new AppSettingsDto
        {
            QualificationWarningDays = s.QualificationWarningDays
        }));
    }
}
