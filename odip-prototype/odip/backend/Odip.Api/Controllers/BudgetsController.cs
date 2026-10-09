using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// The Budgets list (budget phase 2b): where the dashboard's "Budgets at risk" tile goes. Every active participant's pools for the funding period running now, sorted by risk, from the ledger's
/// own figures. It is money, so (like the participant's ledger it is made of) it is admitted to SuperAdmin, Admin and Coordinator for every request: SupportWorker and ReadOnly never see a dollar
/// figure. A SuperAdmin must have chosen an organisation to view as: a budget belongs to one organisation.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/funding/budgets")]
public class BudgetsController : ControllerBase
{
    private readonly ICurrentTenant _tenant;
    private readonly BudgetListService _service;

    public BudgetsController(ICurrentTenant tenant, BudgetListService service)
    {
        _tenant = tenant;
        _service = service;
    }

    public const string ChooseOrganisation = "Choose an organisation to view as before listing budgets: budgets belong to one organisation.";

    /// <summary>The rows, sorted by risk, and the NDIS-funded participants who have no budget in force.</summary>
    [HttpGet]
    [EnableRateLimiting("api")]
    public async Task<ActionResult<ApiResponse<BudgetListDto>>> List(CancellationToken ct)
    {
        if (_tenant.TenantId is not { } tenantId) return BadRequest(ApiResponse<BudgetListDto>.Fail(ChooseOrganisation));

        return Ok(ApiResponse<BudgetListDto>.Ok(await _service.GetAsync(tenantId, ct)));
    }
}
