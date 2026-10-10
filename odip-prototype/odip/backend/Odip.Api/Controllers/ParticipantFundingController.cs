using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// A participant's NDIS plan budget (budget feature, phase 1): the plans, their pools and release periods, and the one-off helpers around them. Money is
/// on these endpoints and nowhere else, so the controller is admitted to SuperAdmin, Admin and Coordinator for every request, reads included: SupportWorker
/// and ReadOnly never see a dollar figure (the participant DTO and the patch groups carry none, on purpose: a patch group is atomic and would wipe a figure a stale
/// client did not know about). A SuperAdmin must have chosen an organisation to view as: a budget belongs to one organisation. The service re-checks that the participant
/// belongs to the tenant, so another organisation's participant or plan is "not found".
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/participants/{participantId:guid}/funding")]
public class ParticipantFundingController : ControllerBase
{
    private readonly ICurrentTenant _tenant;
    private readonly FundingPlanService _service;

    public ParticipantFundingController(ICurrentTenant tenant, FundingPlanService service)
    {
        _tenant = tenant;
        _service = service;
    }

    public const string ChooseOrganisation = "Choose an organisation to view as before recording a plan budget: budgets belong to one organisation.";

    /// <summary>The code of the 409 for a save made from an out-of-date copy of the plan.</summary>
    public const string RevisionConflictCode = "funding-revision-conflict";
    /// <summary>The code of the 409 for a plan whose dates overlap another plan of the participant.</summary>
    public const string PlanOverlapCode = "funding-plan-overlap";

    private string Actor() => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "unknown";

    /// <summary>Every plan of the participant, newest first, with its pools and periods, and the plan dates the profile carries.</summary>
    [HttpGet("plans")]
    public async Task<ActionResult<ApiResponse<FundingPlansDto>>> Plans(Guid participantId, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<FundingPlansDto>.Fail(ChooseOrganisation));

        var plans = await _service.ListAsync(tenantId, participantId, ct);
        return plans is null
            ? NotFound(ApiResponse<FundingPlansDto>.Fail(FundingPlanService.ParticipantNotFound))
            : Ok(ApiResponse<FundingPlansDto>.Ok(plans));
    }

    /// <summary>Creates one plan with all its pools and periods. 201 with the plan; 400 with every reason in <c>errors</c>; 409 when its dates overlap another plan of the participant.</summary>
    [HttpPost("plans")]
    [EnableRateLimiting("api")]
    [RequestSizeLimit(262_144)]
    public async Task<ActionResult<ApiResponse<FundingPlanDto>>> CreatePlan(Guid participantId, [FromBody] SaveFundingPlanDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<FundingPlanDto>.Fail(ChooseOrganisation));

        var result = await _service.CreateAsync(tenantId, participantId, dto, Actor(), ct);
        return result.Plan is { } plan
            ? CreatedAtAction(nameof(Plans), new { participantId }, ApiResponse<FundingPlanDto>.Ok(plan))
            : Refusal(result);
    }

    /// <summary>
    /// Replaces the plan's fields, pools and periods. The body carries the <c>revision</c> it was made from: a mismatch is a 409 with the current revision. 400 with
    /// every reason in <c>errors</c>; 409 when the new dates overlap another plan of the participant.
    /// </summary>
    [HttpPut("plans/{planId:guid}")]
    [EnableRateLimiting("api")]
    [RequestSizeLimit(262_144)]
    public async Task<ActionResult<ApiResponse<FundingPlanDto>>> UpdatePlan(Guid participantId, Guid planId, [FromBody] SaveFundingPlanDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<FundingPlanDto>.Fail(ChooseOrganisation));

        var result = await _service.UpdateAsync(tenantId, participantId, planId, dto, Actor(), ct);
        return result.Plan is { } plan ? Ok(ApiResponse<FundingPlanDto>.Ok(plan)) : Refusal(result);
    }

    /// <summary>Deletes a plan with its pools and periods (audited). Admin and SuperAdmin only: a Coordinator records and corrects budgets but does not remove a plan's history.</summary>
    [HttpDelete("plans/{planId:guid}")]
    [Authorize(Roles = "SuperAdmin,Admin")]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<object>>> DeletePlan(Guid participantId, Guid planId, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<object>.Fail(ChooseOrganisation));

        return await _service.DeleteAsync(tenantId, participantId, planId, ct)
            ? Ok(ApiResponse<object>.Ok(new { deleted = true }))
            : NotFound(ApiResponse<object>.Fail(FundingPlanService.PlanNotFound));
    }

    /// <summary>Sets the participant's profile plan start and end to this plan's. Explicit, never automatic, and audited like any change to the participant.</summary>
    [HttpPost("plans/{planId:guid}/apply-dates-to-profile")]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<ApplyPlanDatesResultDto>>> ApplyDatesToProfile(Guid participantId, Guid planId, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<ApplyPlanDatesResultDto>.Fail(ChooseOrganisation));

        var result = await _service.ApplyDatesToProfileAsync(tenantId, participantId, planId, ct);
        return result is null
            ? NotFound(ApiResponse<ApplyPlanDatesResultDto>.Fail(FundingPlanService.PlanNotFound))
            : Ok(ApiResponse<ApplyPlanDatesResultDto>.Ok(result));
    }

    /// <summary>The answer to a save that did not produce a plan: 404, 409 (stale revision, or an overlap naming the other plan), or 400 with every reason.</summary>
    private ActionResult<ApiResponse<FundingPlanDto>> Refusal(FundingSaveResult result)
    {
        if (result.NotFound) return NotFound(ApiResponse<FundingPlanDto>.Fail(result.NotFoundMessage ?? FundingPlanService.PlanNotFound));

        if (result.CurrentRevision is { } revision)
            return Conflict(new ApiResponse<FundingRevisionConflictDto>
            {
                Success = false, Data = new FundingRevisionConflictDto { CurrentRevision = revision }, Errors = result.Errors.ToList(), Code = RevisionConflictCode,
            });

        if (result.Overlap is { } overlap)
            return Conflict(new ApiResponse<FundingPlanOverlapDto>
            {
                Success = false, Data = overlap, Errors = result.Errors.ToList(), Code = PlanOverlapCode,
            });

        return BadRequest(ApiResponse<FundingPlanDto>.Fail(result.Errors.ToList()));
    }
}
