using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Odip.Api.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// The agreement budget bar's check (budget phase 2b): what an agreement would cost against what the participant's real pools have left. It prices the agreement in process, so it is as heavy as a
/// plan quote and runs through the SAME resource filter as the quote (<see cref="PlanQuoteConcurrencyFilter"/>): the two share one organisation's two permits, so the bar never adds a third quote
/// at once. Money is on the answer, so (like the ledger beside it, whose route prefix it shares) it is admitted to SuperAdmin, Admin and Coordinator for every request. A SuperAdmin must have
/// chosen an organisation to view as. It is a question and writes nothing: a warning in every mode, never a block on a save or an approval.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/participants/{participantId:guid}/funding")]
public class AgreementCheckController : ControllerBase
{
    private readonly ICurrentTenant _tenant;
    private readonly AgreementCheckService _service;

    public AgreementCheckController(ICurrentTenant tenant, AgreementCheckService service)
    {
        _tenant = tenant;
        _service = service;
    }

    /// <summary>
    /// Prices the agreement and places it on the pools and funding periods of the participant's current plan. Send the draft's blocks with the agreement's first and last day, or the id of a saved
    /// draft. 200 with the answer (<c>hasBudget: false</c> when no plan is running now); 400 with every reason in <c>errors</c>; 404 when the participant or the draft is not found; 429 when the
    /// organisation already has its quotes in flight.
    /// </summary>
    [HttpPost("agreement-check")]
    [EnableRateLimiting("api")]
    [RequestSizeLimit(1_048_576)]
    [ServiceFilter(typeof(PlanQuoteConcurrencyFilter))]
    public async Task<ActionResult<ApiResponse<AgreementCheckDto>>> Check(Guid participantId, [FromBody] AgreementCheckRequestDto dto, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<AgreementCheckDto>.Fail(ParticipantFundingController.ChooseOrganisation));

        var result = await _service.CheckAsync(tenantId, participantId, dto, ct);
        if (result.Check is { } check) return Ok(ApiResponse<AgreementCheckDto>.Ok(check));
        if (result.NotFoundMessage is { } missing) return NotFound(ApiResponse<AgreementCheckDto>.Fail(missing));
        return BadRequest(ApiResponse<AgreementCheckDto>.Fail(result.Errors.ToList()));
    }
}
