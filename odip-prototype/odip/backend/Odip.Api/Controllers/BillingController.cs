using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Odip.Application.Common;
using Odip.Application.DTOs;
using Odip.Domain.Billing;
using Odip.Domain.Billing.Services;
using Odip.Domain.Entities;
using Odip.Domain.Enums;
using Odip.Infrastructure.Data;

namespace Odip.Api.Controllers;

/// <summary>
/// Billing API: funding sources, service bookings, billable events, and PRODA claim batches.
/// Mirrors <see cref="ClaimsController"/>'s authorisation posture — billing is finance-sensitive,
/// so every endpoint (reads included) is gated to SuperAdmin/Admin/Coordinator, with writes
/// additionally decorated the same way ClaimsController decorates its write/preview actions.
/// All mutation is routed through <see cref="BillingValidator"/> rather than re-checked by hand.
/// </summary>
[ApiController]
[Authorize(Roles = "SuperAdmin,Admin,Coordinator")]
[Route("api/v1/billing")]
public class BillingController : ControllerBase
{
    private readonly OdipDbContext _db;
    private readonly BillingValidator _validator = new();

    private readonly TimeProvider _clock;
    public BillingController(OdipDbContext db, TimeProvider? clock = null)
    {
        _db = db;
        _clock = clock ?? TimeProvider.System;
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

    // ══════════════════════════════════════════════════════════════
    // SERVICE BOOKINGS
    // ══════════════════════════════════════════════════════════════

    /// <summary>List service bookings, optionally filtered by participant and active status (claim window still open).</summary>
    [HttpGet("service-bookings")]
    public async Task<ActionResult<ApiResponse<PagedResult<ServiceBookingListDto>>>> GetServiceBookings(
        [FromQuery] Guid? participantId, [FromQuery] bool? activeOnly,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        var query = _db.ServiceBookings.AsQueryable();
        if (participantId.HasValue) query = query.Where(b => b.FundingSource!.ParticipantId == participantId.Value);
        if (activeOnly == true) query = query.Where(b => b.EndDate.AddDays(b.ClaimWindowDays) >= today);

        var projected = query.OrderByDescending(b => b.EndDate).Select(b => new ServiceBookingListDto
        {
            Id = b.Id, FundingSourceId = b.FundingSourceId, ParticipantId = b.FundingSource!.ParticipantId,
            ParticipantName = b.FundingSource.Participant == null ? null :
                string.IsNullOrEmpty(b.FundingSource.Participant.PreferredName)
                    ? b.FundingSource.Participant.FirstName + " " + b.FundingSource.Participant.LastName
                    : b.FundingSource.Participant.PreferredName + " " + b.FundingSource.Participant.LastName,
            ProdaBookingReference = b.ProdaBookingReference, StartDate = b.StartDate, EndDate = b.EndDate,
            ClaimWindowDays = b.ClaimWindowDays, ClaimDeadline = b.EndDate.AddDays(b.ClaimWindowDays),
            TotalAllocated = b.Lines.Sum(l => l.AllocatedAmount), TotalClaimed = b.Lines.Sum(l => l.ClaimedAmount),
            TotalRemaining = b.Lines.Sum(l => l.AllocatedAmount) - b.Lines.Sum(l => l.ClaimedAmount)
        });

        var result = await PagedResult<ServiceBookingListDto>.CreateAsync(projected, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<ServiceBookingListDto>>.Ok(result));
    }

    /// <summary>Get a single service booking with its lines.</summary>
    [HttpGet("service-bookings/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ServiceBookingDetailDto>>> GetServiceBookingById(Guid id, CancellationToken ct)
    {
        var b = await _db.ServiceBookings
            .Include(x => x.Lines)
            .Include(x => x.FundingSource).ThenInclude(f => f!.Participant)
            .FirstOrDefaultAsync(x => x.Id == id, ct);
        if (b == null) return NotFound(ApiResponse<ServiceBookingDetailDto>.Fail("Service booking not found"));

        return Ok(ApiResponse<ServiceBookingDetailDto>.Ok(new ServiceBookingDetailDto
        {
            Id = b.Id, FundingSourceId = b.FundingSourceId, ParticipantId = b.FundingSource?.ParticipantId,
            ParticipantName = b.FundingSource?.Participant != null ? FullName(b.FundingSource.Participant) : null,
            ProdaBookingReference = b.ProdaBookingReference, StartDate = b.StartDate, EndDate = b.EndDate,
            ClaimWindowDays = b.ClaimWindowDays, ClaimDeadline = b.ClaimDeadline,
            TotalAllocated = b.Lines.Sum(l => l.AllocatedAmount), TotalClaimed = b.Lines.Sum(l => l.ClaimedAmount),
            TotalRemaining = b.Lines.Sum(l => l.RemainingAmount),
            Lines = b.Lines.Select(l => new ServiceBookingLineDto
            {
                Id = l.Id, SupportItemNumber = l.SupportItemNumber,
                AllocatedAmount = l.AllocatedAmount, ClaimedAmount = l.ClaimedAmount, RemainingAmount = l.RemainingAmount
            }).ToList()
        }));
    }

    /// <summary>Create a service booking with its lines.</summary>
    [HttpPost("service-bookings")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ServiceBookingDetailDto>>> CreateServiceBooking(
        [FromBody] CreateServiceBookingDto dto, CancellationToken ct)
    {
        var fs = await _db.FundingSources.FirstOrDefaultAsync(f => f.Id == dto.FundingSourceId, ct);
        if (fs == null) return BadRequest(ApiResponse<ServiceBookingDetailDto>.Fail("Funding source not found"));

        var booking = new ServiceBooking
        {
            Id = Guid.NewGuid(), FundingSourceId = dto.FundingSourceId,
            ProdaBookingReference = dto.ProdaBookingReference, StartDate = dto.StartDate,
            EndDate = dto.EndDate, ClaimWindowDays = dto.ClaimWindowDays
        };
        foreach (var l in dto.Lines)
        {
            booking.Lines.Add(new ServiceBookingLine
            {
                Id = Guid.NewGuid(), ServiceBookingId = booking.Id,
                SupportItemNumber = l.SupportItemNumber, AllocatedAmount = l.AllocatedAmount, ClaimedAmount = 0m
            });
        }

        _db.ServiceBookings.Add(booking);
        await _db.SaveChangesAsync(ct);

        return CreatedAtAction(nameof(GetServiceBookingById), new { id = booking.Id },
            ApiResponse<ServiceBookingDetailDto>.Ok(new ServiceBookingDetailDto
            {
                Id = booking.Id, FundingSourceId = booking.FundingSourceId, ParticipantId = fs.ParticipantId,
                ProdaBookingReference = booking.ProdaBookingReference, StartDate = booking.StartDate, EndDate = booking.EndDate,
                ClaimWindowDays = booking.ClaimWindowDays, ClaimDeadline = booking.ClaimDeadline,
                TotalAllocated = booking.Lines.Sum(l => l.AllocatedAmount), TotalClaimed = 0m,
                TotalRemaining = booking.Lines.Sum(l => l.AllocatedAmount),
                Lines = booking.Lines.Select(l => new ServiceBookingLineDto
                {
                    Id = l.Id, SupportItemNumber = l.SupportItemNumber,
                    AllocatedAmount = l.AllocatedAmount, ClaimedAmount = l.ClaimedAmount, RemainingAmount = l.RemainingAmount
                }).ToList()
            }));
    }

    // ══════════════════════════════════════════════════════════════
    // BILLABLE EVENTS
    // ══════════════════════════════════════════════════════════════

    /// <summary>List billable events, optionally filtered by participant, status, income stream, and delivery date range.</summary>
    [HttpGet("billable-events")]
    public async Task<ActionResult<ApiResponse<PagedResult<BillableEventDto>>>> GetBillableEvents(
        [FromQuery] Guid? participantId, [FromQuery] BillableEventStatus? status, [FromQuery] IncomeStream? stream,
        [FromQuery] DateOnly? fromDate, [FromQuery] DateOnly? toDate,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);

        var events = _db.BillableEvents.AsQueryable();
        if (participantId.HasValue) events = events.Where(e => e.ParticipantId == participantId.Value);
        if (status.HasValue) events = events.Where(e => e.Status == status.Value);
        if (stream.HasValue) events = events.Where(e => e.Stream == stream.Value);
        if (fromDate.HasValue) events = events.Where(e => e.SupportsDeliveredTo >= fromDate.Value);
        if (toDate.HasValue) events = events.Where(e => e.SupportsDeliveredFrom <= toDate.Value);

        var projected =
            from e in events
            join p in _db.Participants on e.ParticipantId equals p.Id into pj
            from p in pj.DefaultIfEmpty()
            orderby e.SupportsDeliveredFrom descending
            select new BillableEventDto
            {
                Id = e.Id, ParticipantId = e.ParticipantId,
                ParticipantName = p == null ? null :
                    string.IsNullOrEmpty(p.PreferredName) ? p.FirstName + " " + p.LastName : p.PreferredName + " " + p.LastName,
                FundingSourceId = e.FundingSourceId, ServiceBookingId = e.ServiceBookingId,
                Stream = e.Stream, SourceEntityType = e.SourceEntityType, SourceEntityId = e.SourceEntityId,
                SupportItemNumber = e.SupportItemNumber, SupportsDeliveredFrom = e.SupportsDeliveredFrom,
                SupportsDeliveredTo = e.SupportsDeliveredTo, DayType = e.DayType, Quantity = e.Quantity, Hours = e.Hours,
                UnitPrice = e.UnitPrice, TotalAmount = e.TotalAmount, GstCode = e.GstCode, ClaimType = e.ClaimType,
                CancellationReasonCode = e.CancellationReasonCode, ParticipantApproved = e.ParticipantApproved,
                ClaimReference = e.ClaimReference, Status = e.Status, RejectionReason = e.RejectionReason, CreatedAt = e.CreatedAt
            };

        var result = await PagedResult<BillableEventDto>.CreateAsync(projected, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<BillableEventDto>>.Ok(result));
    }

    /// <summary>Create a billable event in Draft status.</summary>
    [HttpPost("billable-events")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<BillableEventDto>>> CreateBillableEvent(
        [FromBody] CreateBillableEventDto dto, CancellationToken ct)
    {
        // INTAKE-08: claims/billing surfaces exclude drafts — a draft can't have a billable event.
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == dto.ParticipantId && !p.IsDraft, ct);
        if (participant == null) return BadRequest(ApiResponse<BillableEventDto>.Fail("Participant not found"));

        var fundingSourceExists = await _db.FundingSources.AnyAsync(f => f.Id == dto.FundingSourceId, ct);
        if (!fundingSourceExists) return BadRequest(ApiResponse<BillableEventDto>.Fail("Funding source not found"));

        if (dto.ServiceBookingId.HasValue)
        {
            var bookingExists = await _db.ServiceBookings.AnyAsync(b => b.Id == dto.ServiceBookingId.Value, ct);
            if (!bookingExists) return BadRequest(ApiResponse<BillableEventDto>.Fail("Service booking not found"));
        }

        var ev = new BillableEvent
        {
            Id = Guid.NewGuid(), ParticipantId = dto.ParticipantId, FundingSourceId = dto.FundingSourceId,
            ServiceBookingId = dto.ServiceBookingId, Stream = dto.Stream, SourceEntityType = dto.SourceEntityType,
            SourceEntityId = dto.SourceEntityId, SupportItemNumber = dto.SupportItemNumber,
            SupportsDeliveredFrom = dto.SupportsDeliveredFrom, SupportsDeliveredTo = dto.SupportsDeliveredTo,
            DayType = dto.DayType, Quantity = dto.Quantity, Hours = dto.Hours, UnitPrice = dto.UnitPrice,
            TotalAmount = dto.TotalAmount, GstCode = dto.GstCode, ClaimType = dto.ClaimType,
            CancellationReasonCode = dto.CancellationReasonCode, ParticipantApproved = dto.ParticipantApproved,
            ClaimReference = dto.ClaimReference, Status = BillableEventStatus.Draft
        };
        _db.BillableEvents.Add(ev);
        await _db.SaveChangesAsync(ct);

        return Ok(ApiResponse<BillableEventDto>.Ok(MapEvent(ev, FullName(participant))));
    }

    /// <summary>Update a billable event, only while it has not yet been claimed/invoiced/paid.</summary>
    [HttpPut("billable-events/{id:guid}")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<BillableEventDto>>> UpdateBillableEvent(
        Guid id, [FromBody] UpdateBillableEventDto dto, CancellationToken ct)
    {
        var ev = await _db.BillableEvents.FirstOrDefaultAsync(e => e.Id == id, ct);
        if (ev == null) return NotFound(ApiResponse<BillableEventDto>.Fail("Billable event not found"));

        if (ev.Status is BillableEventStatus.Claimed or BillableEventStatus.Invoiced
            or BillableEventStatus.Paid or BillableEventStatus.Cancelled)
        {
            return BadRequest(ApiResponse<BillableEventDto>.Fail(
                $"Cannot update a billable event with status '{ev.Status}'; it has already been claimed."));
        }

        // INTAKE-08 — same draft exclusion as CreateBillableEvent above.
        var participant = await _db.Participants.FirstOrDefaultAsync(p => p.Id == dto.ParticipantId && !p.IsDraft, ct);
        if (participant == null) return BadRequest(ApiResponse<BillableEventDto>.Fail("Participant not found"));

        ev.ParticipantId = dto.ParticipantId; ev.FundingSourceId = dto.FundingSourceId;
        ev.ServiceBookingId = dto.ServiceBookingId; ev.Stream = dto.Stream; ev.SourceEntityType = dto.SourceEntityType;
        ev.SourceEntityId = dto.SourceEntityId; ev.SupportItemNumber = dto.SupportItemNumber;
        ev.SupportsDeliveredFrom = dto.SupportsDeliveredFrom; ev.SupportsDeliveredTo = dto.SupportsDeliveredTo;
        ev.DayType = dto.DayType; ev.Quantity = dto.Quantity; ev.Hours = dto.Hours; ev.UnitPrice = dto.UnitPrice;
        ev.TotalAmount = dto.TotalAmount; ev.GstCode = dto.GstCode; ev.ClaimType = dto.ClaimType;
        ev.CancellationReasonCode = dto.CancellationReasonCode; ev.ParticipantApproved = dto.ParticipantApproved;
        ev.ClaimReference = dto.ClaimReference;
        // Edited content invalidates any prior validation outcome — back to Draft so the
        // event is re-validated the next time a batch validate/create runs against it.
        ev.Status = BillableEventStatus.Draft;
        ev.RejectionReason = null;

        await _db.SaveChangesAsync(ct);
        return Ok(ApiResponse<BillableEventDto>.Ok(MapEvent(ev, FullName(participant))));
    }

    // ══════════════════════════════════════════════════════════════
    // CLAIM BATCHES
    // ══════════════════════════════════════════════════════════════

    /// <summary>List claim batches.</summary>
    [HttpGet("claim-batches")]
    public async Task<ActionResult<ApiResponse<PagedResult<ClaimBatchListDto>>>> GetClaimBatches(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        (page, pageSize) = PagingParams.Clamp(page, pageSize);

        var projected = _db.ClaimBatches.OrderByDescending(b => b.CreatedAt).Select(b => new ClaimBatchListDto
        {
            Id = b.Id, FileName = b.FileName, CreatedAt = b.CreatedAt, SubmittedAt = b.SubmittedAt,
            EventCount = b.Events.Count, TotalAmount = b.Events.Sum(e => e.TotalAmount)
        });

        var result = await PagedResult<ClaimBatchListDto>.CreateAsync(projected, page, pageSize, ct);
        return Ok(ApiResponse<PagedResult<ClaimBatchListDto>>.Ok(result));
    }

    /// <summary>Get a claim batch with its billable events.</summary>
    [HttpGet("claim-batches/{id:guid}")]
    public async Task<ActionResult<ApiResponse<ClaimBatchDetailDto>>> GetClaimBatchById(Guid id, CancellationToken ct)
    {
        var batch = await _db.ClaimBatches.Include(b => b.Events).FirstOrDefaultAsync(b => b.Id == id, ct);
        if (batch == null) return NotFound(ApiResponse<ClaimBatchDetailDto>.Fail("Claim batch not found"));

        var participants = await LoadParticipantNames(batch.Events.Select(e => e.ParticipantId), ct);
        var eventDtos = batch.Events.Select(e => MapEvent(e, participants.GetValueOrDefault(e.ParticipantId))).ToList();

        return Ok(ApiResponse<ClaimBatchDetailDto>.Ok(new ClaimBatchDetailDto
        {
            Id = batch.Id, FileName = batch.FileName, CreatedAt = batch.CreatedAt, SubmittedAt = batch.SubmittedAt,
            EventCount = eventDtos.Count, TotalAmount = eventDtos.Sum(e => e.TotalAmount), Events = eventDtos
        }));
    }

    /// <summary>
    /// Dry-run validation for a candidate set of billable events. Runs <see cref="BillingValidator.Validate"/>
    /// and returns every finding. Never mutates — it deliberately calls Validate, never Apply, and never
    /// calls SaveChangesAsync, so callers can preview a batch as many times as they like before committing.
    /// </summary>
    [HttpPost("claim-batches/validate")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<List<BillingValidationResultDto>>>> ValidateClaimBatch(
        [FromBody] ValidateBillingDto dto, CancellationToken ct)
    {
        var distinctIds = dto.EventIds.Distinct().ToList();
        var (events, bookings, priorRefs, today) = await LoadValidationContext(distinctIds, ct);
        if (events.Count != distinctIds.Count)
            return BadRequest(ApiResponse<List<BillingValidationResultDto>>.Fail("One or more billable event ids were not found."));

        // Validate() is pure and side-effect free — no field on any loaded entity is touched,
        // and this action never calls SaveChangesAsync, so nothing here can persist.
        var results = _validator.Validate(events, bookings, priorRefs, today);

        return Ok(ApiResponse<List<BillingValidationResultDto>>.Ok(
            results.Select(BillingValidationResultDto.From).ToList()));
    }

    /// <summary>
    /// Create a claim batch from a set of billable event ids. Runs validation first and refuses (400)
    /// if any finding is at error severity — only once that dry run is clean does it call
    /// <see cref="BillingValidator.Apply"/>, which consumes ServiceBookingLine balance.
    /// </summary>
    [HttpPost("claim-batches")]
    [Authorize(Roles = "Admin,Coordinator,SuperAdmin")]
    public async Task<ActionResult<ApiResponse<ClaimBatchDetailDto>>> CreateClaimBatch(
        [FromBody] CreateClaimBatchDto dto, CancellationToken ct)
    {
        var distinctIds = dto.EventIds.Distinct().ToList();
        var (events, bookings, priorRefs, today) = await LoadValidationContext(distinctIds, ct);
        if (events.Count != distinctIds.Count)
            return BadRequest(ApiResponse<ClaimBatchDetailDto>.Fail("One or more billable event ids were not found."));

        // ClaimBatch is the PRODA bulk-file construct (see BillableEvent/ClaimBatch doc comments) —
        // only agency-managed events can be routed to a PRODA claim.
        var nonAgency = events.Where(e => e.FundingSource?.RouteType != FundingRouteType.AgencyManaged).ToList();
        if (nonAgency.Count > 0)
            return BadRequest(ApiResponse<ClaimBatchDetailDto>.Fail(
                $"{nonAgency.Count} event(s) are not agency-managed and cannot be added to a PRODA claim batch."));

        // Step 1: dry-run validation. REFUSE before any mutation if any finding is an error.
        var dryRun = _validator.Validate(events, bookings, priorRefs, today);
        var errors = dryRun.Where(r => r.Severity == BillingSeverity.Error).ToList();
        if (errors.Count > 0)
        {
            return BadRequest(ApiResponse<ClaimBatchDetailDto>.Fail(
                errors.Select(e => $"{e.Code}: {e.Message}").Distinct().ToList()));
        }

        // Step 2: only now, with a clean dry run, call Apply() — this is what actually
        // consumes ServiceBookingLine.ClaimedAmount balance and marks events Validated.
        _validator.Apply(events, bookings, priorRefs, today);

        var batch = new ClaimBatch { Id = Guid.NewGuid(), FileName = ProdaBulkFileWriter.FileName(today), CreatedAt = DateTime.UtcNow };
        foreach (var e in events)
        {
            batch.Events.Add(e);
            // Apply() only advances a clean event to Validated. Once it is actually committed
            // to a batch it is claimed — and BillingValidator.Validate's duplicate-reference
            // check keys off Status Claimed/Paid (see its priorClaimedReferences doc comment),
            // so leaving events at Validated would make cross-batch duplicate detection never
            // fire for anything already batched.
            if (e.Status == BillableEventStatus.Validated)
                e.Status = BillableEventStatus.Claimed;
        }

        _db.ClaimBatches.Add(batch);
        await _db.SaveChangesAsync(ct);

        var participants = await LoadParticipantNames(events.Select(e => e.ParticipantId), ct);
        var eventDtos = events.Select(e => MapEvent(e, participants.GetValueOrDefault(e.ParticipantId))).ToList();

        return Ok(ApiResponse<ClaimBatchDetailDto>.Ok(new ClaimBatchDetailDto
        {
            Id = batch.Id, FileName = batch.FileName, CreatedAt = batch.CreatedAt, SubmittedAt = batch.SubmittedAt,
            EventCount = eventDtos.Count, TotalAmount = eventDtos.Sum(e => e.TotalAmount), Events = eventDtos
        }));
    }

    /// <summary>Download the PRODA bulk payment request CSV for a claim batch.</summary>
    [HttpGet("claim-batches/{id:guid}/proda-file")]
    public async Task<IActionResult> DownloadProdaFile(Guid id, CancellationToken ct)
    {
        var batch = await _db.ClaimBatches.Include(b => b.Events).FirstOrDefaultAsync(b => b.Id == id, ct);
        if (batch == null) return NotFound(ApiResponse<bool>.Fail("Claim batch not found"));

        var settings = await _db.ProviderSettings.FirstOrDefaultAsync(ct)
            ?? throw new InvalidOperationException("Provider settings not configured");

        var ndisNumbers = await _db.Participants
            .Where(p => batch.Events.Select(e => e.ParticipantId).Contains(p.Id))
            .ToDictionaryAsync(p => p.Id, p => p.NdisNumber ?? string.Empty, ct);

        var rows = batch.Events
            .Select(e => ProdaBulkFileWriter.FromBillableEvent(
                e, settings.RegistrationNumber, ndisNumbers.GetValueOrDefault(e.ParticipantId, string.Empty), settings.ABN))
            .ToList();

        var csv = ProdaBulkFileWriter.Write(rows);
        return File(System.Text.Encoding.UTF8.GetBytes(csv), "text/csv", batch.FileName);
    }

    // ══════════════════════════════════════════════════════════════
    // HELPERS
    // ══════════════════════════════════════════════════════════════

    private static string FullName(Participant p) =>
        string.IsNullOrWhiteSpace(p.PreferredName) ? $"{p.FirstName} {p.LastName}" : $"{p.PreferredName} {p.LastName}";

    private static FundingSourceDto ToFundingSourceDto(FundingSource fs, string? participantName) => new()
    {
        Id = fs.Id, ParticipantId = fs.ParticipantId, ParticipantName = participantName, RouteType = fs.RouteType,
        BudgetCategory = fs.BudgetCategory, NdisPlanNumber = fs.NdisPlanNumber, PlanStartDate = fs.PlanStartDate,
        PlanEndDate = fs.PlanEndDate, Budget = fs.Budget, PayerName = fs.PayerName, PayerEmail = fs.PayerEmail,
        IsActive = fs.IsActive
    };

    private static BillableEventDto MapEvent(BillableEvent e, string? participantName) => new()
    {
        Id = e.Id, ParticipantId = e.ParticipantId, ParticipantName = participantName,
        FundingSourceId = e.FundingSourceId, ServiceBookingId = e.ServiceBookingId, Stream = e.Stream,
        SourceEntityType = e.SourceEntityType, SourceEntityId = e.SourceEntityId, SupportItemNumber = e.SupportItemNumber,
        SupportsDeliveredFrom = e.SupportsDeliveredFrom, SupportsDeliveredTo = e.SupportsDeliveredTo, DayType = e.DayType,
        Quantity = e.Quantity, Hours = e.Hours, UnitPrice = e.UnitPrice, TotalAmount = e.TotalAmount, GstCode = e.GstCode,
        ClaimType = e.ClaimType, CancellationReasonCode = e.CancellationReasonCode, ParticipantApproved = e.ParticipantApproved,
        ClaimReference = e.ClaimReference, Status = e.Status, RejectionReason = e.RejectionReason, CreatedAt = e.CreatedAt
    };

    private async Task<Dictionary<Guid, string?>> LoadParticipantNames(IEnumerable<Guid> participantIds, CancellationToken ct)
    {
        var ids = participantIds.Distinct().ToList();
        var participants = await _db.Participants.Where(p => ids.Contains(p.Id)).ToListAsync(ct);
        return participants.ToDictionary(p => p.Id, p => (string?)FullName(p));
    }

    /// <summary>
    /// Loads everything <see cref="BillingValidator"/> needs for a candidate set of billable event ids:
    /// the events (with FundingSource for route-type checks), the ServiceBookings they reference (with
    /// Lines, for balance checks), the set of ClaimReference values already Claimed/Paid elsewhere (for
    /// duplicate detection), and today's date. Read-only — issues no writes.
    /// </summary>
    private async Task<(List<BillableEvent> Events, List<ServiceBooking> Bookings, HashSet<string> PriorClaimedReferences, DateOnly Today)>
        LoadValidationContext(List<Guid> eventIds, CancellationToken ct)
    {
        var events = await _db.BillableEvents
            .Include(e => e.FundingSource)
            .Where(e => eventIds.Contains(e.Id))
            .ToListAsync(ct);

        var bookingIds = events.Where(e => e.ServiceBookingId.HasValue).Select(e => e.ServiceBookingId!.Value).Distinct().ToList();
        var bookings = await _db.ServiceBookings
            .Include(b => b.Lines)
            .Where(b => bookingIds.Contains(b.Id))
            .ToListAsync(ct);

        var priorClaimedReferences = await _db.BillableEvents
            .Where(e => !eventIds.Contains(e.Id) &&
                        (e.Status == BillableEventStatus.Claimed || e.Status == BillableEventStatus.Paid))
            .Select(e => e.ClaimReference)
            .ToListAsync(ct);

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        return (events, bookings, new HashSet<string>(priorClaimedReferences), today);
    }
}
