using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Odip.Api.RateLimiting;
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
    private readonly PlanQuoteConcurrencyLimiter? _saveLimiter;
    public const string SaveBusyMessage = "Another plan is already being saved for your organisation. Try again in a moment.";
    public ServiceAgreementDraftsController(OdipDbContext db, ICurrentTenant tenant, ServiceAgreementDraftService service, ElectronicSigningEvidenceService? evidence = null, DemoJourneySimulationService? simulation = null, IConfiguration? configuration = null, PlanQuoteConcurrencyLimiter? saveLimiter = null)
    {
        _saveLimiter = saveLimiter;
        _db = db; _tenant = tenant; _service = service; _evidence = evidence ?? new ElectronicSigningEvidenceService(db);
        _simulation = simulation ?? new DemoJourneySimulationService(db);
        _configuration = configuration ?? new ConfigurationBuilder().Build();
    }

    [HttpGet]
    public async Task<ActionResult<ApiResponse<List<ServiceAgreementDraftDto>>>> List(Guid participantId, CancellationToken ct)
    {
        // The newest revision in full (a plan is started from it) and the older ones as summaries: every save adds a revision of tens of kilobytes (blocks, answer, lines), so a long onboarding
        // made a multi-megabyte response on every page load. GET {id} has an older revision's details. The two collections of the newest are loaded as separate queries, not a cross product.
        var newest = await _db.ServiceAgreementDrafts.AsNoTracking().Include(x => x.Lines).Include(x => x.Blocks).AsSplitQuery()
            .Where(x => x.ParticipantId == participantId).OrderByDescending(x => x.Version).FirstOrDefaultAsync(ct);
        if (newest is null) return Ok(ApiResponse<List<ServiceAgreementDraftDto>>.Ok([]));

        // The older ones: their lines (for what they add up to) but no blocks and no stored answer in the response; the block counts come from one grouped query.
        var older = await _db.ServiceAgreementDrafts.AsNoTracking().Include(x => x.Lines)
            .Where(x => x.ParticipantId == participantId && x.Version < newest.Version).OrderByDescending(x => x.Version).ToListAsync(ct);
        var olderIds = older.Select(x => x.Id).ToList();
        var blockCounts = olderIds.Count == 0 ? new Dictionary<Guid, int>()
            : await _db.ServiceAgreementDraftBlocks.AsNoTracking().Where(x => olderIds.Contains(x.DraftId)).GroupBy(x => x.DraftId).Select(g => new { Id = g.Key, Count = g.Count() }).ToDictionaryAsync(x => x.Id, x => x.Count, ct);

        var listed = new List<ServiceAgreementDraftDto> { ToDto(newest) };
        listed.AddRange(older.Select(x => ToSummary(x, blockCounts.GetValueOrDefault(x.Id))));
        return Ok(ApiResponse<List<ServiceAgreementDraftDto>>.Ok(listed));
    }

    /// <summary>One revision in full: how an older one's blocks, lines and answer are read (the list leaves them out). Not found for another participant's or another tenant's.</summary>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ApiResponse<ServiceAgreementDraftDto>>> Get(Guid participantId, Guid id, CancellationToken ct)
    {
        var draft = await _db.ServiceAgreementDrafts.AsNoTracking().Include(x => x.Lines).Include(x => x.Blocks).AsSplitQuery()
            .FirstOrDefaultAsync(x => x.Id == id && x.ParticipantId == participantId, ct);
        return draft is null ? NotFound(ApiResponse<ServiceAgreementDraftDto>.Fail("Draft not found.")) : Ok(ApiResponse<ServiceAgreementDraftDto>.Ok(ToDto(draft)));
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

        // Saving blocks prices them: the same heavy work as a quote, which the quote holds to a few at a time for each organisation. A save holds one of the organisation's SAVE permits,
        // a partition of its own, so a save is never refused because the screen's own quotes are running and a burst of saves cannot keep every core busy. Hand-typed lines are not heavy.
        using var lease = _saveLimiter is not null && dto.Blocks is { Count: > 0 } ? _saveLimiter.TryEnter("save:tenant:" + tenantId.ToString("N")) : null;
        if (lease is { IsAcquired: false })
        {
            Response.Headers.RetryAfter = "1";
            return StatusCode(StatusCodes.Status429TooManyRequests, ApiResponse<ServiceAgreementDraftDto>.Fail(SaveBusyMessage));
        }

        var result = await _service.SaveAsync(tenantId, participantId, dto, actor, ct);
        if (result.Draft is null)
        {
            if (result.ConflictVersion is int newest)
                return Conflict(new ApiResponse<DraftVersionConflictDto> { Success = false, Data = new DraftVersionConflictDto { CurrentVersion = newest }, Errors = result.Errors.ToList(), Code = "draft-version-conflict" });
            return result.NotFound
                ? NotFound(ApiResponse<ServiceAgreementDraftDto>.Fail(result.Errors.First()))
                : BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail(result.Errors.ToList()));
        }
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

    /// <summary>What a line adds up to: the engine's total for a line it generated, hours times unit price floored to the cent for one typed by hand.</summary>
    private static decimal LineTotal(ServiceAgreementDraftLine x) => x.Total ?? Math.Floor(x.Hours * x.UnitPrice * 100m) / 100m;

    /// <summary>The revision without its blocks, lines and answer: who, when, which template, and what it came to.</summary>
    private static ServiceAgreementDraftDto Header(ServiceAgreementDraft draft, int blockCount) => new()
    {
        Id = draft.Id, ParticipantId = draft.ParticipantId, Version = draft.Version, State = draft.State,
        Status = ProvisionalAgreementTemplate.State, TemplateVersion = ProvisionalAgreementTemplate.Version,
        TemplateDocxSha256 = ProvisionalAgreementTemplate.DocxSha256, TemplatePdfSha256 = ProvisionalAgreementTemplate.PdfSha256,
        PlanStartDate = draft.PlanStartDate, PlanEndDate = draft.PlanEndDate, Representative = draft.Representative,
        AgreementStartDate = draft.AgreementStartDate, AgreementEndDate = draft.AgreementEndDate,
        BlockCount = blockCount, LineCount = draft.Lines.Count, Total = draft.Lines.Sum(LineTotal), Caveats = DraftPricingCaveats.For(draft).ToList(),
    };

    private static ServiceAgreementDraftDto ToSummary(ServiceAgreementDraft draft, int blockCount) => Header(draft, blockCount) with { IsSummary = true };

    private static ServiceAgreementDraftDto ToDto(ServiceAgreementDraft draft) => Header(draft, draft.Blocks.Count) with
    {
        Blocks = draft.Blocks.OrderBy(x => x.Position).Select(DraftJson.ToDto).ToList(),
        Pricing = DraftJson.ReadQuote(draft.PricingJson),
        Lines = draft.Lines.OrderBy(x => x.Position).ThenBy(x => x.Id).Select(x => new ServiceAgreementDraftLineDto
        {
            ServiceType = x.ServiceType, Hours = x.Hours, ItemCode = x.ItemCode, UnitPrice = x.UnitPrice, CatalogueVersion = x.CatalogueVersion,
            CatalogueEffectiveFrom = x.CatalogueEffectiveFrom, CatalogueEffectiveTo = x.CatalogueEffectiveTo,
            BlockId = x.BlockKey, Band = x.Band, Unit = x.Unit, Occurrences = x.Occurrences, Flags = (PlannedLineFlags)x.Flags,
            Total = LineTotal(x),
        }).ToList(),
    };
}
