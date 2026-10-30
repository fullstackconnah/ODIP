using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Domain.Funding;
using Odip.Domain.Interfaces;
using Odip.Infrastructure.Audit;
using Odip.Infrastructure.Data;
using Odip.Infrastructure.Rostering;
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

    /// <summary>A claim generation waited for another one for the same trip or participant (see the generators' advisory lock) and gave up.</summary>
    private const string ClaimBusy = "Another claim is still being generated for this trip or participant. Wait a moment, then try again.";

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

    /// <summary>
    /// The caller's own claims. TripClaim has no organisation column and no query filter, so a claim is theirs only if the trip (a Trip claim) or the participant (a Shift claim) it belongs to
    /// is: both sets are tenant-filtered. Every read or write of a claim by id starts here, so another organisation's claim is "not found".
    /// </summary>
    private IQueryable<TripClaim> TenantClaims() =>
        _db.TripClaims.Where(c => _db.TripInstances.Any(t => t.Id == c.TripInstanceId) || _db.Participants.Any(p => p.Id == c.ParticipantId));

    // POST /api/v1/trips/{tripId}/claims/preview
    [HttpPost("trips/{tripId:guid}/claims/preview")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ClaimPreviewResponseDto>>> PreviewClaim(
        Guid tripId, [FromBody] ClaimPreviewRequestDto dto, CancellationToken ct)
    {
        // No separate guard here: the generator reads the trip through the tenant-filtered TripInstances, so another organisation's trip is "Trip not found" (400),
        // as it is for GenerateClaim; only a SuperAdmin with no organisation chosen previews any trip, by design. The budget block it carries is scoped inside
        // the generator, under the CALLER's tenant (budget security audit F-1), so that SuperAdmin gets a preview with no budget rather than another organisation's.
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
        catch (RosterBusyException)   // before InvalidOperationException, which it is
        {
            return Conflict(ApiResponse<TripClaimListDto>.Fail(ClaimBusy));
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
        if (!await _db.TripInstances.AnyAsync(t => t.Id == tripId, ct))
            return NotFound(ApiResponse<List<TripClaimListDto>>.Fail("Trip not found"));

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
    public async Task<ActionResult<ApiResponse<ShiftClaimGeneratedDto>>> GenerateShiftClaim(
        Guid participantId, [FromBody] GenerateShiftClaimRequestDto dto, CancellationToken ct)
    {
        try
        {
            // The claim summary, plus the completed shifts in the range it left out and why (a sleepover or group shift, a shift no catalogue rate covers): never dropped silently.
            var generated = await _shiftGenerator.GenerateAsync(participantId, dto.From, dto.To, ct);
            var claim = generated.Claim;
            return Ok(ApiResponse<ShiftClaimGeneratedDto>.Ok(new ShiftClaimGeneratedDto
            {
                Id = claim.Id, Kind = claim.Kind, TripInstanceId = claim.TripInstanceId, TripName = string.Empty,
                ParticipantId = claim.ParticipantId, PeriodFrom = claim.PeriodFrom, PeriodTo = claim.PeriodTo,
                Status = claim.Status, ClaimReference = claim.ClaimReference,
                TotalAmount = claim.TotalAmount, CreatedAt = claim.CreatedAt, SubmittedDate = claim.SubmittedDate,
                LeftOut = generated.LeftOut.ToList(),
                Flagged = generated.Flagged.ToList(),
            }));
        }
        catch (RosterBusyException)
        {
            return Conflict(ApiResponse<ShiftClaimGeneratedDto>.Fail(ClaimBusy));
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<ShiftClaimGeneratedDto>.Fail(ex.Message));
        }
    }

    // GET /api/v1/claims/{claimId}
    [HttpGet("claims/{claimId:guid}")]
    public async Task<ActionResult<ApiResponse<TripClaimDetailDto>>> GetClaim(Guid claimId, CancellationToken ct)
    {
        var c = await TenantClaims()
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
            AuthorisedByStaffName = c.AuthorisedByUser != null ? $"{c.AuthorisedByUser.FirstName} {c.AuthorisedByUser.LastName}".Trim() : null,
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
        if (!await TenantClaims().AnyAsync(x => x.Id == claimId, ct)) return NotFound(ApiResponse<bool>.Fail("Claim not found"));

        // A status change takes the same per-claim lock as a line edit, so it cannot cross one (a line changed after the claim was submitted) or another status change.
        var held = await LockClaimAsync(claimId, ct);
        if (held == null) return ClaimEditBusy();
        await using var _ = held;

        var c = await TenantClaims().FirstOrDefaultAsync(x => x.Id == claimId, ct);
        if (c == null) return NotFound(ApiResponse<bool>.Fail("Claim not found"));

        // A status moves along the paths in CanMove only (the page says "This cannot be undone"), checked before anything is changed, so a refusal writes nothing.
        if (dto.Status is { } wanted && !ClaimStatusRules.CanMove(c.Status, wanted))
            return Conflict(ApiResponse<bool>.Fail($"{c.ClaimReference} is {Words(c.Status)}, so it can't be marked as {Words(wanted)}."));

        // The authoriser is a user of the caller's organisation (Users is tenant-filtered); checked before anything is changed, so a refusal writes nothing.
        if (dto.AuthorisedByStaffId is { } authoriserId && !await _db.Users.AnyAsync(u => u.Id == authoriserId, ct))
            return BadRequest(ApiResponse<bool>.Fail("Authorising staff member not found."));

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
        // A real move to Submitted issues the claim's invoices (Xero PR1), after every check above and in this lock's transaction: the lines freeze at
        // this moment, and a refusal (no settings) writes nothing, the numbers it took rolling back with the transaction.
        if (dto.Status == TripClaimStatus.Submitted && c.Status != TripClaimStatus.Submitted)
        {
            if (await ClaimSubmission.OtherFundedRefusalAsync(_db, c, ct) is { } otherFunded) return Conflict(ApiResponse<bool>.Fail(otherFunded));
            if (await ClaimSubmission.HoldingTheSameAsync(_db, c.Id, _db.ClaimLineItems.Where(l => l.TripClaimId == c.Id), ct) is { } holder)
                return Conflict(ApiResponse<bool>.Fail($"This claim includes a shift that is already on claim {holder}. Remove it from this claim before submitting."));
            try { await _invoiceService.IssueForSubmitAsync(c.Id, now, User, ct); }
            catch (InvoiceRefusedException ex) { return Conflict(ApiResponse<bool>.Fail(ex.Message)); }
        }
        if (dto.AuthorisedByStaffId.HasValue) c.AuthorisedByUserId = dto.AuthorisedByStaffId;
        if (dto.Notes != null) c.Notes = dto.Notes;
        if (dto.Status.HasValue) ClaimStatusRules.ApplyStatus(c, dto.Status.Value, now);
        if (dto.RejectionCode != null && c.Status == TripClaimStatus.Rejected)
        {
            c.RejectionCode = code;
            // A claim marked Rejected before the day was kept has no day, and the NDIA's word (the alert and the Funding tab's note) needs one: recording its code is the first day the claim is known
            // to have been refused, so that is the day. A day that is already there never moves.
            if (code != null && c.RejectedDate is null) c.RejectedDate = now;
        }

        await _db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    /// <summary>A status in plain words for a message: "partially paid", not "partiallypaid".</summary>
    private static string Words(TripClaimStatus status) => System.Text.RegularExpressions.Regex.Replace(status.ToString(), "(?<=[a-z])(?=[A-Z])", " ").ToLowerInvariant();

    /// <summary>Takes the per-claim edit lock (waits a moment for another change to the same claim); null when it stayed busy.</summary>
    private async Task<RosterGenerationLock?> LockClaimAsync(Guid claimId, CancellationToken ct)
    {
        try { return await RosterGenerationLock.AcquireAsync(_db, claimId, ct, scope: "claim-edit"); }
        catch (RosterBusyException) { return null; }
    }

    private ActionResult<ApiResponse<bool>> ClaimEditBusy() => Conflict(ApiResponse<bool>.Fail("Another change to this claim is still being saved. Wait a moment, then try again."));

    // PATCH /api/v1/claims/{claimId}/line-items/{id}
    [HttpPatch("claims/{claimId:guid}/line-items/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> UpdateLineItem(Guid claimId, Guid id, [FromBody] UpdateClaimLineItemDto dto, CancellationToken ct)
    {
        if (!await TenantClaims().AnyAsync(x => x.Id == claimId, ct)) return NotFound(ApiResponse<bool>.Fail("Claim not found"));

        // Hours and price are stored to the cent (numeric(18,2)): a third decimal would store a line whose hours x price no longer equals its total.
        if ((dto.Hours is { } h && decimal.Round(h, 2) != h) || (dto.UnitPrice is { } p && decimal.Round(p, 2) != p))
            return BadRequest(ApiResponse<bool>.Fail("Hours and unit price can have at most 2 decimal places."));

        // Two edits to lines of one claim at the same moment would each add up the claim's total from what they read: the second waits here, so it reads what the first saved.
        var held = await LockClaimAsync(claimId, ct);
        if (held == null) return ClaimEditBusy();
        await using var _ = held;

        var item = await _db.ClaimLineItems
            .Include(l => l.TripClaim)
            .FirstOrDefaultAsync(x => x.Id == id && x.TripClaimId == claimId, ct);
        if (item == null) return NotFound(ApiResponse<bool>.Fail("Line item not found"));

        // What was sent to the NDIA stays as it was sent: only the line's status and what was paid on it still change.
        var claim = item.TripClaim;
        if ((dto.Hours.HasValue || dto.UnitPrice.HasValue || dto.SupportItemCode != null || dto.ClaimType.HasValue || dto.CancellationReason != null)
            && claim.Status is not (TripClaimStatus.Draft or TripClaimStatus.Ready))
            return Conflict(ApiResponse<bool>.Fail("This claim has been submitted, so its lines can't be changed."));

        // The NDIA has not seen a Draft or Ready claim, so none of its lines can be rejected yet.
        if (dto.Status == ClaimLineItemStatus.Rejected && claim.Status is (TripClaimStatus.Draft or TripClaimStatus.Ready))
            return Conflict(ApiResponse<bool>.Fail($"{claim.ClaimReference} hasn't been submitted to the NDIA yet, so its lines can't be marked as rejected."));

        // A rejected line gave its shift back, and another claim may hold it now: taking the line back would bill the shift twice.
        if (item.Status == ClaimLineItemStatus.Rejected && dto.Status.HasValue && dto.Status != ClaimLineItemStatus.Rejected
            && await ClaimSubmission.HoldingTheSameAsync(_db, claimId, _db.ClaimLineItems.Where(l => l.Id == id), ct) is { } holder)
            return Conflict(ApiResponse<bool>.Fail($"This line's shift is already on claim {holder}, so the line can't be taken back."));

        if (dto.Hours.HasValue) { item.Hours = dto.Hours.Value; item.TotalAmount = ClaimPricing.LineAmount(item.Hours, item.UnitPrice); }
        if (dto.UnitPrice.HasValue) { item.UnitPrice = dto.UnitPrice.Value; item.TotalAmount = ClaimPricing.LineAmount(item.Hours, item.UnitPrice); }
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

        // The claim total is always the sum of ALL its lines as stored (the edited one is the tracked copy, so it counts with its new amount).
        var lines = await _db.ClaimLineItems.Where(l => l.TripClaimId == claimId).ToListAsync(ct);
        claim.TotalAmount = lines.Sum(l => l.TotalAmount);

        ClaimStatusRules.RollUp(claim, lines.Select(l => l.Status).ToList(), _clock.GetUtcNow().UtcDateTime);

        await _db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        return Ok(ApiResponse<bool>.Ok(true));
    }

    // DELETE /api/v1/claims/{claimId}
    [HttpDelete("claims/{claimId:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<bool>>> DeleteClaim(Guid claimId, CancellationToken ct)
    {
        if (!await TenantClaims().AnyAsync(x => x.Id == claimId, ct)) return NotFound(ApiResponse<bool>.Fail("Claim not found"));

        var held = await LockClaimAsync(claimId, ct);
        if (held == null) return ClaimEditBusy();
        await using var _ = held;

        var claim = await TenantClaims()
            .Include(c => c.LineItems)
            .FirstOrDefaultAsync(x => x.Id == claimId, ct);

        if (claim == null) return NotFound(ApiResponse<bool>.Fail("Claim not found"));

        // A claim that has gone to the NDIA keeps its lines and payment record (deleting a paid or part-paid one makes supports already paid claimable again). Rejected stays deletable on purpose:
        // its lines are locked and it cannot go back to Draft, so delete-and-regenerate is the only way to correct an NDIA rejection.
        if (claim.Status is not (TripClaimStatus.Draft or TripClaimStatus.Ready or TripClaimStatus.Rejected or TripClaimStatus.Cancelled))
            return BadRequest(ApiResponse<bool>.Fail("A claim that has gone to the NDIA can't be deleted unless it was rejected."));

        // An invoice that stands must be voided first (Xero PR1, spec 5.5): its number never disappears. Voided and credited rows and credit notes stay after the delete, their claim link set null.
        var live = await _db.Invoices.Where(i => i.TripClaimId == claimId && i.Kind == InvoiceKind.Invoice && i.Status == InvoiceStatus.Issued)
            .OrderBy(i => i.Number).Select(i => i.DisplayNumber).ToListAsync(ct);
        if (live.Count > 0) return Conflict(ApiResponse<bool>.Fail($"Void {JoinAnd(live)} first, then delete the claim."));

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
        await held.CommitAsync(ct);

        return Ok(ApiResponse<bool>.Ok(true));
    }

    // GET /api/v1/claims/{claimId}/bpr-csv
    [HttpGet("claims/{claimId:guid}/bpr-csv")]
    public async Task<IActionResult> DownloadBprCsv(Guid claimId, CancellationToken ct)
    {
        if (!await TenantClaims().AnyAsync(x => x.Id == claimId, ct)) return NotFound(ApiResponse<bool>.Fail("Claim not found"));

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

    // GET /api/v1/claims/{claimId}/invoices/{groupId} — groupId is the booking (trip claim) or the participant (shift claim).
    [HttpGet("claims/{claimId:guid}/invoices/{groupId:guid}")]
    public async Task<IActionResult> DownloadInvoice(Guid claimId, Guid groupId, CancellationToken ct)
    {
        if (!await TenantClaims().AnyAsync(x => x.Id == claimId, ct)) return NotFound(ApiResponse<bool>.Fail("Claim not found"));

        try
        {
            var (bytes, fileName) = await _invoiceService.DownloadForGroupAsync(claimId, groupId, ct);
            return File(bytes, "application/pdf", fileName);
        }
        catch (InvalidOperationException ex)
        {
            return BadRequest(ApiResponse<bool>.Fail(ex.Message));
        }
    }

    // GET /api/v1/claims/{claimId}/invoices — the claim's Invoices section, every state said by the server.
    [HttpGet("claims/{claimId:guid}/invoices")]
    public async Task<ActionResult<ApiResponse<ClaimInvoicesDto>>> GetClaimInvoices(Guid claimId, CancellationToken ct)
    {
        if (!await TenantClaims().AnyAsync(x => x.Id == claimId, ct)) return NotFound(ApiResponse<ClaimInvoicesDto>.Fail("Claim not found"));
        return Ok(ApiResponse<ClaimInvoicesDto>.Ok(await _invoiceService.ClaimInvoicesAsync(claimId, ct)));
    }

    // POST /api/v1/claims/submit-preview — a read (POST for the list of ids): what marking each claim as submitted would issue now.
    [HttpPost("claims/submit-preview")]
    public async Task<ActionResult<ApiResponse<SubmitPreviewDto>>> SubmitPreview([FromBody] SubmitPreviewRequestDto dto, CancellationToken ct)
    {
        var ids = dto.ClaimIds.Distinct().ToList();
        if (ids.Count is < 1 or > 100) return BadRequest(ApiResponse<SubmitPreviewDto>.Fail("Choose between 1 and 100 claims."));
        if (await TenantClaims().CountAsync(c => ids.Contains(c.Id), ct) != ids.Count) return NotFound(ApiResponse<SubmitPreviewDto>.Fail("Claim not found"));

        var claims = new List<ClaimSubmitPreviewDto>();
        foreach (var id in ids) claims.Add(await _invoiceService.SubmitPreviewAsync(id, ct));
        return Ok(ApiResponse<SubmitPreviewDto>.Ok(new SubmitPreviewDto { Claims = claims, InvoiceCount = claims.Sum(c => c.ToIssue.Count) }));
    }

    // GET /api/v1/invoices/{invoiceId}/pdf — the issued invoice or credit note, from its snapshot only. Invoices is tenant-filtered, so another organisation's is not found.
    [HttpGet("invoices/{invoiceId:guid}/pdf")]
    public async Task<IActionResult> DownloadIssuedInvoice(Guid invoiceId, CancellationToken ct)
    {
        var pdf = await _invoiceService.RenderStoredAsync(invoiceId, ct);
        return pdf is { } p ? File(p.Content, "application/pdf", p.FileName) : NotFound(ApiResponse<bool>.Fail("Invoice not found"));
    }

    // GET /api/v1/invoices — the register: every invoice and credit note in scope, a deleted claim's too (TripClaimId null). Invoices is tenant-filtered (a SuperAdmin with no organisation chosen sees all).
    [HttpGet("invoices")]
    public async Task<ActionResult<ApiResponse<PagedResult<InvoiceRegisterRowDto>>>> GetInvoiceRegister(
        [FromQuery] InvoiceKind? kind, [FromQuery] InvoiceStatus? status, [FromQuery] DateOnly? from, [FromQuery] DateOnly? to,
        [FromQuery] string? search, [FromQuery] bool deletedClaimOnly = false,
        [FromQuery] int page = 1, [FromQuery] int pageSize = PagingParams.DefaultPageSize, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);
        var query = _db.Invoices.AsNoTracking();
        if (kind is { } k) query = query.Where(i => i.Kind == k);
        if (status is { } st) query = query.Where(i => i.Status == st);
        if (from is { } f) query = query.Where(i => i.IssueDate >= f);
        if (to is { } t) query = query.Where(i => i.IssueDate <= t);
        if (deletedClaimOnly) query = query.Where(i => i.TripClaimId == null);
        if (search?.Trim().ToLower() is { Length: > 0 } term)
            query = query.Where(i => i.DisplayNumber.ToLower().Contains(term) || i.ParticipantName.ToLower().Contains(term)
                || i.BillToName.ToLower().Contains(term) || i.ClaimReference.ToLower().Contains(term));

        // Id last: SQL gives no order among ties, so a row could land on two pages or none.
        var rows = query.OrderByDescending(i => i.IssueDate).ThenByDescending(i => i.Number).ThenBy(i => i.Id).Select(i => new InvoiceRegisterRowDto
        {
            Id = i.Id, Kind = i.Kind, DisplayNumber = i.DisplayNumber, Status = i.Status, IssueDate = i.IssueDate, DueDate = i.DueDate,
            ParticipantName = i.ParticipantName, BillToName = i.BillToName, PayerKind = i.PayerKind, ClaimReference = i.ClaimReference, TripClaimId = i.TripClaimId,
            CreditsDisplayNumber = i.CreditsDisplayNumber,
            CreditedByDisplayNumber = _db.Invoices.Where(c => c.CreditsInvoiceId == i.Id).Select(c => c.DisplayNumber).FirstOrDefault(),
            Total = i.Kind == InvoiceKind.CreditNote ? -i.Total : i.Total,
            OrganisationName = i.SellerOrganisationName,
        });
        return Ok(ApiResponse<PagedResult<InvoiceRegisterRowDto>>.Ok(await PagedResult<InvoiceRegisterRowDto>.CreateAsync(rows, page, pageSize, ct)));
    }

    // POST /api/v1/invoices/{invoiceId}/void — an invoice with no payment recorded; its number is kept and never used again.
    [HttpPost("invoices/{invoiceId:guid}/void")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public Task<ActionResult<ApiResponse<InvoiceSummaryDto>>> VoidInvoice(Guid invoiceId, [FromBody] InvoiceReasonDto dto, CancellationToken ct) =>
        CorrectInvoiceAsync(invoiceId, dto.Reason, credit: false, ct);

    // POST /api/v1/invoices/{invoiceId}/credit-note — a full credit note (its own CN number); the invoice becomes Credited.
    [HttpPost("invoices/{invoiceId:guid}/credit-note")]
    [Authorize(Roles = "Admin,SuperAdmin")]
    public Task<ActionResult<ApiResponse<InvoiceSummaryDto>>> IssueCreditNote(Guid invoiceId, [FromBody] InvoiceReasonDto dto, CancellationToken ct) =>
        CorrectInvoiceAsync(invoiceId, dto.Reason, credit: true, ct);

    /// <summary>
    /// Void or credit (spec 5.5, D12): the reason is checked, then the invoice's kind and state (before any lock, so a row whose claim was deleted answers 409),
    /// then the claim's edit lock is taken, the invoice and its claim's lines read again, and the change and its audit row saved together.
    /// </summary>
    private async Task<ActionResult<ApiResponse<InvoiceSummaryDto>>> CorrectInvoiceAsync(Guid invoiceId, string? reason, bool credit, CancellationToken ct)
    {
        reason = reason?.Trim();
        if (string.IsNullOrEmpty(reason)) return BadRequest(ApiResponse<InvoiceSummaryDto>.Fail(credit ? "Say why it's being credited." : "Say why it's being voided."));
        if (reason.Length > 500) return BadRequest(ApiResponse<InvoiceSummaryDto>.Fail("The reason is 500 characters at most."));
        if (reason.Any(char.IsControl)) return BadRequest(ApiResponse<InvoiceSummaryDto>.Fail("The reason can't contain a line break, a tab or another control character."));

        // Invoices is tenant-filtered: another organisation's is not found.
        var found = await _db.Invoices.AsNoTracking().FirstOrDefaultAsync(i => i.Id == invoiceId, ct);
        if (found == null) return NotFound(ApiResponse<InvoiceSummaryDto>.Fail("Invoice not found"));
        if (StateRefusal(found) is { } refused) return Conflict(ApiResponse<InvoiceSummaryDto>.Fail(refused));
        if (found.TripClaimId is not { } claimId) return Conflict(ApiResponse<InvoiceSummaryDto>.Fail($"{found.DisplayNumber} has no claim any more."));

        var held = await LockClaimAsync(claimId, ct);
        if (held == null) return Conflict(ApiResponse<InvoiceSummaryDto>.Fail("Another change to this claim is still being saved. Wait a moment, then try again."));
        await using var _ = held;

        var invoice = await _db.Invoices.Include(i => i.Lines).FirstAsync(i => i.Id == invoiceId, ct);
        if (StateRefusal(invoice) is { } changed) return Conflict(ApiResponse<InvoiceSummaryDto>.Fail(changed));
        var claim = await _db.TripClaims.Include(c => c.LineItems).FirstAsync(c => c.Id == claimId, ct);
        var paid = InvoiceService.PaymentRecorded(invoice, claim.LineItems.ToDictionary(l => l.Id), claim.Status);
        var now = _clock.GetUtcNow().UtcDateTime;

        InvoiceSummaryDto result;
        string change;
        if (credit)
        {
            var note = await _invoiceService.CreditAsync(invoice, now, User, ct);
            result = InvoiceService.Summary(note, null, false);
            change = $"Credited by {note.DisplayNumber}: {reason}";
        }
        else
        {
            if (paid) return Conflict(ApiResponse<InvoiceSummaryDto>.Fail("A payment is recorded, so issue a credit note instead."));
            invoice.Status = InvoiceStatus.Voided;
            invoice.VoidedAt = now;
            invoice.VoidedById = Guid.TryParse(User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value, out var actorId) ? actorId : null;
            invoice.VoidReason = reason;
            result = InvoiceService.Summary(invoice, null, false);
            change = $"Void: {reason}";
        }

        // The claim's History shows it; never a bank field.
        _db.AuditLogs.Add(SettingChangeAudit.ForFieldChange(nameof(TripClaim), claimId, $"Invoice {invoice.DisplayNumber}", "Issued", change, User));
        await _db.SaveChangesAsync(ct);
        await held.CommitAsync(ct);
        return Ok(ApiResponse<InvoiceSummaryDto>.Ok(result));
    }

    /// <summary>Why an invoice can't be voided or credited as it stands; null when it is an issued invoice.</summary>
    private static string? StateRefusal(Invoice invoice) =>
        invoice.Kind == InvoiceKind.CreditNote ? $"{invoice.DisplayNumber} is a credit note, so it stands as issued."
        : invoice.Status == InvoiceStatus.Voided ? $"{invoice.DisplayNumber} is already void."
        : invoice.Status == InvoiceStatus.Credited ? $"{invoice.DisplayNumber} is already credited."
        : null;

    /// <summary>"A", "A and B", "A, B and C".</summary>
    private static string JoinAnd(IReadOnlyList<string> items) =>
        items.Count == 1 ? items[0] : $"{string.Join(", ", items.Take(items.Count - 1))} and {items[^1]}";
}
