using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/support-catalogue")]
public class SupportCatalogueController : ControllerBase
{
    private readonly OdipDbContext _db;
    public SupportCatalogueController(OdipDbContext db) => _db = db;

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<SupportActivityGroupDto>>>> GetAll(CancellationToken ct)
    {
        var groups = await _db.SupportActivityGroups
            .Include(g => g.Items.Where(i => i.IsActive))
            .Where(g => g.IsActive)
            .OrderBy(g => g.DisplayName)
            .ToListAsync(ct);

        var result = groups.Select(g => new SupportActivityGroupDto
        {
            Id = g.Id, GroupCode = g.GroupCode, DisplayName = g.DisplayName,
            SupportCategory = g.SupportCategory, IsActive = g.IsActive,
            Items = g.Items.Select(i => new SupportCatalogueItemDto
            {
                Id = i.Id, ItemNumber = i.ItemNumber, Description = i.Description,
                Unit = i.Unit, DayType = i.DayType, IsIntensive = i.IsIntensive,
                PriceLimit_ACT = i.PriceLimit_ACT,
                PriceLimit_NSW = i.PriceLimit_NSW,
                PriceLimit_NT = i.PriceLimit_NT,
                PriceLimit_QLD = i.PriceLimit_QLD,
                PriceLimit_SA = i.PriceLimit_SA,
                PriceLimit_TAS = i.PriceLimit_TAS,
                PriceLimit_VIC = i.PriceLimit_VIC,
                PriceLimit_WA = i.PriceLimit_WA,
                PriceLimit_Remote = i.PriceLimit_Remote,
                PriceLimit_VeryRemote = i.PriceLimit_VeryRemote,
                CatalogueVersion = i.CatalogueVersion, EffectiveFrom = i.EffectiveFrom, EffectiveTo = i.EffectiveTo, IsActive = i.IsActive,
                RegistrationGroup = i.RegistrationGroup, SupportCategoryNumber = i.SupportCategoryNumber, PaceSupportCategoryNumber = i.PaceSupportCategoryNumber,
                OutcomeDomain = i.OutcomeDomain, SupportPurpose = i.SupportPurpose, CatalogueType = i.CatalogueType,
                NonFaceToFace = i.NonFaceToFace, ProviderTravel = i.ProviderTravel, ShortNoticeCancellation = i.ShortNoticeCancellation,
                NdiaRequestedReports = i.NdiaRequestedReports, IrregularSil = i.IrregularSil, IsLegacy = i.IsLegacy,
                PriceNational = i.PriceNational, PriceRemote = i.PriceRemote, PriceVeryRemote = i.PriceVeryRemote, SourceDocument = i.SourceDocument
            }).ToList()
        }).ToList();

        return Ok(ApiResponse<List<SupportActivityGroupDto>>.Ok(result));
    }

    // SuperAdmin only, like the Settings tab: the catalogue is global (a group or an item carries no tenant) and an import end-dates rows for every tenant.
    [HttpPost("import/preview")]
    [Authorize(Roles = "SuperAdmin")]
    public async Task<ActionResult<ApiResponse<CatalogueImportPreviewDto>>> PreviewImport(
        IFormFile file, [FromServices] CatalogueImportService importer, CancellationToken ct)
    {
        if (file == null || file.Length == 0)
            return BadRequest(ApiResponse<CatalogueImportPreviewDto>.Fail("No file uploaded."));

        if (!file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase))
            return BadRequest(ApiResponse<CatalogueImportPreviewDto>.Fail("File must be an .xlsx file."));

        try
        {
            await using var stream = file.OpenReadStream();
            var preview = await importer.PreviewImportAsync(stream, file.FileName, ct);
            return Ok(ApiResponse<CatalogueImportPreviewDto>.Ok(preview));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<CatalogueImportPreviewDto>.Fail(ex.Message));
        }
    }

    [HttpPost("import/confirm")]
    [Authorize(Roles = "SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> ConfirmImport(
        [FromBody] ConfirmCatalogueImportDto dto, [FromServices] CatalogueImportService importer, CancellationToken ct)
    {
        if (dto.Rows.Count == 0)
            return BadRequest(ApiResponse<bool>.Fail("No rows to import."));

        try
        {
            var result = await importer.CommitImportAsync(dto, ct);
            return Ok(ApiResponse<bool>.Ok(true,
                $"Imported {dto.Rows.Count} items for catalogue version {dto.CatalogueVersion}: {result.Added} added, {result.Updated} updated, " +
                $"{result.Unchanged} unchanged, {result.EndDated} existing items end-dated."));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<bool>.Fail(ex.Message));
        }
    }
}
