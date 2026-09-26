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
    public ServiceAgreementDraftsController(OdipDbContext db, ICurrentTenant tenant, ServiceAgreementDraftService service) => (_db, _tenant, _service) = (db, tenant, service);

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
    public ActionResult<ApiResponse<object>> Pdf(Guid participantId, Guid id) => Conflict(ApiResponse<object>.Fail("PDF generation is unavailable until an owner-approved legal template is configured. Drafts are not agreements and cannot be signed."));

    [HttpPost("{id:guid}/signed-evidence")]
    public ActionResult<ApiResponse<object>> AttachSignedEvidence(Guid participantId, Guid id) => Conflict(ApiResponse<object>.Fail("Signed-evidence storage is not configured. A draft cannot be marked signed by this API."));

    private static ServiceAgreementDraftDto ToDto(ServiceAgreementDraft draft) => new()
    {
        Id = draft.Id, ParticipantId = draft.ParticipantId, Version = draft.Version, State = draft.State,
        AgreementStartDate = draft.AgreementStartDate, AgreementEndDate = draft.AgreementEndDate,
        Lines = draft.Lines.Select(x => new ServiceAgreementDraftLineDto { ServiceType = x.ServiceType, Hours = x.Hours, ItemCode = x.ItemCode, UnitPrice = x.UnitPrice, CatalogueVersion = x.CatalogueVersion, CatalogueEffectiveFrom = x.CatalogueEffectiveFrom, CatalogueEffectiveTo = x.CatalogueEffectiveTo }).ToList()
    };
}
