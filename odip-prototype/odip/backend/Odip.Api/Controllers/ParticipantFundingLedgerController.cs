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
/// A participant's budget ledger (budget feature, phase 2a): what the current plan has been spent on, is waiting to be spent on and is booked to be spent on, for each pool and funding
/// period. A sibling of <see cref="ParticipantFundingController"/> with the same route prefix and the same rule: money is on these endpoints and nowhere else, so every request is admitted
/// to SuperAdmin, Admin and Coordinator, reads included, and SupportWorker and ReadOnly never see a dollar figure. A SuperAdmin must have chosen an organisation to view as. The service reads the
/// participant inside the tenant first, so another organisation's participant is "not found" and none of its claims, shifts or bookings can reach the answer.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/participants/{participantId:guid}/funding")]
public class ParticipantFundingLedgerController : ControllerBase
{
    private readonly ICurrentTenant _tenant;
    private readonly BudgetLedgerService _ledger;
    private readonly BudgetSeriesService _series;
    private readonly PlanQuoteConcurrencyLimiter _limiter;
    private readonly NdiaRejectionReader? _ndia;

    /// <param name="limiter">The plan builder's pricing permits: the budget graph prices the agreement on a cache miss, so it shares the organisation's permits.</param>
    /// <param name="ndia">Reads the NDIA's "funds ran out" word for the pools (phase 2b). Left out, the pools carry no note.</param>
    public ParticipantFundingLedgerController(ICurrentTenant tenant, BudgetLedgerService ledger, BudgetSeriesService series, PlanQuoteConcurrencyLimiter limiter, NdiaRejectionReader? ndia = null)
    {
        _tenant = tenant;
        _ledger = ledger;
        _series = series;
        _limiter = limiter;
        _ndia = ndia;
    }

    /// <summary>
    /// The ledger of the participant's current plan (the one whose dates include the provider's today; with none, the latest plan that has started): for each pool and period its limit, what is
    /// carried in, what is available, claimed, pending, booked ahead, the forecast and the status, the plan's total line for the pool, the first rows of each period, and the rows that are in no
    /// pool or outside the plan. With no plan that has started it answers 200 with no plan and no pools.
    /// </summary>
    [EnableRateLimiting("api")]
    [HttpGet("ledger")]
    public async Task<ActionResult<ApiResponse<ParticipantLedgerDto>>> Ledger(Guid participantId, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<ParticipantLedgerDto>.Fail(ParticipantFundingController.ChooseOrganisation));

        var ledger = await _ledger.GetLedgerAsync(tenantId, participantId, ct);
        if (ledger is null) return NotFound(ApiResponse<ParticipantLedgerDto>.Fail(FundingPlanService.ParticipantNotFound));

        // The NDIA's word on a pool (phase 2b) is read beside the ledger and put on the pool it is about; the ledger's own figures are untouched.
        if (_ndia is not null && ledger.PlanId is not null)
        {
            var notes = await _ndia.ForParticipantAsync(tenantId, participantId, ct);
            if (notes.Count > 0)
                ledger = ledger with
                {
                    Pools = ledger.Pools.Select(pool => notes.TryGetValue(pool.Id, out var note)
                        ? pool with { NdiaRejection = new NdiaRejectionDto { Date = note.Date, Code = note.Code, ClaimId = note.ClaimId, ClaimReference = note.ClaimReference } }
                        : pool).ToList(),
                };
        }

        return Ok(ApiResponse<ParticipantLedgerDto>.Ok(ledger));
    }

    /// <summary>
    /// The budget graph of the participant's current plan: weekly cumulative points for the whole plan and each pool (budget spread evenly, used, used and booked, and what the approved
    /// agreement expects). Read beside the ledger, from the same items. When the organisation's pricing permits are all taken the expected line is "unavailable" and the rest still answers.
    /// </summary>
    [EnableRateLimiting("api")]
    [HttpGet("ledger/series")]
    public async Task<ActionResult<ApiResponse<BudgetSeriesDto>>> Series(Guid participantId, CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<BudgetSeriesDto>.Fail(ParticipantFundingController.ChooseOrganisation));

        var series = await _series.GetAsync(tenantId, participantId, EnterPricing, ct);
        if (series is null) return NotFound(ApiResponse<BudgetSeriesDto>.Fail(FundingPlanService.ParticipantNotFound));
        return Ok(ApiResponse<BudgetSeriesDto>.Ok(series));
    }

    /// <summary>One of the organisation's pricing permits, keyed as the plan quote keys them; null when none is free.</summary>
    private IDisposable? EnterPricing()
    {
        var lease = _limiter.TryEnter(PlanQuoteConcurrencyFilter.KeyOf(HttpContext, _tenant));
        if (lease.IsAcquired) return lease;
        lease.Dispose();
        return null;
    }
}
