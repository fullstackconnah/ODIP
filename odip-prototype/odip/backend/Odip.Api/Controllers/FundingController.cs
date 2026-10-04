using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// The organisation-wide half of the budget feature (phase 1): the NDIS support category list, served as data so no screen keeps a second copy, and the budget settings
/// (the mode, and the percentage at which a participant counts as approaching their budget), which mirror <see cref="PlanPricingController"/>'s settings pair. The settings
/// are stored here and enforced by later phases: phase 1 only records the choice.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/funding")]
public class FundingController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;

    public FundingController(OdipDbContext db, ICurrentTenant tenant)
    {
        _db = db;
        _tenant = tenant;
    }

    public const string ChooseOrganisation = "Choose an organisation to view as before using budget settings: they belong to one organisation.";
    public const string UnknownMode = "Unknown budget mode. Use Warn or HardLimit.";
    public const string BadPercent = "Warn when used reaches must be from 50 to 95 percent, in steps of 5.";

    /// <summary>The NDIS support categories (01 to 21) with their budget, whether they are flexible, and whether a stated pool of the category may be offered. Any signed-in staff role may read it: it is reference data, not money.</summary>
    [HttpGet("pace-categories")]
    public ActionResult<ApiResponse<List<PaceCategoryDto>>> PaceCategories() =>
        Ok(ApiResponse<List<PaceCategoryDto>>.Ok(Odip.Domain.Funding.PaceCategories.All.Select(c => new PaceCategoryDto
        {
            Number = c.Number, Name = c.Name, Budget = c.Budget, Flexible = c.Flexible, OfferedAsStatedPool = c.OfferedAsStatedPool,
        }).ToList()));

    /// <summary>The organisation's budget settings; the defaults (Warn, 80 percent, <c>isDefault</c>) while none are stored.</summary>
    [HttpGet("settings")]
    [Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
    public async Task<ActionResult<ApiResponse<BudgetSettingsDto>>> GetSettings(CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<BudgetSettingsDto>.Fail(ChooseOrganisation));

        var settings = await _db.BudgetSettings.AsNoTracking().FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
        return Ok(ApiResponse<BudgetSettingsDto>.Ok(ToDto(settings)));
    }

    /// <summary>
    /// Each setting changes only when the request carries it. Validated before anything is touched, so a refused request writes nothing. The change is audited by the generic
    /// audit interceptor (the table holds nothing private): one audit row for the change, naming the fields that changed.
    /// </summary>
    [HttpPut("settings")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    [EnableRateLimiting("api")]
    [RequestSizeLimit(4_096)]
    public async Task<ActionResult<ApiResponse<BudgetSettingsDto>>> PutSettings([FromBody] UpdateBudgetSettingsDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<BudgetSettingsDto>.Fail(ChooseOrganisation));

        if (dto.Mode is { } mode && !Enum.IsDefined(mode)) return BadRequest(ApiResponse<BudgetSettingsDto>.Fail(UnknownMode));
        if (dto.ApproachingPercent is { } percent && !BudgetSettings.IsAllowedApproachingPercent(percent)) return BadRequest(ApiResponse<BudgetSettingsDto>.Fail(BadPercent));

        // Each setting the request carries, applied to the row (kept apart so a lost first-PUT race can apply the same request to the row that won).
        void Apply(BudgetSettings row)
        {
            if (dto.Mode is { } m) row.Mode = m;
            if (dto.ApproachingPercent is { } p) row.ApproachingPercent = p;
        }

        var settings = await _db.BudgetSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
        var inserting = settings is null;
        if (settings is null)
        {
            settings = new BudgetSettings { Id = Guid.NewGuid(), TenantId = tenantId };
            _db.BudgetSettings.Add(settings);
        }

        Apply(settings);

        try
        {
            await _db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException) when (inserting)
        {
            // Two first PUTs for one tenant at once: the other one wrote the row and the unique index on TenantId refused ours (a 500 for the loser, who did nothing wrong).
            // Forget everything this context tried to write, audit rows included, read the row that won and apply this request on top of it. With no such row the failure
            // was something else and is thrown as it was.
            _db.ChangeTracker.Clear();
            settings = await _db.BudgetSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId, ct);
            if (settings is null) throw;

            Apply(settings);
            await _db.SaveChangesAsync(ct);
        }

        return Ok(ApiResponse<BudgetSettingsDto>.Ok(ToDto(settings)));
    }

    private static BudgetSettingsDto ToDto(BudgetSettings? settings) => new()
    {
        Mode = settings?.Mode ?? BudgetSettings.DefaultMode,
        ApproachingPercent = settings?.ApproachingPercent ?? BudgetSettings.DefaultApproachingPercent,
        IsDefault = settings is null,
    };
}
