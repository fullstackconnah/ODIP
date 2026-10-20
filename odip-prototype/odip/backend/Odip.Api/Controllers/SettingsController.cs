using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

[ApiController]
// Every action names its own roles: the class alone admits any signed-in user.
[Authorize]
[Route("api/v1/settings")]
public class SettingsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    public SettingsController(OdipDbContext db, ICurrentTenant tenant) { _db = db; _tenant = tenant; }

    // The one setting is the qualification warning window: ReadOnly reads it so its Qualifications, Staff and Dashboard figures match everyone else's.
    [HttpGet]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin,ReadOnly")]
    public async Task<ActionResult<ApiResponse<AppSettingsDto>>> Get(CancellationToken ct)
    {
        var s = await _db.AppSettings.FirstOrDefaultAsync(ct);
        return Ok(ApiResponse<AppSettingsDto>.Ok(new AppSettingsDto
        {
            QualificationWarningDays = s?.QualificationWarningDays ?? 30
        }));
    }

    [HttpPut]
    [Authorize(Roles = "Admin,SuperAdmin")]
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
    [HttpGet("module-visibility")]
    public async Task<ActionResult<ApiResponse<ModuleVisibilityDto>>> GetModuleVisibility(CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId)
            return Ok(ApiResponse<ModuleVisibilityDto>.Ok(new()));
        var s = await _db.AppSettings.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
        return Ok(ApiResponse<ModuleVisibilityDto>.Ok(new()
        {
            HiddenAccommodation = s?.HiddenAccommodation ?? false,
            HiddenVehicles = s?.HiddenVehicles ?? false,
        }));
    }

    [HttpPut("module-visibility")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ModuleVisibilityDto>>> UpdateModuleVisibility(
        [FromBody] UpdateModuleVisibilityDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId)
            return BadRequest(ApiResponse<ModuleVisibilityDto>.Fail("Choose an organisation before changing workspace visibility."));
        if (dto.HiddenAccommodation is not { } accommodation || dto.HiddenVehicles is not { } vehicles)
            return BadRequest(ApiResponse<ModuleVisibilityDto>.Fail("Choose whether to show both workspaces."));
        var s = await _db.AppSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
        if (s == null)
        {
            s = new AppSettings { Id = Guid.NewGuid(), TenantId = tenantId };
            _db.AppSettings.Add(s);
        }
        if (s.HiddenAccommodation != accommodation)
            _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(AppSettings), s.Id,
                nameof(AppSettings.HiddenAccommodation), s.HiddenAccommodation.ToString(), accommodation.ToString(), User));
        if (s.HiddenVehicles != vehicles)
            _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(AppSettings), s.Id,
                nameof(AppSettings.HiddenVehicles), s.HiddenVehicles.ToString(), vehicles.ToString(), User));
        s.HiddenAccommodation = accommodation;
        s.HiddenVehicles = vehicles;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<ModuleVisibilityDto>.Ok(new() { HiddenAccommodation = accommodation, HiddenVehicles = vehicles }));
    }}
