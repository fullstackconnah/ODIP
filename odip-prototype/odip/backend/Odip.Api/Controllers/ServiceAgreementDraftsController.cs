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
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
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
    private readonly ServiceAgreementApprovalService _approval;
    private readonly AgreementPatternChangeService _patternChange;
    private readonly AgreementRenewalService _renewal;
    private readonly AgreementShareService _share;
    public const string SaveBusyMessage = "Another plan is already being saved for your organisation. Try again in a moment.";
    public ServiceAgreementDraftsController(OdipDbContext db, ICurrentTenant tenant, ServiceAgreementDraftService service, ElectronicSigningEvidenceService? evidence = null, DemoJourneySimulationService? simulation = null, IConfiguration? configuration = null, PlanQuoteConcurrencyLimiter? saveLimiter = null, ServiceAgreementApprovalService? approval = null, AgreementPatternChangeService? patternChange = null, AgreementRenewalService? renewal = null, AgreementShareService? share = null)
    {
        _saveLimiter = saveLimiter;
        _approval = approval ?? new ServiceAgreementApprovalService(db, new Odip.Api.Services.RosterPlacementGate());
        _patternChange = patternChange ?? new AgreementPatternChangeService(db, service);
        _renewal = renewal ?? new AgreementRenewalService(db, service);
        _db = db; _tenant = tenant; _service = service; _evidence = evidence ?? new ElectronicSigningEvidenceService(db);
        _simulation = simulation ?? new DemoJourneySimulationService(db);
        _configuration = configuration ?? new ConfigurationBuilder().Build();
        _share = share ?? new AgreementShareService(db, service, new Odip.Infrastructure.Notifications.IntakeInviteSender([], Microsoft.Extensions.Logging.Abstractions.NullLogger<Odip.Infrastructure.Notifications.IntakeInviteSender>.Instance), _configuration);
    }

    // Every GET here returns money (unit prices, totals, the pricing answer, the PDF's figures), and money is never visible to SupportWorker or ReadOnly: Claims and Billing refuse them for every
    // request, reads included. So the reads are admitted to the same roles as the writes (ServiceAgreementDraftsControllerRoleTests holds every GET to it).
    [HttpGet]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
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

        // Who approved which revision, for all of the participant's revisions at once: a row for each approved one, and there are few of those.
        var approvals = await _db.ServiceAgreementDraftApprovals.AsNoTracking().Where(x => x.ParticipantId == participantId).ToDictionaryAsync(x => x.DraftId, ct);

        var listed = new List<ServiceAgreementDraftDto> { ToDto(newest) with { Approval = ApprovalOf(approvals.GetValueOrDefault(newest.Id)) } };
        listed.AddRange(older.Select(x => ToSummary(x, blockCounts.GetValueOrDefault(x.Id)) with { Approval = ApprovalOf(approvals.GetValueOrDefault(x.Id)) }));
        return Ok(ApiResponse<List<ServiceAgreementDraftDto>>.Ok(listed));
    }

    /// <summary>One revision in full: how an older one's blocks, lines and answer are read (the list leaves them out). Not found for another participant's or another tenant's.</summary>
    [HttpGet("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ServiceAgreementDraftDto>>> Get(Guid participantId, Guid id, CancellationToken ct)
    {
        var draft = await _db.ServiceAgreementDrafts.AsNoTracking().Include(x => x.Lines).Include(x => x.Blocks).AsSplitQuery()
            .FirstOrDefaultAsync(x => x.Id == id && x.ParticipantId == participantId, ct);
        if (draft is null) return NotFound(ApiResponse<ServiceAgreementDraftDto>.Fail("Draft not found."));
        var approval = await _db.ServiceAgreementDraftApprovals.AsNoTracking().FirstOrDefaultAsync(x => x.DraftId == id, ct);
        return Ok(ApiResponse<ServiceAgreementDraftDto>.Ok(ToDto(draft) with { Approval = ApprovalOf(approval) }));
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

    /// <summary>
    /// What approving this revision for rostering would do, with nothing done: whether it can be approved, every reason it cannot (in words, with the block each is about), the patterns it would make
    /// and end, the open shifts it would generate and up to when, the old revision's shifts that would stay on the roster, and the hand-made patterns that overlap. For the same roles as the
    /// approval, and only for a role the organisation lets approve (Admin and Coordinator until its settings say otherwise).
    /// </summary>
    [HttpGet("{id:guid}/approval-preview")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<DraftApprovalPreviewDto>>> ApprovalPreview(Guid participantId, Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<DraftApprovalPreviewDto>.Fail("A tenant context is required."));
        var outcome = await _approval.PreviewAsync(tenantId, participantId, id, Caller(), ct);
        return outcome.Status switch
        {
            ApprovalStatus.NotFound => NotFound(ApiResponse<DraftApprovalPreviewDto>.Fail("Draft not found.")),
            ApprovalStatus.NotAnApprover => StatusCode(StatusCodes.Status403Forbidden, ApiResponse<DraftApprovalPreviewDto>.Fail(outcome.Errors!.First())),
            _ => Ok(ApiResponse<DraftApprovalPreviewDto>.Ok(outcome.Preview!)),
        };
    }

    /// <summary>
    /// Approves the NEWEST revision for rostering (phase D), in one transaction: records who and when, makes the weekly roster patterns of its blocks, ends the patterns of the revision before it the
    /// day before this one starts, and generates the open shifts of the weeks already started on the roster when the participant may be rostered. The revision before's unfilled Draft shifts from this one's start are removed in the same transaction; the rest are listed (<c>oldShiftsRemaining</c>) and left for a coordinator. 200 with
    /// the revision (its <c>approval</c> and <c>oldShiftsRemaining</c>); 400 with every reason in <c>errors</c>; 403 for a role that may not approve; 409 when a newer revision exists
    /// (<c>draft-superseded</c>) or another change to the participant's roster was still running (<c>roster-busy</c>; nothing was changed, try again). Approving an approved revision again is a 200 with
    /// the existing approval and writes nothing.
    /// </summary>
    [HttpPost("{id:guid}/approve")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    [RequestSizeLimit(4_096)]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<ServiceAgreementDraftDto>>> Approve(Guid participantId, Guid id, ApproveDraftDto? dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail("A tenant context is required."));
        var outcome = await _approval.ApproveAsync(tenantId, participantId, id, dto?.AcknowledgeOverlaps ?? false, Caller(), ct,
            dto is null || (dto.AgreedByPersonId is null && dto.AgreedByName is null && dto.AgreedHow is null) ? null : new ServiceAgreementApprovalService.ApprovalAgreed(dto.AgreedByPersonId, dto.AgreedByName, dto.AgreedHow));
        switch (outcome.Status)
        {
            case ApprovalStatus.NotFound:
                return NotFound(ApiResponse<ServiceAgreementDraftDto>.Fail("Draft not found."));
            case ApprovalStatus.NotAnApprover:
                return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<ServiceAgreementDraftDto>.Fail(outcome.Errors!.First()));
            case ApprovalStatus.Superseded:
                return Conflict(new ApiResponse<DraftVersionConflictDto> { Success = false, Data = new DraftVersionConflictDto { CurrentVersion = outcome.NewestVersion ?? 0 }, Errors = outcome.Errors!.ToList(), Code = "draft-superseded" });
            case ApprovalStatus.Refused:
                return BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail(outcome.Errors!.ToList()));
            case ApprovalStatus.Busy:
                return Conflict(new ApiResponse<ServiceAgreementDraftDto> { Success = false, Errors = outcome.Errors!.ToList(), Code = "roster-busy" });
            default:
                // Its own step after the approval committed: it can never undo or fail the approval. Approving again moves nobody.
                var activation = outcome.Status == ApprovalStatus.Approved ? await ActivateAsync(tenantId, participantId, ct) : null;
                return Ok(ApiResponse<ServiceAgreementDraftDto>.Ok(ToDto(outcome.Draft!) with { Approval = ApprovalOf(outcome.Approval), OldShiftsRemaining = outcome.OldShifts, Activation = activation }));
        }
    }

    /// <summary>
    /// What Populate roster would do (S11), with nothing done: one row for each week already started on the roster from today, with the shifts it would add and the ones already there, and where those
    /// would take a pool past its funding. <c>note</c> says why it cannot be done at all (not approved, a newer revision, the participant is not active, the agreement ended). 404 for a revision that is
    /// not the caller's. The rostering write roles, not the organisation's approver rule.
    /// </summary>
    [HttpGet("{id:guid}/populate-preview")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<PopulatePreviewDto>>> PopulatePreview(Guid participantId, Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<PopulatePreviewDto>.Fail("A tenant context is required."));
        var preview = await _approval.PopulatePreviewAsync(tenantId, participantId, id, ct);
        return preview is null ? NotFound(ApiResponse<PopulatePreviewDto>.Fail("Draft not found.")) : Ok(ApiResponse<PopulatePreviewDto>.Ok(preview));
    }

    /// <summary>
    /// Populate roster (S11): adds the approved revision's open shifts to the weeks already started on the roster, from today, just <c>weekStart</c>'s week when given. Safe to repeat: shifts already
    /// there, cancelled ones included, are skipped. 200 with what was added; 400 for a week that is not started; 404 for a revision that is not the caller's; 409 when it cannot be done (not approved,
    /// a newer revision is approved, the participant is not active, the agreement ended) or another change to the roster was still running (<c>roster-busy</c>; nothing was changed, try again).
    /// </summary>
    [HttpPost("{id:guid}/populate")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    [RequestSizeLimit(4_096)]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<PopulateResultDto>>> Populate(Guid participantId, Guid id, PopulateDraftDto? dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<PopulateResultDto>.Fail("A tenant context is required."));
        var outcome = await _approval.PopulateAsync(tenantId, participantId, id, dto?.WeekStart, ct);
        return outcome.Status switch
        {
            ServiceAgreementApprovalService.PopulateStatus.NotFound => NotFound(ApiResponse<PopulateResultDto>.Fail(outcome.Error!)),
            ServiceAgreementApprovalService.PopulateStatus.BadWeek => BadRequest(ApiResponse<PopulateResultDto>.Fail(outcome.Error!)),
            ServiceAgreementApprovalService.PopulateStatus.Refused => Conflict(new ApiResponse<PopulateResultDto> { Success = false, Errors = [outcome.Error!], Code = "populate-refused" }),
            ServiceAgreementApprovalService.PopulateStatus.Busy => Conflict(new ApiResponse<PopulateResultDto> { Success = false, Errors = [outcome.Error!], Code = "roster-busy" }),
            _ => Ok(ApiResponse<PopulateResultDto>.Ok(outcome.Result!)),
        };
    }

    /// <summary>
    /// Deletes the newest unapproved revision (D7). 404 for a revision that is not the caller's; 409 when it is approved, has roster patterns or has signing records (they stay in the history).
    /// </summary>
    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<IActionResult> Delete(Guid participantId, Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<object>.Fail("A tenant context is required."));
        var outcome = await _service.DeleteAsync(tenantId, participantId, id, Caller(), ct);
        return outcome.Status switch
        {
            DraftDeleteStatus.NotFound => NotFound(ApiResponse<object>.Fail("Draft not found.")),
            DraftDeleteStatus.Refused => Conflict(ApiResponse<object>.Fail(outcome.Error!)),
            _ => NoContent(),
        };
    }

    /// <summary>
    /// Ends an approved agreement on <c>lastDay</c> (D6): its end date moves up, its roster patterns stop there and its unfilled Draft shifts after it go; the rest are kept and listed. 404 not the
    /// caller's, 400 a last day outside the agreement, 409 for a revision that cannot be ended (not approved, replaced, a newer one waiting, worked shifts) or a busy roster (<c>roster-busy</c>).
    /// </summary>
    [HttpPost("{id:guid}/end-early")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ServiceAgreementDraftDto>>> EndEarly(Guid participantId, Guid id, EndAgreementEarlyDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail("A tenant context is required."));
        var outcome = await _approval.EndEarlyAsync(tenantId, participantId, id, dto.LastDay, Caller(), ct);
        return outcome.Status switch
        {
            EndEarlyStatus.NotFound => NotFound(ApiResponse<ServiceAgreementDraftDto>.Fail("Draft not found.")),
            EndEarlyStatus.BadDate => BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail(outcome.Error!)),
            EndEarlyStatus.Refused => Conflict(ApiResponse<ServiceAgreementDraftDto>.Fail(outcome.Error!)),
            EndEarlyStatus.Busy => Conflict(new ApiResponse<ServiceAgreementDraftDto> { Success = false, Errors = [outcome.Error!], Code = "roster-busy" }),
            _ => Ok(ApiResponse<ServiceAgreementDraftDto>.Ok(ToDto(outcome.Draft!) with { Approval = ApprovalOf(outcome.Approval), OldShiftsRemaining = outcome.OldShifts })),
        };
    }

    private Task<ApprovalActivationDto> ActivateAsync(Guid tenantId, Guid participantId, CancellationToken ct)
    {
        // The interceptor writes the participant's one audit row; the reason rides on it (as ParticipantsController does).
        if (HttpContext != null) HttpContext.Items[AuditInterceptor.ReasonItemKey(participantId)] = ServiceAgreementApprovalService.ActivationAuditReason;
        return _approval.ActivateAfterApprovalAsync(tenantId, participantId, ct);
    }

    /// <summary>
    /// A change to the day, times, ratio or night type of a roster pattern that revision <c>{id}</c>'s approval made, saved as the agreement's next revision, re-priced, for approval (agreement PR 1). The
    /// pattern and the roster do not change until that revision is approved. With <c>preview</c> nothing is saved and the answer is what would be. 200 with the revision's number and dates and what its
    /// period costs before and after; 400 with every reason in <c>errors</c>; 404 for a revision or pattern that is not the caller's; 409 <c>draft-version-conflict</c> when a newer revision exists.
    /// </summary>
    [HttpPost("{id:guid}/pattern-change")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    [RequestSizeLimit(4_096)]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<PatternChangeResultDto>>> PatternChange(Guid participantId, Guid id, AgreementPatternChangeDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<PatternChangeResultDto>.Fail("A tenant context is required."));
        var actor = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";

        // A change is priced twice (before and after), preview or not: it holds one of the organisation's save permits, as Create does.
        using var lease = _saveLimiter is not null ? _saveLimiter.TryEnter("save:tenant:" + tenantId.ToString("N")) : null;
        if (lease is { IsAcquired: false })
        {
            Response.Headers.RetryAfter = "1";
            return StatusCode(StatusCodes.Status429TooManyRequests, ApiResponse<PatternChangeResultDto>.Fail(SaveBusyMessage));
        }

        var outcome = await _patternChange.ChangeAsync(tenantId, participantId, id, dto, actor, ct);
        if (outcome.Result is { } result) return Ok(ApiResponse<PatternChangeResultDto>.Ok(result));
        if (outcome.ConflictVersion is int newest)
            return Conflict(new ApiResponse<DraftVersionConflictDto> { Success = false, Data = new DraftVersionConflictDto { CurrentVersion = newest }, Errors = outcome.Errors.ToList(), Code = "draft-version-conflict" });
        return outcome.NotFound
            ? NotFound(ApiResponse<PatternChangeResultDto>.Fail(outcome.Errors.First()))
            : BadRequest(ApiResponse<PatternChangeResultDto>.Fail(outcome.Errors.ToList()));
    }

    /// <summary>
    /// Renew agreement (agreement PR 2): revision <c>{id}</c>, the newest approved, copied as the agreement's next revision from the day after it ends, for its term's length within the participant's
    /// plan covering that day, and priced now. A Draft, approved as any other. 200 with the revision; 400 with every reason in <c>errors</c>; 403 for a role that may not approve; 404 for a revision
    /// that is not the caller's; 409 <c>draft-version-conflict</c> when a newer revision waits, or <c>plan-needed</c> when no plan of the participant's covers that first day.
    /// </summary>
    [HttpPost("{id:guid}/renew")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    [RequestSizeLimit(4_096)]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<ServiceAgreementDraftDto>>> Renew(Guid participantId, Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail("A tenant context is required."));
        var actor = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";

        // A renewal prices a whole term, as a save does: it holds one of the organisation's save permits.
        using var lease = _saveLimiter is not null ? _saveLimiter.TryEnter("save:tenant:" + tenantId.ToString("N")) : null;
        if (lease is { IsAcquired: false })
        {
            Response.Headers.RetryAfter = "1";
            return StatusCode(StatusCodes.Status429TooManyRequests, ApiResponse<ServiceAgreementDraftDto>.Fail(SaveBusyMessage));
        }

        var outcome = await _renewal.RenewAsync(tenantId, participantId, id, Caller(), actor, ct);
        if (outcome.Draft is { } draft) return Ok(ApiResponse<ServiceAgreementDraftDto>.Ok(ToDto(draft)));
        if (outcome.NotAnApprover) return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<ServiceAgreementDraftDto>.Fail(outcome.Errors.First()));
        if (outcome.NotFound) return NotFound(ApiResponse<ServiceAgreementDraftDto>.Fail(outcome.Errors.First()));
        if (outcome.ConflictVersion is int newest)
            return Conflict(new ApiResponse<DraftVersionConflictDto> { Success = false, Data = new DraftVersionConflictDto { CurrentVersion = newest }, Errors = outcome.Errors.ToList(), Code = "draft-version-conflict" });
        if (outcome.PlanNeeded) return Conflict(new ApiResponse<ServiceAgreementDraftDto> { Success = false, Errors = outcome.Errors.ToList(), Code = "plan-needed" });
        return BadRequest(ApiResponse<ServiceAgreementDraftDto>.Fail(outcome.Errors.ToList()));
    }

    [HttpGet("{id:guid}/pdf")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<IActionResult> Pdf(Guid participantId, Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<object>.Fail("A tenant context is required."));
        var (pdf, error) = await _service.RenderPdfAsync(tenantId, participantId, id, ct);
        if (error != null) return NotFound(ApiResponse<object>.Fail(error));
        return File(pdf!.Content, "application/pdf", pdf.FileName);
    }

    /// <summary>
    /// Who the agreement can be sent to and what has been sent (newest first, at most 20): never a link or its hash. A send that did not go carries its error and is never shown as sent.
    /// The same roles as every read here (it holds contacts' emails and the figures of a plan).
    /// </summary>
    [HttpGet("{id:guid}/sharing")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<AgreementSharingDto>>> Sharing(Guid participantId, Guid id, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<AgreementSharingDto>.Fail("A tenant context is required."));
        if (!await _db.ServiceAgreementDrafts.AnyAsync(x => x.Id == id && x.ParticipantId == participantId && x.TenantId == tenantId, ct))
            return NotFound(ApiResponse<AgreementSharingDto>.Fail("Draft not found."));
        return Ok(ApiResponse<AgreementSharingDto>.Ok(await _share.SharingAsync(tenantId, participantId, id, ct)));
    }

    /// <summary>
    /// Emails the revision to a contact as a link. 200 <c>{ sent, error }</c> (error NotConfigured or Failed when it did not go; the row is kept and older links stay live);
    /// 400 for a person who is not a contact or has no usable email; 403 for a role the organisation does not let approve; 404; 409 for a stale version, a revision that is approved,
    /// replaced or ended, or an organisation with no contact email or phone.
    /// </summary>
    [HttpPost("{id:guid}/send")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    [RequestSizeLimit(4_096)]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<SendAgreementResultDto>>> Send(Guid participantId, Guid id, SendAgreementDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<SendAgreementResultDto>.Fail("A tenant context is required."));
        var outcome = await _share.SendAsync(tenantId, participantId, id, dto, Caller(), ct);
        return outcome.Status switch
        {
            AgreementSendStatus.NotFound => NotFound(ApiResponse<SendAgreementResultDto>.Fail("Draft not found.")),
            AgreementSendStatus.NotAnApprover => StatusCode(StatusCodes.Status403Forbidden, ApiResponse<SendAgreementResultDto>.Fail(outcome.Message!)),
            AgreementSendStatus.Stale or AgreementSendStatus.NotSendable or AgreementSendStatus.NoOrganisationContact => Conflict(ApiResponse<SendAgreementResultDto>.Fail(outcome.Message!)),
            AgreementSendStatus.BadRecipient => BadRequest(ApiResponse<SendAgreementResultDto>.Fail(outcome.Message!)),
            _ => Ok(ApiResponse<SendAgreementResultDto>.Ok(new SendAgreementResultDto { Sent = outcome.Error is null, Error = outcome.Error })),
        };
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

    /// <summary>The caller as the approval records and checks them: the user id, the name shown, and the roles.</summary>
    private ApprovalCaller Caller() => new(
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ? userId : null,
        User.FindFirstValue("fullName") ?? User.FindFirstValue(ClaimTypes.Name) ?? "Unknown",
        User.FindAll(ClaimTypes.Role).Select(claim => claim.Value).ToList());

    /// <summary>
    /// The approval as the screen reads it. <c>ApprovedAt</c> is an instant: the API writes it as UTC with a Z (UtcInstantDateTimeConverter), whatever kind the column hands back.
    /// </summary>
    private DraftApprovalDto? ApprovalOf(ServiceAgreementDraftApproval? approval) => approval is null ? null : new()
    {
        ApprovedAt = approval.ApprovedAt, ApprovedByName = approval.ApprovedByName,
        PatternsCreated = approval.PatternsCreated, PatternsEnded = approval.PatternsEnded, ShiftsCreated = approval.ShiftsCreated,
        HorizonEnd = approval.HorizonEnd, FirstShiftDate = approval.FirstShiftDate,
        AgreedByName = approval.AgreedByName, AgreedHow = approval.AgreedHow,
    };

    /// <summary>The revision without its blocks, lines and answer: who, when, which template, and what it came to.</summary>
    private static ServiceAgreementDraftDto Header(ServiceAgreementDraft draft, int blockCount) => new()
    {
        Id = draft.Id, ParticipantId = draft.ParticipantId, Version = draft.Version, State = draft.State,
        Status = ProvisionalAgreementTemplate.State, TemplateVersion = ProvisionalAgreementTemplate.Version,
        TemplateDocxSha256 = ProvisionalAgreementTemplate.DocxSha256, TemplatePdfSha256 = ProvisionalAgreementTemplate.PdfSha256,
        PlanStartDate = draft.PlanStartDate, PlanEndDate = draft.PlanEndDate, Representative = draft.Representative,
        AgreementStartDate = draft.AgreementStartDate, AgreementEndDate = draft.AgreementEndDate, OriginalAgreementEndDate = draft.OriginalAgreementEndDate, IsOngoing = draft.IsOngoing,
        BlockCount = blockCount, LineCount = draft.Lines.Count, Total = draft.Lines.Sum(l => AgreementPriceLists.LineTotal(l)), PriceList = AgreementPriceLists.VersionOf(draft.Lines.Select(l => (l.CatalogueVersion, l.CatalogueEffectiveFrom))), Caveats = DraftPricingCaveats.For(draft).ToList(),
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
            Total = AgreementPriceLists.LineTotal(x),
        }).ToList(),
    };
}
