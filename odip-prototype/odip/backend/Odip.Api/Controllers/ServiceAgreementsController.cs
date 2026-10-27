using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Odip.Api.Services;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>Agreement PR 2 (D9): the organisation's service agreements across participants. Every read names the caller's organisation: a SuperAdmin's context has no tenant filter, so a SuperAdmin chooses one (view-as).</summary>
[ApiController]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
[Route("api/v1/service-agreements")]
public class ServiceAgreementsController : ControllerBase
{
    // keep equal to CHUNK in the page's runInChunks.ts
    public const int MaxItems = 25;
    public const string FailedWords = "This one could not be approved. Try again.";

    private readonly OdipDbContext _db;
    private readonly ICurrentTenant _tenant;
    private readonly TimeProvider _clock;
    private readonly PlanPricingService _pricing;
    private readonly ServiceAgreementApprovalService _approval;
    private readonly ILogger<ServiceAgreementsController>? _logger;

    public ServiceAgreementsController(OdipDbContext db, ICurrentTenant tenant, TimeProvider? clock = null, ServiceAgreementApprovalService? approval = null, PlanPricingService? pricing = null, ILogger<ServiceAgreementsController>? logger = null)
    {
        _db = db;
        _tenant = tenant;
        _clock = clock ?? TimeProvider.System;
        _pricing = pricing ?? new PlanPricingService(db);
        _approval = approval ?? new ServiceAgreementApprovalService(db, new RosterPlacementGate(), pricing: _pricing);
        _logger = logger;
    }

    /// <summary>The agreements ending within 60 days, or ended with no successor approved, of the participants who can receive services (the aggregate alerts' rule), soonest end first: the Participants register's Agreements ending view.</summary>
    [HttpGet("ending")]
    public async Task<ActionResult<ApiResponse<List<AgreementEndingDto>>>> Ending(CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<List<AgreementEndingDto>>.Fail("A tenant context is required."));
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        var participants = await _db.Participants.AsNoTracking().Where(p => p.TenantId == tenantId).Where(Participant.CanReceiveServicesRule)
            .Select(p => new Participant { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, PreferredName = p.PreferredName })
            .ToDictionaryAsync(p => p.Id, ct);
        var rows = await AgreementEnding.FindAsync(_db, participants.Keys, today, ct);
        return Ok(ApiResponse<List<AgreementEndingDto>>.Ok(rows.Select(r => new AgreementEndingDto
        {
            ParticipantId = r.ParticipantId, ParticipantName = participants[r.ParticipantId].FullName, DraftId = r.DraftId, Version = r.Version,
            AgreementEndDate = r.AgreementEndDate, DaysLeft = r.DaysLeft, RenewalVersion = r.RenewalVersion, Status = AgreementEnding.Describe(r),
        }).ToList()));
    }

    /// <summary>One row per participant who can receive services and holds an agreement revision: the current (newest approved) and waiting (newer, unapproved) revisions, the ending state, and the price list with any newer one. Filtering is the page's.</summary>
    [HttpGet]
    public async Task<ActionResult<ApiResponse<AgreementListDto>>> List(CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<AgreementListDto>.Fail("A tenant context is required."));
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);
        var participants = await _db.Participants.AsNoTracking().Where(p => p.TenantId == tenantId).Where(Participant.CanReceiveServicesRule)
            .Where(p => _db.ServiceAgreementDrafts.Any(d => d.TenantId == tenantId && d.ParticipantId == p.Id))
            .Select(p => new Participant { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, PreferredName = p.PreferredName })
            .ToListAsync(ct);
        var ids = participants.Select(p => p.Id).ToList();
        var ending = (await AgreementEnding.FindAsync(_db, ids, today, ct)).ToDictionary(r => r.ParticipantId);
        var revisions = await AgreementRevisions.LatestAsync(_db, tenantId, ids, ct);
        var lists = await AgreementPriceLists.ListAsync(_db, ct);
        PriceListDto? Dto(string? version) => version is null ? null : new PriceListDto { Version = version, Start = lists.FirstOrDefault(l => l.Version == version)?.Start ?? default };

        var rows = new List<AgreementRowDto>();
        foreach (var p in participants.OrderBy(p => p.FullName, StringComparer.OrdinalIgnoreCase).ThenBy(p => p.Id))
        {
            if (!revisions.TryGetValue(p.Id, out var set)) continue;
            ending.TryGetValue(p.Id, out var end);
            var endingState = end is null ? "None" : end.DaysLeft < 0 ? "Ended" : "Ending";
            var status = set.Current is null ? "NotApproved" : set.Waiting is not null ? "DraftWaiting" : endingState == "Ended" ? "Ended" : endingState == "Ending" ? "Ending" : "Active";
            var newer = set.Current is null ? null : AgreementPriceLists.Newer(lists, set.CurrentList, set.Current.AgreementEndDate);
            rows.Add(new AgreementRowDto
            {
                ParticipantId = p.Id, ParticipantName = p.FullName, Status = status, EndingState = endingState, HasWaitingDraft = set.Waiting is not null,
                Current = set.Current, Waiting = set.Waiting, DaysLeft = end?.DaysLeft, TermStart = set.TermStart,
                PriceList = Dto(set.Current is null ? set.WaitingList : set.CurrentList),
                NewerPriceList = newer is null ? null : new PriceListDto { Version = newer.Version, Start = newer.Start },
            });
        }
        var canApprove = await ServiceAgreementApprovalService.MayApproveAsync(_pricing, tenantId, Caller(), ct);
        return Ok(ApiResponse<AgreementListDto>.Ok(new AgreementListDto { CanApprove = canApprove, Rows = rows }));
    }

    /// <summary>Every catalogue price list with its start, newest first.</summary>
    [HttpGet("price-lists")]
    public async Task<ActionResult<ApiResponse<List<PriceListDto>>>> PriceLists(CancellationToken ct)
    {
        if (_tenant.TenantId is null) return BadRequest(ApiResponse<List<PriceListDto>>.Fail("A tenant context is required."));
        var lists = await AgreementPriceLists.ListAsync(_db, ct);
        return Ok(ApiResponse<List<PriceListDto>>.Ok(lists.Select(l => new PriceListDto { Version = l.Version, Start = l.Start }).ToList()));
    }

    /// <summary>
    /// Approves up to <see cref="MaxItems"/> revisions in series, each through the approval service with every check and overlaps NOT acknowledged. One answer per item, in the order sent; a refusal never stops
    /// the rest. The page sends larger selections in chunks (the proxies keep their 60 s default).
    /// </summary>
    [HttpPost("approve-batch")]
    [RequestSizeLimit(8_192)]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<List<AgreementApproveResultDto>>>> ApproveBatch(AgreementApproveBatchDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not Guid tenantId) return BadRequest(ApiResponse<List<AgreementApproveResultDto>>.Fail("A tenant context is required."));
        var items = (dto?.Items ?? []).DistinctBy(i => i.DraftId).ToList();
        if (items.Count is 0 or > MaxItems) return BadRequest(ApiResponse<List<AgreementApproveResultDto>>.Fail($"Select between 1 and {MaxItems} agreements."));
        var caller = Caller();
        if (!await ServiceAgreementApprovalService.MayApproveAsync(_pricing, tenantId, caller, ct))
            return StatusCode(StatusCodes.Status403Forbidden, ApiResponse<List<AgreementApproveResultDto>>.Fail(NotAnApproverWords));

        var participantIds = items.Select(i => i.ParticipantId).Distinct().ToList();
        var names = await _db.Participants.AsNoTracking().Where(p => p.TenantId == tenantId && participantIds.Contains(p.Id))
            .Select(p => new Participant { Id = p.Id, FirstName = p.FirstName, LastName = p.LastName, PreferredName = p.PreferredName })
            .ToDictionaryAsync(p => p.Id, p => p.FullName, ct);
        var today = await ProviderTimeZoneResolver.TodayAsync(_db, tenantId, _clock, ct);

        var results = new List<AgreementApproveResultDto>();
        foreach (var item in items)
        {
            string outcome; List<string> reasons = [];
            try
            {
                var found = await _db.ServiceAgreementDrafts.AsNoTracking().Where(d => d.TenantId == tenantId && d.Id == item.DraftId && d.ParticipantId == item.ParticipantId)
                    .Select(d => new { d.AgreementEndDate, Approved = _db.ServiceAgreementDraftApprovals.Any(a => a.DraftId == d.Id) }).FirstOrDefaultAsync(ct);
                if (found is { Approved: false } && found.AgreementEndDate < today) outcome = "Ended";
                else (outcome, reasons) = MapOutcome(await _approval.ApproveAsync(tenantId, item.ParticipantId, item.DraftId, acknowledgeOverlaps: false, caller, ct));
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger?.LogError(ex, "Approving agreement draft {DraftId} in a batch failed", item.DraftId);
                (outcome, reasons) = ("Failed", [FailedWords]);
            }
            finally
            {
                // A failed save can leave a tracked entity that would poison the next item's SaveChanges.
                _db.ChangeTracker.Clear();
            }
            results.Add(new AgreementApproveResultDto { ParticipantId = item.ParticipantId, DraftId = item.DraftId, ParticipantName = names.GetValueOrDefault(item.ParticipantId, ""), Outcome = outcome, Reasons = reasons });
        }
        return Ok(ApiResponse<List<AgreementApproveResultDto>>.Ok(results));
    }

    private const string NotAnApproverWords = "Your role cannot approve agreements in your organisation. An Admin can change who may in Settings, Plan pricing.";

    /// <summary>The approval's answer as the batch reports it. A refusal for an agreement that ended (a race past midnight) is Ended; any other refusal needs review, in the approval's words.</summary>
    public static (string Outcome, List<string> Reasons) MapOutcome(ApprovalOutcome o) => o.Status switch
    {
        ApprovalStatus.Approved => ("Approved", []),
        ApprovalStatus.AlreadyApproved => ("AlreadyApproved", []),
        ApprovalStatus.Refused when o.ReasonCodes?.Contains("AgreementEnded") == true => ("Ended", o.Errors?.ToList() ?? []),
        ApprovalStatus.Refused => ("NeedsReview", o.Errors?.ToList() ?? []),
        ApprovalStatus.Superseded => ("Superseded", []),
        ApprovalStatus.Busy => ("Busy", []),
        ApprovalStatus.NotFound => ("NotFound", []),
        ApprovalStatus.NotAnApprover => ("NotAnApprover", []),
        _ => ("Failed", [FailedWords]),
    };

    private ApprovalCaller Caller() => new(
        Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) ? userId : null,
        User.FindFirstValue("fullName") ?? User.FindFirstValue(ClaimTypes.Name) ?? "Unknown",
        User.FindAll(ClaimTypes.Role).Select(claim => claim.Value).ToList());
}
