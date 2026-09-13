using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Services;

namespace Odip.Api.Controllers;

[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1")]
public class ClaimsController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly ClaimGenerationService _generator;
    private readonly BprCsvService _bprService;
    private readonly InvoiceService _invoiceService;

    public ClaimsController(OdipDbContext db, ClaimGenerationService generator,
        BprCsvService bprService, InvoiceService invoiceService)
    {
        _db = db;
        _generator = generator;
        _bprService = bprService;
        _invoiceService = invoiceService;
    }

    // POST /api/v1/trips/{tripId}/claims/preview
    [HttpPost("trips/{tripId:guid}/claims/preview")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ClaimPreviewResponseDto>>> PreviewClaim(
        Guid tripId, [FromBody] ClaimPreviewRequestDto dto, CancellationToken ct)
    {
        try
        {
            var preview = await _generator.PreviewClaimAsync(tripId, dto, ct);
            return Ok(ApiResponse<ClaimPreviewResponseDto>.Ok(preview));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<ClaimPreviewResponseDto>.Fail(ex.Message));
        }
    }

    // POST /api/v1/trips/{tripId}/claims
    [HttpPost("trips/{tripId:guid}/claims")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<TripClaimListDto>>> GenerateClaim(
        Guid tripId, [FromBody] GenerateClaimRequestDto? dto, CancellationToken ct)
    {
        try
        {
            var claim = await _generator.GenerateDraftClaimAsync(tripId, dto, ct);
            var tripName = await _db.TripInstances.Where(t => t.Id == tripId).Select(t => t.TripName).FirstOrDefaultAsync(ct);
            return Ok(ApiResponse<TripClaimListDto>.Ok(new TripClaimListDto
            {
                Id = claim.Id, TripInstanceId = claim.TripInstanceId, TripName = tripName ?? string.Empty,
                Status = claim.Status, ClaimReference = claim.ClaimReference,
                TotalAmount = claim.TotalAmount, CreatedAt = claim.CreatedAt, SubmittedDate = claim.SubmittedDate
            }));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<TripClaimListDto>.Fail(ex.Message));
        }
    }

    // GET /api/v1/trips/{tripId}/claims
    [HttpGet("trips/{tripId:guid}/claims")]
    public async Task<ActionResult<ApiResponse<List<TripClaimListDto>>>> GetClaimsForTrip(Guid tripId, CancellationToken ct)
    {
        var items = await _db.TripClaims
            .Include(c => c.TripInstance)
            .Where(c => c.TripInstanceId == tripId)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new TripClaimListDto
            {
                Id = c.Id, TripInstanceId = c.TripInstanceId, TripName = c.TripInstance.TripName,
                Status = c.Status, ClaimReference = c.ClaimReference,
                TotalAmount = c.TotalAmount, CreatedAt = c.CreatedAt, SubmittedDate = c.SubmittedDate
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<TripClaimListDto>>.Ok(items));
    }

    // GET /api/v1/claims/{claimId}
    [HttpGet("claims/{claimId:guid}")]
    public async Task<ActionResult<ApiResponse<TripClaimDetailDto>>> GetClaim(Guid claimId, CancellationToken ct)
    {
        var c = await _db.TripClaims
            .Include(x => x.TripInstance)
            .Include(x => x.AuthorisedByUser)
            .Include(x => x.LineItems)
                .ThenInclude(l => l.ParticipantBooking)
                    .ThenInclude(b => b.Participant)
            .FirstOrDefaultAsync(x => x.Id == claimId, ct);

        if (c == null) return NotFound(ApiResponse<TripClaimDetailDto>.Fail("Claim not found"));

        return Ok(ApiResponse<TripClaimDetailDto>.Ok(new TripClaimDetailDto
        {
            Id = c.Id, TripInstanceId = c.TripInstanceId, TripName = c.TripInstance?.TripName ?? string.Empty,
            Status = c.Status, ClaimReference = c.ClaimReference,
            TotalAmount = c.TotalAmount, TotalApprovedAmount = c.TotalApprovedAmount,
            CreatedAt = c.CreatedAt, SubmittedDate = c.SubmittedDate, PaidDate = c.PaidDate,
            AuthorisedByStaffId = c.AuthorisedByUserId,
            AuthorisedByStaffName = c.AuthorisedByUser != null ? $"{c.AuthorisedByUser.FirstName} {c.AuthorisedByUser.LastName}" : null,
            Notes = c.Notes,
            LineItems = c.LineItems.Select(l => new ClaimLineItemDto
            {
                Id = l.Id, TripClaimId = l.TripClaimId, ParticipantBookingId = l.ParticipantBookingId,
                ParticipantId = l.ParticipantBooking.ParticipantId,
                ParticipantName = l.ParticipantBooking.Participant?.FullName ?? string.Empty,
                NdisNumber = l.ParticipantBooking.Participant?.NdisNumber ?? string.Empty,
                PlanType = l.ParticipantBooking.PlanTypeOverride ?? l.ParticipantBooking.Participant!.PlanType,
                SupportItemCode = l.SupportItemCode, DayType = l.DayType,
                SupportsDeliveredFrom = l.SupportsDeliveredFrom, SupportsDeliveredTo = l.SupportsDeliveredTo,
                Hours = l.Hours, UnitPrice = l.UnitPrice, TotalAmount = l.TotalAmount,
                GSTCode = l.GSTCode, ClaimType = l.ClaimType, ParticipantApproved = l.ParticipantApproved,
                Status = l.Status, RejectionReason = l.RejectionReason, PaidAmount = l.PaidAmount
            }).ToList()
        }));
    }

    // PUT /api/v1/claims/{claimId}
    [HttpPut("claims/{claimId:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> UpdateClaim(Guid claimId, [FromBody] UpdateClaimDto dto, CancellationToken ct)
    {
        var c = await _db.TripClaims.FirstOrDefaultAsync(x => x.Id == claimId, ct);
        if (c == null) return NotFound(ApiResponse<bool>.Fail("Claim not found"));

        if (dto.AuthorisedByStaffId.HasValue) c.AuthorisedByUserId = dto.AuthorisedByStaffId;
        if (dto.Notes != null) c.Notes = dto.Notes;
        if (dto.Status.HasValue)
        {
            c.Status = dto.Status.Value;
            if (dto.Status.Value == TripClaimStatus.Submitted) c.SubmittedDate = DateTime.UtcNow;
            if (dto.Status.Value == TripClaimStatus.Paid) c.PaidDate = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    // PATCH /api/v1/claims/{claimId}/line-items/{id}
    [HttpPatch("claims/{claimId:guid}/line-items/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> UpdateLineItem(Guid claimId, Guid id, [FromBody] UpdateClaimLineItemDto dto, CancellationToken ct)
    {
        var item = await _db.ClaimLineItems
            .Include(l => l.TripClaim)
            .FirstOrDefaultAsync(x => x.Id == id && x.TripClaimId == claimId, ct);
        if (item == null) return NotFound(ApiResponse<bool>.Fail("Line item not found"));

        if (dto.Hours.HasValue) { item.Hours = dto.Hours.Value; item.TotalAmount = item.Hours * item.UnitPrice; }
        if (dto.UnitPrice.HasValue) { item.UnitPrice = dto.UnitPrice.Value; item.TotalAmount = item.Hours * item.UnitPrice; }
        if (dto.SupportItemCode != null) item.SupportItemCode = dto.SupportItemCode;
        if (dto.ClaimType.HasValue)
        {
            item.ClaimType = dto.ClaimType.Value;
            if (dto.ClaimType.Value != ClaimType.Cancellation)
                item.CancellationReason = null;
        }
        if (dto.CancellationReason != null && item.ClaimType == ClaimType.Cancellation)
            item.CancellationReason = dto.CancellationReason;
        if (dto.ParticipantApproved.HasValue) item.ParticipantApproved = dto.ParticipantApproved.Value;
        if (dto.Status.HasValue)
        {
            item.Status = dto.Status.Value;
            if (dto.Status.Value == ClaimLineItemStatus.Paid) item.PaidAmount = dto.PaidAmount ?? item.TotalAmount;
            if (dto.Status.Value == ClaimLineItemStatus.Rejected) item.RejectionReason = dto.RejectionReason;
        }

        // Recalculate claim total — fetch all OTHER items from DB, then add this item's updated amount
        var otherItems = await _db.ClaimLineItems
            .Where(l => l.TripClaimId == claimId && l.Id != id)
            .ToListAsync(ct);
        item.TripClaim.TotalAmount = otherItems.Sum(l => l.TotalAmount) + item.TotalAmount;

        // Auto-update claim status based on line item statuses
        var statuses = otherItems.Select(l => l.Status).Append(item.Status).ToList();
        if (statuses.All(s => s == ClaimLineItemStatus.Paid))
            item.TripClaim.Status = TripClaimStatus.Paid;
        else if (statuses.All(s => s == ClaimLineItemStatus.Rejected))
            item.TripClaim.Status = TripClaimStatus.Rejected;
        // NOTE: TripClaimStatus.PartiallyPaid exists (value 4) but partial auto-promotion is omitted intentionally

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    // DELETE /api/v1/claims/{claimId}
    [HttpDelete("claims/{claimId:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteClaim(Guid claimId, CancellationToken ct)
    {
        var claim = await _db.TripClaims
            .Include(c => c.LineItems)
            .FirstOrDefaultAsync(x => x.Id == claimId, ct);

        if (claim == null) return NotFound(ApiResponse<bool>.Fail("Claim not found"));

        if (claim.Status == TripClaimStatus.Submitted || claim.Status == TripClaimStatus.Paid)
            return BadRequest(ApiResponse<bool>.Fail("Cannot delete a claim that has been submitted or paid."));

        // Reset participant bookings back to unclaimed
        var bookingIds = claim.LineItems.Select(l => l.ParticipantBookingId).Distinct().ToList();
        var bookings = await _db.ParticipantBookings
            .Where(b => bookingIds.Contains(b.Id))
            .ToListAsync(ct);
        foreach (var booking in bookings)
            booking.ClaimStatus = ClaimStatus.NotClaimed;

        _db.ClaimLineItems.RemoveRange(claim.LineItems);
        _db.TripClaims.Remove(claim);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<bool>.Ok(true));
    }

    // GET /api/v1/claims/{claimId}/bpr-csv
    [HttpGet("claims/{claimId:guid}/bpr-csv")]
    public async Task<IActionResult> DownloadBprCsv(Guid claimId, CancellationToken ct)
    {
        try
        {
            var (bytes, fileName) = await _bprService.GenerateBprCsvAsync(claimId, ct);
            return File(bytes, "text/csv", fileName);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<bool>.Fail(ex.Message));
        }
    }

    // GET /api/v1/claims/{claimId}/invoices/{bookingId}
    [HttpGet("claims/{claimId:guid}/invoices/{bookingId:guid}")]
    public async Task<IActionResult> DownloadInvoice(Guid claimId, Guid bookingId, CancellationToken ct)
    {
        try
        {
            var (bytes, fileName) = await _invoiceService.GenerateInvoiceAsync(claimId, bookingId, ct);
            return File(bytes, "application/pdf", fileName);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<bool>.Fail(ex.Message));
        }
    }
}
