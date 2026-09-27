using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
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
        var drafts = await _db.ServiceAgreementDrafts.Include(x => x.Lines).Where(x => x.ParticipantId == participantId).OrderByDescending(x => x.Version).ToListAsync(ct);
        return Ok(ApiResponse<List<ServiceAgreementDraftDto>>.Ok(drafts.Select(ToDto).ToList()));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ServiceAgreementDraftDto>>> Create(Guid participantId, CreateServiceAgreementDraftDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail("A tenant context is required."));
        var actor = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";
        var (draft, error) = await _service.CreateAsync(tenantId, participantId, dto, actor, ct);
        if (error != null) return error == "Participant not found." ? NotFound(ApiResponse<ServiceAgreementDraftDto>.Fail(error)) : BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail(error));
        return Ok(ApiResponse<ServiceAgreementDraftDto>.Ok(ToDto(draft!)));
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
    public async Task<ActionResult<ApiResponse<ElectronicSigningSnapshotDto>>> CreateSigningSnapshot(Guid participantId, CreateElectronicSigningSnapshotDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ElectronicSigningSnapshotDto>.Fail("A tenant context is required."));
        var (snapshot, error) = await _evidence.CreateSnapshotAsync(tenantId, participantId, dto, ct);
        if (error != null) return BadRequest(ApiResponse<ElectronicSigningSnapshotDto>.Fail(error));
        return Ok(ApiResponse<ElectronicSigningSnapshotDto>.Ok(new(snapshot!.Id, snapshot.DraftId, snapshot.DraftVersion, snapshot.DocumentJson, snapshot.DocumentHash, "PendingVerification")));
    }

    [HttpPost("signing-snapshots/{snapshotId:guid}/evidence")]
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
        AgreementStartDate = draft.AgreementStartDate, AgreementEndDate = draft.AgreementEndDate,
        Lines = draft.Lines.Select(x => new ServiceAgreementDraftLineDto { ServiceType = x.ServiceType, Hours = x.Hours, ItemCode = x.ItemCode, UnitPrice = x.UnitPrice, CatalogueVersion = x.CatalogueVersion, CatalogueEffectiveFrom = x.CatalogueEffectiveFrom, CatalogueEffectiveTo = x.CatalogueEffectiveTo }).ToList()
    };
}
