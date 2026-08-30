using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

/// <summary>
/// Computed participant risk alerts (task 6c) — coordinator/admin-facing only, never surfaced to
/// the portal (support workers already see participant flags there; see
/// <see cref="PortalController"/>). Nothing here is persisted; see
/// <see cref="ParticipantAlertsService"/> for the rule logic.
/// </summary>
[ApiController]
[Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
[Route("api/v1/participants")]
public class ParticipantAlertsController : ControllerBase
{
    private readonly ParticipantAlertsService _alertsService;
    private readonly OdipDbContext _db;

    public ParticipantAlertsController(ParticipantAlertsService alertsService, OdipDbContext db)
    {
        _alertsService = alertsService;
        _db = db;
    }

    /// <summary>
    /// Aggregate alerts across every participant visible to the current tenant — used by the
    /// participants table badge column and the dashboard's Critical-alerts card, so both can avoid
    /// N+1 per-participant requests. <c>activeOnly: true</c> (fix round 1, review finding) — an
    /// archived participant's stale data (e.g. a <c>PlanEndDate</c> from before they left) would
    /// otherwise generate a permanent, undismissable alert on every aggregate consumer.
    /// </summary>
    [HttpGet("alerts")]
    public async Task<ActionResult<ApiResponse<List<ParticipantAlertsDto>>>> GetAggregate(CancellationToken ct)
    {
        var result = await _alertsService.GetAlertsAsync(participantId: null, activeOnly: true, ct);
        return Ok(ApiResponse<List<ParticipantAlertsDto>>.Ok(result));
    }

    /// <summary>
    /// Alerts for a single participant — feeds the alert banner on the detail header.
    /// <c>activeOnly: false</c> (default) is intentional here — a coordinator viewing an archived
    /// participant's own detail page still wants to see their alerts; only the aggregate excludes
    /// inactive participants.
    /// </summary>
    [HttpGet("{participantId:guid}/alerts")]
    public async Task<ActionResult<ApiResponse<ParticipantAlertsDto>>> GetForParticipant(Guid participantId, CancellationToken ct)
    {
        var exists = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!exists) return NotFound(ApiResponse<ParticipantAlertsDto>.Fail("Participant not found"));

        var result = await _alertsService.GetAlertsAsync(participantId, activeOnly: false, ct);
        return Ok(ApiResponse<ParticipantAlertsDto>.Ok(result.Single()));
    }
}
