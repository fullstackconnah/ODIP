using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing;
using Odip.Domain.Entities;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Billing API: funding sources. The billable-event, service-booking and claim-batch routes were retired
/// with their tables; the funding sources stay because the plan editor's "start from billing" hint reads them.
/// Mirrors <see cref="ClaimsController"/>'s authorisation posture — billing is finance-sensitive,
/// so every endpoint (reads included) is gated to SuperAdmin/Admin/Coordinator.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/billing")]
public class BillingController : ControllerBase
{
    private readonly OdipDbContext _db;

    public BillingController(OdipDbContext db)
    {
        _db = db;
    }

    // ══════════════════════════════════════════════════════════════
    // FUNDING SOURCES
    // ══════════════════════════════════════════════════════════════

    /// <summary>List funding sources, optionally filtered by participant and route type.</summary>
    [HttpGet("funding-sources")]
    public async Task<ActionResult<ApiResponse<PagedResult<FundingSourceDto>>>> GetFundingSources(
        [FromQuery] Guid? participantId, [FromQuery] FundingRouteType? routeType,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);

        var query = _db.FundingSources.AsQueryable();
        if (participantId.HasValue) query = query.Where(f => f.ParticipantId == participantId.Value);
        if (routeType.HasValue) query = query.Where(f => f.RouteType == routeType.Value);

        var projected = query.OrderBy(f => f.ParticipantId).Select(f => new FundingSourceDto
        {
            Id = f.Id, ParticipantId = f.ParticipantId,
            ParticipantName = f.Participant == null ? null :
                string.IsNullOrEmpty(f.Participant.PreferredName)
                    ? f.Participant.FirstName + " " + f.Participant.LastName
                    : f.Participant.PreferredName + " " + f.Participant.LastName,
            RouteType = f.RouteType, BudgetCategory = f.BudgetCategory, NdisPlanNumber = f.NdisPlanNumber,
            PlanStartDate = f.PlanStartDate, PlanEndDate = f.PlanEndDate, Budget = f.Budget,
            PayerName = f.PayerName, PayerEmail = f.PayerEmail, IsActive = f.IsActive
        });

        var result = await PagedResult<FundingSourceDto>.CreateAsync(projected, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<FundingSourceDto>>.Ok(result));
    }

    /// <summary>Create a funding source for a participant.</summary>
    [HttpPost("funding-sources")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<FundingSourceDto>>> CreateFundingSource(
        [FromBody] CreateFundingSourceDto dto, CancellationToken ct)
    {
        // INTAKE-08: claims/billing surfaces exclude drafts — a draft can't have a funding source.
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == dto.ParticipantId && !p.IsDraft, ct);
        if (participant == null)
            return BadRequest(ApiResponse<FundingSourceDto>.Fail("Participant not found"));

        var fs = new FundingSource
        {
            Id = Guid.NewGuid(), ParticipantId = dto.ParticipantId, RouteType = dto.RouteType,
            BudgetCategory = dto.BudgetCategory, NdisPlanNumber = dto.NdisPlanNumber,
            PlanStartDate = dto.PlanStartDate, PlanEndDate = dto.PlanEndDate, Budget = dto.Budget,
            PayerName = dto.PayerName, PayerEmail = dto.PayerEmail, IsActive = dto.IsActive
        };
        _db.FundingSources.Add(fs);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<FundingSourceDto>.Ok(ToFundingSourceDto(fs, FullName(participant))));
    }

    /// <summary>Update an existing funding source.</summary>
    [HttpPut("funding-sources/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<FundingSourceDto>>> UpdateFundingSource(
        Guid id, [FromBody] UpdateFundingSourceDto dto, CancellationToken ct)
    {
        var fs = await _db.FundingSources.Include(f => f.Participant).FirstOrDefaultAsync(f => f.Id == id, ct);
        if (fs == null) return NotFound(ApiResponse<FundingSourceDto>.Fail("Funding source not found"));

        fs.ParticipantId = dto.ParticipantId; fs.RouteType = dto.RouteType;
        fs.BudgetCategory = dto.BudgetCategory; fs.NdisPlanNumber = dto.NdisPlanNumber;
        fs.PlanStartDate = dto.PlanStartDate; fs.PlanEndDate = dto.PlanEndDate; fs.Budget = dto.Budget;
        fs.PayerName = dto.PayerName; fs.PayerEmail = dto.PayerEmail; fs.IsActive = dto.IsActive;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<FundingSourceDto>.Ok(ToFundingSourceDto(fs, fs.Participant != null ? FullName(fs.Participant) : null)));
    }

    private static string FullName(Participant p) =>
        string.IsNullOrWhiteSpace(p.PreferredName) ? $"{p.FirstName} {p.LastName}" : $"{p.PreferredName} {p.LastName}";

    private static FundingSourceDto ToFundingSourceDto(FundingSource fs, string? participantName) => new()
    {
        Id = fs.Id, ParticipantId = fs.ParticipantId, ParticipantName = participantName, RouteType = fs.RouteType,
        BudgetCategory = fs.BudgetCategory, NdisPlanNumber = fs.NdisPlanNumber, PlanStartDate = fs.PlanStartDate,
        PlanEndDate = fs.PlanEndDate, Budget = fs.Budget, PayerName = fs.PayerName, PayerEmail = fs.PayerEmail,
        IsActive = fs.IsActive
    };
}
