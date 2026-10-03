using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing.Pricing;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/v1/participants/{participantId:guid}/service-agreement-drafts")]
public class ServiceAgreementDraftsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly ServiceAgreementDraftService _service;
    private readonly ElectronicSigningEvidenceService _evidence;
    private readonly DemoJourneySimulationService _simulation;
    private readonly IConfiguration _configuration;
    public ServiceAgreementDraftsController(OdipDbContext db, ICurrentTenant tenant, ServiceAgreementDraftService service, ElectronicSigningEvidenceService? evidence = null, DemoJourneySimulationService? simulation = null, IConfiguration? configuration = null)
    {
        _db = db; _tenant = tenant; _service = service; _evidence = evidence ?? new ElectronicSigningEvidenceService(db);
        _simulation = simulation ?? new DemoJourneySimulationService(db);
        _configuration = configuration ?? new ConfigurationBuilder().Build();
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ServiceAgreementDraftDto>>>> List(Guid participantId, CancellationToken ct)
    {
        // Two collections (the blocks and the lines) are loaded beside each draft: as separate queries, so a draft with many of each is not a cross product of them.
        var drafts = await _db.ServiceAgreementDrafts.Include(x => x.Lines).Include(x => x.Blocks).AsSplitQuery().Where(x => x.ParticipantId == participantId).OrderByDescending(x => x.Version).ToListAsync(ct);
        return Ok(ApiResponse<List<ServiceAgreementDraftDto>>.Ok(drafts.Select(ToDto).ToList()));
    }

    /// <summary>
    /// Saves a new revision from support blocks (priced here by the pricing engine: the client sends no price and no catalogue code) or, for a caller that predates the builder,
    /// from hand-typed lines. Every reason a save is refused is in <c>errors</c>.
    /// </summary>
    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    [RequestSizeLimit(1_048_576)]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<ServiceAgreementDraftDto>>> Create(Guid participantId, CreateServiceAgreementDraftDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail("A tenant context is required."));
        var actor = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        var result = await _service.SaveAsync(tenantId, participantId, dto, actor, ct);
        if (result.Draft is null)
            return result.NotFound
                ? NotFound(ApiResponse<ServiceAgreementDraftDto>.Fail(result.Errors.First()))
                : BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail(result.Errors.ToList()));
        return Ok(ApiResponse<ServiceAgreementDraftDto>.Ok(ToDto(result.Draft)));
    }

    [HttpGet("{id:guid}/pdf")]
    public async Task<IActionResult> Pdf(Guid participantId, Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<object>.Fail("A tenant context is required."));
        var (pdf, error) = await _service.RenderPdfAsync(tenantId, participantId, id, ct);
        if (error != null) return NotFound(ApiResponse<object>.Fail(error));
        return File(pdf!, "application/pdf", $"service-agreement-draft-v{id}.pdf");
    }

    [HttpPost("signing-snapshots")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ElectronicSigningSnapshotDto>>> CreateSigningSnapshot(Guid participantId, CreateElectronicSigningSnapshotDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ElectronicSigningSnapshotDto>.Fail("A tenant context is required."));
        var (snapshot, error) = await _evidence.CreateSnapshotAsync(tenantId, participantId, dto, ct);
        if (error != null) return BadRequest(ApiResponse<ElectronicSigningSnapshotDto>.Fail(error));
        return Ok(ApiResponse<ElectronicSigningSnapshotDto>.Ok(new(snapshot!.Id, snapshot.DraftId, snapshot.DraftVersion, snapshot.DocumentJson, snapshot.DocumentHash, "PendingVerification")));
    }

    [HttpPost("signing-snapshots/{snapshotId:guid}/evidence")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ElectronicSigningEvidenceDto>>> SubmitSigningEvidence(Guid participantId, Guid snapshotId, SubmitElectronicSigningEvidenceDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ElectronicSigningEvidenceDto>.Fail("A tenant context is required."));
        var (evidence, error) = await _evidence.SubmitAsync(tenantId, participantId, snapshotId, dto, ct);
        if (error != null) return BadRequest(ApiResponse<ElectronicSigningEvidenceDto>.Fail(error));
        return Ok(ApiResponse<ElectronicSigningEvidenceDto>.Ok(new(evidence!.Id, evidence.Status, evidence.EvidenceHash, evidence.CreatedAt)));
    }

    [HttpPost("{id:guid}/signed-evidence")]
    public ActionResult<ApiResponse<object>> AttachSignedEvidence(Guid participantId, Guid id) => Conflict(ApiResponse<object>.Fail("Deprecated: use in-app evidence capture. Evidence remains pending verification and cannot approve scheduling."));

    [HttpPost("{id:guid}/demo-journey-simulation")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<DemoJourneySimulationDto>>> SimulateDemoJourney(Guid participantId, Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<DemoJourneySimulationDto>.Fail("A tenant context is required."));
        var actorEmail = User.FindFirstValue(ClaimTypes.Email) ?? string.Empty;
        // The simulation service independently confines this non-persistent path to the exact
        // Demo tenant, active Demo identity, draft participant, newest tenant-owned draft, and
        // provisional source. DEV_AUTH_ENABLED is the deliberate operator gate; requiring the
        // hosting environment to be Development would make the approved isolated Demo target
        // unusable when it correctly runs ASPNETCORE_ENVIRONMENT=Production.
        var devAuthEnabled = string.Equals(_configuration["DEV_AUTH_ENABLED"], "true", StringComparison.OrdinalIgnoreCase);
        var (result, error) = await _simulation.SimulateAsync(tenantId, participantId, id, actorEmail, devAuthEnabled, ct);
        if (error != null) return BadRequest(ApiResponse<DemoJourneySimulationDto>.Fail(error));
        return Ok(ApiResponse<DemoJourneySimulationDto>.Ok(result!));
    }

    private static ServiceAgreementDraftDto ToDto(ServiceAgreementDraft draft) => new()
    {
        Id = draft.Id, ParticipantId = draft.ParticipantId, Version = draft.Version, State = draft.State,
        Status = ProvisionalAgreementTemplate.State, TemplateVersion = ProvisionalAgreementTemplate.Version,
        TemplateDocxSha256 = ProvisionalAgreementTemplate.DocxSha256, TemplatePdfSha256 = ProvisionalAgreementTemplate.PdfSha256,
        PlanStartDate = draft.PlanStartDate, PlanEndDate = draft.PlanEndDate, Representative = draft.Representative,
        AgreementStartDate = draft.AgreementStartDate, AgreementEndDate = draft.AgreementEndDate,
        Blocks = draft.Blocks.OrderBy(x => x.Position).Select(DraftJson.ToDto).ToList(),
        Pricing = DraftJson.ReadQuote(draft.PricingJson),
        Lines = draft.Lines.OrderBy(x => x.Position).ThenBy(x => x.Id).Select(x => new ServiceAgreementDraftLineDto
        {
            ServiceType = x.ServiceType, Hours = x.Hours, ItemCode = x.ItemCode, UnitPrice = x.UnitPrice, CatalogueVersion = x.CatalogueVersion,
            CatalogueEffectiveFrom = x.CatalogueEffectiveFrom, CatalogueEffectiveTo = x.CatalogueEffectiveTo,
            BlockId = x.BlockKey, Band = x.Band, Unit = x.Unit, Occurrences = x.Occurrences, Flags = (PlannedLineFlags)x.Flags,
            Total = x.Total ?? Math.Floor(x.Hours * x.UnitPrice * 100m) / 100m,
        }).ToList()
    };
}
