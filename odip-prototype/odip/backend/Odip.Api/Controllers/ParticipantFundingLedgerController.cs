using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
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
    private readonly NdiaRejectionReader? _ndia;

    /// <param name="ndia">Reads the NDIA's "funds ran out" word for the pools (phase 2b). Left out, the pools carry no note.</param>
    public ParticipantFundingLedgerController(ICurrentTenant tenant, BudgetLedgerService ledger, NdiaRejectionReader? ndia = null)
    {
        _tenant = tenant;
        _ledger = ledger;
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

    /// <summary>One more page of the rows of one period of one pool, for "show more" once the first <see cref="BudgetLedgerService.RowsPerPeriod"/> are on screen.</summary>
    [EnableRateLimiting("api")]
    [HttpGet("ledger/rows")]
    public async Task<ActionResult<ApiResponse<LedgerRowsPageDto>>> Rows(
        Guid participantId, [FromQuery] Guid poolId, [FromQuery] Guid periodId, CancellationToken ct, [FromQuery] int skip = 0, [FromQuery] int take = BudgetLedgerService.RowsPerPeriod)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<LedgerRowsPageDto>.Fail(ParticipantFundingController.ChooseOrganisation));

        var page = await _ledger.GetRowsAsync(tenantId, participantId, poolId, periodId, skip, take, ct);
        return page is null
            ? NotFound(ApiResponse<LedgerRowsPageDto>.Fail("That period was not found in the participant's current plan."))
            : Ok(ApiResponse<LedgerRowsPageDto>.Ok(page));
    }
}
