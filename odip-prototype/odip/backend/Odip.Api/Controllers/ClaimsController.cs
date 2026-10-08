using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
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
    private readonly ShiftClaimGenerationService _shiftGenerator;
    private readonly BprCsvService _bprService;
    private readonly InvoiceService _invoiceService;
    private readonly BudgetLedgerService _ledger;
    private readonly ICurrentTenant _tenant;
    private readonly TimeProvider _clock;

    public ClaimsController(OdipDbContext db, ClaimGenerationService generator,
        ShiftClaimGenerationService shiftGenerator, BprCsvService bprService, InvoiceService invoiceService,
        BudgetLedgerService ledger, ICurrentTenant tenant, TimeProvider? clock = null)
    {
        _ledger = ledger;
        _tenant = tenant;
        _clock = clock ?? TimeProvider.System;
        _db = db;
        _generator = generator;
        _shiftGenerator = shiftGenerator;
        _bprService = bprService;
        _invoiceService = invoiceService;
    }

    // POST /api/v1/trips/{tripId}/claims/preview
    [HttpPost("trips/{tripId:guid}/claims/preview")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ClaimPreviewResponseDto>>> PreviewClaim(
        Guid tripId, [FromBody] ClaimPreviewRequestDto dto, CancellationToken ct)
    {
        // No tenant guard here on purpose. The preview's own lines and total have always been returned to any caller the class-level
        // [Authorize] admits, and narrowing that is a wider product change than the budget finding asks for. The budget block it now
        // carries is scoped inside the generator, under the CALLER's tenant (budget security audit F-1), so a SuperAdmin with no
        // organisation chosen gets a preview with no budget rather than another organisation's.
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
                Id = claim.Id, Kind = claim.Kind, TripInstanceId = claim.TripInstanceId, TripName = tripName ?? string.Empty,
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
                Id = c.Id, Kind = c.Kind, TripInstanceId = c.TripInstanceId, TripName = c.TripInstance!.TripName,
                Status = c.Status, ClaimReference = c.ClaimReference,
                TotalAmount = c.TotalAmount, CreatedAt = c.CreatedAt, SubmittedDate = c.SubmittedDate
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<TripClaimListDto>>.Ok(items));
    }

    // GET /api/v1/participants/{participantId}/claims?kind=
    // Shift-completion design spec §2 (PR 3) — mirrors GetClaimsForTrip above but filtered by
    // ParticipantId instead of TripInstanceId. TripClaim is NOT ITenantEntity (standing ruling),
    // so cross-tenant safety is enforced by gating on the tenant-filtered Participants set
    // first: a participantId that doesn't resolve under the caller's tenant returns an empty
    // list rather than leaking another tenant's claims.
    [HttpGet("participants/{participantId:guid}/claims")]
    public async Task<ActionResult<ApiResponse<List<TripClaimListDto>>>> GetClaimsForParticipant(
        Guid participantId, [FromQuery] ClaimKind? kind, CancellationToken ct)
    {
        var participantExists = await _db.Participants.AnyAsync(p => p.Id == participantId, ct);
        if (!participantExists)
            return Ok(ApiResponse<List<TripClaimListDto>>.Ok(new List<TripClaimListDto>()));

        // Trip-kind claims (ClaimGenerationService) never set TripClaim.ParticipantId — they
        // relate to a participant only through ClaimLineItem.ParticipantBooking.ParticipantId.
        // Match on either path so the participant Claims tab (which renders both kinds) sees
        // trip claims too, then apply the optional kind filter.
        var query = _db.TripClaims.Where(c =>
            c.ParticipantId == participantId ||
            c.LineItems.Any(l => l.ParticipantBooking != null && l.ParticipantBooking.ParticipantId == participantId));
        if (kind.HasValue)
            query = query.Where(c => c.Kind == kind.Value);

        var items = await query
            .Include(c => c.TripInstance)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new TripClaimListDto
            {
                Id = c.Id, Kind = c.Kind, TripInstanceId = c.TripInstanceId,
                TripName = c.TripInstance != null ? c.TripInstance.TripName : string.Empty,
                ParticipantId = c.ParticipantId, PeriodFrom = c.PeriodFrom, PeriodTo = c.PeriodTo,
                Status = c.Status, ClaimReference = c.ClaimReference,
                TotalAmount = c.TotalAmount, CreatedAt = c.CreatedAt, SubmittedDate = c.SubmittedDate
            }).ToListAsync(ct);
        return Ok(ApiResponse<List<TripClaimListDto>>.Ok(items));
    }

    // POST /api/v1/participants/{participantId}/claims/from-shifts/preview
    [HttpPost("participants/{participantId:guid}/claims/from-shifts/preview")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ShiftClaimPreviewResponseDto>>> PreviewShiftClaim(
        Guid participantId, [FromBody] GenerateShiftClaimRequestDto dto, CancellationToken ct)
    {
        // See PreviewClaim: the budget block is scoped in the generator, not by refusing the endpoint.
        try
        {
            var preview = await _shiftGenerator.PreviewAsync(participantId, dto.From, dto.To, ct);
            return Ok(ApiResponse<ShiftClaimPreviewResponseDto>.Ok(preview));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<ShiftClaimPreviewResponseDto>.Fail(ex.Message));
        }
    }

    // POST /api/v1/participants/{participantId}/claims/from-shifts
    [HttpPost("participants/{participantId:guid}/claims/from-shifts")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<TripClaimListDto>>> GenerateShiftClaim(
        Guid participantId, [FromBody] GenerateShiftClaimRequestDto dto, CancellationToken ct)
    {
        try
        {
            var claim = await _shiftGenerator.GenerateDraftClaimAsync(participantId, dto.From, dto.To, ct);
            return Ok(ApiResponse<TripClaimListDto>.Ok(new TripClaimListDto
            {
                Id = claim.Id, Kind = claim.Kind, TripInstanceId = claim.TripInstanceId, TripName = string.Empty,
                ParticipantId = claim.ParticipantId, PeriodFrom = claim.PeriodFrom, PeriodTo = claim.PeriodTo,
                Status = claim.Status, ClaimReference = claim.ClaimReference,
                TotalAmount = claim.TotalAmount, CreatedAt = claim.CreatedAt, SubmittedDate = claim.SubmittedDate
            }));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<TripClaimListDto>.Fail(ex.Message));
        }
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
                    .ThenInclude(b => b!.Participant)
            .Include(x => x.LineItems)
                .ThenInclude(l => l.Shift)
                    .ThenInclude(s => s!.Participant)
            .FirstOrDefaultAsync(x => x.Id == claimId, ct);

        if (c == null) return NotFound(ApiResponse<TripClaimDetailDto>.Fail("Claim not found"));

        // What this claim does to the budgets of the participants it covers, as of now (budget feature, phase 2a). A warning on the page and nothing more. It is worked out through the tenant's own
        // participants, so a claim reached by its id alone shows no budget of another organisation; a SuperAdmin who has not chosen an organisation to view as gets none.
        var budget = _tenant.TenantId is { } tenantId ? await _ledger.ForClaimAsync(tenantId, c.Id, ct) : null;

        return Ok(ApiResponse<TripClaimDetailDto>.Ok(new TripClaimDetailDto
        {
            Budget = budget,
            Id = c.Id, Kind = c.Kind, TripInstanceId = c.TripInstanceId, TripName = c.TripInstance?.TripName ?? string.Empty,
            ParticipantId = c.ParticipantId, PeriodFrom = c.PeriodFrom, PeriodTo = c.PeriodTo,
            Status = c.Status, ClaimReference = c.ClaimReference,
            TotalAmount = c.TotalAmount, TotalApprovedAmount = c.TotalApprovedAmount,
            CreatedAt = c.CreatedAt, SubmittedDate = c.SubmittedDate, PaidDate = c.PaidDate, RejectedDate = c.RejectedDate, RejectionCode = c.RejectionCode,
            AuthorisedByStaffId = c.AuthorisedByUserId,
            AuthorisedByStaffName = c.AuthorisedByUser != null ? $"{c.AuthorisedByUser.FirstName} {c.AuthorisedByUser.LastName}" : null,
            Notes = c.Notes,
            // Nullability audit (shift-completion design spec, delivery PR 3): exactly one of
            // ParticipantBooking/Shift is set per line item — branch on whichever is present
            // rather than assuming ParticipantBooking, which is null for Kind == Shift lines.
            LineItems = c.LineItems.Select(l =>
            {
                var participant = l.ParticipantBooking?.Participant ?? l.Shift?.Participant;
                return new ClaimLineItemDto
                {
                    Id = l.Id, TripClaimId = l.TripClaimId,
                    ParticipantBookingId = l.ParticipantBookingId, ShiftId = l.ShiftId,
                    ParticipantId = l.ParticipantBooking?.ParticipantId ?? l.Shift?.ParticipantId,
                    ParticipantName = participant?.FullName ?? string.Empty,
                    NdisNumber = participant?.NdisNumber ?? string.Empty,
                    PlanType = l.ParticipantBooking != null
                        ? l.ParticipantBooking.PlanTypeOverride ?? l.ParticipantBooking.Participant?.PlanType ?? default
                        : participant?.PlanType ?? default,
                    SupportItemCode = l.SupportItemCode, DayType = l.DayType,
                    SupportsDeliveredFrom = l.SupportsDeliveredFrom, SupportsDeliveredTo = l.SupportsDeliveredTo,
                    Hours = l.Hours, UnitPrice = l.UnitPrice, TotalAmount = l.TotalAmount,
                    GSTCode = l.GSTCode, ClaimType = l.ClaimType, ParticipantApproved = l.ParticipantApproved,
                    Status = l.Status, RejectionReason = l.RejectionReason, PaidAmount = l.PaidAmount
                };
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

        // The NDIA's code for a rejection (budget phase 2b) is checked before anything is changed, so a refusal writes nothing: no control characters (Postgres refuses a NUL in text), at most ten
        // characters, and only with a claim that is, or is being made, Rejected.
        var code = NdiaRejectionCodes.Normalise(dto.RejectionCode);
        if (dto.RejectionCode != null)
        {
            if (dto.RejectionCode.Any(char.IsControl)) return BadRequest(ApiResponse<bool>.Fail("The NDIA code cannot contain a control character (a line break, a tab, a NUL)."));
            if (code is { Length: > NdiaRejectionCodes.MaxLength }) return BadRequest(ApiResponse<bool>.Fail($"The NDIA code is at most {NdiaRejectionCodes.MaxLength} characters."));
            if (code != null && (dto.Status ?? c.Status) != TripClaimStatus.Rejected)
                return BadRequest(ApiResponse<bool>.Fail("An NDIA rejection code goes with a rejected claim: mark the claim as Rejected to record it."));
        }

        var now = _clock.GetUtcNow().UtcDateTime;
        var before = c.Status;
        if (dto.AuthorisedByStaffId.HasValue) c.AuthorisedByUserId = dto.AuthorisedByStaffId;
        if (dto.Notes != null) c.Notes = dto.Notes;
        if (dto.Status.HasValue)
        {
            c.Status = dto.Status.Value;
            if (dto.Status.Value == TripClaimStatus.Submitted) c.SubmittedDate = now;
            if (dto.Status.Value == TripClaimStatus.Paid) c.PaidDate = now;
        }
        KeepRejectionRecord(c, before, now);
        if (dto.RejectionCode != null && c.Status == TripClaimStatus.Rejected) c.RejectionCode = code;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>
    /// What a claim remembers about being rejected, kept in step with its status whichever way the status moved (the claim's own Mark as Rejected, or every line rejected): the moment it became Rejected
    /// is stamped once, and a claim that is no longer Rejected forgets the moment and the NDIA's code, so a later rejection starts afresh.
    /// </summary>
    private static void KeepRejectionRecord(TripClaim claim, TripClaimStatus before, DateTime now)
    {
        if (claim.Status == TripClaimStatus.Rejected)
        {
            if (before != TripClaimStatus.Rejected) claim.RejectedDate = now;
            return;
        }

        claim.RejectedDate = null;
        claim.RejectionCode = null;
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
        var claimBefore = item.TripClaim.Status;
        if (statuses.All(s => s == ClaimLineItemStatus.Paid))
            item.TripClaim.Status = TripClaimStatus.Paid;
        else if (statuses.All(s => s == ClaimLineItemStatus.Rejected))
            item.TripClaim.Status = TripClaimStatus.Rejected;
        // NOTE: TripClaimStatus.PartiallyPaid exists (value 4) but partial auto-promotion is omitted intentionally
        KeepRejectionRecord(item.TripClaim, claimBefore, _clock.GetUtcNow().UtcDateTime);

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

        // Reset participant bookings back to unclaimed. Shift-completion design spec, delivery
        // PR 3: Kind == Shift line items have ParticipantBookingId == null — filter those out
        // rather than passing nulls into the ParticipantBookings lookup (a shift becomes
        // unclaimed again simply by its ClaimLineItem row being removed below).
        var bookingIds = claim.LineItems
            .Where(l => l.ParticipantBookingId.HasValue)
            .Select(l => l.ParticipantBookingId!.Value)
            .Distinct()
            .ToList();
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
