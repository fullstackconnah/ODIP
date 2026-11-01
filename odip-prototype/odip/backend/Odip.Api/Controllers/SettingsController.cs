using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Rostering.Services;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Integrations;
using Odip.Infrastructure.Rostering;

namespace Odip.Api.Controllers;

[ApiController]
// Every action names its own roles: the class alone admits any signed-in user.
[Authorize]
[Route("api/v1/settings")]
public class SettingsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;

    public const string ChooseOrganisation = "Choose an organisation to view as before changing settings: settings belong to one organisation.";
    public SettingsController(OdipDbContext db, ICurrentTenant tenant) { _db = db; _tenant = tenant; }

    // The organisation's rules and alert windows: ReadOnly reads them so its Qualifications, Staff and Dashboard figures match everyone else's.
    [HttpGet]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin,ReadOnly")]
    public async Task<ActionResult<ApiResponse<AppSettingsDto>>> Get(CancellationToken ct)
    {
        // A SuperAdmin's query filter is off, so the row is picked by organisation: with none chosen they read the defaults, never another organisation's values.
        var s = _tenant.TenantId is { } tenantId
            ? await _db.AppSettings.Where(x => x.TenantId == tenantId).OrderBy(x => x.Id).FirstOrDefaultAsync(ct)
            : null;
        return Ok(ApiResponse<AppSettingsDto>.Ok(ToDto(s)));
    }

    [HttpPut]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<AppSettingsDto>>> Update(
        [FromBody] UpdateAppSettingsDto dto, CancellationToken ct)
    {
        if (_tenant.IsSuperAdmin) return BadRequest(ApiResponse<AppSettingsDto>.Fail(ChooseOrganisation));
        var s = await _db.AppSettings.OrderBy(x => x.Id).FirstOrDefaultAsync(ct);
        if (s == null)
        {
            s = new AppSettings();   // a field left out takes the entity default
            _db.AppSettings.Add(s);
        }
        // Presence-based: a field left out keeps the stored value, so each Settings section saves only its own.
        if (dto.QualificationWarningDays is { } days) s.QualificationWarningDays = days;
        if (dto.WeeklyHoursWarning is { } hours) s.WeeklyHoursWarning = hours;
        if (dto.VarianceReviewMinutes is { } minutes) s.VarianceReviewMinutes = minutes;
        if (dto.PlanExpiryWarningDays is { } planDays) s.PlanExpiryWarningDays = planDays;
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<AppSettingsDto>.Ok(ToDto(s)));
    }

    private static AppSettingsDto ToDto(AppSettings? s) => new()
    {
        QualificationWarningDays = s?.QualificationWarningDays ?? 30,
        WeeklyHoursWarning = s?.WeeklyHoursWarning ?? (int)RosterConflictService.DefaultWeeklyHoursThreshold,
        VarianceReviewMinutes = s?.VarianceReviewMinutes ?? OrganisationRules.Default.VarianceReviewMinutes,
        PlanExpiryWarningDays = s?.PlanExpiryWarningDays ?? OrganisationRules.Default.PlanExpiryWarningDays,
        SessionLengthMinutes = s?.SessionLengthMinutes
    };

    // Its own PUT: the alert windows PUT requires QualificationWarningDays, and "No limit" (null) must be told apart from a field left out.
    [HttpPut("security")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<AppSettingsDto>>> UpdateSecurity(
        [FromBody] UpdateSecuritySettingsDto dto, CancellationToken ct)
    {
        if (_tenant.IsSuperAdmin) return BadRequest(ApiResponse<AppSettingsDto>.Fail(ChooseOrganisation));
        var s = await _db.AppSettings.OrderBy(x => x.Id).FirstOrDefaultAsync(ct);
        if (s == null)
        {
            s = new AppSettings { SessionLengthMinutes = dto.SessionLengthMinutes };
            _db.AppSettings.Add(s);
        }
        else
        {
            s.SessionLengthMinutes = dto.SessionLengthMinutes;
        }
        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<AppSettingsDto>.Ok(ToDto(s)));
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
            EmploymentHeroConnected = await EmploymentHeroStaffSync.IsConnectedAsync(_db, tenantId, ct),
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
        return Ok(ApiResponse<ModuleVisibilityDto>.Ok(new()
        {
            HiddenAccommodation = accommodation,
            HiddenVehicles = vehicles,
            EmploymentHeroConnected = await EmploymentHeroStaffSync.IsConnectedAsync(_db, tenantId, ct),
        }));
    }}
